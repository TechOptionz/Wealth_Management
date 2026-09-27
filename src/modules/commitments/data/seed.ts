/**
 * Seeded suppliers, commitments and variations for Riverside Townhomes.
 *
 * All amounts are net (ex GST). Cost line ids match the budgets seed by
 * convention (`cl-riverside-<lowercased code>`); a seed function must not read
 * another repository, so they are spelled out here.
 */
import { asId } from '@/shared/types/common';
import { fromMajorUnits } from '@/shared/lib/money';
import { USER_IDS } from '@/modules/access/data/seed';
import { PROJECT_IDS } from '@/modules/projects/data/seed';
import type { Commitment, Supplier, Variation } from '../model';

export const COST_LINE_IDS = {
  prof01: asId<'CostLine'>('cl-riverside-prof-01'),
  con01: asId<'CostLine'>('cl-riverside-con-01'),
  con02: asId<'CostLine'>('cl-riverside-con-02'),
  acq03: asId<'CostLine'>('cl-riverside-acq-03'),
};

export const SUPPLIER_IDS = {
  brisbaneCivil: asId<'Supplier'>('sup-riverside-brisbane-civil'),
  meridian: asId<'Supplier'>('sup-riverside-meridian'),
  harbourLegal: asId<'Supplier'>('sup-riverside-harbour-legal'),
};

export const COMMITMENT_IDS = {
  c001: asId<'Commitment'>('cmt-riverside-c001'),
  c002: asId<'Commitment'>('cmt-riverside-c002'),
};

export const VARIATION_IDS = {
  v001: asId<'Variation'>('var-riverside-v001'),
  v002: asId<'Variation'>('var-riverside-v002'),
};

export const STAGE_IDS = {
  concept: 'stg-c001-concept',
  da: 'stg-c001-da',
  cd: 'stg-c001-cd',
};

export function seedSuppliers(): readonly Supplier[] {
  return [
    {
      id: SUPPLIER_IDS.brisbaneCivil,
      projectId: PROJECT_IDS.riverside,
      name: 'Brisbane Civil & Build Pty Ltd',
      abn: '52 000 000 111',
      contactReference: 'Contracts administrator · claims@…',
      active: true,
      bankDetailsVerified: true,
    },
    {
      id: SUPPLIER_IDS.meridian,
      projectId: PROJECT_IDS.riverside,
      name: 'Meridian Design Studio',
      abn: '17 000 000 222',
      contactReference: 'Practice manager',
      active: true,
      bankDetailsVerified: true,
    },
    {
      id: SUPPLIER_IDS.harbourLegal,
      projectId: PROJECT_IDS.riverside,
      name: 'Harbour Legal',
      abn: '93 000 000 333',
      active: true,
      bankDetailsVerified: false,
    },
  ];
}

export function seedCommitments(): readonly Commitment[] {
  return [
    {
      id: COMMITMENT_IDS.c001,
      projectId: PROJECT_IDS.riverside,
      supplierId: SUPPLIER_IDS.meridian,
      reference: 'C-001',
      title: 'Architectural design services',
      originalAmount: fromMajorUnits(186_000),
      taxTreatment: 'standard-gst',
      startDate: '2026-07-03',
      endDate: '2027-03-31',
      state: 'authorised',
      authorisedBy: USER_IDS.jawad,
      authorisedAt: '2026-07-03T02:15:00.000Z',
      attachmentName: 'Meridian_Consultancy_Agreement_signed.pdf',
      stages: [
        { id: STAGE_IDS.concept, name: 'Concept design', amount: fromMajorUnits(56_000), plannedDate: '2026-07-31' },
        { id: STAGE_IDS.da, name: 'Development application', amount: fromMajorUnits(70_000), plannedDate: '2026-09-30' },
        { id: STAGE_IDS.cd, name: 'Construction documentation', amount: fromMajorUnits(60_000), plannedDate: '2027-01-31' },
      ],
      allocations: [
        { costLineId: COST_LINE_IDS.prof01, stageId: STAGE_IDS.concept, amount: fromMajorUnits(56_000) },
        { costLineId: COST_LINE_IDS.prof01, stageId: STAGE_IDS.da, amount: fromMajorUnits(70_000) },
        { costLineId: COST_LINE_IDS.prof01, stageId: STAGE_IDS.cd, amount: fromMajorUnits(60_000) },
      ],
      createdAt: '2026-07-02T05:00:00.000Z',
      createdBy: USER_IDS.mahvish,
    },
    {
      id: COMMITMENT_IDS.c002,
      projectId: PROJECT_IDS.riverside,
      supplierId: SUPPLIER_IDS.brisbaneCivil,
      reference: 'C-002',
      title: 'Head contract · civil and build',
      originalAmount: fromMajorUnits(2_980_000),
      taxTreatment: 'standard-gst',
      startDate: '2026-08-25',
      endDate: '2028-05-31',
      state: 'authorised',
      authorisedBy: USER_IDS.jawad,
      authorisedAt: '2026-08-25T04:40:00.000Z',
      attachmentName: 'AS4000_Head_Contract_executed.pdf',
      stages: [],
      allocations: [{ costLineId: COST_LINE_IDS.con01, amount: fromMajorUnits(2_980_000) }],
      createdAt: '2026-08-20T01:30:00.000Z',
      createdBy: USER_IDS.mahvish,
    },
  ];
}

export function seedVariations(): readonly Variation[] {
  return [
    {
      id: VARIATION_IDS.v001,
      projectId: PROJECT_IDS.riverside,
      commitmentId: COMMITMENT_IDS.c002,
      reference: 'V-001',
      description: 'Tender clarification – slab thickening',
      amount: fromMajorUnits(140_000),
      state: 'approved',
      submittedBy: USER_IDS.mahvish,
      submittedAt: '2026-08-26T03:10:00.000Z',
      decidedBy: USER_IDS.jawad,
      decidedAt: '2026-08-27T00:45:00.000Z',
      reason: 'Geotech report confirmed reactive clay; priced at tender rates',
      allocations: [{ costLineId: COST_LINE_IDS.con01, amount: fromMajorUnits(140_000) }],
    },
    {
      id: VARIATION_IDS.v002,
      projectId: PROJECT_IDS.riverside,
      commitmentId: COMMITMENT_IDS.c002,
      reference: 'V-002',
      description: 'Additional retaining wall',
      amount: fromMajorUnits(36_000),
      state: 'submitted',
      submittedBy: USER_IDS.mahvish,
      submittedAt: '2026-09-04T06:20:00.000Z',
      allocations: [{ costLineId: COST_LINE_IDS.con01, amount: fromMajorUnits(36_000) }],
    },
  ];
}
