/**
 * Invoices business logic (INV01–INV15, CST05–CST07, CAL03, CAL06, CAL07, INT07, AT23).
 *
 * The review lifecycle, approval policy, append-only revisions and the
 * settlement ledger all live here. What a screen or the project model reads
 * — settlement state, unpaid balances, per-line approved cost and settled
 * cash — is derived from stored records on every read and never cached.
 *
 * Approval is a local transaction: it freezes the revision, bumps the model
 * revision and records an OutboxEvent that stays `not-configured`, because no
 * accounting provider is connected. Payment is never inferred from approval.
 */
import { createHash, randomUUID } from 'node:crypto';
import { resolveAsOfDate } from '@/shared/config/app-config';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '@/shared/lib/errors';
import { money, sumMoney, type Money } from '@/shared/lib/money';
import { daysBetween } from '@/shared/lib/dates';
import {
  allocateResidualToLast,
  grossFromNet,
  mulDivCents,
  recoverableTax,
  TAX_TREATMENTS,
  type Ppm,
  type TaxSettings,
  type TaxTreatment,
} from '@/shared/finance-engine';
import { parseStatementAmount, parseStatementDate, splitCsv } from '@/modules/reconciliation/csv-parser';
import {
  asId,
  type CommitmentId,
  type CostLineId,
  type InvoiceId,
  type InvoiceIntakeId,
  type InvoiceRevisionId,
  type IsoDate,
  type IsoDateTime,
  type PaymentId,
  type PaymentImportId,
  type ProjectId,
  type ReconciliationItemId,
  type RetentionTrancheId,
  type SupplierId,
  type UserId,
} from '@/shared/types/common';
import { accessService } from '@/modules/access/service';
import { projectsService } from '@/modules/projects/service';
import type { ProjectPermission } from '@/modules/projects/model';
import { budgetsService } from '@/modules/budgets/service';
import { commitmentsService } from '@/modules/commitments/service';
import { invoicesRepository } from './repository';
import {
  ACCEPTED_MIME_TYPES,
  FINANCE_REVIEW_WARNINGS,
  MAX_INTAKE_BYTES,
  normaliseInvoiceNumber,
  type AllowanceTreatment,
  type ApprovalDecision,
  type ApprovedAllocationView,
  type ContractPosition,
  type DecisionKind,
  type DuplicateFindings,
  type Invoice,
  type InvoiceAllocation,
  type InvoiceIntake,
  type InvoiceRevision,
  type InvoiceType,
  type InvoiceWarning,
  type IntakeOrigin,
  type OutboxEvent,
  type Payment,
  type PaymentImport,
  type PaymentImportRow,
  type ReconciliationItem,
  type RetentionTranche,
  type ReviewState,
  type SettlementAllocation,
  type SettlementSummary,
  type SettlementType,
} from './model';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/* ------------------------------------------------------------------ inputs */

export interface AllocationInput {
  readonly id?: string;
  readonly costLineId: CostLineId;
  readonly commitmentId?: CommitmentId;
  readonly stageId?: string;
  readonly net: Money;
  readonly tax: Money;
  readonly taxTreatment: TaxTreatment;
  /** Defaults to the cost line's recoverable share. */
  readonly recoverablePpm?: Ppm;
  readonly allowanceTreatment?: AllowanceTreatment;
}

export interface CreateIntakeInput {
  readonly projectId: ProjectId;
  readonly filename: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly bytes?: Uint8Array;
  readonly origin?: IntakeOrigin;
  readonly actor: UserId;
}

export interface CreateInvoiceInput {
  readonly projectId: ProjectId;
  readonly type: InvoiceType;
  readonly supplierId: SupplierId;
  readonly number: string;
  readonly invoiceDate: IsoDate;
  readonly dueDate: IsoDate;
  readonly net: Money;
  readonly tax: Money;
  readonly lineDescriptions: readonly string[];
  readonly allocations: readonly AllocationInput[];
  /** The explicit ≤ 1 cent difference between the invoice and its allocations (INV06). */
  readonly roundingAdjustment?: Money;
  readonly intakeId?: InvoiceIntakeId;
  readonly actor: UserId;
}

export interface DraftChanges {
  readonly supplierId?: SupplierId;
  readonly number?: string;
  readonly invoiceDate?: IsoDate;
  readonly dueDate?: IsoDate;
  readonly net?: Money;
  readonly tax?: Money;
  readonly lineDescriptions?: readonly string[];
  readonly allocations?: readonly AllocationInput[];
  readonly roundingAdjustment?: Money;
  readonly scheduledPaymentDate?: IsoDate;
  readonly expectedRevision?: number;
}

export interface DecideInput {
  readonly invoiceId: InvoiceId;
  readonly revisionId: InvoiceRevisionId;
  readonly actor: UserId;
  readonly decision: DecisionKind;
  readonly reason?: string;
  readonly scheduledPaymentDate?: IsoDate;
}

export interface DecideResult {
  readonly invoice: Invoice;
  readonly decision: ApprovalDecision;
  readonly newModelRevision: number;
  readonly syncState: Invoice['syncState'];
}

export interface RecordPaymentInput {
  readonly projectId: ProjectId;
  readonly amount: Money;
  readonly direction: Payment['direction'];
  readonly effectiveDate: IsoDate;
  readonly reference: string;
  readonly supplierId?: SupplierId;
  readonly sourceId?: string;
  readonly note?: string;
  readonly actor: UserId;
  readonly allocations?: readonly { readonly invoiceId: InvoiceId; readonly amount: Money; readonly settlementType: SettlementType }[];
}

export interface AllocateSettlementInput {
  readonly paymentId?: PaymentId;
  readonly creditNoteInvoiceId?: InvoiceId;
  readonly invoiceId: InvoiceId;
  readonly amount: Money;
  readonly settlementType: SettlementType;
  readonly effectiveDate?: IsoDate;
  readonly actor: UserId;
}

export interface ImportConfirmation {
  readonly payments: readonly Payment[];
  readonly matched: number;
  readonly unmatched: number;
}

/* ----------------------------------------------------------------- helpers */

function now(): IsoDateTime {
  return new Date().toISOString();
}

/** The platform's as-of date: "today" for warnings and controlled adjustments. */
function today(): IsoDate {
  return resolveAsOfDate();
}

function actorName(userId: UserId): string {
  return accessService.resolveUserName(userId) ?? 'system';
}

function dollars(value: Money): string {
  return (value.cents / 100).toFixed(2);
}

function actorHas(projectId: ProjectId, actor: UserId, permission: ProjectPermission): boolean {
  const scope = projectsService.scopeFor(actor, projectId);
  return scope !== null && scope.permissions.includes(permission);
}

function taxSettings(projectId: ProjectId): TaxSettings {
  const policy = projectsService.policyFor(projectId);
  return { standardRatePpm: policy.tax.standardRatePpm, marginSchemeEnabled: policy.tax.marginSchemeEnabled };
}

function allocationGross(allocation: InvoiceAllocation): number {
  return allocation.net.cents + allocation.tax.cents;
}

/** Split `cents` across allocations pro rata by gross, residual to the last (CAL02). */
function apportion(cents: number, allocations: readonly InvoiceAllocation[]): number[] {
  const weights = allocations.map((allocation) => Math.max(allocationGross(allocation), 0));
  if (weights.every((weight) => weight === 0)) return allocations.map(() => 0);
  return allocateResidualToLast(cents, weights);
}

function signOf(invoice: Invoice): 1 | -1 {
  return invoice.type === 'credit-note' ? -1 : 1;
}

function outbox(projectId: ProjectId, type: OutboxEvent['type'], payload: Record<string, unknown>): OutboxEvent {
  return invoicesRepository.insertOutbox({
    id: asId<'OutboxEvent'>(`obx-${randomUUID()}`),
    projectId,
    type,
    payload,
    status: 'not-configured',
    createdAt: now(),
  });
}

function contentHash(fields: unknown): string {
  return createHash('sha256').update(JSON.stringify(fields)).digest('hex');
}

/** Magic-byte signatures for the accepted types (INV01). */
function sniffMimeType(bytes: Uint8Array): string | null {
  const starts = (...signature: number[]): boolean => signature.every((byte, index) => bytes[index] === byte);
  if (starts(0x25, 0x50, 0x44, 0x46, 0x2d)) return 'application/pdf';
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png';
  if (starts(0xff, 0xd8, 0xff)) return 'image/jpeg';
  return null;
}

function warningsFor(projectId: ProjectId, invoiceDate: IsoDate, dueDate: IsoDate): InvoiceWarning[] {
  const warnings: InvoiceWarning[] = [];
  if (dueDate < invoiceDate) warnings.push('due-before-invoice');
  if (invoiceDate > today()) warnings.push('future-dated');
  if (projectsService.isPeriodLocked(projectId, invoiceDate)) warnings.push('closed-period');
  return warnings;
}

interface RevisionFields {
  readonly supplierId: SupplierId;
  readonly number: string;
  readonly invoiceDate: IsoDate;
  readonly dueDate: IsoDate;
  readonly net: Money;
  readonly tax: Money;
  readonly lineDescriptions: readonly string[];
  readonly allocations: readonly AllocationInput[];
  readonly roundingAdjustment?: Money;
}

/**
 * INV06/INV07 hard checks: anything here is refused outright. Softer problems
 * (incomplete coding, a missing allowance choice) are `blockingIssues` that
 * keep the invoice in review instead.
 */
