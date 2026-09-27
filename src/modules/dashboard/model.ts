/**
 * Dashboard read model (FR-09, BR-01, BR-02, BR-03).
 *
 * This module owns no records of its own except portfolio snapshots. Everything
 * else is composed from the feature modules, which is why the dependency arrows
 * all point *into* this module and never out of it.
 */
import type { EntityId, IsoDate, LoanId, PropertyId } from '@/shared/types/common';
import type { Money } from '@/shared/lib/money';

/**
 * A point-in-time record of portfolio totals, written when a period is closed.
 * Deltas on the dashboard compare today against the most recent snapshot rather
 * than recomputing history, so a restated valuation cannot silently rewrite a
 * previously reported movement.
 */
export interface PortfolioSnapshot {
  readonly id: string;
  readonly asOf: IsoDate;
  readonly netWorth: Money;
  readonly assets: Money;
  readonly liabilities: Money;
  /** Label used in the delta caption, e.g. "Jun 2026 snapshot". */
  readonly label: string;
}

/**
 * The entity a dashboard read is narrowed to. `null` wherever this type is
 * optional means the whole portfolio, consolidated.
 */
export interface DashboardScope {
  readonly entityId: EntityId;
  readonly entityName: string;
}

/** One choice in the scope switcher. */
export type ScopeOption = DashboardScope;

/** Net worth and its two components at a point in time (BR-01). */
export interface NetWorthBreakdown {
  readonly asOf: IsoDate;
  /** Included asset interests: property value at ownership share, plus receivables. */
  readonly assets: Money;
  /** Included liabilities. Receivables are never netted in here (FR-11). */
  readonly liabilities: Money;
  readonly netWorth: Money;
  /** Movement against the most recent snapshot, when one exists. */
  readonly movement: SnapshotMovement | null;
  /** Properties whose newest valuation has aged out of the ratio window. */
  readonly staleValuationCount: number;
}

export interface SnapshotMovement {
  readonly snapshotLabel: string;
  readonly netWorthChangeRatio: number;
  readonly liabilitiesChange: Money;
}

/**
 * One consolidated owner's position (BR-02).
 *
 * Each asset is counted once, at the owning entity's share. A company's equity
 * is **not** added on top of the properties it owns — that would double-count.
 */
export interface OwnershipPosition {
  readonly entityId: EntityId;
  readonly entityName: string;
  readonly assets: Money;
  readonly liabilities: Money;
  readonly net: Money;
  /** Share of total net worth, 0–1, for the bar width. */
  readonly shareOfTotal: number;
}

/** An item on the "needs attention" strip. */
export interface AttentionItem {
  readonly id: string;
  readonly tone: 'warn' | 'bad' | 'info';
  readonly icon: 'i-clock' | 'i-wallet' | 'i-alert' | 'i-link';
  readonly title: string;
  readonly detail: string;
  readonly href: string;
}

/**
 * The three financial views BR-03 requires to be reported separately.
 *
 * Conflating them is the classic error this rule exists to prevent: loan
 * principal is real cash leaving the account but is not an expense, so a "profit"
 * figure that subtracts it understates performance, while a "cash flow" figure
 * that ignores it overstates available cash.
 */
export interface FinancialPosition {
  readonly periodFrom: IsoDate;
  readonly periodTo: IsoDate;
  /** Cash actually received and paid, including loan principal as an outflow. */
  readonly cashFlow: CashFlowResult;
  /** Income less operating expenses. Excludes principal; includes interest. */
  readonly operatingResult: OperatingResult;
  /**
   * Deliberately absent. Tax outcomes need professional validation before any
   * jurisdiction-specific rule is activated, so the platform records inputs and
   * declines to estimate.
   */
  readonly taxEstimate: null;
  readonly taxEstimateNote: string;
}

export interface CashFlowResult {
  readonly receipts: Money;
  readonly outgoings: Money;
  readonly net: Money;
  /** Part of `outgoings` that repaid principal — cash out, but not an expense. */
  readonly loanPrincipal: Money;
  /** Excluded from both sides: internal transfers and loan drawdowns. */
  readonly excludedTransfers: Money;
}

