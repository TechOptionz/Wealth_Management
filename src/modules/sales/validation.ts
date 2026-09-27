/**
 * Sales request validation for the versioned API (YLD01, YLD03). Money on the
 * wire is a decimal string (CAL01).
 */
import { z } from 'zod';
import { TAX_TREATMENTS } from '@/shared/finance-engine';
import { PRICING_MODES, SALEABLE_AREA_BASES } from './model';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD.');
const decimal = z.string().regex(/^-?\d+(\.\d{1,2})?$/, 'Use a decimal amount such as 845000.00.');
const treatment = z.enum(TAX_TREATMENTS as unknown as [string, ...string[]]);

export const unitRowSchema = z.object({
  groupId: z.string().min(1),
  code: z.string().min(1).max(20),
  stage: z.string().max(60).optional(),
  productType: z.string().min(1).max(80),
  level: z.string().max(20).optional(),
  bedrooms: z.number().int().min(0),
  carSpaces: z.number().int().min(0),
  internalAreaSqm: z.number().min(0, 'Areas cannot be negative.'),
  externalAreaSqm: z.number().min(0, 'Areas cannot be negative.'),
  saleableAreaBasis: z.enum(SALEABLE_AREA_BASES as unknown as [string, ...string[]]),
  pricingMode: z.enum(PRICING_MODES as unknown as [string, ...string[]]),
  askingPrice: decimal.optional(),
  forecastPrice: decimal.optional(),
  pricePerSqm: decimal.optional(),
  taxTreatment: treatment,
  forecastSettlementMilestoneId: z.string().min(1).optional(),
  forecastSettlementDate: isoDate.optional(),
});

export type UnitRowBody = z.infer<typeof unitRowSchema>;

export const importUnitsSchema = z.object({
  rows: z.array(unitRowSchema).min(1).max(2000),
});

export type ImportUnitsBody = z.infer<typeof importUnitsSchema>;

export const createContractSchema = z.object({
  purchaserReference: z.string().min(1).max(60),
  consideration: decimal,
  taxTreatment: treatment.default('standard-gst'),
  contractDate: isoDate,
  expectedSettlement: isoDate,
  depositSchedule: z.array(z.object({ dueOn: isoDate, amount: decimal })).default([]),
  adjustments: decimal.optional(),
  withholding: decimal.optional(),
});

export type CreateContractBody = z.infer<typeof createContractSchema>;
