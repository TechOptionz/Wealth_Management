/**
 * Sales, yield and revenue business logic (YLD01–YLD06, REV01, CAL04, CAL12).
 *
 * The rules this file makes structural:
 *  - **Status is derived.** `salesStatusOf` reads the unit's current contract;
 *    nothing stores a status or a contract price on the unit.
 *  - **Actual events are stored, forecast events are computed.** A settlement,
 *    deposit, release or refund that happened is a record; everything expected
 *    is recomputed from contracts, unit forecasts and milestone dates on read.
 *  - **Settlement arithmetic is the finance engine's.** `settlementReceipt`
 *    gives the cash to the seller; withholding is carried on the event as a
 *    credit, never as a deduction from revenue (CAL12, F09).
 *  - **Deposits in trust are restricted** until a release is recorded (YLD04).
 *  - **Commission is one obligation per contract**, derived from the rule and
 *    keyed by contract id, so a recalculation cannot duplicate it (YLD05).
 *  - **A contracted price changes only by contract variation** (YLD02).
 */
import { randomUUID } from 'node:crypto';
import {
  applyPpm,
  dateInMonth,
  mulDivCents,
  monthKeyOf,
  monthKeysBetween,
  settlementReceipt,
  taxFromGross,
  TAX_TREATMENTS,
  type Ppm,
  type TaxSettings,
  type TaxTreatment,
} from '@/shared/finance-engine';
import { ConflictError, NotFoundError, ValidationError } from '@/shared/lib/errors';
import { money, type Money } from '@/shared/lib/money';
import { available, unavailable, type Available } from '@/shared/lib/result';
import {
  asId,
  type IsoDate,
  type MilestoneId,
  type ProjectId,
  type RevenueEventId,
  type SaleContractId,
  type UnitId,
  type UserId,
} from '@/shared/types/common';
import { accessService } from '@/modules/access/service';
import { projectsService } from '@/modules/projects/service';
import { programmeService } from '@/modules/programme/service';
import { salesRepository } from './repository';
import {
  CONTRACT_TRANSITIONS,
  SALES_STATUSES,
  SALES_STATUS_LABELS,
  isLiveContractState,
  saleableAreaOf,
  type CancellationTreatment,
  type CommissionRule,
  type CommissionTrigger,
  type ContractState,
  type DepositScheduleEntry,
  type HistoryEntry,
  type OtherIncome,
  type PricingMode,
  type RevenueEvent,
  type RevenueGroup,
  type SaleContract,
  type SaleableAreaBasis,
  type SalesStatus,
  type Unit,
} from './model';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export type MilestoneDateResolver = (id: MilestoneId) => IsoDate;

export interface UnitInput {
  readonly groupId: string;
  readonly code: string;
  readonly stage?: string;
  readonly productType: string;
  readonly level?: string;
  readonly bedrooms: number;
  readonly carSpaces: number;
  readonly internalAreaSqm: number;
  readonly externalAreaSqm: number;
  readonly saleableAreaBasis: SaleableAreaBasis;
  readonly pricingMode: PricingMode;
  /** Required for per-unit pricing. */
  readonly askingPrice?: Money;
  readonly forecastPrice?: Money;
  /** Required for per-m² pricing; prices are rate × saleable area on the unit's basis. */
  readonly pricePerSqm?: Money;
  readonly taxTreatment: TaxTreatment;
  readonly forecastSettlementMilestoneId?: MilestoneId;
  readonly forecastSettlementDate?: IsoDate;
}

export type UnitChanges = Partial<Omit<UnitInput, 'groupId'>> & { readonly groupId?: string };

export interface BulkPriceChangeInput {
  readonly projectId: ProjectId;
  readonly unitIds?: readonly UnitId[];
  readonly groupId?: string;
  readonly mode: 'percent' | 'amount' | 'set';
  readonly valuePpm?: Ppm;
  readonly amount?: Money;
  readonly includeContracted?: boolean;
  readonly viaContractVariation?: boolean;
  readonly actor: UserId;
  /** True computes the old and new prices and writes nothing. */
  readonly preview?: boolean;
  readonly reason?: string;
}

export interface BulkPriceChangeResult {
  readonly changes: readonly { readonly unitId: UnitId; readonly code: string; readonly from: Money; readonly to: Money }[];
  readonly skipped: readonly { readonly unitId: UnitId; readonly code: string; readonly reason: 'contracted' }[];
}

export interface CreateContractInput {
  readonly projectId: ProjectId;
  readonly unitId: UnitId;
  readonly purchaserReference: string;
  readonly consideration: Money;
  readonly taxTreatment: TaxTreatment;
  readonly contractDate: IsoDate;
  readonly expectedSettlement: IsoDate;
  readonly depositSchedule: readonly DepositScheduleEntry[];
  readonly adjustments?: Money;
  readonly withholding?: Money;
  readonly actor: UserId;
  readonly expectedRevision?: number;
}

export interface CommissionObligation {
  readonly contractId: SaleContractId;
  readonly unitCode: string;
  readonly amount: Money;
  readonly triggerDate: IsoDate;
  readonly basis: 'actual' | 'forecast';
  readonly costLineCode: 'COMM-01';
}

export interface YieldSummary {
  readonly unitCount: number;
  readonly byStatus: Record<SalesStatus, number>;
  readonly saleableAreaSqm: number;
  readonly contractedRevenue: Money;
  readonly uncontractedForecastRevenue: Money;
  readonly averageSalePrice: Available<Money>;
  readonly salesProgressRatio: Available<number>;
  /** Deposits still in trust: held − released − refunded (restricted cash). */
  readonly heldDeposits: Money;
  /** Deposits released to the project by a recorded release. */
  readonly releasedDeposits: Money;
  /**
   * Σ settlement cash + withholding + deposits applied, actual and forecast,
   * over units that are not cancelled. Equals Σ contract consideration (plus
   * adjustments) and forecast prices by construction (YLD06).
   */
  readonly totalGrossRevenue: Money;
}

export interface OtherIncomeInput {
  readonly projectId: ProjectId;
  readonly groupId: string;
  readonly description: string;
  readonly taxTreatment: TaxTreatment;
  readonly mode: 'one-off' | 'recurring';
  readonly date?: IsoDate;
  readonly amount?: Money;
  readonly startDate?: IsoDate;
  readonly endDate?: IsoDate;
  readonly monthlyAmount?: Money;
  readonly actor: UserId;
}

export interface CommissionRuleInput {
  readonly basis: 'rate' | 'amount';
  readonly ratePpm?: Ppm;
  readonly amount?: Money;
  readonly trigger: CommissionTrigger;
  readonly cancellationTreatment: CancellationTreatment;
}

function now(): string {
  return new Date().toISOString();
}

function today(): IsoDate {
  return now().slice(0, 10);
}