export interface OperatingResult {
  readonly income: Money;
  readonly operatingExpenses: Money;
  /** Interest is an expense; principal is not. */
  readonly interestExpense: Money;
  readonly net: Money;
  /** Non-cash items are not modelled in this release. */
  readonly depreciation: null;
}

/** One month of the cash-flow chart. */
export interface CashFlowPoint {
  readonly month: IsoDate;
  readonly label: string;
  readonly receipts: Money;
  readonly outgoings: Money;
}

/* ---------- What-if scenarios (FR-11) ---------- */

/** A variable-rate facility as the simulator sees it: only what the rate maths needs. */
export interface ScenarioFacility {
  readonly loanId: LoanId;
  /** "CBA · Investment loan 8820". */
  readonly label: string;
  readonly balance: Money;
  /** Current annual nominal rate as a fraction, e.g. 0.0634. */
  readonly annualRate: number;
}

/** A property that can be marked vacant, with the rent it would stop producing. */
export interface ScenarioProperty {
  readonly propertyId: PropertyId;
  readonly name: string;
  /** Monthly-equivalent rent of the leases live on the as-of date; zero when already vacant. */
  readonly monthlyRent: Money;
  readonly leaseCount: number;
}

/**
 * Everything a scenario is computed from, gathered once on the server.
 *
 * Plain data, so the drawer can re-run the maths in the browser as controls
 * change — no round trip, and no second copy of the arithmetic.
 */
export interface ScenarioInputs {
  readonly asOf: IsoDate;
  /** The posted month the baseline comes from; null when nothing has been posted. */
  readonly baselineMonth: IsoDate | null;
  readonly baselineMonthLabel: string | null;
  readonly baselineReceipts: Money;
  readonly baselineOutgoings: Money;
  /** Receipts less outgoings for the baseline month (cash basis, BR-03). */
  readonly baselineCashFlow: Money;
  readonly variableFacilities: readonly ScenarioFacility[];
  /** Fixed-rate debt, reported so the reader can see what a rate shock does *not* touch. */
  readonly fixedDebt: Money;
  readonly fixedFacilityCount: number;
  readonly properties: readonly ScenarioProperty[];
}

export interface ScenarioParameters {
  /** Change to the annual rate in percentage points, e.g. 0.25 for +0.25%. */
  readonly rateDeltaPercent: number;
  readonly vacantPropertyIds?: readonly PropertyId[];
}

export interface ScenarioFacilityImpact extends ScenarioFacility {
  readonly simulatedRate: number;
  /** One month's interest at the current rate. */
  readonly baselineInterest: Money;
  /** Extra interest per month under the shock; negative for a rate cut. */
  readonly additionalInterest: Money;
  readonly simulatedInterest: Money;
}

/**
 * Sign convention: `interestImpact` and `rentalImpact` are costs (positive means
 * cash flow gets worse); `monthlyDelta` and `bufferImpact` are movements in cash
 * flow (negative means worse). The tiles read either without flipping a sign.
 */
export interface ScenarioResult {
  readonly asOf: IsoDate;
  readonly baselineMonthLabel: string | null;
  readonly rateDeltaPercent: number;
  /** The vacancies actually applied — unknown ids dropped, repeats collapsed. */
  readonly vacantPropertyIds: readonly PropertyId[];
  readonly baselineCashFlow: Money;
  readonly simulatedCashFlow: Money;
  readonly monthlyDelta: Money;
  readonly interestImpact: Money;
  readonly rentalImpact: Money;
  readonly baselineVariableInterest: Money;
  readonly simulatedVariableInterest: Money;
  readonly variableDebt: Money;
  readonly fixedDebt: Money;
  readonly bufferMonths: number;
  /** `monthlyDelta × bufferMonths`: what the shock does to a cash reserve over the horizon. */
  readonly bufferImpact: Money;
  readonly facilities: readonly ScenarioFacilityImpact[];
  readonly vacancies: readonly ScenarioProperty[];
}