function normaliseRevision(projectId: ProjectId, fields: RevisionFields): {
  readonly allocations: InvoiceAllocation[];
  readonly roundingAdjustment: Money;
} {
  const supplier = commitmentsService.requireSupplier(fields.supplierId);
  if (supplier.projectId !== projectId) {
    throw new ValidationError('Choose a supplier of this project.', { fieldErrors: { supplierId: ['This supplier belongs to another project.'] } });
  }
  if (!fields.number.trim()) throw new ValidationError('Enter the invoice number.', { fieldErrors: { number: ['An invoice number is required.'] } });
  if (!ISO_DATE.test(fields.invoiceDate)) throw new ValidationError('Enter the invoice date as YYYY-MM-DD.', { fieldErrors: { invoiceDate: ['Use YYYY-MM-DD.'] } });
  if (!ISO_DATE.test(fields.dueDate)) throw new ValidationError('Enter the due date as YYYY-MM-DD.', { fieldErrors: { dueDate: ['Use YYYY-MM-DD.'] } });
  if (fields.net.cents < 0 || fields.tax.cents < 0) {
    throw new ValidationError('Amounts cannot be negative; a credit is recorded as a credit note.', {
      fieldErrors: { net: ['Enter a positive amount. Use the credit note type for credits.'] },
    });
  }

  const allocations: InvoiceAllocation[] = fields.allocations.map((input, index) => {
    if (input.net.cents < 0 || input.tax.cents < 0) {
      throw new ValidationError('Allocation amounts cannot be negative.', { fieldErrors: { allocations: [`Row ${index + 1} has a negative amount.`] } });
    }
    if (!TAX_TREATMENTS.includes(input.taxTreatment)) {
      throw new ValidationError('Every allocation needs a tax treatment.', { fieldErrors: { allocations: [`Row ${index + 1}: choose a tax treatment.`] } });
    }
    if (input.taxTreatment === 'margin-scheme') {
      throw new ValidationError('Margin scheme is not available until finance review supplies a method (CAL11).', {
        fieldErrors: { allocations: [`Row ${index + 1}: choose another tax treatment.`] },
      });
    }
    const line = budgetsService.requireCostLine(input.costLineId);
    if (line.projectId !== projectId || line.rowType !== 'posting') {
      throw new ValidationError(`${line.code} is not a posting line of this project.`, {
        fieldErrors: { allocations: [`Row ${index + 1}: choose a posting cost line of this project.`] },
      });
    }
    if (input.commitmentId) {
      const commitment = commitmentsService.requireCommitment(input.commitmentId);
      if (commitment.projectId !== projectId) {
        throw new ValidationError('That commitment belongs to another project.', { fieldErrors: { allocations: [`Row ${index + 1}: wrong commitment.`] } });
      }
      if (input.stageId && !commitment.stages.some((stage) => stage.id === input.stageId)) {
        throw new ValidationError('That stage is not on the commitment.', { fieldErrors: { allocations: [`Row ${index + 1}: choose a stage of ${commitment.reference}.`] } });
      }
    }
    return {
      id: input.id ?? `alc-${randomUUID()}`,
      costLineId: input.costLineId,
      ...(input.commitmentId ? { commitmentId: input.commitmentId } : {}),
      ...(input.commitmentId && input.stageId ? { stageId: input.stageId } : {}),
      net: input.net,
      tax: input.tax,
      taxTreatment: input.taxTreatment,
      recoverablePpm: input.recoverablePpm ?? line.recoverablePpm,
      ...(!input.commitmentId && input.allowanceTreatment ? { allowanceTreatment: input.allowanceTreatment } : {}),
    };
  });

  let rounding = money(0);
  if (allocations.length > 0) {
    const netDiff = fields.net.cents - allocations.reduce((sum, row) => sum + row.net.cents, 0);
    const taxDiff = fields.tax.cents - allocations.reduce((sum, row) => sum + row.tax.cents, 0);
    if (netDiff !== 0 || taxDiff !== 0) {
      const total = netDiff + taxDiff;
      const within = Math.abs(netDiff) <= 1 && Math.abs(taxDiff) <= 1 && Math.abs(total) <= 1;
      if (!within || fields.roundingAdjustment?.cents !== total) {
        throw new ValidationError(within ? 'The allocations are one cent off the invoice; record the rounding adjustment explicitly.' : 'The allocations must match the invoice net and tax.', {
          fieldErrors: {
            allocations: [
              `Allocated net is off by ${netDiff / 100} and tax by ${taxDiff / 100}. ${within ? 'Record the one-cent rounding adjustment explicitly.' : 'Adjust the rows so they add up.'}`,
            ],
          },
        });
      }
      rounding = money(total);
    }
  }
  return { allocations, roundingAdjustment: rounding };
}

/** Problems that keep an invoice in review; empty means it may be marked ready (INV07, CST06). */
function blockingIssues(revision: InvoiceRevision): string[] {
  const issues: string[] = [];
  if (revision.allocations.length === 0) issues.push('Code the invoice to at least one cost line.');
  revision.allocations.forEach((allocation, index) => {
    if (!allocation.commitmentId && !allocation.allowanceTreatment) {
      issues.push(`Row ${index + 1} is direct spend: choose whether it consumes the line allowance or is additional scope.`);
    }
    if (allocation.commitmentId) {
      const commitment = commitmentsService.requireCommitment(allocation.commitmentId);
      if (commitment.state === 'draft') issues.push(`Row ${index + 1}: commitment ${commitment.reference} is not authorised yet.`);
    }
  });
  if (revision.net.cents + revision.tax.cents === 0) issues.push('The invoice total is zero.');
  return issues;
}

function newRevision(invoiceId: InvoiceId, revisionNumber: number, projectId: ProjectId, fields: RevisionFields, actor: UserId): InvoiceRevision {
  const { allocations, roundingAdjustment } = normaliseRevision(projectId, fields);
  const hashable = {
    supplierId: fields.supplierId,
    number: fields.number.trim(),
    invoiceDate: fields.invoiceDate,
    dueDate: fields.dueDate,
    net: fields.net.cents,
    tax: fields.tax.cents,
    lines: fields.lineDescriptions,
    allocations: allocations.map((row) => [row.costLineId, row.commitmentId ?? null, row.stageId ?? null, row.net.cents, row.tax.cents, row.taxTreatment, row.recoverablePpm, row.allowanceTreatment ?? null]),
    rounding: roundingAdjustment.cents,
  };
  return {
    id: asId<'InvoiceRevision'>(`${invoiceId}-r${revisionNumber}-${randomUUID().slice(0, 8)}`),
    invoiceId,
    revisionNumber,
    supplierId: fields.supplierId,
    number: fields.number.trim(),
    invoiceDate: fields.invoiceDate,
    dueDate: fields.dueDate,
    net: fields.net,
    tax: fields.tax,
    gross: money(fields.net.cents + fields.tax.cents),
    roundingAdjustment,
    lineDescriptions: fields.lineDescriptions.map((line) => line.trim()).filter(Boolean),
    allocations,
    extraction: { source: 'manual', confidence: null, fields: {} },
    warnings: warningsFor(projectId, fields.invoiceDate, fields.dueDate),
    contentHash: contentHash(hashable),
    createdAt: now(),
    createdBy: actor,
    frozen: false,
  };
}

function isLive(invoice: Invoice): boolean {
  return invoice.reviewState !== 'void' && invoice.reviewState !== 'rejected';
}

function supplierName(supplierId: SupplierId): string {
  try {
    return commitmentsService.requireSupplier(supplierId).name;
  } catch {
    return 'Unknown supplier';
  }
}

/* ----------------------------------------------------------------- service */

