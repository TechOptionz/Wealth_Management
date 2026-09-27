/**
 * Dashboard request validation.
 */
import { z } from 'zod';
import { MAX_RATE_DELTA_PERCENT } from './scenario-math';

export const dashboardQuerySchema = z.object({
  /** Evaluate the read model at a specific date; defaults to the configured as-of date. */
  asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD.').optional(),
  /** Narrow the balance-sheet figures to one consolidated entity; omit for the whole portfolio. */
  entityId: z.string().min(1).max(64).optional(),
});

export type DashboardQuery = z.infer<typeof dashboardQuerySchema>;

/** Query for `GET /api/dashboard/scenario` (FR-11). */
export const scenarioQuerySchema = z.object({
  asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD.').optional(),
  /** Change to the annual rate in percentage points; "0.25" means +0.25%. */
  rateDeltaPercent: z.coerce.number().min(-MAX_RATE_DELTA_PERCENT).max(MAX_RATE_DELTA_PERCENT).default(0),
  /** Comma-separated property ids to treat as vacant. */
  vacantPropertyIds: z
    .string()
    .optional()
    .transform((raw) => (raw ? raw.split(',').map((id) => id.trim()).filter(Boolean) : [])),
});

export type ScenarioQuery = z.infer<typeof scenarioQuerySchema>;
