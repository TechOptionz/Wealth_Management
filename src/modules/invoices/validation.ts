/**
 * Invoices request validation for the versioned API (INV01, INV06, INV07,
 * INV09, INT07). Money on the wire is a decimal string (CAL01).
 */
import { z } from 'zod';
import { TAX_TREATMENTS } from '@/shared/finance-engine';
import { REVIEW_STATES, SETTLEMENT_TYPES } from './model';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD.');
export const decimalString = z.string().regex(/^-?\d+(\.\d{1,2})?$/, 'Use a decimal amount such as 1860.00.');

export const invoiceAllocationSchema = z.object({
  costLineId: z.string().min(1),
  commitmentId: z.string().min(1).optional(),
  stageId: z.string().min(1).optional(),
  net: decimalString,
  tax: decimalString,
  taxTreatment: z.enum(TAX_TREATMENTS as [string, ...string[]]),
  /** Recoverable share of the tax, in ppm; defaults to the cost line's. */
  recoverablePpm: z.number().int().min(0).max(1_000_000).optional(),
  allowanceTreatment: z.enum(['consume-allowance', 'additional-scope']).optional(),
});

export type InvoiceAllocationBody = z.infer<typeof invoiceAllocationSchema>;

export const invoiceFieldsSchema = z.object({
  type: z.enum(['invoice', 'credit-note']).default('invoice'),
  supplierId: z.string().min(1),
  number: z.string().min(1).max(60),
  currency: z.literal('AUD').default('AUD'),
  invoiceDate: isoDate,
  dueDate: isoDate,
  net: decimalString,
  tax: decimalString,
  lineDescriptions: z.array(z.string().max(400)).default([]),
  allocations: z.array(invoiceAllocationSchema).default([]),
  roundingAdjustment: decimalString.optional(),
});

export type InvoiceFieldsBody = z.infer<typeof invoiceFieldsSchema>;

/** INV01 — metadata plus optional base64 content; the bytes are checked and discarded. */
export const invoiceIntakeSchema = z.object({
  filename: z.string().min(1).max(240),
  mimeType: z.string().min(1).max(100),
  sizeBytes: z.number().int().min(0),
  contentBase64: z.string().optional(),
  invoice: invoiceFieldsSchema.optional(),
});

export type InvoiceIntakeBody = z.infer<typeof invoiceIntakeSchema>;

export const invoiceListQuerySchema = z.object({
  reviewState: z.enum(REVIEW_STATES as [string, ...string[]]).optional(),
});

export type InvoiceListQuery = z.infer<typeof invoiceListQuerySchema>;

export const draftChangesSchema = z.object({
  supplierId: z.string().min(1).optional(),
  number: z.string().min(1).max(60).optional(),
  invoiceDate: isoDate.optional(),
  dueDate: isoDate.optional(),
  net: decimalString.optional(),
  tax: decimalString.optional(),
  lineDescriptions: z.array(z.string().max(400)).optional(),
  allocations: z.array(invoiceAllocationSchema).optional(),
  roundingAdjustment: decimalString.optional(),
  scheduledPaymentDate: isoDate.optional(),
});

export type DraftChangesBody = z.infer<typeof draftChangesSchema>;

export const submitSchema = z.object({
  acknowledgeWarnings: z.boolean().default(false),
});

export const decisionSchema = z.object({
  decision: z.enum(['approved', 'on-hold', 'rejected']),
  /** The invoice revision the decision was made against. */
  invoiceRevision: z.string().min(1),
  approvalStepId: z.string().optional(),
  reason: z.string().max(400).optional(),
  scheduledPaymentDate: isoDate.optional(),
});

export type DecisionBody = z.infer<typeof decisionSchema>;

export const paymentImportSchema = z
  .object({
    csvText: z.string().max(2_000_000).optional(),
    filename: z.string().max(240).optional(),
    confirmImportId: z.string().min(1).optional(),
  })
  .refine((body) => Boolean(body.csvText) !== Boolean(body.confirmImportId), {
    message: 'Send csvText for a dry run, or confirmImportId to confirm one — not both.',
  });

export type PaymentImportBody = z.infer<typeof paymentImportSchema>;

export const matchItemSchema = z.object({
  invoiceId: z.string().min(1),
  amount: decimalString,
});

export type MatchItemBody = z.infer<typeof matchItemSchema>;

export const settlementSchema = z.object({
  paymentId: z.string().min(1).optional(),
  creditNoteInvoiceId: z.string().min(1).optional(),
  invoiceId: z.string().min(1),
  amount: decimalString,
  settlementType: z.enum(SETTLEMENT_TYPES as [string, ...string[]]),
});
