/**
 * Development Finance — the pure project model (compute.ts) on synthetic
 * inputs, independent of the seeded demonstration data.
 *
 * AT03 parent totals once · AT04 F03 transitions with no EAC change · AT11 a
 * programme delay moves forecasts, not actuals · CF08/F11 the funding gap
 * stays visible · CAL14 closing cash identity · CAL18/19 IRR from dated flows
 * · CAL10 GST lag · CF06 locked periods hold no forecast.
 */
import { describe, expect, it } from 'vitest';
import { computeModel } from '@/modules/project-model/compute';
import type { ModelInput, ModelLineInput } from '@/modules/project-model/model';
import { monthKeysBetween } from '@/shared/finance-engine';
import { asId } from '@/shared/types/common';

const $ = (dollars: number): number => Math.round(dollars * 100);
const MONTHS = monthKeysBetween('2027-01', '2027-12');

function line(overrides: Partial<ModelLineInput> & Pick<ModelLineInput, 'id' | 'code' | 'title'>): ModelLineInput {
  return {
    categoryId: 'cat-con',
    rowType: 'posting',
    parentLineId: null,
    sortOrder: 1,
    active: true,
    isContingency: false,
    taxTreatment: 'standard-gst',
    recoverablePpm: 1_000_000,
    budgetNetCents: 0,
    baselineNetCents: null,
    commitments: [],
    approved: [],
    settlements: [],
    unpaid: [],
    forecastMethod: 'equal-monthly',
    schedule: { startMonth: '2027-04', months: 3 },
    milestoneId: null,
    ...overrides,
  };
}

function baseInput(overrides: Partial<ModelInput> = {}): ModelInput {
  return {
    projectId: asId<'Project'>('proj-test'),
    code: 'TST',
    name: 'Synthetic',
    asOf: '2027-03-15',
    startMonth: '2027-01',
    months: MONTHS,
    cutoff: '2027-02-28',
    cutoffMonth: '2027-02',
    modelRevision: 1,
    policyVersion: 1,
    openingCashCents: 0,
    openingRestrictedCents: 0,
    taxRatePpm: 100_000,
    settlementLagMonths: 1,
    minimumReserveCents: 0,
    repayExcessCash: true,
    autoFundForecast: true,
    defaultBasis: 'economic',
    categories: [
      { id: 'cat-acq', code: 'ACQ', name: 'Acquisition', sortOrder: 1 },
      { id: 'cat-con', code: 'CON', name: 'Construction', sortOrder: 2 },
    ],
    lines: [],
    revenueGroups: [{ id: 'rg-th', code: 'TH', name: 'Townhouses', sortOrder: 1 }],
    revenueEvents: [],
    linkedObligations: [],
    facilities: [],
    participants: [],
    equityMovements: [],
    milestones: [{ id: 'ms-pc', name: 'Practical completion', date: '2027-10-15', kind: 'milestone' }],
    completionDate: '2027-12-31',
    waterfall: null,
    unmatchedPayments: [],
    ...overrides,
  };
}

function row(result: ReturnType<typeof computeModel>['result'], id: string, basis: 'economic' | 'gross' = 'economic') {
  const found = result[basis].rows.find((r) => r.id === id);
  if (!found) throw new Error(`row ${id} missing`);
  return found;
}

function sumMonths(months: Readonly<Record<string, number>>): number {
  return Object.values(months).reduce((sum, value) => sum + value, 0);
}

describe('AT03 · a parent with deposit and settlement children totals once (F02)', () => {
  it('shows 1 000 000 on the parent and the category, never 2 000 000', () => {
    const { result } = computeModel(
      baseInput({
        lines: [
          line({ id: 'l-parent', code: 'ACQ-00', title: 'Land acquisition', categoryId: 'cat-acq', rowType: 'summary', sortOrder: 0, taxTreatment: 'gst-free' }),
          line({ id: 'l-dep', code: 'ACQ-01', title: 'Deposit', categoryId: 'cat-acq', parentLineId: 'l-parent', taxTreatment: 'gst-free', budgetNetCents: $(100_000), forecastMethod: 'one-off', schedule: { oneOffDate: '2027-04-10' } }),
          line({ id: 'l-set', code: 'ACQ-02', title: 'Settlement', categoryId: 'cat-acq', parentLineId: 'l-parent', taxTreatment: 'gst-free', budgetNetCents: $(900_000), forecastMethod: 'one-off', schedule: { oneOffDate: '2027-06-10' }, sortOrder: 2 }),
        ],
      }),
    );
    expect(row(result, 'line:l-parent').summary.current).toBe($(1_000_000));
    expect(row(result, 'category:cat-acq').summary.current).toBe($(1_000_000));
    expect(row(result, 'costs').summary.current).toBe($(1_000_000));
    expect(sumMonths(row(result, 'costs').months)).toBe(-$(1_000_000));
    expect(row(result, 'line:l-parent').kind).toBe('parent');
    expect(row(result, 'line:l-parent').posting).toBe(false);
  });
});

