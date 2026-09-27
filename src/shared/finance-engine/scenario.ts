/**
 * Scenario arithmetic (SCN02, SCN03, F08).
 *
 * An uplift applies to an eligible base only — remaining uncommitted forecast,
 * optionally unbilled commitments, never settled cash — and monetary variances
 * are scenario minus base while percentage metrics compare in percentage points.
 */
import type { Available } from '@/shared/lib/result';
import { applyPpm, assertCents, type Cents, type Ppm } from './decimal';

/** The cents added by an uplift on the eligible amount; negative ppm reduces it. */
export function upliftCents(eligibleCents: Cents, upliftPpm: Ppm): Cents {
  assertCents(eligibleCents, 'eligible amount');
  return applyPpm(eligibleCents, upliftPpm);
}

export function moneyVariance(scenarioCents: Cents, baseCents: Cents): Cents {
  assertCents(scenarioCents, 'scenario');
  assertCents(baseCents, 'base');
  return scenarioCents - baseCents;
}

/** Percentage-point difference; unavailable when either side is unavailable. */
export function percentagePointVariance(scenario: Available<number>, base: Available<number>): Available<number> {
  if (!scenario.available) return scenario;
  if (!base.available) return base;
  return { available: true, value: scenario.value - base.value };
}
