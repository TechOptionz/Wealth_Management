/**
 * Development Finance — yield, sales and revenue (YLD01–YLD06, REV01, CAL12).
 *
 * The F09 figures are hand-derived: a $1,100,000 standard-GST contract with
 * $70,000 purchaser withholding pays the seller $1,030,000 at settlement,
 * carries $100,000 of output GST, and leaves $30,000 of GST to remit.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { accessService } from '@/modules/access/service';
import { USER_IDS } from '@/modules/access/data/seed';
import { projectsRepository } from '@/modules/projects/repository';
import { PROJECT_IDS } from '@/modules/projects/data/seed';
import { programmeRepository } from '@/modules/programme/repository';
import { programmeService } from '@/modules/programme/service';
import { MILESTONE_IDS } from '@/modules/programme/data/seed';
import { salesService, type UnitInput } from '@/modules/sales/service';
import { salesApi } from '@/modules/sales/api';
import { salesRepository } from '@/modules/sales/repository';
import { CONTRACT_IDS, OTHER_INCOME_IDS, REVENUE_GROUP_IDS, UNIT_IDS } from '@/modules/sales/data/seed';
import { settlementReceipt } from '@/shared/finance-engine';
import { fromMajorUnits, money } from '@/shared/lib/money';
import { ConflictError, ForbiddenError, ValidationError } from '@/shared/lib/errors';
import type { MilestoneId } from '@/shared/types/common';

const RIVERSIDE = PROJECT_IDS.riverside;
const JAWAD = USER_IDS.jawad;
const resolve = (): ((id: MilestoneId) => string) => programmeService.dateResolver(RIVERSIDE);

beforeEach(() => {
  projectsRepository.reset();
  programmeRepository.reset();
  salesRepository.reset();
});
afterEach(() => accessService.switchUser(JAWAD));

const baseUnit: UnitInput = {
  groupId: REVENUE_GROUP_IDS.th,
  code: 'TH-09',
  productType: '3-bed townhouse',
  bedrooms: 3,
  carSpaces: 2,
  internalAreaSqm: 160,
  externalAreaSqm: 40,
  saleableAreaBasis: 'internal',
  pricingMode: 'per-unit',
  forecastPrice: fromMajorUnits(870_000),
  taxTreatment: 'standard-gst',
  forecastSettlementMilestoneId: MILESTONE_IDS.finalSettlement,
};

/** Walk a contract to settlement. */
function settle(contractId: Parameters<typeof salesService.requireContract>[0], on: string): void {
  if (salesService.requireContract(contractId).state === 'reserved') salesService.transitionContract({ contractId, to: 'exchanged', actor: JAWAD, on: '2026-10-01' });
  salesService.transitionContract({ contractId, to: 'unconditional', actor: JAWAD, on: '2027-01-25' });
  salesService.transitionContract({ contractId, to: 'settled', actor: JAWAD, on });
}

describe('YLD01 · unit register', () => {
  it('unit codes are unique within the project', () => {
    expect(() => salesService.createUnit(RIVERSIDE, { ...baseUnit, code: 'th-01' }, JAWAD)).toThrow(/already used/);
    expect(salesService.createUnit(RIVERSIDE, baseUnit, JAWAD).code).toBe('TH-09');
  });

  it('rejects negative areas and prices', () => {
    expect(() => salesService.createUnit(RIVERSIDE, { ...baseUnit, internalAreaSqm: -1 }, JAWAD)).toThrow(ValidationError);
    expect(() => salesService.createUnit(RIVERSIDE, { ...baseUnit, externalAreaSqm: -0.5 }, JAWAD)).toThrow(ValidationError);
    expect(() => salesService.createUnit(RIVERSIDE, { ...baseUnit, forecastPrice: money(-100) }, JAWAD)).toThrow(ValidationError);
  });

  it('an import is all or nothing', () => {
    const before = salesService.listUnits(RIVERSIDE).length;
    expect(() =>
      salesService.importUnits({ projectId: RIVERSIDE, rows: [baseUnit, { ...baseUnit, code: 'TH-10', internalAreaSqm: -5 }], actor: JAWAD }),
    ).toThrow(/nothing was imported/);
    expect(() => salesService.importUnits({ projectId: RIVERSIDE, rows: [baseUnit, baseUnit], actor: JAWAD })).toThrow(ValidationError);
    expect(salesService.listUnits(RIVERSIDE)).toHaveLength(before);
    expect(salesService.importUnits({ projectId: RIVERSIDE, rows: [baseUnit, { ...baseUnit, code: 'TH-10' }], actor: JAWAD })).toHaveLength(2);
  });

  it('prices per m² on the explicit basis, so a balcony is not priced as internal (YLD02)', () => {
    const internal = salesService.createUnit(RIVERSIDE, { ...baseUnit, code: 'A-1', pricingMode: 'per-sqm', pricePerSqm: fromMajorUnits(5_000), forecastPrice: undefined }, JAWAD);
    const both = salesService.createUnit(
      RIVERSIDE,
      { ...baseUnit, code: 'A-2', pricingMode: 'per-sqm', saleableAreaBasis: 'internal-plus-external', pricePerSqm: fromMajorUnits(5_000), forecastPrice: undefined },
      JAWAD,
    );
    expect(internal.forecastPrice.cents).toBe(fromMajorUnits(800_000).cents);
    expect(both.forecastPrice.cents).toBe(fromMajorUnits(1_000_000).cents);
  });
});