describe('AT04 · approval and payment follow F03 → F03b with no EAC increase', () => {
  const commitment = (invoiced: number) => ({ id: 'c1', reference: 'C-1', supplierName: 'Builder', revisedNetCents: $(88_000), invoicedNetCents: $(invoiced), taxTreatment: 'standard-gst' as const, recoverablePpm: 1_000_000 });
  const approved = (invoiceId: string, net: number, date: string) => ({ invoiceId, number: invoiceId, supplierName: 'Builder', sign: 1 as const, commitmentId: 'c1', allowanceTreatment: null, netCents: $(net), taxCents: $(net / 10), grossCents: $(net * 1.1), economicCents: $(net), expectedPaymentDate: date });

  it('F03: B 110000; C 88000; I 33000; P 11000; U 22000 → EAC 110000, A 22000 gross-adjusted, remaining cash 99000', () => {
    const { result } = computeModel(
      baseInput({
        lines: [
          line({
            id: 'l1', code: 'CON-01', title: 'Builder', budgetNetCents: $(110_000), baselineNetCents: $(110_000),
            commitments: [commitment(33_000)],
            approved: [approved('i1', 33_000, '2027-03-20')],
            settlements: [{ invoiceId: 'i1', date: '2027-02-20', cashCents: $(12_100), nonCashCents: 0, invoiceGrossCents: $(36_300), invoiceEconomicCents: $(33_000) }],
            unpaid: [{ invoiceId: 'i1', expectedPaymentDate: '2027-03-20', grossCents: $(24_200), economicCents: $(22_000), retentionCents: 0 }],
          }),
        ],
      }),
    );
    const position = result.positions.find((p) => p.lineId === 'l1')!;
    // Economic basis (fully recoverable GST) reproduces the fixture's tax-exclusive numbers.
    expect(position.eacCents).toBe($(110_000));
    expect(position.approvedCents).toBe($(33_000));
    expect(position.unbilledCommitmentCents).toBe($(55_000));
    expect(position.uncommittedCents).toBe($(22_000));
    expect(position.varianceCents).toBe(0);
    // Gross basis: paid 12,100 of 36,300 gross → approved unpaid 24,200; remaining cash 121,000 − 12,100.
    expect(position.approvedUnpaidCents).toBe($(24_200));
    expect(position.remainingCashCents).toBe($(121_000) - $(12_100));
    expect(row(result, 'line:l1').summary.current).toBe($(110_000));
    expect(row(result, 'line:l1').summary.expended).toBe($(11_000));
    // Every dollar of EAC lands in some month: paid + unpaid + remaining forecast.
    expect(-sumMonths(row(result, 'line:l1').months)).toBe($(110_000));
  });

  it('F03a then F03b: another approval and a payment leave EAC at 110000', () => {
    const afterApproval = computeModel(
      baseInput({
        lines: [
          line({
            id: 'l1', code: 'CON-01', title: 'Builder', budgetNetCents: $(110_000), baselineNetCents: $(110_000),
            commitments: [commitment(44_000)],
            approved: [approved('i1', 33_000, '2027-03-20'), approved('i2', 11_000, '2027-04-20')],
            settlements: [{ invoiceId: 'i1', date: '2027-02-20', cashCents: $(12_100), nonCashCents: 0, invoiceGrossCents: $(36_300), invoiceEconomicCents: $(33_000) }],
            unpaid: [
              { invoiceId: 'i1', expectedPaymentDate: '2027-03-20', grossCents: $(24_200), economicCents: $(22_000), retentionCents: 0 },
              { invoiceId: 'i2', expectedPaymentDate: '2027-04-20', grossCents: $(12_100), economicCents: $(11_000), retentionCents: 0 },
            ],
          }),
        ],
      }),
    ).result;
    const a = afterApproval.positions[0]!;
    expect(a.approvedCents).toBe($(44_000));
    expect(a.unbilledCommitmentCents).toBe($(44_000));
    expect(a.eacCents).toBe($(110_000));
    expect(a.approvedUnpaidCents).toBe($(36_300));

    const afterPayment = computeModel(
      baseInput({
        lines: [
          line({
            id: 'l1', code: 'CON-01', title: 'Builder', budgetNetCents: $(110_000), baselineNetCents: $(110_000),
            commitments: [commitment(44_000)],
            approved: [approved('i1', 33_000, '2027-03-20'), approved('i2', 11_000, '2027-04-20')],
            settlements: [
              { invoiceId: 'i1', date: '2027-02-20', cashCents: $(12_100), nonCashCents: 0, invoiceGrossCents: $(36_300), invoiceEconomicCents: $(33_000) },
              { invoiceId: 'i1', date: '2027-02-27', cashCents: $(12_100), nonCashCents: 0, invoiceGrossCents: $(36_300), invoiceEconomicCents: $(33_000) },
            ],
            unpaid: [
              { invoiceId: 'i1', expectedPaymentDate: '2027-03-20', grossCents: $(12_100), economicCents: $(11_000), retentionCents: 0 },
              { invoiceId: 'i2', expectedPaymentDate: '2027-04-20', grossCents: $(12_100), economicCents: $(11_000), retentionCents: 0 },
            ],
          }),
        ],
      }),
    ).result;
    const b = afterPayment.positions[0]!;
    expect(b.settledCents).toBe($(24_200));
    expect(b.approvedUnpaidCents).toBe($(24_200));
    expect(b.eacCents).toBe($(110_000));
    expect(b.remainingCashCents).toBe($(121_000) - $(24_200));
  });

  it('AT05 · direct spend consumes only its matched allowance; additional scope raises EAC', () => {
    const consume = computeModel(
      baseInput({
        lines: [
          line({ id: 'l1', code: 'X', title: 'Direct', budgetNetCents: $(10_000), baselineNetCents: $(10_000), approved: [{ invoiceId: 'd1', number: 'D1', supplierName: 'S', sign: 1, commitmentId: null, allowanceTreatment: 'consume-allowance', netCents: $(3_000), taxCents: $(300), grossCents: $(3_300), economicCents: $(3_000), expectedPaymentDate: '2027-04-01' }], unpaid: [{ invoiceId: 'd1', expectedPaymentDate: '2027-04-01', grossCents: $(3_300), economicCents: $(3_000), retentionCents: 0 }] }),
        ],
      }),
    ).result.positions[0]!;
    expect(consume.approvedCents).toBe($(3_000));
    expect(consume.uncommittedCents).toBe($(7_000));
    expect(consume.eacCents).toBe($(10_000));

    const scope = computeModel(
      baseInput({
        lines: [
          line({ id: 'l1', code: 'X', title: 'Direct', budgetNetCents: $(10_000), baselineNetCents: $(10_000), approved: [{ invoiceId: 'd1', number: 'D1', supplierName: 'S', sign: 1, commitmentId: null, allowanceTreatment: 'additional-scope', netCents: $(3_000), taxCents: $(300), grossCents: $(3_300), economicCents: $(3_000), expectedPaymentDate: '2027-04-01' }], unpaid: [{ invoiceId: 'd1', expectedPaymentDate: '2027-04-01', grossCents: $(3_300), economicCents: $(3_000), retentionCents: 0 }] }),
        ],
      }),
    ).result.positions[0]!;
    expect(scope.uncommittedCents).toBe($(10_000));
    expect(scope.eacCents).toBe($(13_000));
    expect(scope.varianceCents).toBe($(3_000));
  });
});

