/**
 * Project model — the one place the Development Finance figures are composed
 * (§11, §14.1). Budgets, commitments, invoices, programme, sales and funding
 * each own their records; this module reads them into one typed input, runs
 * the finance engine over it and stores the result as an immutable
 * `CalculationRun` (CAL05). Cashflow, Summary, Scenarios, Reports and the
 * Assistant all read the same run — nothing else holds a formula.
 *
 * All amounts in these types are integer cents (`number`), not `Money`, so an
 * input can be hashed and stored as plain JSON and a result compared field by
 * field without helper objects.
 */
import type { FacilityTerms, MonthKey, TaxTreatment, XirrResult } from '@/shared/finance-engine';
import type { Available } from '@/shared/lib/result';
import type { CalculationRunId, IsoDate, IsoDateTime, ProjectId, ScenarioId, UserId } from '@/shared/types/common';
import type { TaxDisplayBasis } from '@/modules/projects/model';

/* ------------------------------------------------------------------ input */

export interface ModelCommitmentInput {
  readonly id: string;
  readonly reference: string;
  readonly supplierName: string;
  /** Original plus approved variations, tax-exclusive. */
  readonly revisedNetCents: number;
  /** Approved invoice cost against this commitment, tax-exclusive, net of credits. */
  readonly invoicedNetCents: number;
  readonly taxTreatment: TaxTreatment;
  readonly recoverablePpm: number;
}

export interface ModelApprovedInput {
  readonly invoiceId: string;
  readonly number: string;
  readonly supplierName: string;
  readonly sign: 1 | -1;
  readonly commitmentId: string | null;
  readonly allowanceTreatment: 'consume-allowance' | 'additional-scope' | null;
  readonly netCents: number;
  readonly taxCents: number;
  readonly grossCents: number;
  readonly economicCents: number;
  readonly expectedPaymentDate: IsoDate;
}

export interface ModelSettlementInput {
  readonly invoiceId: string;
  readonly date: IsoDate;
  readonly cashCents: number;
  readonly nonCashCents: number;
  /** Ratio used to translate paid cash into its economic share. */
  readonly invoiceGrossCents: number;
  readonly invoiceEconomicCents: number;
}

export interface ModelUnpaidInput {
  readonly invoiceId: string;
  readonly expectedPaymentDate: IsoDate;
  readonly grossCents: number;
  readonly economicCents: number;
  readonly retentionCents: number;
  readonly retentionReleaseDate?: IsoDate;
}

export interface ModelScheduleInput {
  readonly oneOffDate?: IsoDate;
  readonly startMonth?: MonthKey;
  readonly months?: number;
  readonly weights?: readonly { readonly month: MonthKey; readonly weightPpm: number }[];
  readonly milestoneOffsetDays?: number;
  readonly manual?: readonly { readonly date: IsoDate; readonly cents: number }[];
}

export type ForecastMethod = 'one-off' | 'equal-monthly' | 'weighted-monthly' | 'milestone-linked' | 'manual';

export interface ModelLineInput {
  readonly id: string;
  readonly code: string;
  readonly title: string;
  readonly categoryId: string;
  readonly rowType: 'posting' | 'summary';
  readonly parentLineId: string | null;
  readonly sortOrder: number;
  readonly active: boolean;
  readonly isContingency: boolean;
  readonly taxTreatment: TaxTreatment;
  readonly recoverablePpm: number;
  /** Current working budget, tax-exclusive. */
  readonly budgetNetCents: number;
  /** Selected baseline, tax-exclusive; null before a baseline is published. */
  readonly baselineNetCents: number | null;
  readonly commitments: readonly ModelCommitmentInput[];
  readonly approved: readonly ModelApprovedInput[];
  readonly settlements: readonly ModelSettlementInput[];
  readonly unpaid: readonly ModelUnpaidInput[];
  readonly forecastMethod: ForecastMethod;
  readonly schedule: ModelScheduleInput;
  readonly milestoneId: string | null;
}

