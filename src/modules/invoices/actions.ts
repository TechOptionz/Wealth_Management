'use server';

import { revalidatePath } from 'next/cache';
import { asId, type ProjectId } from '@/shared/types/common';
import { fromMajorUnits, type Money } from '@/shared/lib/money';
import { TAX_TREATMENTS, type TaxTreatment } from '@/shared/finance-engine';
import type { ActionResult } from '@/shared/lib/action-result';
import { runAction } from '@/server/actions/run-action';
import { readAmount, readBoolean, readChoice, readString, requireString } from '@/shared/lib/form-data';
import { ValidationError } from '@/shared/lib/errors';
import { invoicesApi } from './api';
import { invoicesService, type AllocationInput, type DraftChanges } from './service';
import { SETTLEMENT_TYPES, type AllowanceTreatment } from './model';

const ALLOWANCES: readonly AllowanceTreatment[] = ['consume-allowance', 'additional-scope'];
const DECISIONS = ['approved', 'on-hold', 'rejected'] as const;

function revalidate(projectId: string): void {
  revalidatePath(`/projects/${projectId}/invoices`);
  revalidatePath(`/projects/${projectId}`, 'layout');
}

function projectOfInvoice(form: FormData): { readonly invoiceId: string; readonly projectId: ProjectId } {
  const invoiceId = requireString(form, 'invoiceId', 'Invoice');
  return { invoiceId, projectId: invoicesService.requireInvoice(asId<'Invoice'>(invoiceId)).projectId };
}

function requireMoney(form: FormData, key: string, label: string): Money {
  const value = readAmount(form, key);
  if (value === undefined) throw new ValidationError(`${label} is required.`, { fieldErrors: { [key]: [`Enter ${label.toLowerCase()}.`] } });
  return fromMajorUnits(value);
}

function optionalMoney(form: FormData, key: string): Money | undefined {
  const value = readAmount(form, key);
  return value === undefined ? undefined : fromMajorUnits(value);
}

function strings(form: FormData, key: string): string[] {
  return form.getAll(key).map((value) => (typeof value === 'string' ? value.trim() : ''));
}

function parseNumber(raw: string, row: number): number {
  const parsed = Number(raw.replace(/[$,\s]/g, '') || '0');
  if (!Number.isFinite(parsed)) throw new ValidationError(`"${raw}" is not a valid amount.`, { fieldErrors: { allocations: [`Row ${row}: enter a number.`] } });
  return parsed;
}

/**
 * Repeated allocation rows from the allocations editor. A row with neither a
 * cost line nor an amount is spacing and is skipped.
 */
function readAllocations(form: FormData): AllocationInput[] {
  const lines = strings(form, 'allocCostLineId');
  const commitments = strings(form, 'allocCommitmentId');
  const stages = strings(form, 'allocStageId');
  const nets = strings(form, 'allocNet');
  const taxes = strings(form, 'allocTax');
  const treatments = strings(form, 'allocTreatment');
  const allowances = strings(form, 'allocAllowance');
  const rows: AllocationInput[] = [];
  lines.forEach((costLineId, index) => {
    const row = index + 1;
    if (!costLineId && !nets[index] && !taxes[index]) return;
    if (!costLineId) throw new ValidationError('Choose a cost line for every allocation row.', { fieldErrors: { allocations: [`Row ${row} has no cost line.`] } });
    const treatment = (treatments[index] || 'standard-gst') as TaxTreatment;
    if (!TAX_TREATMENTS.includes(treatment)) throw new ValidationError(`Row ${row}: choose a tax treatment.`, { fieldErrors: { allocations: [`Row ${row}: choose a tax treatment.`] } });
    const commitmentId = commitments[index];
    const allowance = allowances[index] as AllowanceTreatment | '';
    rows.push({
      costLineId: asId<'CostLine'>(costLineId),
      ...(commitmentId ? { commitmentId: asId<'Commitment'>(commitmentId) } : {}),
      ...(commitmentId && stages[index] ? { stageId: stages[index] } : {}),
      net: fromMajorUnits(parseNumber(nets[index] ?? '', row)),
      tax: fromMajorUnits(parseNumber(taxes[index] ?? '', row)),
      taxTreatment: treatment,
      ...(!commitmentId && allowance && ALLOWANCES.includes(allowance) ? { allowanceTreatment: allowance } : {}),
    });
  });
  return rows;
}