export const invoicesService = {
  listInvoices(projectId: ProjectId, filter?: { readonly reviewState?: ReviewState }): readonly Invoice[] {
    const rows = invoicesRepository.listInvoices(projectId);
    return filter?.reviewState ? rows.filter((row) => row.reviewState === filter.reviewState) : rows;
  },

  requireInvoice(id: InvoiceId): Invoice {
    const invoice = invoicesRepository.findInvoice(id);
    if (!invoice) throw new NotFoundError('Invoice', id);
    return invoice;
  },

  currentRevision(invoice: Invoice): InvoiceRevision {
    const revision = invoicesRepository.findRevision(invoice.currentRevisionId);
    if (!revision) throw new NotFoundError('Invoice revision', invoice.currentRevisionId);
    return revision;
  },

  approvedRevision(invoice: Invoice): InvoiceRevision | null {
    if (!invoice.approvedRevisionId || invoice.reviewState === 'void') return null;
    return invoicesRepository.findRevision(invoice.approvedRevisionId) ?? null;
  },

  listRevisions(invoiceId: InvoiceId): readonly InvoiceRevision[] {
    return invoicesRepository.listRevisions(invoiceId);
  },

  blockingIssues(invoiceId: InvoiceId): readonly string[] {
    return blockingIssues(invoicesService.currentRevision(invoicesService.requireInvoice(invoiceId)));
  },

  /* ---------------------------------------------------------------- intake */

  listIntakes(projectId: ProjectId): readonly InvoiceIntake[] {
    return invoicesRepository.listIntakes(projectId);
  },

  requireIntake(id: InvoiceIntakeId): InvoiceIntake {
    const intake = invoicesRepository.findIntake(id);
    if (!intake) throw new NotFoundError('Invoice intake', id);
    return intake;
  },

  /**
   * INV01 — record a received document. Over 20 MB is refused outright. When
   * bytes are supplied the real type is read from the magic bytes and a
   * sha256 is taken; a mismatch leaves a visible failed intake that can never
   * become an invoice. The bytes themselves are not retained — this build has
   * no object storage.
   */
  createIntake(input: CreateIntakeInput): InvoiceIntake {
    projectsService.assertMutable(input.projectId);
    const filename = input.filename.trim();
    if (!filename) throw new ValidationError('The document needs a filename.', { fieldErrors: { document: ['Choose a file.'] } });
    const size = input.bytes ? input.bytes.byteLength : input.sizeBytes;
    if (!Number.isInteger(size) || size < 0) throw new ValidationError('The file size is not valid.');
    if (size > MAX_INTAKE_BYTES) {
      throw new ValidationError('Invoice documents are limited to 20 MB.', {
        fieldErrors: { document: [`This file is ${(size / 1024 / 1024).toFixed(1)} MB. Compress it or split it and try again.`] },
      });
    }
    const declared = input.mimeType.trim().toLowerCase();
    let scanState: InvoiceIntake['scanState'] = 'skipped';
    let failureReason: string | undefined;
    let checksum = '';
    if (!(ACCEPTED_MIME_TYPES as readonly string[]).includes(declared)) {
      scanState = 'failed';
      failureReason = `Only PDF, PNG and JPEG documents are accepted (received ${declared || 'an unknown type'}).`;
    } else if (input.bytes) {
      checksum = createHash('sha256').update(input.bytes).digest('hex');
      const actual = sniffMimeType(input.bytes);
      if (size === 0) {
        scanState = 'failed';
        failureReason = 'The file is empty.';
      } else if (actual === null) {
        scanState = 'failed';
        failureReason = 'The file content is not a PDF, PNG or JPEG — it may be corrupted.';
      } else if (actual !== declared) {
        scanState = 'failed';
        failureReason = `The file says it is ${declared} but its content is ${actual}.`;
      } else {
        scanState = 'clean';
      }
    }
    const intake = invoicesRepository.insertIntake({
      id: asId<'InvoiceIntake'>(`int-${randomUUID()}`),
      projectId: input.projectId,
      filename,
      mimeType: declared,
      sizeBytes: size,
      checksumSha256: checksum,
      receivedAt: now(),
      origin: input.origin ?? (input.bytes ? 'upload' : 'manual-entry'),
      actor: input.actor,
      scanState,
      ...(failureReason ? { failureReason } : {}),
    });
    accessService.record({
      actor: actorName(input.actor),
      summary: `Invoice document received · ${filename}`,
      context: `${projectsService.require(input.projectId).code} · ${scanState}${failureReason ? ` · ${failureReason}` : ''}${checksum ? ` · sha256 ${checksum.slice(0, 12)}…` : ''}`,
      outcome: scanState === 'failed' ? 'failed' : 'ok',
    });
    return intake;
  },

  /* -------------------------------------------------------------- capture */

  /** INV05/INV07/INV08 — capture an invoice; it goes straight to needs-review (extraction is manual). */
  createInvoice(input: CreateInvoiceInput): Invoice {
    projectsService.assertMutable(input.projectId);
    if (input.type !== 'invoice' && input.type !== 'credit-note') throw new ValidationError('Choose invoice or credit note.');
    let intake: InvoiceIntake | undefined;
    if (input.intakeId) {
      intake = invoicesService.requireIntake(input.intakeId);
      if (intake.projectId !== input.projectId) throw new NotFoundError('Invoice intake', input.intakeId);
      if (intake.scanState === 'failed') throw new ConflictError(`${intake.filename} failed its checks and cannot become an invoice: ${intake.failureReason ?? 'unreadable'}.`);
      if (intake.invoiceId) throw new ConflictError(`${intake.filename} is already attached to another invoice.`);
    }
    const invoiceId = asId<'Invoice'>(`inv-${randomUUID()}`);
    const revision = newRevision(invoiceId, 1, input.projectId, input, input.actor);
    const at = now();
    invoicesRepository.insertRevision(revision);
    const invoice = invoicesRepository.insertInvoice({
      id: invoiceId,
      projectId: input.projectId,
      type: input.type,
      supplierId: input.supplierId,
      number: revision.number,
      normalisedNumber: normaliseInvoiceNumber(revision.number),
      ...(intake ? { intakeId: intake.id } : {}),
      currency: 'AUD',
      // Received → needs review immediately: there is no automated extraction to wait for (INV02/INV03 deferred).
      reviewState: 'needs-review',
      syncState: 'not-queued',
      currentRevisionId: revision.id,
      comments: [],
      receivedAt: intake?.receivedAt ?? at,
      createdAt: at,
      createdBy: input.actor,
    });
    if (intake) invoicesRepository.updateIntake(intake.id, { invoiceId });
    projectsService.bumpRevision(input.projectId);
    accessService.record({
      actor: actorName(input.actor),
      summary: `${input.type === 'credit-note' ? 'Credit note' : 'Invoice'} captured · ${supplierName(input.supplierId)} ${revision.number}`,
      context: `gross ${dollars(revision.gross)} · needs review${revision.warnings.length ? ` · warnings: ${revision.warnings.join(', ')}` : ''}`,
    });
    return invoice;
  },

  /**
   * INV10 — edit the invoice. A change to any revision field appends a new
   * revision; the approved revision stays frozen and an approved invoice goes
   * back to needs-review for renewed approval, with an `invoice.corrected`
   * outbox event. Only the scheduled payment date changes in place.
   */
  updateDraft(invoiceId: InvoiceId, changes: DraftChanges, actor: UserId): Invoice {
    const invoice = invoicesService.requireInvoice(invoiceId);
    projectsService.assertMutable(invoice.projectId);
    if (invoice.reviewState === 'void') throw new ConflictError('A void invoice cannot be edited.');
    const current = invoicesService.currentRevision(invoice);
    const fields: RevisionFields = {
      supplierId: changes.supplierId ?? current.supplierId,
      number: changes.number ?? current.number,
      invoiceDate: changes.invoiceDate ?? current.invoiceDate,
      dueDate: changes.dueDate ?? current.dueDate,
      net: changes.net ?? current.net,
      tax: changes.tax ?? current.tax,
      lineDescriptions: changes.lineDescriptions ?? current.lineDescriptions,
      allocations: changes.allocations ?? current.allocations,
      roundingAdjustment: changes.roundingAdjustment ?? current.roundingAdjustment,
    };
    const candidate = newRevision(invoice.id, current.revisionNumber + 1, invoice.projectId, fields, actor);
    const revisionChanged = candidate.contentHash !== current.contentHash;
    const scheduleChanged = changes.scheduledPaymentDate !== undefined && changes.scheduledPaymentDate !== invoice.scheduledPaymentDate;
    if (!revisionChanged && !scheduleChanged) return invoice;
    if (changes.scheduledPaymentDate !== undefined && !ISO_DATE.test(changes.scheduledPaymentDate)) {
      throw new ValidationError('Enter the payment date as YYYY-MM-DD.', { fieldErrors: { scheduledPaymentDate: ['Use YYYY-MM-DD.'] } });
    }

    projectsService.bumpRevision(invoice.projectId, changes.expectedRevision);
    if (!revisionChanged) {
      const updated = invoicesRepository.updateInvoice(invoice.id, { scheduledPaymentDate: changes.scheduledPaymentDate });
      if (!updated) throw new NotFoundError('Invoice', invoice.id);
      accessService.record({ actor: actorName(actor), summary: `Payment date scheduled · ${invoice.number}`, context: `${changes.scheduledPaymentDate}` });
      return updated;
    }

    invoicesRepository.insertRevision(candidate);
    const wasApproved = invoice.reviewState === 'approved';
    const nextState: ReviewState = invoice.reviewState === 'on-hold' ? 'on-hold' : 'needs-review';
    const updated = invoicesRepository.updateInvoice(invoice.id, {
      currentRevisionId: candidate.id,
      supplierId: candidate.supplierId,
      number: candidate.number,
      normalisedNumber: normaliseInvoiceNumber(candidate.number),
      reviewState: nextState,
      submittedBy: undefined,
      submittedAt: undefined,
      rejectReason: undefined,
      warningsCleared: undefined,
      ...(scheduleChanged ? { scheduledPaymentDate: changes.scheduledPaymentDate } : {}),
    });
    if (!updated) throw new NotFoundError('Invoice', invoice.id);
    if (wasApproved || invoice.approvedRevisionId) {
      outbox(invoice.projectId, 'invoice.corrected', {
        invoiceId: invoice.id,
        approvedRevisionId: invoice.approvedRevisionId ?? null,
        newRevisionId: candidate.id,
      });
    }
    accessService.record({
      actor: actorName(actor),
      summary: `Invoice ${wasApproved ? 'corrected' : 'edited'} · ${candidate.number} · revision ${candidate.revisionNumber}`,
      context: `gross ${dollars(current.gross)} → ${dollars(candidate.gross)}${wasApproved ? ' · approved revision kept frozen · renewed approval required' : ''}`,
    });
    return updated;
  },

  /**
   * INV07/INV08 — valid data moves to ready. Warnings must be acknowledged;
   * future or closed-period dates need a finance reviewer (`payment.record`).
   */
  markReady(invoiceId: InvoiceId, actor: UserId, options: { readonly acknowledgeWarnings?: boolean } = {}): Invoice {
    const invoice = invoicesService.requireInvoice(invoiceId);
    projectsService.assertMutable(invoice.projectId);
    if (invoice.reviewState === 'ready') return invoice;
    if (invoice.reviewState !== 'needs-review' && invoice.reviewState !== 'received') {
      throw new ConflictError(`A ${invoice.reviewState} invoice cannot be marked ready.`);
    }
    const revision = invoicesService.currentRevision(invoice);
    const issues = blockingIssues(revision);
    if (issues.length > 0) {
      throw new ValidationError(issues[0] ?? 'The invoice is incomplete.', { fieldErrors: { allocations: issues }, issues });
    }
    const outstanding = invoice.warningsCleared?.revisionId === revision.id ? [] : (revision.warnings as InvoiceWarning[]);
    if (outstanding.length > 0) {
      if (outstanding.some((warning) => FINANCE_REVIEW_WARNINGS.includes(warning)) && !actorHas(invoice.projectId, actor, 'payment.record')) {
        throw new ForbiddenError('This invoice is dated in a closed period or the future; a finance reviewer with payment authority must mark it ready.');
      }
      if (!options.acknowledgeWarnings) {
        throw new ValidationError('Acknowledge the warnings before marking the invoice ready.', {
          fieldErrors: { acknowledgeWarnings: outstanding.map((warning) => `Warning: ${warning}`) },
        });
      }
    }
    const updated = invoicesRepository.updateInvoice(invoice.id, {
      reviewState: 'ready',
      ...(outstanding.length > 0 ? { warningsCleared: { by: actor, at: now(), revisionId: revision.id } } : {}),
    });
    if (!updated) throw new NotFoundError('Invoice', invoice.id);
    accessService.record({
      actor: actorName(actor),
      summary: `Invoice ready for approval · ${invoice.number}`,
      context: outstanding.length ? `Warnings cleared: ${outstanding.join(', ')}` : 'All checks passed',
    });
    return updated;
  },

  /** INV08 — submission. Unresolved duplicate findings block it (INV04). */
  submitForApproval(invoiceId: InvoiceId, actor: UserId, options: { readonly acknowledgeWarnings?: boolean } = {}): Invoice {
    let invoice = invoicesService.requireInvoice(invoiceId);
    projectsService.assertMutable(invoice.projectId);
    if (invoice.reviewState === 'awaiting-approval') return invoice;
    if (invoice.reviewState === 'needs-review' || invoice.reviewState === 'received') {
      invoice = invoicesService.markReady(invoiceId, actor, options);
    }
    if (invoice.reviewState !== 'ready') throw new ConflictError(`A ${invoice.reviewState} invoice cannot be submitted.`);
    invoicesService.assertNoUnresolvedDuplicates(invoice);
    const updated = invoicesRepository.updateInvoice(invoice.id, { reviewState: 'awaiting-approval', submittedBy: actor, submittedAt: now() });
    if (!updated) throw new NotFoundError('Invoice', invoice.id);
    accessService.record({
      actor: actorName(actor),
      summary: `Invoice submitted for approval · ${invoice.number}`,
      context: `gross ${dollars(invoicesService.currentRevision(invoice).gross)}`,
    });
    return updated;
  },

  hold(invoiceId: InvoiceId, actor: UserId, reason: string): Invoice {
    const invoice = invoicesService.requireInvoice(invoiceId);
    projectsService.assertMutable(invoice.projectId);
    if (!reason.trim()) throw new ValidationError('Give a reason for the hold.', { fieldErrors: { reason: ['A reason is required.'] } });
    if (!['needs-review', 'ready', 'awaiting-approval', 'received'].includes(invoice.reviewState)) {
      throw new ConflictError(`A ${invoice.reviewState} invoice cannot be put on hold.`);
    }
    const updated = invoicesRepository.updateInvoice(invoice.id, { reviewState: 'on-hold', holdReason: reason.trim() });
    if (!updated) throw new NotFoundError('Invoice', invoice.id);
    accessService.record({ actor: actorName(actor), summary: `Invoice on hold · ${invoice.number}`, context: reason.trim() });
    return updated;
  },

  /** INV08 — releasing a hold revalidates: back to awaiting approval when it was submitted and still valid, else needs review. */
  releaseHold(invoiceId: InvoiceId, actor: UserId): Invoice {
    const invoice = invoicesService.requireInvoice(invoiceId);
    projectsService.assertMutable(invoice.projectId);
    if (invoice.reviewState !== 'on-hold') throw new ConflictError('Only an invoice on hold can be released.');
    const revision = invoicesService.currentRevision(invoice);
    const valid = blockingIssues(revision).length === 0 && invoicesService.unresolvedDuplicates(invoice).length === 0;
    const warningsOk = revision.warnings.length === 0 || invoice.warningsCleared?.revisionId === revision.id;
    const next: ReviewState = valid && warningsOk && invoice.submittedBy ? 'awaiting-approval' : 'needs-review';
    const updated = invoicesRepository.updateInvoice(invoice.id, { reviewState: next, holdReason: undefined });
    if (!updated) throw new NotFoundError('Invoice', invoice.id);
    accessService.record({ actor: actorName(actor), summary: `Hold released · ${invoice.number}`, context: `Revalidated → ${next}` });
    return updated;
  },

  reject(invoiceId: InvoiceId, actor: UserId, reason: string): Invoice {
    const invoice = invoicesService.requireInvoice(invoiceId);
    projectsService.assertMutable(invoice.projectId);
    if (!reason.trim()) throw new ValidationError('Give a reason for rejecting the invoice.', { fieldErrors: { reason: ['A reason is required.'] } });
    if (['approved', 'rejected', 'void'].includes(invoice.reviewState)) throw new ConflictError(`A ${invoice.reviewState} invoice cannot be rejected.`);
    const updated = invoicesRepository.updateInvoice(invoice.id, { reviewState: 'rejected', rejectReason: reason.trim() });
    if (!updated) throw new NotFoundError('Invoice', invoice.id);
    accessService.record({ actor: actorName(actor), summary: `Invoice rejected · ${invoice.number}`, context: reason.trim() });
    return updated;
  },

  /** INV12 — void keeps the record. A paid invoice needs a refund or adjustment first. */
  voidInvoice(invoiceId: InvoiceId, actor: UserId, reason: string): Invoice {
    const invoice = invoicesService.requireInvoice(invoiceId);
    projectsService.assertMutable(invoice.projectId);
    if (!reason.trim()) throw new ValidationError('Give a reason for voiding the invoice.', { fieldErrors: { reason: ['A reason is required.'] } });
    if (invoice.reviewState === 'void') throw new ConflictError('The invoice is already void.');
    const summary = invoicesService.settlementSummary(invoice.id);
    const settled =
      invoice.type === 'credit-note'
        ? summary.appliedCredits.cents
        : summary.paidCash.cents - summary.refunds.cents + summary.appliedCredits.cents + summary.withholding.cents + summary.otherNonCash.cents;
    if (settled !== 0) {
      throw new ConflictError(
        invoice.type === 'credit-note'
          ? 'This credit note has been applied; reverse the application before voiding it.'
          : 'This invoice has settlements against it. Record a refund or adjustment first, then void it.',
        { settled: money(settled) },
      );
    }
    const updated = invoicesRepository.updateInvoice(invoice.id, { reviewState: 'void', voidReason: reason.trim() });
    if (!updated) throw new NotFoundError('Invoice', invoice.id);
    if (invoice.approvedRevisionId) projectsService.bumpRevision(invoice.projectId);
    accessService.record({ actor: actorName(actor), summary: `Invoice voided · ${invoice.number}`, context: `${reason.trim()} · record and history retained` });
    return updated;
  },

  /* ------------------------------------------------------------ duplicates */

  /** INV04 — layered checks, computed on read. Void and rejected invoices never match. */
  duplicateFindings(invoiceId: InvoiceId): DuplicateFindings {
    const invoice = invoicesService.requireInvoice(invoiceId);
    const revision = invoicesService.currentRevision(invoice);
    const checksum = invoice.intakeId ? (invoicesRepository.findIntake(invoice.intakeId)?.checksumSha256 ?? '') : '';
    const others = invoicesRepository.listInvoices(invoice.projectId).filter((row) => row.id !== invoice.id && isLive(row));
    const exact = others
      .filter((row) => row.type === invoice.type && row.supplierId === invoice.supplierId && row.normalisedNumber === invoice.normalisedNumber)
      .map((row) => row.id);
    const checksumMatches = checksum
      ? others
          .filter((row) => row.intakeId && invoicesRepository.findIntake(row.intakeId)?.checksumSha256 === checksum)
          .map((row) => row.id)
      : [];
    const already = new Set([...exact, ...checksumMatches]);
    const similar = others
      .filter((row) => !already.has(row.id) && row.type === invoice.type && row.supplierId === invoice.supplierId)
      .filter((row) => {
        const other = invoicesService.currentRevision(row);
        return other.gross.cents === revision.gross.cents && Math.abs(daysBetween(other.invoiceDate, revision.invoiceDate)) <= 7;
      })
      .map((row) => row.id);
    return { exact, checksum: checksumMatches, similar };
  },

  /** Findings not yet overridden (exact/checksum) or dismissed (similarity). */
  unresolvedDuplicates(invoice: Invoice): readonly { readonly kind: 'exact' | 'checksum' | 'similar'; readonly invoiceId: InvoiceId }[] {
    const findings = invoicesService.duplicateFindings(invoice.id);
    const overridden = invoice.duplicateOverride?.suspectInvoiceId;
    const dismissed = invoice.dismissedSimilarity?.suspectInvoiceId;
    return [
      ...findings.exact.filter((id) => id !== overridden).map((invoiceId) => ({ kind: 'exact' as const, invoiceId })),
      ...findings.checksum.filter((id) => id !== overridden).map((invoiceId) => ({ kind: 'checksum' as const, invoiceId })),
      ...findings.similar.filter((id) => id !== dismissed).map((invoiceId) => ({ kind: 'similar' as const, invoiceId })),
    ];
  },

  assertNoUnresolvedDuplicates(invoice: Invoice): void {
    const unresolved = invoicesService.unresolvedDuplicates(invoice);
    const first = unresolved[0];
    if (!first) return;
    const suspect = invoicesRepository.findInvoice(first.invoiceId);
    throw new ConflictError(
      first.kind === 'similar'
        ? `This looks like ${suspect?.number ?? 'another invoice'} (same supplier and amount within 7 days). Dismiss the warning with a reason to continue.`
        : `This is a possible ${first.kind === 'exact' ? 'exact' : 'same-file'} duplicate of ${suspect?.number ?? 'another invoice'}. An authorised finance user must record an override with a reason.`,
      { unresolved },
    );
  },

  /** INV04 — only a `payment.record` holder may override an exact or checksum duplicate. */
  overrideDuplicate(input: { readonly invoiceId: InvoiceId; readonly suspectInvoiceId: InvoiceId; readonly reason: string; readonly actor: UserId }): Invoice {
    const invoice = invoicesService.requireInvoice(input.invoiceId);
    projectsService.assertMutable(invoice.projectId);
    if (!actorHas(invoice.projectId, input.actor, 'payment.record')) {
      throw new ForbiddenError('Only an authorised finance user may override a duplicate finding.');
    }
    if (!input.reason.trim()) throw new ValidationError('Give a reason for the override.', { fieldErrors: { reason: ['A reason is required.'] } });
    const findings = invoicesService.duplicateFindings(invoice.id);
    if (![...findings.exact, ...findings.checksum].includes(input.suspectInvoiceId)) {
      throw new ValidationError('That invoice is not an exact or same-file duplicate of this one.');
    }
    const updated = invoicesRepository.updateInvoice(invoice.id, {
      duplicateOverride: { by: input.actor, at: now(), reason: input.reason.trim(), suspectInvoiceId: input.suspectInvoiceId },
    });
    if (!updated) throw new NotFoundError('Invoice', invoice.id);
    accessService.record({
      actor: actorName(input.actor),
      summary: `Duplicate override · ${invoice.number}`,
      context: `Linked to ${invoicesRepository.findInvoice(input.suspectInvoiceId)?.number ?? input.suspectInvoiceId} · ${input.reason.trim()}`,
    });
    return updated;
  },

  dismissSimilarity(input: { readonly invoiceId: InvoiceId; readonly suspectInvoiceId: InvoiceId; readonly reason: string; readonly actor: UserId }): Invoice {
    const invoice = invoicesService.requireInvoice(input.invoiceId);
    projectsService.assertMutable(invoice.projectId);
    if (!input.reason.trim()) throw new ValidationError('Give a reason for dismissing the warning.', { fieldErrors: { reason: ['A reason is required.'] } });
    if (!invoicesService.duplicateFindings(invoice.id).similar.includes(input.suspectInvoiceId)) {
      throw new ValidationError('That invoice is not flagged as similar to this one.');
    }
    const updated = invoicesRepository.updateInvoice(invoice.id, {
      dismissedSimilarity: { by: input.actor, at: now(), reason: input.reason.trim(), suspectInvoiceId: input.suspectInvoiceId },
    });
    if (!updated) throw new NotFoundError('Invoice', invoice.id);
    accessService.record({ actor: actorName(input.actor), summary: `Similarity warning dismissed · ${invoice.number}`, context: input.reason.trim() });
    return updated;
  },

  /* -------------------------------------------------------------- approval */

  /** The approval step for a gross value: the highest step whose threshold it reaches (INV09). */
  approvalStepFor(projectId: ProjectId, gross: Money): { readonly index: number; readonly approversRequired: number } {
    const steps = projectsService.policyFor(projectId).approval.steps;
    let index = 0;
    steps.forEach((step, position) => {
      if (step.minimumGross.cents <= gross.cents) index = position;
    });
    return { index, approversRequired: steps[index]?.approversRequired ?? 1 };
  },

  /** Why an actor may not decide, or null when they may (drives the screen's disabled buttons). */
  decisionBlocker(invoice: Invoice, actor: UserId, decision: DecisionKind = 'approved'): string | null {
    const scope = projectsService.scopeFor(actor, invoice.projectId);
    const gross = invoicesService.currentRevision(invoice).gross;
    if (!scope || !scope.permissions.includes('invoice.approve')) return 'You hold no approval authority on this project.';
    if (!projectsService.canApprove(scope, gross)) {
      return `Your approval limit (${scope.approvalLimit ? dollars(scope.approvalLimit) : 'none'}) is below the gross value ${dollars(gross)}.`;
    }
    if (decision === 'approved' && invoice.submittedBy === actor && !projectsService.policyFor(invoice.projectId).approval.allowSelfApproval) {
      return 'You submitted this invoice; another person must approve it.';
    }
    return null;
  },

  /**
   * INV09–INV11 — record a decision. Idempotent: the same actor repeating the
   * same decision on the same revision returns the existing row. Approval
   * needs authority for the gross, a different person from the submitter and,
   * when the policy step asks for two, distinct approvers.
   */
  decide(input: DecideInput): DecideResult {
    const invoice = invoicesService.requireInvoice(input.invoiceId);
    projectsService.assertMutable(invoice.projectId);
    const expectedState: Record<DecisionKind, readonly ReviewState[]> = {
      approved: ['approved', 'awaiting-approval'],
      'on-hold': ['on-hold'],
      rejected: ['rejected'],
    };
    const replay = invoicesRepository
      .listDecisions(invoice.id)
      .find((row) => row.actor === input.actor && row.revisionId === input.revisionId && row.decision === input.decision);
    if (replay && expectedState[input.decision].includes(invoice.reviewState)) {
      return { invoice, decision: replay, newModelRevision: projectsService.require(invoice.projectId).modelRevision, syncState: invoice.syncState };
    }
    if (input.revisionId !== invoice.currentRevisionId) {
      throw new ConflictError('The invoice changed since you opened it. Review the latest revision and decide again.', {
        yourRevisionId: input.revisionId,
        latestRevisionId: invoice.currentRevisionId,
      });
    }
    if (invoice.reviewState !== 'awaiting-approval') {
      throw new ConflictError(`This invoice is ${invoice.reviewState}; only an invoice awaiting approval can be decided.`);
    }
    if (input.decision !== 'approved' && !input.reason?.trim()) {
      throw new ValidationError(`Give a reason to ${input.decision === 'on-hold' ? 'hold' : 'reject'} the invoice.`, { fieldErrors: { reason: ['A reason is required.'] } });
    }
    const blocker = invoicesService.decisionBlocker(invoice, input.actor, input.decision);
    if (blocker) throw new ForbiddenError(blocker);

    const revision = invoicesService.currentRevision(invoice);
    const policy = projectsService.policyFor(invoice.projectId);
    const scope = projectsService.scopeFor(input.actor, invoice.projectId);
    const priorApprovals = invoicesRepository
      .listDecisions(invoice.id)
      .filter((row) => row.revisionId === revision.id && row.decision === 'approved');
    if (input.decision === 'approved') {
      invoicesService.assertNoUnresolvedDuplicates(invoice);
      const issues = blockingIssues(revision);
      if (issues.length > 0) throw new ValidationError(issues[0] ?? 'The invoice is incomplete.', { issues });
      if (priorApprovals.some((row) => row.actor === input.actor)) {
        throw new ForbiddenError('A second approval must come from a different person.');
      }
    }
    if (input.scheduledPaymentDate !== undefined && !ISO_DATE.test(input.scheduledPaymentDate)) {
      throw new ValidationError('Enter the payment date as YYYY-MM-DD.', { fieldErrors: { scheduledPaymentDate: ['Use YYYY-MM-DD.'] } });
    }

    const step = invoicesService.approvalStepFor(invoice.projectId, revision.gross);
    const at = now();
    const decision = invoicesRepository.insertDecision({
      id: asId<'ApprovalDecision'>(`dec-${randomUUID()}`),
      projectId: invoice.projectId,
      recordType: 'invoice',
      recordId: invoice.id,
      revisionId: revision.id,
      stepIndex: input.decision === 'approved' ? priorApprovals.length : step.index,
      actor: input.actor,
      decision: input.decision,
      ...(input.reason?.trim() ? { reason: input.reason.trim() } : {}),
      at,
      authoritySnapshot: { approvalLimit: scope?.approvalLimit ?? null, role: scope?.role ?? 'none', policyVersion: policy.version },
    });

    let updated: Invoice | undefined;
    let newModelRevision = projectsService.require(invoice.projectId).modelRevision;
    if (input.decision === 'approved') {
      if (priorApprovals.length + 1 >= step.approversRequired) {
        invoicesRepository.freezeRevision(revision.id);
        updated = invoicesRepository.updateInvoice(invoice.id, {
          reviewState: 'approved',
          approvedRevisionId: revision.id,
          ...(input.scheduledPaymentDate ? { scheduledPaymentDate: input.scheduledPaymentDate } : {}),
        });
        newModelRevision = projectsService.bumpRevision(invoice.projectId);
        outbox(invoice.projectId, 'invoice.approved', { invoiceId: invoice.id, revisionId: revision.id, gross: dollars(revision.gross), decisionId: decision.id });
        accessService.record({
          actor: actorName(input.actor),
          summary: `Invoice approved · ${invoice.number} · not synced · no accounting connection`,
          context: `gross ${dollars(revision.gross)} · revision ${revision.revisionNumber} frozen · model rev ${newModelRevision}`,
        });
      } else {
        updated = invoice;
        accessService.record({
          actor: actorName(input.actor),
          summary: `Approval recorded · ${invoice.number} · ${priorApprovals.length + 1} of ${step.approversRequired}`,
          context: `gross ${dollars(revision.gross)} · waiting for a distinct second approver`,
        });
      }
    } else if (input.decision === 'on-hold') {
      updated = invoicesRepository.updateInvoice(invoice.id, { reviewState: 'on-hold', holdReason: input.reason?.trim() });
      accessService.record({ actor: actorName(input.actor), summary: `Invoice on hold · ${invoice.number}`, context: input.reason?.trim() ?? '' });
    } else {
      updated = invoicesRepository.updateInvoice(invoice.id, { reviewState: 'rejected', rejectReason: input.reason?.trim() });
      accessService.record({ actor: actorName(input.actor), summary: `Invoice rejected · ${invoice.number}`, context: input.reason?.trim() ?? '' });
    }
    if (!updated) throw new NotFoundError('Invoice', invoice.id);
    return { invoice: updated, decision, newModelRevision, syncState: updated.syncState };
  },

  listApprovalDecisions(invoiceId: InvoiceId): readonly ApprovalDecision[] {
    return invoicesRepository.listDecisions(invoiceId);
  },

  /** INV10 — comments append; they never change a revision. */
  addComment(invoiceId: InvoiceId, text: string, actor: UserId): Invoice {
    const invoice = invoicesService.requireInvoice(invoiceId);
    if (!text.trim()) throw new ValidationError('Write a comment first.', { fieldErrors: { text: ['A comment cannot be empty.'] } });
    const updated = invoicesRepository.updateInvoice(invoice.id, {
      comments: [...invoice.comments, { id: `cmt-${randomUUID()}`, at: now(), by: actor, text: text.trim().slice(0, 2000) }],
    });
    if (!updated) throw new NotFoundError('Invoice', invoice.id);
    return updated;
  },

  awaitingApprovalCount(projectId: ProjectId): number {
    return invoicesRepository.listInvoices(projectId).filter((row) => row.reviewState === 'awaiting-approval').length;
  },

  listOutboxEvents(projectId: ProjectId): readonly OutboxEvent[] {
    return invoicesRepository.listOutbox(projectId);
  },

  /* ---------------------------------------------------- project model reads */

  /** When the approved revision's final approval was recorded. */
  approvedAt(invoice: Invoice): IsoDateTime {
    const revisionId = invoice.approvedRevisionId;
    const approvals = invoicesRepository
      .listDecisions(invoice.id)
      .filter((row) => row.revisionId === revisionId && row.decision === 'approved')
      .map((row) => row.at)
      .sort();
    return approvals[approvals.length - 1] ?? invoicesRepository.findRevision(revisionId ?? asId<'InvoiceRevision'>(''))?.createdAt ?? invoice.createdAt;
  },

  expectedPaymentDate(invoice: Invoice): IsoDate {
    const revision = invoicesService.approvedRevision(invoice) ?? invoicesService.currentRevision(invoice);
    return invoice.scheduledPaymentDate ?? revision.dueDate;
  },

  /** ★ Approved revisions only; credit notes carry sign −1 with positive magnitudes (CAL03). */
  approvedAllocationsByLine(projectId: ProjectId): ReadonlyMap<CostLineId, readonly ApprovedAllocationView[]> {
    const result = new Map<CostLineId, ApprovedAllocationView[]>();
    for (const invoice of invoicesRepository.listInvoices(projectId)) {
      const revision = invoicesService.approvedRevision(invoice);
      if (!revision) continue;
      const approvedAt = invoicesService.approvedAt(invoice);
      const expected = invoicesService.expectedPaymentDate(invoice);
      const name = supplierName(invoice.supplierId);
      for (const allocation of revision.allocations) {
        const gross = allocationGross(allocation);
        const recoverable = recoverableTax(allocation.tax.cents, allocation.recoverablePpm);
        const view: ApprovedAllocationView = {
          invoiceId: invoice.id,
          revisionId: revision.id,
          supplierName: name,
          number: invoice.number,
          type: invoice.type,
          sign: signOf(invoice),
          commitmentId: allocation.commitmentId ?? null,
          allowanceTreatment: allocation.commitmentId ? null : (allocation.allowanceTreatment ?? null),
          net: allocation.net,
          tax: allocation.tax,
          gross: money(gross),
          recoverableTax: money(recoverable),
          economic: money(gross - recoverable),
          expectedPaymentDate: expected,
          approvedAt,
        };
        const list = result.get(allocation.costLineId) ?? [];
        list.push(view);
        result.set(allocation.costLineId, list);
      }
    }
    return result;
  },

  /* ------------------------------------------------------------ settlement */

  settlementsByInvoice(invoiceId: InvoiceId): readonly SettlementAllocation[] {
    const invoice = invoicesService.requireInvoice(invoiceId);
    return invoice.type === 'credit-note'
      ? [...invoicesRepository.settlementsFromCreditNote(invoiceId), ...invoicesRepository.settlementsForInvoice(invoiceId)]
      : invoicesRepository.settlementsForInvoice(invoiceId);
  },

  /** ★ INV13 — derived on read; paid means the balance is within one cent, never a stored badge. */
  settlementSummary(invoiceId: InvoiceId): SettlementSummary {
    const invoice = invoicesService.requireInvoice(invoiceId);
    const revision = invoicesService.approvedRevision(invoice) ?? invoicesService.currentRevision(invoice);
    const gross = revision.gross.cents;
    const zero = money(0);
    if (invoice.type === 'credit-note') {
      const applied = invoicesRepository.settlementsFromCreditNote(invoice.id).reduce((sum, row) => sum + row.amount.cents, 0);
      const unapplied = gross - applied;
      return {
        gross: revision.gross,
        paidCash: zero,
        appliedCredits: money(applied),
        withholding: zero,
        otherNonCash: zero,
        refunds: zero,
        retentionHeld: zero,
        unpaidBalance: money(unapplied),
        state: !invoice.approvedRevisionId ? 'unpaid' : Math.abs(unapplied) <= 1 ? 'paid' : 'credit-due',
      };
    }
    const rows = invoicesRepository.settlementsForInvoice(invoice.id);
    const total = (types: readonly SettlementType[]): number =>
      rows.filter((row) => types.includes(row.settlementType)).reduce((sum, row) => sum + row.amount.cents, 0);
    const paidCash = total(['cash', 'retention-release']);
    const credits = total(['credit']);
    const withholding = total(['withholding']);
    const other = total(['other-noncash']);
    const refunds = total(['refund']);
    const retentionHeld = invoicesRepository
      .retentionForInvoice(invoice.id)
      .filter((row) => !row.actualReleaseAt)
      .reduce((sum, row) => sum + row.amount.cents, 0);
    const settled = paidCash - refunds + credits + withholding + other;
    const unpaid = gross - settled;
    let state: SettlementSummary['state'] = 'unpaid';
    if (invoice.approvedRevisionId) {
      if (unpaid < -1) state = 'credit-due';
      else if (Math.abs(unpaid) <= 1) {
        const paymentRows = rows.filter((row) => row.paymentId);
        const allImported =
          paymentRows.length > 0 && paymentRows.every((row) => invoicesRepository.findPayment(row.paymentId as PaymentId)?.origin === 'import');
        state = allImported ? 'reconciled' : 'paid';
      } else if (settled > 0) state = 'part-paid';
    }
    return {
      gross: revision.gross,
      paidCash: money(paidCash),
      appliedCredits: money(credits),
      withholding: money(withholding),
      otherNonCash: money(other),
      refunds: money(refunds),
      retentionHeld: money(retentionHeld),
      unpaidBalance: money(unpaid),
      state,
    };
  },

  /**
   * ★ Settled cash (net of refunds) and non-cash settlements per line, each
   * apportioned over the invoice's approved allocations by gross. Applied
   * credit notes are excluded: the credit note already reduces approved cost.
   */
  settledCashByLine(
    projectId: ProjectId,
    through?: IsoDate,
  ): ReadonlyMap<CostLineId, readonly { readonly invoiceId: InvoiceId; readonly effectiveDate: IsoDate; readonly cash: Money; readonly nonCash: Money }[]> {
    const result = new Map<CostLineId, { invoiceId: InvoiceId; effectiveDate: IsoDate; cash: Money; nonCash: Money }[]>();
    for (const settlement of invoicesRepository.listSettlements(projectId)) {
      if (settlement.settlementType === 'credit') continue;
      if (through && settlement.effectiveDate > through) continue;
      const invoice = invoicesRepository.findInvoice(settlement.invoiceId);
      if (!invoice) continue;
      const revision = invoicesService.approvedRevision(invoice);
      if (!revision || revision.allocations.length === 0) continue;
      const cash =
        settlement.settlementType === 'cash' || settlement.settlementType === 'retention-release'
          ? settlement.amount.cents
          : settlement.settlementType === 'refund'
            ? -settlement.amount.cents
            : 0;
      const nonCash = settlement.settlementType === 'withholding' || settlement.settlementType === 'other-noncash' ? settlement.amount.cents : 0;
      const cashParts = apportion(cash, revision.allocations);
      const nonCashParts = apportion(nonCash, revision.allocations);
      const perLine = new Map<CostLineId, { cash: number; nonCash: number }>();
      revision.allocations.forEach((allocation, index) => {
        const entry = perLine.get(allocation.costLineId) ?? { cash: 0, nonCash: 0 };
        entry.cash += cashParts[index] ?? 0;
        entry.nonCash += nonCashParts[index] ?? 0;
        perLine.set(allocation.costLineId, entry);
      });
      for (const [costLineId, entry] of perLine) {
        const list = result.get(costLineId) ?? [];
        list.push({ invoiceId: invoice.id, effectiveDate: settlement.effectiveDate, cash: money(entry.cash), nonCash: money(entry.nonCash) });
        result.set(costLineId, list);
      }
    }
    return result;
  },

  /**
   * ★ The unpaid balance of each approved invoice per line, with its retention
   * share. Unapplied credit notes appear as negative rows.
   */
  approvedUnpaidByLine(projectId: ProjectId): ReadonlyMap<
    CostLineId,
    readonly {
      readonly invoiceId: InvoiceId;
      readonly expectedPaymentDate: IsoDate;
      readonly gross: Money;
      readonly economic: Money;
      readonly retention: Money;
      readonly retentionForecastReleaseDate?: IsoDate;
    }[]
  > {
    const result = new Map<CostLineId, { invoiceId: InvoiceId; expectedPaymentDate: IsoDate; gross: Money; economic: Money; retention: Money; retentionForecastReleaseDate?: IsoDate }[]>();
    for (const invoice of invoicesRepository.listInvoices(projectId)) {
      const revision = invoicesService.approvedRevision(invoice);
      if (!revision || revision.allocations.length === 0) continue;
      const summary = invoicesService.settlementSummary(invoice.id);
      const unpaid = summary.unpaidBalance.cents * signOf(invoice);
      if (Math.abs(unpaid) <= 1 || (invoice.type === 'invoice' && unpaid < 0)) continue;
      const totalGross = revision.allocations.reduce((sum, row) => sum + allocationGross(row), 0);
      const totalEconomic = revision.allocations.reduce((sum, row) => sum + allocationGross(row) - recoverableTax(row.tax.cents, row.recoverablePpm), 0);
      const unpaidEconomic = totalGross === 0 ? 0 : mulDivCents(unpaid, totalEconomic, totalGross);
      const grossParts = apportion(unpaid, revision.allocations);
      const economicParts = apportion(unpaidEconomic, revision.allocations);
      const retentionParts = apportion(summary.retentionHeld.cents, revision.allocations);
      const pending = invoicesRepository.retentionForInvoice(invoice.id).filter((row) => !row.actualReleaseAt).map((row) => row.forecastReleaseDate).sort();
      const perLine = new Map<CostLineId, { gross: number; economic: number; retention: number }>();
      revision.allocations.forEach((allocation, index) => {
        const entry = perLine.get(allocation.costLineId) ?? { gross: 0, economic: 0, retention: 0 };
        entry.gross += grossParts[index] ?? 0;
        entry.economic += economicParts[index] ?? 0;
        entry.retention += retentionParts[index] ?? 0;
        perLine.set(allocation.costLineId, entry);
      });
      for (const [costLineId, entry] of perLine) {
        const list = result.get(costLineId) ?? [];
        list.push({
          invoiceId: invoice.id,
          expectedPaymentDate: invoicesService.expectedPaymentDate(invoice),
          gross: money(entry.gross),
          economic: money(entry.economic),
          retention: money(entry.retention),
          ...(pending[0] ? { retentionForecastReleaseDate: pending[0] } : {}),
        });
        result.set(costLineId, list);
      }
    }
    return result;
  },

  /** ★ CST05 — the contract position on one gross basis. */
  contractPosition(commitmentId: CommitmentId): ContractPosition {
    const commitment = commitmentsService.requireCommitment(commitmentId);
    const contractTotal = grossFromNet(commitmentsService.revisedValue(commitmentId).cents, commitment.taxTreatment, taxSettings(commitment.projectId));
    let invoiced = 0;
    let paid = 0;
    for (const invoice of invoicesRepository.listInvoices(commitment.projectId)) {
      const revision = invoicesService.approvedRevision(invoice);
      if (!revision) continue;
      const mine = revision.allocations.map((row) => row.commitmentId === commitmentId);
      if (!mine.some(Boolean)) continue;
      invoiced += signOf(invoice) * revision.allocations.reduce((sum, row, index) => sum + (mine[index] ? allocationGross(row) : 0), 0);
      if (invoice.type !== 'invoice') continue;
      const summary = invoicesService.settlementSummary(invoice.id);
      const settled = summary.paidCash.cents - summary.refunds.cents + summary.withholding.cents + summary.otherNonCash.cents;
      const parts = apportion(settled, revision.allocations);
      paid += parts.reduce((sum, part, index) => sum + (mine[index] ? part : 0), 0);
    }
    const approvedUnpaid = invoiced - paid;
    const uninvoiced = Math.max(contractTotal - invoiced, 0);
    return {
      contractTotal: money(contractTotal),
      invoicedToDate: money(invoiced),
      paidToDate: money(paid),
      approvedUnpaid: money(approvedUnpaid),
      uninvoicedBalance: money(uninvoiced),
      remainingEstimate: money(approvedUnpaid + uninvoiced),
    };
  },

  /* -------------------------------------------------------------- payments */

  listPayments(projectId: ProjectId): readonly Payment[] {
    return invoicesRepository.listPayments(projectId);
  },

  requirePayment(id: PaymentId): Payment {
    const payment = invoicesRepository.findPayment(id);
    if (!payment) throw new NotFoundError('Payment', id);
    return payment;
  },

  /** What of a payment has not yet been allocated to an invoice. */
  unappliedAmount(paymentId: PaymentId): Money {
    const payment = invoicesService.requirePayment(paymentId);
    const applied = invoicesRepository.settlementsForPayment(paymentId).reduce((sum, row) => sum + row.amount.cents, 0);
    return money(payment.amount.cents - applied);
  },

  /**
   * INV13/CF06 — manual payment evidence. A manual actual dated in a locked
   * period is refused: corrections there are controlled adjustments made
   * through `reversePayment` (AT23). An unallocated remainder waits in the
   * reconciliation queue.
   */
  recordPayment(input: RecordPaymentInput): Payment {
    projectsService.assertMutable(input.projectId);
    if (!ISO_DATE.test(input.effectiveDate)) throw new ValidationError('Enter the payment date as YYYY-MM-DD.', { fieldErrors: { effectiveDate: ['Use YYYY-MM-DD.'] } });
    if (projectsService.isPeriodLocked(input.projectId, input.effectiveDate)) {
      throw new ConflictError(
        `Payments dated on or before ${projectsService.policyFor(input.projectId).actualsCutoff} fall in a closed period. Import them, or record a reversal dated in an open period.`,
      );
    }
    const payment = createPayment({ ...input, origin: 'manual' });
    for (const allocation of input.allocations ?? []) {
      applySettlement({ paymentId: payment.id, invoiceId: allocation.invoiceId, amount: allocation.amount, settlementType: allocation.settlementType, actor: input.actor });
    }
    openItemIfUnapplied(payment);
    outbox(input.projectId, 'payment.recorded', { paymentId: payment.id, amount: dollars(payment.amount), direction: payment.direction });
    projectsService.bumpRevision(input.projectId);
    accessService.record({
      actor: actorName(input.actor),
      summary: `Payment recorded · ${payment.reference}`,
      context: `${payment.direction} ${dollars(payment.amount)} · ${payment.effectiveDate} · ${(input.allocations ?? []).length} allocation(s)`,
    });
    return payment;
  },

  /**
   * AT23 — a controlled adjustment: a new, opposite payment dated in an open
   * period that names the original, with refund allocations against the same
   * invoices. The original and its history are untouched.
   */
  reversePayment(input: { readonly paymentId: PaymentId; readonly actor: UserId; readonly reason: string; readonly effectiveDate?: IsoDate }): Payment {
    const original = invoicesService.requirePayment(input.paymentId);
    projectsService.assertMutable(original.projectId);
    if (!input.reason.trim()) throw new ValidationError('Give a reason for the reversal.', { fieldErrors: { reason: ['A reason is required.'] } });
    if (original.reversesPaymentId) throw new ConflictError('A reversal cannot itself be reversed; record a new payment instead.');
    if (invoicesRepository.listPayments(original.projectId).some((row) => row.reversesPaymentId === original.id)) {
      throw new ConflictError('This payment has already been reversed.');
    }
    const effectiveDate = input.effectiveDate ?? today();
    if (projectsService.isPeriodLocked(original.projectId, effectiveDate)) {
      throw new ConflictError('Date the reversal in an open period; the closed period stays as recorded.');
    }
    const reversal = createPayment({
      projectId: original.projectId,
      amount: original.amount,
      direction: original.direction === 'outflow' ? 'inflow' : 'outflow',
      effectiveDate,
      reference: `Reversal of ${original.reference}`,
      ...(original.supplierId ? { supplierId: original.supplierId } : {}),
      note: input.reason.trim(),
      reversesPaymentId: original.id,
      origin: 'manual',
      actor: input.actor,
    });
    for (const settlement of invoicesRepository.settlementsForPayment(original.id)) {
      if (settlement.settlementType !== 'cash' && settlement.settlementType !== 'retention-release') continue;
      invoicesRepository.insertSettlement({
        id: asId<'SettlementAllocation'>(`set-${randomUUID()}`),
        projectId: original.projectId,
        paymentId: reversal.id,
        invoiceId: settlement.invoiceId,
        amount: settlement.amount,
        settlementType: 'refund',
        effectiveDate,
        createdAt: now(),
        createdBy: input.actor,
      });
    }
    const item = invoicesRepository.openItemForPayment(original.id);
    if (item) {
      invoicesRepository.updateReconciliationItem(item.id, { state: 'excluded', resolvedBy: input.actor, resolvedAt: now(), reason: `Payment reversed · ${input.reason.trim()}` });
    }
    outbox(original.projectId, 'payment.recorded', { paymentId: reversal.id, reversesPaymentId: original.id, amount: dollars(reversal.amount) });
    projectsService.bumpRevision(original.projectId);
    accessService.record({
      actor: actorName(input.actor),
      summary: `Payment reversed · ${original.reference}`,
      context: `Controlled adjustment dated ${effectiveDate} · original ${original.effectiveDate} unchanged · ${input.reason.trim()}`,
    });
    return reversal;
  },

  /** CAL06/CAL07/INV13 — apply a payment, a credit note or a non-cash settlement to an approved invoice. */
  allocateSettlement(input: AllocateSettlementInput): SettlementAllocation {
    const invoice = invoicesService.requireInvoice(input.invoiceId);
    projectsService.assertMutable(invoice.projectId);
    const allocation = applySettlement(input);
    projectsService.bumpRevision(invoice.projectId);
    accessService.record({
      actor: actorName(input.actor),
      summary: `Settlement allocated · ${invoice.number}`,
      context: `${allocation.settlementType} ${dollars(allocation.amount)} · ${allocation.effectiveDate}`,
    });
    return allocation;
  },

  /* ------------------------------------------------------------- retention */

  /** Retention for one invoice when given an invoice id, otherwise for the project. */
  listRetention(target: ProjectId | InvoiceId): readonly RetentionTranche[] {
    const invoice = invoicesRepository.findInvoice(target as InvoiceId);
    return invoice ? invoicesRepository.retentionForInvoice(invoice.id) : invoicesRepository.listRetention(target as ProjectId);
  },

  /** CST07 — a fixed tranche of an approved invoice; it never reduces recognised cost. */
  addRetention(input: { readonly invoiceId: InvoiceId; readonly amount: Money; readonly releaseCondition: string; readonly forecastReleaseDate: IsoDate; readonly actor: UserId }): RetentionTranche {
    const invoice = invoicesService.requireInvoice(input.invoiceId);
    projectsService.assertMutable(invoice.projectId);
    const revision = invoicesService.approvedRevision(invoice);
    if (!revision || invoice.type !== 'invoice') throw new ConflictError('Retention is recorded against an approved invoice.');
    if (input.amount.cents <= 0) throw new ValidationError('Enter a retention amount greater than zero.', { fieldErrors: { amount: ['Retention is a fixed amount.'] } });
    const existing = invoicesRepository.retentionForInvoice(invoice.id).reduce((sum, row) => sum + row.amount.cents, 0);
    if (existing + input.amount.cents > revision.gross.cents) {
      throw new ValidationError('Retention cannot exceed the invoice gross.', { fieldErrors: { amount: [`At most ${dollars(money(revision.gross.cents - existing))} can still be retained.`] } });
    }
    if (!input.releaseCondition.trim()) throw new ValidationError('Record the release condition.', { fieldErrors: { releaseCondition: ['e.g. Practical completion.'] } });
    if (!ISO_DATE.test(input.forecastReleaseDate)) throw new ValidationError('Enter the forecast release date as YYYY-MM-DD.', { fieldErrors: { forecastReleaseDate: ['Use YYYY-MM-DD.'] } });
    const tranche = invoicesRepository.insertRetention({
      id: asId<'RetentionTranche'>(`ret-${randomUUID()}`),
      projectId: invoice.projectId,
      invoiceId: invoice.id,
      amount: input.amount,
      releaseCondition: input.releaseCondition.trim(),
      forecastReleaseDate: input.forecastReleaseDate,
    });
    projectsService.bumpRevision(invoice.projectId);
    accessService.record({
      actor: actorName(input.actor),
      summary: `Retention recorded · ${invoice.number}`,
      context: `${dollars(input.amount)} · ${tranche.releaseCondition} · forecast ${tranche.forecastReleaseDate}`,
    });
    return tranche;
  },

  releaseRetention(input: { readonly trancheId: RetentionTrancheId; readonly paymentId: PaymentId; readonly actor: UserId }): RetentionTranche {
    const tranche = invoicesRepository.findRetention(input.trancheId);
    if (!tranche) throw new NotFoundError('Retention tranche', input.trancheId);
    projectsService.assertMutable(tranche.projectId);
    if (tranche.actualReleaseAt) throw new ConflictError('This retention has already been released.');
    const settlement = applySettlement({ paymentId: input.paymentId, invoiceId: tranche.invoiceId, amount: tranche.amount, settlementType: 'retention-release', actor: input.actor });
    const updated = invoicesRepository.updateRetention(tranche.id, { actualReleaseAt: now(), releasedBySettlementId: settlement.id });
    if (!updated) throw new NotFoundError('Retention tranche', tranche.id);
    projectsService.bumpRevision(tranche.projectId);
    accessService.record({ actor: actorName(input.actor), summary: 'Retention released', context: `${dollars(tranche.amount)} · ${tranche.releaseCondition}` });
    return updated;
  },

  /* ----------------------------------------------------------------- import */

  listImports(projectId: ProjectId): readonly PaymentImport[] {
    return invoicesRepository.listImports(projectId);
  },

  /** INT07 — parse and validate a payment CSV without creating anything. */
  dryRunPaymentImport(input: { readonly projectId: ProjectId; readonly csvText: string; readonly filename?: string; readonly actor: UserId }): PaymentImport {
    projectsService.assertMutable(input.projectId);
    const [header, ...records] = splitCsv(input.csvText);
    if (!header) throw new ValidationError('Paste or upload a payment CSV.', { fieldErrors: { csvText: ['The file is empty.'] } });
    const columns = header.fields.map((name) => name.trim().toLowerCase().replace(/[^a-z]/g, ''));
    const missing = ['date', 'amount', 'reference', 'sourceid'].filter((name) => !columns.includes(name));
    if (missing.length > 0) {
      throw new ValidationError('The first line must be the header: Date, Amount, Reference, SourceId, Supplier (optional).', {
        fieldErrors: { csvText: [`Missing column${missing.length === 1 ? '' : 's'}: ${missing.join(', ')}.`] },
      });
    }
    if (records.length === 0) throw new ValidationError('The file has a header but no rows.', { fieldErrors: { csvText: ['Add at least one payment row.'] } });
    if (records.length > 2_000) throw new ValidationError('An import can have at most 2,000 rows.', { fieldErrors: { csvText: ['Split the file by month.'] } });
    const at = (name: string): number => columns.indexOf(name);
    const existing = new Set(invoicesRepository.listPayments(input.projectId).map((row) => row.sourceId).filter(Boolean));
    const seen = new Set<string>();
    const rows: PaymentImportRow[] = records.map(({ line, fields }) => {
      const read = (name: string): string => (at(name) >= 0 ? (fields[at(name)] ?? '').trim() : '');
      const sourceId = read('sourceid');
      const date = parseStatementDate(read('date'));
      const parsed = parseStatementAmount(read('amount'));
      const reference = read('reference');
      const supplier = read('supplier');
      const currency = read('currency').toUpperCase();
      const base = {
        line,
        sourceId,
        effectiveDate: date ?? '',
        amount: parsed ? money(Math.abs(parsed.cents)) : money(0),
        reference,
        ...(supplier ? { supplierName: supplier } : {}),
      };
      const problem = !sourceId
        ? 'SourceId is blank.'
        : !date
          ? `"${read('date')}" is not a date.`
          : !parsed || parsed.cents === 0
            ? `"${read('amount')}" is not a non-zero amount.`
            : currency && currency !== 'AUD'
              ? `Currency ${currency} is not AUD.`
              : !reference
                ? 'Reference is blank.'
                : null;
      if (problem) return { ...base, status: 'invalid' as const, problem };
      if (existing.has(sourceId) || seen.has(sourceId)) {
        seen.add(sourceId);
        return { ...base, status: 'duplicate' as const, problem: existing.has(sourceId) ? 'Already imported.' : 'Repeated in this file.' };
      }
      seen.add(sourceId);
      return { ...base, status: 'new' as const };
    });
    const fresh = rows.filter((row) => row.status === 'new');
    const created = invoicesRepository.insertImport({
      id: asId<'PaymentImport'>(`pimp-${randomUUID()}`),
      projectId: input.projectId,
      ...(input.filename ? { filename: input.filename } : {}),
      state: 'dry-run',
      rows,
      totals: {
        rows: rows.length,
        new: fresh.length,
        duplicates: rows.filter((row) => row.status === 'duplicate').length,
        invalid: rows.filter((row) => row.status === 'invalid').length,
        amount: sumMoney(fresh.map((row) => row.amount)),
      },
      createdAt: now(),
      createdBy: input.actor,
    });
    accessService.record({
      actor: actorName(input.actor),
      summary: `Payment import dry run · ${input.filename ?? 'pasted CSV'}`,
      context: `${created.totals.rows} rows · ${created.totals.new} new · ${created.totals.duplicates} duplicate · ${created.totals.invalid} invalid`,
    });
    return created;
  },

  /**
   * INT07 — confirm a dry run. Idempotent: a confirmed import returns its
   * recorded result and creates nothing more. Each new row auto-matches when
   * its reference is an approved invoice number of the same supplier and the
   * amount is within one cent of the gross; otherwise it waits in the queue.
   */
  confirmPaymentImport(input: { readonly importId: PaymentImportId; readonly actor: UserId }): ImportConfirmation {
    const record = invoicesRepository.findImport(input.importId);
    if (!record) throw new NotFoundError('Payment import', input.importId);
    if (record.state === 'confirmed') {
      const ids = new Set<string>(record.result?.paymentIds ?? []);
      return {
        payments: invoicesRepository.listPayments(record.projectId).filter((row) => ids.has(row.id)),
        matched: record.result?.matched ?? 0,
        unmatched: record.result?.unmatched ?? 0,
      };
    }
    if (record.state !== 'dry-run') throw new ConflictError('This import was rejected and cannot be confirmed.');
    projectsService.assertMutable(record.projectId);
    const existing = new Set(invoicesRepository.listPayments(record.projectId).map((row) => row.sourceId).filter(Boolean));
    const suppliers = commitmentsService.listSuppliers(record.projectId);
    const payments: Payment[] = [];
    let matched = 0;
    let unmatched = 0;
    for (const row of record.rows) {
      if (row.status !== 'new' || existing.has(row.sourceId)) continue;
      const supplier = row.supplierName ? suppliers.find((candidate) => candidate.name.toLowerCase() === row.supplierName?.toLowerCase()) : undefined;
      const payment = createPayment({
        projectId: record.projectId,
        amount: row.amount,
        direction: 'outflow',
        effectiveDate: row.effectiveDate,
        reference: row.reference,
        ...(supplier ? { supplierId: supplier.id } : {}),
        sourceId: row.sourceId,
        origin: 'import',
        importId: record.id,
        actor: input.actor,
      });
      existing.add(row.sourceId);
      payments.push(payment);
      const target = invoicesRepository.listInvoices(record.projectId).find((invoice) => {
        if (invoice.type !== 'invoice' || invoice.normalisedNumber !== normaliseInvoiceNumber(row.reference)) return false;
        if (supplier && invoice.supplierId !== supplier.id) return false;
        const revision = invoicesService.approvedRevision(invoice);
        if (!revision || Math.abs(revision.gross.cents - row.amount.cents) > 1) return false;
        return invoicesService.settlementSummary(invoice.id).unpaidBalance.cents >= row.amount.cents - 1;
      });
      if (target) {
        applySettlement({ paymentId: payment.id, invoiceId: target.id, amount: row.amount, settlementType: 'cash', actor: input.actor });
        matched += 1;
      } else {
        openItemIfUnapplied(payment);
        unmatched += 1;
      }
    }
    invoicesRepository.updateImport(record.id, {
      state: 'confirmed',
      confirmedAt: now(),
      result: { paymentIds: payments.map((row) => row.id), matched, unmatched },
    });
    if (payments.length > 0) {
      outbox(record.projectId, 'payment.recorded', { importId: record.id, payments: payments.length });
      projectsService.bumpRevision(record.projectId);
    }
    accessService.record({
      actor: actorName(input.actor),
      summary: `Payment import confirmed · ${record.filename ?? 'pasted CSV'}`,
      context: `${payments.length} payments · ${matched} matched · ${unmatched} to reconcile`,
    });
    return { payments, matched, unmatched };
  },

  /* --------------------------------------------------------- reconciliation */

  listReconciliationItems(projectId: ProjectId): readonly ReconciliationItem[] {
    return invoicesRepository.listReconciliationItems(projectId);
  },

  requireReconciliationItem(id: ReconciliationItemId): ReconciliationItem {
    const item = invoicesRepository.findReconciliationItem(id);
    if (!item) throw new NotFoundError('Reconciliation item', id);
    return item;
  },

  /** ★ INV15 — open unmatched payments, at their still-unallocated amount (the suspense contribution). */
  unmatchedPayments(projectId: ProjectId): readonly { readonly paymentId: PaymentId; readonly effectiveDate: IsoDate; readonly amount: Money; readonly reference: string }[] {
    return invoicesRepository
      .listReconciliationItems(projectId)
      .filter((item) => item.state === 'open' && item.kind === 'unmatched-payment' && item.paymentId)
      .flatMap((item) => {
        const payment = invoicesRepository.findPayment(item.paymentId as PaymentId);
        if (!payment) return [];
        const unapplied = invoicesService.unappliedAmount(payment.id);
        if (unapplied.cents <= 0) return [];
        return [{ paymentId: payment.id, effectiveDate: payment.effectiveDate, amount: unapplied, reference: payment.reference }];
      });
  },

  /** INV14 — an invoice approved in the accounting system arrives as an external bill to be linked. */
  recordExternalBill(input: { readonly projectId: ProjectId; readonly reference: string; readonly amount: Money; readonly effectiveDate: IsoDate; readonly actor: UserId }): ReconciliationItem {
    projectsService.assertMutable(input.projectId);
    if (!input.reference.trim()) throw new ValidationError('Enter the external reference.');
    const item = invoicesRepository.insertReconciliationItem({
      id: asId<'ReconciliationItem'>(`rec-${randomUUID()}`),
      projectId: input.projectId,
      kind: 'external-bill',
      externalReference: input.reference.trim(),
      amount: input.amount,
      effectiveDate: input.effectiveDate,
      state: 'open',
    });
    accessService.record({ actor: actorName(input.actor), summary: `External bill queued · ${item.externalReference}`, context: dollars(input.amount) });
    return item;
  },

  /**
   * INV15 — match (or split, by matching part) an open item. A payment item
   * becomes a cash settlement and leaves suspense in the same step; an
   * external bill records the external authorisation on the invoice.
   */
  matchReconciliationItem(input: { readonly itemId: ReconciliationItemId; readonly invoiceId: InvoiceId; readonly amount: Money; readonly actor: UserId }): ReconciliationItem {
    const item = invoicesService.requireReconciliationItem(input.itemId);
    projectsService.assertMutable(item.projectId);
    if (item.state !== 'open') throw new ConflictError(`This item is already ${item.state}.`);
    const invoice = invoicesService.requireInvoice(input.invoiceId);
    if (invoice.projectId !== item.projectId) throw new NotFoundError('Invoice', input.invoiceId);
    if (item.kind === 'external-bill') {
      invoicesRepository.updateInvoice(invoice.id, { externalAuthorisation: { source: 'accounting-import', reference: item.externalReference ?? '', at: now() } });
      invoicesRepository.updateReconciliationItem(item.id, { state: 'matched', resolvedBy: input.actor, resolvedAt: now() });
    } else {
      const payment = invoicesService.requirePayment(item.paymentId as PaymentId);
      applySettlement({
        paymentId: payment.id,
        invoiceId: invoice.id,
        amount: input.amount,
        settlementType: payment.direction === 'inflow' ? 'refund' : 'cash',
        actor: input.actor,
      });
    }
    projectsService.bumpRevision(item.projectId);
    accessService.record({
      actor: actorName(input.actor),
      summary: `Reconciliation item matched · ${invoice.number}`,
      context: item.kind === 'external-bill' ? `External bill ${item.externalReference}` : `${dollars(input.amount)} of ${dollars(item.amount)}`,
    });
    return invoicesService.requireReconciliationItem(item.id);
  },

  excludeReconciliationItem(input: { readonly itemId: ReconciliationItemId; readonly reason: string; readonly actor: UserId }): ReconciliationItem {
    const item = invoicesService.requireReconciliationItem(input.itemId);
    projectsService.assertMutable(item.projectId);
    if (item.state !== 'open') throw new ConflictError(`This item is already ${item.state}.`);
    if (!input.reason.trim()) throw new ValidationError('Give a reason for excluding the item.', { fieldErrors: { reason: ['A reason is required.'] } });
    const updated = invoicesRepository.updateReconciliationItem(item.id, { state: 'excluded', resolvedBy: input.actor, resolvedAt: now(), reason: input.reason.trim() });
    if (!updated) throw new NotFoundError('Reconciliation item', item.id);
    projectsService.bumpRevision(item.projectId);
    accessService.record({ actor: actorName(input.actor), summary: 'Reconciliation item excluded', context: `${dollars(item.amount)} · ${input.reason.trim()}` });
    return updated;
  },
};

