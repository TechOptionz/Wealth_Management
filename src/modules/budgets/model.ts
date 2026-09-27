/**
 * Development Finance — cost categories, cost lines, budget adjustments,
 * baselines and forecast batches (§5: CST01, CST02, CST08; §6: CF03, CF04,
 * CF06, CF07, CF09; PRJ04, PRJ05).
 *
 * Four rules this model makes structural:
 *  1. **Only posting rows carry money.** A summary row groups its children and
 *     never adds an amount of its own (CF03, F02). `rowType` says which.
 *  2. **The current budget is derived.** `originalBudget` is what the line was
 *     created with; every later movement is a `BudgetAdjustment` that names its
 *     source and target, so the current figure is always
 *     `original + Σ to − Σ from` and can never drift (CST08).
 *  3. **Baselines are immutable snapshots.** A published `BudgetVersion` keeps
 *     approver, timestamp, reason and the model revision it came from; a newer
 *     baseline supersedes it but never edits or deletes it (PRJ05, AT02).
 *  4. **Edits are batches.** Forecast changes are saved together against a
 *     model revision; an undo is a compensating batch, not a deletion (CF07,
 *     CF09).
 *
 * **Basis.** Every budget, adjustment and baseline amount is tax-exclusive
 * (net of GST). The project model grosses up per the line's `taxTreatment`
 * and `recoverablePpm`; nothing here stores a gross figure.
 */
import type { MonthKey, Ppm, TaxTreatment } from '@/shared/finance-engine';
import { mulDivCents } from '@/shared/finance-engine';
import { addMoney, formatMoney, money, subtractMoney, type Money } from '@/shared/lib/money';
import { ValidationError } from '@/shared/lib/errors';
import type {
  BudgetVersionId,
  CostCategoryId,
  CostLineId,
  ForecastBatchId,
  IsoDate,
  IsoDateTime,
  MilestoneId,
  ProjectId,
  UserId,
} from '@/shared/types/common';

export interface CostCategory {
  readonly id: CostCategoryId;
  readonly projectId: ProjectId;
  /** Short stable code, unique within the project: "CON". */
  readonly code: string;
  readonly name: string;
  readonly parentId?: CostCategoryId;
  readonly sortOrder: number;
}

/** The CST01 starting set. A project may add, rename or nest categories; nothing downstream is hard-coded to these. */
export const DEFAULT_CATEGORY_TEMPLATE: readonly { readonly code: string; readonly name: string }[] = [
  { code: 'ACQ', name: 'Acquisition' },
  { code: 'HOLD', name: 'Holding' },
  { code: 'PROF', name: 'Professional services' },
  { code: 'CON', name: 'Construction' },
  { code: 'STAT', name: 'Statutory charges' },
  { code: 'MKT', name: 'Marketing' },
  { code: 'COMM', name: 'Sales commission' },
  { code: 'OPEX', name: 'Operating expenses' },
  { code: 'CONT', name: 'Contingency' },
  { code: 'FIN', name: 'Finance expenses' },
];

export type RowType = 'posting' | 'summary';
export const ROW_TYPES: readonly RowType[] = ['posting', 'summary'];
export const ROW_TYPE_LABELS: Record<RowType, string> = { posting: 'Posting', summary: 'Summary' };

/** Quantity × rate and a direct amount are mutually exclusive ways to state a budget (CST02). */
export type InputMode = 'quantity-rate' | 'direct';
export const INPUT_MODES: readonly InputMode[] = ['direct', 'quantity-rate'];
export const INPUT_MODE_LABELS: Record<InputMode, string> = { direct: 'Direct amount', 'quantity-rate': 'Quantity × rate' };

export type ForecastMethod = 'one-off' | 'equal-monthly' | 'weighted-monthly' | 'milestone-linked' | 'manual';
export const FORECAST_METHODS: readonly ForecastMethod[] = ['one-off', 'equal-monthly', 'weighted-monthly', 'milestone-linked', 'manual'];
export const FORECAST_METHOD_LABELS: Record<ForecastMethod, string> = {
  'one-off': 'One-off',
  'equal-monthly': 'Equal monthly',
  'weighted-monthly': 'Weighted monthly',
  'milestone-linked': 'Milestone linked',
  manual: 'Manual schedule',
};

