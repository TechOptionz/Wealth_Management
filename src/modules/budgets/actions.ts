'use server';

/**
 * Budgets Server Actions (CST01, CST02, CST08, CF07, CF09, PRJ05).
 *
 * Each parses FormData, guards, calls the service and revalidates. Nothing is
 * thrown across the boundary: `runAction` turns failures into an
 * `ActionResult` whose `fieldErrors` mark the offending input. Amounts are
 * read with `readAmount`, so "$1,860.00" works; every amount is ex GST.
 */
import { revalidatePath } from 'next/cache';
import { asId, type CostCategoryId, type CostLineId, type ProjectId } from '@/shared/types/common';
import { money, type Money } from '@/shared/lib/money';
import { percentToPpm, TAX_TREATMENTS } from '@/shared/finance-engine';
import type { ActionResult } from '@/shared/lib/action-result';
import { runAction } from '@/server/actions/run-action';
import { readAmount, readBoolean, readChoice, readString, requireString } from '@/shared/lib/form-data';
import { ValidationError } from '@/shared/lib/errors';
import { accessService } from '@/modules/access/service';
import { projectsService } from '@/modules/projects/service';
import { budgetsService, type CostLineChanges } from './service';
import {
  ADJUSTMENT_KINDS,
  FORECAST_METHODS,
  INPUT_MODES,
  ROW_TYPES,
  TIMING_MODES,
  type ForecastEdit,
  type ForecastMethod,
  type ForecastSchedule,
} from './model';
import {
  forecastBatchSchema,
  formManualSchema,
  formManualToSchedule,
  formWeightsSchema,
  formWeightsToSchedule,
  parseJsonField,
} from './validation';
import { editFromBody } from './api';

function revalidateCosts(projectId: string): void {
  revalidatePath(`/projects/${projectId}`, 'layout');
}

function readRevision(form: FormData): number | undefined {
  const raw = readString(form, 'revision');
  if (raw === undefined) return undefined;
  const parsed = Number(raw);
  return Number.isInteger(parsed) ? parsed : undefined;
}

/** A money input in dollars → integer cents, never floating dollars stored. */
function readMoney(form: FormData, key: string): Money | undefined {
  const amount = readAmount(form, key);
  if (amount === undefined) return undefined;
  return money(Math.round(amount * 100));
}

function readInteger(form: FormData, key: string, label: string): number | undefined {
  const raw = readString(form, key);
  if (raw === undefined) return undefined;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed)) throw new ValidationError(`${label} must be a whole number.`, { fieldErrors: { [key]: ['Enter a whole number.'] } });
  return parsed;
}

function readNumber(form: FormData, key: string, label: string): number | undefined {
  const raw = readString(form, key);
  if (raw === undefined) return undefined;
  const parsed = Number(raw.replace(/,/g, ''));
  if (!Number.isFinite(parsed)) throw new ValidationError(`${label} is not a number.`, { fieldErrors: { [key]: ['Enter a number.'] } });
  return parsed;
}

function readPpm(form: FormData, key: string): number | undefined {
  const raw = readString(form, key);
  if (raw === undefined) return undefined;
  try {
    return percentToPpm(raw);
  } catch (error) {
    throw new ValidationError((error as Error).message, { fieldErrors: { [key]: ['Enter a percentage such as 100 or 50.5.'] } });
  }
}

