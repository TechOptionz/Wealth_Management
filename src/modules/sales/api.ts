/**
 * Transport-agnostic handlers for the sales module.
 *
 * Every handler opens with the platform capability guard and the per-project
 * guard (NFR-01, IAM02). Reads need `financials.read` — an investor, who holds
 * `participation.read` only, is refused units and contracts outright.
 * Purchaser references are additionally hidden from anyone without
 * `sales.edit` (YLD03). Writes need `sales.edit`.
 */
import { accessService } from '@/modules/access/service';
import { projectsService } from '@/modules/projects/service';
import { programmeService } from '@/modules/programme/service';
import type { TaxTreatment } from '@/shared/finance-engine';
import { money, type Money } from '@/shared/lib/money';
import { asId, type IsoDate, type ProjectId, type UserId } from '@/shared/types/common';
import { NotFoundError, ValidationError } from '@/shared/lib/errors';
import type { ProjectScope } from '@/modules/projects/model';
import { otherIncomeSchedule, salesService, type CommissionObligation, type UnitInput, type YieldSummary } from './service';
import {
  saleableAreaOf,
  type CommissionRule,
  type ContractState,
  type OtherIncome,
  type PricingMode,
  type RevenueEvent,
  type RevenueGroup,
  type SaleContract,
  type SaleableAreaBasis,
  type SalesStatus,
  type Unit,
} from './model';
import type { CreateContractBody, ImportUnitsBody, UnitRowBody } from './validation';

/** A contract as a reader may see it: the purchaser reference only with `sales.edit`. */
export type ContractView = Omit<SaleContract, 'purchaserReference'> & { readonly purchaserReference: string | null };

export interface UnitRow {
  readonly unit: Unit;
  readonly groupName: string;
  readonly status: SalesStatus;
  readonly contractPrice: Money | null;
  readonly saleableAreaSqm: number;
  readonly contract: ContractView | null;
  /** Deposits on the current contract. */
  readonly depositsHeld: Money;
  readonly depositsReleased: Money;
  readonly depositsInTrust: Money;
}

export interface YieldOverview {
  readonly project: { readonly id: string; readonly code: string; readonly modelRevision: number; readonly expectedCompletion: IsoDate };
  readonly summary: YieldSummary;
  readonly groups: readonly RevenueGroup[];
  readonly units: readonly UnitRow[];
  readonly otherIncome: readonly OtherIncome[];
  readonly commissionRule: CommissionRule | null;
  readonly commissions: readonly CommissionObligation[];
  readonly milestones: readonly { readonly id: string; readonly label: string }[];
  readonly permissions: { readonly canEdit: boolean; readonly canSeePurchaser: boolean };
}

export interface RevenueGroupTotal {
  readonly group: RevenueGroup;
  readonly unitCount: number;
  readonly contracted: Money;
  readonly uncontractedForecast: Money;
  readonly otherIncome: Money;
  readonly actualReceived: Money;
}

export interface RevenueGroupDetail {
  readonly group: RevenueGroup;
  readonly units: readonly UnitRow[];
  readonly otherIncome: readonly OtherIncome[];
  readonly actualEvents: readonly RevenueEvent[];
  readonly forecastEvents: readonly RevenueEvent[];
  readonly canSeePurchaser: boolean;
}

function guardRead(rawProjectId: string): { readonly projectId: ProjectId; readonly scope: ProjectScope } {
  accessService.guard('development.read');
  const projectId = asId<'Project'>(rawProjectId);
  const scope = projectsService.guard(projectId, 'financials.read');
  return { projectId, scope };
}

function guardEdit(rawProjectId: string): { readonly projectId: ProjectId; readonly actor: UserId } {
  accessService.guard('development.read');
  const projectId = asId<'Project'>(rawProjectId);
  projectsService.guard(projectId, 'sales.edit');
  return { projectId, actor: accessService.getCurrentUser().id };
}

function canSeePurchaser(scope: ProjectScope): boolean {
  return scope.permissions.includes('sales.edit');
}

function viewOf(contract: SaleContract, showPurchaser: boolean): ContractView {
  return { ...contract, purchaserReference: showPurchaser ? contract.purchaserReference : null };
}