export type TimingMode = 'fixed-date' | 'milestone-offset' | 'manual';
export const TIMING_MODES: readonly TimingMode[] = ['fixed-date', 'milestone-offset', 'manual'];

/** The timing mode a forecast method implies. */
export function timingModeFor(method: ForecastMethod): TimingMode {
  if (method === 'milestone-linked') return 'milestone-offset';
  if (method === 'manual') return 'manual';
  return 'fixed-date';
}

/**
 * How a line's remaining amount is spread over time (CF04). Which fields
 * matter depends on `forecastMethod`; the rest are ignored but kept so a method
 * switch can be undone without losing what was typed.
 */
export interface ForecastSchedule {
  readonly oneOffDate?: IsoDate;
  readonly startMonth?: MonthKey;
  readonly months?: number;
  /** Weights must total exactly 1_000_000 ppm; the residual cent lands on the last month. */
  readonly weights?: readonly { readonly month: MonthKey; readonly weightPpm: Ppm }[];
  readonly milestoneOffsetDays?: number;
  /** Hand-entered dated amounts (ex GST cents) that must reconcile to the line's budget. */
  readonly manual?: readonly { readonly date: IsoDate; readonly cents: number }[];
}

/** One appended history entry. Corrections append; nothing is overwritten silently. */
export interface CostLineChange {
  readonly at: IsoDateTime;
  readonly actor: UserId;
  readonly field: string;
  readonly before: unknown;
  readonly after: unknown;
  readonly reason?: string;
}

export interface CostLine {
  readonly id: CostLineId;
  readonly projectId: ProjectId;
  readonly categoryId: CostCategoryId;
  /** Stable, unique within the project. Never changes once created (CST02). */
  readonly code: string;
  readonly title: string;
  readonly description?: string;
  readonly rowType: RowType;
  /** A summary row this line rolls up into. Only summary rows may be parents. */
  readonly parentLineId?: CostLineId;
  readonly inputMode: InputMode;
  /** Up to four decimal places; only in quantity-rate mode. */
  readonly quantity?: number;
  readonly unit?: string;
  /** Ex GST. */
  readonly rate?: Money;
  /** Ex GST. The budget the line was created with; in quantity-rate mode it is exactly quantity × rate. */
  readonly originalBudget: Money;
  readonly taxTreatment: TaxTreatment;
  /** Share of GST on this line that is recoverable (CAL10). */
  readonly recoverablePpm: Ppm;
  readonly forecastMethod: ForecastMethod;
  readonly schedule: ForecastSchedule;
  readonly timingMode: TimingMode;
  readonly milestoneId?: MilestoneId;
  readonly responsibleUserId?: UserId;
  /** Inactive lines stay in aggregates unless a screen filters them out and says so (CF03). */
  readonly active: boolean;
  /** An explicit allowance; drawn down through paired transfers, never a percentage of anything (CST08). */
  readonly isContingency: boolean;
  readonly sortOrder: number;
  readonly history: readonly CostLineChange[];
  readonly createdAt: IsoDateTime;
}

export type AdjustmentKind = 'contingency-draw' | 'transfer' | 'scope-change' | 'manual';
export const ADJUSTMENT_KINDS: readonly AdjustmentKind[] = ['contingency-draw', 'transfer', 'scope-change', 'manual'];
export const ADJUSTMENT_KIND_LABELS: Record<AdjustmentKind, string> = {
  'contingency-draw': 'Contingency draw',
  transfer: 'Transfer',
  'scope-change': 'Scope change',
  manual: 'Manual edit',
};

/**
 * A movement of budget (ex GST). `fromLineId` loses `amount`, `toLineId` gains
 * it; a one-sided adjustment changes the project total, a paired one does not.
 */
export interface BudgetAdjustment {
  readonly id: string;
  readonly projectId: ProjectId;
  readonly kind: AdjustmentKind;
  readonly fromLineId?: CostLineId;
  readonly toLineId?: CostLineId;
  /** Always positive; direction comes from which line ids are set. */
  readonly amount: Money;
  readonly reason: string;
  readonly actor: UserId;
  readonly at: IsoDateTime;
  /** The model revision this adjustment belongs to. */
  readonly revision: number;
}