/** The schedule editor: method-specific inputs, with weights and manual entries as JSON. */
function readSchedule(form: FormData, method: ForecastMethod | undefined): ForecastSchedule | undefined {
  if (!method) return undefined;
  switch (method) {
    case 'one-off':
      return { oneOffDate: requireString(form, 'oneOffDate', 'Date') };
    case 'equal-monthly':
      return {
        startMonth: requireString(form, 'startMonth', 'Start month'),
        months: readInteger(form, 'months', 'Months') ?? 1,
      };
    case 'weighted-monthly': {
      const raw = requireString(form, 'weightsJson', 'Weights');
      return { weights: formWeightsToSchedule(parseJsonField(raw, 'weightsJson', formWeightsSchema, 'e.g. [{"month":"2027-02","percent":"60"},{"month":"2027-03","percent":"40"}]')) };
    }
    case 'milestone-linked':
      return { milestoneOffsetDays: readInteger(form, 'milestoneOffsetDays', 'Offset') ?? 0 };
    case 'manual': {
      const raw = requireString(form, 'manualJson', 'Manual schedule');
      return { manual: formManualToSchedule(parseJsonField(raw, 'manualJson', formManualSchema, 'e.g. [{"date":"2028-05-15","amount":"60000.00"}]')) };
    }
  }
}

function guardProject(form: FormData, permission: 'budget.edit' | 'baseline.publish'): ProjectId {
  accessService.guard('development.read');
  const projectId = asId<'Project'>(requireString(form, 'projectId', 'Project'));
  projectsService.guard(projectId, permission);
  return projectId;
}

/** CST01 — add a category. */
export async function createCategoryAction(_previous: ActionResult<unknown>, form: FormData): Promise<ActionResult<unknown>> {
  return runAction('Category created', () => {
    const projectId = guardProject(form, 'budget.edit');
    const parentId = readString(form, 'parentId');
    const created = budgetsService.createCategory({
      projectId,
      code: requireString(form, 'code', 'Category code'),
      name: requireString(form, 'name', 'Category name'),
      ...(parentId ? { parentId: asId<'CostCategory'>(parentId) } : {}),
      actor: accessService.getCurrentUser().id,
    });
    revalidateCosts(projectId);
    return created;
  });
}

/** CST02 — create a line; quantity × rate and a direct amount are mutually exclusive. */
export async function createCostLineAction(_previous: ActionResult<unknown>, form: FormData): Promise<ActionResult<unknown>> {
  return runAction(
    (line: { code: string }) => `Cost line ${line.code} created`,
    () => {
      const projectId = guardProject(form, 'budget.edit');
      const inputMode = readChoice(form, 'inputMode', INPUT_MODES) ?? 'direct';
      const method = readChoice(form, 'forecastMethod', FORECAST_METHODS) ?? 'one-off';
      const rowType = readChoice(form, 'rowType', ROW_TYPES) ?? 'posting';
      const quantity = readNumber(form, 'quantity', 'Quantity');
      const rate = readMoney(form, 'rate');
      const budget = readMoney(form, 'originalBudget');
      const parentLineId = readString(form, 'parentLineId');
      const milestoneId = readString(form, 'milestoneId');
      const responsible = readString(form, 'responsibleUserId');
      const created = budgetsService.createCostLine({
        projectId,
        categoryId: asId<'CostCategory'>(requireString(form, 'categoryId', 'Category')) as CostCategoryId,
        code: requireString(form, 'code', 'Line code'),
        title: requireString(form, 'title', 'Title'),
        ...(readString(form, 'description') ? { description: readString(form, 'description') } : {}),
        rowType,
        ...(parentLineId ? { parentLineId: asId<'CostLine'>(parentLineId) } : {}),
        inputMode,
        ...(quantity !== undefined ? { quantity } : {}),
        ...(readString(form, 'unit') ? { unit: readString(form, 'unit') } : {}),
        ...(rate !== undefined ? { rate } : {}),
        ...(budget !== undefined ? { originalBudget: budget } : {}),
        taxTreatment: readChoice(form, 'taxTreatment', TAX_TREATMENTS) ?? 'standard-gst',
        recoverablePpm: readPpm(form, 'recoverablePercent') ?? 1_000_000,
        forecastMethod: method,
        schedule: rowType === 'summary' ? {} : (readSchedule(form, method) ?? {}),
        ...(milestoneId ? { milestoneId: asId<'Milestone'>(milestoneId) } : {}),
        ...(responsible ? { responsibleUserId: asId<'User'>(responsible) } : {}),
        isContingency: readBoolean(form, 'isContingency'),
        actor: accessService.getCurrentUser().id,
        ...(readRevision(form) !== undefined ? { expectedRevision: readRevision(form) } : {}),
      });
      revalidateCosts(projectId);
      return created;
    },
  );
}

