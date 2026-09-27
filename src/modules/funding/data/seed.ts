/**
 * Seeded funding structure for Riverside Townhomes (§16.3).
 *
 * Fictional throughout. The establishment fee is declared on the facility so
 * the ledger's fee column shows it in October 2026; the cash itself is carried
 * by the FIN-01 cost line in the budget, so no fee *movement* is seeded — a
 * movement here would count the same $27,500 twice.
 */
import { asId } from '@/shared/types/common';
import { fromMajorUnits, money } from '@/shared/lib/money';
import { USER_IDS } from '@/modules/access/data/seed';
import { LEGAL_ENTITY_IDS, PROJECT_IDS, SEED_PARTICIPANT_IDS } from '@/modules/projects/data/seed';
import type { DebtFacility, EquityMovement, EquityParticipant, FacilityMovement, WaterfallVersion } from '../model';

export const FACILITY_IDS = {
  riversideConstruction: asId<'DebtFacility'>('fac-riverside-construction'),
};

export const FACILITY_MOVEMENT_IDS = {
  landSettlementDraw: asId<'FacilityMovement'>('fmv-riverside-land-draw'),
};

export const WATERFALL_IDS = {
  riversideV1: asId<'WaterfallVersion'>('wfv-riverside-1'),
};

export { SEED_PARTICIPANT_IDS };

export function seedFacilities(): readonly DebtFacility[] {
  return [
    {
      id: FACILITY_IDS.riversideConstruction,
      projectId: PROJECT_IDS.riverside,
      name: 'Riverside construction facility',
      lender: 'Queensland Property Finance',
      borrowerLegalEntityId: LEGAL_ENTITY_IDS.esteem,
      type: 'senior',
      limit: fromMajorUnits(5_000_000),
      openingPrincipal: money(0),
      openingOn: '2026-10-15',
      availableFrom: '2026-10-15',
      availableTo: '2028-04-30',
      maturityOn: '2028-06-30',
      drawRank: 1,
      repaymentRank: 1,
      rateSteps: [{ from: '2026-10-15', ratePpm: 82_500 }],
      dayCount: 'ACT/365F',
      interestTreatment: 'capitalised',
      fees: [{ kind: 'establishment', amount: fromMajorUnits(27_500), on: '2026-10-15' }],
      state: 'active',
      createdAt: '2026-06-20T03:00:00.000Z',
      createdBy: USER_IDS.mahvish,
    },
  ];
}

export function seedFacilityMovements(): readonly FacilityMovement[] {
  return [
    {
      id: FACILITY_MOVEMENT_IDS.landSettlementDraw,
      projectId: PROJECT_IDS.riverside,
      facilityId: FACILITY_IDS.riversideConstruction,
      on: '2026-10-15',
      kind: 'draw',
      amount: fromMajorUnits(1_000_000),
      basis: 'planned',
      source: 'manual',
      reference: 'Land settlement draw',
      createdAt: '2026-06-20T03:10:00.000Z',
      createdBy: USER_IDS.mahvish,
    },
  ];
}

export function seedEquityParticipants(): readonly EquityParticipant[] {
  return [
    {
      id: SEED_PARTICIPANT_IDS.esteem,
      projectId: PROJECT_IDS.riverside,
      name: 'Esteem Development Pty Ltd',
      investorReference: 'ESTEEM-SPONSOR',
      class: 'sponsor',
      commitment: fromMajorUnits(900_000),
      participationWeight: 70,
      preferredRatePpm: 0,
      residualShareWeight: 70,
      createdAt: '2026-06-20T03:20:00.000Z',
    },
    {
      id: SEED_PARTICIPANT_IDS.hsfi,
      projectId: PROJECT_IDS.riverside,
      name: 'HS Family Investments',
      investorReference: 'HSFI-2026',
      class: 'preferred',
      commitment: fromMajorUnits(600_000),
      participationWeight: 30,
      preferredRatePpm: 80_000,
      residualShareWeight: 30,
      createdAt: '2026-06-20T03:21:00.000Z',
    },
  ];
}

export function seedEquityMovements(): readonly EquityMovement[] {
  return [
    {
      id: asId<'EquityMovement'>('eqm-riverside-esteem-1'),
      projectId: PROJECT_IDS.riverside,
      participantId: SEED_PARTICIPANT_IDS.esteem,
      on: '2026-07-08',
      type: 'contribution',
      amount: fromMajorUnits(450_000),
      basis: 'actual',
      note: 'Initial sponsor equity',
      createdAt: '2026-07-08T05:00:00.000Z',
      createdBy: USER_IDS.accountant,
    },
    {
      id: asId<'EquityMovement'>('eqm-riverside-hsfi-1'),
      projectId: PROJECT_IDS.riverside,
      participantId: SEED_PARTICIPANT_IDS.hsfi,
      on: '2026-07-10',
      type: 'contribution',
      amount: fromMajorUnits(300_000),
      basis: 'actual',
      note: 'First call under the investor agreement',
      createdAt: '2026-07-10T05:00:00.000Z',
      createdBy: USER_IDS.accountant,
    },
    {
      id: asId<'EquityMovement'>('eqm-riverside-esteem-2'),
      projectId: PROJECT_IDS.riverside,
      participantId: SEED_PARTICIPANT_IDS.esteem,
      on: '2026-08-15',
      type: 'contribution',
      amount: fromMajorUnits(150_000),
      basis: 'actual',
      note: 'Second sponsor call',
      createdAt: '2026-08-15T05:00:00.000Z',
      createdBy: USER_IDS.accountant,
    },
  ];
}

export function seedWaterfallVersions(): readonly WaterfallVersion[] {
  const everyone = [SEED_PARTICIPANT_IDS.esteem, SEED_PARTICIPANT_IDS.hsfi];
  return [
    {
      id: WATERFALL_IDS.riversideV1,
      projectId: PROJECT_IDS.riverside,
      version: 1,
      state: 'published',
      tiers: [
        { order: 1, kind: 'required-debt', basis: 'n/a', roundingRule: 'residual-to-last-by-id' },
        { order: 2, kind: 'reserve', basis: 'n/a', roundingRule: 'residual-to-last-by-id' },
        { order: 3, kind: 'return-of-capital', participantIds: everyone, basis: 'pro-rata-outstanding-capital', roundingRule: 'residual-to-last-by-id' },
        { order: 4, kind: 'preferred-return', participantIds: everyone, basis: 'pro-rata-accrued', roundingRule: 'residual-to-last-by-id' },
        { order: 5, kind: 'residual-split', participantIds: everyone, basis: 'declared-shares', roundingRule: 'residual-to-last-by-id' },
      ],
      reserve: fromMajorUnits(50_000),
      draftedBy: USER_IDS.mahvish,
      approvedBy: USER_IDS.jawad,
      approvedAt: '2026-07-05T01:00:00.000Z',
      publishedAt: '2026-07-05T01:05:00.000Z',
      effectiveFrom: '2026-07-01',
      reason: 'Investor agreement executed',
      createdAt: '2026-07-01T00:30:00.000Z',
    },
  ];
}