export type BudgetVersionState = 'draft' | 'published' | 'superseded';
export const BUDGET_VERSION_STATE_LABELS: Record<BudgetVersionState, string> = {
  draft: 'Draft candidate',
  published: 'Published · selected',
  superseded: 'Superseded · still readable',
};

/** An approved baseline: a snapshot of every posting line's current budget, ex GST (PRJ05). */
export interface BudgetVersion {
  readonly id: BudgetVersionId;
  readonly projectId: ProjectId;
  readonly name: string;
  readonly state: BudgetVersionState;
  readonly lines: readonly { readonly costLineId: CostLineId; readonly amount: Money }[];
  readonly createdAt: IsoDateTime;
  readonly createdBy: UserId;
  readonly approvedBy?: UserId;
  readonly approvedAt?: IsoDateTime;
  readonly reason?: string;
  /** The model revision the snapshot was taken from. */
  readonly sourceRevision: number;
}

export type ForecastEditField = 'budget' | 'forecastMethod' | 'schedule' | 'milestoneId' | 'timingMode';

export interface ForecastBatchChange {
  readonly costLineId: CostLineId;
  readonly field: ForecastEditField;
  readonly before: unknown;
  readonly after: unknown;
}

/** One saved editing session (CF07). An undo is a new batch that compensates an earlier one (CF09). */
export interface ForecastBatch {
  readonly id: ForecastBatchId;
  readonly projectId: ProjectId;
  readonly actor: UserId;
  readonly at: IsoDateTime;
  readonly revisionBefore: number;
  readonly revisionAfter: number;
  readonly changes: readonly ForecastBatchChange[];
  readonly compensatesBatchId?: ForecastBatchId;
  readonly undoneByBatchId?: ForecastBatchId;
}

/** One line's requested change inside a batch. `budget` is the new current budget (ex GST), not a delta. */
export interface ForecastEdit {
  readonly costLineId: CostLineId;
  readonly budget?: Money;
  readonly reason?: string;
  readonly forecastMethod?: ForecastMethod;
  readonly schedule?: ForecastSchedule;
  readonly milestoneId?: MilestoneId;
  readonly timingMode?: TimingMode;
}

/** Quantities are exact to four decimal places; more would be rounded silently, so it is refused. */
export const QUANTITY_SCALE = 10_000;

/**
 * quantity × rate without floating-point dollars: the quantity is scaled to an
 * integer and the product is one exact `mulDivCents` (CST02, CAL01).
 */
export function quantityRateBudget(quantity: number, rate: Money): Money {
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new ValidationError('Enter a quantity greater than zero.', { fieldErrors: { quantity: ['A quantity must be greater than zero.'] } });
  }
  const scaled = Math.round(quantity * QUANTITY_SCALE);
  if (Math.abs(quantity * QUANTITY_SCALE - scaled) > 1e-6) {
    throw new ValidationError('Quantities support up to four decimal places.', {
      fieldErrors: { quantity: ['Use at most four decimal places.'] },
    });
  }
  if (rate.cents < 0) {
    throw new ValidationError('A rate cannot be negative.', { fieldErrors: { rate: ['Enter zero or more.'] } });
  }
  return money(mulDivCents(rate.cents, scaled, QUANTITY_SCALE), rate.currency);
}

/**
 * Variance in words, never colour alone. For a cost, a positive variance
 * (current above baseline) is adverse; nothing here implies green is good.
 */
export function varianceWords(current: Money, baseline: Money | null): { readonly text: string; readonly amount: Money | null; readonly adverse: boolean } {
  if (baseline === null) return { text: 'No baseline', amount: null, adverse: false };
  const diff = subtractMoney(current, baseline);
  if (diff.cents === 0) return { text: 'On baseline', amount: diff, adverse: false };
  if (diff.cents > 0) return { text: `${formatMoney(diff)} over baseline`, amount: diff, adverse: true };
  return { text: `${formatMoney(money(-diff.cents, diff.currency))} under baseline`, amount: diff, adverse: false };
}

/** Sum of a baseline's snapshot, ex GST. */
export function baselineTotal(version: Pick<BudgetVersion, 'lines'> | null): Money | null {
  return version ? version.lines.reduce<Money>((total, entry) => addMoney(total, entry.amount), money(0)) : null;
}
