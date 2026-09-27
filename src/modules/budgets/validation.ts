/**
 * Budgets request validation — the boundary between the wire (or a form) and
 * the service (CST02, CF04, CF07, PRJ05).
 *
 * Money on the wire is a decimal string ("1860.00"), rates in ppm are
 * integers, and schedules arrive in one of two dialects: the API's strict
 * shape (`weightPpm`, `amount`) or the form's forgiving one (`percent` or
 * `weightPpm`, `amount` or `cents`). Both map to `ForecastSchedule` here so
 * the service sees one type.
 */
import { z } from 'zod';
import { percentToPpm, TAX_TREATMENTS } from '@/shared/finance-engine';
import { ValidationError } from '@/shared/lib/errors';
import { FORECAST_METHODS, INPUT_MODES, ROW_TYPES, TIMING_MODES, type ForecastSchedule } from './model';

export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD.');
export const monthKey = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use YYYY-MM.');

/** Money on the wire is a decimal string (CAL01): "1860.00", ex GST. */
export const decimalString = z.string().regex(/^-?\d+(\.\d{1,2})?$/, 'Use a decimal amount such as 1860.00.');

const ppm = z.number().int().min(0).max(1_000_000);

/** "1860.00" → 186000. Rejects anything that is not a plain decimal with at most two places. */
export function decimalToCents(value: string): number {
  const match = /^(-)?(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) throw new ValidationError(`"${value}" is not a decimal amount such as 1860.00.`);
  const cents = Number(match[2]) * 100 + Number((match[3] ?? '').padEnd(2, '0'));
  return match[1] ? -cents : cents;
}

/* ---------- Schedules ---------- */

/** The API dialect. */
export const wireScheduleSchema = z.object({
  oneOffDate: isoDate.optional(),
  startMonth: monthKey.optional(),
  months: z.number().int().min(1).max(360).optional(),
  weights: z.array(z.object({ month: monthKey, weightPpm: ppm })).optional(),
  milestoneOffsetDays: z.number().int().min(-3650).max(3650).optional(),
  manual: z.array(z.object({ date: isoDate, amount: decimalString })).optional(),
});

export type WireSchedule = z.infer<typeof wireScheduleSchema>;

export function wireToSchedule(wire: WireSchedule | undefined): ForecastSchedule | undefined {
  if (!wire) return undefined;
  return {
    ...(wire.oneOffDate !== undefined ? { oneOffDate: wire.oneOffDate } : {}),
    ...(wire.startMonth !== undefined ? { startMonth: wire.startMonth } : {}),
    ...(wire.months !== undefined ? { months: wire.months } : {}),
    ...(wire.weights !== undefined ? { weights: wire.weights } : {}),
    ...(wire.milestoneOffsetDays !== undefined ? { milestoneOffsetDays: wire.milestoneOffsetDays } : {}),
    ...(wire.manual !== undefined ? { manual: wire.manual.map((entry) => ({ date: entry.date, cents: decimalToCents(entry.amount) })) } : {}),
  };
}

/** What a person pastes into the weights textarea: percent or ppm per month. */
export const formWeightsSchema = z.array(
  z.object({
    month: monthKey,
    weightPpm: ppm.optional(),
    percent: z.union([z.string(), z.number()]).optional(),
  }),
);

/** What a person pastes into the manual schedule textarea: a dated amount (ex GST) or cents. */
export const formManualSchema = z.array(
  z.object({
    date: isoDate,
    amount: z.union([z.string(), z.number()]).optional(),
    cents: z.number().int().optional(),
  }),
);

/** Parse a JSON textarea against a schema, naming the input on failure. */
export function parseJsonField<S extends z.ZodTypeAny>(raw: string, field: string, schema: S, hint: string): z.infer<S> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ValidationError(`${field} must be valid JSON.`, { fieldErrors: { [field]: [hint] } });
  }
  const result = schema.safeParse(parsed);
  if (!result.success) {
    const first = result.error.issues[0];
    throw new ValidationError(`${field} is not in the expected shape.`, {
      fieldErrors: { [field]: [first ? `${first.path.join('.') || 'value'}: ${first.message}` : hint] },
    });
  }
  return result.data;
}