/* ------------------------------------------------------ internal ledger ops */

function createPayment(input: {
  readonly projectId: ProjectId;
  readonly amount: Money;
  readonly direction: Payment['direction'];
  readonly effectiveDate: IsoDate;
  readonly reference: string;
  readonly supplierId?: SupplierId;
  readonly sourceId?: string;
  readonly note?: string;
  readonly reversesPaymentId?: PaymentId;
  readonly origin: Payment['origin'];
  readonly importId?: PaymentImportId;
  readonly actor: UserId;
}): Payment {
  if (input.amount.cents <= 0) throw new ValidationError('A payment must be greater than zero.', { fieldErrors: { amount: ['Enter a positive amount; the direction carries the sign.'] } });
  if (!ISO_DATE.test(input.effectiveDate)) throw new ValidationError('Enter the payment date as YYYY-MM-DD.', { fieldErrors: { effectiveDate: ['Use YYYY-MM-DD.'] } });
  if (!input.reference.trim()) throw new ValidationError('Enter a payment reference.', { fieldErrors: { reference: ['A reference is required.'] } });
  if (input.sourceId && invoicesRepository.listPayments(input.projectId).some((row) => row.sourceId === input.sourceId)) {
    throw new ConflictError(`A payment with source id ${input.sourceId} already exists.`);
  }
  if (input.supplierId) commitmentsService.requireSupplier(input.supplierId);
  return invoicesRepository.insertPayment({
    id: asId<'Payment'>(`pay-${randomUUID()}`),
    projectId: input.projectId,
    ...(input.sourceId ? { sourceId: input.sourceId } : {}),
    effectiveDate: input.effectiveDate,
    amount: input.amount,
    direction: input.direction,
    origin: input.origin,
    ...(input.importId ? { importId: input.importId } : {}),
    reference: input.reference.trim(),
    ...(input.supplierId ? { supplierId: input.supplierId } : {}),
    ...(input.note?.trim() ? { note: input.note.trim() } : {}),
    ...(input.reversesPaymentId ? { reversesPaymentId: input.reversesPaymentId } : {}),
    createdAt: now(),
    createdBy: input.actor,
  });
}