export type RevenueEventType = 'deposit-held' | 'deposit-released' | 'settlement' | 'refund' | 'other-income';

export interface ModelRevenueEventInput {
  readonly id: string;
  readonly groupId: string;
  readonly label: string;
  readonly type: RevenueEventType;
  readonly date: IsoDate;
  /** Cash amount of the event (settlement = cash to seller). Positive magnitudes. */
  readonly grossCents: number;
  /** Output GST the event carries. */
  readonly taxCents: number;
  /** Purchaser withholding remitted at settlement — a credit against output GST (CAL12). */
  readonly withholdingCents: number;
  /** Full consideration for a settlement (cash + applied deposits + withholding), for net revenue. */
  readonly considerationCents: number;
  readonly restricted: boolean;
  readonly basis: 'actual' | 'forecast';
  readonly contractId: string | null;
}

export interface ModelLinkedObligationInput {
  readonly costLineCode: string;
  readonly contractId: string;
  readonly label: string;
  readonly amountNetCents: number;
  readonly triggerDate: IsoDate;
  readonly basis: 'actual' | 'forecast';
}

export interface ModelFacilityInput {
  readonly id: string;
  readonly name: string;
  readonly terms: FacilityTerms;
  readonly drawRank: number;
  readonly repayRank: number;
  readonly availableFrom: IsoDate;
  readonly availableTo: IsoDate;
  readonly maturityOn: IsoDate;
  readonly movements: readonly {
    readonly on: IsoDate;
    readonly kind: 'draw' | 'repayment' | 'fee' | 'correction';
    readonly cents: number;
    readonly basis: 'actual' | 'planned';
  }[];
}

export interface ModelParticipantInput {
  readonly id: string;
  readonly name: string;
  readonly commitmentCents: number;
  readonly rank: number;
  readonly residualShareWeight: number;
  readonly preferredRatePpm: number;
}

export interface ModelEquityMovementInput {
  readonly participantId: string;
  readonly on: IsoDate;
  readonly type: 'contribution' | 'capital-return' | 'preferred-return' | 'profit-distribution';
  readonly cents: number;
  readonly basis: 'actual' | 'planned';
}

export interface ModelMilestoneInput {
  readonly id: string;
  readonly name: string;
  readonly date: IsoDate;
  readonly kind: 'stage' | 'milestone' | 'task';
}

export interface ModelInput {
  readonly projectId: ProjectId;
  readonly code: string;
  readonly name: string;
  readonly asOf: IsoDate;
  readonly startMonth: MonthKey;
  readonly months: readonly MonthKey[];
  /** Periods on or before this date hold actuals only. */
  readonly cutoff: IsoDate;
  readonly cutoffMonth: MonthKey;
  readonly modelRevision: number;
  readonly policyVersion: number;
  readonly openingCashCents: number;
  readonly openingRestrictedCents: number;
  readonly taxRatePpm: number;
  readonly settlementLagMonths: number;
  readonly minimumReserveCents: number;
  readonly repayExcessCash: boolean;
  readonly autoFundForecast: boolean;
  readonly defaultBasis: TaxDisplayBasis;
  readonly categories: readonly { readonly id: string; readonly code: string; readonly name: string; readonly sortOrder: number }[];
  readonly lines: readonly ModelLineInput[];
  readonly revenueGroups: readonly { readonly id: string; readonly code: string; readonly name: string; readonly sortOrder: number }[];
  readonly revenueEvents: readonly ModelRevenueEventInput[];
  readonly linkedObligations: readonly ModelLinkedObligationInput[];
  readonly facilities: readonly ModelFacilityInput[];
  readonly participants: readonly ModelParticipantInput[];
  readonly equityMovements: readonly ModelEquityMovementInput[];
  readonly milestones: readonly ModelMilestoneInput[];
  readonly completionDate: IsoDate;
  readonly waterfall: { readonly published: boolean; readonly reserveCents: number; readonly versionLabel: string } | null;
  readonly unmatchedPayments: readonly { readonly paymentId: string; readonly date: IsoDate; readonly cents: number; readonly reference: string }[];
}

