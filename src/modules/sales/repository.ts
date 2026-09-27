/**
 * Sales data access — the only file in this module that touches storage.
 */
import { createCollection } from '@/server/db/collection';
import type { OtherIncomeId, ProjectId, RevenueEventId, SaleContractId, UnitId } from '@/shared/types/common';
import type { CommissionRule, OtherIncome, RevenueEvent, RevenueGroup, SaleContract, Unit } from './model';
import {
  seedCommissionRules,
  seedOtherIncome,
  seedRevenueEvents,
  seedRevenueGroups,
  seedSaleContracts,
  seedUnits,
} from './data/seed';

const groups = createCollection<RevenueGroup>('sales.groups', seedRevenueGroups);
const units = createCollection<Unit>('sales.units', seedUnits);
const contracts = createCollection<SaleContract>('sales.contracts', seedSaleContracts);
const events = createCollection<RevenueEvent>('sales.revenue-events', seedRevenueEvents);
const otherIncome = createCollection<OtherIncome>('sales.other-income', seedOtherIncome);
const rules = createCollection<CommissionRule>('sales.commission-rules', seedCommissionRules);

export const salesRepository = {
  listGroups: (projectId: ProjectId): readonly RevenueGroup[] =>
    [...groups.where((row) => row.projectId === projectId)].sort((a, b) => a.sortOrder - b.sortOrder),
  findGroup: (id: string): RevenueGroup | undefined => groups.find(id),
  findGroupByCode: (projectId: ProjectId, code: string): RevenueGroup | undefined =>
    groups.findBy((row) => row.projectId === projectId && row.code.toLowerCase() === code.toLowerCase()),
  insertGroup: (row: RevenueGroup): RevenueGroup => groups.insert(row),

  listUnits: (projectId: ProjectId): readonly Unit[] => units.where((row) => row.projectId === projectId),
  findUnit: (id: UnitId): Unit | undefined => units.find(id),
  findUnitByCode: (projectId: ProjectId, code: string): Unit | undefined =>
    units.findBy((row) => row.projectId === projectId && row.code.toLowerCase() === code.toLowerCase()),
  insertUnit: (row: Unit): Unit => units.insert(row),
  updateUnit: (id: UnitId, changes: Partial<Omit<Unit, 'id'>>): Unit | undefined => units.update(id, changes),

  listContracts: (projectId: ProjectId): readonly SaleContract[] => contracts.where((row) => row.projectId === projectId),
  listContractsForUnit: (unitId: UnitId): readonly SaleContract[] =>
    [...contracts.where((row) => row.unitId === unitId)].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
  findContract: (id: SaleContractId): SaleContract | undefined => contracts.find(id),
  insertContract: (row: SaleContract): SaleContract => contracts.insert(row),
  updateContract: (id: SaleContractId, changes: Partial<Omit<SaleContract, 'id'>>): SaleContract | undefined =>
    contracts.update(id, changes),

  /** Stored (actual) revenue events, oldest first. */
  listEvents: (projectId: ProjectId): readonly RevenueEvent[] =>
    [...events.where((row) => row.projectId === projectId)].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id)),
  listEventsForContract: (contractId: SaleContractId): readonly RevenueEvent[] => events.where((row) => row.contractId === contractId),
  findEvent: (id: RevenueEventId): RevenueEvent | undefined => events.find(id),
  insertEvent: (row: RevenueEvent): RevenueEvent => events.insert(row),

  listOtherIncome: (projectId: ProjectId): readonly OtherIncome[] => otherIncome.where((row) => row.projectId === projectId),
  findOtherIncome: (id: OtherIncomeId): OtherIncome | undefined => otherIncome.find(id),
  insertOtherIncome: (row: OtherIncome): OtherIncome => otherIncome.insert(row),

  findRule: (projectId: ProjectId): CommissionRule | undefined => rules.findBy((row) => row.projectId === projectId),
  insertRule: (row: CommissionRule): CommissionRule => rules.insert(row),
  updateRule: (id: string, changes: Partial<Omit<CommissionRule, 'id'>>): CommissionRule | undefined => rules.update(id, changes),

  /** Test isolation. */
  reset: (): void => {
    groups.reset();
    units.reset();
    contracts.reset();
    events.reset();
    otherIncome.reset();
    rules.reset();
  },
};
