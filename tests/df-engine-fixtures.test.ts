/**
 * Development Finance — golden calculation fixtures F01…F12 (§11.6).
 *
 * These are the independent synthetic oracles from the requirements document,
 * hand-derived, not generated from the code. If a change to the engine makes
 * one fail, the engine is wrong until proven otherwise.
 */
import { describe, expect, it } from 'vitest';
import {
  allocateProRata,
  allocateResidualToLast,
  applyFundingOrder,
  costLinePosition,
  developmentProfit,
  distributeEqualMonthly,
  distributeWeighted,
  economicCost,
  grossFromNet,
  ledgerReconciles,
  moneyVariance,
  percentToPpm,
  runFacilityLedger,
  runWaterfall,
  settlementReceipt,
  simpleInterest,
  sumPositions,
  taxFromGross,
  taxOnNet,
  upliftCents,
  xirr,
  formatPpmAsPercent,
  peakBalance,
  MarginSchemeUnavailableError,
} from '@/shared/finance-engine';

const $ = (dollars: number): number => Math.round(dollars * 100);

describe('F01 · standard GST', () => {
  it('net 1000.00 at 10%, fully recoverable → tax 100.00, gross 1100.00, economic cost 1000.00', () => {
    const tax = taxOnNet($(1000), 'standard-gst');
    const gross = grossFromNet($(1000), 'standard-gst');
    expect(tax).toBe($(100));
    expect(gross).toBe($(1100));
    expect(economicCost(gross, tax)).toBe($(1000));
  });

  it('tax inside a gross amount is gross × rate ÷ (1 + rate), which is gross ÷ 11 only at 10%', () => {
    expect(taxFromGross($(1100), 'standard-gst')).toBe($(100));
    expect(taxFromGross($(1100), 'standard-gst', { standardRatePpm: percentToPpm('15'), marginSchemeEnabled: false })).toBe(
      Math.round(($(1100) * 15) / 115),
    );
    expect(taxFromGross($(1100), 'gst-free')).toBe(0);
  });

  it('margin scheme is not computable until finance review enables a method (CAL11)', () => {
    expect(() => taxOnNet($(1000), 'margin-scheme')).toThrow(MarginSchemeUnavailableError);
  });

  it('reads percentages exactly: "10.1" is 101 000 ppm, shown back as 10.10%', () => {
    expect(percentToPpm('10.1')).toBe(101_000);
    expect(percentToPpm(10)).toBe(100_000);
    expect(percentToPpm('0.75')).toBe(7_500);
    expect(formatPpmAsPercent(101_000)).toBe('10.10%');
    expect(() => percentToPpm('0.10.5')).toThrow();
  });
});

describe('F02 · land subtotal', () => {
  it('a parent summarising deposit 100 000 and settlement 900 000 totals 1 000 000, never 2 000 000', () => {
    const deposit = costLinePosition({
      baselineCents: $(100_000),
      commitments: [],
      directSpendApprovedCents: $(100_000),
      settledCashCents: $(100_000),
      uncommittedAllowanceCents: 0,
    });
    const settlement = costLinePosition({
      baselineCents: $(900_000),
      commitments: [],
      directSpendApprovedCents: 0,
      settledCashCents: 0,
      uncommittedAllowanceCents: $(900_000),
    });
    const parent = sumPositions([deposit, settlement]);
    expect(parent.expectedFinalCostCents).toBe($(1_000_000));
    expect(parent.varianceCents).toBe(0);
  });
});

