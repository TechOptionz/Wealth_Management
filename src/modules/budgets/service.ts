/**
 * Budgets business logic (CST01, CST02, CST08, CF03, CF04, CF06, CF07, CF09,
 * PRJ04, PRJ05).
 *
 * Nothing here stores a derived figure. The current budget of a line is
 * recomputed from its original budget and the adjustments that name it; a
 * summary row's figure is the sum of its posting descendants; a baseline is a
 * snapshot taken at publish time and never touched again. Every write bumps
 * the project's model revision through `projectsService`, so a stale editor
 * gets a conflict rather than overwriting someone else's work.
 *
 * All amounts are ex GST (net). `lineSchedule` distributes whatever cents it
 * is handed, on any basis.
 */
import { randomUUID } from 'node:crypto';
import {
  addMonthsToKey,
  allocateResidualToLast,
  dateInMonth,
  distributeEqualMonthly,
  distributeMilestoneLinked,
  distributeOneOff,
  distributeWeighted,
  formatPpmAsPercent,
  monthKeyOf,
  PPM,
  validateManualSchedule,
  type MonthKey,
} from '@/shared/finance-engine';
import { ConflictError, NotFoundError, ValidationError } from '@/shared/lib/errors';
import { formatMoney, money, sumMoney, type Money } from '@/shared/lib/money';
import {
  asId,
  type BudgetVersionId,
  type CostCategoryId,
  type CostLineId,

  type IsoDate,
  type IsoDateTime,
  type MilestoneId,
  type ProjectId,
  type UserId,
} from '@/shared/types/common';
import { accessService } from '@/modules/access/service';
import { projectsService } from '@/modules/projects/service';
import { budgetsRepository } from './repository';
import {
  quantityRateBudget,
  timingModeFor,
  type AdjustmentKind,
  type BudgetAdjustment,
  type BudgetVersion,
  type CostCategory,
  type CostLine,
  type CostLineChange,
  type ForecastBatch,
  type ForecastBatchChange,
  type ForecastEdit,
  type ForecastEditField,
  type ForecastMethod,
  type ForecastSchedule,
  type InputMode,
  type RowType,
  type TimingMode,
} from './model';

const LINE_CODE = /^[A-Z0-9][A-Z0-9-]{1,19}$/;
const CATEGORY_CODE = /^[A-Z0-9]{2,10}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/* ---------- Public input types ---------- */

export interface CreateCostLineInput {
  readonly projectId: ProjectId;
  readonly categoryId: CostCategoryId;
  readonly code: string;
  readonly title: string;
  readonly description?: string;
  readonly rowType: RowType;
  readonly parentLineId?: CostLineId;
  readonly inputMode: InputMode;
  readonly quantity?: number;
  readonly unit?: string;
  readonly rate?: Money;
  readonly originalBudget?: Money;
  readonly taxTreatment: CostLine['taxTreatment'];
  readonly recoverablePpm: number;
  readonly forecastMethod: ForecastMethod;
  readonly schedule: ForecastSchedule;
  readonly timingMode?: TimingMode;
  readonly milestoneId?: MilestoneId;
  readonly responsibleUserId?: UserId;
  readonly isContingency?: boolean;
  readonly actor: UserId;
  readonly expectedRevision?: number;
}

export type CostLineChanges = Partial<
  Pick<
    CostLine,
    | 'title'
    | 'description'
    | 'categoryId'
    | 'parentLineId'
    | 'inputMode'
    | 'quantity'
    | 'unit'
    | 'rate'
    | 'originalBudget'
    | 'taxTreatment'
    | 'recoverablePpm'
    | 'forecastMethod'
    | 'schedule'
    | 'timingMode'
    | 'milestoneId'
    | 'responsibleUserId'
    | 'active'
    | 'isContingency'
    | 'sortOrder'
  >
>;

export interface RecordAdjustmentInput {
  readonly projectId: ProjectId;
  readonly kind: AdjustmentKind;
  readonly fromLineId?: CostLineId;
  readonly toLineId?: CostLineId;
  readonly amount: Money;
  readonly reason: string;
  readonly actor: UserId;
  readonly expectedRevision?: number;
}

export interface CloneOptions {
  readonly structure: boolean;
  readonly assumptions: boolean;
  /** Source milestone → target milestone, when the caller has cloned the programme too. */
  readonly milestoneMap?: ReadonlyMap<MilestoneId, MilestoneId>;
}

export interface ScheduleContext {
  readonly cutoff: IsoDate;
  readonly milestoneDate?: IsoDate;
}

export interface LineScheduleResult {
  readonly entries: readonly { readonly date: IsoDate; readonly cents: number }[];
  /** Entries that fell in a closed period (or had no resolvable date) and were moved forward (CF06). */
  readonly shifted: number;
}

export interface UndoEligibility {
  readonly batch: ForecastBatch | null;
  readonly reason: string | null;
}

/* ---------- Small helpers ---------- */

function now(): IsoDateTime {
  return new Date().toISOString();
}

function actorName(userId: UserId): string {
  return accessService.resolveUserName(userId) ?? 'system';
}