export function formWeightsToSchedule(rows: z.infer<typeof formWeightsSchema>): NonNullable<ForecastSchedule['weights']> {
  return rows.map((row) => {
    if (row.weightPpm !== undefined) return { month: row.month, weightPpm: row.weightPpm };
    if (row.percent === undefined) {
      throw new ValidationError(`Month ${row.month} needs a percent or weightPpm.`, { fieldErrors: { weightsJson: [`Give ${row.month} a percent.`] } });
    }
    try {
      return { month: row.month, weightPpm: percentToPpm(row.percent) };
    } catch (error) {
      throw new ValidationError((error as Error).message, { fieldErrors: { weightsJson: [(error as Error).message] } });
    }
  });
}

export function formManualToSchedule(rows: z.infer<typeof formManualSchema>): NonNullable<ForecastSchedule['manual']> {
  return rows.map((row) => {
    if (row.cents !== undefined) return { date: row.date, cents: row.cents };
    if (row.amount === undefined) {
      throw new ValidationError(`Entry ${row.date} needs an amount.`, { fieldErrors: { manualJson: [`Give ${row.date} an amount.`] } });
    }
    const text = typeof row.amount === 'number' ? row.amount.toFixed(2) : row.amount.replace(/[$,\s]/g, '');
    return { date: row.date, cents: decimalToCents(text) };
  });
}

/* ---------- Cost lines ---------- */

export const createCategorySchema = z.object({
  code: z.string().min(2).max(10),
  name: z.string().min(1).max(120),
  parentId: z.string().min(1).optional(),
});

export type CreateCategoryBody = z.infer<typeof createCategorySchema>;

export const createCostLineSchema = z.object({
  categoryId: z.string().min(1),
  code: z.string().min(2).max(20),
  title: z.string().min(1).max(160),
  description: z.string().max(600).optional(),
  rowType: z.enum(ROW_TYPES as [string, ...string[]]).default('posting'),
  parentLineId: z.string().min(1).optional(),
  inputMode: z.enum(INPUT_MODES as [string, ...string[]]).default('direct'),
  quantity: z.number().positive().optional(),
  unit: z.string().max(24).optional(),
  /** Ex GST. */
  rate: decimalString.optional(),
  /** Ex GST. */
  originalBudget: decimalString.optional(),
  taxTreatment: z.enum(TAX_TREATMENTS as [string, ...string[]]).default('standard-gst'),
  recoverablePpm: ppm.default(1_000_000),
  forecastMethod: z.enum(FORECAST_METHODS as [string, ...string[]]).default('one-off'),
  schedule: wireScheduleSchema.default({}),
  timingMode: z.enum(TIMING_MODES as [string, ...string[]]).optional(),
  milestoneId: z.string().min(1).optional(),
  responsibleUserId: z.string().min(1).optional(),
  isContingency: z.boolean().default(false),
});

export type CreateCostLineBody = z.infer<typeof createCostLineSchema>;

export const costLineListQuerySchema = z.object({
  categoryId: z.string().min(1).optional(),
  /** Inactive lines are included by default (CF03); a screen that hides them must say so. */
  includeInactive: z.enum(['true', 'false']).default('true'),
});

export type CostLineListQuery = z.infer<typeof costLineListQuerySchema>;

/* ---------- Batches and baselines ---------- */

export const forecastEditSchema = z.object({
  costLineId: z.string().min(1),
  /** The new current budget, ex GST, as a decimal string. */
  budget: decimalString.optional(),
  reason: z.string().max(400).optional(),
  forecastMethod: z.enum(FORECAST_METHODS as [string, ...string[]]).optional(),
  schedule: wireScheduleSchema.optional(),
  milestoneId: z.string().min(1).optional(),
  timingMode: z.enum(TIMING_MODES as [string, ...string[]]).optional(),
});

export const forecastBatchSchema = z.object({
  /** Alternative to the If-Match header. */
  expectedRevision: z.number().int().min(0).optional(),
  edits: z.array(forecastEditSchema).min(1, 'A batch needs at least one edit.'),
});

export type ForecastBatchBody = z.infer<typeof forecastBatchSchema>;
export type ForecastEditBody = z.infer<typeof forecastEditSchema>;

export const createBaselineSchema = z.object({
  name: z.string().min(1).max(120),
});

export type CreateBaselineBody = z.infer<typeof createBaselineSchema>;

export const publishBaselineSchema = z.object({
  reason: z.string().min(1, 'A reason is required to publish a baseline.').max(400),
});

export type PublishBaselineBody = z.infer<typeof publishBaselineSchema>;
