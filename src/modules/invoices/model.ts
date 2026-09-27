/**
 * Development Finance — invoice intake, review, approval, settlement and
 * reconciliation (§8: INV01–INV15, CST05–CST07, CAL03, CAL06, CAL07, INT07).
 *
 * Rules this model makes structural:
 *  1. **Three separate status fields (§6.3).** `reviewState` and `syncState`
 *     are stored; the settlement state (Unpaid / Part Paid / Paid / Credit Due
 *     / Reconciled) is derived from settlement allocations on every read.
 *  2. **Revisions append (INV10).** An approved revision is frozen; a material
 *     edit creates a new revision that needs renewed approval, while
 *     `approvedRevisionId` keeps pointing at what was approved.
 *  3. **Payment is evidence, never inferred (INV11, INV13).** A payment is its
 *     own record with its own effective date; it settles an invoice only
 *     through a settlement allocation.
 *  4. **Nothing is physically deleted (INV12).** Void keeps the record and its
 *     history; a reversed payment is a new, opposite payment (AT23).
 */
import type { Ppm, TaxTreatment } from '@/shared/finance-engine';
import type { Money } from '@/shared/lib/money';
import type {
  ApprovalDecisionId,
  CommitmentId,
  CostLineId,
  InvoiceId,
  InvoiceIntakeId,
  InvoiceRevisionId,
  IsoDate,
  IsoDateTime,
  OutboxEventId,
  PaymentId,
  PaymentImportId,
  ProjectId,
  ReconciliationItemId,
  RetentionTrancheId,
  SettlementAllocationId,
  SupplierId,
  UserId,
} from '@/shared/types/common';

/** INV01 — accepted document types and the size limit. */
export const ACCEPTED_MIME_TYPES = ['application/pdf', 'image/png', 'image/jpeg'] as const;
export type AcceptedMimeType = (typeof ACCEPTED_MIME_TYPES)[number];
export const MAX_INTAKE_BYTES = 20 * 1024 * 1024;

export type IntakeOrigin = 'upload' | 'manual-entry' | 'import';

export interface InvoiceIntake {
  readonly id: InvoiceIntakeId;
  readonly projectId: ProjectId;
  readonly filename: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  /** Hex sha256 of the bytes; empty when no bytes were supplied. */
  readonly checksumSha256: string;
  readonly receivedAt: IsoDateTime;
  readonly origin: IntakeOrigin;
  readonly actor: UserId;
  /** `skipped` — no bytes were supplied, so content could not be checked. */
  readonly scanState: 'clean' | 'failed' | 'skipped';
  readonly failureReason?: string;
  readonly invoiceId?: InvoiceId;
}

export type AllowanceTreatment = 'consume-allowance' | 'additional-scope';

export const ALLOWANCE_TREATMENT_LABELS: Record<AllowanceTreatment, string> = {
  'consume-allowance': 'Consumes the line allowance',
  'additional-scope': 'Additional scope',
};

export interface InvoiceAllocation {
  readonly id: string;
  readonly costLineId: CostLineId;
  readonly commitmentId?: CommitmentId;
  readonly stageId?: string;
  /** Positive magnitude; a credit note's sign comes from its type. */
  readonly net: Money;
  readonly tax: Money;
  readonly taxTreatment: TaxTreatment;
  readonly recoverablePpm: Ppm;
  /** Required when `commitmentId` is absent (CST06): the reviewer's choice for direct spend. */
  readonly allowanceTreatment?: AllowanceTreatment;
}

/** Codes stored in `InvoiceRevision.warnings` (INV07). */
export type InvoiceWarning = 'due-before-invoice' | 'future-dated' | 'closed-period';

export const INVOICE_WARNING_LABELS: Record<InvoiceWarning, string> = {
  'due-before-invoice': 'Due date is before the invoice date — acknowledge to continue',
  'future-dated': 'Invoice date is in the future — finance review required',
  'closed-period': 'Invoice date falls in a closed period — finance review required',
};

/** Warnings only a `payment.record` holder may clear (INV07 finance review). */
export const FINANCE_REVIEW_WARNINGS: readonly InvoiceWarning[] = ['future-dated', 'closed-period'];

export interface InvoiceRevision {
  readonly id: InvoiceRevisionId;
  readonly invoiceId: InvoiceId;
  readonly revisionNumber: number;
  readonly supplierId: SupplierId;
  readonly number: string;
  readonly invoiceDate: IsoDate;
  readonly dueDate: IsoDate;
  readonly net: Money;
  readonly tax: Money;
  readonly gross: Money;
  /** (net + tax) − Σ allocations; at most one cent either way, recorded explicitly (INV06). */
  readonly roundingAdjustment: Money;
  readonly lineDescriptions: readonly string[];
  readonly allocations: readonly InvoiceAllocation[];
  /** Automated extraction is deferred (INV02/INV03); every field is entered by hand. */
  readonly extraction: { readonly source: 'manual'; readonly confidence: null; readonly fields: Record<string, string> };
  readonly warnings: readonly string[];
  readonly contentHash: string;
  readonly createdAt: IsoDateTime;
  readonly createdBy: UserId;
  /** True once approved; a frozen revision is never edited again (INV10). */
  readonly frozen: boolean;
}

