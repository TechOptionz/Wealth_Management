/**
 * Seeded invoices, payments and settlements for Riverside Townhomes.
 *
 * GST 10%, fully recoverable. All dates on or before the 6 Sep 2026 as-of;
 * August is closed (actuals cutoff 31 Aug). A seed function must not read
 * another repository, so ids from sibling modules are spelled out.
 */
import { asId, type InvoiceId, type InvoiceRevisionId, type UserId } from '@/shared/types/common';
import { fromMajorUnits, money } from '@/shared/lib/money';
import { USER_IDS } from '@/modules/access/data/seed';
import { PROJECT_IDS } from '@/modules/projects/data/seed';
import { COMMITMENT_IDS, COST_LINE_IDS, STAGE_IDS, SUPPLIER_IDS } from '@/modules/commitments/data/seed';
import {
  normaliseInvoiceNumber,
  type ApprovalDecision,
  type Invoice,
  type InvoiceAllocation,
  type InvoiceIntake,
  type InvoiceRevision,
  type OutboxEvent,
  type Payment,
  type PaymentImport,
  type ReconciliationItem,
  type RetentionTranche,
  type SettlementAllocation,
} from '../model';

const RIVERSIDE = PROJECT_IDS.riverside;
const FULL = 1_000_000;

export const INVOICE_IDS = {
  inv1001: asId<'Invoice'>('inv-riverside-1001'),
  inv1002: asId<'Invoice'>('inv-riverside-1002'),
  cn1001: asId<'Invoice'>('inv-riverside-cn1001'),
  inv1003: asId<'Invoice'>('inv-riverside-1003'),
  inv1004: asId<'Invoice'>('inv-riverside-1004'),
  inv1005: asId<'Invoice'>('inv-riverside-1005'),
  inv1006: asId<'Invoice'>('inv-riverside-1006'),
  inv1007: asId<'Invoice'>('inv-riverside-1007'),
  inv1008: asId<'Invoice'>('inv-riverside-1008'),
};

export const PAYMENT_IDS = {
  pay1001: asId<'Payment'>('pay-riverside-1001'),
  pay1002: asId<'Payment'>('pay-riverside-1002'),
  pay1003: asId<'Payment'>('pay-riverside-1003'),
};

export const PAYMENT_IMPORT_IDS = {
  july: asId<'PaymentImport'>('pimp-riverside-2026-07'),
  august: asId<'PaymentImport'>('pimp-riverside-2026-08'),
};

export const RECONCILIATION_ITEM_IDS = {
  unknown4471: asId<'ReconciliationItem'>('rec-riverside-pay-1003'),
};

export const RETENTION_IDS = {
  inv1003: asId<'RetentionTranche'>('ret-riverside-1003'),
};

function revisionId(invoiceId: InvoiceId): InvoiceRevisionId {
  return asId<'InvoiceRevision'>(`${invoiceId}-r1`);
}

interface InvoiceSpec {
  readonly id: InvoiceId;
  readonly type?: Invoice['type'];
  readonly supplierId: Invoice['supplierId'];
  readonly number: string;
  readonly invoiceDate: string;
  readonly dueDate: string;
  readonly net: number;
  readonly allocation: Omit<InvoiceAllocation, 'id' | 'net' | 'tax' | 'taxTreatment' | 'recoverablePpm'>;
  readonly description: string;
  readonly reviewState: Invoice['reviewState'];
  readonly receivedAt: string;
  readonly submittedAt?: string;
  readonly warnings?: readonly string[];
  readonly intakeId?: Invoice['intakeId'];
  readonly extra?: Partial<Invoice>;
}