describe('AT11 · a programme delay moves eligible forecasts, never settled actuals (CF06)', () => {
  const input = baseInput({
    lines: [
      line({
        id: 'l1', code: 'CON-01', title: 'Builder', budgetNetCents: $(300_000), forecastMethod: 'milestone-linked', milestoneId: 'ms-pc', schedule: { milestoneOffsetDays: 0 },
        settlements: [{ invoiceId: 'p', date: '2027-01-15', cashCents: $(11_000), nonCashCents: 0, invoiceGrossCents: $(11_000), invoiceEconomicCents: $(10_000) }],
        approved: [{ invoiceId: 'p', number: 'P', supplierName: 'S', sign: 1, commitmentId: null, allowanceTreatment: 'consume-allowance', netCents: $(10_000), taxCents: $(1_000), grossCents: $(11_000), economicCents: $(10_000), expectedPaymentDate: '2027-01-15' }],
      }),
    ],
  });

  it('the remaining forecast follows the shifted milestone and the January payment stays in January', () => {
    const base = computeModel(input).result;
    const delayed = computeModel(input, { overrides: { programmeShiftDays: 60 } }).result;
    const baseRow = row(base, 'line:l1');
    const delayedRow = row(delayed, 'line:l1');
    expect(baseRow.months['2027-01']).toBe(-$(10_000));
    expect(delayedRow.months['2027-01']).toBe(-$(10_000));
    expect(baseRow.months['2027-10']).toBe(-$(290_000));
    expect(delayedRow.months['2027-10']).toBe(0);
    expect(delayedRow.months['2027-12']).toBe(-$(290_000));
    expect(delayed.economic.kpis.completionDate).toBe('2028-02-29');
  });

  it('a forecast that falls in a locked period is moved to the first open month and flagged', () => {
    const { result } = computeModel(
      baseInput({ lines: [line({ id: 'l1', code: 'X', title: 'Past', budgetNetCents: $(5_000), forecastMethod: 'one-off', schedule: { oneOffDate: '2027-01-10' } })] }),
    );
    expect(row(result, 'line:l1').months['2027-01']).toBe(0);
    expect(row(result, 'line:l1').months['2027-03']).toBe(-$(5_000));
    expect(result.warnings.some((w) => w.code === 'forecast-shifted')).toBe(true);
  });
});

