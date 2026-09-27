/**
 * Transport-agnostic handlers for the invoices module.
 *
 * Every handler opens with `accessService.guard('development.read')` and the
 * per-project guard (NFR-01, IAM02). Reads need `financials.read`; capture,
 * editing, submission, holds and comments need `invoice.capture`; decisions
 * need `invoice.approve` **and** authority for the gross; payments,
 * settlements, imports, reconciliation, retention, void and duplicate
 * overrides need `payment.record`. Server Actions and v1 routes both call
 * these, so no door bypasses the checks.
 */
import { accessService } from '@/modules/access/service';
import { projectsService } from '@/modules/projects/service';
import type { ProjectPermission, ProjectScope } from '@/modules/projects/model';
import { budgetsService } from '@/modules/budgets/service';
import { commitmentsService } from '@/modules/commitments/service';
import { COMMITMENT_STATE_LABELS, VARIATION_STATE_LABELS, type CommitmentState, type VariationState } from '@/modules/commitments/model';
import { ForbiddenError, NotFoundError } from '@/shared/lib/errors';
import { money, sumMoney, type Money } from '@/shared/lib/money';
import { formatDateLong } from '@/shared/lib/dates';
import { resolveAsOfDate } from '@/shared/config/app-config';
import { decimalStringToCents } from '@/server/http/v1';
import type { TaxTreatment } from '@/shared/finance-engine';
import {
  asId,
  type CommitmentId,
  type InvoiceId,
  type InvoiceRevisionId,
  type IsoDate,
  type PaymentId,
  type ProjectId,
  type ReconciliationItemId,
  type RetentionTrancheId,
  type SupplierId,
} from '@/shared/types/common';
import { invoicesService, type AllocationInput, type DecideResult, type DraftChanges, type ImportConfirmation } from './service';
import {
  INVOICE_WARNING_LABELS,
  REVIEW_STATES,
  type ContractPosition,
  type DecisionKind,
  type Invoice,
  type InvoiceIntake,
  type InvoiceType,
  type InvoiceWarning,
  type Payment,
  type PaymentImport,
  type ReconciliationItem,
  type RetentionTranche,
  type ReviewState,
  type SettlementAllocation,
  type SettlementState,
  type SettlementSummary,
  type SettlementType,
} from './model';
import type { DraftChangesBody, InvoiceAllocationBody, InvoiceFieldsBody } from './validation';

/* ------------------------------------------------------------ view models */

export interface InvoiceRow {
  readonly id: string;
  readonly type: InvoiceType;
  readonly number: string;
  readonly supplierId: string;
  readonly supplierName: string;
  readonly invoiceDate: string;
  readonly dueDate: string;
  readonly net: Money;
  readonly tax: Money;
  readonly gross: Money;
  readonly reviewState: ReviewState;
  readonly settlementState: SettlementState;
  readonly unpaid: Money;
  readonly duplicateCount: number;
  readonly unresolvedDuplicates: number;
}

export interface TimelineItem {
  readonly id: string;
  readonly at: string;
  readonly state: 'done' | 'fail' | 'next' | 'pending';
  readonly title: string;
  readonly meta: string;
}

export interface InvoiceDetail {
  readonly id: string;
  readonly type: InvoiceType;
  readonly number: string;
  readonly supplierId: string;
  readonly supplierName: string;
  readonly reviewState: ReviewState;
  readonly currentRevisionId: string;
  readonly revisionNumber: number;
  readonly revisionCount: number;
  readonly approvedRevisionNumber: number | null;
  readonly invoiceDate: string;
  readonly dueDate: string;
  readonly net: Money;
  readonly tax: Money;
  readonly gross: Money;
  readonly roundingAdjustment: Money;
  readonly lineDescriptions: readonly string[];
  readonly allocations: readonly {
    readonly id: string;
    readonly costLineId: string;
    readonly costLineLabel: string;
    readonly commitmentId: string | null;
    readonly commitmentLabel: string | null;
    readonly stageId: string | null;
    readonly net: Money;
    readonly tax: Money;
    readonly taxTreatment: TaxTreatment;
    readonly allowanceTreatment: string | null;
  }[];
  readonly intake: {
    readonly filename: string;
    readonly mimeType: string;
    readonly sizeBytes: number;
    readonly checksum: string;
    readonly origin: string;
    readonly scanState: string;
    readonly receivedAt: string;
  } | null;
  readonly warnings: readonly { readonly code: string; readonly label: string }[];
  readonly warningsCleared: boolean;
  readonly issues: readonly string[];
  readonly findings: readonly { readonly kind: 'exact' | 'checksum' | 'similar'; readonly invoiceId: string; readonly number: string; readonly resolved: boolean }[];
  readonly duplicateOverride: { readonly byName: string; readonly reason: string; readonly suspectNumber: string } | null;
  readonly dismissedSimilarity: { readonly byName: string; readonly reason: string } | null;
  readonly commitmentPositions: readonly { readonly commitmentId: string; readonly reference: string; readonly position: ContractPosition }[];
  readonly comments: readonly { readonly id: string; readonly at: string; readonly byName: string; readonly text: string }[];
  readonly timeline: readonly TimelineItem[];
  readonly settlement: SettlementSummary;
  readonly settlements: readonly { readonly id: string; readonly type: SettlementType; readonly amount: Money; readonly date: string; readonly source: string }[];
  readonly retention: readonly { readonly id: string; readonly amount: Money; readonly condition: string; readonly forecast: string; readonly released: boolean }[];
  readonly submittedByName: string | null;
  readonly holdReason: string | null;
  readonly rejectReason: string | null;
  readonly voidReason: string | null;
  readonly scheduledPaymentDate: string | null;
  readonly expectedPaymentDate: string;
  readonly externalAuthorisation: string | null;
  /** Why the current user may not approve / hold-or-reject; null when they may. */
  readonly approveBlocker: string | null;
  readonly holdBlocker: string | null;
}