describe('YLD02 · price changes', () => {
  it('a bulk percent change skips contracted units and lists them', () => {
    const preview = salesService.bulkPriceChange({ projectId: RIVERSIDE, groupId: REVENUE_GROUP_IDS.th, mode: 'percent', valuePpm: 100_000, actor: JAWAD, preview: true });
    expect(preview.skipped.map((row) => row.code)).toEqual(['TH-01', 'TH-02', 'TH-03']);
    expect(preview.changes.find((row) => row.code === 'TH-04')).toMatchObject({ from: fromMajorUnits(1_110_000), to: fromMajorUnits(1_221_000) });
    expect(salesService.requireUnit(UNIT_IDS.th04).forecastPrice.cents).toBe(fromMajorUnits(1_110_000).cents);

    const applied = salesService.bulkPriceChange({ projectId: RIVERSIDE, groupId: REVENUE_GROUP_IDS.th, mode: 'percent', valuePpm: 100_000, actor: JAWAD });
    expect(applied.changes).toHaveLength(5);
    expect(salesService.requireUnit(UNIT_IDS.th04).forecastPrice.cents).toBe(fromMajorUnits(1_221_000).cents);
    expect(salesService.requireContract(CONTRACT_IDS.th01).consideration.cents).toBe(fromMajorUnits(845_000).cents);
  });

  it('includes contracted units only through a contract variation', () => {
    expect(() =>
      salesService.bulkPriceChange({ projectId: RIVERSIDE, groupId: REVENUE_GROUP_IDS.th, mode: 'amount', amount: fromMajorUnits(5_000), includeContracted: true, actor: JAWAD }),
    ).toThrow(/contract variation/);
    expect(() => salesService.updateUnit(UNIT_IDS.th01, { forecastPrice: fromMajorUnits(900_000) }, JAWAD)).toThrow(/contract variation/);

    const varied = salesService.bulkPriceChange({
      projectId: RIVERSIDE,
      groupId: REVENUE_GROUP_IDS.th,
      mode: 'amount',
      amount: fromMajorUnits(5_000),
      includeContracted: true,
      viaContractVariation: true,
      actor: JAWAD,
    });
    expect(varied.skipped).toEqual([]);
    expect(varied.changes).toHaveLength(8);
    const contract = salesService.requireContract(CONTRACT_IDS.th01);
    expect(contract.consideration.cents).toBe(fromMajorUnits(850_000).cents);
    expect(contract.history[contract.history.length - 1]).toMatchObject({ field: 'consideration' });
  });
});

