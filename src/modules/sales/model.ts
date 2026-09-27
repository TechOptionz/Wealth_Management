/**
 * Development Finance — yield and revenue (YLD01–YLD06, REV01, CAL12).
 *
 * Four rules are structural:
 *  1. **Sales status is derived, never stored.** A unit's status is the state
 *     of its current contract; `contractPrice` is that contract's
 *     consideration. Nothing caches either (YLD03).
 *  2. **Actual revenue events are stored; forecast events are computed.**
 *     Deposits held, releases, settlements and refunds that happened are
 *     records. What is expected to happen is derived on read from contracts,
 *     unit forecasts and milestone dates, so it can never drift (YLD06).
 *  3. **Deposits in trust are restricted cash.** A `deposit-held` event is
 *     `restricted: true`; only an explicit `deposit-released` moves the money
 *     into project funding (YLD04, AT12).
 *  4. **Purchaser GST withholding is not an expense.** It is cash the
 *     purchaser pays to the tax authority on the seller's behalf and a credit
 *     of the same amount; it is carried on the settlement event so it is
 *     counted once (CAL12).
 */
import type { Ppm, TaxTreatment } from '@/shared/finance-engine';
import type { Money } from '@/shared/lib/money';
import type {
  IsoDate,
  IsoDateTime,
  MilestoneId,
  OtherIncomeId,
  ProjectId,
  RevenueEventId,
  SaleContractId,
  UnitId,
  UserId,
} from '@/shared/types/common';

export type SalesStatus = 'available' | 'reserved' | 'exchanged' | 'unconditional' | 'settled' | 'cancelled';

export const SALES_STATUSES: readonly SalesStatus[] = ['available', 'reserved', 'exchanged', 'unconditional', 'settled', 'cancelled'];

export const SALES_STATUS_LABELS: Record<SalesStatus, string> = {
  available: 'Available',
  reserved: 'Reserved',
  exchanged: 'Exchanged',
  unconditional: 'Unconditional',
  settled: 'Settled',
  cancelled: 'Cancelled',
};

export type ContractState = 'reserved' | 'exchanged' | 'unconditional' | 'settled' | 'cancelled';

export const CONTRACT_STATES: readonly ContractState[] = ['reserved', 'exchanged', 'unconditional', 'settled', 'cancelled'];

/** Forward path plus cancellation from any live state (YLD03). */
export const CONTRACT_TRANSITIONS: Record<ContractState, readonly ContractState[]> = {
  reserved: ['exchanged', 'cancelled'],
  exchanged: ['unconditional', 'cancelled'],
  unconditional: ['settled', 'cancelled'],
  settled: [],
  cancelled: [],
};

/** A contract that still binds the unit: not settled, not cancelled. */
export function isLiveContractState(state: ContractState): boolean {
  return state === 'reserved' || state === 'exchanged' || state === 'unconditional';
}

export type SaleableAreaBasis = 'internal' | 'internal-plus-external';
export const SALEABLE_AREA_BASES: readonly SaleableAreaBasis[] = ['internal', 'internal-plus-external'];
export const SALEABLE_AREA_BASIS_LABELS: Record<SaleableAreaBasis, string> = {
  internal: 'Internal area only',
  'internal-plus-external': 'Internal + external area',
};

export type PricingMode = 'per-unit' | 'per-sqm';
export const PRICING_MODES: readonly PricingMode[] = ['per-unit', 'per-sqm'];
export const PRICING_MODE_LABELS: Record<PricingMode, string> = {
  'per-unit': 'Price per unit',
  'per-sqm': 'Price per m² of saleable area',
};

export interface HistoryEntry {
  readonly at: IsoDateTime;
  readonly actor: UserId;
  readonly field: string;
  readonly before: unknown;
  readonly after: unknown;
  readonly reason?: string;
}

/** A revenue group: the Revenue sidebar children (§3.1). */
export interface RevenueGroup {
  readonly id: string;
  readonly projectId: ProjectId;
  readonly code: string;
  readonly name: string;
  readonly sortOrder: number;
}

export interface Unit {
  readonly id: UnitId;
  readonly projectId: ProjectId;
  readonly groupId: string;
  /** Unique within the project. */
  readonly code: string;
  readonly stage?: string;
  readonly productType: string;
  readonly level?: string;
  readonly bedrooms: number;
  readonly carSpaces: number;
  /** Square metres. Never negative. */
  readonly internalAreaSqm: number;
  readonly externalAreaSqm: number;
  /** Which areas are priced when the pricing mode is per m² — balconies are not internal (YLD02). */
  readonly saleableAreaBasis: SaleableAreaBasis;
  readonly pricingMode: PricingMode;
  /** The rate a per-m² price was built from; absent for per-unit pricing. */
  readonly pricePerSqm?: Money;
  readonly askingPrice: Money;
  /** The price the forecast uses while the unit is uncontracted. Gross including GST when standard. */
  readonly forecastPrice: Money;
  readonly taxTreatment: TaxTreatment;
  /** Forecast settlement timing for an uncontracted unit: a milestone, or a fixed date (PRG04). */
  readonly forecastSettlementMilestoneId?: MilestoneId;
  readonly forecastSettlementDate?: IsoDate;
  readonly history: readonly HistoryEntry[];
  readonly createdAt: IsoDateTime;
}