/** CST02 — edit a line; every changed field appends history. */
export async function updateCostLineAction(_previous: ActionResult<unknown>, form: FormData): Promise<ActionResult<unknown>> {
  return runAction('Cost line saved', () => {
    const projectId = guardProject(form, 'budget.edit');
    const costLineId = asId<'CostLine'>(requireString(form, 'costLineId', 'Cost line')) as CostLineId;
    const line = budgetsService.requireCostLine(costLineId);
    if (line.projectId !== projectId) throw new ValidationError('That line belongs to another project.');
    const inputMode = readChoice(form, 'inputMode', INPUT_MODES);
    const method = readChoice(form, 'forecastMethod', FORECAST_METHODS);
    const timingMode = readChoice(form, 'timingMode', TIMING_MODES);
    const quantity = readNumber(form, 'quantity', 'Quantity');
    const rate = readMoney(form, 'rate');
    const budget = readMoney(form, 'originalBudget');
    const recoverable = readPpm(form, 'recoverablePercent');
    const categoryId = readString(form, 'categoryId');
    const milestoneId = readString(form, 'milestoneId');
    const responsible = readString(form, 'responsibleUserId');
    const effectiveMode = inputMode ?? line.inputMode;
    const changes: CostLineChanges = {
      ...(readString(form, 'title') ? { title: readString(form, 'title') } : {}),
      description: readString(form, 'description'),
      ...(categoryId ? { categoryId: asId<'CostCategory'>(categoryId) } : {}),
      ...(inputMode ? { inputMode } : {}),
      ...(effectiveMode === 'quantity-rate'
        ? { ...(quantity !== undefined ? { quantity } : {}), ...(rate !== undefined ? { rate } : {}) }
        : { ...(budget !== undefined ? { originalBudget: budget } : {}) }),
      unit: readString(form, 'unit'),
      ...(readChoice(form, 'taxTreatment', TAX_TREATMENTS) ? { taxTreatment: readChoice(form, 'taxTreatment', TAX_TREATMENTS) } : {}),
      ...(recoverable !== undefined ? { recoverablePpm: recoverable } : {}),
      ...(line.rowType === 'posting' && method ? { forecastMethod: method, schedule: readSchedule(form, method) } : {}),
      ...(timingMode ? { timingMode } : {}),
      milestoneId: milestoneId ? asId<'Milestone'>(milestoneId) : undefined,
      responsibleUserId: responsible ? asId<'User'>(responsible) : undefined,
    };
    const updated = budgetsService.updateCostLine(costLineId, changes, accessService.getCurrentUser().id, readString(form, 'reason'), readRevision(form));
    revalidateCosts(projectId);
    return updated;
  });
}

/** CST08 — contingency draw, transfer, scope change or manual adjustment. */
export async function recordAdjustmentAction(_previous: ActionResult<unknown>, form: FormData): Promise<ActionResult<unknown>> {
  return runAction('Budget adjustment recorded', () => {
    const projectId = guardProject(form, 'budget.edit');
    const kind = readChoice(form, 'kind', ADJUSTMENT_KINDS);
    if (!kind) throw new ValidationError('Choose the kind of adjustment.', { fieldErrors: { kind: ['Select a kind.'] } });
    const amount = readMoney(form, 'amount');
    if (amount === undefined) throw new ValidationError('Enter an amount.', { fieldErrors: { amount: ['An amount is required.'] } });
    const from = readString(form, 'fromLineId');
    const to = readString(form, 'toLineId');
    const adjustment = budgetsService.recordAdjustment({
      projectId,
      kind,
      ...(from ? { fromLineId: asId<'CostLine'>(from) } : {}),
      ...(to ? { toLineId: asId<'CostLine'>(to) } : {}),
      amount,
      reason: readString(form, 'reason') ?? '',
      actor: accessService.getCurrentUser().id,
      ...(readRevision(form) !== undefined ? { expectedRevision: readRevision(form) } : {}),
    });
    revalidateCosts(projectId);
    return adjustment;
  });
}

