/**
 * Scenario request validation (SCN01–SCN06). Percentages arrive as decimal
 * strings ("5", "-2.5") and are converted to ppm by the caller.
 */
import { z } from 'zod';

const percent = z.string().regex(/^-?\d+(\.\d{1,4})?$/, 'Use a percentage such as 5 or -2.5.');

export const overridesSchema = z.object({
  unsoldPricePercent: percent.optional(),
  costPercent: percent.optional(),
  costCategoryIds: z.array(z.string()).optional(),
  includeUnbilledCommitments: z.boolean().default(false),
  programmeShiftDays: z.number().int().min(-730).max(730).optional(),
  facilityRatePercent: z.record(z.string(), percent).optional(),
  additionalEquity: z.array(z.object({ participantId: z.string(), amount: z.string().regex(/^\d+(\.\d{1,2})?$/) })).optional(),
  settlementLagMonths: z.number().int().min(0).max(6).optional(),
  taxRatePercent: percent.optional(),
});

export const createScenarioSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(400).optional(),
  overrides: overridesSchema.default({ includeUnbilledCommitments: false }),
});

export const publishScenarioSchema = z.object({ reason: z.string().min(1).max(400) });

export const comparisonQuerySchema = z.object({
  scenarios: z.string().optional(),
  basis: z.enum(['economic', 'gross']).default('economic'),
});

const axis = z.object({
  driver: z.enum(['unsold-price', 'uncommitted-construction', 'remaining-cost', 'interest-rate', 'programme-delay']),
  from: z.number(),
  to: z.number(),
  step: z.number().positive(),
});

export const sensitivitySchema = z.object({ scenarioId: z.string().optional(), rows: axis, columns: axis });
