/**
 * Scenarios domain model (SCN01–SCN06).
 *
 * A scenario is a named set of overrides applied to a **pinned** base: the
 * calculation run of the current model at the moment the scenario was created
 * or last refreshed. Recorded actuals come from that run's frozen input, so
 * nothing inside a scenario can rewrite a payment, a supplier or an approval.
 * New actuals reach a scenario only through an explicit refresh, which makes a
 * new version and says why (SCN04).
 */
import type { CalculationRunId, IsoDate, IsoDateTime, ProjectId, ScenarioId, UserId } from '@/shared/types/common';
import type { ScenarioOverrides } from '@/modules/project-model/model';

export type ScenarioState = 'draft' | 'published' | 'archived';

export interface ScenarioVersion {
  readonly version: number;
  /** Null for a seeded scenario that has not been calculated yet: it pins on first calculation. */
  readonly baseRunId: CalculationRunId | null;
  readonly baseRevision: number;
  readonly actualsCutoff: IsoDate;
  readonly at: IsoDateTime;
  readonly by: UserId;
  readonly reason: string;
}

export interface Scenario {
  readonly id: ScenarioId;
  readonly projectId: ProjectId;
  readonly name: string;
  readonly description: string;
  readonly state: ScenarioState;
  readonly overrides: ScenarioOverrides;
  readonly versions: readonly ScenarioVersion[];
  readonly createdAt: IsoDateTime;
  readonly createdBy: UserId;
  readonly publishedAt?: IsoDateTime;
  readonly publishedBy?: UserId;
  readonly publishReason?: string;
  readonly publishedChanges?: readonly string[];
}

export const SCENARIO_STATE_LABELS: Record<ScenarioState, string> = {
  draft: 'Draft',
  published: 'Published',
  archived: 'Archived',
};

/** The metrics SCN03 compares, in display order. */
export type ComparisonMetric =
  | 'revenue'
  | 'cost'
  | 'financeCost'
  | 'profit'
  | 'marginOnCost'
  | 'marginOnRevenue'
  | 'projectIrr'
  | 'equityIrr'
  | 'peakDebt'
  | 'peakEquity'
  | 'fundingGap'
  | 'completion';

export const COMPARISON_METRICS: readonly ComparisonMetric[] = [
  'revenue',
  'cost',
  'financeCost',
  'profit',
  'marginOnCost',
  'marginOnRevenue',
  'projectIrr',
  'equityIrr',
  'peakDebt',
  'peakEquity',
  'fundingGap',
  'completion',
];

export const COMPARISON_LABELS: Record<ComparisonMetric, string> = {
  revenue: 'Net revenue',
  cost: 'Economic cost (excl. finance)',
  financeCost: 'Finance costs',
  profit: 'Development profit',
  marginOnCost: 'Margin on cost',
  marginOnRevenue: 'Margin on revenue',
  projectIrr: 'Project IRR',
  equityIrr: 'Equity IRR',
  peakDebt: 'Peak debt',
  peakEquity: 'Peak equity',
  fundingGap: 'Funding gap',
  completion: 'Completion date',
};

export type MetricKind = 'money' | 'ratio' | 'date';

export const METRIC_KIND: Record<ComparisonMetric, MetricKind> = {
  revenue: 'money',
  cost: 'money',
  financeCost: 'money',
  profit: 'money',
  marginOnCost: 'ratio',
  marginOnRevenue: 'ratio',
  projectIrr: 'ratio',
  equityIrr: 'ratio',
  peakDebt: 'money',
  peakEquity: 'money',
  fundingGap: 'money',
  completion: 'date',
};

/** Whether a higher value is better, so a variance can be described in words. */
export const HIGHER_IS_BETTER: Record<ComparisonMetric, boolean | null> = {
  revenue: true,
  cost: false,
  financeCost: false,
  profit: true,
  marginOnCost: true,
  marginOnRevenue: true,
  projectIrr: true,
  equityIrr: true,
  peakDebt: false,
  peakEquity: false,
  fundingGap: false,
  completion: false,
};

export interface MetricValue {
  /** Cents for money, a ratio for ratios, an ISO date for dates; null when not available. */
  readonly value: number | string | null;
  readonly unavailableReason?: string;
}

export interface ComparisonColumn {
  readonly key: string;
  readonly label: string;
  readonly runId: string;
  readonly stale: boolean;
  readonly values: Readonly<Record<ComparisonMetric, MetricValue>>;
  /** Scenario minus base: cents for money, percentage points for ratios, days for dates. */
  readonly variances: Readonly<Record<ComparisonMetric, number | null>> | null;
}

export type SensitivityDriver = 'unsold-price' | 'uncommitted-construction' | 'remaining-cost' | 'interest-rate' | 'programme-delay';

export const SENSITIVITY_DRIVER_LABELS: Record<SensitivityDriver, string> = {
  'unsold-price': 'Unsold sale price (%)',
  'uncommitted-construction': 'Uncommitted construction forecast (%)',
  'remaining-cost': 'All eligible remaining costs (%)',
  'interest-rate': 'Facility interest rate (percentage points)',
  'programme-delay': 'Programme delay (days)',
};

export interface SensitivityAxis {
  readonly driver: SensitivityDriver;
  readonly from: number;
  readonly to: number;
  readonly step: number;
}

export interface SensitivityMatrix {
  readonly rows: SensitivityAxis;
  readonly columns: SensitivityAxis;
  readonly rowValues: readonly number[];
  readonly columnValues: readonly number[];
  /** Profit in cents at each (row, column). */
  readonly profit: readonly (readonly number[])[];
  readonly marginOnCost: readonly (readonly (number | null)[])[];
  readonly baseProfitCents: number;
  readonly baseRunId: string;
}
