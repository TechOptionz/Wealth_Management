/**
 * Seeded unit register, contracts, deposits, other income and commission rule
 * for Riverside Townhomes (§16.3). Fictional throughout.
 *
 * The eight townhouse forecast prices sum to exactly $8,300,000 and the two
 * storage cages to $36,000, so the Yield total reconciles to $8,336,000.
 */
import { asId, type IsoDate, type SaleContractId, type UnitId } from '@/shared/types/common';
import { fromMajorUnits, money, type Money } from '@/shared/lib/money';
import { taxFromGross } from '@/shared/finance-engine';
import { USER_IDS } from '@/modules/access/data/seed';
import { PROJECT_IDS } from '@/modules/projects/data/seed';
import { MILESTONE_IDS } from '@/modules/programme/data/seed';
import type { CommissionRule, OtherIncome, RevenueEvent, RevenueGroup, SaleContract, Unit } from '../model';

const P = PROJECT_IDS.riverside;
const CREATED = '2026-07-01T00:00:00.000Z';

export const REVENUE_GROUP_IDS = {
  th: 'rg-riverside-th',
  car: 'rg-riverside-car',
  oth: 'rg-riverside-oth',
};

export const UNIT_IDS = {
  th01: asId<'Unit'>('unit-riverside-th-01'),
  th02: asId<'Unit'>('unit-riverside-th-02'),
  th03: asId<'Unit'>('unit-riverside-th-03'),
  th04: asId<'Unit'>('unit-riverside-th-04'),
  th05: asId<'Unit'>('unit-riverside-th-05'),
  th06: asId<'Unit'>('unit-riverside-th-06'),
  th07: asId<'Unit'>('unit-riverside-th-07'),
  th08: asId<'Unit'>('unit-riverside-th-08'),
  cage01: asId<'Unit'>('unit-riverside-cage-01'),
  cage02: asId<'Unit'>('unit-riverside-cage-02'),
} satisfies Record<string, UnitId>;

export const CONTRACT_IDS = {
  th01: asId<'SaleContract'>('sc-riverside-th-01'),
  th02: asId<'SaleContract'>('sc-riverside-th-02'),
  th03: asId<'SaleContract'>('sc-riverside-th-03'),
} satisfies Record<string, SaleContractId>;

export const OTHER_INCOME_IDS = {
  signLicence: asId<'OtherIncome'>('oi-riverside-sign-licence'),
};

export const COMMISSION_RULE_ID = 'cr-riverside';

export function seedRevenueGroups(): readonly RevenueGroup[] {
  return [
    { id: REVENUE_GROUP_IDS.th, projectId: P, code: 'TH', name: 'Townhouses', sortOrder: 1 },
    { id: REVENUE_GROUP_IDS.car, projectId: P, code: 'CAR', name: 'Car spaces & storage', sortOrder: 2 },
    { id: REVENUE_GROUP_IDS.oth, projectId: P, code: 'OTH', name: 'Other income', sortOrder: 3 },
  ];
}

function townhouse(id: UnitId, code: string, internal: number, external: number, asking: number, forecast: number): Unit {
  return {
    id,
    projectId: P,
    groupId: REVENUE_GROUP_IDS.th,
    code,
    stage: 'Stage 1',
    productType: '3-bed townhouse',
    bedrooms: 3,
    carSpaces: 2,
    internalAreaSqm: internal,
    externalAreaSqm: external,
    saleableAreaBasis: 'internal',
    pricingMode: 'per-unit',
    askingPrice: fromMajorUnits(asking),
    forecastPrice: fromMajorUnits(forecast),
    taxTreatment: 'standard-gst',
    forecastSettlementMilestoneId: MILESTONE_IDS.finalSettlement,
    history: [],
    createdAt: CREATED,
  };
}

function cage(id: UnitId, code: string): Unit {
  return {
    id,
    projectId: P,
    groupId: REVENUE_GROUP_IDS.car,
    code,
    productType: 'Storage cage',
    level: 'Basement',
    bedrooms: 0,
    carSpaces: 0,
    internalAreaSqm: 4,
    externalAreaSqm: 0,
    saleableAreaBasis: 'internal',
    pricingMode: 'per-unit',
    askingPrice: fromMajorUnits(18_000),
    forecastPrice: fromMajorUnits(18_000),
    taxTreatment: 'standard-gst',
    forecastSettlementMilestoneId: MILESTONE_IDS.finalSettlement,
    history: [],
    createdAt: CREATED,
  };
}

/**
 * Forecast prices: 845 + 860 + 850 (contracted early, at presale prices) + 1,110 + 1,140 + 1,150 + 1,165 + 1,180
 * (the river-frontage units, released after the DA) = 8,300 ($k).
 */
