/**
 * Programme request validation (PRG01–PRG03) for the versioned API.
 */
import { z } from 'zod';
import { MILESTONE_KINDS } from './model';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD.');

/**
 * PATCH /v1/milestones/{id}. A new `plannedDate` is a move and needs a reason;
 * `actualDate` records a fact; the rest are descriptive edits.
 */
export const patchMilestoneSchema = z.object({
  name: z.string().min(1).max(160).optional(),
  code: z.string().min(1).max(20).optional(),
  plannedDate: isoDate.optional(),
  plannedStart: isoDate.optional(),
  actualDate: isoDate.optional(),
  durationDays: z.number().int().min(0).optional(),
  ownerUserId: z.string().min(1).nullable().optional(),
  completionPercent: z.number().int().min(0).max(100).optional(),
  parentId: z.string().min(1).optional(),
  reason: z.string().max(400).optional(),
});

export type PatchMilestoneBody = z.infer<typeof patchMilestoneSchema>;

export const createMilestoneSchema = z.object({
  code: z.string().min(1).max(20),
  name: z.string().min(1).max(160),
  kind: z.enum(MILESTONE_KINDS as [string, ...string[]]),
  parentId: z.string().min(1).optional(),
  plannedStart: isoDate.optional(),
  plannedDate: isoDate,
  durationDays: z.number().int().min(0).optional(),
  ownerUserId: z.string().min(1).optional(),
});

export type CreateMilestoneBody = z.infer<typeof createMilestoneSchema>;

export const dependencySchema = z.object({
  predecessorId: z.string().min(1),
  successorId: z.string().min(1),
  lagDays: z.number().int().default(0),
});

export type DependencyBody = z.infer<typeof dependencySchema>;
