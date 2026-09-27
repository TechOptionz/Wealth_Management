/**
 * What-if scenario simulator (FR-11): what happens to monthly cash flow if
 * rates rise or a property falls vacant?
 *
 * This file gathers the inputs from the feature modules — the dashboard may
 * read them all — and hands the arithmetic to `applyScenario`. Nothing here is
 * stored: a scenario is a question, not a record, and the answer is recomputed
 * from live figures on every read.
 *
 * The baseline is the latest **posted** month's cash flow (BR-03), the same
 * figure the chart and the cash KPIs show, so "adjusted" reconciles to "actual".
 */
import { formatMonthShort } from '@/shared/lib/dates';
import { money, subtractMoney, sumMoney } from '@/shared/lib/money';
import type { IsoDate, PropertyId } from '@/shared/types/common';
import { loansRepository } from '@/modules/loans/repository';
import { leasesRepository } from '@/modules/leases/repository';
import { leasesService } from '@/modules/leases/service';
import { propertiesService } from '@/modules/properties/service';
import { cashFlowService } from '@/modules/reconciliation/service';
import { applyScenario } from './scenario-math';
import type { ScenarioInputs, ScenarioResult } from './model';

/**
 * Everything a scenario needs, as plain data.
 *
 * Only variable-rate liabilities are exposed to the rate shock. A fixed rate is
 * a contract until its review date, and a receivable is money owed *to* the
 * portfolio (FR-11): a rate rise on it would be income, not cost, and the seeded
 * one is a private loan whose rate does not track the market. Properties the
 * portfolio does not rent — the own home, a development site — are not offered
 * as vacancies because they produce no rent to lose.
 */
export function scenarioInputs(asOf: IsoDate): ScenarioInputs {
  const posted = cashFlowService.latestMonth(asOf);
  const baselineReceipts = posted?.receipts ?? money(0);
  const baselineOutgoings = posted?.outgoings ?? money(0);

  const liabilities = loansRepository.listLiabilities();
  const fixed = liabilities.filter((loan) => loan.rate.type === 'fixed');

  return {
    asOf,
    baselineMonth: posted?.month ?? null,
    baselineMonthLabel: posted ? formatMonthShort(posted.month) : null,
    baselineReceipts,
    baselineOutgoings,
    baselineCashFlow: subtractMoney(baselineReceipts, baselineOutgoings),
    variableFacilities: liabilities
      .filter((loan) => loan.rate.type === 'variable')
      .map((loan) => ({
        loanId: loan.id,
        label: `${loan.lender} · ${loan.facilityName}`,
        balance: loan.balance,
        annualRate: loan.rate.annual,
      })),
    fixedDebt: sumMoney(fixed.map((loan) => loan.balance)),
    fixedFacilityCount: fixed.length,
    properties: propertiesService
      .list()
      .filter((property) => property.rentalMode !== 'not-rented')
      .map((property) => ({
        propertyId: property.id,
        name: property.name,
        monthlyRent: leasesService.monthlyRentForProperty(property.id, asOf),
        leaseCount: leasesRepository
          .listForProperty(property.id)
          .filter((lease) => lease.startsOn <= asOf && lease.endsOn >= asOf).length,
      })),
  };
}

/** Evaluate one scenario against live figures (FR-11). */
export function simulateScenario(input: {
  readonly rateDeltaPercent: number;
  readonly vacantPropertyIds?: readonly PropertyId[];
  readonly asOf: IsoDate;
}): ScenarioResult {
  return applyScenario(scenarioInputs(input.asOf), input);
}