export function seedUnits(): readonly Unit[] {
  return [
    townhouse(UNIT_IDS.th01, 'TH-01', 158, 38, 855_000, 845_000),
    townhouse(UNIT_IDS.th02, 'TH-02', 160, 40, 870_000, 860_000),
    townhouse(UNIT_IDS.th03, 'TH-03', 162, 40, 860_000, 850_000),
    townhouse(UNIT_IDS.th04, 'TH-04', 158, 38, 1_120_000, 1_110_000),
    townhouse(UNIT_IDS.th05, 'TH-05', 165, 42, 1_150_000, 1_140_000),
    townhouse(UNIT_IDS.th06, 'TH-06', 168, 42, 1_160_000, 1_150_000),
    townhouse(UNIT_IDS.th07, 'TH-07', 170, 44, 1_175_000, 1_165_000),
    townhouse(UNIT_IDS.th08, 'TH-08', 172, 44, 1_190_000, 1_180_000),
    cage(UNIT_IDS.cage01, 'CAGE-01'),
    cage(UNIT_IDS.cage02, 'CAGE-02'),
  ];
}

/** The reviewed default: withholding equals the output GST inside the price (1/11 at 10%). */
function defaultWithholding(consideration: Money): Money {
  return money(taxFromGross(consideration.cents, 'standard-gst'));
}

function contract(
  id: SaleContractId,
  unitId: UnitId,
  purchaserReference: string,
  state: SaleContract['state'],
  consideration: number,
  contractDate: IsoDate,
  expectedSettlement: IsoDate,
  depositDueOn: IsoDate,
  extra: Partial<SaleContract> = {},
): SaleContract {
  const price = fromMajorUnits(consideration);
  return {
    id,
    projectId: P,
    unitId,
    purchaserReference,
    state,
    consideration: price,
    taxTreatment: 'standard-gst',
    contractDate,
    expectedSettlement,
    depositSchedule: [{ dueOn: depositDueOn, amount: fromMajorUnits(consideration / 10) }],
    adjustments: money(0),
    withholding: defaultWithholding(price),
    createdAt: `${contractDate}T02:00:00.000Z`,
    createdBy: USER_IDS.mahvish,
    history: [{ at: `${contractDate}T02:00:00.000Z`, actor: USER_IDS.mahvish, field: 'state', before: null, after: 'reserved' }],
    ...extra,
  };
}

export function seedSaleContracts(): readonly SaleContract[] {
  return [
    contract(CONTRACT_IDS.th01, UNIT_IDS.th01, 'PUR-2026-0412', 'exchanged', 845_000, '2026-08-12', '2028-05-15', '2026-08-19', { exchangedOn: '2026-08-12' }),
    contract(CONTRACT_IDS.th02, UNIT_IDS.th02, 'PUR-2026-0433', 'exchanged', 860_000, '2026-08-28', '2028-05-20', '2026-09-04', { exchangedOn: '2026-08-28' }),
    contract(CONTRACT_IDS.th03, UNIT_IDS.th03, 'PUR-2026-0441', 'reserved', 850_000, '2026-09-02', '2028-05-31', '2026-09-16'),
  ];
}

/** Actual events only. Forecast events are derived on read and never stored. */
export function seedRevenueEvents(): readonly RevenueEvent[] {
  return [
    {
      id: asId<'RevenueEvent'>('rev-riverside-th-01-deposit-1'),
      projectId: P,
      contractId: CONTRACT_IDS.th01,
      unitId: UNIT_IDS.th01,
      type: 'deposit-held',
      date: '2026-08-19',
      gross: fromMajorUnits(84_500),
      tax: money(0),
      restricted: true,
      basis: 'actual',
      note: '10% deposit · held in trust',
    },
    {
      id: asId<'RevenueEvent'>('rev-riverside-th-02-deposit-1'),
      projectId: P,
      contractId: CONTRACT_IDS.th02,
      unitId: UNIT_IDS.th02,
      type: 'deposit-held',
      date: '2026-09-04',
      gross: fromMajorUnits(86_000),
      tax: money(0),
      restricted: true,
      basis: 'actual',
      note: '10% deposit · held in trust',
    },
  ];
}

export function seedOtherIncome(): readonly OtherIncome[] {
  return [
    {
      id: OTHER_INCOME_IDS.signLicence,
      projectId: P,
      groupId: REVENUE_GROUP_IDS.oth,
      description: 'Temporary sign licence',
      taxTreatment: 'standard-gst',
      mode: 'recurring',
      startDate: '2026-10-01',
      endDate: '2027-09-30',
      monthlyAmount: fromMajorUnits(1_200),
    },
  ];
}

export function seedCommissionRules(): readonly CommissionRule[] {
  return [
    {
      id: COMMISSION_RULE_ID,
      projectId: P,
      basis: 'rate',
      ratePpm: 20_000,
      trigger: 'settlement',
      cancellationTreatment: 'reverse',
      costLineCode: 'COMM-01',
    },
  ];
}