export interface DepositScheduleEntry {
  readonly dueOn: IsoDate;
  readonly amount: Money;
}

export interface SaleContract {
  readonly id: SaleContractId;
  readonly projectId: ProjectId;
  readonly unitId: UnitId;
  /** Restricted: shown only to people with `sales.edit`, never to investors (YLD03). */
  readonly purchaserReference: string;
  readonly state: ContractState;
  /** Gross, including GST when the treatment is standard. */
  readonly consideration: Money;
  readonly taxTreatment: TaxTreatment;
  readonly contractDate: IsoDate;
  readonly expectedSettlement: IsoDate;
  readonly actualSettlement?: IsoDate;
  readonly exchangedOn?: IsoDate;
  readonly unconditionalOn?: IsoDate;
  readonly depositSchedule: readonly DepositScheduleEntry[];
  /** Settlement adjustments (rates, water, etc.), added to the consideration at settlement. */
  readonly adjustments: Money;
  /** Purchaser GST withholding remitted at settlement (CAL12). */
  readonly withholding: Money;
  readonly cancellationReason?: string;
  readonly createdAt: IsoDateTime;
  readonly createdBy: UserId;
  readonly history: readonly HistoryEntry[];
}

export type RevenueEventType = 'deposit-held' | 'deposit-released' | 'settlement' | 'refund' | 'other-income';

export const REVENUE_EVENT_LABELS: Record<RevenueEventType, string> = {
  'deposit-held': 'Deposit held in trust',
  'deposit-released': 'Deposit released',
  settlement: 'Settlement receipt',
  refund: 'Deposit refunded',
  'other-income': 'Other income',
};

export interface RevenueEvent {
  readonly id: RevenueEventId;
  readonly projectId: ProjectId;
  readonly contractId?: SaleContractId;
  readonly unitId?: UnitId;
  readonly otherIncomeId?: OtherIncomeId;
  readonly type: RevenueEventType;
  readonly date: IsoDate;
  /**
   * Cash the event moves. For a settlement this is the cash to the seller
   * (consideration + adjustments − applied deposits − withholding); for a
   * refund it is the amount returned to the purchaser.
   */
  readonly gross: Money;
  /** The output GST the event carries, so the caller can build the GST position. */
  readonly tax: Money;
  /** True while the money sits in trust (YLD04). */
  readonly restricted: boolean;
  readonly basis: 'actual' | 'forecast';
  /** Settlement only: withholding paid to the tax authority on the seller's behalf (CAL12). */
  readonly withholding?: Money;
  readonly note?: string;
}

export type OtherIncomeMode = 'one-off' | 'recurring';

export interface OtherIncome {
  readonly id: OtherIncomeId;
  readonly projectId: ProjectId;
  readonly groupId: string;
  readonly description: string;
  readonly taxTreatment: TaxTreatment;
  readonly mode: OtherIncomeMode;
  readonly date?: IsoDate;
  readonly startDate?: IsoDate;
  readonly endDate?: IsoDate;
  /** Gross per month for a recurring line. */
  readonly monthlyAmount?: Money;
  /** Gross for a one-off line. */
  readonly amount?: Money;
}

export type CommissionTrigger = 'exchange' | 'unconditional' | 'settlement';
export const COMMISSION_TRIGGERS: readonly CommissionTrigger[] = ['exchange', 'unconditional', 'settlement'];
export type CancellationTreatment = 'reverse' | 'retain';
export const CANCELLATION_TREATMENTS: readonly CancellationTreatment[] = ['reverse', 'retain'];

export interface CommissionRule {
  readonly id: string;
  readonly projectId: ProjectId;
  readonly basis: 'rate' | 'amount';
  readonly ratePpm?: Ppm;
  readonly amount?: Money;
  readonly trigger: CommissionTrigger;
  readonly cancellationTreatment: CancellationTreatment;
  readonly costLineCode: 'COMM-01';
}

/** The area a per-m² price applies to, per the unit's explicit basis (YLD02). */
export function saleableAreaOf(unit: Pick<Unit, 'internalAreaSqm' | 'externalAreaSqm' | 'saleableAreaBasis'>): number {
  return unit.saleableAreaBasis === 'internal' ? unit.internalAreaSqm : unit.internalAreaSqm + unit.externalAreaSqm;
}