describe('CF08 / F11 · the funding gap stays visible; equity is used before ranked debt', () => {
  it('need 150 000 in April; equity 40 000; debt 100 000 → unfunded 10 000, no capacity invented', () => {
    const { result } = computeModel(
      baseInput({
        lines: [line({ id: 'l1', code: 'X', title: 'Spend', taxTreatment: 'out-of-scope', budgetNetCents: $(150_000), forecastMethod: 'one-off', schedule: { oneOffDate: '2027-04-15' } })],
        participants: [{ id: 'eq', name: 'Investor', commitmentCents: $(40_000), rank: 1, residualShareWeight: 1, preferredRatePpm: 0 }],
        facilities: [
          {
            id: 'debt', name: 'Senior', drawRank: 1, repayRank: 1, availableFrom: '2027-01-01', availableTo: '2027-12-31', maturityOn: '2027-12-31',
            terms: { limitCents: $(100_000), openingPrincipalCents: 0, openingOn: '2027-01-01', rateSteps: [{ from: '2027-01-01', ratePpm: 0 }], dayCount: 'ACT/365F', interestTreatment: 'capitalised' },
            movements: [],
          },
        ],
      }),
    );
    const april = result.gross.totals.find((t) => t.month === '2027-04')!;
    expect(april.equityContributionsCents).toBe($(40_000));
    expect(april.debtDrawsCents).toBe($(100_000));
    expect(april.unfundedCents).toBe($(10_000));
    expect(april.closingCashCents).toBe(-$(10_000));
    expect(result.gross.kpis.fundingGapCents).toBe($(10_000));
    expect(result.warnings.some((w) => w.code === 'unfunded')).toBe(true);
    expect(result.gross.kpis.peakDebtCents).toBe($(100_000));
    expect(result.generatedEquity).toEqual([{ participantId: 'eq', on: '2027-04-15', cents: $(40_000) }]);
  });

  it('CAL14 · closing cash equals the identity every month, and excess cash repays debt by rank', () => {
    const { result } = computeModel(
      baseInput({
        openingCashCents: $(20_000),
        lines: [line({ id: 'l1', code: 'X', title: 'Spend', taxTreatment: 'out-of-scope', budgetNetCents: $(100_000), forecastMethod: 'one-off', schedule: { oneOffDate: '2027-04-15' } })],
        revenueEvents: [{ id: 'r1', groupId: 'rg-th', label: 'TH-01 settlement', type: 'settlement', date: '2027-09-20', grossCents: $(500_000), taxCents: 0, withholdingCents: 0, considerationCents: $(500_000), restricted: false, basis: 'forecast', contractId: 'c1' }],
        facilities: [
          {
            id: 'debt', name: 'Senior', drawRank: 1, repayRank: 1, availableFrom: '2027-01-01', availableTo: '2027-12-31', maturityOn: '2027-12-31',
            terms: { limitCents: $(500_000), openingPrincipalCents: 0, openingOn: '2027-01-01', rateSteps: [{ from: '2027-01-01', ratePpm: 0 }], dayCount: 'ACT/365F', interestTreatment: 'capitalised' },
            movements: [],
          },
        ],
      }),
    );
    for (const t of result.gross.totals) {
      const identity =
        t.openingCashCents + t.receiptsCents + t.depositsReleasedCents + t.taxRefundCents + t.equityContributionsCents + t.debtDrawsCents -
        t.developmentPaymentsCents - t.taxRemittanceCents - t.cashInterestCents - t.feesCents - t.principalRepaymentsCents - t.distributionsCents;
      expect(t.closingCashCents).toBe(identity);
    }
    const april = result.gross.totals.find((t) => t.month === '2027-04')!;
    const september = result.gross.totals.find((t) => t.month === '2027-09')!;
    expect(april.debtDrawsCents).toBe($(80_000));
    expect(september.principalRepaymentsCents).toBe($(80_000));
    expect(september.debtClosingCents).toBe(0);
  });
});