const SPECS: readonly InvoiceSpec[] = [
  {
    id: INVOICE_IDS.inv1001,
    supplierId: SUPPLIER_IDS.meridian,
    number: 'INV-1001',
    invoiceDate: '2026-07-15',
    dueDate: '2026-07-29',
    net: 60_000,
    allocation: { costLineId: COST_LINE_IDS.prof01, commitmentId: COMMITMENT_IDS.c001, stageId: STAGE_IDS.concept },
    description: 'Concept design stage · 100%',
    reviewState: 'approved',
    receivedAt: '2026-07-15T23:10:00.000Z',
    submittedAt: '2026-07-16T02:00:00.000Z',
  },
  {
    id: INVOICE_IDS.inv1002,
    supplierId: SUPPLIER_IDS.meridian,
    number: 'MDS-2026-014',
    invoiceDate: '2026-08-10',
    dueDate: '2026-08-31',
    net: 48_000,
    allocation: { costLineId: COST_LINE_IDS.prof01, commitmentId: COMMITMENT_IDS.c001, stageId: STAGE_IDS.da },
    description: 'Development application stage · progress claim 1',
    reviewState: 'approved',
    receivedAt: '2026-08-11T00:20:00.000Z',
    submittedAt: '2026-08-12T01:00:00.000Z',
    intakeId: asId<'InvoiceIntake'>('int-riverside-1002'),
  },
  {
    id: INVOICE_IDS.cn1001,
    type: 'credit-note',
    supplierId: SUPPLIER_IDS.meridian,
    number: 'CN-1001',
    invoiceDate: '2026-08-19',
    dueDate: '2026-08-19',
    net: 4_000,
    allocation: { costLineId: COST_LINE_IDS.prof01, commitmentId: COMMITMENT_IDS.c001, stageId: STAGE_IDS.da },
    description: 'Credit · DA drawings re-issue not required',
    reviewState: 'approved',
    receivedAt: '2026-08-19T03:00:00.000Z',
    submittedAt: '2026-08-19T05:00:00.000Z',
  },
  {
    id: INVOICE_IDS.inv1003,
    supplierId: SUPPLIER_IDS.brisbaneCivil,
    number: 'INV-1003',
    invoiceDate: '2026-08-28',
    dueDate: '2026-09-14',
    net: 220_000,
    allocation: { costLineId: COST_LINE_IDS.con01, commitmentId: COMMITMENT_IDS.c002 },
    description: 'Progress claim 1 · site establishment and bulk earthworks',
    reviewState: 'approved',
    receivedAt: '2026-08-28T22:00:00.000Z',
    submittedAt: '2026-08-29T01:30:00.000Z',
    extra: { scheduledPaymentDate: '2026-09-14' },
  },
  {
    id: INVOICE_IDS.inv1004,
    supplierId: SUPPLIER_IDS.brisbaneCivil,
    number: 'INV-1004',
    invoiceDate: '2026-09-03',
    dueDate: '2026-09-30',
    net: 180_000,
    allocation: { costLineId: COST_LINE_IDS.con01, commitmentId: COMMITMENT_IDS.c002 },
    description: 'Progress claim 2 · slab and services',
    reviewState: 'awaiting-approval',
    receivedAt: '2026-09-03T23:00:00.000Z',
    submittedAt: '2026-09-04T02:10:00.000Z',
    intakeId: asId<'InvoiceIntake'>('int-riverside-1004'),
  },
  {
    id: INVOICE_IDS.inv1005,
    supplierId: SUPPLIER_IDS.harbourLegal,
    number: 'INV-1005',
    invoiceDate: '2026-09-01',
    dueDate: '2026-09-15',
    net: 14_500,
    allocation: { costLineId: COST_LINE_IDS.acq03, allowanceTreatment: 'consume-allowance' },
    description: 'Conveyancing · land contract review',
    reviewState: 'needs-review',
    receivedAt: '2026-09-02T00:30:00.000Z',
  },
  {
    id: INVOICE_IDS.inv1006,
    supplierId: SUPPLIER_IDS.meridian,
    number: 'MDS 2026-014',
    invoiceDate: '2026-08-10',
    dueDate: '2026-08-31',
    net: 48_000,
    allocation: { costLineId: COST_LINE_IDS.prof01, commitmentId: COMMITMENT_IDS.c001, stageId: STAGE_IDS.da },
    description: 'Development application stage · progress claim 1 (re-sent by email)',
    reviewState: 'needs-review',
    receivedAt: '2026-09-05T01:15:00.000Z',
    intakeId: asId<'InvoiceIntake'>('int-riverside-1006'),
    warnings: ['closed-period'],
  },
  {
    id: INVOICE_IDS.inv1007,
    supplierId: SUPPLIER_IDS.brisbaneCivil,
    number: 'INV-1007',
    invoiceDate: '2026-09-02',
    dueDate: '2026-09-30',
    net: 42_000,
    allocation: { costLineId: COST_LINE_IDS.con02, allowanceTreatment: 'additional-scope' },
    description: 'Stormwater diversion · outside head contract scope',
    reviewState: 'on-hold',
    receivedAt: '2026-09-02T22:40:00.000Z',
    submittedAt: '2026-09-03T00:30:00.000Z',
    extra: { holdReason: 'Awaiting certifier sign-off' },
  },
  {
    id: INVOICE_IDS.inv1008,
    supplierId: SUPPLIER_IDS.harbourLegal,
    number: 'INV-1008',
    invoiceDate: '2026-09-02',
    dueDate: '2026-09-16',
    net: 3_000,
    allocation: { costLineId: COST_LINE_IDS.acq03, allowanceTreatment: 'consume-allowance' },
    description: 'Title search and advice',
    reviewState: 'rejected',
    receivedAt: '2026-09-03T02:00:00.000Z',
    submittedAt: '2026-09-03T04:00:00.000Z',
    extra: { rejectReason: 'Wrong project' },
  },
];

