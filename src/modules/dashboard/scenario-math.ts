/**
 * What-if scenario arithmetic (FR-11).
 *
 * Pure: it takes `ScenarioInputs` and returns a `ScenarioResult`, touching no
 * repository or service. That is what lets the dashboard drawer recompute on
 * every click in the browser while the tests and the JSON route run the very
 * same function on the server — one implementation, so the two cannot drift.
 *
 * Interest is one month of simple interest on the current balance. Repayment
 * schedules are not re-amortised: the question is "how much more will this
 * cost each month", not "what will the lender's new instalment be".
 */
import { ValidationError } from '@/shared/lib/errors';
import { addMoney, money, scaleMoney, subtractMoney, sumMoney } from '@/shared/lib/money';
import type { ScenarioFacilityImpact, ScenarioInputs, ScenarioParameters, ScenarioResult } from './model';

/** Rate shocks the drawer offers, in percentage points. */
export const RATE_SHOCK_OPTIONS: readonly number[] = [0.25, 0.5, 1, 2];

/** Horizon for the buffer tile: a rate rise or a vacancy rarely resolves inside a quarter. */
export const SCENARIO_BUFFER_MONTHS = 6;

/** Widest shock accepted either way. Beyond this the input is a typo, not a scenario. */
export const MAX_RATE_DELTA_PERCENT = 10;

export function applyScenario(inputs: ScenarioInputs, params: ScenarioParameters): ScenarioResult {
  const { rateDeltaPercent } = params;
  if (!Number.isFinite(rateDeltaPercent) || Math.abs(rateDeltaPercent) > MAX_RATE_DELTA_PERCENT) {
    throw new ValidationError(
      `Enter a rate change between −${MAX_RATE_DELTA_PERCENT}% and +${MAX_RATE_DELTA_PERCENT}%.`,
      { fieldErrors: { rateDeltaPercent: ['Use percentage points, e.g. 0.25 for a quarter-point rise.'] } },
    );
  }
  const rateDelta = rateDeltaPercent / 100;

  // Rounded per facility so the breakdown rows add up to the tile exactly (BR-06).
  const facilities = inputs.variableFacilities.map<ScenarioFacilityImpact>((facility) => {
    const baselineInterest = scaleMoney(facility.balance, facility.annualRate / 12);
    const additionalInterest = scaleMoney(facility.balance, rateDelta / 12);
    return {
      ...facility,
      simulatedRate: facility.annualRate + rateDelta,
      baselineInterest,
      additionalInterest,
      simulatedInterest: addMoney(baselineInterest, additionalInterest),
    };
  });

  // Unknown ids are dropped and repeats collapse: a property can only be vacant once.
  const requested = new Set(params.vacantPropertyIds ?? []);
  const vacancies = inputs.properties.filter((property) => requested.has(property.propertyId));

  const interestImpact = sumMoney(facilities.map((facility) => facility.additionalInterest));
  const rentalImpact = sumMoney(vacancies.map((property) => property.monthlyRent));
  // Both impacts are costs; the delta is the movement in cash flow, so it carries the
  // opposite sign. Subtracting from zero rather than negating keeps a no-change
  // scenario at +0, not -0, which strict equality would otherwise tell apart.
  const monthlyDelta = subtractMoney(money(0, interestImpact.currency), addMoney(interestImpact, rentalImpact));

  return {
    asOf: inputs.asOf,
    baselineMonthLabel: inputs.baselineMonthLabel,
    rateDeltaPercent,
    vacantPropertyIds: vacancies.map((property) => property.propertyId),
    baselineCashFlow: inputs.baselineCashFlow,
    simulatedCashFlow: addMoney(inputs.baselineCashFlow, monthlyDelta),
    monthlyDelta,
    interestImpact,
    rentalImpact,
    baselineVariableInterest: sumMoney(facilities.map((facility) => facility.baselineInterest)),
    simulatedVariableInterest: sumMoney(facilities.map((facility) => facility.simulatedInterest)),
    variableDebt: sumMoney(inputs.variableFacilities.map((facility) => facility.balance)),
    fixedDebt: inputs.fixedDebt,
    bufferMonths: SCENARIO_BUFFER_MONTHS,
    bufferImpact: scaleMoney(monthlyDelta, SCENARIO_BUFFER_MONTHS),
    facilities,
    vacancies,
  };
}
