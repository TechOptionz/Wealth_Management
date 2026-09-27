/**
 * Debt interest and the facility ledger (FIN03, FIN05, CAL15, CAL16).
 *
 * Interest accrues **each day** as principal × annual rate ÷ day-count
 * denominator, on the balance after that day's dated movements. The accrual is
 * carried as an exact `bigint` in units of cents ÷ (denominator × 10⁶) and is
 * rounded to cents only when posted — at month end, capitalised into principal
 * (affecting the next day's accrual) or reported as cash interest. No
 * floating-point value touches a balance.
 */
import { addDays, daysBetween } from '@/shared/lib/dates';
import type { IsoDate } from '@/shared/types/common';
import { assertCents, assertPpm, PPM_BIG, roundDiv, toSafeNumber, type Cents, type Ppm } from './decimal';
import { dateInMonth, lastDayOfMonth, monthKeyOf, monthKeysBetween, type MonthKey } from './schedule';

export type DayCountConvention = 'ACT/365F' | 'ACT/360';

export const DAY_COUNT_DENOMINATOR: Record<DayCountConvention, number> = {
  'ACT/365F': 365,
  'ACT/360': 360,
};

export type InterestTreatment = 'capitalised' | 'cash';

export interface RateStep {
  /** Effective from this day inclusive. */
  readonly from: IsoDate;
  readonly ratePpm: Ppm;
}

export interface FacilityTerms {
  readonly limitCents: Cents;
  /** Principal outstanding at the start of `openingOn`, before that day's movements. */
  readonly openingPrincipalCents: Cents;
  readonly openingOn: IsoDate;
  readonly rateSteps: readonly RateStep[];
  readonly dayCount: DayCountConvention;
  readonly interestTreatment: InterestTreatment;
  readonly maturityOn?: IsoDate;
}

export type FacilityMovementKind = 'draw' | 'repayment' | 'fee' | 'correction';

export interface FacilityMovementInput {
  readonly on: IsoDate;
  readonly kind: FacilityMovementKind;
  /** Positive magnitude for draws, repayments and fees; a correction is signed. */
  readonly cents: Cents;
}

export interface FacilityBreach {
  readonly on: IsoDate;
  readonly kind: 'limit' | 'maturity';
  readonly cents: Cents;
}

export interface FacilityMonth {
  readonly month: MonthKey;
  readonly openingPrincipalCents: Cents;
  readonly drawsCents: Cents;
  readonly repaymentsCents: Cents;
  readonly capitalisedInterestCents: Cents;
  readonly cashInterestCents: Cents;
  readonly feesCents: Cents;
  readonly closingPrincipalCents: Cents;
  readonly unusedCapacityCents: Cents;
  readonly breaches: readonly FacilityBreach[];
  /** The sub-cent accrual discarded when this month's interest was posted, in cents × (denominator × 10⁶). */
  readonly roundingResidualScaled: bigint;
}

export interface InterestPosting {
  readonly on: IsoDate;
  readonly cents: Cents;
  readonly treatment: InterestTreatment;
}

export interface FacilityLedgerResult {
  readonly months: readonly FacilityMonth[];
  readonly closingPrincipalCents: Cents;
  readonly peakPrincipalCents: Cents;
  readonly peakOn: IsoDate | null;
  readonly interestPostings: readonly InterestPosting[];
  readonly breaches: readonly FacilityBreach[];
}

/** Exact daily accrual in scaled units: principal × rate × days, over (denominator × 10⁶). */
export function accrualScaled(principalCents: Cents, ratePpm: Ppm, days: number): bigint {
  assertCents(principalCents, 'principal');
  assertPpm(ratePpm);
  if (!Number.isInteger(days) || days < 0) throw new RangeError('Days must be a whole non-negative number.');
  return BigInt(principalCents) * BigInt(ratePpm) * BigInt(days);
}

export function scaleFor(dayCount: DayCountConvention): bigint {
  return BigInt(DAY_COUNT_DENOMINATOR[dayCount]) * PPM_BIG;
}

/** Round a scaled accrual to cents at a posting boundary; the remainder carries forward. */
export function postAccrual(scaled: bigint, dayCount: DayCountConvention): { readonly cents: Cents; readonly remainder: bigint } {
  const scale = scaleFor(dayCount);
  const cents = roundDiv(scaled, scale);
  return { cents: toSafeNumber(cents), remainder: scaled - cents * scale };
}

/** Simple interest over a whole period, rounded once (used for preferred return and quick checks). */
export function simpleInterest(principalCents: Cents, ratePpm: Ppm, days: number, dayCount: DayCountConvention = 'ACT/365F'): Cents {
  return postAccrual(accrualScaled(principalCents, ratePpm, days), dayCount).cents;
}

function rateOn(steps: readonly RateStep[], day: IsoDate): Ppm {
  let rate = 0;
  for (const step of steps) if (step.from <= day) rate = step.ratePpm;
  return rate;
}