export interface PaymentRow {
  readonly id: string;
  readonly date: string;
  readonly reference: string;
  readonly direction: Payment['direction'];
  readonly amount: Money;
  readonly unapplied: Money;
  readonly origin: Payment['origin'];
  readonly sourceId: string | null;
  readonly supplierName: string | null;
  readonly reversesReference: string | null;
  readonly reversed: boolean;
  readonly locked: boolean;
}

export interface ReconciliationRow {
  readonly id: string;
  readonly kind: ReconciliationItem['kind'];
  readonly reference: string;
  readonly amount: Money;
  readonly outstanding: Money;
  readonly date: string;
  readonly state: ReconciliationItem['state'];
  readonly reason: string | null;
}

export interface CommitmentRow {
  readonly id: string;
  readonly reference: string;
  readonly title: string;
  readonly supplierName: string;
  readonly state: CommitmentState;
  readonly stateLabel: string;
  readonly original: Money;
  readonly revised: Money;
  readonly pending: Money;
  readonly position: ContractPosition;
  readonly allocations: readonly { readonly label: string; readonly amount: Money }[];
  readonly stages: readonly { readonly id: string; readonly name: string; readonly amount: Money }[];
  readonly variations: readonly {
    readonly id: string;
    readonly reference: string;
    readonly description: string;
    readonly amount: Money;
    readonly state: VariationState;
    readonly stateLabel: string;
    readonly submittedByName: string | null;
    readonly decidedByName: string | null;
    readonly reason: string | null;
    readonly isOwnSubmission: boolean;
  }[];
}

export interface InvoicesWorkspace {
  readonly projectId: string;
  readonly projectCode: string;
  readonly modelRevision: number;
  readonly actualsCutoff: string;
  readonly today: string;
  readonly userName: string;
  readonly permissions: {
    readonly canCapture: boolean;
    readonly canPay: boolean;
    readonly canEditBudget: boolean;
    readonly canApprove: boolean;
    readonly approvalLimit: Money | null;
  };
  readonly invoices: readonly InvoiceRow[];
  readonly counts: Readonly<Record<ReviewState | 'all', number>>;
  readonly details: Readonly<Record<string, InvoiceDetail>>;
  readonly failedIntakes: readonly { readonly id: string; readonly filename: string; readonly reason: string; readonly receivedAt: string }[];
  readonly suppliers: readonly { readonly id: string; readonly name: string; readonly abn: string | null; readonly bankDetailsVerified: boolean }[];
  readonly costLines: readonly { readonly id: string; readonly label: string }[];
  readonly commitmentOptions: readonly { readonly id: string; readonly label: string; readonly supplierId: string; readonly stages: readonly { readonly id: string; readonly name: string }[] }[];
  readonly approvedInvoiceOptions: readonly { readonly id: string; readonly label: string; readonly supplierId: string; readonly unpaid: Money }[];
  readonly creditNoteOptions: readonly { readonly id: string; readonly label: string; readonly unapplied: Money }[];
  readonly payments: readonly PaymentRow[];
  readonly reconciliation: readonly ReconciliationRow[];
  readonly suspenseTotal: Money;
  readonly pendingImports: readonly PaymentImport[];
  readonly retention: readonly { readonly id: string; readonly invoiceNumber: string; readonly amount: Money; readonly condition: string; readonly forecast: string; readonly released: boolean }[];
  readonly commitments: readonly CommitmentRow[];
  readonly pendingVariationRisk: Money;
}

/* ---------------------------------------------------------------- helpers */

function guardProject(projectId: ProjectId, permission: ProjectPermission): ProjectScope {
  accessService.guard('development.read');
  return projectsService.guard(projectId, permission);
}

function guardInvoice(rawInvoiceId: string, permission: ProjectPermission): { readonly invoice: Invoice; readonly scope: ProjectScope } {
  accessService.guard('development.read');
  const invoice = invoicesService.requireInvoice(asId<'Invoice'>(rawInvoiceId));
  return { invoice, scope: projectsService.guard(invoice.projectId, permission) };
}

function actorId() {
  return accessService.getCurrentUser().id;
}

function nameOf(userId: string | undefined | null): string | null {
  return userId ? accessService.resolveUserName(asId<'User'>(userId)) : null;
}

