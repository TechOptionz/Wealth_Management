/**
 * Leases & tenants domain model (FR-05, BR-05).
 *
 * Arrears are never stored. They are always derived as
 * `charges due on or before the as-of date − receipts allocated to those charges`
 * so the figure can be explained down to the individual charge and receipt.
 */
import type {
  IsoDate,
  LeaseId,
  PropertyComponentId,
  PropertyId,
  RentChargeId,
  TenantId,
  UserId,
} from '@/shared/types/common';
import type { Money } from '@/shared/lib/money';

export type RentFrequency = 'weekly' | 'fortnightly' | 'monthly';

export const FREQUENCY_LABELS: Record<RentFrequency, string> = {
  weekly: 'Weekly',
  fortnightly: 'Fortnightly',
  monthly: 'Monthly',
};

/** Charge periods per year — the basis for annualising and monthly equivalents. */
export const PERIODS_PER_YEAR: Record<RentFrequency, number> = {
  weekly: 52,
  fortnightly: 26,
  monthly: 12,
};

/** Short suffix used in tables: "$1,380 / fortnight". */
export const FREQUENCY_SUFFIX: Record<RentFrequency, string> = {
  weekly: 'week',
  fortnightly: 'fortnight',
  monthly: 'month',
};

export interface Tenant {
  readonly id: TenantId;
  /** Display name as it appears in tables, e.g. "A. Nguyen". */
  readonly name: string;
}

export type LeaseStatus = 'active' | 'ending-soon' | 'disputed' | 'ended';

export interface Lease {
  readonly id: LeaseId;
  readonly tenantId: TenantId;
  readonly propertyId: PropertyId;
  /** Null for whole-property leases that predate component modelling. */
  readonly componentId: PropertyComponentId | null;
  /**
   * Billing reference the tenant quotes on transfers. This is what makes bank
   * receipts auto-match to the right lease.
   */
  readonly reference: string;
  readonly startsOn: IsoDate;
  readonly endsOn: IsoDate;
  readonly rent: Money;
  readonly frequency: RentFrequency;
  /**
   * First charge date. Kept separate from `startsOn` because the rent day is
   * often not the lease commencement day.
   */
  readonly chargeAnchorOn: IsoDate;
  readonly bond?: Money;
  readonly remindersEnabled: boolean;
  /**
   * A disputed lease pauses automated charging reminders. Charges still accrue —
   * pausing reminders is a communication decision, not an accounting one.
   */
  readonly disputed: boolean;
}

/**
 * What a charge is for.
 * - `rent`    — generated from the lease dates. Absent means rent.
 * - `utility` — a recovered share of a shared bill (FR-07). It is owed like rent
 *               and counts towards arrears, but it is not rental income and is
 *               never repriced or removed as "unearned rent".
 */
export type RentChargeKind = 'rent' | 'utility';

export interface RentCharge {
  readonly id: RentChargeId;
  readonly leaseId: LeaseId;
  readonly dueOn: IsoDate;
  readonly amount: Money;
  readonly kind?: RentChargeKind;
  /** Shown on the tenant ledger for non-rent charges, e.g. "Water recovery · Urban Utilities". */
  readonly description?: string;
  /** The shared bill a utility charge came from, so a recovery can be traced back. */
  readonly sourceBillId?: string;
}

/**
 * What an allocation represents (FR-06, BR-05).
 *
 * - `receipt`  — money received from the tenant.
 * - `credit`   — an approved reduction (goodwill, agreed adjustment). Requires
 *                an approver, because a credit forgives real money.
 * - `reversal` — undoes an earlier allocation, e.g. a dishonoured payment.
 *                Carries a negative amount and names what it reverses.
 */
export type AllocationKind = 'receipt' | 'credit' | 'reversal';

export const ALLOCATION_KIND_LABELS: Record<AllocationKind, string> = {
  receipt: 'Receipt',
  credit: 'Approved credit',
  reversal: 'Reversal',
};