function readRevision(form: FormData): number | undefined {
  const raw = readString(form, 'revision');
  if (raw === undefined) return undefined;
  const parsed = Number(raw);
  return Number.isInteger(parsed) ? parsed : undefined;
}

async function readUpload(form: FormData, key: string): Promise<{ readonly name: string; readonly type: string; readonly size: number; readonly bytes: Uint8Array } | null> {
  const file = form.get(key);
  if (!file || typeof file === 'string' || file.size === 0) return null;
  return { name: file.name, type: file.type, size: file.size, bytes: new Uint8Array(await file.arrayBuffer()) };
}

/**
 * INV01/INV05 — capture an invoice, optionally with its document. A document
 * that fails its checks stays as a visible failed intake and no invoice is
 * created; that outcome is reported, not thrown, so the intake is kept.
 */
export async function captureInvoiceAction(_previous: ActionResult<unknown>, form: FormData): Promise<ActionResult<unknown>> {
  return runAction(
    (value: { readonly intakeFailed?: string; readonly number?: string }) =>
      value.intakeFailed ? `Document failed its checks · no invoice created · ${value.intakeFailed}` : `Invoice ${value.number ?? ''} captured · needs review`,
    async () => {
      const projectId = requireString(form, 'projectId', 'Project');
      const upload = await readUpload(form, 'document');
      let intakeId: string | undefined;
      if (upload) {
        const intake = invoicesApi.createIntake(projectId, { filename: upload.name, mimeType: upload.type, sizeBytes: upload.size, bytes: upload.bytes });
        if (intake.scanState === 'failed') {
          revalidate(projectId);
          return { intakeFailed: intake.failureReason ?? 'unreadable file' };
        }
        intakeId = intake.id;
      }
      const supplierId = readString(form, 'supplierId');
      if (!supplierId) throw new ValidationError('Choose the supplier.', { fieldErrors: { supplierId: ['Select a supplier.'] } });
      const description = readString(form, 'lineDescription');
      const rounding = optionalMoney(form, 'roundingAdjustment');
      const invoice = invoicesApi.createInvoiceTyped(projectId, {
        type: readChoice(form, 'type', ['invoice', 'credit-note'] as const) ?? 'invoice',
        supplierId: asId<'Supplier'>(supplierId),
        number: requireString(form, 'number', 'Invoice number'),
        invoiceDate: requireString(form, 'invoiceDate', 'Invoice date'),
        dueDate: requireString(form, 'dueDate', 'Due date'),
        net: requireMoney(form, 'net', 'Net amount'),
        tax: requireMoney(form, 'tax', 'GST amount'),
        lineDescriptions: description ? [description] : [],
        allocations: readAllocations(form),
        ...(rounding ? { roundingAdjustment: rounding } : {}),
        ...(intakeId ? { intakeId: asId<'InvoiceIntake'>(intakeId) } : {}),
      });
      revalidate(projectId);
      return { number: invoice.number };
    },
  );
}