function wireMoney(value: string | undefined): Money | undefined {
  return value === undefined ? undefined : money(decimalStringToCents(value));
}

export function allocationsFromWire(rows: readonly InvoiceAllocationBody[]): AllocationInput[] {
  return rows.map((row) => ({
    costLineId: asId<'CostLine'>(row.costLineId),
    ...(row.commitmentId ? { commitmentId: asId<'Commitment'>(row.commitmentId) } : {}),
    ...(row.stageId ? { stageId: row.stageId } : {}),
    net: money(decimalStringToCents(row.net)),
    tax: money(decimalStringToCents(row.tax)),
    taxTreatment: row.taxTreatment as TaxTreatment,
    ...(row.recoverablePpm !== undefined ? { recoverablePpm: row.recoverablePpm } : {}),
    ...(row.allowanceTreatment ? { allowanceTreatment: row.allowanceTreatment } : {}),
  }));
}

export function draftChangesFromWire(body: DraftChangesBody): DraftChanges {
  return {
    ...(body.supplierId ? { supplierId: asId<'Supplier'>(body.supplierId) } : {}),
    ...(body.number !== undefined ? { number: body.number } : {}),
    ...(body.invoiceDate ? { invoiceDate: body.invoiceDate } : {}),
    ...(body.dueDate ? { dueDate: body.dueDate } : {}),
    ...(body.net !== undefined ? { net: wireMoney(body.net) } : {}),
    ...(body.tax !== undefined ? { tax: wireMoney(body.tax) } : {}),
    ...(body.lineDescriptions ? { lineDescriptions: body.lineDescriptions } : {}),
    ...(body.allocations ? { allocations: allocationsFromWire(body.allocations) } : {}),
    ...(body.roundingAdjustment !== undefined ? { roundingAdjustment: wireMoney(body.roundingAdjustment) } : {}),
    ...(body.scheduledPaymentDate ? { scheduledPaymentDate: body.scheduledPaymentDate } : {}),
  };
}

function base64ToBytes(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, 'base64'));
}

function timelineFor(invoice: Invoice): TimelineItem[] {
  const items: TimelineItem[] = [
    { id: `${invoice.id}-received`, at: invoice.receivedAt, state: 'done', title: 'Received', meta: `${formatStamp(invoice.receivedAt)} · ${nameOf(invoice.createdBy) ?? 'system'}` },
  ];
  for (const revision of invoicesService.listRevisions(invoice.id)) {
    if (revision.revisionNumber === 1) continue;
    items.push({ id: revision.id, at: revision.createdAt, state: 'done', title: `Revision ${revision.revisionNumber} created`, meta: `${formatStamp(revision.createdAt)} · ${nameOf(revision.createdBy)} · gross ${(revision.gross.cents / 100).toFixed(2)}` });
  }
  if (invoice.submittedAt) {
    items.push({ id: `${invoice.id}-submitted`, at: invoice.submittedAt, state: 'done', title: 'Submitted for approval', meta: `${formatStamp(invoice.submittedAt)} · ${nameOf(invoice.submittedBy)}` });
  }
  for (const decision of invoicesService.listApprovalDecisions(invoice.id)) {
    items.push({
      id: decision.id,
      at: decision.at,
      state: decision.decision === 'approved' ? 'done' : 'fail',
      title: decision.decision === 'approved' ? 'Approved · not synced · no accounting connection' : decision.decision === 'on-hold' ? 'Put on hold' : 'Rejected',
      meta: `${formatStamp(decision.at)} · ${nameOf(decision.actor)}${decision.reason ? ` · ${decision.reason}` : ''}`,
    });
  }
  for (const comment of invoice.comments) {
    items.push({ id: comment.id, at: comment.at, state: 'pending', title: `Comment · ${comment.text}`, meta: `${formatStamp(comment.at)} · ${nameOf(comment.by)}` });
  }
  for (const settlement of invoicesService.settlementsByInvoice(invoice.id)) {
    items.push({ id: settlement.id, at: settlement.createdAt, state: 'done', title: `Settlement · ${settlement.settlementType} ${(settlement.amount.cents / 100).toFixed(2)}`, meta: `effective ${settlement.effectiveDate}` });
  }
  if (invoice.reviewState === 'void') items.push({ id: `${invoice.id}-void`, at: '9999', state: 'fail', title: 'Voided', meta: invoice.voidReason ?? '' });
  return items.sort((a, b) => a.at.localeCompare(b.at));
}

function formatStamp(at: string): string {
  return formatDateLong(at.slice(0, 10));
}

function settlementSource(row: SettlementAllocation): string {
  if (row.paymentId) {
    const payment = invoicesService.requirePayment(row.paymentId);
    return `${payment.reference}${payment.sourceId ? ` · ${payment.sourceId}` : ''}`;
  }
  if (row.creditNoteInvoiceId) return `Credit note ${invoicesService.requireInvoice(row.creditNoteInvoiceId).number}`;
  return 'Non-cash adjustment';
}

function supplierNameOf(supplierId: SupplierId): string {
  try {
    return commitmentsService.requireSupplier(supplierId).name;
  } catch {
    return 'Unknown supplier';
  }
}