describe('CAL10 · GST position settles after the lag; CAL12 withholding is a credit', () => {
  it('input credits on a paid invoice refund a month later; output GST less withholding remits', () => {
    const { result } = computeModel(
      baseInput({
        lines: [line({ id: 'l1', code: 'X', title: 'Paid', budgetNetCents: $(10_000), approved: [{ invoiceId: 'i', number: 'I', supplierName: 'S', sign: 1, commitmentId: null, allowanceTreatment: 'consume-allowance', netCents: $(10_000), taxCents: $(1_000), grossCents: $(11_000), economicCents: $(10_000), expectedPaymentDate: '2027-01-15' }], settlements: [{ invoiceId: 'i', date: '2027-01-15', cashCents: $(11_000), nonCashCents: 0, invoiceGrossCents: $(11_000), invoiceEconomicCents: $(10_000) }] })],
        revenueEvents: [{ id: 'r1', groupId: 'rg-th', label: 'Settlement', type: 'settlement', date: '2027-06-20', grossCents: $(1_030_000), taxCents: $(100_000), withholdingCents: $(70_000), considerationCents: $(1_100_000), restricted: false, basis: 'forecast', contractId: 'c1' }],
      }),
    );
    expect(row(result, 'gst:refund', 'gross').months['2027-02']).toBe($(1_000));
    expect(row(result, 'gst:remit', 'gross').months['2027-07']).toBe(-$(30_000));
    expect(row(result, 'revenue:rg-th', 'gross').months['2027-06']).toBe($(1_030_000));
    expect(row(result, 'revenue:rg-th', 'economic').months['2027-06']).toBe($(1_000_000));
    expect(result.gross.kpis.netRevenueCents).toBe($(1_000_000));
  });
});

describe('AT15 · IRR from dated flows; CAL13 profit and margins', () => {
  it('a −1 000 000 outlay and +1 250 000 receipt a year apart give 25%', () => {
    const { result } = computeModel(
      baseInput({
        months: monthKeysBetween('2027-01', '2028-02'),
        cutoff: '2026-12-31',
        cutoffMonth: '2026-12',
        lines: [line({ id: 'l1', code: 'X', title: 'Outlay', taxTreatment: 'out-of-scope', budgetNetCents: $(1_000_000), forecastMethod: 'one-off', schedule: { oneOffDate: '2027-01-15' } })],
        revenueEvents: [{ id: 'r1', groupId: 'rg-th', label: 'Sale', type: 'settlement', date: '2028-01-15', grossCents: $(1_250_000), taxCents: 0, withholdingCents: 0, considerationCents: $(1_250_000), restricted: false, basis: 'forecast', contractId: null }],
        participants: [{ id: 'eq', name: 'Investor', commitmentCents: $(1_000_000), rank: 1, residualShareWeight: 1, preferredRatePpm: 0 }],
        waterfall: { published: true, reserveCents: 0, versionLabel: 'v1' },
      }),
    );
    const irr = result.gross.kpis.projectIrr;
    expect(irr.available).toBe(true);
    if (irr.available) expect(irr.rate * 100).toBeCloseTo(25, 4);
    expect(result.gross.kpis.profitCents).toBe($(250_000));
    expect(result.gross.kpis.marginOnCost).toEqual({ available: true, value: 0.25 });
    expect(result.gross.kpis.marginOnRevenue).toEqual({ available: true, value: 0.2 });
    // Equity IRR: the modelled terminal distribution returns the equity plus profit.
    expect(result.terminalDistribution).toEqual([{ participantId: 'eq', cents: $(1_250_000) }]);
    expect(result.gross.kpis.equityIrr.available).toBe(true);
  });

  it('a project with only outflows reports Not Available, never a number', () => {
    const { result } = computeModel(
      baseInput({ lines: [line({ id: 'l1', code: 'X', title: 'Outlay', budgetNetCents: $(1_000) })] }),
    );
    expect(result.gross.kpis.projectIrr.available).toBe(false);
    expect(result.gross.kpis.marginOnRevenue.available).toBe(false);
  });
});