/** INV10 — edit; a material change appends a revision and needs renewed approval. */
export async function updateInvoiceAction(_previous: ActionResult<unknown>, form: FormData): Promise<ActionResult<unknown>> {
  return runAction('Invoice saved', () => {
    const { invoiceId, projectId } = projectOfInvoice(form);
    const net = optionalMoney(form, 'net');
    const tax = optionalMoney(form, 'tax');
    const rounding = optionalMoney(form, 'roundingAdjustment');
    const description = readString(form, 'lineDescription');
    const hasRows = form.getAll('allocCostLineId').length > 0;
    const changes: DraftChanges = {
      ...(readString(form, 'supplierId') ? { supplierId: asId<'Supplier'>(readString(form, 'supplierId') as string) } : {}),
      ...(readString(form, 'number') ? { number: readString(form, 'number') } : {}),
      ...(readString(form, 'invoiceDate') ? { invoiceDate: readString(form, 'invoiceDate') } : {}),
      ...(readString(form, 'dueDate') ? { dueDate: readString(form, 'dueDate') } : {}),
      ...(net ? { net } : {}),
      ...(tax ? { tax } : {}),
      ...(description !== undefined ? { lineDescriptions: [description] } : {}),
      ...(hasRows ? { allocations: readAllocations(form) } : {}),
      ...(rounding ? { roundingAdjustment: rounding } : {}),
      ...(readString(form, 'scheduledPaymentDate') ? { scheduledPaymentDate: readString(form, 'scheduledPaymentDate') } : {}),
      ...(readRevision(form) !== undefined ? { expectedRevision: readRevision(form) } : {}),
    };
    const updated = invoicesApi.updateDraft(invoiceId, changes);
    revalidate(projectId);
    return updated;
  });
}

export async function markReadyAction(_previous: ActionResult<unknown>, form: FormData): Promise<ActionResult<unknown>> {
  return runAction('Invoice is ready for approval', () => {
    const { invoiceId, projectId } = projectOfInvoice(form);
    const updated = invoicesApi.markReady(invoiceId, readBoolean(form, 'acknowledgeWarnings'));
    revalidate(projectId);
    return updated;
  });
}

export async function submitInvoiceAction(_previous: ActionResult<unknown>, form: FormData): Promise<ActionResult<unknown>> {
  return runAction('Submitted for approval', () => {
    const { invoiceId, projectId } = projectOfInvoice(form);
    const updated = invoicesApi.submit(invoiceId, readBoolean(form, 'acknowledgeWarnings'));
    revalidate(projectId);
    return updated;
  });
}

export async function holdInvoiceAction(_previous: ActionResult<unknown>, form: FormData): Promise<ActionResult<unknown>> {
  return runAction('Invoice on hold', () => {
    const { invoiceId, projectId } = projectOfInvoice(form);
    const updated = invoicesApi.hold(invoiceId, readString(form, 'reason') ?? '');
    revalidate(projectId);
    return updated;
  });
}

export async function releaseHoldAction(_previous: ActionResult<unknown>, form: FormData): Promise<ActionResult<unknown>> {
  return runAction(
    (invoice: { reviewState: string }) => `Hold released · now ${invoice.reviewState.replace('-', ' ')}`,
    () => {
      const { invoiceId, projectId } = projectOfInvoice(form);
      const updated = invoicesApi.releaseHold(invoiceId);
      revalidate(projectId);
      return updated;
    },
  );
}

/** INV09/INV11 — approve, hold or reject. Approval never reports the invoice as paid. */
export async function decideInvoiceAction(_previous: ActionResult<unknown>, form: FormData): Promise<ActionResult<unknown>> {
  return runAction(
    (result: { reviewState: string }) =>
      result.reviewState === 'approved' ? 'Approved · not synced · no accounting connection' : `Decision recorded · ${result.reviewState.replace('-', ' ')}`,
    () => {
      const { invoiceId, projectId } = projectOfInvoice(form);
      const decision = readChoice(form, 'decision', DECISIONS);
      if (!decision) throw new ValidationError('Choose a decision.');
      const result = invoicesApi.decide(invoiceId, {
        decision,
        invoiceRevision: requireString(form, 'revisionId', 'Revision'),
        ...(readString(form, 'reason') ? { reason: readString(form, 'reason') } : {}),
        ...(readString(form, 'scheduledPaymentDate') ? { scheduledPaymentDate: readString(form, 'scheduledPaymentDate') } : {}),
      });
      revalidate(projectId);
      return result;
    },
  );
}

export async function voidInvoiceAction(_previous: ActionResult<unknown>, form: FormData): Promise<ActionResult<unknown>> {
  return runAction('Invoice voided · record kept', () => {
    const { invoiceId, projectId } = projectOfInvoice(form);
    const updated = invoicesApi.voidInvoice(invoiceId, readString(form, 'reason') ?? '');
    revalidate(projectId);
    return updated;
  });
}

