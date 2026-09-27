/**
 * Development profit and the two margin measures (CAL13, F07).
 *
 * Profit before income tax = net revenue − economic development costs −
 * finance costs. Margin on cost divides by total economic cost *including*
 * finance; margin on revenue divides by net revenue. A zero denominator returns
 * Not Available with a reason, never 0%.
 */
import { available, unavailable, type Available } from '@/shared/lib/result';
import { assertCents, type Cents } from './decimal';

export interface ProfitInput {
  readonly netRevenueCents: Cents;
  /** Economic development cost, excluding finance. */
  readonly economicCostCents: Cents;
  readonly financeCostCents: Cents;
}

export interface ProfitMeasures {
  readonly profitCents: Cents;
  /** Economic cost including finance — the margin-on-cost denominator. */
  readonly totalCostCents: Cents;
  readonly marginOnCost: Available<number>;
  readonly marginOnRevenue: Available<number>;
}

export function developmentProfit(input: ProfitInput): ProfitMeasures {
  assertCents(input.netRevenueCents, 'net revenue');
  assertCents(input.economicCostCents, 'economic cost');
  assertCents(input.financeCostCents, 'finance cost');

  const totalCost = input.economicCostCents + input.financeCostCents;
  const profit = input.netRevenueCents - totalCost;
  return {
    profitCents: profit,
    totalCostCents: totalCost,
    marginOnCost: totalCost === 0 ? unavailable('Not available · total cost is zero') : available(profit / totalCost),
    marginOnRevenue:
      input.netRevenueCents === 0 ? unavailable('Not available · net revenue is zero') : available(profit / input.netRevenueCents),
  };
}
