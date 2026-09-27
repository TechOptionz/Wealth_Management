/**
 * Commitments request validation (CST03, CST04) for the versioned API.
 * Money on the wire is a decimal string (CAL01), net of GST.
 */
import { z } from 'zod';
import { TAX_TREATMENTS } from '@/shared/finance-engine';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD.');
export const decimalString = z.string().regex(/^-?\d+(\.\d{1,2})?$/, 'Use a decimal amount such as 1860.00.');

export const allocationSchema = z.object({
  costLineId: z.string().min(1),
  stageId: z.string().min(1).optional(),
  amount: decimalString,
});

export const createCommitmentSchema = z.object({
  supplierId: z.string().min(1),
  reference: z.string().min(1).max(60),
  title: z.string().min(1).max(200),
  /** Net, ex GST. */
  originalAmount: decimalString,
  taxTreatment: z.enum(TAX_TREATMENTS as [string, ...string[]]).default('standard-gst'),
  startDate: isoDate,
  endDate: isoDate.optional(),
  attachmentName: z.string().max(200).optional(),
  stages: z
    .array(z.object({ id: z.string().min(1).optional(), name: z.string().min(1).max(120), amount: decimalString, plannedDate: isoDate.optional() }))
    .default([]),
  allocations: z.array(allocationSchema).min(1),
});

export type CreateCommitmentBody = z.infer<typeof createCommitmentSchema>;

export const submitVariationSchema = z.object({
  reference: z.string().min(1).max(60),
  description: z.string().min(1).max(400),
  /** Signed net change, ex GST. */
  amount: decimalString,
  allocations: z.array(allocationSchema).optional(),
});

export type SubmitVariationBody = z.infer<typeof submitVariationSchema>;

export const decideVariationSchema = z.object({
  decision: z.enum(['approved', 'rejected']).default('approved'),
  reason: z.string().max(400).optional(),
});

export type DecideVariationBody = z.infer<typeof decideVariationSchema>;

export const createSupplierSchema = z.object({
  name: z.string().min(1).max(160),
  abn: z.string().max(20).optional(),
  contactReference: z.string().max(200).optional(),
});

export type CreateSupplierBody = z.infer<typeof createSupplierSchema>;