const APPROVALS: Readonly<Record<string, { readonly at: string; readonly by: UserId }>> = {
  [INVOICE_IDS.inv1001]: { at: '2026-07-20T03:00:00.000Z', by: USER_IDS.jawad },
  [INVOICE_IDS.inv1002]: { at: '2026-08-18T04:00:00.000Z', by: USER_IDS.jawad },
  [INVOICE_IDS.cn1001]: { at: '2026-08-20T01:00:00.000Z', by: USER_IDS.jawad },
  [INVOICE_IDS.inv1003]: { at: '2026-08-30T02:30:00.000Z', by: USER_IDS.jawad },
};

export function seedInvoiceIntakes(): readonly InvoiceIntake[] {
  const intake = (id: string, invoiceId: InvoiceId, filename: string, sizeBytes: number, checksum: string, receivedAt: string): InvoiceIntake => ({
    id: asId<'InvoiceIntake'>(id),
    projectId: RIVERSIDE,
    filename,
    mimeType: 'application/pdf',
    sizeBytes,
    checksumSha256: checksum,
    receivedAt,
    origin: 'upload',
    actor: USER_IDS.accountant,
    scanState: 'clean',
    invoiceId,
  });
  return [
    intake('int-riverside-1002', INVOICE_IDS.inv1002, 'MDS-2026-014.pdf', 184_223, '6f1d0c7b3a2e4f5d8c9b0a1e2d3c4b5a69788796a5b4c3d2e1f00112233445', '2026-08-11T00:20:00.000Z'),
    intake('int-riverside-1004', INVOICE_IDS.inv1004, 'BCB_Progress_Claim_02.pdf', 612_880, 'a4c1e9f2b7d3056812f4e6a8c0b2d4f6e8a0c2e4f6a8b0c2d4e6f8a0b2c4d6e8', '2026-09-03T23:00:00.000Z'),
    intake('int-riverside-1006', INVOICE_IDS.inv1006, 'Meridian invoice MDS 2026-014 (email).pdf', 191_004, '0b9e8d7c6b5a49382716f5e4d3c2b1a0f9e8d7c6b5a4938271605f4e3d2c1b0a', '2026-09-05T01:15:00.000Z'),
  ];
}

export function seedInvoices(): readonly Invoice[] {
  return SPECS.map((spec) => ({
    id: spec.id,
    projectId: RIVERSIDE,
    type: spec.type ?? 'invoice',
    supplierId: spec.supplierId,
    number: spec.number,
    normalisedNumber: normaliseInvoiceNumber(spec.number),
    ...(spec.intakeId ? { intakeId: spec.intakeId } : {}),
    currency: 'AUD',
    reviewState: spec.reviewState,
    syncState: 'not-queued',
    currentRevisionId: revisionId(spec.id),
    ...(spec.reviewState === 'approved' ? { approvedRevisionId: revisionId(spec.id) } : {}),
    ...(spec.submittedAt ? { submittedBy: USER_IDS.accountant, submittedAt: spec.submittedAt } : {}),
    ...(spec.warnings && spec.reviewState !== 'needs-review'
      ? { warningsCleared: { by: USER_IDS.accountant, at: spec.submittedAt ?? spec.receivedAt, revisionId: revisionId(spec.id) } }
      : {}),
    comments:
      spec.id === INVOICE_IDS.inv1006
        ? [{ id: 'cmt-inv1006-1', at: '2026-09-05T01:20:00.000Z', by: USER_IDS.accountant, text: 'Looks like the emailed copy of MDS-2026-014 — checking with Meridian.' }]
        : [],
    receivedAt: spec.receivedAt,
    createdAt: spec.receivedAt,
    createdBy: USER_IDS.accountant,
    ...spec.extra,
  }));
}

