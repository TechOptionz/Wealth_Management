/**
 * Seeded cost register for Riverside Townhomes (§16.3): ten CST01 categories,
 * twenty cost lines, two adjustments, two baselines and one forecast batch.
 *
 * Every amount is **ex GST**. Ids are stable and predictable because sibling
 * seeds (invoices, commitments) reference them:
 *   cost line  `cl-riverside-<lowercased code>`   e.g. cl-riverside-con-01
 *   category   `cc-riverside-<lowercased code>`   e.g. cc-riverside-con
 *   baseline   `bv-riverside-1`, `bv-riverside-2`
 *
 * Fictional throughout. Eight townhouses in Logan Reserve; the numbers are
 * plausible for a 2026 Brisbane infill build, not a quote.
 */
import { asId, type CostCategoryId, type CostLineId, type UserId } from '@/shared/types/common';
import { fromMajorUnits, type Money } from '@/shared/lib/money';
import { addMonthsToKey, type MonthKey, type Ppm, type TaxTreatment } from '@/shared/finance-engine';
import { USER_IDS } from '@/modules/access/data/seed';
import { PROJECT_IDS } from '@/modules/projects/data/seed';
import {
  DEFAULT_CATEGORY_TEMPLATE,
  timingModeFor,
  type BudgetAdjustment,
  type BudgetVersion,
  type CostCategory,
  type CostLine,
  type ForecastBatch,
  type ForecastMethod,
  type ForecastSchedule,
} from '../model';

const RIVERSIDE = PROJECT_IDS.riverside;

function categoryId(code: string): CostCategoryId {
  return asId<'CostCategory'>(`cc-riverside-${code.toLowerCase()}`);
}

function lineId(code: string): CostLineId {
  return asId<'CostLine'>(`cl-riverside-${code.toLowerCase()}`);
}

export const COST_CATEGORY_IDS = {
  acq: categoryId('ACQ'),
  hold: categoryId('HOLD'),
  prof: categoryId('PROF'),
  con: categoryId('CON'),
  stat: categoryId('STAT'),
  mkt: categoryId('MKT'),
  comm: categoryId('COMM'),
  opex: categoryId('OPEX'),
  cont: categoryId('CONT'),
  fin: categoryId('FIN'),
} as const;

export const COST_LINE_IDS = {
  acq00: lineId('ACQ-00'),
  acq01: lineId('ACQ-01'),
  acq02: lineId('ACQ-02'),
  acq03: lineId('ACQ-03'),
  hold01: lineId('HOLD-01'),
  hold02: lineId('HOLD-02'),
  prof01: lineId('PROF-01'),
  prof02: lineId('PROF-02'),
  prof03: lineId('PROF-03'),
  prof04: lineId('PROF-04'),
  con01: lineId('CON-01'),
  con02: lineId('CON-02'),
  con03: lineId('CON-03'),
  stat01: lineId('STAT-01'),
  stat02: lineId('STAT-02'),
  mkt01: lineId('MKT-01'),
  comm01: lineId('COMM-01'),
  opex01: lineId('OPEX-01'),
  cont01: lineId('CONT-01'),
  fin01: lineId('FIN-01'),
} as const;

export const BUDGET_VERSION_IDS = {
  feasibility: asId<'BudgetVersion'>('bv-riverside-1'),
  postTender: asId<'BudgetVersion'>('bv-riverside-2'),
} as const;

export const FORECAST_BATCH_IDS = {
  tender: asId<'ForecastBatch'>('fb-riverside-1'),
} as const;

export const BUDGET_ADJUSTMENT_IDS = {
  rockDraw: 'adj-riverside-1',
  tenderScope: 'adj-riverside-2',
} as const;

const CREATED_AT = '2026-06-20T02:00:00.000Z';
const FULL: Ppm = 1_000_000;

export function seedCostCategories(): readonly CostCategory[] {
  return DEFAULT_CATEGORY_TEMPLATE.map((entry, index) => ({
    id: categoryId(entry.code),
    projectId: RIVERSIDE,
    code: entry.code,
    name: entry.name,
    sortOrder: index + 1,
  }));
}

/** Month keys from `start`, each carrying its ppm weight. Weights must total 1_000_000. */
function weighted(start: MonthKey, ppms: readonly Ppm[]): ForecastSchedule {
  const total = ppms.reduce((sum, ppm) => sum + ppm, 0);
  if (total !== FULL) throw new Error(`Seed weights from ${start} total ${total} ppm, not 1,000,000.`);
  return { weights: ppms.map((weightPpm, index) => ({ month: addMonthsToKey(start, index), weightPpm })) };
}

function equal(startMonth: MonthKey, months: number): ForecastSchedule {
  return { startMonth, months };
}

function oneOff(oneOffDate: string): ForecastSchedule {
  return { oneOffDate };
}

interface LineSpec {
  readonly code: string;
  readonly title: string;
  readonly category: CostCategoryId;
  readonly budget: number;
  readonly method: ForecastMethod;
  readonly schedule: ForecastSchedule;
  readonly tax?: TaxTreatment;
  readonly rowType?: 'posting' | 'summary';
  readonly parent?: CostLineId;
  readonly isContingency?: boolean;
  readonly description?: string;
  readonly responsible?: UserId;
  readonly recoverablePpm?: Ppm;
}