function openItemIfUnapplied(payment: Payment): void {
  const unapplied = invoicesService.unappliedAmount(payment.id);
  if (unapplied.cents <= 0 || invoicesRepository.openItemForPayment(payment.id)) return;
  invoicesRepository.insertReconciliationItem({
    id: asId<'ReconciliationItem'>(`rec-${randomUUID()}`),
    projectId: payment.projectId,
    kind: 'unmatched-payment',
    paymentId: payment.id,
    amount: unapplied,
    effectiveDate: payment.effectiveDate,
    state: 'open',
  });
}

/** The ledger write shared by every settlement path. No revision bump, no audit: callers own those. */
function applySettlement(input: AllocateSettlementInput): SettlementAllocation {
  const invoice = invoicesService.requireInvoice(input.invoiceId);
  if (invoice.type !== 'invoice') throw new ValidationError('Settlements are applied to invoices; a credit note is the source of a credit.');
  if (!invoicesService.approvedRevision(invoice)) throw new ConflictError(`${invoice.number} is not approved; only approved invoices are settled.`);
  if (input.amount.cents <= 0) throw new ValidationError('Enter an amount greater than zero.', { fieldErrors: { amount: ['A settlement is a positive amount.'] } });
  let effectiveDate = input.effectiveDate ?? today();

  if (input.paymentId) {
    const payment = invoicesService.requirePayment(input.paymentId);
    if (payment.projectId !== invoice.projectId) throw new NotFoundError('Payment', input.paymentId);
    const allowed: readonly SettlementType[] = payment.direction === 'outflow' ? ['cash', 'retention-release'] : ['refund'];
    if (!allowed.includes(input.settlementType)) {
      throw new ValidationError(`A${payment.direction === 'outflow' ? 'n outgoing' : 'n incoming'} payment settles as ${allowed.join(' or ')}.`, {
        fieldErrors: { settlementType: [`Choose ${allowed.join(' or ')}.`] },
      });
    }
    const unapplied = invoicesService.unappliedAmount(payment.id);
    if (input.amount.cents > unapplied.cents) {
      throw new ValidationError(`Only ${dollars(unapplied)} of this payment is unallocated.`, { fieldErrors: { amount: [`At most ${dollars(unapplied)}.`] } });
    }
    effectiveDate = payment.effectiveDate;
  } else if (input.creditNoteInvoiceId) {
    if (input.settlementType !== 'credit') throw new ValidationError('A credit note settles as a credit.');
    const credit = invoicesService.requireInvoice(input.creditNoteInvoiceId);
    if (credit.type !== 'credit-note' || !invoicesService.approvedRevision(credit)) throw new ConflictError('Only an approved credit note can be applied.');
    if (credit.projectId !== invoice.projectId || credit.supplierId !== invoice.supplierId) {
      throw new ValidationError('A credit note applies only to invoices of the same supplier and project.');
    }
    const remaining = invoicesService.settlementSummary(credit.id).unpaidBalance;
    if (input.amount.cents > remaining.cents) {
      throw new ValidationError(`Only ${dollars(remaining)} of this credit note is unapplied.`, { fieldErrors: { amount: [`At most ${dollars(remaining)}.`] } });
    }
  } else if (input.settlementType !== 'withholding' && input.settlementType !== 'other-noncash') {
    throw new ValidationError('Cash, refunds and retention releases need a payment; credits need a credit note.', {
      fieldErrors: { settlementType: ['Choose a payment or credit note as the source.'] },
    });
  }
  if (!ISO_DATE.test(effectiveDate)) throw new ValidationError('Enter the effective date as YYYY-MM-DD.');

  const allocation = invoicesRepository.insertSettlement({
    id: asId<'SettlementAllocation'>(`set-${randomUUID()}`),
    projectId: invoice.projectId,
    ...(input.paymentId ? { paymentId: input.paymentId } : {}),
    ...(input.creditNoteInvoiceId ? { creditNoteInvoiceId: input.creditNoteInvoiceId } : {}),
    invoiceId: invoice.id,
    amount: input.amount,
    settlementType: input.settlementType,
    effectiveDate,
    createdAt: now(),
    createdBy: input.actor,
  });
  if (input.paymentId && invoicesService.unappliedAmount(input.paymentId).cents <= 0) {
    const item = invoicesRepository.openItemForPayment(input.paymentId);
    if (item) invoicesRepository.updateReconciliationItem(item.id, { state: 'matched', resolvedBy: input.actor, resolvedAt: now() });
  }
  return allocation;
}
