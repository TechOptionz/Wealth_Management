/**
 * Development Finance — invoice intake, review, approval, settlement and
 * reconciliation (INV01–INV15, CST06, CST07, INT07; AT05–AT08, AT10, AT23).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { accessService } from '@/modules/access/service';
import { USER_IDS } from '@/modules/access/data/seed';
import { projectsRepository } from '@/modules/projects/repository';
import { projectsService } from '@/modules/projects/service';
import { PROJECT_IDS } from '@/modules/projects/data/seed';
import { budgetsRepository } from '@/modules/budgets/repository';
import { commitmentsRepository } from '@/modules/commitments/repository';
import { COMMITMENT_IDS, COST_LINE_IDS, SUPPLIER_IDS } from '@/modules/commitments/data/seed';
import { invoicesRepository } from '@/modules/invoices/repository';
import { invoicesService, type CreateInvoiceInput } from '@/modules/invoices/service';
import { invoicesApi } from '@/modules/invoices/api';
import { captureInvoiceAction } from '@/modules/invoices/actions';
import { INVOICE_IDS, PAYMENT_IDS, RECONCILIATION_ITEM_IDS } from '@/modules/invoices/data/seed';
import { fromMajorUnits, money } from '@/shared/lib/money';
import type { InvoiceId } from '@/shared/types/common';
import { ConflictError, ForbiddenError, ValidationError } from '@/shared/lib/errors';
import { IDLE_RESULT, type ActionResult } from '@/shared/lib/action-result';

const idle = IDLE_RESULT as ActionResult<unknown>;
const RIVERSIDE = PROJECT_IDS.riverside;
const $ = (dollars: number): number => Math.round(dollars * 100);
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a]);

beforeEach(() => {
  projectsRepository.reset();
  budgetsRepository.reset();
  commitmentsRepository.reset();
  invoicesRepository.reset();
});
afterEach(() => accessService.switchUser(USER_IDS.jawad));

function capture(overrides: Partial<CreateInvoiceInput> = {}): InvoiceId {
  const net = overrides.net ?? fromMajorUnits(1_000);
  const tax = overrides.tax ?? money(Math.round(net.cents / 10));
  return invoicesService.createInvoice({
    projectId: RIVERSIDE,
    type: 'invoice',
    supplierId: SUPPLIER_IDS.harbourLegal,
    number: `HL-${Math.random().toString(36).slice(2, 8)}`,
    invoiceDate: '2026-09-04',
    dueDate: '2026-09-30',
    lineDescriptions: ['Legal advice'],
    allocations: [{ costLineId: COST_LINE_IDS.acq03, net, tax, taxTreatment: 'standard-gst', allowanceTreatment: 'consume-allowance' }],
    actor: USER_IDS.accountant,
    ...overrides,
    net,
    tax,
  }).id;
}

function approve(invoiceId: InvoiceId, approver = USER_IDS.jawad) {
  const invoice = invoicesService.requireInvoice(invoiceId);
  if (invoice.reviewState !== 'awaiting-approval') invoicesService.submitForApproval(invoiceId, USER_IDS.accountant);
  return invoicesService.decide({ invoiceId, revisionId: invoicesService.requireInvoice(invoiceId).currentRevisionId, actor: approver, decision: 'approved' });
}

describe('INV01 · intake', () => {
  it('bad magic bytes leave a visible failed intake and create no invoice', async () => {
    const intake = invoicesService.createIntake({ projectId: RIVERSIDE, filename: 'claim.pdf', mimeType: 'application/pdf', sizeBytes: 4, bytes: new Uint8Array([1, 2, 3, 4]), actor: USER_IDS.accountant });
    expect(intake.scanState).toBe('failed');
    expect(intake.checksumSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(() => capture({ intakeId: intake.id })).toThrow(ConflictError);

    const before = invoicesService.listInvoices(RIVERSIDE).length;
    const form = new FormData();
    form.append('projectId', RIVERSIDE);
    form.append('document', new File([new Uint8Array([0, 1, 2])], 'scan.pdf', { type: 'application/pdf' }));
    const result = await captureInvoiceAction(idle, form);
    expect(result.ok).toBe(true);
    expect(result.message).toMatch(/failed its checks · no invoice created/);
    expect(invoicesService.listInvoices(RIVERSIDE)).toHaveLength(before);
    expect(invoicesService.listIntakes(RIVERSIDE).filter((row) => row.scanState === 'failed')).toHaveLength(2);
  });

  it('refuses a file over 20 MB; a real PDF is clean and checksummed', () => {
    expect(() =>
      invoicesService.createIntake({ projectId: RIVERSIDE, filename: 'huge.pdf', mimeType: 'application/pdf', sizeBytes: 20 * 1024 * 1024 + 1, actor: USER_IDS.accountant }),
    ).toThrow(ValidationError);
    const intake = invoicesService.createIntake({ projectId: RIVERSIDE, filename: 'ok.pdf', mimeType: 'application/pdf', sizeBytes: PDF.length, bytes: PDF, actor: USER_IDS.accountant });
    expect(intake.scanState).toBe('clean');
    const invoiceId = capture({ intakeId: intake.id });
    expect(invoicesService.requireIntake(intake.id).invoiceId).toBe(invoiceId);
    expect(invoicesService.requireInvoice(invoiceId).reviewState).toBe('needs-review');
    expect(invoicesService.currentRevision(invoicesService.requireInvoice(invoiceId)).extraction).toEqual({ source: 'manual', confidence: null, fields: {} });
  });
});

describe('INV06 / INV07 · validation', () => {
  it('allocations must match; a one-cent difference needs an explicit rounding adjustment', () => {
    const allocations = [{ costLineId: COST_LINE_IDS.acq03, net: money(33_333), tax: money(3_333), taxTreatment: 'standard-gst' as const, allowanceTreatment: 'consume-allowance' as const }];
    expect(() => capture({ net: money(33_334), tax: money(3_333), allocations })).toThrow(/rounding adjustment/);
    const id = capture({ net: money(33_334), tax: money(3_333), allocations, roundingAdjustment: money(1) });
    expect(invoicesService.currentRevision(invoicesService.requireInvoice(id)).roundingAdjustment.cents).toBe(1);
    expect(() => capture({ net: money(33_340), tax: money(3_333), allocations, roundingAdjustment: money(7) })).toThrow(ValidationError);
    expect(() => capture({ net: fromMajorUnits(-5) })).toThrow(ValidationError);
  });

  it('direct spend needs an allowance choice before it can be ready (CST06)', () => {
    const id = capture({ allocations: [{ costLineId: COST_LINE_IDS.acq03, net: fromMajorUnits(1_000), tax: fromMajorUnits(100), taxTreatment: 'standard-gst' }] });
    expect(() => invoicesService.markReady(id, USER_IDS.accountant)).toThrow(/consumes the line allowance or is additional scope/);
  });

  it('a due date before the invoice date must be acknowledged; a closed-period date needs a finance reviewer', () => {
    const early = capture({ dueDate: '2026-09-01' });
    expect(() => invoicesService.markReady(early, USER_IDS.mahvish)).toThrow(ValidationError);
    expect(invoicesService.markReady(early, USER_IDS.mahvish, { acknowledgeWarnings: true }).reviewState).toBe('ready');

    // INV-1006 is dated in closed August.
    expect(() => invoicesService.markReady(INVOICE_IDS.inv1006, USER_IDS.mahvish, { acknowledgeWarnings: true })).toThrow(ForbiddenError);
  });

  it('credit notes are their own type and never collide with invoice numbering', () => {
    const credit = capture({ type: 'credit-note', number: 'INV-1005', supplierId: SUPPLIER_IDS.harbourLegal });
    expect(invoicesService.duplicateFindings(credit).exact).toEqual([]);
    expect(invoicesService.duplicateFindings(INVOICE_IDS.inv1005).exact).toEqual([]);
  });
});

describe('INV04 · duplicates (AT06)', () => {
  it('an exact duplicate blocks submission until a finance user overrides with a reason', () => {
    expect(invoicesService.duplicateFindings(INVOICE_IDS.inv1006).exact).toEqual([INVOICE_IDS.inv1002]);
    invoicesService.markReady(INVOICE_IDS.inv1006, USER_IDS.accountant, { acknowledgeWarnings: true });
    expect(() => invoicesService.submitForApproval(INVOICE_IDS.inv1006, USER_IDS.accountant)).toThrow(ConflictError);
    expect(() =>
      invoicesService.overrideDuplicate({ invoiceId: INVOICE_IDS.inv1006, suspectInvoiceId: INVOICE_IDS.inv1002, reason: 'Separate stage claim', actor: USER_IDS.mahvish }),
    ).toThrow(ForbiddenError);
    expect(() =>
      invoicesService.overrideDuplicate({ invoiceId: INVOICE_IDS.inv1006, suspectInvoiceId: INVOICE_IDS.inv1002, reason: ' ', actor: USER_IDS.accountant }),
    ).toThrow(ValidationError);
    invoicesService.overrideDuplicate({ invoiceId: INVOICE_IDS.inv1006, suspectInvoiceId: INVOICE_IDS.inv1002, reason: 'Supplier confirmed separate claim', actor: USER_IDS.accountant });
    expect(invoicesService.submitForApproval(INVOICE_IDS.inv1006, USER_IDS.accountant).reviewState).toBe('awaiting-approval');
  });

  it('a near match warns and needs a reason to dismiss', () => {
    const first = capture({ number: 'HL-A1', invoiceDate: '2026-09-02' });
    const second = capture({ number: 'HL-B7', invoiceDate: '2026-09-05' });
    expect(invoicesService.duplicateFindings(second).similar).toContain(first);
    expect(() => invoicesService.submitForApproval(second, USER_IDS.accountant)).toThrow(/Dismiss the warning/);
    expect(() => invoicesService.dismissSimilarity({ invoiceId: second, suspectInvoiceId: first, reason: '', actor: USER_IDS.accountant })).toThrow(ValidationError);
    invoicesService.dismissSimilarity({ invoiceId: second, suspectInvoiceId: first, reason: 'Two separate searches', actor: USER_IDS.accountant });
    invoicesService.dismissSimilarity({ invoiceId: first, suspectInvoiceId: second, reason: 'Two separate searches', actor: USER_IDS.accountant });
    expect(invoicesService.submitForApproval(second, USER_IDS.accountant).reviewState).toBe('awaiting-approval');
  });
});

describe('INV09 / IAM04 · approval authority (AT07)', () => {
  it('finance officer cannot decide; submitter cannot approve own; mahvish cannot approve $198k; jawad can', () => {
    const revisionId = invoicesService.requireInvoice(INVOICE_IDS.inv1004).currentRevisionId;
    accessService.switchUser(USER_IDS.accountant);
    expect(() => invoicesApi.decide(INVOICE_IDS.inv1004, { decision: 'approved', invoiceRevision: revisionId })).toThrow(ForbiddenError);
    accessService.switchUser(USER_IDS.mahvish);
    expect(() => invoicesApi.decide(INVOICE_IDS.inv1004, { decision: 'approved', invoiceRevision: revisionId })).toThrow(ForbiddenError);
    accessService.switchUser(USER_IDS.jawad);

    const own = capture();
    invoicesService.submitForApproval(own, USER_IDS.jawad);
    expect(() =>
      invoicesService.decide({ invoiceId: own, revisionId: invoicesService.requireInvoice(own).currentRevisionId, actor: USER_IDS.jawad, decision: 'approved' }),
    ).toThrow(/another person must approve/);

    const result = invoicesApi.decide(INVOICE_IDS.inv1004, { decision: 'approved', invoiceRevision: revisionId, scheduledPaymentDate: '2026-10-10' });
    expect(result.reviewState).toBe('approved');
    expect(result.syncState).toBe('not-queued');
  });

  it('a repeated decision is idempotent — one decision row (INV09)', () => {
    const revisionId = invoicesService.requireInvoice(INVOICE_IDS.inv1004).currentRevisionId;
    const first = invoicesApi.decide(INVOICE_IDS.inv1004, { decision: 'approved', invoiceRevision: revisionId });
    const second = invoicesApi.decide(INVOICE_IDS.inv1004, { decision: 'approved', invoiceRevision: revisionId });
    expect(second.approvalEventId).toBe(first.approvalEventId);
    expect(invoicesService.listApprovalDecisions(INVOICE_IDS.inv1004)).toHaveLength(1);
  });

  it('two approvers must be distinct when the policy step asks for two', () => {
    projectsService.newPolicyVersion(RIVERSIDE, { approval: { steps: [{ minimumGross: money(0), approversRequired: 1 }, { minimumGross: fromMajorUnits(150_000), approversRequired: 2 }] } }, USER_IDS.jawad, 'Two-person rule');
    projectsService.grantAccess({ projectId: RIVERSIDE, userId: USER_IDS.operator, role: 'approver', grants: [], approvalLimit: fromMajorUnits(250_000), actor: USER_IDS.jawad });
    const revisionId = invoicesService.requireInvoice(INVOICE_IDS.inv1004).currentRevisionId;
    const first = invoicesService.decide({ invoiceId: INVOICE_IDS.inv1004, revisionId, actor: USER_IDS.jawad, decision: 'approved' });
    expect(first.invoice.reviewState).toBe('awaiting-approval');
    const again = invoicesService.decide({ invoiceId: INVOICE_IDS.inv1004, revisionId, actor: USER_IDS.jawad, decision: 'approved' });
    expect(again.decision.id).toBe(first.decision.id);
    const second = invoicesService.decide({ invoiceId: INVOICE_IDS.inv1004, revisionId, actor: USER_IDS.operator, decision: 'approved' });
    expect(second.invoice.reviewState).toBe('approved');
    expect(second.decision.stepIndex).toBe(1);
  });

  it('hold and reject need reasons; releasing a hold revalidates; a stale revision is refused', () => {
    const revisionId = invoicesService.requireInvoice(INVOICE_IDS.inv1004).currentRevisionId;
    expect(() => invoicesService.decide({ invoiceId: INVOICE_IDS.inv1004, revisionId, actor: USER_IDS.jawad, decision: 'rejected' })).toThrow(ValidationError);
    expect(() => invoicesService.decide({ invoiceId: INVOICE_IDS.inv1004, revisionId: 'stale' as never, actor: USER_IDS.jawad, decision: 'approved' })).toThrow(ConflictError);
    expect(invoicesService.releaseHold(INVOICE_IDS.inv1007, USER_IDS.accountant).reviewState).toBe('awaiting-approval');
    expect(() => invoicesService.hold(INVOICE_IDS.inv1005, USER_IDS.accountant, '')).toThrow(ValidationError);
  });
});

describe('INV11 · approval is local', () => {
  it('creates a not-configured OutboxEvent, bumps the model revision and never reports Paid', () => {
    const before = projectsService.require(RIVERSIDE).modelRevision;
    const events = invoicesService.listOutboxEvents(RIVERSIDE).length;
    const result = approve(INVOICE_IDS.inv1004);
    expect(result.newModelRevision).toBe(before + 1);
    expect(result.syncState).toBe('not-queued');
    const outbox = invoicesService.listOutboxEvents(RIVERSIDE);
    expect(outbox).toHaveLength(events + 1);
    expect(outbox[outbox.length - 1]).toMatchObject({ type: 'invoice.approved', status: 'not-configured' });
    expect(invoicesService.settlementSummary(INVOICE_IDS.inv1004).state).toBe('unpaid');
  });
});

describe('INV10 · approved revisions are frozen (AT08)', () => {
  it('a material edit after approval appends a revision; the approved one is unchanged and still counts', () => {
    const invoice = invoicesService.requireInvoice(INVOICE_IDS.inv1003);
    const approvedBefore = invoicesService.approvedRevision(invoice);
    const updated = invoicesService.updateDraft(
      invoice.id,
      {
        net: fromMajorUnits(230_000),
        tax: fromMajorUnits(23_000),
        allocations: [{ costLineId: COST_LINE_IDS.con01, commitmentId: COMMITMENT_IDS.c002, net: fromMajorUnits(230_000), tax: fromMajorUnits(23_000), taxTreatment: 'standard-gst' }],
      },
      USER_IDS.accountant,
    );
    expect(updated.reviewState).toBe('needs-review');
    expect(updated.approvedRevisionId).toBe(approvedBefore?.id);
    expect(updated.currentRevisionId).not.toBe(approvedBefore?.id);
    expect(invoicesService.listRevisions(invoice.id)).toHaveLength(2);
    const approvedAfter = invoicesService.approvedRevision(updated);
    expect(approvedAfter).toEqual(approvedBefore);
    expect(approvedAfter?.frozen).toBe(true);
    const views = invoicesService.approvedAllocationsByLine(RIVERSIDE).get(COST_LINE_IDS.con01) ?? [];
    expect(views.find((view) => view.invoiceId === invoice.id)?.gross.cents).toBe($(242_000));
    expect(invoicesService.listOutboxEvents(RIVERSIDE).some((event) => event.type === 'invoice.corrected')).toBe(true);
  });

  it('comments append without creating a revision', () => {
    const updated = invoicesService.addComment(INVOICE_IDS.inv1005, 'Checked against engagement letter', USER_IDS.mahvish);
    expect(updated.comments).toHaveLength(1);
    expect(invoicesService.listRevisions(INVOICE_IDS.inv1005)).toHaveLength(1);
  });
});

describe('CST06 · direct spend treatment (AT05)', () => {
  it('consume-allowance and additional-scope surface in approvedAllocationsByLine', () => {
    invoicesService.submitForApproval(INVOICE_IDS.inv1005, USER_IDS.accountant);
    approve(INVOICE_IDS.inv1005);
    const scope = capture({
      allocations: [{ costLineId: COST_LINE_IDS.acq03, net: fromMajorUnits(1_000), tax: fromMajorUnits(100), taxTreatment: 'standard-gst', allowanceTreatment: 'additional-scope' }],
    });
    approve(scope);
    const views = invoicesService.approvedAllocationsByLine(RIVERSIDE).get(COST_LINE_IDS.acq03) ?? [];
    expect(views.find((view) => view.invoiceId === INVOICE_IDS.inv1005)).toMatchObject({ allowanceTreatment: 'consume-allowance', commitmentId: null });
    expect(views.find((view) => view.invoiceId === scope)).toMatchObject({ allowanceTreatment: 'additional-scope' });
    const view = views.find((row) => row.invoiceId === INVOICE_IDS.inv1005);
    expect(view?.gross.cents).toBe($(15_950));
    expect(view?.recoverableTax.cents).toBe($(1_450));
    expect(view?.economic.cents).toBe($(14_500));
  });

  it('credit notes carry sign −1 with positive magnitudes', () => {
    const views = invoicesService.approvedAllocationsByLine(RIVERSIDE).get(COST_LINE_IDS.prof01) ?? [];
    const credit = views.find((view) => view.invoiceId === INVOICE_IDS.cn1001);
    expect(credit).toMatchObject({ sign: -1, type: 'credit-note' });
    expect(credit?.gross.cents).toBe($(4_400));
  });
});

describe('INV13 / CST07 · settlement (AT10)', () => {
  it('seeded states are derived: reconciled, part paid, credit applied, retention held', () => {
    expect(invoicesService.settlementSummary(INVOICE_IDS.inv1001).state).toBe('reconciled');
    const inv1002 = invoicesService.settlementSummary(INVOICE_IDS.inv1002);
    expect(inv1002.state).toBe('part-paid');
    expect(inv1002.unpaidBalance.cents).toBe($(18_400));
    expect(invoicesService.settlementSummary(INVOICE_IDS.cn1001).state).toBe('paid');
    const unpaid = invoicesService.approvedUnpaidByLine(RIVERSIDE).get(COST_LINE_IDS.con01) ?? [];
    expect(unpaid.find((row) => row.invoiceId === INVOICE_IDS.inv1003)).toMatchObject({
      gross: money($(242_000)),
      retention: money($(22_000)),
      retentionForecastReleaseDate: '2028-06-30',
      expectedPaymentDate: '2026-09-14',
    });
    expect(invoicesService.awaitingApprovalCount(RIVERSIDE)).toBe(1);
  });

  it('partial payment + retention + credit + refund reconcile, with every settlement listed', () => {
    const credit = capture({ type: 'credit-note', supplierId: SUPPLIER_IDS.brisbaneCivil, number: 'BCB-CN-1', net: fromMajorUnits(10_000), allocations: [{ costLineId: COST_LINE_IDS.con01, commitmentId: COMMITMENT_IDS.c002, net: fromMajorUnits(10_000), tax: fromMajorUnits(1_000), taxTreatment: 'standard-gst' }] });
    approve(credit);
    invoicesService.recordPayment({
      projectId: RIVERSIDE, amount: fromMajorUnits(150_000), direction: 'outflow', effectiveDate: '2026-09-05', reference: 'INV-1003 part', actor: USER_IDS.accountant,
      allocations: [{ invoiceId: INVOICE_IDS.inv1003, amount: fromMajorUnits(150_000), settlementType: 'cash' }],
    });
    invoicesService.allocateSettlement({ creditNoteInvoiceId: credit, invoiceId: INVOICE_IDS.inv1003, amount: fromMajorUnits(11_000), settlementType: 'credit', actor: USER_IDS.accountant });
    invoicesService.recordPayment({
      projectId: RIVERSIDE, amount: fromMajorUnits(5_000), direction: 'inflow', effectiveDate: '2026-09-06', reference: 'Overpayment refund', actor: USER_IDS.accountant,
      allocations: [{ invoiceId: INVOICE_IDS.inv1003, amount: fromMajorUnits(5_000), settlementType: 'refund' }],
    });
    const summary = invoicesService.settlementSummary(INVOICE_IDS.inv1003);
    expect(summary).toMatchObject({
      gross: money($(242_000)),
      paidCash: money($(150_000)),
      appliedCredits: money($(11_000)),
      refunds: money($(5_000)),
      retentionHeld: money($(22_000)),
      unpaidBalance: money($(86_000)),
      state: 'part-paid',
    });
    expect(invoicesService.settlementsByInvoice(INVOICE_IDS.inv1003)).toHaveLength(3);
    expect(() => invoicesService.allocateSettlement({ creditNoteInvoiceId: credit, invoiceId: INVOICE_IDS.inv1003, amount: money(1), settlementType: 'credit', actor: USER_IDS.accountant })).toThrow(/unapplied/);
    expect(() => invoicesService.voidInvoice(INVOICE_IDS.inv1003, USER_IDS.jawad, 'Try')).toThrow(ConflictError);
  });

  it('paid is the balance within one cent, never a badge', () => {
    const id = capture({ net: money(10_001), tax: money(1_000) });
    approve(id);
    invoicesService.recordPayment({ projectId: RIVERSIDE, amount: money(11_000), direction: 'outflow', effectiveDate: '2026-09-06', reference: 'x', actor: USER_IDS.accountant, allocations: [{ invoiceId: id, amount: money(11_000), settlementType: 'cash' }] });
    expect(invoicesService.settlementSummary(id)).toMatchObject({ unpaidBalance: money(1), state: 'paid' });
  });

  it('retention is released by a payment and stays out of recognised cost', () => {
    const [tranche] = invoicesService.listRetention(INVOICE_IDS.inv1003);
    const payment = invoicesService.recordPayment({ projectId: RIVERSIDE, amount: fromMajorUnits(22_000), direction: 'outflow', effectiveDate: '2026-09-06', reference: 'Retention', actor: USER_IDS.accountant });
    invoicesService.releaseRetention({ trancheId: tranche!.id, paymentId: payment.id, actor: USER_IDS.accountant });
    expect(invoicesService.settlementSummary(INVOICE_IDS.inv1003)).toMatchObject({ retentionHeld: money(0), paidCash: money($(22_000)) });
    expect((invoicesService.approvedAllocationsByLine(RIVERSIDE).get(COST_LINE_IDS.con01) ?? []).find((view) => view.invoiceId === INVOICE_IDS.inv1003)?.gross.cents).toBe($(242_000));
  });
});

describe('AT23 · locked periods', () => {
  it('a reversal is a new dated-today payment; the original is unchanged; a manual locked-period payment is refused', () => {
    const original = invoicesService.requirePayment(PAYMENT_IDS.pay1001);
    const reversal = invoicesService.reversePayment({ paymentId: PAYMENT_IDS.pay1001, actor: USER_IDS.accountant, reason: 'Bank returned the payment' });
    expect(reversal).toMatchObject({ reversesPaymentId: PAYMENT_IDS.pay1001, effectiveDate: '2026-09-06', direction: 'inflow' });
    expect(invoicesService.requirePayment(PAYMENT_IDS.pay1001)).toEqual(original);
    expect(invoicesService.settlementSummary(INVOICE_IDS.inv1001)).toMatchObject({ refunds: money($(66_000)), unpaidBalance: money($(66_000)), state: 'unpaid' });
    expect(invoicesService.settlementsByInvoice(INVOICE_IDS.inv1001)).toHaveLength(2);
    expect(() => invoicesService.reversePayment({ paymentId: PAYMENT_IDS.pay1001, actor: USER_IDS.accountant, reason: 'again' })).toThrow(ConflictError);
    expect(() =>
      invoicesService.recordPayment({ projectId: RIVERSIDE, amount: fromMajorUnits(10), direction: 'outflow', effectiveDate: '2026-08-15', reference: 'late', actor: USER_IDS.accountant }),
    ).toThrow(ConflictError);
  });
});

describe('INT07 · payment CSV import', () => {
  const csv = [
    'Date,Amount,Reference,SourceId,Supplier,Currency',
    '2026-07-28,-66000.00,INV-1001,XR-7781,Meridian Design Studio,AUD',
    '2026-09-05,"-242,000.00",INV-1003,XR-9001,Brisbane Civil & Build Pty Ltd,AUD',
    '2026-09-05,-1200.00,Mystery,XR-9002,,AUD',
    '2026-09-05,-1200.00,Mystery again,XR-9002,,AUD',
    '31/02/2026,-10.00,Bad date,XR-9003,,AUD',
    '2026-09-05,-10.00,Wrong currency,XR-9004,,USD',
  ].join('\n');

  it('dry run reports duplicates by sourceId; confirm creates and auto-matches; a second confirm creates nothing', () => {
    const dryRun = invoicesService.dryRunPaymentImport({ projectId: RIVERSIDE, csvText: csv, filename: 'sept.csv', actor: USER_IDS.accountant });
    expect(dryRun.totals).toMatchObject({ rows: 6, new: 2, duplicates: 2, invalid: 2, amount: money($(243_200)) });
    expect(dryRun.rows.map((row) => row.status)).toEqual(['duplicate', 'new', 'new', 'duplicate', 'invalid', 'invalid']);
    const paymentsBefore = invoicesService.listPayments(RIVERSIDE).length;

    const confirmed = invoicesService.confirmPaymentImport({ importId: dryRun.id, actor: USER_IDS.accountant });
    expect(confirmed).toMatchObject({ matched: 1, unmatched: 1 });
    expect(confirmed.payments).toHaveLength(2);
    expect(invoicesService.settlementSummary(INVOICE_IDS.inv1003).unpaidBalance.cents).toBe(0);
    expect(invoicesService.unmatchedPayments(RIVERSIDE).map((row) => row.reference)).toContain('Mystery');

    const again = invoicesService.confirmPaymentImport({ importId: dryRun.id, actor: USER_IDS.accountant });
    expect(again.payments.map((row) => row.id)).toEqual(confirmed.payments.map((row) => row.id));
    expect(invoicesService.listPayments(RIVERSIDE)).toHaveLength(paymentsBefore + 2);
  });
});

describe('INV15 · reconciliation queue', () => {
  it('split matching leaves the remainder in suspense; the final match removes it atomically', () => {
    expect(invoicesService.unmatchedPayments(RIVERSIDE)).toEqual([
      { paymentId: PAYMENT_IDS.pay1003, effectiveDate: '2026-08-27', amount: money($(9_900)), reference: 'Unknown ref 4471' },
    ]);
    invoicesService.matchReconciliationItem({ itemId: RECONCILIATION_ITEM_IDS.unknown4471, invoiceId: INVOICE_IDS.inv1003, amount: fromMajorUnits(4_000), actor: USER_IDS.accountant });
    expect(invoicesService.unmatchedPayments(RIVERSIDE)[0]?.amount.cents).toBe($(5_900));
    const done = invoicesService.matchReconciliationItem({ itemId: RECONCILIATION_ITEM_IDS.unknown4471, invoiceId: INVOICE_IDS.inv1003, amount: fromMajorUnits(5_900), actor: USER_IDS.accountant });
    expect(done.state).toBe('matched');
    expect(invoicesService.unmatchedPayments(RIVERSIDE)).toEqual([]);
  });

  it('exclusion needs a reason; an external bill links an external authorisation', () => {
    expect(() => invoicesService.excludeReconciliationItem({ itemId: RECONCILIATION_ITEM_IDS.unknown4471, reason: '', actor: USER_IDS.accountant })).toThrow(ValidationError);
    const bill = invoicesService.recordExternalBill({ projectId: RIVERSIDE, reference: 'XERO-BILL-88', amount: fromMajorUnits(198_000), effectiveDate: '2026-09-05', actor: USER_IDS.accountant });
    invoicesService.matchReconciliationItem({ itemId: bill.id, invoiceId: INVOICE_IDS.inv1004, amount: fromMajorUnits(198_000), actor: USER_IDS.accountant });
    expect(invoicesService.requireInvoice(INVOICE_IDS.inv1004).externalAuthorisation?.reference).toBe('XERO-BILL-88');
    expect(invoicesService.requireInvoice(INVOICE_IDS.inv1004).reviewState).toBe('awaiting-approval');
  });
});

describe('INV12 · void and permissions', () => {
  it('void needs a reason, keeps the record, and removes it from duplicate matching', () => {
    expect(() => invoicesService.voidInvoice(INVOICE_IDS.inv1002, USER_IDS.jawad, ' ')).toThrow(ValidationError);
    expect(() => invoicesService.voidInvoice(INVOICE_IDS.inv1002, USER_IDS.jawad, 'Duplicate')).toThrow(/refund or adjustment first/);
    const voided = invoicesService.voidInvoice(INVOICE_IDS.inv1006, USER_IDS.jawad, 'Duplicate of MDS-2026-014');
    expect(voided.reviewState).toBe('void');
    expect(invoicesService.requireInvoice(INVOICE_IDS.inv1006)).toBeDefined();
    expect(invoicesService.duplicateFindings(INVOICE_IDS.inv1002).exact).toEqual([]);
  });

  it('the investor cannot list invoices; the finance officer cannot decide', () => {
    accessService.switchUser(USER_IDS.hassan);
    expect(() => invoicesApi.list(RIVERSIDE)).toThrow(ForbiddenError);
    accessService.switchUser(USER_IDS.accountant);
    expect(invoicesApi.list(RIVERSIDE).items.length).toBeGreaterThan(0);
    const revisionId = invoicesService.requireInvoice(INVOICE_IDS.inv1004).currentRevisionId;
    expect(() => invoicesApi.decide(INVOICE_IDS.inv1004, { decision: 'on-hold', invoiceRevision: revisionId, reason: 'x' })).toThrow(ForbiddenError);
  });

  it('the workspace view model renders for the owner', () => {
    const workspace = invoicesApi.workspace(RIVERSIDE);
    expect(workspace.counts.all).toBe(9);
    expect(workspace.details[INVOICE_IDS.inv1006]?.findings[0]).toMatchObject({ kind: 'exact', number: 'MDS-2026-014', resolved: false });
    expect(workspace.details[INVOICE_IDS.inv1004]?.approveBlocker).toBeNull();
    expect(workspace.suspenseTotal.cents).toBe($(9_900));
    expect(workspace.pendingVariationRisk.cents).toBe($(36_000));
  });
});