describe('Scenario overrides (SCN02, F08)', () => {
  it('a 5% cost uplift on 1 000 000 of remaining costs adds 50 000 and reduces profit by the same', () => {
    const input = baseInput({
      lines: [line({ id: 'l1', code: 'X', title: 'Remaining', budgetNetCents: $(1_000_000) })],
      revenueEvents: [{ id: 'r1', groupId: 'rg-th', label: 'Sale', type: 'settlement', date: '2027-12-01', grossCents: $(5_000_000), taxCents: 0, withholdingCents: 0, considerationCents: $(5_000_000), restricted: false, basis: 'forecast', contractId: null }],
    });
    const base = computeModel(input).result;
    const scenario = computeModel(input, { overrides: { costUplift: { ppm: 50_000, includeUnbilledCommitments: false } } }).result;
    expect(scenario.economic.kpis.economicCostCents - base.economic.kpis.economicCostCents).toBe($(50_000));
    expect(base.economic.kpis.profitCents - scenario.economic.kpis.profitCents).toBe($(50_000));
  });

  it('a price uplift touches unsold forecast events only', () => {
    const input = baseInput({
      revenueEvents: [
        { id: 'sold', groupId: 'rg-th', label: 'Contracted', type: 'settlement', date: '2027-12-01', grossCents: $(1_000), taxCents: 0, withholdingCents: 0, considerationCents: $(1_000), restricted: false, basis: 'forecast', contractId: 'c1' },
        { id: 'unsold', groupId: 'rg-th', label: 'Forecast', type: 'settlement', date: '2027-12-01', grossCents: $(1_000), taxCents: 0, withholdingCents: 0, considerationCents: $(1_000), restricted: false, basis: 'forecast', contractId: null },
      ],
    });
    const scenario = computeModel(input, { overrides: { unsoldPriceUpliftPpm: 100_000 } }).result;
    expect(scenario.gross.kpis.contractedRevenueCents).toBe($(1_000));
    expect(scenario.gross.kpis.uncontractedRevenueCents).toBe($(1_100));
  });
});

describe('YLD04 · deposits held in trust are restricted until released (AT12)', () => {
  it('a held deposit never reaches unrestricted cash; a release does', () => {
    const { result } = computeModel(
      baseInput({
        revenueEvents: [
          { id: 'd1', groupId: 'rg-th', label: 'Deposit', type: 'deposit-held', date: '2027-03-05', grossCents: $(50_000), taxCents: 0, withholdingCents: 0, considerationCents: 0, restricted: true, basis: 'actual', contractId: 'c1' },
          { id: 'd2', groupId: 'rg-th', label: 'Release', type: 'deposit-released', date: '2027-05-05', grossCents: $(20_000), taxCents: 0, withholdingCents: 0, considerationCents: 0, restricted: false, basis: 'actual', contractId: 'c1' },
        ],
      }),
    );
    const march = result.gross.totals.find((t) => t.month === '2027-03')!;
    const may = result.gross.totals.find((t) => t.month === '2027-05')!;
    expect(march.closingCashCents).toBe(0);
    expect(march.restrictedClosingCents).toBe($(50_000));
    expect(may.closingCashCents).toBe($(20_000));
    expect(may.restrictedClosingCents).toBe($(30_000));
  });
});

describe('Drill-through (CF05)', () => {
  it('lists the contributions behind one cell with source, status and basis', () => {
    const input = baseInput({
      lines: [line({ id: 'l1', code: 'X', title: 'Remaining', budgetNetCents: $(3_000), forecastMethod: 'equal-monthly', schedule: { startMonth: '2027-04', months: 3 } })],
    });
    const { contributions } = computeModel(input, { collect: { rowId: 'line:l1', month: '2027-04', basis: 'economic' } });
    expect(contributions).toHaveLength(1);
    expect(contributions[0]).toMatchObject({ source: 'forecast-allowance', cents: -$(1_000), basis: 'forecast', editable: true });
  });
});