function fieldError(message: string, field: string, hint = message): ValidationError {
  return new ValidationError(message, { fieldErrors: { [field]: [hint] } });
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

function exGst(value: Money): string {
  return `${formatMoney(value)} ex GST`;
}

/** The month after the cutoff, dated the fifteenth: where locked forecast moves to (CF06, CAL04). */
function firstOpenDate(cutoff: IsoDate): IsoDate {
  return dateInMonth(addMonthsToKey(monthKeyOf(cutoff), 1));
}

function currentBudgetOf(line: CostLine, adjustments: readonly BudgetAdjustment[]): Money {
  let cents = line.originalBudget.cents;
  for (const adjustment of adjustments) {
    if (adjustment.toLineId === line.id) cents += adjustment.amount.cents;
    if (adjustment.fromLineId === line.id) cents -= adjustment.amount.cents;
  }
  return money(cents, line.originalBudget.currency);
}

/** Posting rows under a summary row, however deep. A posting row has none. */
function postingDescendants(line: CostLine, lines: readonly CostLine[]): readonly CostLine[] {
  if (line.rowType !== 'summary') return [];
  const children = lines.filter((candidate) => candidate.parentLineId === line.id);
  return children.flatMap((child) => (child.rowType === 'posting' ? [child] : postingDescendants(child, lines)));
}

function requireLineIn(projectId: ProjectId, costLineId: CostLineId): CostLine {
  const line = budgetsRepository.findCostLine(costLineId);
  // Another project's line is "not found", the same as an unknown id (IAM02).
  if (!line || line.projectId !== projectId) throw new NotFoundError('Cost line', costLineId);
  return line;
}

function requireCategoryIn(projectId: ProjectId, categoryId: CostCategoryId): CostCategory {
  const category = budgetsRepository.findCategory(categoryId);
  if (!category || category.projectId !== projectId) throw new NotFoundError('Cost category', categoryId);
  return category;
}

/* ---------- Validation ---------- */

interface ScheduleCheck {
  readonly method: ForecastMethod;
  readonly schedule: ForecastSchedule;
  readonly milestoneId?: MilestoneId;
  readonly budgetCents: number;
  readonly cutoff: IsoDate;
  /**
   * The schedule the line had before. Only elements that are new or changed
   * are checked against the lock, so editing the tail of a schedule that
   * started before the cutoff is allowed; `undefined` means everything is new.
   */
  readonly previous?: { readonly method: ForecastMethod; readonly schedule: ForecastSchedule };
}

function validateSchedule(check: ScheduleCheck): void {
  const { method, schedule, budgetCents, cutoff } = check;
  const cutoffMonth = monthKeyOf(cutoff);
  const previous = check.previous && check.previous.method === method ? check.previous.schedule : undefined;
  const locked = (label: string): string => `${label} falls in a closed period (actuals cutoff ${cutoff}). Forecast belongs after it (CF06).`;

  switch (method) {
    case 'one-off': {
      const date = schedule.oneOffDate;
      if (!date || !ISO_DATE.test(date)) throw fieldError('A one-off line needs a date.', 'schedule.oneOffDate', 'Enter the date as YYYY-MM-DD.');
      if (date !== previous?.oneOffDate && date <= cutoff) throw fieldError(locked(date), 'schedule.oneOffDate', locked(date));
      return;
    }
    case 'equal-monthly': {
      const start = schedule.startMonth;
      if (!start || !MONTH.test(start)) throw fieldError('An equal monthly line needs a start month.', 'schedule.startMonth', 'Enter the month as YYYY-MM.');
      if (!Number.isInteger(schedule.months) || (schedule.months ?? 0) < 1) {
        throw fieldError('An equal monthly line needs a whole number of months, at least one.', 'schedule.months', 'Enter at least one month.');
      }
      if (start !== previous?.startMonth && start <= cutoffMonth) throw fieldError(locked(start), 'schedule.startMonth', locked(start));
      return;
    }
    case 'weighted-monthly': {
      const weights = schedule.weights ?? [];
      if (weights.length === 0) throw fieldError('A weighted line needs at least one month.', 'schedule.weights', 'Add at least one month with a weight.');
      const seen = new Set<MonthKey>();
      weights.forEach((weight, index) => {
        if (!MONTH.test(weight.month)) throw fieldError(`"${weight.month}" is not a month.`, `schedule.weights[${index}].month`, 'Use YYYY-MM.');
        if (!Number.isInteger(weight.weightPpm) || weight.weightPpm < 0) {
          throw fieldError(`The weight for ${weight.month} must be a whole ppm value of zero or more.`, `schedule.weights[${index}].weightPpm`);
        }
        if (seen.has(weight.month)) throw fieldError(`${weight.month} appears twice in the weights.`, `schedule.weights[${index}].month`);
        seen.add(weight.month);
        const before = previous?.weights?.find((entry) => entry.month === weight.month);
        if ((!before || before.weightPpm !== weight.weightPpm) && weight.month <= cutoffMonth) {
          throw fieldError(locked(weight.month), `schedule.weights[${index}].month`, locked(weight.month));
        }
      });
      const total = weights.reduce((sum, weight) => sum + weight.weightPpm, 0);
      if (total !== PPM) {
        const message = `Schedule weights must total 100%; these total ${formatPpmAsPercent(total, 4)}.`;
        throw fieldError(message, 'schedule.weights', message);
      }
      try {
        distributeWeighted(budgetCents, weights);
      } catch (error) {
        throw fieldError((error as Error).message, 'schedule.weights');
      }
      return;
    }
    case 'milestone-linked': {
      if (!check.milestoneId) throw fieldError('A milestone-linked line needs a milestone.', 'milestoneId', 'Choose the milestone this cost follows.');
      const offset = schedule.milestoneOffsetDays ?? 0;
      if (!Number.isInteger(offset)) throw fieldError('The milestone offset must be a whole number of days.', 'schedule.milestoneOffsetDays');
      return;
    }
    case 'manual': {
      const entries = schedule.manual ?? [];
      entries.forEach((entry, index) => {
        if (!ISO_DATE.test(entry.date)) throw fieldError(`"${entry.date}" is not a date.`, `schedule.manual[${index}].date`, 'Use YYYY-MM-DD.');
        if (!Number.isSafeInteger(entry.cents)) throw fieldError(`The amount on ${entry.date} must be whole cents.`, `schedule.manual[${index}].cents`);
        const before = previous?.manual?.find((candidate) => candidate.date === entry.date && candidate.cents === entry.cents);
        if (!before && entry.date <= cutoff) throw fieldError(locked(entry.date), `schedule.manual[${index}].date`, locked(entry.date));
      });
      try {
        validateManualSchedule(budgetCents, entries);
      } catch {
        const message = `A manual schedule must total the line's budget of ${exGst(money(budgetCents))}; these entries total ${exGst(money(entries.reduce((sum, entry) => sum + entry.cents, 0)))}.`;
        throw fieldError(message, 'schedule.manual', message);
      }
      return;
    }
  }
}

interface BudgetInput {
  readonly rowType: RowType;
  readonly inputMode: InputMode;
  readonly quantity?: number;
  readonly rate?: Money;
  readonly originalBudget?: Money;
}

/** Quantity × rate and a direct amount are mutually exclusive (CST02); a summary row has neither (F02). */
function resolveBudgetInput(input: BudgetInput): Pick<CostLine, 'inputMode' | 'quantity' | 'rate' | 'originalBudget'> {
  const exclusive = 'Enter either quantity × rate or a direct amount, not both.';
  if (input.rowType === 'summary') {
    if (input.quantity !== undefined || input.rate !== undefined || (input.originalBudget && input.originalBudget.cents !== 0)) {
      throw fieldError('A summary row carries no amount of its own; its figure is the sum of its posting rows (F02).', 'originalBudget');
    }
    return { inputMode: 'direct', originalBudget: money(0) };
  }
  if (input.inputMode === 'quantity-rate') {
    if (input.originalBudget !== undefined) throw fieldError(exclusive, 'originalBudget', 'Leave the direct amount blank in quantity × rate mode.');
    if (input.quantity === undefined) throw fieldError('Enter a quantity.', 'quantity', 'A quantity is required in quantity × rate mode.');
    if (input.rate === undefined) throw fieldError('Enter a rate (ex GST).', 'rate', 'A rate is required in quantity × rate mode.');
    return { inputMode: 'quantity-rate', quantity: input.quantity, rate: input.rate, originalBudget: quantityRateBudget(input.quantity, input.rate) };
  }
  if (input.quantity !== undefined || input.rate !== undefined) throw fieldError(exclusive, 'quantity', 'Leave quantity and rate blank in direct mode.');
  const budget = input.originalBudget ?? money(0);
  if (budget.cents < 0) throw fieldError('A budget cannot be negative.', 'originalBudget', 'Enter zero or more; credits are recorded as adjustments.');
  return { inputMode: 'direct', originalBudget: budget };
}

/** Structural checks shared by create and update. `previous` is the line as stored, when updating. */
function validateLineShape(next: CostLine, lines: readonly CostLine[], cutoff: IsoDate, budgetAfterCents: number, previous?: CostLine): void {
  if (!next.title.trim()) throw fieldError('Enter a title.', 'title', 'A cost line needs a title.');
  if (next.taxTreatment === 'margin-scheme') {
    throw fieldError('Margin scheme applies to sales, not cost lines, and stays disabled until finance review supplies a method (CAL11).', 'taxTreatment');
  }
  if (!Number.isInteger(next.recoverablePpm) || next.recoverablePpm < 0 || next.recoverablePpm > PPM) {
    throw fieldError('Recoverable GST must be between 0% and 100%.', 'recoverablePpm');
  }
  if (next.rowType === 'summary' && next.isContingency) throw fieldError('A summary row cannot be the contingency allowance.', 'isContingency');
  if (next.parentLineId) {
    if (next.parentLineId === next.id) throw fieldError('A line cannot be its own parent.', 'parentLineId');
    const parent = lines.find((line) => line.id === next.parentLineId);
    if (!parent || parent.projectId !== next.projectId) throw fieldError('Choose a parent from this project.', 'parentLineId');
    if (parent.rowType !== 'summary') throw fieldError(`${parent.code} is a posting row; only a summary row can group other lines.`, 'parentLineId');
    // No cycles: walk up from the parent.
    let cursor: CostLine | undefined = parent;
    const visited = new Set<CostLineId>([next.id]);
    while (cursor) {
      if (visited.has(cursor.id)) throw fieldError('That parent would create a loop.', 'parentLineId');
      visited.add(cursor.id);
      cursor = cursor.parentLineId ? lines.find((line) => line.id === cursor?.parentLineId) : undefined;
    }
  }
  if (previous && previous.rowType === 'summary' && next.rowType === 'posting' && lines.some((line) => line.parentLineId === next.id)) {
    throw fieldError(`${next.code} still groups other lines; move them first.`, 'rowType');
  }
  if (next.timingMode !== timingModeFor(next.forecastMethod)) {
    throw fieldError(`A ${next.forecastMethod} line uses the ${timingModeFor(next.forecastMethod)} timing mode.`, 'timingMode');
  }
  if (next.responsibleUserId) accessService.requireUser(next.responsibleUserId);
  if (next.rowType === 'posting') {
    validateSchedule({
      method: next.forecastMethod,
      schedule: next.schedule,
      milestoneId: next.milestoneId,
      budgetCents: budgetAfterCents,
      cutoff,
      ...(previous ? { previous: { method: previous.forecastMethod, schedule: previous.schedule } } : {}),
    });
  }
}

const TRACKED_FIELDS: readonly (keyof CostLineChanges)[] = [
  'title',
  'description',
  'categoryId',
  'parentLineId',
  'inputMode',
  'quantity',
  'unit',
  'rate',
  'originalBudget',
  'taxTreatment',
  'recoverablePpm',
  'forecastMethod',
  'schedule',
  'timingMode',
  'milestoneId',
  'responsibleUserId',
  'active',
  'isContingency',
  'sortOrder',
];

const BUDGET_FIELDS: readonly (keyof CostLineChanges)[] = ['inputMode', 'quantity', 'rate', 'originalBudget'];

/** Append a history entry per changed field and store the new values. Does not bump the revision. */
function writeLineChanges(line: CostLine, next: CostLine, actor: UserId, at: IsoDateTime, reason?: string): CostLine {
  const entries: CostLineChange[] = [];
  for (const field of TRACKED_FIELDS) {
    if (!sameJson(line[field], next[field])) {
      entries.push({ at, actor, field, before: line[field] ?? null, after: next[field] ?? null, ...(reason ? { reason } : {}) });
    }
  }
  if (entries.length === 0) return line;
  const updated = budgetsRepository.updateCostLine(line.id, { ...next, history: [...line.history, ...entries] });
  if (!updated) throw new NotFoundError('Cost line', line.id);
  return updated;
}

function writeAdjustment(input: {
  readonly projectId: ProjectId;
  readonly kind: AdjustmentKind;
  readonly fromLineId?: CostLineId;
  readonly toLineId?: CostLineId;
  readonly amount: Money;
  readonly reason: string;
  readonly actor: UserId;
  readonly at: IsoDateTime;
  readonly revision: number;
}): BudgetAdjustment {
  return budgetsRepository.insertAdjustment({
    id: `adj-${randomUUID()}`,
    projectId: input.projectId,
    kind: input.kind,
    ...(input.fromLineId ? { fromLineId: input.fromLineId } : {}),
    ...(input.toLineId ? { toLineId: input.toLineId } : {}),
    amount: input.amount,
    reason: input.reason,
    actor: input.actor,
    at: input.at,
    revision: input.revision,
  });
}

/* ---------- Batch planning ---------- */

interface PlannedEdit {
  readonly line: CostLine;
  readonly next: CostLine;
  readonly budgetBefore: Money;
  readonly budgetAfter: Money;
  readonly changes: readonly ForecastBatchChange[];
  readonly reason?: string;
}

interface BatchPlan {
  readonly items: readonly PlannedEdit[];
  readonly warnings: readonly string[];
}

/** Validate every edit before anything is written (CF07: all or nothing). */
function planBatch(projectId: ProjectId, edits: readonly ForecastEdit[]): BatchPlan {
  if (edits.length === 0) throw new ValidationError('A batch needs at least one edit.', { fieldErrors: { edits: ['Add at least one line.'] } });
  const cutoff = projectsService.policyFor(projectId).actualsCutoff;
  const adjustments = budgetsRepository.listAdjustments(projectId);
  const seen = new Set<CostLineId>();
  const items: PlannedEdit[] = [];
  const warnings: string[] = [];

  for (const edit of edits) {
    const line = requireLineIn(projectId, edit.costLineId);
    if (seen.has(line.id)) throw new ValidationError(`${line.code} appears twice in this batch; combine the edits into one.`, { fieldErrors: { edits: [`${line.code} is listed twice.`] } });
    seen.add(line.id);
    if (line.rowType !== 'posting') {
      throw new ValidationError(`${line.code} is a summary row; edit its posting rows instead (F02).`, { fieldErrors: { edits: [`${line.code} is a summary row.`] } });
    }

    const before = currentBudgetOf(line, adjustments);
    let after = before;
    const changes: ForecastBatchChange[] = [];

    if (edit.budget !== undefined) {
      if (edit.budget.cents < 0) throw fieldError(`${line.code}: a budget cannot be negative.`, 'budget', 'Enter zero or more.');
      if (edit.budget.cents !== before.cents) {
        if (!edit.reason?.trim()) {
          throw new ValidationError(`Give a reason for changing the budget of ${line.code}.`, { fieldErrors: { reason: ['A reason is required when a budget changes.'] } });
        }
        after = edit.budget;
        changes.push({ costLineId: line.id, field: 'budget', before, after });
      }
    }

    const method = edit.forecastMethod ?? line.forecastMethod;
    const schedule = edit.schedule ?? line.schedule;
    const milestoneId = edit.milestoneId ?? line.milestoneId;
    const timingMode = edit.timingMode ?? (edit.forecastMethod && edit.forecastMethod !== line.forecastMethod ? timingModeFor(method) : line.timingMode);
    const next: CostLine = {
      ...line,
      forecastMethod: method,
      schedule,
      timingMode,
      ...(milestoneId ? { milestoneId } : {}),
    };
    if (!milestoneId) delete (next as { milestoneId?: MilestoneId }).milestoneId;

    if (timingMode !== timingModeFor(method)) {
      throw fieldError(`${line.code}: a ${method} line uses the ${timingModeFor(method)} timing mode.`, 'timingMode');
    }
    try {
      validateSchedule({
        method,
        schedule,
        milestoneId,
        budgetCents: after.cents,
        cutoff,
        previous: { method: line.forecastMethod, schedule: line.schedule },
      });
    } catch (error) {
      if (error instanceof ValidationError) {
        throw new ValidationError(`${line.code}: ${error.message}`, error.details);
      }
      throw error;
    }

    const fieldChanges: readonly (ForecastEditField & keyof CostLine)[] = ['forecastMethod', 'schedule', 'milestoneId', 'timingMode'];
    for (const field of fieldChanges) {
      if (!sameJson(line[field], next[field])) changes.push({ costLineId: line.id, field, before: line[field] ?? null, after: next[field] ?? null });
    }

    if (changes.length === 0) {
      warnings.push(`${line.code}: nothing changed.`);
      continue;
    }
    if (line.isContingency && after.cents !== before.cents) {
      warnings.push(`${line.code}: the contingency allowance was changed directly; a draw or transfer is the audited way to use it (CST08).`);
    }
    if (!line.active) warnings.push(`${line.code} is inactive; it stays in totals but will not be forecast until reactivated.`);
    const { shifted } = budgetsService.lineSchedule(next, after.cents, { cutoff });
    if (shifted > 0) warnings.push(`${line.code}: ${shifted} scheduled amount${shifted === 1 ? '' : 's'} fall in closed periods and will move to ${firstOpenDate(cutoff)} (CF06).`);

    items.push({ line, next, budgetBefore: before, budgetAfter: after, changes, ...(edit.reason?.trim() ? { reason: edit.reason.trim() } : {}) });
  }
  return { items, warnings };
}

function conflictFor(projectId: ProjectId, yourRevision: number, latestRevision: number, edits: readonly ForecastEdit[]): ConflictError {
  const adjustments = budgetsRepository.listAdjustments(projectId);
  const latest = edits.flatMap((edit) => {
    const line = budgetsRepository.findCostLine(edit.costLineId);
    if (!line || line.projectId !== projectId) return [];
    return [{ costLineId: line.id, code: line.code, budget: currentBudgetOf(line, adjustments), forecastMethod: line.forecastMethod, schedule: line.schedule }];
  });
  const summary = latest.map((entry) => `${entry.code} ${exGst(entry.budget)} · ${entry.forecastMethod}`).join('; ');
  return new ConflictError(
    `Someone else changed this project since you loaded it (you edited against revision ${yourRevision}; it is now ${latestRevision}). Latest stored values: ${summary || 'none of your lines changed'}. Review them and try again.`,
    { yourRevision, latestRevision, latest },
  );
}

/* ---------- The service ---------- */

export const budgetsService = {
  listCategories(projectId: ProjectId): readonly CostCategory[] {
    return budgetsRepository.listCategories(projectId);
  },

  requireCategory(categoryId: CostCategoryId): CostCategory {
    const category = budgetsRepository.findCategory(categoryId);
    if (!category) throw new NotFoundError('Cost category', categoryId);
    return category;
  },

  /** Inactive lines are included unless the caller filters them out; the screen must say when it does (CF03). */
  listCostLines(projectId: ProjectId, filter?: { readonly categoryId?: CostCategoryId; readonly includeInactive?: boolean }): readonly CostLine[] {
    return budgetsRepository
      .listCostLines(projectId)
      .filter((line) => (filter?.categoryId ? line.categoryId === filter.categoryId : true))
      .filter((line) => (filter?.includeInactive === false ? line.active : true));
  },

  requireCostLine(costLineId: CostLineId): CostLine {
    const line = budgetsRepository.findCostLine(costLineId);
    if (!line) throw new NotFoundError('Cost line', costLineId);
    return line;
  },

  /** The rows that carry money. Summary rows never appear here (CF03, F02). */
  postingLines(projectId: ProjectId): readonly CostLine[] {
    return budgetsRepository.listCostLines(projectId).filter((line) => line.rowType === 'posting');
  },

  /**
   * Original budget plus adjustments in, less adjustments out — derived on
   * every read (CST08). A summary row reports the sum of its posting
   * descendants and never an amount of its own (F02).
   */
  currentBudget(costLineId: CostLineId): Money {
    const line = budgetsService.requireCostLine(costLineId);
    const adjustments = budgetsRepository.listAdjustments(line.projectId);
    if (line.rowType === 'posting') return currentBudgetOf(line, adjustments);
    const lines = budgetsRepository.listCostLines(line.projectId);
    return sumMoney(postingDescendants(line, lines).map((child) => currentBudgetOf(child, adjustments)));
  },

  /** Posting lines only, so summing the values gives the project total exactly once. */
  currentBudgetByLine(projectId: ProjectId): ReadonlyMap<CostLineId, Money> {
    const adjustments = budgetsRepository.listAdjustments(projectId);
    return new Map(budgetsService.postingLines(projectId).map((line) => [line.id, currentBudgetOf(line, adjustments)]));
  },

  /** The latest published baseline, or null before any is published. */
  selectedBaseline(projectId: ProjectId): BudgetVersion | null {
    const published = budgetsRepository
      .listVersions(projectId)
      .filter((version) => version.state === 'published')
      .sort((a, b) => (a.approvedAt ?? '').localeCompare(b.approvedAt ?? ''));
    return published[published.length - 1] ?? null;
  },

  /** A line's amount in a baseline; null when there is no baseline or the line was created after it. */
  baselineAmount(costLineId: CostLineId, baseline?: BudgetVersion | null): Money | null {
    const line = budgetsService.requireCostLine(costLineId);
    const version = baseline === undefined ? budgetsService.selectedBaseline(line.projectId) : baseline;
    if (!version) return null;
    if (line.rowType === 'posting') return version.lines.find((entry) => entry.costLineId === line.id)?.amount ?? null;
    const lines = budgetsRepository.listCostLines(line.projectId);
    const amounts = postingDescendants(line, lines).flatMap((child) => {
      const entry = version.lines.find((candidate) => candidate.costLineId === child.id);
      return entry ? [entry.amount] : [];
    });
    return amounts.length === 0 ? null : sumMoney(amounts);
  },

  listBaselines(projectId: ProjectId): readonly BudgetVersion[] {
    return budgetsRepository.listVersions(projectId);
  },

  requireBaseline(baselineId: BudgetVersionId): BudgetVersion {
    const version = budgetsRepository.findVersion(baselineId);
    if (!version) throw new NotFoundError('Baseline', baselineId);
    return version;
  },

  createCategory(input: {
    readonly projectId: ProjectId;
    readonly code: string;
    readonly name: string;
    readonly parentId?: CostCategoryId;
    readonly actor: UserId;
  }): CostCategory {
    const project = projectsService.assertMutable(input.projectId);
    const code = input.code.trim().toUpperCase();
    if (!CATEGORY_CODE.test(code)) throw fieldError('Enter a category code of 2–10 letters or digits.', 'code', 'Letters and digits only, e.g. CON.');
    if (budgetsRepository.findCategoryByCode(input.projectId, code)) throw fieldError(`Category code ${code} is already used in ${project.code}.`, 'code', 'Each category code must be unique within the project.');
    if (!input.name.trim()) throw fieldError('Enter a category name.', 'name', 'A category needs a name.');
    if (input.parentId) requireCategoryIn(input.projectId, input.parentId);
    const existing = budgetsRepository.listCategories(input.projectId);
    const category = budgetsRepository.insertCategory({
      id: asId<'CostCategory'>(`cc-${randomUUID()}`),
      projectId: input.projectId,
      code,
      name: input.name.trim(),
      ...(input.parentId ? { parentId: input.parentId } : {}),
      sortOrder: (existing[existing.length - 1]?.sortOrder ?? 0) + 1,
    });
    accessService.record({
      actor: actorName(input.actor),
      summary: `Cost category created · ${project.code} · ${code}`,
      context: `${category.name}${input.parentId ? ` · under ${requireCategoryIn(input.projectId, input.parentId).code}` : ''}`,
    });
    return category;
  },

  createCostLine(input: CreateCostLineInput): CostLine {
    const project = projectsService.assertMutable(input.projectId);
    requireCategoryIn(input.projectId, input.categoryId);
    const code = input.code.trim().toUpperCase();
    if (!LINE_CODE.test(code)) throw fieldError('Enter a line code of 2–20 letters, digits or hyphens.', 'code', 'Use letters, digits and hyphens only, e.g. CON-04.');
    if (budgetsRepository.findCostLineByCode(input.projectId, code)) throw fieldError(`Line code ${code} is already used in ${project.code}.`, 'code', 'Each line code must be unique within the project.');

    const budget = resolveBudgetInput(input);
    const method = input.forecastMethod;
    const lines = budgetsRepository.listCostLines(input.projectId);
    const inCategory = lines.filter((line) => line.categoryId === input.categoryId);
    const at = now();
    const line: CostLine = {
      id: asId<'CostLine'>(`cl-${randomUUID()}`),
      projectId: input.projectId,
      categoryId: input.categoryId,
      code,
      title: input.title.trim(),
      ...(input.description?.trim() ? { description: input.description.trim() } : {}),
      rowType: input.rowType,
      ...(input.parentLineId ? { parentLineId: input.parentLineId } : {}),
      inputMode: budget.inputMode,
      ...(budget.quantity !== undefined ? { quantity: budget.quantity } : {}),
      ...(input.unit?.trim() ? { unit: input.unit.trim() } : {}),
      ...(budget.rate ? { rate: budget.rate } : {}),
      originalBudget: budget.originalBudget,
      taxTreatment: input.taxTreatment,
      recoverablePpm: input.recoverablePpm,
      forecastMethod: method,
      schedule: input.rowType === 'summary' ? { manual: [] } : input.schedule,
      timingMode: input.timingMode ?? timingModeFor(method),
      ...(input.milestoneId ? { milestoneId: input.milestoneId } : {}),
      ...(input.responsibleUserId ? { responsibleUserId: input.responsibleUserId } : {}),
      active: true,
      isContingency: input.isContingency ?? false,
      sortOrder: (inCategory[inCategory.length - 1]?.sortOrder ?? 0) + 1,
      history: [],
      createdAt: at,
    };
    if (line.rowType === 'summary') {
      // A summary row has no timing of its own; keep the stored shape valid.
      (line as { forecastMethod: ForecastMethod }).forecastMethod = 'manual';
      (line as { timingMode: TimingMode }).timingMode = 'manual';
    }
    validateLineShape(line, lines, projectsService.policyFor(input.projectId).actualsCutoff, line.originalBudget.cents);

    projectsService.bumpRevision(input.projectId, input.expectedRevision);
    const created = budgetsRepository.insertCostLine({
      ...line,
      history: [
        {
          at,
          actor: input.actor,
          field: 'created',
          before: null,
          after: {
            rowType: line.rowType,
            inputMode: line.inputMode,
            ...(line.quantity !== undefined ? { quantity: line.quantity } : {}),
            ...(line.rate ? { rate: line.rate } : {}),
            originalBudget: line.originalBudget,
          },
        },
      ],
    });
    accessService.record({
      actor: actorName(input.actor),
      summary: `Cost line created · ${project.code} · ${created.code}`,
      context: `${created.title} · ${created.rowType} · ${created.inputMode === 'quantity-rate' ? `${created.quantity} × ${formatMoney(created.rate, { showCents: true })} = ` : ''}${exGst(created.originalBudget)}`,
    });
    return created;
  },

  /** Change a line's fields; each changed field appends a history entry (CST02). Budget-affecting changes need a reason. */
  updateCostLine(costLineId: CostLineId, changes: CostLineChanges, actor: UserId, reason?: string, expectedRevision?: number): CostLine {
    const line = budgetsService.requireCostLine(costLineId);
    const project = projectsService.assertMutable(line.projectId);
    const lines = budgetsRepository.listCostLines(line.projectId);
    if (changes.categoryId) requireCategoryIn(line.projectId, changes.categoryId);

    const rowType = line.rowType;
    const mode = changes.inputMode ?? line.inputMode;
    const budget = resolveBudgetInput({
      rowType,
      inputMode: mode,
      ...(mode === 'quantity-rate'
        ? {
            quantity: changes.quantity ?? (line.inputMode === 'quantity-rate' ? line.quantity : undefined),
            rate: changes.rate ?? (line.inputMode === 'quantity-rate' ? line.rate : undefined),
            ...(changes.originalBudget !== undefined ? { originalBudget: changes.originalBudget } : {}),
          }
        : {
            ...(changes.quantity !== undefined ? { quantity: changes.quantity } : {}),
            ...(changes.rate !== undefined ? { rate: changes.rate } : {}),
            originalBudget: changes.originalBudget ?? line.originalBudget,
          }),
    });

    const next: CostLine = { ...line, ...changes, ...budget };
    if (budget.quantity === undefined) delete (next as { quantity?: number }).quantity;
    if (budget.rate === undefined) delete (next as { rate?: Money }).rate;
    for (const key of ['description', 'parentLineId', 'unit', 'milestoneId', 'responsibleUserId'] as const) {
      if (next[key] === undefined || next[key] === '') delete (next as unknown as Record<string, unknown>)[key];
    }
    if (changes.forecastMethod && changes.forecastMethod !== line.forecastMethod && changes.timingMode === undefined) {
      (next as { timingMode: TimingMode }).timingMode = timingModeFor(changes.forecastMethod);
    }

    const changedFields = TRACKED_FIELDS.filter((field) => !sameJson(line[field], next[field]));
    if (changedFields.length === 0) return line;
    if (changedFields.some((field) => BUDGET_FIELDS.includes(field)) && !reason?.trim()) {
      throw fieldError('Give a reason for changing the budget.', 'reason', 'A reason is required when the original budget, quantity or rate changes.');
    }

    const adjustments = budgetsRepository.listAdjustments(line.projectId);
    const budgetAfter = currentBudgetOf(next, adjustments);
    if (budgetAfter.cents < 0) throw fieldError(`That would take ${line.code} below zero once its adjustments are applied.`, 'originalBudget');
    validateLineShape(next, lines, projectsService.policyFor(line.projectId).actualsCutoff, budgetAfter.cents, line);

    projectsService.bumpRevision(line.projectId, expectedRevision);
    const updated = writeLineChanges(line, next, actor, now(), reason?.trim() || undefined);
    accessService.record({
      actor: actorName(actor),
      summary: `Cost line updated · ${project.code} · ${line.code}`,
      context: `Fields: ${changedFields.join(', ')}${reason?.trim() ? ` · ${reason.trim()}` : ''}`,
    });
    return updated;
  },

  /** Hide a line from new forecasting. It stays in totals and history (CF03). */
  deactivateCostLine(costLineId: CostLineId, actor: UserId, reason: string): CostLine {
    const line = budgetsService.requireCostLine(costLineId);
    if (!line.active) throw new ConflictError(`${line.code} is already inactive.`);
    if (!reason.trim()) throw fieldError('Give a reason for closing this line.', 'reason', 'A reason is required.');
    const project = projectsService.assertMutable(line.projectId);
    projectsService.bumpRevision(line.projectId);
    const updated = writeLineChanges(line, { ...line, active: false }, actor, now(), reason.trim());
    accessService.record({
      actor: actorName(actor),
      summary: `Cost line closed · ${project.code} · ${line.code}`,
      context: `${reason.trim()} · remains in totals and baselines`,
    });
    return updated;
  },

  /**
   * Move budget between posting lines or change the project total (CST08).
   * A contingency draw comes from the allowance, never exceeds it, and goes to
   * a non-contingency line, so the project total does not move.
   */
  recordAdjustment(input: RecordAdjustmentInput): BudgetAdjustment {
    const project = projectsService.assertMutable(input.projectId);
    if (!Number.isSafeInteger(input.amount.cents) || input.amount.cents <= 0) {
      throw fieldError('Enter an amount greater than zero.', 'amount', 'An adjustment must be greater than zero.');
    }
    if (!input.reason.trim()) throw fieldError('Give a reason for this adjustment.', 'reason', 'A reason is required.');

    const from = input.fromLineId ? requireLineIn(input.projectId, input.fromLineId) : undefined;
    const to = input.toLineId ? requireLineIn(input.projectId, input.toLineId) : undefined;
    for (const line of [from, to]) {
      if (line && line.rowType !== 'posting') throw fieldError(`${line.code} is a summary row; only posting rows carry budget (F02).`, line === from ? 'fromLineId' : 'toLineId');
      if (line && !line.active) throw fieldError(`${line.code} is inactive; reactivate it before moving budget.`, line === from ? 'fromLineId' : 'toLineId');
    }
    switch (input.kind) {
      case 'contingency-draw':
        if (!from || !to) throw fieldError('A contingency draw names the allowance it comes from and the line it goes to.', from ? 'toLineId' : 'fromLineId');
        if (!from.isContingency) throw fieldError(`${from.code} is not a contingency allowance.`, 'fromLineId', 'Draw from a line marked as contingency.');
        if (to.isContingency) throw fieldError('Contingency cannot be drawn onto contingency (CST08).', 'toLineId', 'Choose a line that is not the allowance.');
        break;
      case 'transfer':
        if (!from || !to) throw fieldError('A transfer needs both a source and a target line.', from ? 'toLineId' : 'fromLineId');
        if (from.id === to.id) throw fieldError('Choose two different lines.', 'toLineId');
        break;
      case 'scope-change':
      case 'manual':
        if ((from && to) || (!from && !to)) throw fieldError('A scope change or manual edit names one line: the target to increase it, the source to decrease it.', 'toLineId');
        break;
    }
    if (from) {
      const remaining = currentBudgetOf(from, budgetsRepository.listAdjustments(input.projectId));
      if (input.amount.cents > remaining.cents) {
        const label = from.isContingency ? 'remaining allowance' : 'current budget';
        throw fieldError(`${exGst(input.amount)} exceeds the ${label} of ${from.code} (${exGst(remaining)}).`, 'amount', `At most ${exGst(remaining)} can be moved from ${from.code}.`);
      }
    }

    const revision = projectsService.bumpRevision(input.projectId, input.expectedRevision);
    const adjustment = writeAdjustment({
      projectId: input.projectId,
      kind: input.kind,
      ...(from ? { fromLineId: from.id } : {}),
      ...(to ? { toLineId: to.id } : {}),
      amount: input.amount,
      reason: input.reason.trim(),
      actor: input.actor,
      at: now(),
      revision,
    });
    accessService.record({
      actor: actorName(input.actor),
      summary: `Budget ${input.kind.replace('-', ' ')} · ${project.code} · ${[from?.code, to?.code].filter(Boolean).join(' → ')}`,
      context: `${exGst(input.amount)} · ${input.reason.trim()} · revision ${revision}`,
    });
    return adjustment;
  },

  listAdjustments(projectId: ProjectId): readonly BudgetAdjustment[] {
    return budgetsRepository.listAdjustments(projectId);
  },

  /** Snapshot of every posting line's current budget, for a candidate or a publish. */
  snapshotLines(projectId: ProjectId): BudgetVersion['lines'] {
    const adjustments = budgetsRepository.listAdjustments(projectId);
    return budgetsService.postingLines(projectId).map((line) => ({ costLineId: line.id, amount: currentBudgetOf(line, adjustments) }));
  },

  createBaselineCandidate(input: { readonly projectId: ProjectId; readonly name: string; readonly actor: UserId }): BudgetVersion {
    const project = projectsService.assertMutable(input.projectId);
    if (!input.name.trim()) throw fieldError('Give the baseline a name.', 'name', 'A name is required, e.g. "Baseline 3 · post-variation".');
    const version = budgetsRepository.insertVersion({
      id: asId<'BudgetVersion'>(`bv-${randomUUID()}`),
      projectId: input.projectId,
      name: input.name.trim(),
      state: 'draft',
      lines: budgetsService.snapshotLines(input.projectId),
      createdAt: now(),
      createdBy: input.actor,
      sourceRevision: project.modelRevision,
    });
    accessService.record({
      actor: actorName(input.actor),
      summary: `Baseline candidate created · ${project.code} · ${version.name}`,
      context: `${version.lines.length} posting lines · from revision ${version.sourceRevision}`,
    });
    return version;
  },

  /**
   * Publish a candidate (PRJ05). The snapshot is taken now, the previously
   * published baseline becomes superseded, and nothing is ever edited or
   * deleted afterwards (AT02).
   */
  publishBaseline(input: { readonly baselineId: BudgetVersionId; readonly actor: UserId; readonly reason: string }): BudgetVersion {
    const version = budgetsRepository.findVersion(input.baselineId);
    if (!version) throw new NotFoundError('Baseline', input.baselineId);
    if (version.state !== 'draft') {
      throw new ConflictError(`${version.name} is already ${version.state}; a published baseline is never edited. Create a new candidate instead (PRJ05).`);
    }
    if (!input.reason.trim()) throw fieldError('Give a reason for publishing this baseline.', 'reason', 'A reason is required, e.g. "Post-tender rebaseline".');
    const project = projectsService.assertMutable(version.projectId);
    const previous = budgetsService.selectedBaseline(version.projectId);
    if (previous) budgetsRepository.updateVersion(previous.id, { state: 'superseded' });
    const published = budgetsRepository.updateVersion(version.id, {
      state: 'published',
      lines: budgetsService.snapshotLines(version.projectId),
      approvedBy: input.actor,
      approvedAt: now(),
      reason: input.reason.trim(),
      sourceRevision: project.modelRevision,
    });
    if (!published) throw new NotFoundError('Baseline', input.baselineId);
    accessService.record({
      actor: actorName(input.actor),
      summary: `Baseline published · ${project.code} · ${published.name}`,
      context: `${input.reason.trim()} · ${exGst(sumMoney(published.lines.map((entry) => entry.amount)))} · revision ${published.sourceRevision}${previous ? ` · supersedes ${previous.name}` : ''}`,
    });
    return published;
  },

  /** Validate a batch without writing it: what would change and what to expect. */
  previewForecastBatch(input: { readonly projectId: ProjectId; readonly edits: readonly ForecastEdit[] }): {
    readonly edits: readonly ForecastEdit[];
    readonly warnings: readonly string[];
    readonly affectedLines: number;
  } {
    projectsService.require(input.projectId);
    const plan = planBatch(input.projectId, input.edits);
    return { edits: input.edits, warnings: plan.warnings, affectedLines: plan.items.length };
  },

  /**
   * Save several line edits together against the revision the editor saw
   * (CF07). Everything is validated first; if anything fails nothing is
   * written. A stale revision is a conflict carrying the latest values.
   */
  applyForecastBatch(input: {
    readonly projectId: ProjectId;
    readonly actor: UserId;
    readonly expectedRevision: number;
    readonly edits: readonly ForecastEdit[];
  }): ForecastBatch {
    const project = projectsService.assertMutable(input.projectId);
    if (!Number.isInteger(input.expectedRevision)) throw fieldError('Say which model revision you edited against.', 'revision');
    if (input.expectedRevision !== project.modelRevision) {
      throw conflictFor(input.projectId, input.expectedRevision, project.modelRevision, input.edits);
    }
    const plan = planBatch(input.projectId, input.edits);
    if (plan.items.length === 0) throw new ValidationError('Nothing in this batch changes a line.', { fieldErrors: { edits: ['Every edit matched what is already stored.'] } });

    const revisionAfter = projectsService.bumpRevision(input.projectId, input.expectedRevision);
    const at = now();
    const batchId = asId<'ForecastBatch'>(`fb-${randomUUID()}`);
    const changes: ForecastBatchChange[] = [];
    for (const item of plan.items) {
      const delta = item.budgetAfter.cents - item.budgetBefore.cents;
      if (delta !== 0) {
        writeAdjustment({
          projectId: input.projectId,
          kind: 'manual',
          ...(delta > 0 ? { toLineId: item.line.id } : { fromLineId: item.line.id }),
          amount: money(Math.abs(delta), item.budgetAfter.currency),
          reason: item.reason ?? 'Forecast batch',
          actor: input.actor,
          at,
          revision: revisionAfter,
        });
      }
      writeLineChanges(item.line, item.next, input.actor, at, item.reason);
      changes.push(...item.changes);
    }
    const batch = budgetsRepository.insertBatch({
      id: batchId,
      projectId: input.projectId,
      actor: input.actor,
      at,
      revisionBefore: input.expectedRevision,
      revisionAfter,
      changes,
    });
    accessService.record({
      actor: actorName(input.actor),
      summary: `Forecast batch saved · ${project.code} · ${plan.items.length} line${plan.items.length === 1 ? '' : 's'}`,
      context: `Revision ${input.expectedRevision} → ${revisionAfter} · ${plan.items.map((item) => item.line.code).join(', ')}`,
    });
    return batch;
  },

  /** Whether `actor` may undo the project's latest batch, and if not, why (CF09). */
  undoEligibility(projectId: ProjectId, actor: UserId): UndoEligibility {
    const batches = budgetsRepository.listBatches(projectId);
    const latest = batches[batches.length - 1];
    if (!latest) return { batch: null, reason: 'There is no forecast batch to undo.' };
    if (latest.compensatesBatchId) return { batch: null, reason: 'The latest change is already an undo; nothing further can be reversed.' };
    if (latest.undoneByBatchId) return { batch: null, reason: 'The latest batch has already been undone.' };
    if (latest.actor !== actor) return { batch: null, reason: `Only ${actorName(latest.actor)} can undo their own batch.` };
    const shared = budgetsRepository.listVersions(projectId).some((version) => version.approvedAt !== undefined && version.approvedAt >= latest.at);
    if (shared) return { batch: null, reason: 'A baseline was published after this batch, so it is part of shared history. Record a new change instead.' };
    return { batch: latest, reason: null };
  },

  /**
   * Reverse the author's latest batch with a compensating batch (CF09). The
   * original batch stays; it is marked as undone and the audit trail shows
   * both.
   */
  undoLatestBatch(projectId: ProjectId, actor: UserId): ForecastBatch {
    const project = projectsService.assertMutable(projectId);
    const eligibility = budgetsService.undoEligibility(projectId, actor);
    if (!eligibility.batch) throw new ConflictError(eligibility.reason ?? 'This batch cannot be undone.');
    const batch = eligibility.batch;
    const adjustments = budgetsRepository.listAdjustments(projectId);

    // Everything is checked before anything is written.
    const plan = batch.changes.map((change) => {
      const line = requireLineIn(projectId, change.costLineId);
      if (change.field === 'budget') {
        const before = change.before as Money;
        const after = change.after as Money;
        const delta = after.cents - before.cents;
        const current = currentBudgetOf(line, adjustments);
        if (current.cents - delta < 0) {
          throw new ConflictError(`Undoing would take ${line.code} below zero because budget has since been moved away. Record a new change instead.`);
        }
        return { line, change, delta };
      }
      return { line, change, delta: 0 };
    });

    const revisionAfter = projectsService.bumpRevision(projectId);
    const at = now();
    const undoId = asId<'ForecastBatch'>(`fb-${randomUUID()}`);
    const reversed: ForecastBatchChange[] = [];
    const byLine = new Map<CostLineId, Partial<CostLine>>();
    for (const item of plan) {
      if (item.change.field === 'budget') {
        writeAdjustment({
          projectId,
          kind: 'manual',
          ...(item.delta > 0 ? { fromLineId: item.line.id } : { toLineId: item.line.id }),
          amount: money(Math.abs(item.delta), item.line.originalBudget.currency),
          reason: `Undo of batch ${batch.id}`,
          actor,
          at,
          revision: revisionAfter,
        });
      } else {
        const fields = byLine.get(item.line.id) ?? {};
        byLine.set(item.line.id, { ...fields, [item.change.field]: item.change.before === null ? undefined : item.change.before });
      }
      reversed.push({ costLineId: item.line.id, field: item.change.field, before: item.change.after, after: item.change.before });
    }
    for (const [lineId, fields] of byLine) {
      const line = budgetsService.requireCostLine(lineId);
      const next: CostLine = { ...line, ...fields };
      for (const key of ['milestoneId'] as const) {
        if (next[key] === undefined) delete (next as { milestoneId?: MilestoneId })[key];
      }
      writeLineChanges(line, next, actor, at, `Undo of batch ${batch.id}`);
    }
    const undo = budgetsRepository.insertBatch({
      id: undoId,
      projectId,
      actor,
      at,
      revisionBefore: revisionAfter - 1,
      revisionAfter,
      changes: reversed,
      compensatesBatchId: batch.id,
    });
    budgetsRepository.updateBatch(batch.id, { undoneByBatchId: undoId });
    accessService.record({
      actor: actorName(actor),
      summary: `Forecast batch undone · ${project.code}`,
      context: `Compensates ${batch.id} · ${reversed.length} change${reversed.length === 1 ? '' : 's'} reversed · revision ${revisionAfter}`,
    });
    return undo;
  },

  listBatches(projectId: ProjectId): readonly ForecastBatch[] {
    return budgetsRepository.listBatches(projectId);
  },

  /**
   * Spread `remainingCents` over time by the line's method (CF04), then move
   * anything dated in a closed period to the first open month (CF06). Pure:
   * no storage reads, so the project model can call it for any basis.
   */
  lineSchedule(costLine: CostLine, remainingCents: number, context: ScheduleContext): LineScheduleResult {
    if (remainingCents === 0 || costLine.rowType !== 'posting') return { entries: [], shifted: 0 };
    const { cutoff } = context;
    const fallback = firstOpenDate(cutoff);
    const schedule = costLine.schedule;
    let shifted = 0;
    let raw: readonly { readonly date: IsoDate; readonly cents: number }[];

    try {
      switch (costLine.forecastMethod) {
        case 'one-off': {
          const date = schedule.oneOffDate ?? fallback;
          if (!schedule.oneOffDate) shifted += 1;
          raw = distributeOneOff(remainingCents, date);
          break;
        }
        case 'equal-monthly':
          raw = distributeEqualMonthly(remainingCents, schedule.startMonth ?? monthKeyOf(fallback), schedule.months ?? 1);
          break;
        case 'weighted-monthly':
          raw = distributeWeighted(remainingCents, schedule.weights ?? []);
          break;
        case 'milestone-linked': {
          const date = context.milestoneDate ?? schedule.oneOffDate ?? fallback;
          if (!context.milestoneDate) shifted += 1;
          raw = distributeMilestoneLinked(remainingCents, date, schedule.milestoneOffsetDays ?? 0);
          break;
        }
        case 'manual': {
          const entries = schedule.manual ?? [];
          const open = entries.filter((entry) => entry.date > cutoff);
          const base = open.length > 0 ? open : entries;
          if (base.length === 0) {
            shifted += 1;
            raw = distributeOneOff(remainingCents, fallback);
            break;
          }
          const positive = base.map((entry) => Math.max(entry.cents, 0));
          const weights = positive.some((cents) => cents > 0) ? positive : base.map(() => 1);
          const parts = allocateResidualToLast(remainingCents, weights);
          raw = base.map((entry, index) => ({ date: entry.date, cents: parts[index] ?? 0 }));
          break;
        }
      }
    } catch (error) {
      if (error instanceof RangeError || error instanceof TypeError) throw new ValidationError(`${costLine.code}: ${error.message}`);
      throw error;
    }

    const totals = new Map<IsoDate, number>();
    for (const entry of raw) {
      const date = entry.date <= cutoff ? fallback : entry.date;
      if (entry.date <= cutoff) shifted += 1;
      totals.set(date, (totals.get(date) ?? 0) + entry.cents);
    }
    const entries = [...totals.entries()].map(([date, cents]) => ({ date, cents })).sort((a, b) => a.date.localeCompare(b.date));
    return { entries, shifted };
  },

  /**
   * Copy a register into another project (PRJ04). Structure is categories
   * and lines with their codes; assumptions are budgets and schedules. New
   * ids throughout; adjustments, baselines and batches are never copied
   * because they are this project's history, not the next one's facts.
   */
  cloneInto(sourceProjectId: ProjectId, targetProjectId: ProjectId, options: CloneOptions, actor: UserId): void {
    const source = projectsService.require(sourceProjectId);
    const target = projectsService.assertMutable(targetProjectId);
    if (sourceProjectId === targetProjectId) throw new ValidationError('Choose a different project to clone into.');
    if (!options.structure && !options.assumptions) throw new ValidationError('Choose structure, assumptions or both.');

    const at = now();
    const adjustments = budgetsRepository.listAdjustments(sourceProjectId);
    const sourceCategories = budgetsRepository.listCategories(sourceProjectId);
    const sourceLines = budgetsRepository.listCostLines(sourceProjectId);
    const categoryMap = new Map<CostCategoryId, CostCategoryId>();
    const lineMap = new Map<CostLineId, CostLineId>();
    const label = options.structure && options.assumptions ? 'structure and assumptions' : options.structure ? 'structure only' : 'assumptions only';

    for (const category of sourceCategories) {
      const existing = budgetsRepository.findCategoryByCode(targetProjectId, category.code);
      if (existing) {
        categoryMap.set(category.id, existing.id);
        continue;
      }
      if (!options.structure) continue;
      const created = budgetsRepository.insertCategory({
        id: asId<'CostCategory'>(`cc-${randomUUID()}`),
        projectId: targetProjectId,
        code: category.code,
        name: category.name,
        sortOrder: category.sortOrder,
      });
      categoryMap.set(category.id, created.id);
    }
    for (const category of sourceCategories) {
      const mapped = categoryMap.get(category.id);
      const parent = category.parentId ? categoryMap.get(category.parentId) : undefined;
      if (mapped && parent && budgetsRepository.findCategory(mapped)?.parentId !== parent) budgetsRepository.updateCategory(mapped, { parentId: parent });
    }

    const defaultSchedule: ForecastSchedule = { startMonth: monthKeyOf(target.startDate), months: target.forecastHorizonMonths };
    const assumptionsOf = (line: CostLine): Pick<CostLine, 'inputMode' | 'quantity' | 'rate' | 'originalBudget' | 'forecastMethod' | 'schedule' | 'timingMode' | 'milestoneId'> => {
      const current = currentBudgetOf(line, adjustments);
      const keepQuantity = line.inputMode === 'quantity-rate' && current.cents === line.originalBudget.cents && line.quantity !== undefined && line.rate !== undefined;
      const milestoneId = line.milestoneId ? (options.milestoneMap?.get(line.milestoneId) ?? line.milestoneId) : undefined;
      return {
        inputMode: keepQuantity ? 'quantity-rate' : 'direct',
        ...(keepQuantity ? { quantity: line.quantity, rate: line.rate } : {}),
        originalBudget: line.rowType === 'summary' ? money(0) : current,
        forecastMethod: line.forecastMethod,
        schedule: line.schedule,
        timingMode: line.timingMode,
        ...(milestoneId ? { milestoneId } : {}),
      };
    };

    for (const line of sourceLines) {
      const existing = budgetsRepository.findCostLineByCode(targetProjectId, line.code);
      if (existing) {
        lineMap.set(line.id, existing.id);
        if (options.assumptions && existing.rowType === 'posting') {
          writeLineChanges(existing, { ...existing, ...assumptionsOf(line) }, actor, at, `Assumptions cloned from ${source.code}`);
        }
        continue;
      }
      if (!options.structure) continue;
      const categoryId = categoryMap.get(line.categoryId);
      if (!categoryId) continue;
      const created = budgetsRepository.insertCostLine({
        id: asId<'CostLine'>(`cl-${randomUUID()}`),
        projectId: targetProjectId,
        categoryId,
        code: line.code,
        title: line.title,
        ...(line.description ? { description: line.description } : {}),
        rowType: line.rowType,
        ...(line.unit ? { unit: line.unit } : {}),
        taxTreatment: line.taxTreatment,
        recoverablePpm: line.recoverablePpm,
        ...(line.responsibleUserId ? { responsibleUserId: line.responsibleUserId } : {}),
        active: line.active,
        isContingency: line.isContingency,
        sortOrder: line.sortOrder,
        ...(options.assumptions
          ? assumptionsOf(line)
          : {
              inputMode: 'direct' as const,
              originalBudget: money(0),
              forecastMethod: line.rowType === 'summary' ? ('manual' as const) : ('equal-monthly' as const),
              schedule: line.rowType === 'summary' ? { manual: [] } : defaultSchedule,
              timingMode: line.rowType === 'summary' ? ('manual' as const) : ('fixed-date' as const),
            }),
        history: [{ at, actor, field: 'created', before: null, after: { clonedFrom: source.code, mode: label } }],
        createdAt: at,
      });
      lineMap.set(line.id, created.id);
    }
    for (const line of sourceLines) {
      const mapped = lineMap.get(line.id);
      const parent = line.parentLineId ? lineMap.get(line.parentLineId) : undefined;
      if (mapped && parent && budgetsRepository.findCostLine(mapped)?.parentLineId !== parent) budgetsRepository.updateCostLine(mapped, { parentLineId: parent });
    }

    projectsService.bumpRevision(targetProjectId);
    accessService.record({
      actor: actorName(actor),
      summary: `Cost register cloned · ${source.code} → ${target.code}`,
      context: `${label} · ${lineMap.size} lines · adjustments, baselines and batches not copied (PRJ04)`,
    });
  },
};