function actorName(userId: UserId): string {
  return accessService.resolveUserName(userId) ?? 'system';
}

function historyEntry(actor: UserId, field: string, before: unknown, after: unknown, reason?: string): HistoryEntry {
  return { at: now(), actor, field, before, after, ...(reason ? { reason } : {}) };
}

function fail(message: string, field: string, hint: string): never {
  throw new ValidationError(message, { fieldErrors: { [field]: [hint] } });
}

function assertDate(value: string | undefined, label: string, field: string): void {
  if (value !== undefined && !ISO_DATE.test(value)) fail(`Enter ${label} as YYYY-MM-DD.`, field, 'Use the format YYYY-MM-DD.');
}

function assertNonNegativeMoney(value: Money | undefined, label: string, field: string): void {
  if (value !== undefined && value.cents < 0) fail(`${label} cannot be negative.`, field, 'Enter zero or more.');
}

function taxSettings(projectId: ProjectId): TaxSettings {
  const policy = projectsService.policyFor(projectId);
  return { standardRatePpm: policy.tax.standardRatePpm, marginSchemeEnabled: policy.tax.marginSchemeEnabled };
}

/** The contract that currently decides a unit's status: the latest one. */
function currentContract(unitId: UnitId): SaleContract | undefined {
  const all = salesRepository.listContractsForUnit(unitId);
  return all[all.length - 1];
}

function liveContract(unitId: UnitId): SaleContract | undefined {
  return salesRepository.listContractsForUnit(unitId).find((row) => isLiveContractState(row.state));
}

/** Deposits on a contract, from stored events. */
function depositPosition(contractId: SaleContractId): { held: number; released: number; refunded: number } {
  const events = salesRepository.listEventsForContract(contractId);
  const total = (type: RevenueEvent['type']): number => events.filter((row) => row.type === type).reduce((acc, row) => acc + row.gross.cents, 0);
  return { held: total('deposit-held'), released: total('deposit-released'), refunded: total('refund') };
}

/** Validate a unit's fields and resolve its prices from the pricing mode (YLD01, YLD02). */
function normaliseUnit(projectId: ProjectId, input: UnitInput, existingId?: UnitId): Omit<Unit, 'id' | 'projectId' | 'history' | 'createdAt'> {
  const code = input.code.trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9-]{0,19}$/.test(code)) fail('Enter a unit code of 1–20 letters, digits or hyphens.', 'code', 'Use letters, digits and hyphens, e.g. TH-09.');
  const clash = salesRepository.findUnitByCode(projectId, code);
  if (clash && clash.id !== existingId) fail(`Unit code ${code} is already used in this project.`, 'code', 'Each unit code must be unique within the project.');
  const group = salesRepository.findGroup(input.groupId);
  if (!group || group.projectId !== projectId) fail('Choose a revenue group in this project.', 'groupId', 'Select a group.');
  if (!input.productType.trim()) fail('Enter a product type.', 'productType', 'e.g. 3-bed townhouse.');
  for (const [field, value, label] of [
    ['bedrooms', input.bedrooms, 'Bedrooms'],
    ['carSpaces', input.carSpaces, 'Car spaces'],
  ] as const) {
    if (!Number.isInteger(value) || value < 0) fail(`${label} must be a whole number of zero or more.`, field, 'Enter zero or more.');
  }
  for (const [field, value, label] of [
    ['internalAreaSqm', input.internalAreaSqm, 'Internal area'],
    ['externalAreaSqm', input.externalAreaSqm, 'External area'],
  ] as const) {
    if (!Number.isFinite(value) || value < 0) fail(`${label} cannot be negative.`, field, 'Enter square metres of zero or more.');
  }
  if (!TAX_TREATMENTS.includes(input.taxTreatment)) fail('Choose a tax treatment.', 'taxTreatment', 'Select a treatment.');
  assertDate(input.forecastSettlementDate, 'the forecast settlement date', 'forecastSettlementDate');
  assertNonNegativeMoney(input.pricePerSqm, 'The price per m²', 'pricePerSqm');
  assertNonNegativeMoney(input.askingPrice, 'The asking price', 'askingPrice');
  assertNonNegativeMoney(input.forecastPrice, 'The forecast price', 'forecastPrice');
  if (input.forecastSettlementMilestoneId) programmeService.requireMilestone(input.forecastSettlementMilestoneId);

  let askingPrice: Money;
  let forecastPrice: Money;
  if (input.pricingMode === 'per-sqm') {
    if (!input.pricePerSqm) fail('A per-m² unit needs a price per m².', 'pricePerSqm', 'Enter the rate per m².');
    // Square metres may carry decimals; price in whole cents from area in hundredths.
    const areaHundredths = Math.round(saleableAreaOf(input) * 100);
    const priced = money(mulDivCents(input.pricePerSqm.cents, areaHundredths, 100));
    askingPrice = input.askingPrice ?? priced;
    forecastPrice = input.forecastPrice ?? priced;
  } else {
    if (!input.askingPrice && !input.forecastPrice) fail('Enter an asking or forecast price.', 'forecastPrice', 'Enter a price.');
    askingPrice = input.askingPrice ?? (input.forecastPrice as Money);
    forecastPrice = input.forecastPrice ?? (input.askingPrice as Money);
  }
  return {
    groupId: input.groupId,
    code,
    ...(input.stage?.trim() ? { stage: input.stage.trim() } : {}),
    productType: input.productType.trim(),
    ...(input.level?.trim() ? { level: input.level.trim() } : {}),
    bedrooms: input.bedrooms,
    carSpaces: input.carSpaces,
    internalAreaSqm: input.internalAreaSqm,
    externalAreaSqm: input.externalAreaSqm,
    saleableAreaBasis: input.saleableAreaBasis,
    pricingMode: input.pricingMode,
    ...(input.pricePerSqm ? { pricePerSqm: input.pricePerSqm } : {}),
    askingPrice,
    forecastPrice,
    taxTreatment: input.taxTreatment,
    ...(input.forecastSettlementMilestoneId ? { forecastSettlementMilestoneId: input.forecastSettlementMilestoneId } : {}),
    ...(input.forecastSettlementDate ? { forecastSettlementDate: input.forecastSettlementDate } : {}),
  };
}

function forecastId(parts: readonly string[]): RevenueEventId {
  return asId<'RevenueEvent'>(`fc-${parts.join('-')}`);
}