/* -------------------------------------------------------------- overrides */

/** What a scenario may change (SCN02). Everything here applies to forecasts only. */
export interface ScenarioOverrides {
  /** Uplift on unsold / uncontracted forecast prices. */
  readonly unsoldPriceUpliftPpm?: number;
  /** Uplift on eligible remaining costs. */
  readonly costUplift?: {
    readonly ppm: number;
    readonly categoryIds?: readonly string[];
    readonly lineIds?: readonly string[];
    /** Also uplift unbilled commitments (R), not just the uncommitted allowance (U). */
    readonly includeUnbilledCommitments: boolean;
  };
  /** Shift every milestone and forecast date after the cutoff by this many days. */
  readonly programmeShiftDays?: number;
  /** Replace a facility's rate from the first forecast month. */
  readonly facilityRatePpm?: Readonly<Record<string, number>>;
  /** Extra committed equity available to the funding order. */
  readonly additionalEquity?: readonly { readonly participantId: string; readonly cents: number }[];
  readonly settlementLagMonths?: number;
  readonly taxRatePpm?: number;
}

/* ----------------------------------------------------------------- result */

export type GridSection = 'revenue' | 'restricted' | 'costs' | 'tax' | 'financing' | 'cash';

export type GridRowKind = 'group' | 'parent' | 'posting' | 'total' | 'closing' | 'plain';

export interface GridRow {
  readonly id: string;
  readonly section: GridSection;
  readonly kind: GridRowKind;
  readonly level: number;
  readonly label: string;
  readonly code?: string;
  /** Cost line / category / revenue group id, for drill-through and nav. */
  readonly refId?: string;
  /** Monthly cash (or economic) amounts by month key, signed: inflow +, outflow −. */
  readonly months: Readonly<Record<MonthKey, number>>;
  readonly summary: {
    readonly current: number;
    readonly expended: number;
    readonly baseline: number | null;
    readonly variance: number | null;
    readonly committed: number;
    readonly approvedUnpaid: number;
    readonly remainingForecast: number;
  };
  /** Whether the row contributes to its section total (CF03). */
  readonly posting: boolean;
}

export interface LinePosition {
  readonly lineId: string;
  readonly code: string;
  readonly categoryId: string;
  readonly approvedCents: number;
  readonly approvedUnpaidCents: number;
  readonly unbilledCommitmentCents: number;
  readonly uncommittedCents: number;
  readonly committedCents: number;
  readonly settledCents: number;
  readonly eacCents: number;
  readonly remainingCashCents: number;
  readonly baselineCents: number | null;
  readonly varianceCents: number | null;
}

export interface MonthTotals {
  readonly month: MonthKey;
  readonly actual: boolean;
  readonly receiptsCents: number;
  readonly depositsHeldCents: number;
  readonly depositsReleasedCents: number;
  readonly developmentPaymentsCents: number;
  readonly taxRemittanceCents: number;
  readonly taxRefundCents: number;
  readonly equityContributionsCents: number;
  readonly debtDrawsCents: number;
  readonly cashInterestCents: number;
  readonly capitalisedInterestCents: number;
  readonly feesCents: number;
  readonly principalRepaymentsCents: number;
  readonly distributionsCents: number;
  readonly unfundedCents: number;
  readonly openingCashCents: number;
  readonly closingCashCents: number;
  readonly restrictedClosingCents: number;
  readonly debtClosingCents: number;
  readonly equityOutstandingCents: number;
}

