/**
 * Development Finance — debt facilities, equity participants and the
 * distribution waterfall (§7: FIN01–FIN06, EQ01–EQ03, WFL01–WFL04; CAL15–CAL17,
 * CAL20).
 *
 * Four rules this model makes structural:
 *  1. **Balances are never stored.** A facility's principal, a participant's
 *     outstanding capital, accrued preferred return and IRR are computed from
 *     dated movements on read (FIN03, EQ02). Nothing here caches a balance.
 *  2. **Actual and planned movements are the same shape with a `basis`.** They
 *     live side by side and are never merged on write; the service decides,
 *     per read, which basis a figure uses (EQ02, FIN02).
 *  3. **Rates are parts per million.** 8.25% is `82_500`, so a rate can never
 *     be mistaken for the decimal 0.0825 (FIN01, CAL01).
 *  4. **Agreements are versioned and approved before publication.** A
 *     waterfall version moves draft → approved → published and is never edited;
 *     a new version supersedes it (WFL04).
 */
import type { DayCountConvention, InterestTreatment, Ppm, RateStep } from '@/shared/finance-engine';
import type { Money } from '@/shared/lib/money';
import type {
  DebtFacilityId,
  EquityMovementId,
  EquityParticipantId,
  FacilityMovementId,
  IsoDate,
  IsoDateTime,
  LegalEntityId,
  ProjectId,
  UserId,
  WaterfallVersionId,
} from '@/shared/types/common';

/* ---------- Debt ---------- */

export type FacilityType = 'senior' | 'mezzanine' | 'other';
export const FACILITY_TYPES: readonly FacilityType[] = ['senior', 'mezzanine', 'other'];
export const FACILITY_TYPE_LABELS: Record<FacilityType, string> = {
  senior: 'Senior debt',
  mezzanine: 'Mezzanine',
  other: 'Other',
};

export type FacilityState = 'active' | 'repaid' | 'cancelled';
export const FACILITY_STATES: readonly FacilityState[] = ['active', 'repaid', 'cancelled'];

export const DAY_COUNTS: readonly DayCountConvention[] = ['ACT/365F', 'ACT/360'];
export const INTEREST_TREATMENTS: readonly InterestTreatment[] = ['capitalised', 'cash'];
export const INTEREST_TREATMENT_LABELS: Record<InterestTreatment, string> = {
  capitalised: 'Capitalised · added to principal at month end',
  cash: 'Cash · paid at month end',
};

export type FacilityFeeKind = 'establishment' | 'line' | 'exit';
export const FACILITY_FEE_KINDS: readonly FacilityFeeKind[] = ['establishment', 'line', 'exit'];

export interface FacilityFee {
  readonly kind: FacilityFeeKind;
  readonly amount: Money;
  /** When the fee falls due. Undated fees are informational only and never enter a ledger. */
  readonly on?: IsoDate;
}

export interface DebtFacility {
  readonly id: DebtFacilityId;
  readonly projectId: ProjectId;
  readonly name: string;
  readonly lender: string;
  readonly borrowerLegalEntityId: LegalEntityId;
  readonly type: FacilityType;
  /** Committed limit. A draw beyond it is recorded, audited and shown as a breach (FIN03). */
  readonly limit: Money;
  /** Principal outstanding at the start of `openingOn`, before that day's movements. */
  readonly openingPrincipal: Money;
  readonly openingOn: IsoDate;
  readonly availableFrom: IsoDate;
  readonly availableTo: IsoDate;
  readonly maturityOn: IsoDate;
  /** Lower ranks are drawn first (FIN04). */
  readonly drawRank: number;
  /** Lower ranks are repaid first from excess cash (FIN04). */
  readonly repaymentRank: number;
  /** Effective-dated annual rates in ppm, ascending by `from`. Appended, never edited. */
  readonly rateSteps: readonly RateStep[];
  readonly dayCount: DayCountConvention;
  readonly interestTreatment: InterestTreatment;
  readonly fees: readonly FacilityFee[];
  readonly state: FacilityState;
  readonly createdAt: IsoDateTime;
  readonly createdBy: UserId;
}

export type MovementKind = 'draw' | 'repayment' | 'fee' | 'correction';
export const MOVEMENT_KINDS: readonly MovementKind[] = ['draw', 'repayment', 'fee', 'correction'];
export const MOVEMENT_KIND_LABELS: Record<MovementKind, string> = {
  draw: 'Draw',
  repayment: 'Repayment',
  fee: 'Fee',
  correction: 'Correction',
};

/** Actual movements are the record; planned ones are the forecast. They never merge (EQ02, FIN02). */
export type MovementBasis = 'actual' | 'planned';
export const MOVEMENT_BASES: readonly MovementBasis[] = ['actual', 'planned'];

export type MovementSource = 'manual' | 'import' | 'model';

export interface FacilityMovement {
  readonly id: FacilityMovementId;
  readonly projectId: ProjectId;
  readonly facilityId: DebtFacilityId;
  readonly on: IsoDate;
  readonly kind: MovementKind;
  /** Positive magnitude for draws, repayments and fees; a correction is signed. */
  readonly amount: Money;
  readonly basis: MovementBasis;
  readonly source: MovementSource;
  readonly reference?: string;
  readonly note?: string;
  /** A correction names the movement it corrects; the original is never edited. */
  readonly correctsMovementId?: FacilityMovementId;
  readonly createdAt: IsoDateTime;
  readonly createdBy: UserId;
}

/* ---------- Equity ---------- */