/**
 * CF07 — save a batch atomically. Hidden fields: projectId, revision, and
 * `edits` as a JSON string in the API's wire shape (budget as "1860.00").
 */
export async function applyForecastBatchAction(_previous: ActionResult<unknown>, form: FormData): Promise<ActionResult<unknown>> {
  return runAction(
    (batch: { changes: readonly unknown[]; revisionAfter: number }) => `Batch saved · ${batch.changes.length} change${batch.changes.length === 1 ? '' : 's'} · revision ${batch.revisionAfter}`,
    () => {
      const projectId = guardProject(form, 'budget.edit');
      const revision = readRevision(form);
      if (revision === undefined) throw new ValidationError('The revision you edited against is missing; reload and try again.');
      const body = parseJsonField(requireString(form, 'edits', 'Edits'), 'edits', forecastBatchSchema.shape.edits, 'Enter one "CODE=amount" per line.');
      const edits: ForecastEdit[] = body.map(editFromBody);
      const batch = budgetsService.applyForecastBatch({ projectId, actor: accessService.getCurrentUser().id, expectedRevision: revision, edits });
      revalidateCosts(projectId);
      return batch;
    },
  );
}

/** CF09 — undo my latest unshared batch with a compensating one. */
export async function undoBatchAction(_previous: ActionResult<unknown>, form: FormData): Promise<ActionResult<unknown>> {
  return runAction('Latest batch undone', () => {
    const projectId = guardProject(form, 'budget.edit');
    const undo = budgetsService.undoLatestBatch(projectId, accessService.getCurrentUser().id);
    revalidateCosts(projectId);
    return undo;
  });
}

/** PRJ05 — snapshot a baseline candidate. */
export async function createBaselineAction(_previous: ActionResult<unknown>, form: FormData): Promise<ActionResult<unknown>> {
  return runAction('Baseline candidate created', () => {
    const projectId = guardProject(form, 'budget.edit');
    const version = budgetsService.createBaselineCandidate({
      projectId,
      name: requireString(form, 'name', 'Baseline name'),
      actor: accessService.getCurrentUser().id,
    });
    revalidateCosts(projectId);
    return version;
  });
}

/** PRJ05 — publish a candidate with a reason; the previous baseline stays readable. */
export async function publishBaselineAction(_previous: ActionResult<unknown>, form: FormData): Promise<ActionResult<unknown>> {
  return runAction(
    (version: { name: string }) => `${version.name} published`,
    () => {
      const projectId = guardProject(form, 'baseline.publish');
      const baselineId = asId<'BudgetVersion'>(requireString(form, 'baselineId', 'Baseline'));
      if (budgetsService.requireBaseline(baselineId).projectId !== projectId) throw new ValidationError('That baseline belongs to another project.');
      const version = budgetsService.publishBaseline({ baselineId, actor: accessService.getCurrentUser().id, reason: readString(form, 'reason') ?? '' });
      revalidateCosts(projectId);
      return version;
    },
  );
}

/** CF03 — close a line; it stays in totals and history. */
export async function deactivateCostLineAction(_previous: ActionResult<unknown>, form: FormData): Promise<ActionResult<unknown>> {
  return runAction('Cost line closed', () => {
    const projectId = guardProject(form, 'budget.edit');
    const costLineId = asId<'CostLine'>(requireString(form, 'costLineId', 'Cost line'));
    if (budgetsService.requireCostLine(costLineId).projectId !== projectId) throw new ValidationError('That line belongs to another project.');
    const line = budgetsService.deactivateCostLine(costLineId, accessService.getCurrentUser().id, readString(form, 'reason') ?? '');
    revalidateCosts(projectId);
    return line;
  });
}
