/**
 * Primitive domain types shared by every module.
 * Nothing here may import from a module — dependencies point inward only.
 */

/** ISO-4217 currency code. The platform is single-currency (AUD) in Release 1. */
export type CurrencyCode = 'AUD';

/** An ISO-8601 calendar date with no time component, e.g. "2026-09-06". */
export type IsoDate = string;

/** An ISO-8601 instant, e.g. "2026-09-06T08:51:00.000Z". */
export type IsoDateTime = string;

/** Branded identifier so ids of different aggregates cannot be swapped by mistake. */
export type Id<TBrand extends string> = string & { readonly __brand: TBrand };

export type EntityId = Id<'Entity'>;
export type PropertyId = Id<'Property'>;
export type PropertyComponentId = Id<'PropertyComponent'>;
export type ValuationId = Id<'Valuation'>;
export type LeaseId = Id<'Lease'>;
export type TenantId = Id<'Tenant'>;
export type RentChargeId = Id<'RentCharge'>;
export type ObligationId = Id<'Obligation'>;
export type ReminderId = Id<'Reminder'>;
export type LoanId = Id<'Loan'>;
export type DocumentId = Id<'Document'>;
export type BankImportId = Id<'BankImport'>;
export type BankTransactionId = Id<'BankTransaction'>;
export type UserId = Id<'User'>;
export type AuditEventId = Id<'AuditEvent'>;

/* ---------- Development Finance ids ---------- */
export type OrganisationId = Id<'Organisation'>;
export type LegalEntityId = Id<'LegalEntity'>;
export type ProjectId = Id<'Project'>;
export type ProjectPolicyId = Id<'ProjectPolicy'>;
export type ProjectAccessId = Id<'ProjectAccess'>;
export type CostCategoryId = Id<'CostCategory'>;
export type CostLineId = Id<'CostLine'>;
export type BudgetVersionId = Id<'BudgetVersion'>;
export type ForecastAllowanceId = Id<'ForecastAllowance'>;
export type ForecastAllocationId = Id<'ForecastAllocation'>;
export type ForecastBatchId = Id<'ForecastBatch'>;
export type SupplierId = Id<'Supplier'>;
export type CommitmentId = Id<'Commitment'>;
export type VariationId = Id<'Variation'>;
export type ContingencyTransferId = Id<'ContingencyTransfer'>;
export type InvoiceIntakeId = Id<'InvoiceIntake'>;
export type InvoiceId = Id<'Invoice'>;
export type InvoiceRevisionId = Id<'InvoiceRevision'>;
export type ApprovalDecisionId = Id<'ApprovalDecision'>;
export type PaymentId = Id<'Payment'>;
export type SettlementAllocationId = Id<'SettlementAllocation'>;
export type RetentionTrancheId = Id<'RetentionTranche'>;
export type ReconciliationItemId = Id<'ReconciliationItem'>;
export type PaymentImportId = Id<'PaymentImport'>;
export type OutboxEventId = Id<'OutboxEvent'>;
export type MilestoneId = Id<'Milestone'>;
export type TaskDependencyId = Id<'TaskDependency'>;
export type UnitId = Id<'Unit'>;
export type SaleContractId = Id<'SaleContract'>;
export type RevenueEventId = Id<'RevenueEvent'>;
export type OtherIncomeId = Id<'OtherIncome'>;
export type DebtFacilityId = Id<'DebtFacility'>;
export type FacilityMovementId = Id<'FacilityMovement'>;
export type EquityParticipantId = Id<'EquityParticipant'>;
export type EquityMovementId = Id<'EquityMovement'>;
export type WaterfallVersionId = Id<'WaterfallVersion'>;
export type ScenarioId = Id<'Scenario'>;
export type ScenarioOverrideId = Id<'ScenarioOverride'>;
export type CalculationRunId = Id<'CalculationRun'>;
export type ReportJobId = Id<'ReportJob'>;
export type ReportSnapshotId = Id<'ReportSnapshot'>;
export type AssistantRequestId = Id<'AssistantRequest'>;

/** Cast a raw string to a branded id at a trust boundary (seed data, request parsing). */
export function asId<TBrand extends string>(raw: string): Id<TBrand> {
  return raw as Id<TBrand>;
}

/** A half-open date range: `from` inclusive, `to` exclusive/open when null. */
export interface DateRange {
  readonly from: IsoDate;
  readonly to: IsoDate | null;
}

/** Every record carries provenance so the UI can always answer "where did this come from?". */
export interface Provenance {
  readonly recordedAt: IsoDateTime;
  readonly recordedBy: UserId;
  /** Optional source document backing the record (FR-04 linkage). */
  readonly sourceDocumentId?: DocumentId;
}

/** Standard cursorless pagination envelope used by list endpoints. */
export interface Page<T> {
  readonly items: readonly T[];
  readonly total: number;
}

/** Severity vocabulary shared by chips, banners and attention items. */
export type Tone = 'good' | 'warn' | 'bad' | 'info' | 'neutral' | 'gold';