export interface ModelKpis {
  readonly grossRevenueCents: number;
  readonly outputGstCents: number;
  readonly netRevenueCents: number;
  readonly economicCostCents: number;
  readonly grossCostCents: number;
  readonly financeCostCents: number;
  readonly profitCents: number;
  readonly marginOnCost: Available<number>;
  readonly marginOnRevenue: Available<number>;
  readonly projectIrr: XirrResult;
  readonly equityIrr: XirrResult;
  readonly peakDebtCents: number;
  readonly peakDebtOn: IsoDate | null;
  readonly peakEquityCents: number;
  readonly peakEquityOn: IsoDate | null;
  readonly fundingGapCents: number;
  readonly peakCashRequirementCents: number;
  readonly completionDate: IsoDate;
  readonly baselineCostCents: number | null;
  readonly costVarianceCents: number | null;
  readonly contractedRevenueCents: number;
  readonly uncontractedRevenueCents: number;
}

export interface ModelWarning {
  readonly code:
    | 'nonconvergent'
    | 'forecast-shifted'
    | 'facility-breach'
    | 'unfunded'
    | 'suspense-items'
    | 'no-published-waterfall'
    | 'missing-milestone'
    | 'negative-cash';
  readonly message: string;
  readonly month?: MonthKey;
  readonly refId?: string;
}

export interface BasisView {
  readonly rows: readonly GridRow[];
  readonly totals: readonly MonthTotals[];
  readonly kpis: ModelKpis;
}

export interface ModelResult {
  readonly months: readonly MonthKey[];
  readonly cutoffMonth: MonthKey;
  readonly economic: BasisView;
  readonly gross: BasisView;
  readonly positions: readonly LinePosition[];
  readonly facilities: readonly {
    readonly id: string;
    readonly name: string;
    readonly months: readonly {
      readonly month: MonthKey;
      readonly openingCents: number;
      readonly drawsCents: number;
      readonly repaymentsCents: number;
      readonly capitalisedCents: number;
      readonly cashInterestCents: number;
      readonly feesCents: number;
      readonly closingCents: number;
      readonly unusedCents: number;
      readonly breaches: number;
    }[];
    readonly generatedDraws: readonly { readonly on: IsoDate; readonly cents: number }[];
    readonly generatedRepayments: readonly { readonly on: IsoDate; readonly cents: number }[];
  }[];
  readonly generatedEquity: readonly { readonly participantId: string; readonly on: IsoDate; readonly cents: number }[];
  readonly terminalDistribution: readonly { readonly participantId: string; readonly cents: number }[] | null;
  readonly warnings: readonly ModelWarning[];
  readonly iterations: number;
}

/* -------------------------------------------------------- calculation run */

export type CalculationRunStatus = 'completed' | 'nonconvergent' | 'failed';

export interface CalculationRun {
  readonly id: CalculationRunId;
  readonly projectId: ProjectId;
  /** Null for the current model; set when a scenario produced the run. */
  readonly scenarioId: ScenarioId | null;
  readonly modelRevision: number;
  readonly actualsCutoff: IsoDate;
  readonly inputHash: string;
  readonly policyVersion: number;
  readonly engineVersion: string;
  readonly status: CalculationRunStatus;
  readonly createdAt: IsoDateTime;
  readonly createdBy: UserId;
  readonly input: ModelInput;
  readonly overrides: ScenarioOverrides | null;
  readonly result: ModelResult;
  readonly warnings: readonly ModelWarning[];
}

/** One contribution behind a grid cell (CF05). */
export interface CellContribution {
  readonly source:
    | 'settled-payment'
    | 'approved-unpaid'
    | 'retention'
    | 'forecast-allowance'
    | 'unbilled-commitment'
    | 'linked-obligation'
    | 'revenue-event'
    | 'gst'
    | 'facility'
    | 'equity'
    | 'generated-funding'
    | 'suspense';
  readonly label: string;
  readonly cents: number;
  readonly date: IsoDate;
  readonly status: string;
  readonly basis: 'actual' | 'forecast' | 'approved';
  readonly taxBasis: string;
  readonly editable: boolean;
  readonly href?: string;
}