export function seedInvoiceRevisions(): readonly InvoiceRevision[] {
  return SPECS.map((spec) => {
    const net = fromMajorUnits(spec.net);
    const tax = fromMajorUnits(spec.net / 10);
    return {
      id: revisionId(spec.id),
      invoiceId: spec.id,
      revisionNumber: 1,
      supplierId: spec.supplierId,
      number: spec.number,
      invoiceDate: spec.invoiceDate,
      dueDate: spec.dueDate,
      net,
      tax,
      gross: money(net.cents + tax.cents),
      roundingAdjustment: money(0),
      lineDescriptions: [spec.description],
      allocations: [
        {
          id: `${spec.id}-a1`,
          ...spec.allocation,
          net,
          tax,
          taxTreatment: 'standard-gst',
          recoverablePpm: FULL,
        },
      ],
      extraction: { source: 'manual', confidence: null, fields: {} },
      warnings: spec.warnings ?? [],
      contentHash: `seed-${spec.id}`,
      createdAt: spec.receivedAt,
      createdBy: USER_IDS.accountant,
      frozen: spec.reviewState === 'approved',
    };
  });
}

export function seedApprovalDecisions(): readonly ApprovalDecision[] {
  const snapshot = (userId: UserId, policyVersion: number): ApprovalDecision['authoritySnapshot'] =>
    userId === USER_IDS.jawad
      ? { approvalLimit: fromMajorUnits(500_000), role: 'org-admin', policyVersion }
      : { approvalLimit: fromMajorUnits(100_000), role: 'project-manager', policyVersion };
  const approved = Object.entries(APPROVALS).map(([invoiceId, approval]) => ({
    id: asId<'ApprovalDecision'>(`dec-${invoiceId}-1`),
    projectId: RIVERSIDE,
    recordType: 'invoice' as const,
    recordId: invoiceId,
    revisionId: `${invoiceId}-r1`,
    stepIndex: 0,
    actor: approval.by,
    decision: 'approved' as const,
    at: approval.at,
    authoritySnapshot: snapshot(approval.by, approval.at < '2026-09-01' ? 1 : 2),
  }));
  return [
    ...approved,
    {
      id: asId<'ApprovalDecision'>(`dec-${INVOICE_IDS.inv1007}-1`),
      projectId: RIVERSIDE,
      recordType: 'invoice',
      recordId: INVOICE_IDS.inv1007,
      revisionId: `${INVOICE_IDS.inv1007}-r1`,
      stepIndex: 0,
      actor: USER_IDS.jawad,
      decision: 'on-hold',
      reason: 'Awaiting certifier sign-off',
      at: '2026-09-04T05:00:00.000Z',
      authoritySnapshot: snapshot(USER_IDS.jawad, 2),
    },
    {
      id: asId<'ApprovalDecision'>(`dec-${INVOICE_IDS.inv1008}-1`),
      projectId: RIVERSIDE,
      recordType: 'invoice',
      recordId: INVOICE_IDS.inv1008,
      revisionId: `${INVOICE_IDS.inv1008}-r1`,
      stepIndex: 0,
      actor: USER_IDS.mahvish,
      decision: 'rejected',
      reason: 'Wrong project',
      at: '2026-09-05T03:00:00.000Z',
      authoritySnapshot: snapshot(USER_IDS.mahvish, 2),
    },
  ];
}

export function seedOutboxEvents(): readonly OutboxEvent[] {
  return Object.entries(APPROVALS).map(([invoiceId, approval]) => ({
    id: asId<'OutboxEvent'>(`obx-${invoiceId}-approved`),
    projectId: RIVERSIDE,
    type: 'invoice.approved' as const,
    payload: { invoiceId, revisionId: `${invoiceId}-r1` },
    status: 'not-configured' as const,
    createdAt: approval.at,
  }));
}

export function seedPayments(): readonly Payment[] {
  return [
    {
      id: PAYMENT_IDS.pay1001,
      projectId: RIVERSIDE,
      sourceId: 'XR-7781',
      effectiveDate: '2026-07-28',
      amount: fromMajorUnits(66_000),
      direction: 'outflow',
      origin: 'import',
      importId: PAYMENT_IMPORT_IDS.july,
      reference: 'INV-1001',
      supplierId: SUPPLIER_IDS.meridian,
      createdAt: '2026-08-02T00:00:00.000Z',
      createdBy: USER_IDS.accountant,
    },
    {
      id: PAYMENT_IDS.pay1002,
      projectId: RIVERSIDE,
      sourceId: 'XR-7802',
      effectiveDate: '2026-08-29',
      amount: fromMajorUnits(30_000),
      direction: 'outflow',
      origin: 'import',
      importId: PAYMENT_IMPORT_IDS.august,
      reference: 'MDS-2026-014',
      supplierId: SUPPLIER_IDS.meridian,
      note: 'Part payment agreed with Meridian',
      createdAt: '2026-09-02T00:00:00.000Z',
      createdBy: USER_IDS.accountant,
    },
    {
      id: PAYMENT_IDS.pay1003,
      projectId: RIVERSIDE,
      sourceId: 'XR-7795',
      effectiveDate: '2026-08-27',
      amount: fromMajorUnits(9_900),
      direction: 'outflow',
      origin: 'import',
      importId: PAYMENT_IMPORT_IDS.august,
      reference: 'Unknown ref 4471',
      createdAt: '2026-09-02T00:00:00.000Z',
      createdBy: USER_IDS.accountant,
    },
  ];
}

