/**
 * FR-11 — what-if scenarios on the dashboard.
 *
 * A rate shock must reach variable-rate debt and nothing else: a fixed rate is a
 * contract until its review date, and a receivable is money owed *to* the
 * portfolio. A vacancy must remove exactly the rent the property produces today.
 * Every expected figure below is derived by hand from the seed, not from the code.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ForbiddenError, ValidationError } from '@/shared/lib/errors';
import { fromMajorUnits } from '@/shared/lib/money';
import { asId } from '@/shared/types/common';
import { accessService } from '@/modules/access/service';
import { USER_IDS } from '@/modules/access/data/seed';
import { dashboardApi } from '@/modules/dashboard/api';
import { applyScenario, SCENARIO_BUFFER_MONTHS } from '@/modules/dashboard/scenario-math';
import { scenarioInputs, simulateScenario } from '@/modules/dashboard/scenarios';
import { ENTITY_IDS, PROPERTY_IDS } from '@/modules/entities/data/seed';
import { leasesService } from '@/modules/leases/service';
import { LOAN_IDS } from '@/modules/loans/data/seed';
import type { Loan } from '@/modules/loans/model';
import { loansRepository } from '@/modules/loans/repository';

/** The pinned prototype date; August 2026 is the latest posted month. */
const AS_OF = '2026-09-06';

/** Aug 2026 posted: receipts $28,410 − outgoings $19,870 = $8,540. */
const BASELINE_CENTS = 854_000;

/**
 * +1.00% on the seeded variable liabilities, rounded per facility:
 *   CBA 8820  $1,184,000 × 1% ÷ 12 = $986.67
 *   ANZ 3305    $410,300 × 1% ÷ 12 = $341.92
 * Macquarie 4417 is fixed and the Khalid loan is a receivable — neither counts.
 */
const ONE_PERCENT_CENTS = 98_667 + 34_192;

/** Benton St: Patel pays $1,380 a fortnight; × 26 ÷ 12 = $2,990 a month. */
const BENTON_MONTHLY_RENT_CENTS = 299_000;

function facility(overrides: Partial<Loan> & Pick<Loan, 'id' | 'direction' | 'balance' | 'rate'>): Loan {
  return {
    lender: 'Test Bank',
    facilityName: `Facility ${overrides.id}`,
    counterpartyLabel: 'Test borrower',
    borrowerEntityIds: [ENTITY_IDS.jawad],
    balanceAsOf: AS_OF,
    repayment: {
      type: 'IO',
      monthly: fromMajorUnits(0),
      principalComponent: fromMajorUnits(0),
      interestComponent: fromMajorUnits(0),
    },
    security: { kind: 'unsecured', propertyIds: [], label: 'Unsecured' },
    ...overrides,
  };
}

beforeEach(() => {
  loansRepository.reset();
});

// The active user is process-wide state; leave it as the owner for other suites.
afterEach(() => {
  accessService.switchUser(USER_IDS.jawad);
});

describe('FR-11 simulateScenario · baseline', () => {
  it('reproduces the latest posted month when nothing is shocked', () => {
    const result = simulateScenario({ rateDeltaPercent: 0, asOf: AS_OF });

    expect(result.baselineMonthLabel).toBe('Aug');
    expect(result.baselineCashFlow.cents).toBe(BASELINE_CENTS);
    expect(result.simulatedCashFlow.cents).toBe(BASELINE_CENTS);
    expect(result.monthlyDelta.cents).toBe(0);
    expect(result.interestImpact.cents).toBe(0);
    expect(result.rentalImpact.cents).toBe(0);
    expect(result.bufferImpact.cents).toBe(0);
    expect(result.vacancies).toEqual([]);
  });

  it('exposes only variable-rate liabilities to the shock', () => {
    const ids = scenarioInputs(AS_OF).variableFacilities.map((entry) => entry.loanId);

    expect(ids).toEqual([LOAN_IDS.cba8820, LOAN_IDS.anz3305]);
    expect(ids).not.toContain(LOAN_IDS.macquarie4417);
    expect(ids).not.toContain(LOAN_IDS.khalidReceivable);
  });

  it('reports the fixed-rate debt a shock leaves untouched', () => {
    const inputs = scenarioInputs(AS_OF);

    expect(inputs.fixedFacilityCount).toBe(1);
    expect(inputs.fixedDebt.cents).toBe(61_240_000);
  });
});

