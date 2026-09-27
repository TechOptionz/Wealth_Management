/**
 * Funding request validation for the versioned API (FIN01, EQ01, WFL04).
 *
 * Money on the wire is a decimal string ("1860.00"); rates are typed as a
 * percentage string ("8.25" for 8.25%) and converted to ppm at the boundary so
 * 10 can never be mistaken for 0.10 (CAL01, FIN01).
 */
import { z } from 'zod';
import { ValidationError } from '@/shared/lib/errors';
import { money, type Money } from '@/shared/lib/money';
import {
  DAY_COUNTS,
  EQUITY_MOVEMENT_TYPES,
  FACILITY_FEE_KINDS,
  FACILITY_TYPES,
  INTEREST_TREATMENTS,
  MOVEMENT_BASES,
  MOVEMENT_KINDS,
  PARTICIPANT_CLASSES,
} from './model';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD.');

/** "1860.00" or "-412.50". */
export const decimalString = z.string().regex(/^-?\d+(\.\d{1,2})?$/, 'Use a decimal amount such as 1860.00.');

/** "8.25" means 8.25%; up to four decimals, an optional trailing %. */
export const percentString = z.string().regex(/^\d+(\.\d{1,4})?%?$/, 'Enter the rate as a percentage, e.g. 8.25 for 8.25%.');

/** "1860.00" → Money(186000). Pure, so `api.ts` can use it without touching the HTTP layer. */
export function decimalToMoney(value: string): Money {
  const match = /^(-)?(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) throw new ValidationError(`"${value}" is not a decimal amount such as 1860.00.`);
  const cents = Number(match[2]) * 100 + Number((match[3] ?? '').padEnd(2, '0'));
  return money(match[1] ? -cents : cents);
}

const asEnum = <T extends string>(values: readonly T[]) => z.enum(values as unknown as [T, ...T[]]);

export const facilityFeeSchema = z.object({
  kind: asEnum(FACILITY_FEE_KINDS),
  amount: decimalString,
  on: isoDate.optional(),
});

export const createFacilitySchema = z.object({
  name: z.string().min(1).max(160),
  lender: z.string().min(1).max(160),
  borrowerLegalEntityId: z.string().min(1),
  type: asEnum(FACILITY_TYPES),
  limit: decimalString,
  openingPrincipal: decimalString.optional(),
  openingOn: isoDate.optional(),
  availableFrom: isoDate,
  availableTo: isoDate,
  maturityOn: isoDate,
  drawRank: z.number().int().min(1).default(1),
  repaymentRank: z.number().int().min(1).default(1),
  /** Percentage, not a fraction: "8.25" is 8.25% (FIN01). */
  annualRatePercent: percentString,
  rateFrom: isoDate.optional(),
  dayCount: asEnum(DAY_COUNTS).default('ACT/365F'),
  interestTreatment: asEnum(INTEREST_TREATMENTS).default('capitalised'),
  fees: z.array(facilityFeeSchema).default([]),
});

export type CreateFacilityBody = z.infer<typeof createFacilitySchema>;

export const facilityMovementSchema = z.object({
  facilityId: z.string().min(1),
  on: isoDate,
  kind: asEnum(MOVEMENT_KINDS),
  /** Positive magnitude; a correction may be negative. */
  amount: decimalString,
  basis: asEnum(MOVEMENT_BASES).default('actual'),
  reference: z.string().max(160).optional(),
  note: z.string().max(400).optional(),
  correctsMovementId: z.string().min(1).optional(),
});

export type FacilityMovementBody = z.infer<typeof facilityMovementSchema>;

export const createParticipantSchema = z.object({
  name: z.string().min(1).max(160),
  investorReference: z.string().max(80).default(''),
  class: asEnum(PARTICIPANT_CLASSES),
  commitment: decimalString,
  participationWeight: z.number().nonnegative().default(1),
  preferredRatePercent: percentString.default('0'),
  residualShareWeight: z.number().nonnegative().default(0),
});

export type CreateParticipantBody = z.infer<typeof createParticipantSchema>;

export const equityMovementSchema = z.object({
  participantId: z.string().min(1),
  on: isoDate,
  type: asEnum(EQUITY_MOVEMENT_TYPES),
  amount: decimalString,
  basis: asEnum(MOVEMENT_BASES).default('actual'),
  note: z.string().max(400).optional(),
});

export type EquityMovementBody = z.infer<typeof equityMovementSchema>;

export const distributionRequestSchema = z.object({
  availableCash: decimalString,
  requiredDebt: decimalString.default('0.00'),
  asOf: isoDate.optional(),
});

export type DistributionRequestBody = z.infer<typeof distributionRequestSchema>;