export const salesService = {
  listGroups(projectId: ProjectId): readonly RevenueGroup[] {
    return salesRepository.listGroups(projectId);
  },

  requireGroup(id: string): RevenueGroup {
    const group = salesRepository.findGroup(id);
    if (!group) throw new NotFoundError('Revenue group', id);
    return group;
  },

  /** The Revenue sidebar children (§3.1). */
  revenueGroupsForNav(projectId: ProjectId): readonly { readonly id: string; readonly label: string }[] {
    return salesRepository.listGroups(projectId).map((group) => ({ id: group.id, label: group.name }));
  },

  listUnits(projectId: ProjectId, filter: { readonly groupId?: string } = {}): readonly Unit[] {
    const rows = salesRepository.listUnits(projectId).filter((unit) => !filter.groupId || unit.groupId === filter.groupId);
    return [...rows].sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
  },

  requireUnit(id: UnitId): Unit {
    const unit = salesRepository.findUnit(id);
    if (!unit) throw new NotFoundError('Unit', id);
    return unit;
  },

  /** YLD03 — derived from the current contract, never stored. */
  salesStatusOf(unitId: UnitId): SalesStatus {
    const contract = currentContract(unitId);
    return contract ? contract.state : 'available';
  },

  /** The current contract's consideration, or null for an uncontracted unit. */
  contractPriceOf(unitId: UnitId): Money | null {
    const contract = currentContract(unitId);
    return contract && contract.state !== 'cancelled' ? contract.consideration : null;
  },

  currentContractOf(unitId: UnitId): SaleContract | undefined {
    return currentContract(unitId);
  },

  createUnit(projectId: ProjectId, input: UnitInput, actor: UserId, expectedRevision?: number): Unit {
    projectsService.assertMutable(projectId);
    const fields = normaliseUnit(projectId, input);
    const created = salesRepository.insertUnit({
      id: asId<'Unit'>(`unit-${randomUUID()}`),
      projectId,
      ...fields,
      history: [historyEntry(actor, 'created', null, fields.code)],
      createdAt: now(),
    });
    projectsService.bumpRevision(projectId, expectedRevision);
    accessService.record({
      actor: actorName(actor),
      summary: `Unit created · ${created.code}`,
      context: `${projectsService.require(projectId).code} · ${created.productType} · forecast ${created.forecastPrice.cents / 100}`,
    });
    return created;
  },

  /** Edit a unit. Price changes on a contracted unit are refused: use a contract variation (YLD02). */
  updateUnit(id: UnitId, changes: UnitChanges, actor: UserId, reason?: string): Unit {
    const current = salesService.requireUnit(id);
    projectsService.assertMutable(current.projectId);
    const priceTouched =
      (changes.askingPrice && changes.askingPrice.cents !== current.askingPrice.cents) ||
      (changes.forecastPrice && changes.forecastPrice.cents !== current.forecastPrice.cents) ||
      (changes.pricePerSqm && changes.pricePerSqm.cents !== current.pricePerSqm?.cents);
    const status = salesService.salesStatusOf(id);
    if (priceTouched && status !== 'available' && status !== 'cancelled') {
      fail(`${current.code} is ${SALES_STATUS_LABELS[status].toLowerCase()}; its price changes only through a contract variation.`, 'forecastPrice', 'Vary the contract instead.');
    }
    const merged: UnitInput = {
      groupId: changes.groupId ?? current.groupId,
      code: changes.code ?? current.code,
      stage: changes.stage ?? current.stage,
      productType: changes.productType ?? current.productType,
      level: changes.level ?? current.level,
      bedrooms: changes.bedrooms ?? current.bedrooms,
      carSpaces: changes.carSpaces ?? current.carSpaces,
      internalAreaSqm: changes.internalAreaSqm ?? current.internalAreaSqm,
      externalAreaSqm: changes.externalAreaSqm ?? current.externalAreaSqm,
      saleableAreaBasis: changes.saleableAreaBasis ?? current.saleableAreaBasis,
      pricingMode: changes.pricingMode ?? current.pricingMode,
      pricePerSqm: changes.pricePerSqm ?? current.pricePerSqm,
      // Per-m² units re-price from the rate unless a price is given explicitly.
      askingPrice: changes.askingPrice ?? ((changes.pricingMode ?? current.pricingMode) === 'per-sqm' ? undefined : current.askingPrice),
      forecastPrice: changes.forecastPrice ?? ((changes.pricingMode ?? current.pricingMode) === 'per-sqm' ? undefined : current.forecastPrice),
      taxTreatment: changes.taxTreatment ?? current.taxTreatment,
      forecastSettlementMilestoneId: changes.forecastSettlementMilestoneId ?? current.forecastSettlementMilestoneId,
      forecastSettlementDate: changes.forecastSettlementDate ?? current.forecastSettlementDate,
    };
    const fields = normaliseUnit(current.projectId, merged, id);
    if (status !== 'available' && status !== 'cancelled' && (fields.askingPrice.cents !== current.askingPrice.cents || fields.forecastPrice.cents !== current.forecastPrice.cents)) {
      fail(`${current.code} is contracted; its price changes only through a contract variation.`, 'forecastPrice', 'Vary the contract instead.');
    }
    const entries: HistoryEntry[] = [];
    for (const [field, after] of Object.entries(fields)) {
      const before = current[field as keyof Unit];
      if (JSON.stringify(before) !== JSON.stringify(after)) entries.push(historyEntry(actor, field, before ?? null, after, reason));
    }
    if (entries.length === 0) return current;
    const updated = salesRepository.updateUnit(id, { ...fields, history: [...current.history, ...entries] });
    if (!updated) throw new NotFoundError('Unit', id);
    projectsService.bumpRevision(current.projectId);
    accessService.record({
      actor: actorName(actor),
      summary: `Unit updated · ${updated.code}`,
      context: `Fields: ${entries.map((entry) => entry.field).join(', ')}${reason ? ` · ${reason}` : ''}`,
    });
    return updated;
  },

  /** YLD01 — import a unit schedule. All or nothing: one bad row saves no rows. */
  importUnits(input: { readonly projectId: ProjectId; readonly rows: readonly UnitInput[]; readonly actor: UserId; readonly expectedRevision?: number }): readonly Unit[] {
    projectsService.assertMutable(input.projectId);
    if (input.rows.length === 0) throw new ValidationError('The import has no rows.');
    const seen = new Set<string>();
    const problems: { row: number; message: string }[] = [];
    const prepared = input.rows.map((row, index) => {
      try {
        const fields = normaliseUnit(input.projectId, row);
        if (seen.has(fields.code)) throw new ValidationError(`Unit code ${fields.code} appears twice in the import.`);
        seen.add(fields.code);
        return fields;
      } catch (error) {
        problems.push({ row: index + 1, message: error instanceof Error ? error.message : String(error) });
        return null;
      }
    });
    if (problems.length > 0) {
      throw new ValidationError(`${problems.length} row(s) failed; nothing was imported. Row ${problems[0]?.row}: ${problems[0]?.message}`, { rows: problems });
    }
    const at = now();
    const created = prepared.map((fields) =>
      salesRepository.insertUnit({
        id: asId<'Unit'>(`unit-${randomUUID()}`),
        projectId: input.projectId,
        ...(fields as NonNullable<typeof fields>),
        history: [historyEntry(input.actor, 'imported', null, (fields as NonNullable<typeof fields>).code)],
        createdAt: at,
      }),
    );
    projectsService.bumpRevision(input.projectId, input.expectedRevision);
    accessService.record({
      actor: actorName(input.actor),
      summary: `Unit schedule imported · ${created.length} units`,
      context: projectsService.require(input.projectId).code,
    });
    return created;
  },

  /**
   * YLD02 — change forecast prices across a selection. Contracted units are
   * skipped and listed unless `viaContractVariation`, which also varies the
   * contract consideration with history. One model revision for the batch.
   */
  bulkPriceChange(input: BulkPriceChangeInput): BulkPriceChangeResult {
    projectsService.assertMutable(input.projectId);
    if (input.includeContracted && !input.viaContractVariation) {
      fail('A contracted unit changes price only through a contract variation.', 'includeContracted', 'Choose "vary contracts" to include contracted units.');
    }
    if (input.mode === 'percent' && (input.valuePpm === undefined || !Number.isInteger(input.valuePpm))) fail('Enter the percentage change.', 'value', 'e.g. 2.5 or -3.');
    if ((input.mode === 'amount' || input.mode === 'set') && !input.amount) fail('Enter the amount.', 'value', 'Enter an amount.');
    const targets = salesService
      .listUnits(input.projectId, input.groupId ? { groupId: input.groupId } : {})
      .filter((unit) => !input.unitIds || input.unitIds.includes(unit.id));
    if (targets.length === 0) throw new ValidationError('No units match the selection.');

    const priced = (from: Money): Money => {
      const cents =
        input.mode === 'percent'
          ? from.cents + applyPpm(from.cents, input.valuePpm as number)
          : input.mode === 'amount'
            ? from.cents + (input.amount as Money).cents
            : (input.amount as Money).cents;
      return money(cents);
    };

    const changes: { unitId: UnitId; code: string; from: Money; to: Money; contract?: SaleContract }[] = [];
    const skipped: { unitId: UnitId; code: string; reason: 'contracted' }[] = [];
    for (const unit of targets) {
      const contract = currentContract(unit.id);
      const contracted = contract !== undefined && contract.state !== 'cancelled';
      if (contracted && (!input.viaContractVariation || contract.state === 'settled')) {
        skipped.push({ unitId: unit.id, code: unit.code, reason: 'contracted' });
        continue;
      }
      const from = contracted ? contract.consideration : unit.forecastPrice;
      const to = priced(from);
      if (to.cents < 0) fail(`${unit.code} would be priced below zero.`, 'value', 'Prices cannot be negative.');
      changes.push({ unitId: unit.id, code: unit.code, from, to, ...(contracted ? { contract } : {}) });
    }
    const result: BulkPriceChangeResult = {
      changes: changes.map(({ unitId, code, from, to }) => ({ unitId, code, from, to })),
      skipped,
    };
    if (input.preview || changes.length === 0) return result;

    const reason = input.reason?.trim() || 'Bulk price change';
    for (const change of changes) {
      const unit = salesService.requireUnit(change.unitId);
      if (change.contract) {
        salesRepository.updateContract(change.contract.id, {
          consideration: change.to,
          history: [...change.contract.history, historyEntry(input.actor, 'consideration', change.from, change.to, `Contract variation · ${reason}`)],
        });
      }
      salesRepository.updateUnit(unit.id, {
        forecastPrice: change.to,
        history: [...unit.history, historyEntry(input.actor, 'forecastPrice', unit.forecastPrice, change.to, reason)],
      });
    }
    projectsService.bumpRevision(input.projectId);
    accessService.record({
      actor: actorName(input.actor),
      summary: `Bulk price change · ${changes.length} unit(s)`,
      context: `${projectsService.require(input.projectId).code} · ${input.mode} · ${skipped.length} contracted skipped${input.viaContractVariation ? ' · contracts varied' : ''} · ${reason}`,
    });
    return result;
  },

  /** YLD02 — the only path that changes a contracted price. */
  varyContract(input: { readonly contractId: SaleContractId; readonly consideration: Money; readonly reason: string; readonly actor: UserId }): SaleContract {
    const contract = salesService.requireContract(input.contractId);
    projectsService.assertMutable(contract.projectId);
    if (!isLiveContractState(contract.state)) throw new ConflictError(`A ${contract.state} contract cannot be varied.`);
    if (!input.reason.trim()) fail('Give a reason for the variation.', 'reason', 'A reason is required.');
    assertNonNegativeMoney(input.consideration, 'The consideration', 'consideration');
    const updated = salesRepository.updateContract(contract.id, {
      consideration: input.consideration,
      history: [...contract.history, historyEntry(input.actor, 'consideration', contract.consideration, input.consideration, input.reason.trim())],
    });
    if (!updated) throw new NotFoundError('Sale contract', contract.id);
    projectsService.bumpRevision(contract.projectId);
    accessService.record({
      actor: actorName(input.actor),
      summary: `Contract varied · ${salesService.requireUnit(contract.unitId).code}`,
      context: `${contract.consideration.cents / 100} → ${input.consideration.cents / 100} · ${input.reason.trim()}`,
    });
    return updated;
  },

  listContracts(projectId: ProjectId): readonly SaleContract[] {
    return salesRepository.listContracts(projectId);
  },

  requireContract(id: SaleContractId): SaleContract {
    const contract = salesRepository.findContract(id);
    if (!contract) throw new NotFoundError('Sale contract', id);
    return contract;
  },

  /** YLD03 — a new contract starts reserved; a unit holds at most one live contract. */
  createContract(input: CreateContractInput): SaleContract {
    projectsService.assertMutable(input.projectId);
    const unit = salesService.requireUnit(input.unitId);
    if (unit.projectId !== input.projectId) throw new NotFoundError('Unit', input.unitId);
    const live = liveContract(unit.id);
    if (live) throw new ConflictError(`${unit.code} already has a ${live.state} contract; cancel it before recording another.`);
    if (currentContract(unit.id)?.state === 'settled') throw new ConflictError(`${unit.code} has settled.`);
    if (!input.purchaserReference.trim()) fail('Enter the purchaser reference.', 'purchaserReference', 'e.g. PUR-2026-0450.');
    if (input.consideration.cents <= 0) fail('The consideration must be greater than zero.', 'consideration', 'Enter the contract price.');
    assertNonNegativeMoney(input.withholding, 'Withholding', 'withholding');
    assertDate(input.contractDate, 'the contract date', 'contractDate');
    assertDate(input.expectedSettlement, 'the expected settlement', 'expectedSettlement');
    if (input.expectedSettlement < input.contractDate) fail('Settlement cannot precede the contract.', 'expectedSettlement', 'Choose a date on or after the contract date.');
    const depositTotal = input.depositSchedule.reduce((acc, row) => {
      assertDate(row.dueOn, 'each deposit due date', 'depositSchedule');
      if (row.amount.cents <= 0) fail('Each scheduled deposit must be greater than zero.', 'depositSchedule', 'Enter a positive amount.');
      return acc + row.amount.cents;
    }, 0);
    if (depositTotal > input.consideration.cents) fail('Deposits cannot exceed the consideration.', 'depositSchedule', 'Reduce the deposits.');
    const settings = taxSettings(input.projectId);
    // The reviewed default: withholding equals the GST inside the price (CAL12).
    const withholding = input.withholding ?? (input.taxTreatment === 'standard-gst' ? money(taxFromGross(input.consideration.cents, 'standard-gst', settings)) : money(0));
    const created = salesRepository.insertContract({
      id: asId<'SaleContract'>(`sc-${randomUUID()}`),
      projectId: input.projectId,
      unitId: unit.id,
      purchaserReference: input.purchaserReference.trim(),
      state: 'reserved',
      consideration: input.consideration,
      taxTreatment: input.taxTreatment,
      contractDate: input.contractDate,
      expectedSettlement: input.expectedSettlement,
      depositSchedule: [...input.depositSchedule].sort((a, b) => a.dueOn.localeCompare(b.dueOn)),
      adjustments: input.adjustments ?? money(0),
      withholding,
      createdAt: now(),
      createdBy: input.actor,
      history: [historyEntry(input.actor, 'state', null, 'reserved')],
    });
    projectsService.bumpRevision(input.projectId, input.expectedRevision);
    accessService.record({
      actor: actorName(input.actor),
      summary: `Sale contract recorded · ${unit.code} · reserved`,
      context: `${projectsService.require(input.projectId).code} · consideration ${input.consideration.cents / 100} · settlement ${input.expectedSettlement}`,
    });
    return created;
  },

  /**
   * YLD03/YLD04 — move a contract along reserved → exchanged → unconditional
   * → settled, or cancel it from any live state with a reason.
   *
   * Settling records one actual settlement event (cash to seller per
   * `settlementReceipt`, output GST as tax, withholding carried as a credit)
   * and a release for any deposit still in trust, applied at settlement.
   * Cancelling refunds any deposit still in trust and keeps every earlier
   * receipt; nothing is deleted.
   */
  transitionContract(input: { readonly contractId: SaleContractId; readonly to: ContractState; readonly actor: UserId; readonly on?: IsoDate; readonly reason?: string; readonly expectedRevision?: number }): SaleContract {
    const contract = salesService.requireContract(input.contractId);
    projectsService.assertMutable(contract.projectId);
    if (!CONTRACT_TRANSITIONS[contract.state].includes(input.to)) {
      throw new ConflictError(`A ${contract.state} contract cannot move to ${input.to}.`);
    }
    assertDate(input.on, 'the date', 'on');
    const unit = salesService.requireUnit(contract.unitId);
    const on = input.on ?? today();
    const changes: Partial<Omit<SaleContract, 'id'>> = {};

    if (input.to === 'cancelled') {
      if (!input.reason?.trim()) fail('Give a reason for the cancellation.', 'reason', 'A reason is required to cancel.');
      const deposits = depositPosition(contract.id);
      const inTrust = deposits.held - deposits.released - deposits.refunded;
      if (inTrust > 0) {
        salesRepository.insertEvent({
          id: asId<'RevenueEvent'>(`rev-${randomUUID()}`),
          projectId: contract.projectId,
          contractId: contract.id,
          unitId: unit.id,
          type: 'refund',
          date: on,
          gross: money(inTrust),
          tax: money(0),
          restricted: true,
          basis: 'actual',
          note: `Deposit refunded from trust on cancellation · ${input.reason.trim()}`,
        });
      }
      Object.assign(changes, { cancellationReason: input.reason.trim() });
    }

    if (input.to === 'exchanged') Object.assign(changes, { exchangedOn: on });
    if (input.to === 'unconditional') Object.assign(changes, { unconditionalOn: on });

    if (input.to === 'settled') {
      if (!input.on) fail('Enter the settlement date.', 'on', 'Settlement needs the actual date.');
      const settings = taxSettings(contract.projectId);
      const deposits = depositPosition(contract.id);
      const inTrust = deposits.held - deposits.released - deposits.refunded;
      if (inTrust > 0) {
        salesRepository.insertEvent({
          id: asId<'RevenueEvent'>(`rev-${randomUUID()}`),
          projectId: contract.projectId,
          contractId: contract.id,
          unitId: unit.id,
          type: 'deposit-released',
          date: on,
          gross: money(inTrust),
          tax: money(0),
          restricted: false,
          basis: 'actual',
          note: 'Deposit released from trust and applied to the price at settlement',
        });
      }
      const grossConsideration = contract.consideration.cents + contract.adjustments.cents;
      const outputGst = taxFromGross(grossConsideration, contract.taxTreatment, settings);
      const receipt = settlementReceipt({
        grossConsiderationCents: grossConsideration,
        outputGstCents: outputGst,
        withholdingCents: contract.withholding.cents,
        appliedDepositsCents: deposits.held - deposits.refunded,
      });
      salesRepository.insertEvent({
        id: asId<'RevenueEvent'>(`rev-${randomUUID()}`),
        projectId: contract.projectId,
        contractId: contract.id,
        unitId: unit.id,
        type: 'settlement',
        date: on,
        gross: money(receipt.cashToSellerCents),
        tax: money(outputGst),
        restricted: false,
        basis: 'actual',
        withholding: contract.withholding,
        note: `Withholding ${contract.withholding.cents / 100} paid to the tax authority · credit against GST · residual GST ${receipt.residualGstCents / 100}`,
      });
      Object.assign(changes, { actualSettlement: on });
    }

    const updated = salesRepository.updateContract(contract.id, {
      ...changes,
      state: input.to,
      history: [...contract.history, historyEntry(input.actor, 'state', contract.state, input.to, input.reason?.trim())],
    });
    if (!updated) throw new NotFoundError('Sale contract', contract.id);
    projectsService.bumpRevision(contract.projectId, input.expectedRevision);
    accessService.record({
      actor: actorName(input.actor),
      summary: `Sale contract ${input.to} · ${unit.code}`,
      context: `${contract.state} → ${input.to} · ${on}${input.reason ? ` · ${input.reason.trim()}` : ''}`,
    });
    return updated;
  },

  /** YLD04 — a deposit received is held in trust: restricted cash. */
  recordDeposit(input: { readonly contractId: SaleContractId; readonly amount: Money; readonly on: IsoDate; readonly actor: UserId }): RevenueEvent {
    const contract = salesService.requireContract(input.contractId);
    projectsService.assertMutable(contract.projectId);
    if (!isLiveContractState(contract.state)) throw new ConflictError(`A ${contract.state} contract takes no further deposits.`);
    if (input.amount.cents <= 0) fail('A deposit must be greater than zero.', 'amount', 'Enter the amount received.');
    assertDate(input.on, 'the date received', 'on');
    const event = salesRepository.insertEvent({
      id: asId<'RevenueEvent'>(`rev-${randomUUID()}`),
      projectId: contract.projectId,
      contractId: contract.id,
      unitId: contract.unitId,
      type: 'deposit-held',
      date: input.on,
      gross: input.amount,
      tax: money(0),
      restricted: true,
      basis: 'actual',
      note: 'Deposit held in trust',
    });
    projectsService.bumpRevision(contract.projectId);
    accessService.record({
      actor: actorName(input.actor),
      summary: `Deposit held in trust · ${salesService.requireUnit(contract.unitId).code}`,
      context: `${input.amount.cents / 100} · ${input.on} · restricted`,
    });
    return event;
  },

  /** YLD04 — only an explicitly recorded, permitted release funds the project. */
  releaseDeposit(input: { readonly contractId: SaleContractId; readonly amount: Money; readonly on: IsoDate; readonly reason: string; readonly actor: UserId }): RevenueEvent {
    const contract = salesService.requireContract(input.contractId);
    projectsService.assertMutable(contract.projectId);
    if (!isLiveContractState(contract.state)) throw new ConflictError(`Deposits on a ${contract.state} contract cannot be released.`);
    if (!input.reason.trim()) fail('Record the permission for the release.', 'reason', 'e.g. Release permitted under clause 4.2 of the contract.');
    if (input.amount.cents <= 0) fail('A release must be greater than zero.', 'amount', 'Enter the amount released.');
    assertDate(input.on, 'the release date', 'on');
    const deposits = depositPosition(contract.id);
    const inTrust = deposits.held - deposits.released - deposits.refunded;
    if (input.amount.cents > inTrust) fail(`Only ${inTrust / 100} is held in trust on this contract.`, 'amount', 'A release cannot exceed the deposit held.');
    const event = salesRepository.insertEvent({
      id: asId<'RevenueEvent'>(`rev-${randomUUID()}`),
      projectId: contract.projectId,
      contractId: contract.id,
      unitId: contract.unitId,
      type: 'deposit-released',
      date: input.on,
      gross: input.amount,
      tax: money(0),
      restricted: false,
      basis: 'actual',
      note: `Permitted release · ${input.reason.trim()}`,
    });
    projectsService.bumpRevision(contract.projectId);
    accessService.record({
      actor: actorName(input.actor),
      summary: `Deposit released · ${salesService.requireUnit(contract.unitId).code}`,
      context: `${input.amount.cents / 100} · ${input.on} · ${input.reason.trim()}`,
    });
    return event;
  },

  /** Stored events: what actually happened. */
  /** Recorded events in date order; on one day a deposit moves before the settlement it is applied to. */
  actualRevenueEvents(projectId: ProjectId): readonly RevenueEvent[] {
    const rank: Record<RevenueEvent['type'], number> = { 'deposit-held': 0, 'deposit-released': 1, refund: 2, settlement: 3, 'other-income': 4 };
    return [...salesRepository.listEvents(projectId)].sort((a, b) => a.date.localeCompare(b.date) || rank[a.type] - rank[b.type]);
  },

  /**
   * Everything still expected, derived on read (YLD06, REV01). Nothing here is
   * stored, so moving a milestone or changing a price moves the forecast.
   */
  forecastRevenueEvents(projectId: ProjectId, resolveMilestoneDate: MilestoneDateResolver): readonly RevenueEvent[] {
    const settings = taxSettings(projectId);
    const events: RevenueEvent[] = [];

    for (const unit of salesService.listUnits(projectId)) {
      const contract = currentContract(unit.id);
      if (contract && (contract.state === 'settled' || contract.state === 'cancelled')) continue;

      if (contract) {
        const deposits = depositPosition(contract.id);
        // Scheduled deposits not yet covered by money received, oldest first.
        let covered = deposits.held;
        let forecastHeld = 0;
        contract.depositSchedule.forEach((entry, index) => {
          const fromReceived = Math.min(covered, entry.amount.cents);
          covered -= fromReceived;
          const outstanding = entry.amount.cents - fromReceived;
          if (outstanding <= 0) return;
          forecastHeld += outstanding;
          events.push({
            id: forecastId([contract.id, 'deposit', String(index)]),
            projectId,
            contractId: contract.id,
            unitId: unit.id,
            type: 'deposit-held',
            date: entry.dueOn,
            gross: money(outstanding),
            tax: money(0),
            restricted: true,
            basis: 'forecast',
            note: 'Scheduled deposit · to be held in trust',
          });
        });
        const toRelease = deposits.held + forecastHeld - deposits.released - deposits.refunded;
        if (toRelease > 0) {
          events.push({
            id: forecastId([contract.id, 'release']),
            projectId,
            contractId: contract.id,
            unitId: unit.id,
            type: 'deposit-released',
            date: contract.expectedSettlement,
            gross: money(toRelease),
            tax: money(0),
            restricted: false,
            basis: 'forecast',
            note: 'Deposit applied to the price at settlement',
          });
        }
        const grossConsideration = contract.consideration.cents + contract.adjustments.cents;
        const outputGst = taxFromGross(grossConsideration, contract.taxTreatment, settings);
        const receipt = settlementReceipt({
          grossConsiderationCents: grossConsideration,
          outputGstCents: outputGst,
          withholdingCents: contract.withholding.cents,
          appliedDepositsCents: deposits.held + forecastHeld - deposits.refunded,
        });
        events.push({
          id: forecastId([contract.id, 'settlement']),
          projectId,
          contractId: contract.id,
          unitId: unit.id,
          type: 'settlement',
          date: contract.expectedSettlement,
          gross: money(receipt.cashToSellerCents),
          tax: money(outputGst),
          restricted: false,
          basis: 'forecast',
          withholding: contract.withholding,
          note: 'Contracted settlement',
        });
        continue;
      }

      const date =
        unit.forecastSettlementDate ??
        (unit.forecastSettlementMilestoneId ? resolveMilestoneDate(unit.forecastSettlementMilestoneId) : undefined);
      if (!date) throw new NotFoundError('Settlement timing', unit.code);
      const outputGst = taxFromGross(unit.forecastPrice.cents, unit.taxTreatment, settings);
      // Reviewed default: an uncontracted standard-GST sale forecasts withholding equal to its GST.
      const withholding = unit.taxTreatment === 'standard-gst' ? outputGst : 0;
      const receipt = settlementReceipt({ grossConsiderationCents: unit.forecastPrice.cents, outputGstCents: outputGst, withholdingCents: withholding });
      events.push({
        id: forecastId([unit.id, 'settlement']),
        projectId,
        unitId: unit.id,
        type: 'settlement',
        date,
        gross: money(receipt.cashToSellerCents),
        tax: money(outputGst),
        restricted: false,
        basis: 'forecast',
        withholding: money(withholding),
        note: unit.forecastSettlementDate ? 'Uncontracted · fixed date' : 'Uncontracted · milestone-linked',
      });
    }

    for (const line of salesRepository.listOtherIncome(projectId)) {
      for (const dated of otherIncomeSchedule(line)) {
        events.push({
          id: forecastId([line.id, dated.date]),
          projectId,
          otherIncomeId: line.id,
          type: 'other-income',
          date: dated.date,
          gross: dated.amount,
          tax: money(taxFromGross(dated.amount.cents, line.taxTreatment, settings)),
          restricted: false,
          basis: 'forecast',
          note: line.description,
        });
      }
    }
    return events.sort((a, b) => a.date.localeCompare(b.date));
  },

  /** YLD05 — exactly one obligation per contract, derived from the rule; a recalculation cannot duplicate it. */
  commissionObligations(projectId: ProjectId): readonly CommissionObligation[] {
    const rule = salesRepository.findRule(projectId);
    if (!rule) return [];
    const obligations: CommissionObligation[] = [];
    for (const contract of salesRepository.listContracts(projectId)) {
      const trigger = triggerOf(contract, rule.trigger);
      if (contract.state === 'cancelled' && (rule.cancellationTreatment === 'reverse' || trigger.basis === 'forecast')) continue;
      const amount = rule.basis === 'rate' ? money(applyPpm(contract.consideration.cents, rule.ratePpm ?? 0)) : (rule.amount ?? money(0));
      obligations.push({
        contractId: contract.id,
        unitCode: salesRepository.findUnit(contract.unitId)?.code ?? contract.unitId,
        amount,
        triggerDate: trigger.date,
        basis: trigger.basis,
        costLineCode: rule.costLineCode,
      });
    }
    return obligations;
  },

  /** YLD06 — unit counts, areas, revenue and progress; the total reconciles to the revenue events. */
  yieldSummary(projectId: ProjectId, resolveMilestoneDate: MilestoneDateResolver): YieldSummary {
    const units = salesService.listUnits(projectId);
    const byStatus = Object.fromEntries(SALES_STATUSES.map((status) => [status, 0])) as Record<SalesStatus, number>;
    let contracted = 0;
    let contractedCount = 0;
    let uncontracted = 0;
    for (const unit of units) {
      const status = salesService.salesStatusOf(unit.id);
      byStatus[status] += 1;
      if (status === 'available') uncontracted += unit.forecastPrice.cents;
      else if (status !== 'cancelled') {
        contracted += (currentContract(unit.id) as SaleContract).consideration.cents;
        contractedCount += 1;
      }
    }
    const actual = salesService.actualRevenueEvents(projectId);
    const held = actual.filter((row) => row.type === 'deposit-held').reduce((acc, row) => acc + row.gross.cents, 0);
    const released = actual.filter((row) => row.type === 'deposit-released').reduce((acc, row) => acc + row.gross.cents, 0);
    const refunded = actual.filter((row) => row.type === 'refund').reduce((acc, row) => acc + row.gross.cents, 0);

    const cancelled = new Set(salesRepository.listContracts(projectId).filter((row) => row.state === 'cancelled').map((row) => row.id));
    const all = [...actual, ...salesService.forecastRevenueEvents(projectId, resolveMilestoneDate)].filter(
      (row) => row.unitId && !(row.contractId && cancelled.has(row.contractId)),
    );
    const totalGross = all.reduce((acc, row) => {
      if (row.type === 'settlement') return acc + row.gross.cents + (row.withholding?.cents ?? 0);
      if (row.type === 'deposit-released') return acc + row.gross.cents;
      return acc;
    }, 0);

    return {
      unitCount: units.length,
      byStatus,
      saleableAreaSqm: units.reduce((acc, unit) => acc + saleableAreaOf(unit), 0),
      contractedRevenue: money(contracted),
      uncontractedForecastRevenue: money(uncontracted),
      averageSalePrice: contractedCount > 0 ? available(money(Math.round(contracted / contractedCount))) : unavailable('no units are contracted yet'),
      salesProgressRatio: units.length > 0 ? available(contractedCount / units.length) : unavailable('the unit register is empty'),
      heldDeposits: money(held - released - refunded),
      releasedDeposits: money(released),
      totalGrossRevenue: money(totalGross),
    };
  },

  listOtherIncome(projectId: ProjectId): readonly OtherIncome[] {
    return salesRepository.listOtherIncome(projectId);
  },

  /** REV01 — dated other income with explicit tax treatment; recurring lines expand to the 15th (CAL04). */
  createOtherIncome(input: OtherIncomeInput): OtherIncome {
    projectsService.assertMutable(input.projectId);
    const group = salesRepository.findGroup(input.groupId);
    if (!group || group.projectId !== input.projectId) fail('Choose a revenue group in this project.', 'groupId', 'Select a group.');
    if (!input.description.trim()) fail('Describe the income.', 'description', 'e.g. Temporary sign licence.');
    if (!TAX_TREATMENTS.includes(input.taxTreatment)) fail('Choose a tax treatment.', 'taxTreatment', 'Select a treatment.');
    if (input.mode === 'one-off') {
      if (!input.date) fail('Enter the date of the income.', 'date', 'A one-off line needs a date.');
      assertDate(input.date, 'the date', 'date');
      if (!input.amount || input.amount.cents <= 0) fail('Enter an amount greater than zero.', 'amount', 'Enter the gross amount.');
    } else {
      if (!input.startDate || !input.endDate) fail('A recurring line needs a start and an end.', 'startDate', 'Enter both dates.');
      assertDate(input.startDate, 'the start', 'startDate');
      assertDate(input.endDate, 'the end', 'endDate');
      if (input.endDate < input.startDate) fail('The end must be on or after the start.', 'endDate', 'Choose a later end.');
      if (!input.monthlyAmount || input.monthlyAmount.cents <= 0) fail('Enter a monthly amount greater than zero.', 'monthlyAmount', 'Enter the gross monthly amount.');
    }
    const created = salesRepository.insertOtherIncome({
      id: asId<'OtherIncome'>(`oi-${randomUUID()}`),
      projectId: input.projectId,
      groupId: input.groupId,
      description: input.description.trim(),
      taxTreatment: input.taxTreatment,
      mode: input.mode,
      ...(input.mode === 'one-off'
        ? { date: input.date, amount: input.amount }
        : { startDate: input.startDate, endDate: input.endDate, monthlyAmount: input.monthlyAmount }),
    });
    projectsService.bumpRevision(input.projectId);
    accessService.record({
      actor: actorName(input.actor),
      summary: `Other income added · ${created.description}`,
      context: `${projectsService.require(input.projectId).code} · ${created.mode} · ${created.taxTreatment}`,
    });
    return created;
  },

  commissionRule(projectId: ProjectId): CommissionRule | null {
    return salesRepository.findRule(projectId) ?? null;
  },

  setCommissionRule(projectId: ProjectId, input: CommissionRuleInput, actor: UserId): CommissionRule {
    projectsService.assertMutable(projectId);
    if (input.basis === 'rate' && (input.ratePpm === undefined || input.ratePpm < 0)) fail('Enter the commission rate.', 'rate', 'e.g. 2.');
    if (input.basis === 'amount' && (!input.amount || input.amount.cents < 0)) fail('Enter the commission amount.', 'amount', 'Enter zero or more.');
    const fields: Omit<CommissionRule, 'id' | 'projectId'> = {
      basis: input.basis,
      ...(input.basis === 'rate' ? { ratePpm: input.ratePpm } : { amount: input.amount }),
      trigger: input.trigger,
      cancellationTreatment: input.cancellationTreatment,
      costLineCode: 'COMM-01',
    };
    const existing = salesRepository.findRule(projectId);
    const saved = existing
      ? salesRepository.updateRule(existing.id, { ...fields, ratePpm: fields.ratePpm, amount: fields.amount })
      : salesRepository.insertRule({ id: `cr-${randomUUID()}`, projectId, ...fields });
    if (!saved) throw new NotFoundError('Commission rule', projectId);
    projectsService.bumpRevision(projectId);
    accessService.record({
      actor: actorName(actor),
      summary: 'Commission rule saved',
      context: `${projectsService.require(projectId).code} · ${input.basis} · trigger ${input.trigger} · on cancellation ${input.cancellationTreatment}`,
    });
    return saved;
  },

  /**
   * PRJ04 — copy groups, units and the commission rule. Never contracts or
   * events: those belong to the source. `assumptions` keeps prices and fixed
   * dates; structure-only zeroes prices. Milestone links map by code.
   */
  cloneInto(sourceProjectId: ProjectId, targetProjectId: ProjectId, options: { readonly structure: boolean; readonly assumptions: boolean }, actor: UserId): readonly Unit[] {
    if (!options.structure) return [];
    const source = projectsService.require(sourceProjectId);
    const target = projectsService.assertMutable(targetProjectId);
    if (salesRepository.listUnits(targetProjectId).length > 0 || salesRepository.listGroups(targetProjectId).length > 0) {
      throw new ConflictError(`${target.code} already has a unit register; clear it before cloning into it.`);
    }
    const sourceMilestones = new Map(programmeService.listMilestones(sourceProjectId).map((row) => [row.id, row.code] as const));
    const targetByCode = new Map(programmeService.listMilestones(targetProjectId).map((row) => [row.code, row.id] as const));
    const groupMap = new Map<string, string>();
    for (const group of salesRepository.listGroups(sourceProjectId)) {
      const id = `rg-${randomUUID()}`;
      groupMap.set(group.id, id);
      salesRepository.insertGroup({ ...group, id, projectId: targetProjectId });
    }
    const at = now();
    const created = salesRepository.listUnits(sourceProjectId).map((unit) => {
      const milestoneCode = unit.forecastSettlementMilestoneId ? sourceMilestones.get(unit.forecastSettlementMilestoneId) : undefined;
      const mapped = milestoneCode ? targetByCode.get(milestoneCode) : undefined;
      const { forecastSettlementMilestoneId: _m, forecastSettlementDate: _d, pricePerSqm: _p, ...rest } = unit;
      void _m;
      void _d;
      void _p;
      return salesRepository.insertUnit({
        ...rest,
        id: asId<'Unit'>(`unit-${randomUUID()}`),
        projectId: targetProjectId,
        groupId: groupMap.get(unit.groupId) ?? unit.groupId,
        askingPrice: options.assumptions ? unit.askingPrice : money(0),
        forecastPrice: options.assumptions ? unit.forecastPrice : money(0),
        ...(options.assumptions && unit.pricePerSqm ? { pricePerSqm: unit.pricePerSqm } : {}),
        ...(mapped ? { forecastSettlementMilestoneId: mapped } : {}),
        ...(options.assumptions && unit.forecastSettlementDate ? { forecastSettlementDate: unit.forecastSettlementDate } : {}),
        history: [historyEntry(actor, 'cloned', source.code, unit.code)],
        createdAt: at,
      });
    });
    const rule = salesRepository.findRule(sourceProjectId);
    if (rule) salesRepository.insertRule({ ...rule, id: `cr-${randomUUID()}`, projectId: targetProjectId });
    projectsService.bumpRevision(targetProjectId);
    accessService.record({
      actor: actorName(actor),
      summary: `Unit register cloned · ${source.code} → ${target.code}`,
      context: `${created.length} units · ${options.assumptions ? 'prices kept' : 'structure only'} · contracts and receipts not copied`,
    });
    return created;
  },
};