describe('FR-11 simulateScenario · rate shock', () => {
  it('charges one month of the extra rate on each variable liability', () => {
    const result = simulateScenario({ rateDeltaPercent: 1, asOf: AS_OF });

    expect(result.interestImpact.cents).toBe(ONE_PERCENT_CENTS);
    expect(result.rentalImpact.cents).toBe(0);
    expect(result.monthlyDelta.cents).toBe(-ONE_PERCENT_CENTS);
    expect(result.simulatedCashFlow.cents).toBe(BASELINE_CENTS - ONE_PERCENT_CENTS);

    const cba = result.facilities.find((entry) => entry.loanId === LOAN_IDS.cba8820);
    expect(cba?.additionalInterest.cents).toBe(98_667);
    expect(cba?.simulatedRate).toBeCloseTo(0.0734, 10);
  });

  it('scales with the size of the shock', () => {
    // CBA × 0.25% ÷ 12 = $246.67 · ANZ × 0.25% ÷ 12 = $85.48
    expect(simulateScenario({ rateDeltaPercent: 0.25, asOf: AS_OF }).interestImpact.cents).toBe(24_667 + 8_548);
    // CBA × 2% ÷ 12 = $1,973.33 · ANZ × 2% ÷ 12 = $683.83
    expect(simulateScenario({ rateDeltaPercent: 2, asOf: AS_OF }).interestImpact.cents).toBe(197_333 + 68_383);
  });

  it('ignores fixed-rate debt and receivables, and counts a new variable liability', () => {
    const before = simulateScenario({ rateDeltaPercent: 1, asOf: AS_OF }).interestImpact.cents;

    loansRepository.insert(
      facility({
        id: asId<'Loan'>('loan-test-fixed'),
        direction: 'liability',
        balance: fromMajorUnits(120_000),
        rate: { annual: 0.06, type: 'fixed', fixedUntil: '2028-01-01' },
      }),
    );
    expect(simulateScenario({ rateDeltaPercent: 1, asOf: AS_OF }).interestImpact.cents).toBe(before);

    loansRepository.insert(
      facility({
        id: asId<'Loan'>('loan-test-receivable'),
        direction: 'receivable',
        balance: fromMajorUnits(120_000),
        rate: { annual: 0.06, type: 'variable' },
      }),
    );
    expect(simulateScenario({ rateDeltaPercent: 1, asOf: AS_OF }).interestImpact.cents).toBe(before);

    // $120,000 × 1% ÷ 12 = exactly $100 more each month.
    loansRepository.insert(
      facility({
        id: asId<'Loan'>('loan-test-variable'),
        direction: 'liability',
        balance: fromMajorUnits(120_000),
        rate: { annual: 0.06, type: 'variable' },
      }),
    );
    expect(simulateScenario({ rateDeltaPercent: 1, asOf: AS_OF }).interestImpact.cents).toBe(before + 10_000);
  });

  it('reports simulated interest as current interest plus the increase', () => {
    const result = simulateScenario({ rateDeltaPercent: 1, asOf: AS_OF });

    // CBA $1,184,000 × 6.34% ÷ 12 = $6,255.47 · ANZ $410,300 × 6.19% ÷ 12 = $2,116.46
    expect(result.baselineVariableInterest.cents).toBe(625_547 + 211_646);
    expect(result.simulatedVariableInterest.cents).toBe(
      result.baselineVariableInterest.cents + result.interestImpact.cents,
    );
    result.facilities.forEach((entry) => {
      expect(entry.simulatedInterest.cents).toBe(entry.baselineInterest.cents + entry.additionalInterest.cents);
    });
  });

  it('treats a rate cut as a saving', () => {
    const result = simulateScenario({ rateDeltaPercent: -0.5, asOf: AS_OF });

    expect(result.interestImpact.cents).toBeLessThan(0);
    expect(result.monthlyDelta.cents).toBe(-result.interestImpact.cents);
    expect(result.simulatedCashFlow.cents).toBeGreaterThan(BASELINE_CENTS);
  });

  it('rejects a shock that is not a number or is implausibly large', () => {
    const inputs = scenarioInputs(AS_OF);

    expect(() => applyScenario(inputs, { rateDeltaPercent: Number.NaN })).toThrow(ValidationError);
    expect(() => applyScenario(inputs, { rateDeltaPercent: 11 })).toThrow(ValidationError);
    expect(() => applyScenario(inputs, { rateDeltaPercent: 10 })).not.toThrow();
  });
});