export function seedPaymentImports(): readonly PaymentImport[] {
  return [
    {
      id: PAYMENT_IMPORT_IDS.july,
      projectId: RIVERSIDE,
      filename: 'bank-2026-07.csv',
      state: 'confirmed',
      rows: [{ line: 2, sourceId: 'XR-7781', effectiveDate: '2026-07-28', amount: fromMajorUnits(66_000), reference: 'INV-1001', supplierName: 'Meridian Design Studio', status: 'new' }],
      totals: { rows: 1, new: 1, duplicates: 0, invalid: 0, amount: fromMajorUnits(66_000) },
      createdAt: '2026-08-02T00:00:00.000Z',
      createdBy: USER_IDS.accountant,
      confirmedAt: '2026-08-02T00:00:00.000Z',
    },
    {
      id: PAYMENT_IMPORT_IDS.august,
      projectId: RIVERSIDE,
      filename: 'bank-2026-08.csv',
      state: 'confirmed',
      rows: [
        { line: 2, sourceId: 'XR-7795', effectiveDate: '2026-08-27', amount: fromMajorUnits(9_900), reference: 'Unknown ref 4471', status: 'new' },
        { line: 3, sourceId: 'XR-7802', effectiveDate: '2026-08-29', amount: fromMajorUnits(30_000), reference: 'MDS-2026-014', supplierName: 'Meridian Design Studio', status: 'new' },
      ],
      totals: { rows: 2, new: 2, duplicates: 0, invalid: 0, amount: fromMajorUnits(39_900) },
      createdAt: '2026-09-02T00:00:00.000Z',
      createdBy: USER_IDS.accountant,
      confirmedAt: '2026-09-02T00:00:00.000Z',
    },
  ];
}

export function seedSettlementAllocations(): readonly SettlementAllocation[] {
  return [
    {
      id: asId<'SettlementAllocation'>('set-riverside-1001-cash'),
      projectId: RIVERSIDE,
      paymentId: PAYMENT_IDS.pay1001,
      invoiceId: INVOICE_IDS.inv1001,
      amount: fromMajorUnits(66_000),
      settlementType: 'cash',
      effectiveDate: '2026-07-28',
      createdAt: '2026-08-02T00:00:00.000Z',
      createdBy: USER_IDS.accountant,
    },
    {
      id: asId<'SettlementAllocation'>('set-riverside-1002-credit'),
      projectId: RIVERSIDE,
      creditNoteInvoiceId: INVOICE_IDS.cn1001,
      invoiceId: INVOICE_IDS.inv1002,
      amount: fromMajorUnits(4_400),
      settlementType: 'credit',
      effectiveDate: '2026-08-20',
      createdAt: '2026-08-20T01:10:00.000Z',
      createdBy: USER_IDS.accountant,
    },
    {
      id: asId<'SettlementAllocation'>('set-riverside-1002-cash'),
      projectId: RIVERSIDE,
      paymentId: PAYMENT_IDS.pay1002,
      invoiceId: INVOICE_IDS.inv1002,
      amount: fromMajorUnits(30_000),
      settlementType: 'cash',
      effectiveDate: '2026-08-29',
      createdAt: '2026-09-02T00:00:00.000Z',
      createdBy: USER_IDS.accountant,
    },
  ];
}

export function seedRetentionTranches(): readonly RetentionTranche[] {
  return [
    {
      id: RETENTION_IDS.inv1003,
      projectId: RIVERSIDE,
      invoiceId: INVOICE_IDS.inv1003,
      amount: fromMajorUnits(22_000),
      releaseCondition: 'Practical completion',
      forecastReleaseDate: '2028-06-30',
    },
  ];
}

export function seedReconciliationItems(): readonly ReconciliationItem[] {
  return [
    {
      id: RECONCILIATION_ITEM_IDS.unknown4471,
      projectId: RIVERSIDE,
      kind: 'unmatched-payment',
      paymentId: PAYMENT_IDS.pay1003,
      amount: fromMajorUnits(9_900),
      effectiveDate: '2026-08-27',
      state: 'open',
    },
  ];
}