describe('F03 · commitment conversion', () => {
  const base = {
    baselineCents: $(110_000),
    commitments: [{ id: 'c1', revisedValueCents: $(88_000), approvedInvoicedCents: $(33_000) }],
    directSpendApprovedCents: 0,
    settledCashCents: $(11_000),
    uncommittedAllowanceCents: $(22_000),
  };

  it('B 110000; C 88000; I 33000; P 11000; U 22000 → A 22000; R 55000; EAC 110000; remaining cash 99000', () => {
    const position = costLinePosition(base);
    expect(position.approvedCostCents).toBe($(33_000));
    expect(position.approvedUnpaidCents).toBe($(22_000));
    expect(position.unbilledCommitmentCents).toBe($(55_000));
    expect(position.expectedFinalCostCents).toBe($(110_000));
    expect(position.remainingCashCents).toBe($(99_000));
    expect(position.varianceCents).toBe(0);
  });

  it('F03a · another 11000 approved against the commitment → I 44000; A 33000; R 44000; EAC unchanged', () => {
    const position = costLinePosition({
      ...base,
      commitments: [{ id: 'c1', revisedValueCents: $(88_000), approvedInvoicedCents: $(44_000) }],
    });
    expect(position.approvedCostCents).toBe($(44_000));
    expect(position.approvedUnpaidCents).toBe($(33_000));
    expect(position.unbilledCommitmentCents).toBe($(44_000));
    expect(position.expectedFinalCostCents).toBe($(110_000));
  });

  it('F03b · then a payment of 11000 → P 22000; A 22000; EAC 110000; remaining cash 88000', () => {
    const position = costLinePosition({
      ...base,
      commitments: [{ id: 'c1', revisedValueCents: $(88_000), approvedInvoicedCents: $(44_000) }],
      settledCashCents: $(22_000),
    });
    expect(position.settledCashCents).toBe($(22_000));
    expect(position.approvedUnpaidCents).toBe($(22_000));
    expect(position.expectedFinalCostCents).toBe($(110_000));
    expect(position.remainingCashCents).toBe($(88_000));
  });

  it('sums unbilled per commitment, so one contract’s underspend cannot hide another’s overrun', () => {
    const position = costLinePosition({
      baselineCents: null,
      commitments: [
        { id: 'under', revisedValueCents: $(10_000), approvedInvoicedCents: $(4_000) },
        { id: 'over', revisedValueCents: $(10_000), approvedInvoicedCents: $(13_000) },
      ],
      directSpendApprovedCents: 0,
      settledCashCents: 0,
      uncommittedAllowanceCents: 0,
    });
    expect(position.unbilledCommitmentCents).toBe($(6_000));
    expect(position.expectedFinalCostCents).toBe($(23_000));
    expect(position.varianceCents).toBeNull();
  });
});

describe('F04 · direct spend', () => {
  it('I 0; U 10000; approve 3000 matched to U → I 3000; U 7000; EAC unchanged at 10000', () => {
    const before = costLinePosition({
      baselineCents: $(10_000),
      commitments: [],
      directSpendApprovedCents: 0,
      settledCashCents: 0,
      uncommittedAllowanceCents: $(10_000),
    });
    const after = costLinePosition({
      baselineCents: $(10_000),
      commitments: [],
      directSpendApprovedCents: $(3_000),
      settledCashCents: 0,
      uncommittedAllowanceCents: $(7_000),
    });
    expect(before.expectedFinalCostCents).toBe($(10_000));
    expect(after.approvedCostCents).toBe($(3_000));
    expect(after.uncommittedAllowanceCents).toBe($(7_000));
    expect(after.expectedFinalCostCents).toBe($(10_000));
  });

  it('unmatched additional scope increases EAC instead of consuming an unrelated allowance', () => {
    const after = costLinePosition({
      baselineCents: $(10_000),
      commitments: [],
      directSpendApprovedCents: $(3_000),
      settledCashCents: 0,
      uncommittedAllowanceCents: $(10_000),
    });
    expect(after.expectedFinalCostCents).toBe($(13_000));
    expect(after.varianceCents).toBe($(3_000));
  });
});