export type ReviewState = 'received' | 'needs-review' | 'ready' | 'awaiting-approval' | 'on-hold' | 'approved' | 'rejected' | 'void';

export const REVIEW_STATES: readonly ReviewState[] = ['received', 'needs-review', 'ready', 'awaiting-approval', 'on-hold', 'approved', 'rejected', 'void'];

export const REVIEW_STATE_LABELS: Record<ReviewState, string> = {
  received: 'Received',
  'needs-review': 'Needs review',
  ready: 'Ready',
  'awaiting-approval': 'Awaiting approval',
  'on-hold': 'On hold',
  approved: 'Approved',
  rejected: 'Rejected',
  void: 'Void',
};

/** No accounting provider is connected in this build, so nothing is ever queued. */
export type SyncState = 'not-queued';

export type SettlementState = 'unpaid' | 'part-paid' | 'paid' | 'credit-due' | 'reconciled';

export const SETTLEMENT_STATE_LABELS: Record<SettlementState, string> = {
  unpaid: 'Unpaid',
  'part-paid': 'Part paid',
  paid: 'Paid',
  'credit-due': 'Credit due',
  reconciled: 'Reconciled',
};

export type InvoiceType = 'invoice' | 'credit-note';

export interface InvoiceComment {
  readonly id: string;
  readonly at: IsoDateTime;
  readonly by: UserId;
  readonly text: string;
}

export interface Invoice {
  readonly id: InvoiceId;
  readonly projectId: ProjectId;
  readonly type: InvoiceType;
  readonly supplierId: SupplierId;
  readonly number: string;
  /** Upper case, letters and digits only — "MDS 2026-014" and "MDS-2026-014" collide (INV04). */
  readonly normalisedNumber: string;
  readonly intakeId?: InvoiceIntakeId;
  readonly currency: 'AUD';
  readonly reviewState: ReviewState;
  readonly syncState: SyncState;
  readonly currentRevisionId: InvoiceRevisionId;
  readonly approvedRevisionId?: InvoiceRevisionId;
  readonly submittedBy?: UserId;
  readonly submittedAt?: IsoDateTime;
  readonly holdReason?: string;
  readonly rejectReason?: string;
  readonly voidReason?: string;
  /** INV14 — an authorisation recorded in the accounting system, kept apart from local approval. */
  readonly externalAuthorisation?: { readonly source: string; readonly reference: string; readonly at: IsoDateTime };
  readonly duplicateOverride?: { readonly by: UserId; readonly at: IsoDateTime; readonly reason: string; readonly suspectInvoiceId: InvoiceId };
  readonly dismissedSimilarity?: { readonly by: UserId; readonly at: IsoDateTime; readonly reason: string; readonly suspectInvoiceId: InvoiceId };
  /** INV07 — who acknowledged or finance-reviewed the current revision's warnings. */
  readonly warningsCleared?: { readonly by: UserId; readonly at: IsoDateTime; readonly revisionId: InvoiceRevisionId };
  readonly scheduledPaymentDate?: IsoDate;
  readonly comments: readonly InvoiceComment[];
  readonly receivedAt: IsoDateTime;
  readonly createdAt: IsoDateTime;
  readonly createdBy: UserId;
}

export type DecisionKind = 'approved' | 'on-hold' | 'rejected';

export interface ApprovalDecision {
  readonly id: ApprovalDecisionId;
  readonly projectId: ProjectId;
  readonly recordType: 'invoice' | 'variation';
  readonly recordId: string;
  readonly revisionId: string;
  readonly stepIndex: number;
  readonly actor: UserId;
  readonly decision: DecisionKind;
  readonly reason?: string;
  readonly at: IsoDateTime;
  readonly authoritySnapshot: { readonly approvalLimit: Money | null; readonly role: string; readonly policyVersion: number };
}

export interface Payment {
  readonly id: PaymentId;
  readonly projectId: ProjectId;
  /** Immutable identifier from the bank or accounting export (INT07). */
  readonly sourceId?: string;
  readonly effectiveDate: IsoDate;
  /** Always positive; `direction` carries the sign. */
  readonly amount: Money;
  readonly direction: 'outflow' | 'inflow';
  readonly origin: 'manual' | 'import';
  readonly importId?: PaymentImportId;
  readonly reference: string;
  readonly supplierId?: SupplierId;
  readonly note?: string;
  /** AT23 — a controlled adjustment names the payment it reverses. */
  readonly reversesPaymentId?: PaymentId;
  readonly createdAt: IsoDateTime;
  readonly createdBy: UserId;
}

export type SettlementType = 'cash' | 'credit' | 'withholding' | 'retention-release' | 'refund' | 'other-noncash';

export const SETTLEMENT_TYPES: readonly SettlementType[] = ['cash', 'credit', 'withholding', 'retention-release', 'refund', 'other-noncash'];