/**
 * Run a facility day by day from the first day of `fromMonth` to the last day of
 * `toMonth`, applying each day's movements before that day's accrual and
 * posting interest at month end (FIN05). Every month reconciles as
 * closing = opening + draws − repayments + capitalised interest (CAL15).
 */
export function runFacilityLedger(
  terms: FacilityTerms,
  movements: readonly FacilityMovementInput[],
  fromMonth: MonthKey,
  toMonth: MonthKey,
): FacilityLedgerResult {
  assertCents(terms.limitCents, 'limit');
  assertCents(terms.openingPrincipalCents, 'opening principal');
  for (const step of terms.rateSteps) assertPpm(step.ratePpm);

  const byDay = new Map<IsoDate, FacilityMovementInput[]>();
  for (const movement of movements) {
    assertCents(movement.cents, `movement on ${movement.on}`);
    const list = byDay.get(movement.on) ?? [];
    list.push(movement);
    byDay.set(movement.on, list);
  }

  const start = dateInMonth(fromMonth, 1);
  // Movements before the window are folded into the opening balance so a
  // window that starts mid-life still reconciles.
  let principal = 0;
  if (terms.openingOn < start) principal = terms.openingPrincipalCents;
  for (const [day, list] of byDay) {
    if (day >= start) continue;
    for (const movement of list) principal += principalDelta(movement);
  }

  const months: FacilityMonth[] = [];
  const postings: InterestPosting[] = [];
  const allBreaches: FacilityBreach[] = [];
  let accrued = 0n;
  let peak = principal;
  let peakOn: IsoDate | null = principal > 0 ? start : null;

  for (const month of monthKeysBetween(fromMonth, toMonth)) {
    const opening = principal;
    let draws = 0;
    let repayments = 0;
    let fees = 0;
    const breaches: FacilityBreach[] = [];
    const monthEnd = lastDayOfMonth(month);
    const dayCount = daysBetween(dateInMonth(month, 1), monthEnd) + 1;

    for (let offset = 0; offset < dayCount; offset += 1) {
      const day = addDays(dateInMonth(month, 1), offset);
      if (day === terms.openingOn) principal += terms.openingPrincipalCents;
      for (const movement of byDay.get(day) ?? []) {
        switch (movement.kind) {
          case 'draw':
            draws += movement.cents;
            break;
          case 'repayment':
            repayments += movement.cents;
            break;
          case 'fee':
            fees += movement.cents;
            break;
          case 'correction':
            if (movement.cents >= 0) draws += movement.cents;
            else repayments += -movement.cents;
            break;
        }
        principal += principalDelta(movement);
      }
      if (principal > terms.limitCents && !breaches.some((b) => b.kind === 'limit')) {
        breaches.push({ on: day, kind: 'limit', cents: principal - terms.limitCents });
      }
      if (terms.maturityOn && day > terms.maturityOn && principal > 0 && !breaches.some((b) => b.kind === 'maturity')) {
        breaches.push({ on: day, kind: 'maturity', cents: principal });
      }
      if (principal > peak) {
        peak = principal;
        peakOn = day;
      }
      accrued += accrualScaled(Math.max(principal, 0), rateOn(terms.rateSteps, day), 1);
    }

    const posted = postAccrual(accrued, terms.dayCount);
    const roundingResidualScaled = posted.remainder;
    accrued = 0n;
    let capitalised = 0;
    let cashInterest = 0;
    if (posted.cents !== 0) {
      if (terms.interestTreatment === 'capitalised') {
        capitalised = posted.cents;
        principal += posted.cents;
        if (principal > peak) {
          peak = principal;
          peakOn = monthEnd;
        }
      } else {
        cashInterest = posted.cents;
      }
      postings.push({ on: monthEnd, cents: posted.cents, treatment: terms.interestTreatment });
    }

    months.push({
      month,
      openingPrincipalCents: opening,
      drawsCents: draws,
      repaymentsCents: repayments,
      capitalisedInterestCents: capitalised,
      cashInterestCents: cashInterest,
      feesCents: fees,
      closingPrincipalCents: principal,
      unusedCapacityCents: Math.max(terms.limitCents - principal, 0),
      breaches,
      roundingResidualScaled,
    });
    allBreaches.push(...breaches);
  }

  return {
    months,
    closingPrincipalCents: principal,
    peakPrincipalCents: peak,
    peakOn,
    interestPostings: postings,
    breaches: allBreaches,
  };
}

function principalDelta(movement: FacilityMovementInput): Cents {
  switch (movement.kind) {
    case 'draw':
      return movement.cents;
    case 'repayment':
      return -movement.cents;
    case 'correction':
      return movement.cents;
    case 'fee':
      return 0;
  }
}

/** True when every month satisfies closing = opening + draws − repayments + capitalised (FIN03). */
export function ledgerReconciles(result: FacilityLedgerResult): boolean {
  return result.months.every(
    (month) =>
      month.closingPrincipalCents ===
      month.openingPrincipalCents + month.drawsCents - month.repaymentsCents + month.capitalisedInterestCents,
  );
}

export { monthKeyOf };