/** "845000.00" → cents. The route schema has already checked the shape; this keeps the arithmetic exact (CAL01). */
function decimalStringToCents(value: string): number {
  const match = /^(-)?(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) throw new ValidationError(`"${value}" is not a decimal amount such as 1860.00.`);
  const total = Number(match[2]) * 100 + Number((match[3] ?? '').padEnd(2, '0'));
  return match[1] ? -total : total;
}

function cents(value: string | undefined): Money | undefined {
  return value === undefined ? undefined : money(decimalStringToCents(value));
}

function unitRows(projectId: ProjectId, units: readonly Unit[], showPurchaser: boolean): readonly UnitRow[] {
  const groups = new Map(salesService.listGroups(projectId).map((group) => [group.id, group.name] as const));
  const events = salesService.actualRevenueEvents(projectId);
  return units.map((unit) => {
    const contract = salesService.currentContractOf(unit.id);
    const own = contract ? events.filter((row) => row.contractId === contract.id) : [];
    const total = (type: RevenueEvent['type']): number => own.filter((row) => row.type === type).reduce((acc, row) => acc + row.gross.cents, 0);
    return {
      unit,
      groupName: groups.get(unit.groupId) ?? unit.groupId,
      status: salesService.salesStatusOf(unit.id),
      contractPrice: salesService.contractPriceOf(unit.id),
      saleableAreaSqm: saleableAreaOf(unit),
      contract: contract ? viewOf(contract, showPurchaser) : null,
      depositsHeld: money(total('deposit-held')),
      depositsReleased: money(total('deposit-released')),
      depositsInTrust: money(total('deposit-held') - total('deposit-released') - total('refund')),
    };
  });
}

export function unitInputFromBody(row: UnitRowBody): UnitInput {
  return {
    groupId: row.groupId,
    code: row.code,
    ...(row.stage ? { stage: row.stage } : {}),
    productType: row.productType,
    ...(row.level ? { level: row.level } : {}),
    bedrooms: row.bedrooms,
    carSpaces: row.carSpaces,
    internalAreaSqm: row.internalAreaSqm,
    externalAreaSqm: row.externalAreaSqm,
    saleableAreaBasis: row.saleableAreaBasis as SaleableAreaBasis,
    pricingMode: row.pricingMode as PricingMode,
    ...(row.askingPrice ? { askingPrice: cents(row.askingPrice) } : {}),
    ...(row.forecastPrice ? { forecastPrice: cents(row.forecastPrice) } : {}),
    ...(row.pricePerSqm ? { pricePerSqm: cents(row.pricePerSqm) } : {}),
    taxTreatment: row.taxTreatment as TaxTreatment,
    ...(row.forecastSettlementMilestoneId ? { forecastSettlementMilestoneId: asId<'Milestone'>(row.forecastSettlementMilestoneId) } : {}),
    ...(row.forecastSettlementDate ? { forecastSettlementDate: row.forecastSettlementDate } : {}),
  };
}