/**
 * A receipt applied to a charge. Kept separate from the charge so a single bank
 * receipt can be split across charges and a charge can be part-paid many times.
 *
 * Reversals and credits are stored as further allocations rather than by editing
 * or deleting the original, so the payment history stays a complete, additive
 * record — a dishonoured payment shows as a receipt followed by its reversal.
 */
export interface RentAllocation {
  readonly id: string;
  readonly chargeId: RentChargeId;
  readonly kind: AllocationKind;
  /** Negative for reversals; positive for receipts and credits. */
  readonly amount: Money;
  readonly receivedOn: IsoDate;
  /** The staged bank transaction this allocation came from, when matched. */
  readonly bankTransactionId?: string;
  /** For a reversal: the allocation it undoes. */
  readonly reversesAllocationId?: string;
  /** A credit is only valid once approved — it forgives money that was owed. */
  readonly approvedBy?: UserId;
  readonly note?: string;
}

/** Per-lease arrears position at a point in time (BR-05). */
export interface ArrearsPosition {
  readonly leaseId: LeaseId;
  readonly tenantName: string;
  readonly propertyLabel: string;
  readonly due: Money;
  /** Cash actually received. */
  readonly received: Money;
  /** Approved credits applied against the charges. */
  readonly credits: Money;
  /** Reversals applied — a dishonoured payment restores the amount owing. */
  readonly reversals: Money;
  /** Positive = owing, negative = paid ahead. */
  readonly outstanding: Money;
  /** Days since the oldest unpaid charge fell due; null when nothing is owing. */
  readonly daysOverdue: number | null;
  readonly disputed: boolean;
  readonly state: ArrearsState;
}

export type ArrearsState = 'clear' | 'paid-ahead' | 'partial' | 'overdue' | 'disputed';

/** What a statement line is: a charge that fell due, or an allocation applied. */
export type LedgerEntryType = 'charge' | AllocationKind;

export const LEDGER_ENTRY_LABELS: Record<LedgerEntryType, string> = {
  charge: 'Charge',
  receipt: 'Payment',
  credit: 'Credit',
  reversal: 'Reversal',
};

/**
 * One line of a tenant's statement of account (FR-05, BR-05).
 *
 * The statement follows bookkeeping convention: a **debit** increases what the
 * tenant owes (a charge falling due, a dishonoured payment being reversed) and
 * a **credit** reduces it (money received, an approved credit). `amount` is the
 * unsigned magnitude; `side` says which column it lands in.
 */
export interface LeaseLedgerEntry {
  readonly id: string;
  readonly date: IsoDate;
  readonly description: string;
  readonly type: LedgerEntryType;
  readonly side: 'debit' | 'credit';
  /** Always positive — `side` carries the direction. */
  readonly amount: Money;
  /** Balance after this line. Positive = owing, negative = tenant in credit. */
  readonly balance: Money;
}

/**
 * A lease's running statement as at a date. Every figure is derived on read
 * from the charges and allocations, so `currentBalance` can always be traced
 * line by line: it equals `totalCharged − totalReceived` and the last entry's
 * `balance`.
 */
export interface LeaseLedger {
  readonly leaseId: LeaseId;
  readonly reference: string;
  readonly tenantName: string;
  readonly propertyLabel: string;
  readonly leasePeriod: { readonly startsOn: IsoDate; readonly endsOn: IsoDate };
  readonly asOf: IsoDate;
  /** Sum of every charge that had fallen due by `asOf` — rent and recoveries. */
  readonly totalCharged: Money;
  /**
   * Net amount applied against those charges by `asOf`: receipts plus approved
   * credits, less reversals. A dishonoured payment therefore nets to nothing.
   */
  readonly totalReceived: Money;
  /** Positive = owing, negative = paid ahead. */
  readonly currentBalance: Money;
  readonly entries: readonly LeaseLedgerEntry[];
}