export type ParticipantClass = 'sponsor' | 'preferred' | 'ordinary';
export const PARTICIPANT_CLASSES: readonly ParticipantClass[] = ['sponsor', 'preferred', 'ordinary'];
export const PARTICIPANT_CLASS_LABELS: Record<ParticipantClass, string> = {
  sponsor: 'Sponsor',
  preferred: 'Preferred',
  ordinary: 'Ordinary',
};

export interface EquityParticipant {
  readonly id: EquityParticipantId;
  readonly projectId: ProjectId;
  readonly name: string;
  /** The investor's own reference. Private: shown to finance editors and to that investor only. */
  readonly investorReference: string;
  readonly class: ParticipantClass;
  readonly commitment: Money;
  /** Relative weight in the funding order among participants of the same class (FIN04). */
  readonly participationWeight: number;
  /** Simple, non-compounding preferred return on outstanding capital, ACT/365F (WFL02). */
  readonly preferredRatePpm: Ppm;
  /** Declared share of residual profit; weights are relative and need not sum to 100. */
  readonly residualShareWeight: number;
  readonly createdAt: IsoDateTime;
}

export type EquityMovementType = 'contribution' | 'capital-return' | 'preferred-return' | 'profit-distribution';
export const EQUITY_MOVEMENT_TYPES: readonly EquityMovementType[] = [
  'contribution',
  'capital-return',
  'preferred-return',
  'profit-distribution',
];
export const EQUITY_MOVEMENT_TYPE_LABELS: Record<EquityMovementType, string> = {
  contribution: 'Contribution',
  'capital-return': 'Return of capital',
  'preferred-return': 'Preferred return',
  'profit-distribution': 'Profit distribution',
};

export function isDistributionType(type: EquityMovementType): boolean {
  return type !== 'contribution';
}

export interface EquityMovement {
  readonly id: EquityMovementId;
  readonly projectId: ProjectId;
  readonly participantId: EquityParticipantId;
  readonly on: IsoDate;
  readonly type: EquityMovementType;
  /** Always a positive magnitude; `type` carries the direction. */
  readonly amount: Money;
  readonly basis: MovementBasis;
  readonly note?: string;
  /** Set when the movement was produced by recording a waterfall distribution (WFL04). */
  readonly waterfallVersionId?: WaterfallVersionId;
  readonly createdAt: IsoDateTime;
  readonly createdBy: UserId;
}

/** The capital account is derived from actual movements on every read (EQ02). */
export interface CapitalAccount {
  readonly contributed: Money;
  readonly capitalReturned: Money;
  readonly outstanding: Money;
  readonly preferredAccrued: Money;
  readonly preferredPaid: Money;
  readonly preferredOutstanding: Money;
  readonly profitDistributed: Money;
}

/* ---------- Waterfall ---------- */

export type WaterfallTierKind = 'required-debt' | 'reserve' | 'return-of-capital' | 'preferred-return' | 'residual-split';
export type WaterfallTierBasis = 'pro-rata-outstanding-capital' | 'pro-rata-accrued' | 'declared-shares' | 'n/a';
export type WaterfallRoundingRule = 'residual-to-last-by-id';
export type WaterfallState = 'draft' | 'approved' | 'published';

export const WATERFALL_TIER_LABELS: Record<WaterfallTierKind, string> = {
  'required-debt': 'Required debt service',
  reserve: 'Retain project reserve',
  'return-of-capital': 'Return contributed capital',
  'preferred-return': 'Accrued preferred return',
  'residual-split': 'Residual profit split',
};

export const WATERFALL_BASIS_LABELS: Record<WaterfallTierBasis, string> = {
  'pro-rata-outstanding-capital': 'Pro rata to outstanding capital',
  'pro-rata-accrued': 'Pro rata to accrued preferred return',
  'declared-shares': 'Declared residual shares',
  'n/a': '—',
};

/**
 * The only agreement the pilot supports (WFL01). The order and the basis of
 * each tier are fixed; anything else needs a policy decision first.
 */
export const WATERFALL_TEMPLATE: readonly { readonly kind: WaterfallTierKind; readonly basis: WaterfallTierBasis }[] = [
  { kind: 'required-debt', basis: 'n/a' },
  { kind: 'reserve', basis: 'n/a' },
  { kind: 'return-of-capital', basis: 'pro-rata-outstanding-capital' },
  { kind: 'preferred-return', basis: 'pro-rata-accrued' },
  { kind: 'residual-split', basis: 'declared-shares' },
];

export interface WaterfallTier {
  /** 1-based position. */
  readonly order: number;
  readonly kind: WaterfallTierKind;
  /** Participants the tier pays. Omitted means every participant of the project. */
  readonly participantIds?: readonly EquityParticipantId[];
  readonly basis: WaterfallTierBasis;
  readonly roundingRule: WaterfallRoundingRule;
}

export interface WaterfallVersion {
  readonly id: WaterfallVersionId;
  readonly projectId: ProjectId;
  readonly version: number;
  readonly state: WaterfallState;
  readonly tiers: readonly WaterfallTier[];
  /** Cash retained before any equity tier is paid (WFL01). */
  readonly reserve: Money;
  readonly draftedBy: UserId;
  readonly approvedBy?: UserId;
  readonly approvedAt?: IsoDateTime;
  readonly publishedAt?: IsoDateTime;
  readonly effectiveFrom: IsoDate;
  readonly reason: string;
  readonly createdAt: IsoDateTime;
}

export const WATERFALL_STATE_LABELS: Record<WaterfallState, string> = {
  draft: 'Draft',
  approved: 'Approved · not yet published',
  published: 'Published',
};
