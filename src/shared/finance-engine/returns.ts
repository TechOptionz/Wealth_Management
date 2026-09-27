/**
 * Dated returns (CAL18–CAL20).
 *
 * `xirr` solves XNPV = 0 on actual dates with a 365-day year, the convention
 * Microsoft documents for XIRR (S08). It returns *Not Available* — never a
 * number — when the flows have no sign change, no time separation, no root, or
 * the solver does not converge. Several sign changes are flagged, because a
 * second root may exist and silently picking one would be a guess.
 */
import { daysBetween } from '@/shared/lib/dates';
import type { IsoDate } from '@/shared/types/common';
import { assertCents, type Cents } from './decimal';

export interface DatedCashFlow {
  readonly date: IsoDate;
  /** Signed: inflow positive, outflow negative (CAL03). */
  readonly cents: Cents;
}

export type XirrUnavailableReason = 'no-flows' | 'no-sign-change' | 'no-time-separation' | 'no-root' | 'nonconvergent';

export const XIRR_UNAVAILABLE_LABELS: Record<XirrUnavailableReason, string> = {
  'no-flows': 'Not available · no cash flows',
  'no-sign-change': 'Not available · needs both positive and negative flows',
  'no-time-separation': 'Not available · all flows fall on one day',
  'no-root': 'Not available · no rate reconciles these flows',
  nonconvergent: 'Not available · the solver did not converge',
};

export type XirrResult =
  | { readonly available: true; readonly rate: number; readonly warnings: readonly string[] }
  | { readonly available: false; readonly reason: XirrUnavailableReason };

const DAYS_PER_YEAR = 365;
const MAX_ITERATIONS = 200;
const RATE_TOLERANCE = 1e-12;

/** Same-day flows are aggregated before solving (CAL19). */
export function aggregateByDate(flows: readonly DatedCashFlow[]): DatedCashFlow[] {
  const totals = new Map<IsoDate, Cents>();
  for (const flow of flows) {
    assertCents(flow.cents, `cash flow on ${flow.date}`);
    totals.set(flow.date, (totals.get(flow.date) ?? 0) + flow.cents);
  }
  return [...totals.entries()]
    .filter(([, cents]) => cents !== 0)
    .map(([date, cents]) => ({ date, cents }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function xirr(flows: readonly DatedCashFlow[]): XirrResult {
  const dated = aggregateByDate(flows);
  if (dated.length === 0) return { available: false, reason: 'no-flows' };

  const hasPositive = dated.some((flow) => flow.cents > 0);
  const hasNegative = dated.some((flow) => flow.cents < 0);
  if (!hasPositive || !hasNegative) return { available: false, reason: 'no-sign-change' };

  const first = dated[0];
  if (!first) return { available: false, reason: 'no-flows' };
  const times = dated.map((flow) => daysBetween(first.date, flow.date) / DAYS_PER_YEAR);
  if (times.every((t) => t === 0)) return { available: false, reason: 'no-time-separation' };

  const values = dated.map((flow) => flow.cents);
  const scale = values.reduce((sum, value) => sum + Math.abs(value), 0);

  const npv = (rate: number): number =>
    values.reduce((sum, value, index) => sum + value / Math.pow(1 + rate, times[index] ?? 0), 0);
  const derivative = (rate: number): number =>
    values.reduce((sum, value, index) => {
      const t = times[index] ?? 0;
      return sum - (t * value) / Math.pow(1 + rate, t + 1);
    }, 0);

  const warnings: string[] = [];
  let signChanges = 0;
  for (let index = 1; index < values.length; index += 1) {
    const previous = values[index - 1] ?? 0;
    const current = values[index] ?? 0;
    if (Math.sign(previous) !== Math.sign(current)) signChanges += 1;
  }
  if (signChanges > 1) warnings.push('Multiple sign changes: more than one rate may satisfy these flows.');

  const isRoot = (rate: number): boolean => Number.isFinite(rate) && rate > -1 && Math.abs(npv(rate)) <= scale * 1e-9;

  // Newton from a conventional starting point.
  let rate = 0.1;
  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration += 1) {
    const f = npv(rate);
    const slope = derivative(rate);
    if (!Number.isFinite(f) || !Number.isFinite(slope) || slope === 0) break;
    const next = rate - f / slope;
    if (!Number.isFinite(next) || next <= -1) break;
    if (Math.abs(next - rate) < RATE_TOLERANCE) {
      rate = next;
      break;
    }
    rate = next;
  }
  if (isRoot(rate)) return { available: true, rate, warnings };

  // Bisection on a bracket that is widened until the sign flips.
  let low = -0.999_999;
  let high = 1;
  let fLow = npv(low);
  let fHigh = npv(high);
  let widen = 0;
  while (Math.sign(fLow) === Math.sign(fHigh) && widen < 60) {
    high *= 2;
    fHigh = npv(high);
    widen += 1;
  }
  if (Math.sign(fLow) === Math.sign(fHigh)) return { available: false, reason: 'no-root' };

  for (let iteration = 0; iteration < 500; iteration += 1) {
    const mid = (low + high) / 2;
    const fMid = npv(mid);
    if (Math.abs(fMid) <= scale * 1e-10 || high - low < RATE_TOLERANCE) {
      return isRoot(mid) || Math.abs(fMid) <= scale * 1e-8
        ? { available: true, rate: mid, warnings }
        : { available: false, reason: 'nonconvergent' };
    }
    if (Math.sign(fMid) === Math.sign(fLow)) {
      low = mid;
      fLow = fMid;
    } else {
      high = mid;
    }
  }
  return { available: false, reason: 'nonconvergent' };
}

export interface DatedBalanceMovement {
  readonly date: IsoDate;
  /** Signed change to the balance on that day. */
  readonly cents: Cents;
}

/**
 * The highest running balance a series of dated movements reaches (CAL20):
 * peak debt from principal movements, peak equity from contributions less
 * capital returned. Same-day movements are applied together.
 */
export function peakBalance(movements: readonly DatedBalanceMovement[]): { readonly cents: Cents; readonly on: IsoDate | null } {
  const byDate = aggregateByDate(movements);
  let running = 0;
  let peak = 0;
  let peakOn: IsoDate | null = null;
  for (const movement of byDate) {
    running += movement.cents;
    if (running > peak) {
      peak = running;
      peakOn = movement.date;
    }
  }
  return { cents: peak, on: peakOn };
}