export const salesApi = {
  /** YLD01–YLD06 — everything the Yield screen needs. */
  yieldOverview(rawProjectId: string): YieldOverview {
    const { projectId, scope } = guardRead(rawProjectId);
    const project = projectsService.require(projectId);
    const showPurchaser = canSeePurchaser(scope);
    return {
      project: { id: project.id, code: project.code, modelRevision: project.modelRevision, expectedCompletion: project.expectedCompletion },
      summary: salesService.yieldSummary(projectId, programmeService.dateResolver(projectId)),
      groups: salesService.listGroups(projectId),
      units: unitRows(projectId, salesService.listUnits(projectId), showPurchaser),
      otherIncome: salesService.listOtherIncome(projectId),
      commissionRule: salesService.commissionRule(projectId),
      commissions: salesService.commissionObligations(projectId),
      milestones: programmeService
        .listMilestones(projectId)
        .filter((row) => row.kind !== 'stage')
        .map((row) => ({ id: row.id, label: `${row.code} · ${row.name}` })),
      permissions: { canEdit: scope.permissions.includes('sales.edit'), canSeePurchaser: showPurchaser },
    };
  },

  listUnits(rawProjectId: string, groupId?: string): readonly UnitRow[] {
    const { projectId, scope } = guardRead(rawProjectId);
    return unitRows(projectId, salesService.listUnits(projectId, groupId ? { groupId } : {}), canSeePurchaser(scope));
  },

  listContracts(rawProjectId: string): readonly ContractView[] {
    const { projectId, scope } = guardRead(rawProjectId);
    const show = canSeePurchaser(scope);
    return salesService.listContracts(projectId).map((row) => viewOf(row, show));
  },

  /** Revenue register: each group with its totals. */
  revenueGroups(rawProjectId: string): readonly RevenueGroupTotal[] {
    const { projectId } = guardRead(rawProjectId);
    const units = salesService.listUnits(projectId);
    const actual = salesService.actualRevenueEvents(projectId);
    const unitGroup = new Map(units.map((unit) => [unit.id as string, unit.groupId] as const));
    const incomeGroup = new Map(salesService.listOtherIncome(projectId).map((row) => [row.id as string, row.groupId] as const));
    return salesService.listGroups(projectId).map((group) => {
      const own = units.filter((unit) => unit.groupId === group.id);
      let contracted = 0;
      let forecast = 0;
      for (const unit of own) {
        const status = salesService.salesStatusOf(unit.id);
        const price = salesService.contractPriceOf(unit.id);
        if (status === 'available') forecast += unit.forecastPrice.cents;
        else if (price) contracted += price.cents;
      }
      const other = salesService
        .listOtherIncome(projectId)
        .filter((row) => row.groupId === group.id)
        .flatMap((row) => otherIncomeSchedule(row))
        .reduce((acc, row) => acc + row.amount.cents, 0);
      const received = actual
        .filter((row) => (row.unitId && unitGroup.get(row.unitId) === group.id) || (row.otherIncomeId && incomeGroup.get(row.otherIncomeId) === group.id))
        .filter((row) => row.type !== 'refund')
        .reduce((acc, row) => acc + (row.type === 'deposit-released' ? 0 : row.gross.cents), 0);
      return {
        group,
        unitCount: own.length,
        contracted: money(contracted),
        uncontractedForecast: money(forecast),
        otherIncome: money(other),
        actualReceived: money(received),
      };
    });
  },

  revenueGroup(rawProjectId: string, groupId: string): RevenueGroupDetail {
    const { projectId, scope } = guardRead(rawProjectId);
    const group = salesService.requireGroup(groupId);
    if (group.projectId !== projectId) throw new NotFoundError('Revenue group', groupId);
    const units = salesService.listUnits(projectId, { groupId });
    const unitIds = new Set<string>(units.map((unit) => unit.id));
    const income = salesService.listOtherIncome(projectId).filter((row) => row.groupId === groupId);
    const incomeIds = new Set<string>(income.map((row) => row.id));
    const belongs = (row: RevenueEvent): boolean => Boolean((row.unitId && unitIds.has(row.unitId)) || (row.otherIncomeId && incomeIds.has(row.otherIncomeId)));
    return {
      group,
      units: unitRows(projectId, units, canSeePurchaser(scope)),
      otherIncome: income,
      actualEvents: salesService.actualRevenueEvents(projectId).filter(belongs),
      forecastEvents: salesService.forecastRevenueEvents(projectId, programmeService.dateResolver(projectId)).filter(belongs),
      canSeePurchaser: canSeePurchaser(scope),
    };
  },

  revenueGroupsForNav(rawProjectId: string): readonly { readonly id: string; readonly label: string }[] {
    const { projectId } = guardRead(rawProjectId);
    return salesService.revenueGroupsForNav(projectId);
  },

  createUnit(rawProjectId: string, input: UnitInput, expectedRevision?: number): Unit {
    const { projectId, actor } = guardEdit(rawProjectId);
    return salesService.createUnit(projectId, input, actor, expectedRevision);
  },

  updateUnit(rawUnitId: string, changes: Parameters<typeof salesService.updateUnit>[1], reason?: string): Unit {
    accessService.guard('development.read');
    const unit = salesService.requireUnit(asId<'Unit'>(rawUnitId));
    const { actor } = guardEdit(unit.projectId);
    return salesService.updateUnit(unit.id, changes, actor, reason);
  },

  importUnits(rawProjectId: string, body: ImportUnitsBody, expectedRevision?: number): readonly Unit[] {
    const { projectId, actor } = guardEdit(rawProjectId);
    return salesService.importUnits({ projectId, rows: body.rows.map(unitInputFromBody), actor, expectedRevision });
  },

  bulkPriceChange(rawProjectId: string, input: Omit<Parameters<typeof salesService.bulkPriceChange>[0], 'projectId' | 'actor'>) {
    const { projectId, actor } = guardEdit(rawProjectId);
    return salesService.bulkPriceChange({ ...input, projectId, actor });
  },

  /** v1 body (decimal strings) → the typed path. */
  createContract(rawUnitId: string, body: CreateContractBody, expectedRevision?: number): ContractView {
    return salesApi.recordContract(
      rawUnitId,
      {
        purchaserReference: body.purchaserReference,
        consideration: money(decimalStringToCents(body.consideration)),
        taxTreatment: body.taxTreatment as TaxTreatment,
        contractDate: body.contractDate,
        expectedSettlement: body.expectedSettlement,
        depositSchedule: body.depositSchedule.map((row) => ({ dueOn: row.dueOn, amount: money(decimalStringToCents(row.amount)) })),
        ...(body.adjustments ? { adjustments: cents(body.adjustments) } : {}),
        ...(body.withholding ? { withholding: cents(body.withholding) } : {}),
      },
      expectedRevision,
    );
  },

  recordContract(
    rawUnitId: string,
    input: Omit<Parameters<typeof salesService.createContract>[0], 'projectId' | 'unitId' | 'actor' | 'expectedRevision'>,
    expectedRevision?: number,
  ): ContractView {
    accessService.guard('development.read');
    const unit = salesService.requireUnit(asId<'Unit'>(rawUnitId));
    const { actor } = guardEdit(unit.projectId);
    const created = salesService.createContract({ ...input, projectId: unit.projectId, unitId: unit.id, actor, expectedRevision });
    return viewOf(created, true);
  },

  transitionContract(rawContractId: string, to: ContractState, on?: IsoDate, reason?: string, expectedRevision?: number): ContractView {
    accessService.guard('development.read');
    const contract = salesService.requireContract(asId<'SaleContract'>(rawContractId));
    const { actor } = guardEdit(contract.projectId);
    return viewOf(salesService.transitionContract({ contractId: contract.id, to, actor, on, reason, expectedRevision }), true);
  },

  varyContract(rawContractId: string, consideration: Money, reason: string): ContractView {
    accessService.guard('development.read');
    const contract = salesService.requireContract(asId<'SaleContract'>(rawContractId));
    const { actor } = guardEdit(contract.projectId);
    return viewOf(salesService.varyContract({ contractId: contract.id, consideration, reason, actor }), true);
  },

  recordDeposit(rawContractId: string, amount: Money, on: IsoDate): RevenueEvent {
    accessService.guard('development.read');
    const contract = salesService.requireContract(asId<'SaleContract'>(rawContractId));
    const { actor } = guardEdit(contract.projectId);
    return salesService.recordDeposit({ contractId: contract.id, amount, on, actor });
  },

  releaseDeposit(rawContractId: string, amount: Money, on: IsoDate, reason: string): RevenueEvent {
    accessService.guard('development.read');
    const contract = salesService.requireContract(asId<'SaleContract'>(rawContractId));
    const { actor } = guardEdit(contract.projectId);
    return salesService.releaseDeposit({ contractId: contract.id, amount, on, reason, actor });
  },

  createOtherIncome(rawProjectId: string, input: Omit<Parameters<typeof salesService.createOtherIncome>[0], 'projectId' | 'actor'>): OtherIncome {
    const { projectId, actor } = guardEdit(rawProjectId);
    return salesService.createOtherIncome({ ...input, projectId, actor });
  },

  setCommissionRule(rawProjectId: string, input: Parameters<typeof salesService.setCommissionRule>[1]): CommissionRule {
    const { projectId, actor } = guardEdit(rawProjectId);
    return salesService.setCommissionRule(projectId, input, actor);
  },
};