/** When a commission falls due under the rule, and whether that has happened yet. */
function triggerOf(contract: SaleContract, trigger: CommissionTrigger): { readonly date: IsoDate; readonly basis: 'actual' | 'forecast' } {
  switch (trigger) {
    case 'exchange':
      return contract.exchangedOn ? { date: contract.exchangedOn, basis: 'actual' } : { date: contract.contractDate, basis: 'forecast' };
    case 'unconditional':
      return contract.unconditionalOn ? { date: contract.unconditionalOn, basis: 'actual' } : { date: contract.expectedSettlement, basis: 'forecast' };
    case 'settlement':
      return contract.actualSettlement ? { date: contract.actualSettlement, basis: 'actual' } : { date: contract.expectedSettlement, basis: 'forecast' };
  }
}

/** One-off on its date; recurring on the 15th of each month from start to end inclusive (CAL04). */
export function otherIncomeSchedule(line: OtherIncome): readonly { readonly date: IsoDate; readonly amount: Money }[] {
  if (line.mode === 'one-off') return line.date && line.amount ? [{ date: line.date, amount: line.amount }] : [];
  if (!line.startDate || !line.endDate || !line.monthlyAmount) return [];
  const monthly = line.monthlyAmount;
  return monthKeysBetween(monthKeyOf(line.startDate), monthKeyOf(line.endDate))
    .map((key) => dateInMonth(key))
    .filter((date) => date >= (line.startDate as IsoDate) && date <= (line.endDate as IsoDate))
    .map((date) => ({ date, amount: monthly }));
}
