/**
 * Splitting an amount without creating or destroying a cent (CAL02, WFL02, F12).
 *
 * `allocateMoney` in `shared/lib/money` uses largest-remainder rounding, which
 * is right for bill splits. The development-finance rules instead assign the
 * residual deterministically to the **final eligible part** — the last period
 * of a schedule (CF04) or the last participant after sorting by stable id
 * (WFL02) — so that a split is reproducible from its inputs alone.
 */
import { assertCents, toSafeNumber, type Cents } from './decimal';

/** Weights are scaled to integers before dividing so fractional shares stay exact. */
const WEIGHT_SCALE = 1_000_000_000;

function scaledWeights(weights: readonly number[]): bigint[] {
  return weights.map((weight) => {
    if (!Number.isFinite(weight) || weight < 0) throw new RangeError('Allocation weights must be finite and not negative.');
    return BigInt(Math.round(weight * WEIGHT_SCALE));
  });
}

/**
 * Split `totalCents` across `weights`, flooring every part and giving the
 * residual to the last part with a non-zero weight. Parts always sum exactly
 * to the total; a negative total mirrors the positive split (F12 tests both).
 */
export function allocateResidualToLast(totalCents: Cents, weights: readonly number[]): Cents[] {
  assertCents(totalCents, 'total');
  if (weights.length === 0) return [];
  const scaled = scaledWeights(weights);
  const weightTotal = scaled.reduce((sum, weight) => sum + weight, 0n);
  if (weightTotal <= 0n) throw new RangeError('Allocation weights must sum to a positive value.');

  const lastEligible = scaled.reduce((found, weight, index) => (weight > 0n ? index : found), -1);
  const sign = totalCents < 0 ? -1n : 1n;
  const magnitude = BigInt(Math.abs(totalCents));

  const parts: bigint[] = scaled.map((weight, index) =>
    index === lastEligible ? 0n : (magnitude * weight) / weightTotal,
  );
  const assigned = parts.reduce((sum, part) => sum + part, 0n);
  parts[lastEligible] = magnitude - assigned;

  return parts.map((part) => toSafeNumber(sign * part));
}

export interface Entitlement {
  /** Stable identifier; ties in ordering are broken by it, so the residual owner is deterministic. */
  readonly id: string;
  readonly weight: number;
}

/**
 * Pro rata allocation over named entitlements, sorted by stable id first so
 * the residual cent lands on the same participant every time (WFL02).
 */
export function allocateProRata(totalCents: Cents, entitlements: readonly Entitlement[]): { readonly id: string; readonly cents: Cents }[] {
  const ordered = [...entitlements].sort((a, b) => a.id.localeCompare(b.id));
  const parts = allocateResidualToLast(totalCents, ordered.map((entry) => entry.weight));
  return ordered.map((entry, index) => ({ id: entry.id, cents: parts[index] ?? 0 }));
}
