/**
 * Transport-agnostic handlers for the budgets module.
 *
 * Every handler opens with the platform capability guard and then the
 * per-project guard, so pages, JSON routes and exports pass through the same
 * two doors (NFR-01, IAM02). Reads need `financials.read`; budget writes need
 * `budget.edit`; publishing a baseline needs `baseline.publish`.
 */
import { accessService } from '@/modules/access/service';
import { projectsService } from '@/modules/projects/service';
import { ValidationError } from '@/shared/lib/errors';
import { money, type Money } from '@/shared/lib/money';
import { asId, type CostCategoryId, type ProjectId } from '@/shared/types/common';
import type { TaxTreatment } from '@/shared/finance-engine';
import { budgetsService } from './service';
import type {
  BudgetAdjustment,
  BudgetVersion,
  CostCategory,
  CostLine,
  ForecastBatch,
  ForecastEdit,
  ForecastMethod,
  InputMode,
  RowType,
  TimingMode,
} from './model';
import {
  decimalToCents,
  wireToSchedule,
  type CostLineListQuery,
  type CreateBaselineBody,
  type CreateCostLineBody,
  type ForecastBatchBody,
  type PublishBaselineBody,
} from './validation';

export interface CostLineView {
  readonly line: CostLine;
  /** Ex GST, derived. */
  readonly currentBudget: Money;
  /** Ex GST, from the selected baseline; null when none covers the line. */
  readonly baseline: Money | null;
}

function toMoney(value: string | undefined): Money | undefined {
  return value === undefined ? undefined : money(decimalToCents(value));
}

function guardRead(rawProjectId: string): ProjectId {
  accessService.guard('development.read');
  const projectId = asId<'Project'>(rawProjectId);
  projectsService.guard(projectId, 'financials.read');
  return projectId;
}

function guardEdit(rawProjectId: string): ProjectId {
  accessService.guard('development.read');
  const projectId = asId<'Project'>(rawProjectId);
  projectsService.guard(projectId, 'budget.edit');
  return projectId;
}

function viewOf(line: CostLine): CostLineView {
  return {
    line,
    currentBudget: budgetsService.currentBudget(line.id),
    baseline: budgetsService.baselineAmount(line.id),
  };
}

export function editFromBody(edit: ForecastBatchBody['edits'][number]): ForecastEdit {
  const schedule = wireToSchedule(edit.schedule);
  return {
    costLineId: asId<'CostLine'>(edit.costLineId),
    ...(edit.budget !== undefined ? { budget: money(decimalToCents(edit.budget)) } : {}),
    ...(edit.reason !== undefined ? { reason: edit.reason } : {}),
    ...(edit.forecastMethod !== undefined ? { forecastMethod: edit.forecastMethod as ForecastMethod } : {}),
    ...(schedule ? { schedule } : {}),
    ...(edit.milestoneId !== undefined ? { milestoneId: asId<'Milestone'>(edit.milestoneId) } : {}),
    ...(edit.timingMode !== undefined ? { timingMode: edit.timingMode as TimingMode } : {}),
  };
}

export const budgetsApi = {
  listCategories(rawProjectId: string): readonly CostCategory[] {
    const projectId = guardRead(rawProjectId);
    return budgetsService.listCategories(projectId);
  },

  listCostLines(rawProjectId: string, query: Partial<CostLineListQuery> = {}): { readonly items: readonly CostLineView[] } {
    const projectId = guardRead(rawProjectId);
    const items = budgetsService
      .listCostLines(projectId, {
        ...(query.categoryId ? { categoryId: asId<'CostCategory'>(query.categoryId) } : {}),
        includeInactive: query.includeInactive !== 'false',
      })
      .map(viewOf);
    return { items };
  },

  get(rawCostLineId: string): CostLineView {
    accessService.guard('development.read');
    const line = budgetsService.requireCostLine(asId<'CostLine'>(rawCostLineId));
    projectsService.guard(line.projectId, 'financials.read');
    return viewOf(line);
  },

  createCostLine(rawProjectId: string, body: CreateCostLineBody, expectedRevision?: number): CostLine {
    const projectId = guardEdit(rawProjectId);
    const actor = accessService.getCurrentUser();
    return budgetsService.createCostLine({
      projectId,
      categoryId: asId<'CostCategory'>(body.categoryId) as CostCategoryId,
      code: body.code,
      title: body.title,
      ...(body.description !== undefined ? { description: body.description } : {}),
      rowType: body.rowType as RowType,
      ...(body.parentLineId ? { parentLineId: asId<'CostLine'>(body.parentLineId) } : {}),
      inputMode: body.inputMode as InputMode,
      ...(body.quantity !== undefined ? { quantity: body.quantity } : {}),
      ...(body.unit !== undefined ? { unit: body.unit } : {}),
      ...(body.rate !== undefined ? { rate: toMoney(body.rate) } : {}),
      ...(body.originalBudget !== undefined ? { originalBudget: toMoney(body.originalBudget) } : {}),
      taxTreatment: body.taxTreatment as TaxTreatment,
      recoverablePpm: body.recoverablePpm,
      forecastMethod: body.forecastMethod as ForecastMethod,
      schedule: wireToSchedule(body.schedule) ?? {},
      ...(body.timingMode ? { timingMode: body.timingMode as TimingMode } : {}),
      ...(body.milestoneId ? { milestoneId: asId<'Milestone'>(body.milestoneId) } : {}),
      ...(body.responsibleUserId ? { responsibleUserId: asId<'User'>(body.responsibleUserId) } : {}),
      isContingency: body.isContingency,
      actor: actor.id,
      ...(expectedRevision !== undefined ? { expectedRevision } : {}),
    });
  },

  /** CF07 — If-Match (or `expectedRevision` in the body) carries the revision edited against. */
  forecastBatch(rawProjectId: string, body: ForecastBatchBody, ifMatch?: number): ForecastBatch {
    const projectId = guardEdit(rawProjectId);
    const expectedRevision = ifMatch ?? body.expectedRevision;
    if (expectedRevision === undefined) {
      throw new ValidationError('A forecast batch needs the model revision you edited against (If-Match header or expectedRevision).');
    }
    return budgetsService.applyForecastBatch({
      projectId,
      actor: accessService.getCurrentUser().id,
      expectedRevision,
      edits: body.edits.map(editFromBody),
    });
  },

  createBaseline(rawProjectId: string, body: CreateBaselineBody): BudgetVersion {
    const projectId = guardEdit(rawProjectId);
    return budgetsService.createBaselineCandidate({ projectId, name: body.name, actor: accessService.getCurrentUser().id });
  },

  publishBaseline(rawBaselineId: string, body: PublishBaselineBody): BudgetVersion {
    accessService.guard('development.read');
    const baselineId = asId<'BudgetVersion'>(rawBaselineId);
    const version = budgetsService.requireBaseline(baselineId);
    projectsService.guard(version.projectId, 'baseline.publish');
    return budgetsService.publishBaseline({ baselineId, actor: accessService.getCurrentUser().id, reason: body.reason });
  },

  adjustments(rawProjectId: string): readonly BudgetAdjustment[] {
    const projectId = guardRead(rawProjectId);
    return budgetsService.listAdjustments(projectId);
  },

  baselines(rawProjectId: string): readonly BudgetVersion[] {
    const projectId = guardRead(rawProjectId);
    return budgetsService.listBaselines(projectId);
  },

  batches(rawProjectId: string): readonly ForecastBatch[] {
    const projectId = guardRead(rawProjectId);
    return budgetsService.listBatches(projectId);
  },
};
