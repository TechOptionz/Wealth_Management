/**
 * Projects request validation (PRJ01, PRJ03, IAM03).
 */
import { z } from 'zod';
import { AUSTRALIAN_STATES, PROJECT_GRANTS, PROJECT_ROLES, PROJECT_TYPES } from './model';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD.');

/** Money on the wire is a decimal string (CAL01): "1860.00". */
export const decimalString = z.string().regex(/^-?\d+(\.\d{1,2})?$/, 'Use a decimal amount such as 1860.00.');

export const createProjectSchema = z.object({
  code: z.string().min(2).max(20),
  name: z.string().min(1).max(160),
  legalEntityId: z.string().min(1),
  type: z.enum(PROJECT_TYPES as [string, ...string[]]),
  address: z.string().min(1).max(240),
  state: z.enum(AUSTRALIAN_STATES as [string, ...string[]]),
  startDate: isoDate,
  expectedCompletion: isoDate,
  forecastHorizonMonths: z.number().int().min(1).max(120),
  reportingBasis: z.enum(['accrual', 'cash']).default('accrual'),
  openingCash: decimalString.optional(),
  openingRestrictedCash: decimalString.optional(),
});

export type CreateProjectBody = z.infer<typeof createProjectSchema>;

export const patchProjectSchema = z.object({
  name: z.string().min(1).max(160).optional(),
  address: z.string().min(1).max(240).optional(),
  type: z.enum(PROJECT_TYPES as [string, ...string[]]).optional(),
  state: z.enum(AUSTRALIAN_STATES as [string, ...string[]]).optional(),
  expectedCompletion: isoDate.optional(),
  forecastHorizonMonths: z.number().int().min(1).max(120).optional(),
  reportingBasis: z.enum(['accrual', 'cash']).optional(),
  openingCash: decimalString.optional(),
  openingRestrictedCash: decimalString.optional(),
});

export type PatchProjectBody = z.infer<typeof patchProjectSchema>;

export const lifecycleSchema = z.object({
  to: z.enum(['draft', 'active', 'paused', 'completed', 'archived']),
  reason: z.string().max(400).optional(),
});

export const grantAccessSchema = z.object({
  userId: z.string().min(1),
  role: z.enum(PROJECT_ROLES as [string, ...string[]]),
  grants: z.array(z.enum(PROJECT_GRANTS as [string, ...string[]])).default([]),
  approvalLimit: decimalString.nullable().default(null),
  participantId: z.string().min(1).optional(),
  expiresAt: isoDate.optional(),
});

export const projectListQuerySchema = z.object({
  lifecycle: z.enum(['all', 'draft', 'active', 'paused', 'completed', 'archived']).default('all'),
});

export type ProjectListQuery = z.infer<typeof projectListQuerySchema>;