export async function overrideDuplicateAction(_previous: ActionResult<unknown>, form: FormData): Promise<ActionResult<unknown>> {
  return runAction('Duplicate override recorded', () => {
    const { invoiceId, projectId } = projectOfInvoice(form);
    const updated = invoicesApi.overrideDuplicate(invoiceId, requireString(form, 'suspectInvoiceId', 'Suspected duplicate'), readString(form, 'reason') ?? '');
    revalidate(projectId);
    return updated;
  });
}

export async function dismissSimilarityAction(_previous: ActionResult<unknown>, form: FormData): Promise<ActionResult<unknown>> {
  return runAction('Similarity warning dismissed', () => {
    const { invoiceId, projectId } = projectOfInvoice(form);
    const updated = invoicesApi.dismissSimilarity(invoiceId, requireString(form, 'suspectInvoiceId', 'Similar invoice'), readString(form, 'reason') ?? '');
    revalidate(projectId);
    return updated;
  });
}

export async function addInvoiceCommentAction(_previous: ActionResult<unknown>, form: FormData): Promise<ActionResult<unknown>> {
  return runAction('Comment added', () => {
    const { invoiceId, projectId } = projectOfInvoice(form);
    const updated = invoicesApi.addComment(invoiceId, readString(form, 'text') ?? '');
    revalidate(projectId);
    return updated;
  });
}

/** INV13 — manual payment evidence with an optional first allocation. */
export async function recordPaymentAction(_previous: ActionResult<unknown>, form: FormData): Promise<ActionResult<unknown>> {
  return runAction('Payment recorded', () => {
    const projectId = requireString(form, 'projectId', 'Project');
    const allocInvoiceId = readString(form, 'allocInvoiceId');
    const allocAmount = optionalMoney(form, 'allocAmount');
    const supplierId = readString(form, 'supplierId');
    const payment = invoicesApi.recordPayment(projectId, {
      amount: requireMoney(form, 'amount', 'Amount'),
      direction: readChoice(form, 'direction', ['outflow', 'inflow'] as const) ?? 'outflow',
      effectiveDate: requireString(form, 'effectiveDate', 'Payment date'),
      reference: requireString(form, 'reference', 'Reference'),
      ...(supplierId ? { supplierId: asId<'Supplier'>(supplierId) } : {}),
      ...(readString(form, 'sourceId') ? { sourceId: readString(form, 'sourceId') } : {}),
      ...(readString(form, 'note') ? { note: readString(form, 'note') } : {}),
      ...(allocInvoiceId && allocAmount
        ? {
            allocations: [
              {
                invoiceId: asId<'Invoice'>(allocInvoiceId),
                amount: allocAmount,
                settlementType: readChoice(form, 'allocType', ['cash', 'refund', 'retention-release'] as const) ?? 'cash',
              },
            ],
          }
        : {}),
    });
    revalidate(projectId);
    return payment;
  });
}

/** AT23 — a controlled adjustment; the original stays as recorded. */
export async function reversePaymentAction(_previous: ActionResult<unknown>, form: FormData): Promise<ActionResult<unknown>> {
  return runAction('Payment reversed · adjustment recorded', () => {
    const paymentId = requireString(form, 'paymentId', 'Payment');
    const payment = invoicesApi.reversePayment(paymentId, readString(form, 'reason') ?? '', readString(form, 'effectiveDate'));
    revalidate(payment.projectId);
    return payment;
  });
}

export async function allocateSettlementAction(_previous: ActionResult<unknown>, form: FormData): Promise<ActionResult<unknown>> {
  return runAction('Settlement allocated', () => {
    const { invoiceId, projectId } = projectOfInvoice(form);
    const source = readString(form, 'source') ?? '';
    const [kind, sourceId] = source.split(':');
    const settlementType = readChoice(form, 'settlementType', SETTLEMENT_TYPES) ?? (kind === 'credit' ? 'credit' : 'cash');
    const allocation = invoicesApi.allocateSettlement({
      invoiceId,
      ...(kind === 'payment' && sourceId ? { paymentId: sourceId } : {}),
      ...(kind === 'credit' && sourceId ? { creditNoteInvoiceId: sourceId } : {}),
      amount: requireMoney(form, 'amount', 'Amount'),
      settlementType,
    });
    revalidate(projectId);
    return allocation;
  });
}

