/**
 * Budgets data access — the only file in this module that touches storage.
 *
 * Every record carries `projectId`; every list here is scoped by it so a
 * service can never see another project's lines by accident (IAM02).
 */
import { createCollection } from '@/server/db/collection';
import type { BudgetVersionId, CostCategoryId, CostLineId, ForecastBatchId, ProjectId } from '@/shared/types/common';
import type { BudgetAdjustment, BudgetVersion, CostCategory, CostLine, ForecastBatch } from './model';
import {
  seedBudgetAdjustments,
  seedBudgetVersions,
  seedCostCategories,
  seedCostLines,
  seedForecastBatches,
} from './data/seed';

const categories = createCollection<CostCategory>('budgets.categories', seedCostCategories);
const costLines = createCollection<CostLine>('budgets.cost-lines', seedCostLines);
const adjustments = createCollection<BudgetAdjustment>('budgets.adjustments', seedBudgetAdjustments);
const versions = createCollection<BudgetVersion>('budgets.versions', seedBudgetVersions);
const batches = createCollection<ForecastBatch>('budgets.batches', seedForecastBatches);

function byTime<T extends { readonly at: string; readonly id: string }>(a: T, b: T): number {
  return a.at.localeCompare(b.at) || a.id.localeCompare(b.id);
}

export const budgetsRepository = {
  /** Categories of a project in display order. */
  listCategories: (projectId: ProjectId): readonly CostCategory[] =>
    [...categories.where((category) => category.projectId === projectId)].sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code)),
  findCategory: (id: CostCategoryId): CostCategory | undefined => categories.find(id),
  findCategoryByCode: (projectId: ProjectId, code: string): CostCategory | undefined =>
    categories.findBy((category) => category.projectId === projectId && category.code.toLowerCase() === code.toLowerCase()),
  insertCategory: (category: CostCategory): CostCategory => categories.insert(category),
  updateCategory: (id: CostCategoryId, changes: Partial<Omit<CostCategory, 'id'>>): CostCategory | undefined =>
    categories.update(id, changes),

  /** Cost lines of a project, in category order then line order. */
  listCostLines: (projectId: ProjectId): readonly CostLine[] => {
    const order = new Map(budgetsRepository.listCategories(projectId).map((category, index) => [category.id, index]));
    return [...costLines.where((line) => line.projectId === projectId)].sort(
      (a, b) =>
        (order.get(a.categoryId) ?? Number.MAX_SAFE_INTEGER) - (order.get(b.categoryId) ?? Number.MAX_SAFE_INTEGER) ||
        a.sortOrder - b.sortOrder ||
        a.code.localeCompare(b.code),
    );
  },
  findCostLine: (id: CostLineId): CostLine | undefined => costLines.find(id),
  findCostLineByCode: (projectId: ProjectId, code: string): CostLine | undefined =>
    costLines.findBy((line) => line.projectId === projectId && line.code.toLowerCase() === code.toLowerCase()),
  insertCostLine: (line: CostLine): CostLine => costLines.insert(line),
  updateCostLine: (id: CostLineId, changes: Partial<Omit<CostLine, 'id'>>): CostLine | undefined => costLines.update(id, changes),

  /** Adjustments of a project, oldest first. */
  listAdjustments: (projectId: ProjectId): readonly BudgetAdjustment[] =>
    [...adjustments.where((adjustment) => adjustment.projectId === projectId)].sort(byTime),
  insertAdjustment: (adjustment: BudgetAdjustment): BudgetAdjustment => adjustments.insert(adjustment),

  /** Budget versions of a project, oldest first. */
  listVersions: (projectId: ProjectId): readonly BudgetVersion[] =>
    [...versions.where((version) => version.projectId === projectId)].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)),
  findVersion: (id: BudgetVersionId): BudgetVersion | undefined => versions.find(id),
  insertVersion: (version: BudgetVersion): BudgetVersion => versions.insert(version),
  updateVersion: (id: BudgetVersionId, changes: Partial<Omit<BudgetVersion, 'id'>>): BudgetVersion | undefined =>
    versions.update(id, changes),

  /** Forecast batches of a project, oldest first. */
  listBatches: (projectId: ProjectId): readonly ForecastBatch[] =>
    [...batches.where((batch) => batch.projectId === projectId)].sort(byTime),
  findBatch: (id: ForecastBatchId): ForecastBatch | undefined => batches.find(id),
  insertBatch: (batch: ForecastBatch): ForecastBatch => batches.insert(batch),
  updateBatch: (id: ForecastBatchId, changes: Partial<Omit<ForecastBatch, 'id'>>): ForecastBatch | undefined =>
    batches.update(id, changes),

  /** Test isolation. */
  reset: (): void => {
    categories.reset();
    costLines.reset();
    adjustments.reset();
    versions.reset();
    batches.reset();
  },
};
