/**
 * Development Finance — budgets: categories, cost lines, contingency,
 * baselines, forecast batches and schedules (CST01, CST02, CST08, CF03, CF04,
 * CF06, CF07, CF09, PRJ04, PRJ05; F02, AT02).
 *
 * Every amount is ex GST. Expected figures are hand-derived from the seed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { accessService } from '@/modules/access/service';
import { USER_IDS } from '@/modules/access/data/seed';
import { projectsService } from '@/modules/projects/service';
import { projectsRepository } from '@/modules/projects/repository';
import { LEGAL_ENTITY_IDS, PROJECT_IDS } from '@/modules/projects/data/seed';
import { budgetsService } from '@/modules/budgets/service';
import { budgetsApi } from '@/modules/budgets/api';
import { budgetsRepository } from '@/modules/budgets/repository';
import { BUDGET_VERSION_IDS, COST_CATEGORY_IDS, COST_LINE_IDS } from '@/modules/budgets/data/seed';
import { createCostLineAction, recordAdjustmentAction } from '@/modules/budgets/actions';
import type { CostLine } from '@/modules/budgets/model';
import { fromMajorUnits, money, sumMoney } from '@/shared/lib/money';
import { asId } from '@/shared/types/common';
import { ConflictError, ForbiddenError, ValidationError } from '@/shared/lib/errors';
import { IDLE_RESULT, type ActionResult } from '@/shared/lib/action-result';

const idle = IDLE_RESULT as ActionResult<unknown>;
const RIVERSIDE = PROJECT_IDS.riverside;
const CUTOFF = '2026-08-31';

function formOf(fields: Record<string, string>): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  return form;
}

function projectTotal(): number {
  return sumMoney([...budgetsService.currentBudgetByLine(RIVERSIDE).values()]).cents;
}

function revision(): number {
  return projectsService.require(RIVERSIDE).modelRevision;
}

function caught(work: () => unknown): unknown {
  try {
    work();
  } catch (error) {
    return error;
  }
  throw new Error('expected an error');
}

beforeEach(() => {
  projectsRepository.reset();
  budgetsRepository.reset();
});
afterEach(() => accessService.switchUser(USER_IDS.jawad));

describe('CST01 / seed', () => {
  it('seeds the ten configurable categories and stable ids', () => {
    expect(budgetsService.listCategories(RIVERSIDE).map((category) => category.code)).toEqual([
      'ACQ', 'HOLD', 'PROF', 'CON', 'STAT', 'MKT', 'COMM', 'OPEX', 'CONT', 'FIN',
    ]);
    expect(COST_LINE_IDS.con01).toBe('cl-riverside-con-01');
    expect(COST_CATEGORY_IDS.con).toBe('cc-riverside-con');
    expect(budgetsService.currentBudget(COST_LINE_IDS.con01).cents).toBe(312_000_000);
    expect(budgetsService.currentBudget(COST_LINE_IDS.con02).cents).toBe(25_800_000);
    expect(budgetsService.currentBudget(COST_LINE_IDS.cont01).cents).toBe(13_200_000);
    expect(budgetsService.selectedBaseline(RIVERSIDE)?.id).toBe(BUDGET_VERSION_IDS.postTender);
  });
});

describe('CF03 / F02 · posting rows only', () => {
  it('the land acquisition parent never double counts', () => {
    const posting = budgetsService.postingLines(RIVERSIDE);
    expect(posting.some((line) => line.code === 'ACQ-00')).toBe(false);
    const acq = posting.filter((line) => line.categoryId === COST_CATEGORY_IDS.acq);
    const byLine = budgetsService.currentBudgetByLine(RIVERSIDE);
    expect(sumMoney(acq.map((line) => byLine.get(line.id)!)).cents).toBe(187_200_000);
    // The summary reports its children (deposit + settlement), never its own amount.
    expect(budgetsService.currentBudget(COST_LINE_IDS.acq00).cents).toBe(180_000_000);
    expect(byLine.has(COST_LINE_IDS.acq00)).toBe(false);
  });

  it('inactive lines stay in the list and in totals by default', () => {
    const before = projectTotal();
    budgetsService.deactivateCostLine(COST_LINE_IDS.opex01, USER_IDS.jawad, 'Not needed');
    expect(budgetsService.listCostLines(RIVERSIDE).some((line) => line.id === COST_LINE_IDS.opex01)).toBe(true);
    expect(budgetsService.listCostLines(RIVERSIDE, { includeInactive: false }).some((line) => line.id === COST_LINE_IDS.opex01)).toBe(false);
    expect(projectTotal()).toBe(before);
  });
});

describe('CST02 · quantity × rate', () => {
  it('computes exactly and keeps the input mode in history', () => {
    const line = budgetsService.createCostLine({
      projectId: RIVERSIDE,
      categoryId: COST_CATEGORY_IDS.con,
      code: 'con-04',
      title: 'Driveway crossovers',
      rowType: 'posting',
      inputMode: 'quantity-rate',
      quantity: 8.3333,
      unit: 'each',
      rate: money(333_333), // $3,333.33
      taxTreatment: 'standard-gst',
      recoverablePpm: 1_000_000,
      forecastMethod: 'one-off',
      schedule: { oneOffDate: '2027-11-15' },
      actor: USER_IDS.jawad,
    });
    // 333_333 × 83_333 / 10_000 = 2_777_763.9... → 2_777_764 cents, no float dollars.
    expect(line.originalBudget.cents).toBe(2_777_764);
    expect(line.code).toBe('CON-04');
    expect(line.history[0]?.after).toMatchObject({ inputMode: 'quantity-rate', quantity: 8.3333 });
  });

  it('refuses a direct amount alongside quantity × rate', () => {
    expect(() =>
      budgetsService.createCostLine({
        projectId: RIVERSIDE,
        categoryId: COST_CATEGORY_IDS.con,
        code: 'CON-05',
        title: 'Both',
        rowType: 'posting',
        inputMode: 'quantity-rate',
        quantity: 2,
        rate: fromMajorUnits(100),
        originalBudget: fromMajorUnits(500),
        taxTreatment: 'standard-gst',
        recoverablePpm: 1_000_000,
        forecastMethod: 'one-off',
        schedule: { oneOffDate: '2027-11-15' },
        actor: USER_IDS.jawad,
      }),
    ).toThrow(/not both/);
    expect(() =>
      budgetsService.createCostLine({
        projectId: RIVERSIDE,
        categoryId: COST_CATEGORY_IDS.con,
        code: 'CON-06',
        title: 'Direct with rate',
        rowType: 'posting',
        inputMode: 'direct',
        rate: fromMajorUnits(100),
        originalBudget: fromMajorUnits(500),
        taxTreatment: 'standard-gst',
        recoverablePpm: 1_000_000,
        forecastMethod: 'one-off',
        schedule: { oneOffDate: '2027-11-15' },
        actor: USER_IDS.jawad,
      }),
    ).toThrow(ValidationError);
  });
});

describe('CST08 · contingency', () => {
  it('a draw moves budget onto the target and keeps the project total', () => {
    const total = projectTotal();
    budgetsService.recordAdjustment({
      projectId: RIVERSIDE,
      kind: 'contingency-draw',
      fromLineId: COST_LINE_IDS.cont01,
      toLineId: COST_LINE_IDS.con03,
      amount: fromMajorUnits(12_000),
      reason: 'Retaining wall',
      actor: USER_IDS.mahvish,
    });
    expect(budgetsService.currentBudget(COST_LINE_IDS.cont01).cents).toBe(12_000_000);
    expect(budgetsService.currentBudget(COST_LINE_IDS.con03).cents).toBe(9_800_000);
    expect(projectTotal()).toBe(total);
  });

  it('refuses a draw beyond the remaining allowance, and from a non-contingency line', () => {
    const before = budgetsService.listAdjustments(RIVERSIDE).length;
    expect(() =>
      budgetsService.recordAdjustment({
        projectId: RIVERSIDE,
        kind: 'contingency-draw',
        fromLineId: COST_LINE_IDS.cont01,
        toLineId: COST_LINE_IDS.con01,
        amount: fromMajorUnits(132_000.01),
        reason: 'Too much',
        actor: USER_IDS.jawad,
      }),
    ).toThrow(/exceeds the remaining allowance/);
    expect(() =>
      budgetsService.recordAdjustment({
        projectId: RIVERSIDE,
        kind: 'contingency-draw',
        fromLineId: COST_LINE_IDS.con02,
        toLineId: COST_LINE_IDS.con01,
        amount: fromMajorUnits(1),
        reason: 'Wrong source',
        actor: USER_IDS.jawad,
      }),
    ).toThrow(/not a contingency/);
    expect(budgetsService.listAdjustments(RIVERSIDE)).toHaveLength(before);
  });
});

describe('PRJ05 / AT02 · baselines', () => {
  it('publishing supersedes without editing; later changes never touch a baseline', () => {
    const candidate = budgetsService.createBaselineCandidate({ projectId: RIVERSIDE, name: 'Baseline 3 · test', actor: USER_IDS.jawad });
    expect(() => budgetsService.publishBaseline({ baselineId: candidate.id, actor: USER_IDS.jawad, reason: ' ' })).toThrow(ValidationError);
    const published = budgetsService.publishBaseline({ baselineId: candidate.id, actor: USER_IDS.jawad, reason: 'Quarterly rebaseline' });
    expect(published.state).toBe('published');
    expect(published.approvedBy).toBe(USER_IDS.jawad);
    expect(published.sourceRevision).toBe(revision());

    budgetsService.recordAdjustment({
      projectId: RIVERSIDE,
      kind: 'scope-change',
      toLineId: COST_LINE_IDS.con01,
      amount: fromMajorUnits(50_000),
      reason: 'Extra scope',
      actor: USER_IDS.jawad,
    });
    expect(budgetsService.currentBudget(COST_LINE_IDS.con01).cents).toBe(317_000_000);
    expect(budgetsService.baselineAmount(COST_LINE_IDS.con01)?.cents).toBe(312_000_000);

    const versions = budgetsService.listBaselines(RIVERSIDE);
    const first = versions.find((version) => version.id === BUDGET_VERSION_IDS.feasibility)!;
    expect(first.state).toBe('superseded');
    expect(budgetsService.baselineAmount(COST_LINE_IDS.con01, first)?.cents).toBe(298_000_000);
    expect(versions.find((version) => version.id === BUDGET_VERSION_IDS.postTender)?.state).toBe('superseded');
    expect(() => budgetsService.publishBaseline({ baselineId: BUDGET_VERSION_IDS.feasibility, actor: USER_IDS.jawad, reason: 'again' })).toThrow(ConflictError);
  });
});

describe('CF07 · batches and concurrency', () => {
  it('a stale revision is a conflict carrying the latest stored values', () => {
    const seen = revision();
    budgetsService.applyForecastBatch({
      projectId: RIVERSIDE,
      actor: USER_IDS.jawad,
      expectedRevision: seen,
      edits: [{ costLineId: COST_LINE_IDS.con03, budget: fromMajorUnits(90_000), reason: 'Quote received' }],
    });
    const error = caught(() =>
      budgetsService.applyForecastBatch({
        projectId: RIVERSIDE,
        actor: USER_IDS.mahvish,
        expectedRevision: seen,
        edits: [{ costLineId: COST_LINE_IDS.con03, budget: fromMajorUnits(80_000), reason: 'Mine' }],
      }),
    ) as ConflictError;
    expect(error).toBeInstanceOf(ConflictError);
    const details = error.details as { yourRevision: number; latestRevision: number; latest: { costLineId: string; budget: { cents: number } }[] };
    expect(details.yourRevision).toBe(seen);
    expect(details.latestRevision).toBe(seen + 1);
    expect(details.latest[0]).toMatchObject({ costLineId: COST_LINE_IDS.con03, budget: { cents: 9_000_000 } });
    expect(budgetsService.currentBudget(COST_LINE_IDS.con03).cents).toBe(9_000_000);
  });

  it('is all or nothing: one bad edit writes nothing', () => {
    const seen = revision();
    const adjustments = budgetsService.listAdjustments(RIVERSIDE).length;
    const error = caught(() =>
      budgetsService.applyForecastBatch({
        projectId: RIVERSIDE,
        actor: USER_IDS.jawad,
        expectedRevision: seen,
        edits: [
          { costLineId: COST_LINE_IDS.con03, budget: fromMajorUnits(90_000), reason: 'Fine' },
          { costLineId: COST_LINE_IDS.con02, schedule: { weights: [{ month: '2027-02', weightPpm: 500_000 }, { month: '2027-03', weightPpm: 400_000 }] } },
        ],
      }),
    );
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as Error).message).toMatch(/total 100%/);
    expect(budgetsService.currentBudget(COST_LINE_IDS.con03).cents).toBe(8_600_000);
    expect(budgetsService.listAdjustments(RIVERSIDE)).toHaveLength(adjustments);
    expect(revision()).toBe(seen);
  });

  it('refuses a schedule month inside the locked period, naming the field', () => {
    const error = caught(() =>
      budgetsService.applyForecastBatch({
        projectId: RIVERSIDE,
        actor: USER_IDS.jawad,
        expectedRevision: revision(),
        edits: [{ costLineId: COST_LINE_IDS.stat02, schedule: { oneOffDate: '2026-08-15' } }],
      }),
    ) as ValidationError;
    expect(error).toBeInstanceOf(ValidationError);
    expect((error.details as { fieldErrors: Record<string, string[]> }).fieldErrors['schedule.oneOffDate']).toBeDefined();
  });

  it('a budget edit needs a reason and becomes a manual adjustment; the revision bumps once', () => {
    const seen = revision();
    expect(() =>
      budgetsService.applyForecastBatch({ projectId: RIVERSIDE, actor: USER_IDS.jawad, expectedRevision: seen, edits: [{ costLineId: COST_LINE_IDS.mkt01, budget: fromMajorUnits(70_000) }] }),
    ).toThrow(/reason/);
    const batch = budgetsService.applyForecastBatch({
      projectId: RIVERSIDE,
      actor: USER_IDS.jawad,
      expectedRevision: seen,
      edits: [
        { costLineId: COST_LINE_IDS.mkt01, budget: fromMajorUnits(70_000), reason: 'Display suite' },
        { costLineId: COST_LINE_IDS.hold02, budget: fromMajorUnits(25_000), reason: 'Cheaper policy' },
      ],
    });
    expect(batch.revisionAfter).toBe(seen + 1);
    expect(revision()).toBe(seen + 1);
    const manual = budgetsService.listAdjustments(RIVERSIDE).filter((adjustment) => adjustment.kind === 'manual');
    expect(manual).toHaveLength(2);
    expect(manual.find((adjustment) => adjustment.fromLineId === COST_LINE_IDS.hold02)?.amount.cents).toBe(300_000);
  });
});

describe('CF09 · undo', () => {
  it('compensates the author’s latest batch; another actor and a second undo are refused', () => {
    const originalSchedule = budgetsService.requireCostLine(COST_LINE_IDS.stat02).schedule;
    budgetsService.applyForecastBatch({
      projectId: RIVERSIDE,
      actor: USER_IDS.jawad,
      expectedRevision: revision(),
      edits: [
        { costLineId: COST_LINE_IDS.con03, budget: fromMajorUnits(95_000), reason: 'Quote' },
        { costLineId: COST_LINE_IDS.stat02, schedule: { oneOffDate: '2027-01-15' } },
      ],
    });
    expect(() => budgetsService.undoLatestBatch(RIVERSIDE, USER_IDS.mahvish)).toThrow(ConflictError);

    const undo = budgetsService.undoLatestBatch(RIVERSIDE, USER_IDS.jawad);
    expect(undo.compensatesBatchId).toBeDefined();
    expect(budgetsService.currentBudget(COST_LINE_IDS.con03).cents).toBe(8_600_000);
    expect(budgetsService.requireCostLine(COST_LINE_IDS.stat02).schedule).toEqual(originalSchedule);
    const batches = budgetsService.listBatches(RIVERSIDE);
    expect(batches.find((batch) => batch.id === undo.compensatesBatchId)?.undoneByBatchId).toBe(undo.id);
    // Nothing was deleted: the original batch and its adjustment remain.
    expect(batches).toHaveLength(3);
    expect(() => budgetsService.undoLatestBatch(RIVERSIDE, USER_IDS.jawad)).toThrow(ConflictError);
  });
});

describe('CF04 / CF06 · lineSchedule', () => {
  const base = (): CostLine => budgetsService.requireCostLine(COST_LINE_IDS.con02);

  it('weights must total 100% and the residual lands on the last period', () => {
    const bad: CostLine = { ...base(), schedule: { weights: [{ month: '2027-02', weightPpm: 900_000 }] } };
    expect(() => budgetsService.lineSchedule(bad, 1000, { cutoff: CUTOFF })).toThrow(ValidationError);

    const equal: CostLine = { ...base(), forecastMethod: 'equal-monthly', timingMode: 'fixed-date', schedule: { startMonth: '2027-01', months: 3 } };
    expect(budgetsService.lineSchedule(equal, 100, { cutoff: CUTOFF }).entries.map((entry) => entry.cents)).toEqual([33, 33, 34]);
  });

  it('moves locked months to the first open month and counts them', () => {
    const line: CostLine = { ...base(), forecastMethod: 'equal-monthly', timingMode: 'fixed-date', schedule: { startMonth: '2026-07', months: 4 } };
    const result = budgetsService.lineSchedule(line, 400, { cutoff: CUTOFF });
    expect(result.entries).toEqual([
      { date: '2026-09-15', cents: 300 },
      { date: '2026-10-15', cents: 100 },
    ]);
    expect(result.shifted).toBe(2);

    const past: CostLine = { ...line, schedule: { startMonth: '2026-05', months: 2 } };
    const allPast = budgetsService.lineSchedule(past, 500, { cutoff: CUTOFF });
    expect(allPast.entries).toEqual([{ date: '2026-09-15', cents: 500 }]);
    expect(allPast.shifted).toBe(2);
  });

  it('prorates a manual schedule over the entries after the cutoff', () => {
    const line: CostLine = {
      ...base(),
      forecastMethod: 'manual',
      timingMode: 'manual',
      schedule: { manual: [{ date: '2026-08-15', cents: 5000 }, { date: '2026-10-15', cents: 1000 }, { date: '2026-11-15', cents: 3000 }] },
    };
    expect(budgetsService.lineSchedule(line, 1000, { cutoff: CUTOFF })).toEqual({
      entries: [
        { date: '2026-10-15', cents: 250 },
        { date: '2026-11-15', cents: 750 },
      ],
      shifted: 0,
    });
  });

  it('a milestone-linked line follows the resolver date, and says when it had to guess', () => {
    const line: CostLine = {
      ...base(),
      forecastMethod: 'milestone-linked',
      timingMode: 'milestone-offset',
      milestoneId: asId<'Milestone'>('ms-practical-completion'),
      schedule: { milestoneOffsetDays: 10 },
    };
    expect(budgetsService.lineSchedule(line, 700, { cutoff: CUTOFF, milestoneDate: '2027-03-01' })).toEqual({
      entries: [{ date: '2027-03-11', cents: 700 }],
      shifted: 0,
    });
    const guessed = budgetsService.lineSchedule(line, 700, { cutoff: CUTOFF });
    expect(guessed.shifted).toBe(1);
    expect(guessed.entries[0]?.date).toBe('2026-09-25');
  });
});

describe('PRJ04 · cloneInto', () => {
  it('structure only copies codes with zero budgets and no history', () => {
    const target = projectsService.createProject({
      code: 'CLN-01',
      name: 'Clone target',
      legalEntityId: LEGAL_ENTITY_IDS.esteem,
      type: 'townhouses',
      address: '3 Test St',
      state: 'QLD',
      startDate: '2027-01-01',
      expectedCompletion: '2028-12-31',
      forecastHorizonMonths: 24,
      reportingBasis: 'accrual',
      actor: USER_IDS.jawad,
    });
    budgetsService.cloneInto(RIVERSIDE, target.id, { structure: true, assumptions: false }, USER_IDS.jawad);
    const lines = budgetsService.listCostLines(target.id);
    expect(lines.map((line) => line.code)).toEqual(budgetsService.listCostLines(RIVERSIDE).map((line) => line.code));
    expect(lines.every((line) => line.originalBudget.cents === 0)).toBe(true);
    expect(lines.some((line) => line.id === COST_LINE_IDS.con01)).toBe(false);
    expect(lines.find((line) => line.code === 'ACQ-01')?.parentLineId).toBe(lines.find((line) => line.code === 'ACQ-00')?.id);
    expect(budgetsService.listBaselines(target.id)).toEqual([]);
    expect(budgetsService.listAdjustments(target.id)).toEqual([]);
    expect(budgetsService.listBatches(target.id)).toEqual([]);

    budgetsService.cloneInto(RIVERSIDE, target.id, { structure: false, assumptions: true }, USER_IDS.jawad);
    const con01 = budgetsService.listCostLines(target.id).find((line) => line.code === 'CON-01')!;
    expect(budgetsService.currentBudget(con01.id).cents).toBe(312_000_000);
    expect(budgetsService.listAdjustments(target.id)).toEqual([]);
  });
});

describe('Permissions and actions', () => {
  it('an investor is forbidden from the cost register', () => {
    accessService.switchUser(USER_IDS.hassan);
    expect(() => budgetsApi.listCostLines(RIVERSIDE, {})).toThrow(ForbiddenError);
  });

  it('a finance officer without the financial-fields grant cannot save a batch', () => {
    accessService.switchUser(USER_IDS.accountant);
    expect(() => budgetsApi.listCostLines(RIVERSIDE, {})).not.toThrow();
    expect(() =>
      budgetsApi.forecastBatch(RIVERSIDE, { edits: [{ costLineId: COST_LINE_IDS.con03, budget: '90000.00', reason: 'x' }] }, revision()),
    ).toThrow(ForbiddenError);
  });

  it('actions parse "$1,860.00" and report field errors instead of throwing', async () => {
    const moved = await recordAdjustmentAction(
      idle,
      formOf({ projectId: RIVERSIDE, kind: 'transfer', fromLineId: COST_LINE_IDS.prof04, toLineId: COST_LINE_IDS.prof03, amount: '$1,860.00', reason: 'Certifier extra inspection' }),
    );
    expect(moved.ok).toBe(true);
    expect(budgetsService.currentBudget(COST_LINE_IDS.prof03).cents).toBe(4_786_000);

    const created = await createCostLineAction(
      idle,
      formOf({
        projectId: RIVERSIDE, categoryId: COST_CATEGORY_IDS.prof, code: 'PROF-05', title: 'Surveyor', inputMode: 'quantity-rate',
        quantity: '2.5', rate: '$1,860.00', forecastMethod: 'one-off', oneOffDate: '2026-11-15', taxTreatment: 'standard-gst', recoverablePercent: '100',
      }),
    );
    expect(created.ok).toBe(true);
    if (created.ok) expect((created.value as CostLine).originalBudget.cents).toBe(465_000);

    const tooBig = await recordAdjustmentAction(
      idle,
      formOf({ projectId: RIVERSIDE, kind: 'contingency-draw', fromLineId: COST_LINE_IDS.cont01, toLineId: COST_LINE_IDS.con01, amount: '$999,999.00', reason: 'x' }),
    );
    expect(tooBig.ok).toBe(false);
    if (!tooBig.ok) expect(tooBig.fieldErrors?.amount).toBeDefined();
  });
});