function costLineLabel(costLineId: string): string {
  try {
    const line = budgetsService.requireCostLine(asId<'CostLine'>(costLineId));
    return `${line.code} · ${line.title}`;
  } catch {
    return costLineId;
  }
}

function detailFor(invoice: Invoice, userId: ReturnType<typeof actorId>): InvoiceDetail {
  const revision = invoicesService.currentRevision(invoice);
  const approved = invoicesService.approvedRevision(invoice);
  const intake: InvoiceIntake | null = invoice.intakeId ? invoicesService.requireIntake(invoice.intakeId) : null;
  const findings = invoicesService.duplicateFindings(invoice.id);
  const unresolved = new Set(invoicesService.unresolvedDuplicates(invoice).map((row) => `${row.kind}:${row.invoiceId}`));
  const numberOf = (id: InvoiceId): string => invoicesService.requireInvoice(id).number;
  const commitmentIds = [...new Set(revision.allocations.map((row) => row.commitmentId).filter((id): id is CommitmentId => Boolean(id)))];
  return {
    id: invoice.id,
    type: invoice.type,
    number: invoice.number,
    supplierId: invoice.supplierId,
    supplierName: supplierNameOf(invoice.supplierId),
    reviewState: invoice.reviewState,
    currentRevisionId: revision.id,
    revisionNumber: revision.revisionNumber,
    revisionCount: invoicesService.listRevisions(invoice.id).length,
    approvedRevisionNumber: approved?.revisionNumber ?? null,
    invoiceDate: revision.invoiceDate,
    dueDate: revision.dueDate,
    net: revision.net,
    tax: revision.tax,
    gross: revision.gross,
    roundingAdjustment: revision.roundingAdjustment,
    lineDescriptions: revision.lineDescriptions,
    allocations: revision.allocations.map((row) => ({
      id: row.id,
      costLineId: row.costLineId,
      costLineLabel: costLineLabel(row.costLineId),
      commitmentId: row.commitmentId ?? null,
      commitmentLabel: row.commitmentId ? commitmentsService.requireCommitment(row.commitmentId).reference : null,
      stageId: row.stageId ?? null,
      net: row.net,
      tax: row.tax,
      taxTreatment: row.taxTreatment,
      allowanceTreatment: row.allowanceTreatment ?? null,
    })),
    intake: intake
      ? {
          filename: intake.filename,
          mimeType: intake.mimeType,
          sizeBytes: intake.sizeBytes,
          checksum: intake.checksumSha256,
          origin: intake.origin,
          scanState: intake.scanState,
          receivedAt: intake.receivedAt,
        }
      : null,
    warnings: revision.warnings.map((code) => ({ code, label: INVOICE_WARNING_LABELS[code as InvoiceWarning] ?? code })),
    warningsCleared: invoice.warningsCleared?.revisionId === revision.id,
    issues: invoicesService.blockingIssues(invoice.id),
    findings: [
      ...findings.exact.map((id) => ({ kind: 'exact' as const, invoiceId: id, number: numberOf(id), resolved: !unresolved.has(`exact:${id}`) })),
      ...findings.checksum.map((id) => ({ kind: 'checksum' as const, invoiceId: id, number: numberOf(id), resolved: !unresolved.has(`checksum:${id}`) })),
      ...findings.similar.map((id) => ({ kind: 'similar' as const, invoiceId: id, number: numberOf(id), resolved: !unresolved.has(`similar:${id}`) })),
    ],
    duplicateOverride: invoice.duplicateOverride
      ? { byName: nameOf(invoice.duplicateOverride.by) ?? 'Unknown', reason: invoice.duplicateOverride.reason, suspectNumber: numberOf(invoice.duplicateOverride.suspectInvoiceId) }
      : null,
    dismissedSimilarity: invoice.dismissedSimilarity ? { byName: nameOf(invoice.dismissedSimilarity.by) ?? 'Unknown', reason: invoice.dismissedSimilarity.reason } : null,
    commitmentPositions: commitmentIds.map((id) => ({ commitmentId: id, reference: commitmentsService.requireCommitment(id).reference, position: invoicesService.contractPosition(id) })),
    comments: invoice.comments.map((comment) => ({ id: comment.id, at: comment.at, byName: nameOf(comment.by) ?? 'Unknown', text: comment.text })),
    timeline: timelineFor(invoice),
    settlement: invoicesService.settlementSummary(invoice.id),
    settlements: invoicesService.settlementsByInvoice(invoice.id).map((row) => ({
      id: row.id,
      type: row.settlementType,
      amount: row.amount,
      date: row.effectiveDate,
      source: row.invoiceId === invoice.id ? settlementSource(row) : `Applied to ${numberOf(row.invoiceId)}`,
    })),
    retention: invoicesService.listRetention(invoice.id).map((row) => ({
      id: row.id,
      amount: row.amount,
      condition: row.releaseCondition,
      forecast: row.forecastReleaseDate,
      released: Boolean(row.actualReleaseAt),
    })),
    submittedByName: nameOf(invoice.submittedBy),
    holdReason: invoice.holdReason ?? null,
    rejectReason: invoice.rejectReason ?? null,
    voidReason: invoice.voidReason ?? null,
    scheduledPaymentDate: invoice.scheduledPaymentDate ?? null,
    expectedPaymentDate: invoicesService.expectedPaymentDate(invoice),
    externalAuthorisation: invoice.externalAuthorisation ? `${invoice.externalAuthorisation.source} · ${invoice.externalAuthorisation.reference}` : null,
    approveBlocker: invoicesService.decisionBlocker(invoice, userId, 'approved'),
    holdBlocker: invoicesService.decisionBlocker(invoice, userId, 'on-hold'),
  };
}

