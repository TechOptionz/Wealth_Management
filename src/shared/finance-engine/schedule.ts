/**
 * Forecast distributions (CF04, CAL04).
 *
 * A forecast amount is spread into dated allocations: one-off, equal monthly,
 * weighted monthly, milestone-linked or manually scheduled. Weights must total
 * 100% and the rounding residual always lands on the final eligible period, so
 * a schedule reproduces exactly from its inputs. Month-only inputs are dated
 * the fifteenth and the caller discloses that assumption (CAL04).
 */
import { addDays, addMonths, toDate, toIsoDate } from '@/shared/lib/dates';
import type { IsoDate } from '@/shared/types/common';
import { allocateResidualToLast } from './allocation';
import { assertCents, PPM, type Cents, type Ppm } from './decimal';

/** "2027-03" — a calendar month. */
export type MonthKey = string;

/** The day a month-only forecast is dated to (CAL04). */
export const DEFAULT_FORECAST_DAY = 15;

export interface DatedAmount {
  readonly date: IsoDate;
  readonly cents: Cents;
}

export function monthKeyOf(date: IsoDate): MonthKey {
  return date.slice(0, 7);
}

export function addMonthsToKey(key: MonthKey, months: number): MonthKey {
  return monthKeyOf(addMonths(`${key}-01`, months));
}

/** Every month from `from` to `to` inclusive. Empty when `to` precedes `from`. */
export function monthKeysBetween(from: MonthKey, to: MonthKey): MonthKey[] {
  const keys: MonthKey[] = [];
  for (let key = from; key <= to; key = addMonthsToKey(key, 1)) keys.push(key);
  return keys;
}

/** A date inside a month, clamped to the month's length (31 → 28/29/30 where needed). */
export function dateInMonth(key: MonthKey, day: number = DEFAULT_FORECAST_DAY): IsoDate {
  const first = toDate(`${key}-01`);
  const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  const clamped = Math.min(Math.max(1, Math.trunc(day)), lastDay);
  return toIsoDate(new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), clamped)));
}

export function lastDayOfMonth(key: MonthKey): IsoDate {
  return dateInMonth(key, 31);
}

export function distributeOneOff(totalCents: Cents, date: IsoDate): DatedAmount[] {
  assertCents(totalCents, 'total');
  return totalCents === 0 ? [] : [{ date, cents: totalCents }];
}

/** Equal monthly instalments; the residual cents go to the final month. */
export function distributeEqualMonthly(
  totalCents: Cents,
  firstMonth: MonthKey,
  months: number,
  day: number = DEFAULT_FORECAST_DAY,
): DatedAmount[] {
  assertCents(totalCents, 'total');
  if (!Number.isInteger(months) || months < 1) throw new RangeError('An equal monthly schedule needs at least one month.');
  const parts = allocateResidualToLast(totalCents, Array.from({ length: months }, () => 1));
  return parts.map((cents, index) => ({ date: dateInMonth(addMonthsToKey(firstMonth, index), day), cents }));
}

export interface MonthWeight {
  readonly month: MonthKey;
  /** Share of the total in ppm; all weights together must be exactly 1_000_000. */
  readonly weightPpm: Ppm;
}

/** Weighted monthly schedule. Weights must total 100%; the residual goes to the last weighted month. */
export function distributeWeighted(
  totalCents: Cents,
  weights: readonly MonthWeight[],
  day: number = DEFAULT_FORECAST_DAY,
): DatedAmount[] {
  assertCents(totalCents, 'total');
  if (weights.length === 0) throw new RangeError('A weighted schedule needs at least one month.');
  const sum = weights.reduce((acc, weight) => acc + weight.weightPpm, 0);
  if (sum !== PPM) throw new RangeError(`Schedule weights must total 100%; these total ${(sum / 10_000).toFixed(4)}%.`);
  const ordered = [...weights].sort((a, b) => a.month.localeCompare(b.month));
  const parts = allocateResidualToLast(totalCents, ordered.map((weight) => weight.weightPpm));
  return ordered.map((weight, index) => ({ date: dateInMonth(weight.month, day), cents: parts[index] ?? 0 }));
}

/** One allocation dated relative to a milestone. Moving the milestone moves it (CF06, PRG04). */
export function distributeMilestoneLinked(totalCents: Cents, milestoneDate: IsoDate, offsetDays = 0): DatedAmount[] {
  return distributeOneOff(totalCents, addDays(milestoneDate, offsetDays));
}

/** A hand-entered schedule is accepted only when it reconciles to its amount. */
export function validateManualSchedule(totalCents: Cents, entries: readonly DatedAmount[]): DatedAmount[] {
  assertCents(totalCents, 'total');
  const sum = entries.reduce((acc, entry) => {
    assertCents(entry.cents, `allocation on ${entry.date}`);
    return acc + entry.cents;
  }, 0);
  if (sum !== totalCents) {
    throw new RangeError(`A manual schedule must total its amount: entries sum to ${sum} cents, amount is ${totalCents} cents.`);
  }
  return [...entries].sort((a, b) => a.date.localeCompare(b.date));
}

/** Month totals of a set of dated amounts. */
export function sumByMonth(entries: readonly DatedAmount[]): Map<MonthKey, Cents> {
  const totals = new Map<MonthKey, Cents>();
  for (const entry of entries) {
    const key = monthKeyOf(entry.date);
    totals.set(key, (totals.get(key) ?? 0) + entry.cents);
  }
  return totals;
}