describe('F05 · one year return', () => {
  it('−1 000 000 on 1 Jan 2027 and +1 250 000 on 1 Jan 2028 → XIRR 25.000000%', () => {
    const result = xirr([
      { date: '2027-01-01', cents: -$(1_000_000) },
      { date: '2028-01-01', cents: $(1_250_000) },
    ]);
    expect(result.available).toBe(true);
    if (result.available) {
      expect(result.rate * 100).toBeCloseTo(25, 6);
      expect(result.warnings).toEqual([]);
    }
  });

  it('same-sign flows return Not Available (AT15)', () => {
    const result = xirr([
      { date: '2027-01-01', cents: $(100) },
      { date: '2028-01-01', cents: $(200) },
    ]);
    expect(result).toEqual({ available: false, reason: 'no-sign-change' });
  });

  it('flows on one day return Not Available, and same-day flows are aggregated first', () => {
    expect(
      xirr([
        { date: '2027-01-01', cents: -$(100) },
        { date: '2027-01-01', cents: $(150) },
      ]),
    ).toEqual({ available: false, reason: 'no-sign-change' });
    expect(
      xirr([
        { date: '2027-01-01', cents: -$(100) },
        { date: '2027-01-01', cents: $(150) },
        { date: '2027-01-01', cents: -$(100) },
      ]),
    ).toEqual({ available: false, reason: 'no-sign-change' });
  });

  it('flags multiple sign changes rather than silently choosing a root', () => {
    const result = xirr([
      { date: '2027-01-01', cents: -$(1_000) },
      { date: '2027-07-01', cents: $(2_500) },
      { date: '2028-01-01', cents: -$(1_600) },
    ]);
    if (result.available) expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('peak balance tracks the highest running total of dated movements (CAL20)', () => {
    const peak = peakBalance([
      { date: '2027-01-01', cents: $(500) },
      { date: '2027-02-01', cents: $(700) },
      { date: '2027-03-01', cents: -$(300) },
      { date: '2027-04-01', cents: $(100) },
    ]);
    expect(peak).toEqual({ cents: $(1_200), on: '2027-02-01' });
  });
});

describe('F06 · debt interest', () => {
  it('1 000 000 drawn 1 Jan 2027 at 10%, 31 daily accruals, ACT/365F → 8493.15 capitalised, closing 1 008 493.15', () => {
    const ledger = runFacilityLedger(
      {
        limitCents: $(2_000_000),
        openingPrincipalCents: 0,
        openingOn: '2027-01-01',
        rateSteps: [{ from: '2027-01-01', ratePpm: percentToPpm('10') }],
        dayCount: 'ACT/365F',
        interestTreatment: 'capitalised',
      },
      [{ on: '2027-01-01', kind: 'draw', cents: $(1_000_000) }],
      '2027-01',
      '2027-01',
    );
    const january = ledger.months[0];
    expect(january?.capitalisedInterestCents).toBe($(8_493.15));
    expect(january?.closingPrincipalCents).toBe($(1_008_493.15));
    expect(ledger.peakPrincipalCents).toBe($(1_008_493.15));
    expect(ledgerReconciles(ledger)).toBe(true);
  });

  it('capitalised interest accrues from the following day, and a rate change splits the accrual', () => {
    const ledger = runFacilityLedger(
      {
        limitCents: $(2_000_000),
        openingPrincipalCents: 0,
        openingOn: '2027-01-01',
        rateSteps: [
          { from: '2027-01-01', ratePpm: percentToPpm('10') },
          { from: '2027-02-15', ratePpm: percentToPpm('12') },
        ],
        dayCount: 'ACT/365F',
        interestTreatment: 'capitalised',
      },
      [{ on: '2027-01-01', kind: 'draw', cents: $(1_000_000) }],
      '2027-01',
      '2027-02',
    );
    const february = ledger.months[1];
    // February opens on the January closing balance: 14 days at 10% and 14 days at 12%.
    const opening = $(1_008_493.15);
    const expected = Math.round((opening * 0.1 * 14) / 365 + (opening * 0.12 * 14) / 365);
    expect(february?.openingPrincipalCents).toBe(opening);
    expect(february?.capitalisedInterestCents).toBe(expected);
    expect(ledgerReconciles(ledger)).toBe(true);
  });

  it('cash interest never increases principal, and a breach of the limit stays visible', () => {
    const ledger = runFacilityLedger(
      {
        limitCents: $(900_000),
        openingPrincipalCents: 0,
        openingOn: '2027-01-01',
        rateSteps: [{ from: '2027-01-01', ratePpm: percentToPpm('10') }],
        dayCount: 'ACT/365F',
        interestTreatment: 'cash',
        maturityOn: '2027-12-31',
      },
      [{ on: '2027-01-01', kind: 'draw', cents: $(1_000_000) }],
      '2027-01',
      '2027-01',
    );
    const january = ledger.months[0];
    expect(january?.cashInterestCents).toBe($(8_493.15));
    expect(january?.closingPrincipalCents).toBe($(1_000_000));
    expect(january?.breaches.map((breach) => breach.kind)).toEqual(['limit']);
  });

  it('simple interest for a whole period rounds once', () => {
    expect(simpleInterest($(1_000_000), percentToPpm('10'), 31)).toBe($(8_493.15));
  });
});

describe('F07 · profit measures', () => {
  it('net revenue 5 000 000; economic cost including finance 4 000 000 → profit 1 000 000; 25% on cost; 20% on revenue', () => {
    const measures = developmentProfit({
      netRevenueCents: $(5_000_000),
      economicCostCents: $(3_800_000),
      financeCostCents: $(200_000),
    });
    expect(measures.profitCents).toBe($(1_000_000));
    expect(measures.marginOnCost).toEqual({ available: true, value: 0.25 });
    expect(measures.marginOnRevenue).toEqual({ available: true, value: 0.2 });
  });

  it('zero denominators return Not Available with a reason', () => {
    const measures = developmentProfit({ netRevenueCents: 0, economicCostCents: 0, financeCostCents: 0 });
    expect(measures.marginOnCost.available).toBe(false);
    expect(measures.marginOnRevenue.available).toBe(false);
  });
});

describe('F08 · scenario uplift', () => {
  it('F07 with 1 000 000 of remaining eligible costs increased 5% → cost 4 050 000; profit 950 000; variances ±50 000', () => {
    const uplift = upliftCents($(1_000_000), percentToPpm('5'));
    const scenario = developmentProfit({
      netRevenueCents: $(5_000_000),
      economicCostCents: $(3_800_000) + uplift,
      financeCostCents: $(200_000),
    });
    expect(scenario.totalCostCents).toBe($(4_050_000));
    expect(scenario.profitCents).toBe($(950_000));
    expect(moneyVariance(scenario.totalCostCents, $(4_000_000))).toBe($(50_000));
    expect(moneyVariance(scenario.profitCents, $(1_000_000))).toBe(-$(50_000));
  });
});

describe('F09 · settlement withholding', () => {
  it('gross 1 100 000; output GST 100 000; withholding 70 000 → cash 1 030 000; credit 70 000; residual GST 30 000; net revenue 1 000 000', () => {
    const result = settlementReceipt({
      grossConsiderationCents: $(1_100_000),
      outputGstCents: $(100_000),
      withholdingCents: $(70_000),
    });
    expect(result.cashToSellerCents).toBe($(1_030_000));
    expect(result.withholdingCreditCents).toBe($(70_000));
    expect(result.residualGstCents).toBe($(30_000));
    expect(result.netRevenueCents).toBe($(1_000_000));
    // The ledger reconciles: cash + credit = consideration; credit + residual = output GST.
    expect(result.cashToSellerCents + result.withholdingCreditCents).toBe($(1_100_000));
    expect(result.withholdingCreditCents + result.residualGstCents).toBe($(100_000));
  });
});

describe('F10 · simple waterfall', () => {
  it('available 1 300 000; capital 1 000 000; pref 100 000; residual 80/20 → 1 000 000; 100 000; 160 000 and 40 000; total 1 300 000', () => {
    const result = runWaterfall({
      availableCashCents: $(1_300_000),
      requiredDebtCents: 0,
      reserveCents: 0,
      participants: [
        { id: 'p-a', outstandingCapitalCents: $(1_000_000), accruedPreferredCents: $(100_000), residualShareWeight: 80 },
        { id: 'p-b', outstandingCapitalCents: 0, accruedPreferredCents: 0, residualShareWeight: 20 },
      ],
    });
    const [a, b] = result.allocations;
    expect(a?.capitalReturnCents).toBe($(1_000_000));
    expect(a?.preferredReturnCents).toBe($(100_000));
    expect(a?.residualProfitCents).toBe($(160_000));
    expect(b?.residualProfitCents).toBe($(40_000));
    expect(result.totalDistributedCents).toBe($(1_300_000));
    expect(result.residualCashCents).toBe(0);
  });

  it('pays debt and reserve first, carries a shortfall forward and never distributes more than available (WFL03, AT24)', () => {
    const result = runWaterfall({
      availableCashCents: $(500_000),
      requiredDebtCents: $(200_000),
      reserveCents: $(50_000),
      participants: [
        { id: 'p-a', outstandingCapitalCents: $(400_000), accruedPreferredCents: $(20_000), residualShareWeight: 1 },
        { id: 'p-b', outstandingCapitalCents: $(100_000), accruedPreferredCents: $(5_000), residualShareWeight: 1 },
      ],
    });
    expect(result.debtPaidCents).toBe($(200_000));
    expect(result.reserveRetainedCents).toBe($(50_000));
    expect(result.totalDistributedCents).toBe($(250_000));
    const a = result.allocations.find((row) => row.participantId === 'p-a');
    const b = result.allocations.find((row) => row.participantId === 'p-b');
    expect(a?.capitalReturnCents).toBe($(200_000));
    expect(b?.capitalReturnCents).toBe($(50_000));
    expect(a?.capitalShortfallCents).toBe($(200_000));
    expect(a?.preferredReturnCents).toBe(0);
    expect(result.allocations.every((row) => row.totalCents >= 0)).toBe(true);
  });

  it('nothing is distributed from negative available cash', () => {
    const result = runWaterfall({
      availableCashCents: -$(1),
      requiredDebtCents: 0,
      reserveCents: 0,
      participants: [{ id: 'p-a', outstandingCapitalCents: $(100), accruedPreferredCents: 0, residualShareWeight: 1 }],
    });
    expect(result.totalDistributedCents).toBe(0);
  });
});

describe('F11 · funding gap', () => {
  it('cash need 150 000; authorised equity 40 000; eligible debt 100 000 → unfunded 10 000; capacity never auto-increased', () => {
    const result = applyFundingOrder({
      needCents: $(150_000),
      equitySources: [{ id: 'eq-1', rank: 1, availableCents: $(40_000) }],
      debtSources: [{ id: 'debt-1', rank: 1, availableCents: $(100_000) }],
    });
    expect(result.equityDraws).toEqual([{ id: 'eq-1', cents: $(40_000) }]);
    expect(result.debtDraws).toEqual([{ id: 'debt-1', cents: $(100_000) }]);
    expect(result.unfundedCents).toBe($(10_000));
  });

  it('uses equity before debt and debt in rank order', () => {
    const result = applyFundingOrder({
      needCents: $(70_000),
      equitySources: [{ id: 'eq-1', rank: 1, availableCents: $(40_000) }],
      debtSources: [
        { id: 'mezz', rank: 2, availableCents: $(100_000) },
        { id: 'senior', rank: 1, availableCents: $(20_000) },
      ],
    });
    expect(result.debtDraws).toEqual([
      { id: 'senior', cents: $(20_000) },
      { id: 'mezz', cents: $(10_000) },
    ]);
    expect(result.unfundedCents).toBe(0);
  });
});

describe('F12 · allocation rounding', () => {
  it('splits 100.00 equally across three ordered participants as 33.33, 33.33, 33.34 summing exactly to 100.00', () => {
    expect(allocateResidualToLast($(100), [1, 1, 1])).toEqual([3333, 3333, 3334]);
    const named = allocateProRata($(100), [
      { id: 'c', weight: 1 },
      { id: 'a', weight: 1 },
      { id: 'b', weight: 1 },
    ]);
    expect(named).toEqual([
      { id: 'a', cents: 3333 },
      { id: 'b', cents: 3333 },
      { id: 'c', cents: 3334 },
    ]);
  });

  it('a negative reversal mirrors the positive split', () => {
    expect(allocateResidualToLast(-$(100), [1, 1, 1])).toEqual([-3333, -3333, -3334]);
  });

  it('the residual goes to the final *eligible* part, skipping trailing zero weights', () => {
    expect(allocateResidualToLast($(100), [1, 1, 1, 0])).toEqual([3333, 3333, 3334, 0]);
  });

  it('forecast schedules put the rounding residual in the final period (CF04)', () => {
    const equal = distributeEqualMonthly($(100), '2027-01', 3);
    expect(equal.map((entry) => entry.cents)).toEqual([3333, 3333, 3334]);
    expect(equal.map((entry) => entry.date)).toEqual(['2027-01-15', '2027-02-15', '2027-03-15']);

    const weighted = distributeWeighted($(1_000), [
      { month: '2027-01', weightPpm: 333_333 },
      { month: '2027-02', weightPpm: 333_333 },
      { month: '2027-03', weightPpm: 333_334 },
    ]);
    expect(weighted.reduce((sum, entry) => sum + entry.cents, 0)).toBe($(1_000));
    expect(() => distributeWeighted($(1_000), [{ month: '2027-01', weightPpm: 900_000 }])).toThrow(/100%/);
  });
});