export async function addRetentionAction(_previous: ActionResult<unknown>, form: FormData): Promise<ActionResult<unknown>> {
  return runAction('Retention recorded', () => {
    const { invoiceId, projectId } = projectOfInvoice(form);
    const tranche = invoicesApi.addRetention(invoiceId, {
      amount: requireMoney(form, 'amount', 'Retention amount'),
      releaseCondition: readString(form, 'releaseCondition') ?? '',
      forecastReleaseDate: requireString(form, 'forecastReleaseDate', 'Forecast release date'),
    });
    revalidate(projectId);
    return tranche;
  });
}

export async function releaseRetentionAction(_previous: ActionResult<unknown>, form: FormData): Promise<ActionResult<unknown>> {
  return runAction('Retention released', () => {
    const tranche = invoicesApi.releaseRetention(requireString(form, 'trancheId', 'Retention'), requireString(form, 'paymentId', 'Payment'));
    revalidate(tranche.projectId);
    return tranche;
  });
}

/** INT07 — dry run: nothing is created until the preview is confirmed. */
export async function dryRunImportAction(_previous: ActionResult<unknown>, form: FormData): Promise<ActionResult<unknown>> {
  return runAction(
    (record: { totals: { rows: number; new: number; duplicates: number; invalid: number } }) =>
      `Dry run · ${record.totals.rows} rows · ${record.totals.new} new · ${record.totals.duplicates} duplicate · ${record.totals.invalid} invalid`,
    async () => {
      const projectId = requireString(form, 'projectId', 'Project');
      const upload = await readUpload(form, 'csvFile');
      const csvText = upload ? new TextDecoder().decode(upload.bytes) : (readString(form, 'csvText') ?? '');
      const result = invoicesApi.paymentImport(projectId, { csvText, ...(upload ? { filename: upload.name } : {}) });
      revalidate(projectId);
      return result as { totals: { rows: number; new: number; duplicates: number; invalid: number } };
    },
  );
}

export async function confirmImportAction(_previous: ActionResult<unknown>, form: FormData): Promise<ActionResult<unknown>> {
  return runAction(
    (result: { payments: readonly unknown[]; matched: number; unmatched: number }) =>
      `Import confirmed · ${result.payments.length} payments · ${result.matched} matched · ${result.unmatched} to reconcile`,
    () => {
      const projectId = requireString(form, 'projectId', 'Project');
      const result = invoicesApi.paymentImport(projectId, { confirmImportId: requireString(form, 'importId', 'Import') });
      revalidate(projectId);
      return result as { payments: readonly unknown[]; matched: number; unmatched: number };
    },
  );
}

/** INV15 — match all or part (a split) of an open item. */
export async function matchItemAction(_previous: ActionResult<unknown>, form: FormData): Promise<ActionResult<unknown>> {
  return runAction(
    (item: { state: string }) => (item.state === 'matched' ? 'Matched · removed from suspense' : 'Part matched · remainder stays in the queue'),
    () => {
      const item = invoicesApi.matchItem(requireString(form, 'itemId', 'Item'), requireString(form, 'invoiceId', 'Invoice'), requireMoney(form, 'amount', 'Amount'));
      revalidate(item.projectId);
      return item;
    },
  );
}

export async function excludeItemAction(_previous: ActionResult<unknown>, form: FormData): Promise<ActionResult<unknown>> {
  return runAction('Excluded from the project', () => {
    const item = invoicesApi.excludeItem(requireString(form, 'itemId', 'Item'), readString(form, 'reason') ?? '');
    revalidate(item.projectId);
    return item;
  });
}