describe('YLD03 · contract state machine', () => {
  it('status is derived from the current contract', () => {
    expect(salesService.salesStatusOf(UNIT_IDS.th01)).toBe('exchanged');
    expect(salesService.salesStatusOf(UNIT_IDS.th03)).toBe('reserved');
    expect(salesService.salesStatusOf(UNIT_IDS.th04)).toBe('available');
    expect(salesService.contractPriceOf(UNIT_IDS.th02)?.cents).toBe(fromMajorUnits(860_000).cents);
  });

  it('cannot settle from reserved; cancelling needs a reason; one live contract per unit', () => {
    expect(() => salesService.transitionContract({ contractId: CONTRACT_IDS.th03, to: 'settled', actor: JAWAD, on: '2028-05-31' })).toThrow(ConflictError);
    expect(() => salesService.transitionContract({ contractId: CONTRACT_IDS.th03, to: 'cancelled', actor: JAWAD })).toThrow(ValidationError);
    expect(() =>
      salesService.createContract({
        projectId: RIVERSIDE,
        unitId: UNIT_IDS.th03,
        purchaserReference: 'PUR-X',
        consideration: fromMajorUnits(850_000),
        taxTreatment: 'standard-gst',
        contractDate: '2026-09-10',
        expectedSettlement: '2028-05-31',
        depositSchedule: [],
        actor: JAWAD,
      }),
    ).toThrow(ConflictError);
    salesService.transitionContract({ contractId: CONTRACT_IDS.th03, to: 'cancelled', actor: JAWAD, reason: 'Finance not approved', on: '2026-09-10' });
    expect(salesService.salesStatusOf(UNIT_IDS.th03)).toBe('cancelled');
  });

  it('purchaser references are hidden without sales.edit and investors see no units', () => {
    accessService.switchUser(USER_IDS.accountant);
    expect(salesApi.listContracts(RIVERSIDE).every((row) => row.purchaserReference === null)).toBe(true);
    expect(salesApi.yieldOverview(RIVERSIDE).permissions.canSeePurchaser).toBe(false);
    expect(() => salesApi.importUnits(RIVERSIDE, { rows: [] })).toThrow(ForbiddenError);
    accessService.switchUser(USER_IDS.hassan);
    expect(() => salesApi.listUnits(RIVERSIDE)).toThrow(ForbiddenError);
    expect(() => salesApi.listContracts(RIVERSIDE)).toThrow(ForbiddenError);
    accessService.switchUser(JAWAD);
    expect(salesApi.listContracts(RIVERSIDE).find((row) => row.id === CONTRACT_IDS.th01)?.purchaserReference).toBe('PUR-2026-0412');
  });
});

describe('YLD04 · deposits in trust (AT12)', () => {
  it('a held deposit is restricted and counts as held, not released, until a release is recorded', () => {
    const summary = salesService.yieldSummary(RIVERSIDE, resolve());
    expect(summary.heldDeposits.cents).toBe(fromMajorUnits(170_500).cents);
    expect(summary.releasedDeposits.cents).toBe(0);
    expect(salesService.actualRevenueEvents(RIVERSIDE).every((row) => row.type !== 'deposit-held' || row.restricted)).toBe(true);

    expect(() =>
      salesService.releaseDeposit({ contractId: CONTRACT_IDS.th01, amount: fromMajorUnits(90_000), on: '2026-09-20', reason: 'Clause 4.2', actor: JAWAD }),
    ).toThrow(/Only 84500 is held/);
    expect(() => salesService.releaseDeposit({ contractId: CONTRACT_IDS.th01, amount: fromMajorUnits(50_000), on: '2026-09-20', reason: ' ', actor: JAWAD })).toThrow(ValidationError);

    const release = salesService.releaseDeposit({ contractId: CONTRACT_IDS.th01, amount: fromMajorUnits(50_000), on: '2026-09-20', reason: 'Release permitted under clause 4.2', actor: JAWAD });
    expect(release.restricted).toBe(false);
    const after = salesService.yieldSummary(RIVERSIDE, resolve());
    expect(after.heldDeposits.cents).toBe(fromMajorUnits(120_500).cents);
    expect(after.releasedDeposits.cents).toBe(fromMajorUnits(50_000).cents);
  });

  it('settlement reproduces F09: cash 1,030,000, GST 100,000, residual 30,000, withholding not an expense (CAL12)', () => {
    const contract = salesService.createContract({
      projectId: RIVERSIDE,
      unitId: UNIT_IDS.th04,
      purchaserReference: 'PUR-2026-0500',
      consideration: fromMajorUnits(1_100_000),
      taxTreatment: 'standard-gst',
      contractDate: '2026-09-20',
      expectedSettlement: '2028-05-15',
      depositSchedule: [],
      withholding: fromMajorUnits(70_000),
      actor: JAWAD,
    });
    settle(contract.id, '2028-05-15');
    const events = salesService.actualRevenueEvents(RIVERSIDE).filter((row) => row.contractId === contract.id);
    expect(events).toHaveLength(1);
    const settlement = events[0]!;
    expect(settlement).toMatchObject({ type: 'settlement', basis: 'actual', date: '2028-05-15' });
    expect(settlement.gross.cents).toBe(fromMajorUnits(1_030_000).cents);
    expect(settlement.tax.cents).toBe(fromMajorUnits(100_000).cents);
    expect(settlement.withholding?.cents).toBe(fromMajorUnits(70_000).cents);
    expect(settlement.tax.cents - (settlement.withholding?.cents ?? 0)).toBe(fromMajorUnits(30_000).cents);
    expect(
      settlementReceipt({ grossConsiderationCents: 110_000_000, outputGstCents: 10_000_000, withholdingCents: 7_000_000 }).residualGstCents,
    ).toBe(3_000_000);
    expect(salesService.salesStatusOf(UNIT_IDS.th04)).toBe('settled');
  });

  it('settling applies the held deposit: one release and one settlement, deducted once', () => {
    settle(CONTRACT_IDS.th01, '2028-05-15');
    const events = salesService.actualRevenueEvents(RIVERSIDE).filter((row) => row.contractId === CONTRACT_IDS.th01);
    expect(events.map((row) => row.type)).toEqual(['deposit-held', 'deposit-released', 'settlement']);
    const settlement = events.find((row) => row.type === 'settlement')!;
    // 845,000 − 84,500 deposit − 76,818.18 withholding (1/11).
    expect(settlement.gross.cents).toBe(84_500_000 - 8_450_000 - 7_681_818);
  });
});