function rowFor(invoice: Invoice): InvoiceRow {
  const revision = invoicesService.currentRevision(invoice);
  const findings = invoicesService.duplicateFindings(invoice.id);
  const summary = invoicesService.settlementSummary(invoice.id);
  return {
    id: invoice.id,
    type: invoice.type,
    number: invoice.number,
    supplierId: invoice.supplierId,
    supplierName: supplierNameOf(invoice.supplierId),
    invoiceDate: revision.invoiceDate,
    dueDate: revision.dueDate,
    net: revision.net,
    tax: revision.tax,
    gross: revision.gross,
    reviewState: invoice.reviewState,
    settlementState: summary.state,
    unpaid: summary.unpaidBalance,
    duplicateCount: findings.exact.length + findings.checksum.length + findings.similar.length,
    unresolvedDuplicates: invoicesService.unresolvedDuplicates(invoice).length,
  };
}

/* ------------------------------------------------------------------- api */

export const invoicesApi = {
  list(rawProjectId: string, query: { readonly reviewState?: string } = {}): { readonly items: readonly InvoiceRow[] } {
    const projectId: ProjectId = asId<'Project'>(rawProjectId);
    guardProject(projectId, 'financials.read');
    const state = REVIEW_STATES.find((value) => value === query.reviewState);
    return { items: invoicesService.listInvoices(projectId, state ? { reviewState: state } : undefined).map(rowFor) };
  },

  get(rawInvoiceId: string): InvoiceDetail {
    const { invoice } = guardInvoice(rawInvoiceId, 'financials.read');
    return detailFor(invoice, actorId());
  },

  /** Everything the invoices screen renders, resolved once on the server. */
  workspace(rawProjectId: string): InvoicesWorkspace {
    const projectId: ProjectId = asId<'Project'>(rawProjectId);
    const scope = guardProject(projectId, 'financials.read');
    const project = projectsService.require(projectId);
    const policy = projectsService.policyFor(projectId);
    const user = accessService.getCurrentUser();
    const invoices = invoicesService.listInvoices(projectId);
    const rows = [...invoices].map(rowFor).sort((a, b) => b.invoiceDate.localeCompare(a.invoiceDate) || b.number.localeCompare(a.number));
    const counts = Object.fromEntries([['all', rows.length], ...REVIEW_STATES.map((state) => [state, rows.filter((row) => row.reviewState === state).length])]) as Record<ReviewState | 'all', number>;
    const details = Object.fromEntries(invoices.map((invoice) => [invoice.id, detailFor(invoice, user.id)]));
    const suppliers = commitmentsService.listSuppliers(projectId);
    const commitments = commitmentsService.listCommitments(projectId);
    const payments = invoicesService.listPayments(projectId);
    const reversedIds = new Set(payments.map((row) => row.reversesPaymentId).filter(Boolean));

    return {
      projectId,
      projectCode: project.code,
      modelRevision: project.modelRevision,
      actualsCutoff: policy.actualsCutoff,
      today: resolveAsOfDate(),
      userName: user.name,
      permissions: {
        canCapture: scope.permissions.includes('invoice.capture'),
        canPay: scope.permissions.includes('payment.record'),
        canEditBudget: scope.permissions.includes('budget.edit'),
        canApprove: scope.permissions.includes('invoice.approve'),
        approvalLimit: scope.approvalLimit,
      },
      invoices: rows,
      counts,
      details,
      failedIntakes: invoicesService
        .listIntakes(projectId)
        .filter((intake) => intake.scanState === 'failed')
        .map((intake) => ({ id: intake.id, filename: intake.filename, reason: intake.failureReason ?? 'Failed checks', receivedAt: intake.receivedAt })),
      suppliers: suppliers.map((row) => ({ id: row.id, name: row.name, abn: row.abn ?? null, bankDetailsVerified: row.bankDetailsVerified })),
      costLines: budgetsService
        .postingLines(projectId)
        .filter((line) => line.active)
        .map((line) => ({ id: line.id, label: `${line.code} · ${line.title}` })),
      commitmentOptions: commitments
        .filter((row) => row.state === 'authorised')
        .map((row) => ({
          id: row.id,
          label: `${row.reference} · ${supplierNameOf(row.supplierId)}`,
          supplierId: row.supplierId,
          stages: row.stages.map((stage) => ({ id: stage.id, name: stage.name })),
        })),
      approvedInvoiceOptions: invoices
        .filter((invoice) => invoice.type === 'invoice' && invoicesService.approvedRevision(invoice))
        .map((invoice) => {
          const unpaid = invoicesService.settlementSummary(invoice.id).unpaidBalance;
          return { id: invoice.id, label: `${invoice.number} · ${supplierNameOf(invoice.supplierId)} · unpaid ${(unpaid.cents / 100).toFixed(2)}`, supplierId: invoice.supplierId, unpaid };
        }),
      creditNoteOptions: invoices
        .filter((invoice) => invoice.type === 'credit-note' && invoicesService.approvedRevision(invoice))
        .map((invoice) => ({ invoice, unapplied: invoicesService.settlementSummary(invoice.id).unpaidBalance }))
        .filter((row) => row.unapplied.cents > 0)
        .map((row) => ({ id: row.invoice.id, label: `${row.invoice.number} · ${supplierNameOf(row.invoice.supplierId)}`, unapplied: row.unapplied })),
      payments: [...payments]
        .sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate))
        .map((payment) => ({
          id: payment.id,
          date: payment.effectiveDate,
          reference: payment.reference,
          direction: payment.direction,
          amount: payment.amount,
          unapplied: invoicesService.unappliedAmount(payment.id),
          origin: payment.origin,
          sourceId: payment.sourceId ?? null,
          supplierName: payment.supplierId ? supplierNameOf(payment.supplierId) : null,
          reversesReference: payment.reversesPaymentId ? invoicesService.requirePayment(payment.reversesPaymentId).reference : null,
          reversed: reversedIds.has(payment.id),
          locked: projectsService.isPeriodLocked(projectId, payment.effectiveDate),
        })),
      reconciliation: invoicesService.listReconciliationItems(projectId).map((item) => ({
        id: item.id,
        kind: item.kind,
        reference: item.paymentId ? invoicesService.requirePayment(item.paymentId).reference : (item.externalReference ?? ''),
        amount: item.amount,
        outstanding: item.paymentId && item.state === 'open' ? invoicesService.unappliedAmount(item.paymentId) : item.state === 'open' ? item.amount : money(0),
        date: item.effectiveDate,
        state: item.state,
        reason: item.reason ?? null,
      })),
      suspenseTotal: sumMoney(invoicesService.unmatchedPayments(projectId).map((row) => row.amount)),
      pendingImports: invoicesService.listImports(projectId).filter((row) => row.state === 'dry-run'),
      retention: invoicesService.listRetention(projectId).map((row) => ({
        id: row.id,
        invoiceNumber: invoicesService.requireInvoice(row.invoiceId).number,
        amount: row.amount,
        condition: row.releaseCondition,
        forecast: row.forecastReleaseDate,
        released: Boolean(row.actualReleaseAt),
      })),
      commitments: commitments.map((commitment) => ({
        id: commitment.id,
        reference: commitment.reference,
        title: commitment.title,
        supplierName: supplierNameOf(commitment.supplierId),
        state: commitment.state,
        stateLabel: COMMITMENT_STATE_LABELS[commitment.state],
        original: commitment.originalAmount,
        revised: commitmentsService.revisedValue(commitment.id),
        pending: commitmentsService.pendingVariationsTotal(commitment.id),
        position: invoicesService.contractPosition(commitment.id),
        allocations: commitment.allocations.map((row) => ({
          label: `${costLineLabel(row.costLineId)}${row.stageId ? ` · ${commitment.stages.find((stage) => stage.id === row.stageId)?.name ?? row.stageId}` : ''}`,
          amount: row.amount,
        })),
        stages: commitment.stages.map((stage) => ({ id: stage.id, name: stage.name, amount: stage.amount })),
        variations: commitmentsService.listVariations(commitment.id).map((variation) => ({
          id: variation.id,
          reference: variation.reference,
          description: variation.description,
          amount: variation.amount,
          state: variation.state,
          stateLabel: VARIATION_STATE_LABELS[variation.state],
          submittedByName: nameOf(variation.submittedBy),
          decidedByName: nameOf(variation.decidedBy),
          reason: variation.reason ?? null,
          isOwnSubmission: variation.submittedBy === user.id,
        })),
      })),
      pendingVariationRisk: sumMoney(commitments.map((row) => commitmentsService.pendingVariationsTotal(row.id))),
    };
  },

  /* ---------------------------------------------------------------- capture */

  createIntake(rawProjectId: string, input: { readonly filename: string; readonly mimeType: string; readonly sizeBytes: number; readonly bytes?: Uint8Array; readonly contentBase64?: string }): InvoiceIntake {
    const projectId: ProjectId = asId<'Project'>(rawProjectId);
    guardProject(projectId, 'invoice.capture');
    const bytes = input.bytes ?? (input.contentBase64 ? base64ToBytes(input.contentBase64) : undefined);
    return invoicesService.createIntake({
      projectId,
      filename: input.filename,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      ...(bytes ? { bytes } : {}),
      actor: actorId(),
    });
  },

  createInvoice(rawProjectId: string, body: InvoiceFieldsBody, intakeId?: string): Invoice {
    const projectId: ProjectId = asId<'Project'>(rawProjectId);
    guardProject(projectId, 'invoice.capture');
    const rounding = wireMoney(body.roundingAdjustment);
    return invoicesService.createInvoice({
      projectId,
      type: body.type,
      supplierId: asId<'Supplier'>(body.supplierId),
      number: body.number,
      invoiceDate: body.invoiceDate,
      dueDate: body.dueDate,
      net: money(decimalStringToCents(body.net)),
      tax: money(decimalStringToCents(body.tax)),
      lineDescriptions: body.lineDescriptions,
      allocations: allocationsFromWire(body.allocations),
      ...(rounding ? { roundingAdjustment: rounding } : {}),
      ...(intakeId ? { intakeId: asId<'InvoiceIntake'>(intakeId) } : {}),
      actor: actorId(),
    });
  },

  /** A domain-typed create used by Server Actions (amounts already parsed). */
  createInvoiceTyped(rawProjectId: string, input: Omit<Parameters<typeof invoicesService.createInvoice>[0], 'projectId' | 'actor'>): Invoice {
    const projectId: ProjectId = asId<'Project'>(rawProjectId);
    guardProject(projectId, 'invoice.capture');
    return invoicesService.createInvoice({ ...input, projectId, actor: actorId() });
  },

  updateDraft(rawInvoiceId: string, changes: DraftChanges): Invoice {
    const { invoice } = guardInvoice(rawInvoiceId, 'invoice.capture');
    return invoicesService.updateDraft(invoice.id, changes, actorId());
  },

  markReady(rawInvoiceId: string, acknowledgeWarnings = false): Invoice {
    const { invoice } = guardInvoice(rawInvoiceId, 'invoice.capture');
    return invoicesService.markReady(invoice.id, actorId(), { acknowledgeWarnings });
  },

  submit(rawInvoiceId: string, acknowledgeWarnings = false): Invoice {
    const { invoice } = guardInvoice(rawInvoiceId, 'invoice.capture');
    return invoicesService.submitForApproval(invoice.id, actorId(), { acknowledgeWarnings });
  },

  hold(rawInvoiceId: string, reason: string): Invoice {
    const { invoice } = guardInvoice(rawInvoiceId, 'invoice.capture');
    return invoicesService.hold(invoice.id, actorId(), reason);
  },

  releaseHold(rawInvoiceId: string): Invoice {
    const { invoice } = guardInvoice(rawInvoiceId, 'invoice.capture');
    return invoicesService.releaseHold(invoice.id, actorId());
  },

  addComment(rawInvoiceId: string, text: string): Invoice {
    const { invoice } = guardInvoice(rawInvoiceId, 'invoice.capture');
    return invoicesService.addComment(invoice.id, text, actorId());
  },

  dismissSimilarity(rawInvoiceId: string, suspectInvoiceId: string, reason: string): Invoice {
    const { invoice } = guardInvoice(rawInvoiceId, 'invoice.capture');
    return invoicesService.dismissSimilarity({ invoiceId: invoice.id, suspectInvoiceId: asId<'Invoice'>(suspectInvoiceId), reason, actor: actorId() });
  },

  /* -------------------------------------------------------------- decisions */

  /**
   * INV09 — needs `invoice.approve` and authority for this invoice's gross.
   * The service repeats the checks against the actor and makes a repeated
   * identical decision idempotent. Never reports Paid.
   */
  decide(
    rawInvoiceId: string,
    body: { readonly decision: DecisionKind; readonly invoiceRevision: string; readonly reason?: string; readonly scheduledPaymentDate?: IsoDate },
  ): { readonly reviewState: ReviewState; readonly approvalEventId: string; readonly newModelRevision: number; readonly syncState: Invoice['syncState'] } {
    const { invoice, scope } = guardInvoice(rawInvoiceId, 'invoice.approve');
    const gross = invoicesService.currentRevision(invoice).gross;
    if (!projectsService.canApprove(scope, gross)) {
      throw new ForbiddenError(`Your approval limit does not cover this invoice's gross value of ${(gross.cents / 100).toFixed(2)}.`);
    }
    const result: DecideResult = invoicesService.decide({
      invoiceId: invoice.id,
      revisionId: asId<'InvoiceRevision'>(body.invoiceRevision) as InvoiceRevisionId,
      actor: actorId(),
      decision: body.decision,
      ...(body.reason ? { reason: body.reason } : {}),
      ...(body.scheduledPaymentDate ? { scheduledPaymentDate: body.scheduledPaymentDate } : {}),
    });
    return { reviewState: result.invoice.reviewState, approvalEventId: result.decision.id, newModelRevision: result.newModelRevision, syncState: result.syncState };
  },

  /** INV10 — a correction of an approved invoice appends a revision needing renewed approval. */
  correct(rawInvoiceId: string, changes: DraftChanges): { readonly invoice: Invoice; readonly approvedRevisionId: string | null; readonly currentRevisionId: string } {
    const { invoice } = guardInvoice(rawInvoiceId, 'invoice.capture');
    const updated = invoicesService.updateDraft(invoice.id, changes, actorId());
    return { invoice: updated, approvedRevisionId: updated.approvedRevisionId ?? null, currentRevisionId: updated.currentRevisionId };
  },

  /* ------------------------------------------------------- finance (payment) */

  voidInvoice(rawInvoiceId: string, reason: string): Invoice {
    const { invoice } = guardInvoice(rawInvoiceId, 'payment.record');
    return invoicesService.voidInvoice(invoice.id, actorId(), reason);
  },

  overrideDuplicate(rawInvoiceId: string, suspectInvoiceId: string, reason: string): Invoice {
    const { invoice } = guardInvoice(rawInvoiceId, 'payment.record');
    return invoicesService.overrideDuplicate({ invoiceId: invoice.id, suspectInvoiceId: asId<'Invoice'>(suspectInvoiceId), reason, actor: actorId() });
  },

  recordPayment(rawProjectId: string, input: Omit<Parameters<typeof invoicesService.recordPayment>[0], 'projectId' | 'actor'>): Payment {
    const projectId: ProjectId = asId<'Project'>(rawProjectId);
    guardProject(projectId, 'payment.record');
    return invoicesService.recordPayment({ ...input, projectId, actor: actorId() });
  },

  reversePayment(rawPaymentId: string, reason: string, effectiveDate?: IsoDate): Payment {
    accessService.guard('development.read');
    const payment = invoicesService.requirePayment(asId<'Payment'>(rawPaymentId));
    projectsService.guard(payment.projectId, 'payment.record');
    return invoicesService.reversePayment({ paymentId: payment.id, reason, actor: actorId(), ...(effectiveDate ? { effectiveDate } : {}) });
  },

  allocateSettlement(input: { readonly invoiceId: string; readonly paymentId?: string; readonly creditNoteInvoiceId?: string; readonly amount: Money; readonly settlementType: SettlementType }): SettlementAllocation {
    const { invoice } = guardInvoice(input.invoiceId, 'payment.record');
    return invoicesService.allocateSettlement({
      invoiceId: invoice.id,
      ...(input.paymentId ? { paymentId: asId<'Payment'>(input.paymentId) as PaymentId } : {}),
      ...(input.creditNoteInvoiceId ? { creditNoteInvoiceId: asId<'Invoice'>(input.creditNoteInvoiceId) } : {}),
      amount: input.amount,
      settlementType: input.settlementType,
      actor: actorId(),
    });
  },

  addRetention(rawInvoiceId: string, input: { readonly amount: Money; readonly releaseCondition: string; readonly forecastReleaseDate: IsoDate }): RetentionTranche {
    const { invoice } = guardInvoice(rawInvoiceId, 'payment.record');
    return invoicesService.addRetention({ invoiceId: invoice.id, ...input, actor: actorId() });
  },

  releaseRetention(rawTrancheId: string, rawPaymentId: string): RetentionTranche {
    accessService.guard('development.read');
    const payment = invoicesService.requirePayment(asId<'Payment'>(rawPaymentId));
    projectsService.guard(payment.projectId, 'payment.record');
    return invoicesService.releaseRetention({ trancheId: asId<'RetentionTranche'>(rawTrancheId) as RetentionTrancheId, paymentId: payment.id, actor: actorId() });
  },

  /** INT07 — a dry run when given CSV text; a confirmation when given an import id. */
  paymentImport(rawProjectId: string, body: { readonly csvText?: string; readonly filename?: string; readonly confirmImportId?: string }): PaymentImport | ImportConfirmation {
    const projectId: ProjectId = asId<'Project'>(rawProjectId);
    guardProject(projectId, 'payment.record');
    if (body.confirmImportId) {
      const record = invoicesService.listImports(projectId).find((row) => row.id === body.confirmImportId);
      if (!record) throw new NotFoundError('Payment import', body.confirmImportId);
      return invoicesService.confirmPaymentImport({ importId: record.id, actor: actorId() });
    }
    return invoicesService.dryRunPaymentImport({ projectId, csvText: body.csvText ?? '', ...(body.filename ? { filename: body.filename } : {}), actor: actorId() });
  },

  matchItem(rawItemId: string, invoiceId: string, amount: Money): ReconciliationItem {
    accessService.guard('development.read');
    const item = invoicesService.requireReconciliationItem(asId<'ReconciliationItem'>(rawItemId) as ReconciliationItemId);
    projectsService.guard(item.projectId, 'payment.record');
    return invoicesService.matchReconciliationItem({ itemId: item.id, invoiceId: asId<'Invoice'>(invoiceId), amount, actor: actorId() });
  },

  excludeItem(rawItemId: string, reason: string): ReconciliationItem {
    accessService.guard('development.read');
    const item = invoicesService.requireReconciliationItem(asId<'ReconciliationItem'>(rawItemId) as ReconciliationItemId);
    projectsService.guard(item.projectId, 'payment.record');
    return invoicesService.excludeReconciliationItem({ itemId: item.id, reason, actor: actorId() });
  },

  contractPosition(rawCommitmentId: string): ContractPosition {
    accessService.guard('development.read');
    const commitment = commitmentsService.requireCommitment(asId<'Commitment'>(rawCommitmentId));
    projectsService.guard(commitment.projectId, 'financials.read');
    return invoicesService.contractPosition(commitment.id);
  },
};