function line(spec: LineSpec, sortOrder: number): CostLine {
  const tax = spec.tax ?? 'standard-gst';
  const originalBudget: Money = fromMajorUnits(spec.budget);
  return {
    id: lineId(spec.code),
    projectId: RIVERSIDE,
    categoryId: spec.category,
    code: spec.code,
    title: spec.title,
    ...(spec.description ? { description: spec.description } : {}),
    rowType: spec.rowType ?? 'posting',
    ...(spec.parent ? { parentLineId: spec.parent } : {}),
    inputMode: 'direct',
    originalBudget,
    taxTreatment: tax,
    recoverablePpm: spec.recoverablePpm ?? (tax === 'standard-gst' ? FULL : 0),
    forecastMethod: spec.method,
    schedule: spec.schedule,
    timingMode: timingModeFor(spec.method),
    ...(spec.responsible ? { responsibleUserId: spec.responsible } : {}),
    active: true,
    isContingency: spec.isContingency ?? false,
    sortOrder,
    history: [
      {
        at: CREATED_AT,
        actor: USER_IDS.jawad,
        field: 'created',
        before: null,
        after: { inputMode: 'direct', originalBudget, rowType: spec.rowType ?? 'posting' },
        reason: 'Feasibility budget entered',
      },
    ],
    createdAt: CREATED_AT,
  };
}

export function seedCostLines(): readonly CostLine[] {
  const c = COST_CATEGORY_IDS;
  const specs: readonly LineSpec[] = [
    // Acquisition. The parent summarises deposit and settlement and never adds its own amount (F02).
    { code: 'ACQ-00', title: 'Land acquisition', category: c.acq, budget: 0, method: 'manual', schedule: { manual: [] }, rowType: 'summary', tax: 'gst-free' },
    { code: 'ACQ-01', title: 'Land deposit', category: c.acq, budget: 180_000, method: 'one-off', schedule: oneOff('2026-07-15'), tax: 'gst-free', parent: COST_LINE_IDS.acq00, description: '10% on exchange' },
    { code: 'ACQ-02', title: 'Land settlement', category: c.acq, budget: 1_620_000, method: 'one-off', schedule: oneOff('2026-10-15'), tax: 'gst-free', parent: COST_LINE_IDS.acq00, description: 'Balance on settlement' },
    { code: 'ACQ-03', title: 'Stamp duty & legals', category: c.acq, budget: 72_000, method: 'one-off', schedule: oneOff('2026-10-15'), tax: 'out-of-scope' },
    // Holding
    { code: 'HOLD-01', title: 'Council rates & land tax', category: c.hold, budget: 54_600, method: 'equal-monthly', schedule: equal('2026-10', 21), tax: 'out-of-scope' },
    { code: 'HOLD-02', title: 'Insurance', category: c.hold, budget: 28_000, method: 'equal-monthly', schedule: equal('2027-02', 14) },
    // Professional services — design spend is front-loaded.
    { code: 'PROF-01', title: 'Architect & design', category: c.prof, budget: 186_000, method: 'weighted-monthly', schedule: weighted('2026-07', [250_000, 200_000, 150_000, 130_000, 110_000, 90_000, 70_000]), responsible: USER_IDS.mahvish },
    { code: 'PROF-02', title: 'Engineering', category: c.prof, budget: 74_000, method: 'weighted-monthly', schedule: weighted('2026-09', [200_000, 180_000, 160_000, 140_000, 120_000, 110_000, 90_000]) },
    { code: 'PROF-03', title: 'Town planning & certifier', category: c.prof, budget: 46_000, method: 'weighted-monthly', schedule: weighted('2026-08', [220_000, 180_000, 160_000, 140_000, 120_000, 100_000, 80_000]) },
    { code: 'PROF-04', title: 'Project management', category: c.prof, budget: 96_000, method: 'equal-monthly', schedule: equal('2026-07', 24), responsible: USER_IDS.mahvish },
    // Construction — the head contract follows an S-curve over 14 months.
    {
      code: 'CON-01', title: 'Builder head contract', category: c.con, budget: 2_980_000, method: 'weighted-monthly',
      schedule: weighted('2027-02', [20_000, 40_000, 60_000, 80_000, 95_000, 105_000, 110_000, 110_000, 100_000, 90_000, 75_000, 55_000, 35_000, 25_000]),
      responsible: USER_IDS.mahvish, description: 'Lump-sum design and construct, 8 townhouses',
    },
    { code: 'CON-02', title: 'Siteworks & services', category: c.con, budget: 240_000, method: 'weighted-monthly', schedule: weighted('2027-02', [300_000, 300_000, 250_000, 150_000]) },
    { code: 'CON-03', title: 'Landscaping & fencing', category: c.con, budget: 86_000, method: 'equal-monthly', schedule: equal('2028-01', 3) },
    // Statutory charges
    { code: 'STAT-01', title: 'Infrastructure charges', category: c.stat, budget: 168_000, method: 'one-off', schedule: oneOff('2027-02-15'), tax: 'out-of-scope' },
    { code: 'STAT-02', title: 'Approvals & fees', category: c.stat, budget: 22_000, method: 'one-off', schedule: oneOff('2026-12-15'), tax: 'out-of-scope' },
    // Marketing
    { code: 'MKT-01', title: 'Marketing & display', category: c.mkt, budget: 64_000, method: 'weighted-monthly', schedule: weighted('2026-09', [150_000, 120_000, 100_000, 100_000, 100_000, 90_000, 90_000, 90_000, 80_000, 80_000]) },
    // Sales commission — the sales module feeds this line; the code must stay COMM-01.
    {
      code: 'COMM-01', title: 'Sales commission', category: c.comm, budget: 120_000, method: 'manual',
      schedule: { manual: [{ date: '2028-05-15', cents: 6_000_000 }, { date: '2028-06-15', cents: 6_000_000 }] },
      description: 'Paid at settlement of each townhouse',
    },
    // Operating expenses
    { code: 'OPEX-01', title: 'Body corporate setup & sundry', category: c.opex, budget: 18_000, method: 'equal-monthly', schedule: equal('2028-04', 3) },
    // Contingency — an explicit allowance, never a percentage of anything (CST08).
    { code: 'CONT-01', title: 'Contingency', category: c.cont, budget: 150_000, method: 'equal-monthly', schedule: equal('2027-02', 14), isContingency: true, description: 'Construction-phase allowance' },
    // Finance expenses — interest is not a cost line; the funding module computes it (FIN06).
    { code: 'FIN-01', title: 'Loan establishment fee', category: c.fin, budget: 27_500, method: 'one-off', schedule: oneOff('2026-10-15'), tax: 'input-taxed', recoverablePpm: 0 },
  ];
  return specs.map((spec, index) => line(spec, index + 1));
}