describe('FR-11 simulateScenario · vacancy', () => {
  it('deducts the monthly-equivalent rent of a vacated property', () => {
    const result = simulateScenario({
      rateDeltaPercent: 0,
      vacantPropertyIds: [PROPERTY_IDS.bentonSt],
      asOf: AS_OF,
    });

    expect(result.rentalImpact.cents).toBe(BENTON_MONTHLY_RENT_CENTS);
    expect(result.interestImpact.cents).toBe(0);
    expect(result.monthlyDelta.cents).toBe(-BENTON_MONTHLY_RENT_CENTS);
    expect(result.simulatedCashFlow.cents).toBe(BASELINE_CENTS - BENTON_MONTHLY_RENT_CENTS);
    expect(result.vacancies.map((entry) => entry.propertyId)).toEqual([PROPERTY_IDS.bentonSt]);
  });

  it('removes every live room lease when a by-room property is vacated', () => {
    const result = simulateScenario({
      rateDeltaPercent: 0,
      vacantPropertyIds: [PROPERTY_IDS.comptonRd],
      asOf: AS_OF,
    });

    // Compton Rd rooms: $350, $330, $340 and $360 a week plus $500 a fortnight,
    // each annualised then divided by twelve and rounded to the cent.
    expect(result.rentalImpact.cents).toBe(151_667 + 143_000 + 147_333 + 156_000 + 108_333);
    expect(result.rentalImpact).toEqual(leasesService.monthlyRentForProperty(PROPERTY_IDS.comptonRd, AS_OF));
  });

  it('loses nothing on a property with no live lease', () => {
    // Mians Rd: the Kaur lease ended 20 Aug 2026.
    const offered = scenarioInputs(AS_OF).properties.find((entry) => entry.propertyId === PROPERTY_IDS.miansRd);
    expect(offered?.monthlyRent.cents).toBe(0);
    expect(offered?.leaseCount).toBe(0);

    const result = simulateScenario({
      rateDeltaPercent: 0,
      vacantPropertyIds: [PROPERTY_IDS.miansRd],
      asOf: AS_OF,
    });
    expect(result.rentalImpact.cents).toBe(0);
    expect(result.vacancies).toHaveLength(1);
  });

  it('drops unknown ids and counts a repeated property once', () => {
    const result = simulateScenario({
      rateDeltaPercent: 0,
      vacantPropertyIds: [PROPERTY_IDS.bentonSt, PROPERTY_IDS.bentonSt, asId<'Property'>('prop-nope')],
      asOf: AS_OF,
    });

    expect(result.rentalImpact.cents).toBe(BENTON_MONTHLY_RENT_CENTS);
    expect(result.vacantPropertyIds).toEqual([PROPERTY_IDS.bentonSt]);
  });

  it('never offers the own home or a development site as a vacancy', () => {
    const offered = scenarioInputs(AS_OF).properties.map((entry) => entry.propertyId);

    expect(offered).not.toContain(PROPERTY_IDS.watsonRd);
    expect(offered).not.toContain(PROPERTY_IDS.loganReserve);
    expect(offered).toContain(PROPERTY_IDS.bentonSt);
    expect(offered).toContain(PROPERTY_IDS.comptonRd);
  });
});

describe('FR-11 simulateScenario · combined', () => {
  it('adds both impacts and projects the buffer over six months', () => {
    const result = simulateScenario({
      rateDeltaPercent: 1,
      vacantPropertyIds: [PROPERTY_IDS.bentonSt],
      asOf: AS_OF,
    });
    const expectedDelta = -(ONE_PERCENT_CENTS + BENTON_MONTHLY_RENT_CENTS);

    expect(result.monthlyDelta.cents).toBe(expectedDelta);
    expect(result.simulatedCashFlow.cents).toBe(BASELINE_CENTS + expectedDelta);
    expect(result.bufferMonths).toBe(SCENARIO_BUFFER_MONTHS);
    expect(result.bufferImpact.cents).toBe(expectedDelta * 6);
  });

  it('gives the same answer from gathered inputs as from the server-side call', () => {
    const params = { rateDeltaPercent: 0.5, vacantPropertyIds: [PROPERTY_IDS.comptonRd] };

    expect(applyScenario(scenarioInputs(AS_OF), params)).toEqual(simulateScenario({ ...params, asOf: AS_OF }));
  });
});

describe('FR-11 dashboardApi.simulateScenario · NFR-01', () => {
  it('serves the portfolio owner and accepts raw ids from a query string', () => {
    const result = dashboardApi.simulateScenario({
      rateDeltaPercent: 1,
      vacantPropertyIds: [PROPERTY_IDS.bentonSt],
      asOf: AS_OF,
    });

    expect(result.rentalImpact.cents).toBe(BENTON_MONTHLY_RENT_CENTS);
    expect(result.interestImpact.cents).toBe(ONE_PERCENT_CENTS);
  });

  it('refuses a persona without portfolio totals, so a direct URL cannot leak debt figures', () => {
    accessService.switchUser(USER_IDS.accountant);

    expect(() => dashboardApi.simulateScenario({ rateDeltaPercent: 1, asOf: AS_OF })).toThrow(ForbiddenError);
    expect(() => dashboardApi.scenarioInputs(AS_OF)).toThrow(ForbiddenError);
  });
});