describe('YLD05 · commission', () => {
  it('exactly one obligation per contract, stable on recalculation, reversed on cancellation', () => {
    const first = salesService.commissionObligations(RIVERSIDE);
    expect(first).toHaveLength(3);
    expect(salesService.commissionObligations(RIVERSIDE)).toEqual(first);
    expect(first.find((row) => row.contractId === CONTRACT_IDS.th01)).toMatchObject({
      amount: fromMajorUnits(16_900),
      basis: 'forecast',
      triggerDate: '2028-05-15',
      costLineCode: 'COMM-01',
    });
    salesService.transitionContract({ contractId: CONTRACT_IDS.th02, to: 'cancelled', actor: JAWAD, reason: 'Purchaser rescinded', on: '2026-09-15' });
    const after = salesService.commissionObligations(RIVERSIDE);
    expect(after.map((row) => row.contractId)).toEqual([CONTRACT_IDS.th01, CONTRACT_IDS.th03]);

    settle(CONTRACT_IDS.th01, '2028-05-15');
    expect(salesService.commissionObligations(RIVERSIDE).find((row) => row.contractId === CONTRACT_IDS.th01)?.basis).toBe('actual');
  });
});

describe('YLD06 · yield reconciles to revenue events', () => {
  it('the Yield total equals Σ settlement cash + withholding + applied deposits, = $8,300,000 + $36,000 for the seed', () => {
    const summary = salesService.yieldSummary(RIVERSIDE, resolve());
    const events = [...salesService.actualRevenueEvents(RIVERSIDE), ...salesService.forecastRevenueEvents(RIVERSIDE, resolve())].filter((row) => row.unitId);
    // Withholding is added back because it is cash paid to the tax authority on
    // the seller's behalf (CAL12): part of the consideration, not a reduction of it.
    const settlementGross = events.filter((row) => row.type === 'settlement').reduce((acc, row) => acc + row.gross.cents + (row.withholding?.cents ?? 0), 0);
    const applied = events.filter((row) => row.type === 'deposit-released').reduce((acc, row) => acc + row.gross.cents, 0);
    expect(summary.totalGrossRevenue.cents).toBe(settlementGross + applied);
    expect(summary.totalGrossRevenue.cents).toBe(fromMajorUnits(8_300_000 + 36_000).cents);
    expect(summary.totalGrossRevenue.cents).toBe(summary.contractedRevenue.cents + summary.uncontractedForecastRevenue.cents);
    expect(summary.unitCount).toBe(10);
    expect(summary.byStatus).toMatchObject({ exchanged: 2, reserved: 1, available: 7 });
    expect(summary.contractedRevenue.cents).toBe(fromMajorUnits(2_555_000).cents);
    expect(summary.averageSalePrice.available && summary.averageSalePrice.value.cents).toBe(Math.round(255_500_000 / 3));
    expect(summary.salesProgressRatio.available && summary.salesProgressRatio.value).toBeCloseTo(0.3);
  });

  it('still reconciles after a settlement, and cancellation keeps receipt and refund history', () => {
    settle(CONTRACT_IDS.th01, '2028-05-15');
    expect(salesService.yieldSummary(RIVERSIDE, resolve()).totalGrossRevenue.cents).toBe(fromMajorUnits(8_336_000).cents);

    salesService.transitionContract({ contractId: CONTRACT_IDS.th02, to: 'cancelled', actor: JAWAD, reason: 'Purchaser rescinded', on: '2026-09-15' });
    const th02 = salesService.actualRevenueEvents(RIVERSIDE).filter((row) => row.contractId === CONTRACT_IDS.th02);
    expect(th02.map((row) => [row.type, row.gross.cents])).toEqual([
      ['deposit-held', 8_600_000],
      ['refund', 8_600_000],
    ]);
    expect(salesService.forecastRevenueEvents(RIVERSIDE, resolve()).some((row) => row.contractId === CONTRACT_IDS.th02 || row.unitId === UNIT_IDS.th02)).toBe(false);
    const summary = salesService.yieldSummary(RIVERSIDE, resolve());
    expect(summary.totalGrossRevenue.cents).toBe(fromMajorUnits(8_336_000 - 860_000).cents);
    expect(summary.heldDeposits.cents).toBe(0);
  });

  it('forecast settlements of uncontracted units follow the milestone resolver', () => {
    const moved = salesService.forecastRevenueEvents(RIVERSIDE, (id) => (id === MILESTONE_IDS.finalSettlement ? '2029-01-15' : '2028-01-01'));
    const th08 = moved.find((row) => row.unitId === UNIT_IDS.th08 && row.type === 'settlement');
    expect(th08?.date).toBe('2029-01-15');
    expect(salesService.forecastRevenueEvents(RIVERSIDE, resolve()).find((row) => row.unitId === UNIT_IDS.th08)?.date).toBe('2028-06-30');
    // A contracted unit uses its expected settlement, whatever the milestone says.
    expect(moved.find((row) => row.contractId === CONTRACT_IDS.th01 && row.type === 'settlement')?.date).toBe('2028-05-15');
    // TH-03's unpaid scheduled deposit is a forecast, restricted receipt on its due date.
    expect(moved.find((row) => row.contractId === CONTRACT_IDS.th03 && row.type === 'deposit-held')).toMatchObject({ date: '2026-09-16', restricted: true, gross: fromMajorUnits(85_000) });
  });
});

describe('REV01 · other income', () => {
  it('a recurring line expands to the 15th of each month with tax by treatment', () => {
    const events = salesService.forecastRevenueEvents(RIVERSIDE, resolve()).filter((row) => row.otherIncomeId === OTHER_INCOME_IDS.signLicence);
    expect(events).toHaveLength(12);
    expect(events[0]).toMatchObject({ date: '2026-10-15', type: 'other-income', gross: fromMajorUnits(1_200) });
    expect(events[11]?.date).toBe('2027-09-15');
    expect(events.every((row) => row.date.endsWith('-15'))).toBe(true);
    expect(events[0]?.tax.cents).toBe(10_909);

    const oneOff = salesService.createOtherIncome({
      projectId: RIVERSIDE,
      groupId: REVENUE_GROUP_IDS.oth,
      description: 'Display suite furniture sale',
      taxTreatment: 'gst-free',
      mode: 'one-off',
      date: '2028-07-10',
      amount: fromMajorUnits(4_000),
      actor: JAWAD,
    });
    const line = salesService.forecastRevenueEvents(RIVERSIDE, resolve()).filter((row) => row.otherIncomeId === oneOff.id);
    expect(line).toMatchObject([{ date: '2028-07-10', tax: money(0) }]);
  });
});