export function seedBudgetAdjustments(): readonly BudgetAdjustment[] {
  return [
    {
      id: BUDGET_ADJUSTMENT_IDS.rockDraw,
      projectId: RIVERSIDE,
      kind: 'contingency-draw',
      fromLineId: COST_LINE_IDS.cont01,
      toLineId: COST_LINE_IDS.con02,
      amount: fromMajorUnits(18_000),
      reason: 'Rock excavation variation',
      actor: USER_IDS.mahvish,
      at: '2026-08-20T03:15:00.000Z',
      revision: 9,
    },
    {
      id: BUDGET_ADJUSTMENT_IDS.tenderScope,
      projectId: RIVERSIDE,
      kind: 'scope-change',
      toLineId: COST_LINE_IDS.con01,
      amount: fromMajorUnits(140_000),
      reason: 'Tender result',
      actor: USER_IDS.mahvish,
      at: '2026-08-27T05:40:00.000Z',
      revision: 11,
    },
  ];
}

/** Snapshot of every posting line, with the named overrides applied. */
function snapshot(overrides: Readonly<Record<string, number>>): BudgetVersion['lines'] {
  return seedCostLines()
    .filter((entry) => entry.rowType === 'posting')
    .map((entry) => ({
      costLineId: entry.id,
      amount: overrides[entry.code] === undefined ? entry.originalBudget : fromMajorUnits(overrides[entry.code] ?? 0),
    }));
}

export function seedBudgetVersions(): readonly BudgetVersion[] {
  return [
    {
      id: BUDGET_VERSION_IDS.feasibility,
      projectId: RIVERSIDE,
      name: 'Baseline 1 · feasibility',
      state: 'superseded',
      lines: snapshot({}),
      createdAt: '2026-07-04T23:10:00.000Z',
      createdBy: USER_IDS.jawad,
      approvedBy: USER_IDS.jawad,
      approvedAt: '2026-07-05T01:00:00.000Z',
      reason: 'Feasibility approved by the board',
      sourceRevision: 3,
    },
    {
      id: BUDGET_VERSION_IDS.postTender,
      projectId: RIVERSIDE,
      name: 'Baseline 2 · post-tender',
      state: 'published',
      lines: snapshot({ 'CON-01': 3_120_000, 'CON-02': 258_000, 'CONT-01': 132_000 }),
      createdAt: '2026-08-27T06:00:00.000Z',
      createdBy: USER_IDS.mahvish,
      approvedBy: USER_IDS.jawad,
      approvedAt: '2026-08-28T00:30:00.000Z',
      reason: 'Post-tender rebaseline · head contract awarded',
      sourceRevision: 11,
    },
  ];
}

export function seedForecastBatches(): readonly ForecastBatch[] {
  return [
    {
      id: FORECAST_BATCH_IDS.tender,
      projectId: RIVERSIDE,
      actor: USER_IDS.mahvish,
      at: '2026-08-27T05:40:00.000Z',
      revisionBefore: 10,
      revisionAfter: 11,
      changes: [
        { costLineId: COST_LINE_IDS.con01, field: 'budget', before: fromMajorUnits(2_980_000), after: fromMajorUnits(3_120_000) },
      ],
    },
  ];
}