export const SETTLEMENT_TYPE_LABELS: Record<SettlementType, string> = {
  cash: 'Cash',
  credit: 'Credit note applied',
  withholding: 'Withholding',
  'retention-release': 'Retention release',
  refund: 'Refund',
  'other-noncash': 'Other non-cash',
};

export interface SettlementAllocation {
  readonly id: SettlementAllocationId;
  readonly projectId: ProjectId;
  readonly paymentId?: PaymentId;
  readonly creditNoteInvoiceId?: InvoiceId;
  readonly invoiceId: InvoiceId;
  /** Positive magnitude, gross basis. A refund reduces what has been paid. */
  readonly amount: Money;
  readonly settlementType: SettlementType;
  readonly effectiveDate: IsoDate;
  readonly createdAt: IsoDateTime;
  readonly createdBy: UserId;
}

/** CST07 — a fixed amount of an approved invoice held back until a condition is met. */
export interface RetentionTranche {
  readonly id: RetentionTrancheId;
  readonly projectId: ProjectId;
  readonly invoiceId: InvoiceId;
  readonly amount: Money;
  readonly releaseCondition: string;
  readonly forecastReleaseDate: IsoDate;
  readonly actualReleaseAt?: IsoDateTime;
  readonly releasedBySettlementId?: SettlementAllocationId;
}

export interface ReconciliationItem {
  readonly id: ReconciliationItemId;
  readonly projectId: ProjectId;
  readonly kind: 'unmatched-payment' | 'external-bill';
  readonly paymentId?: PaymentId;
  readonly externalReference?: string;
  readonly amount: Money;
  readonly effectiveDate: IsoDate;
  readonly state: 'open' | 'matched' | 'excluded';
  readonly resolvedBy?: UserId;
  readonly resolvedAt?: IsoDateTime;
  readonly reason?: string;
}

export interface PaymentImportRow {
  readonly line: number;
  readonly sourceId: string;
  readonly effectiveDate: IsoDate;
  readonly amount: Money;
  readonly reference: string;
  readonly supplierName?: string;
  readonly status: 'new' | 'duplicate' | 'invalid';
  readonly problem?: string;
}

export interface PaymentImport {
  readonly id: PaymentImportId;
  readonly projectId: ProjectId;
  readonly filename?: string;
  readonly state: 'dry-run' | 'confirmed' | 'rejected';
  readonly rows: readonly PaymentImportRow[];
  readonly totals: { readonly rows: number; readonly new: number; readonly duplicates: number; readonly invalid: number; readonly amount: Money };
  readonly createdAt: IsoDateTime;
  readonly createdBy: UserId;
  readonly confirmedAt?: IsoDateTime;
  /** Recorded at confirmation so a repeated confirm returns the same answer (INT07). */
  readonly result?: { readonly paymentIds: readonly PaymentId[]; readonly matched: number; readonly unmatched: number };
}

export interface OutboxEvent {
  readonly id: OutboxEventId;
  readonly projectId: ProjectId;
  readonly type: 'invoice.approved' | 'invoice.corrected' | 'payment.recorded';
  readonly payload: Record<string, unknown>;
  /** No accounting provider is configured; events are recorded, never sent (INV11). */
  readonly status: 'not-configured';
  readonly createdAt: IsoDateTime;
}

/** ★ One approved allocation, as the project model reads it. */
export interface ApprovedAllocationView {
  readonly invoiceId: InvoiceId;
  readonly revisionId: InvoiceRevisionId;
  readonly supplierName: string;
  readonly number: string;
  readonly type: InvoiceType;
  readonly sign: 1 | -1;
  readonly commitmentId: CommitmentId | null;
  readonly allowanceTreatment: AllowanceTreatment | null;
  readonly net: Money;
  readonly tax: Money;
  readonly gross: Money;
  readonly recoverableTax: Money;
  readonly economic: Money;
  readonly expectedPaymentDate: IsoDate;
  readonly approvedAt: IsoDateTime;
}

export interface SettlementSummary {
  readonly gross: Money;
  /** Cash and retention releases paid, before refunds. */
  readonly paidCash: Money;
  readonly appliedCredits: Money;
  readonly withholding: Money;
  readonly otherNonCash: Money;
  readonly refunds: Money;
  /** Unreleased retention — part of the unpaid balance, not yet due. */
  readonly retentionHeld: Money;
  readonly unpaidBalance: Money;
  readonly state: SettlementState;
}

export interface DuplicateFindings {
  readonly exact: readonly InvoiceId[];
  readonly checksum: readonly InvoiceId[];
  readonly similar: readonly InvoiceId[];
}

export interface ContractPosition {
  readonly contractTotal: Money;
  readonly invoicedToDate: Money;
  readonly paidToDate: Money;
  readonly approvedUnpaid: Money;
  readonly uninvoicedBalance: Money;
  readonly remainingEstimate: Money;
}

/** Normalise an invoice number for duplicate matching (INV04). */
export function normaliseInvoiceNumber(number: string): string {
  return number.toUpperCase().replace(/[^A-Z0-9]/g, '');
}
