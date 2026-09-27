/**
 * Seeded programme for Riverside Townhomes (§16.3).
 *
 * Ids are stable strings so cost lines, sales events and tests can link to a
 * milestone by name: `ms-riverside-<slug>`.
 */
import { asId, type MilestoneId } from '@/shared/types/common';
import { USER_IDS } from '@/modules/access/data/seed';
import { PROJECT_IDS } from '@/modules/projects/data/seed';
import type { Milestone, TaskDependency } from '../model';

const P = PROJECT_IDS.riverside;

export const MILESTONE_IDS = {
  acquisition: asId<'Milestone'>('ms-riverside-acquisition'),
  contractExchanged: asId<'Milestone'>('ms-riverside-contract-exchanged'),
  landSettlement: asId<'Milestone'>('ms-riverside-land-settlement'),
  design: asId<'Milestone'>('ms-riverside-design'),
  approvals: asId<'Milestone'>('ms-riverside-approvals'),
  daApproved: asId<'Milestone'>('ms-riverside-da-approved'),
  presales: asId<'Milestone'>('ms-riverside-presales'),
  presaleTargetMet: asId<'Milestone'>('ms-riverside-presale-target-met'),
  construction: asId<'Milestone'>('ms-riverside-construction'),
  siteStart: asId<'Milestone'>('ms-riverside-site-start'),
  slabComplete: asId<'Milestone'>('ms-riverside-slab-complete'),
  frameComplete: asId<'Milestone'>('ms-riverside-frame-complete'),
  lockUp: asId<'Milestone'>('ms-riverside-lock-up'),
  practicalCompletion: asId<'Milestone'>('ms-riverside-practical-completion'),
  completion: asId<'Milestone'>('ms-riverside-completion'),
  titlesRegistered: asId<'Milestone'>('ms-riverside-titles-registered'),
  settlement: asId<'Milestone'>('ms-riverside-settlement'),
  firstSettlement: asId<'Milestone'>('ms-riverside-first-settlement'),
  finalSettlement: asId<'Milestone'>('ms-riverside-final-settlement'),
} satisfies Record<string, MilestoneId>;

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

function stage(
  id: MilestoneId,
  code: string,
  name: string,
  plannedStart: string,
  plannedDate: string,
  sortOrder: number,
  extra: Partial<Milestone> = {},
): Milestone {
  return {
    id,
    projectId: P,
    code,
    name,
    kind: 'stage',
    plannedStart,
    plannedDate,
    durationDays: daysBetween(plannedStart, plannedDate),
    completionPercent: 0,
    sortOrder,
    history: [],
    ...extra,
  };
}

function milestone(
  id: MilestoneId,
  code: string,
  name: string,
  parentId: MilestoneId,
  plannedDate: string,
  sortOrder: number,
  extra: Partial<Milestone> = {},
): Milestone {
  return {
    id,
    projectId: P,
    code,
    name,
    kind: 'milestone',
    parentId,
    plannedDate,
    completionPercent: 0,
    sortOrder,
    history: [],
    ...extra,
  };
}

export function seedMilestones(): readonly Milestone[] {
  const owner = { ownerUserId: USER_IDS.mahvish };
  return [
    stage(MILESTONE_IDS.acquisition, 'ACQ', 'Acquisition', '2026-07-01', '2026-10-15', 10, { completionPercent: 50, ownerUserId: USER_IDS.jawad }),
    milestone(MILESTONE_IDS.contractExchanged, 'ACQ-01', 'Contract exchanged', MILESTONE_IDS.acquisition, '2026-07-10', 11, {
      actualDate: '2026-07-10',
      completionPercent: 100,
      ownerUserId: USER_IDS.jawad,
    }),
    milestone(MILESTONE_IDS.landSettlement, 'ACQ-02', 'Land settlement', MILESTONE_IDS.acquisition, '2026-10-15', 12, { ownerUserId: USER_IDS.jawad }),

    stage(MILESTONE_IDS.design, 'DES', 'Design', '2026-07-15', '2027-01-31', 20, { completionPercent: 25 }),

    stage(MILESTONE_IDS.approvals, 'APP', 'Approvals', '2026-10-01', '2027-01-31', 30),
    milestone(MILESTONE_IDS.daApproved, 'APP-01', 'DA approved', MILESTONE_IDS.approvals, '2027-01-20', 31),

    stage(MILESTONE_IDS.presales, 'PRE', 'Presales', '2026-09-01', '2027-03-31', 40, { completionPercent: 10 }),
    milestone(MILESTONE_IDS.presaleTargetMet, 'PRE-01', 'Presale target met', MILESTONE_IDS.presales, '2027-03-15', 41),

    stage(MILESTONE_IDS.construction, 'CON', 'Construction', '2027-02-01', '2028-03-31', 50, owner),
    milestone(MILESTONE_IDS.siteStart, 'CON-01', 'Site start', MILESTONE_IDS.construction, '2027-02-01', 51, owner),
    milestone(MILESTONE_IDS.slabComplete, 'CON-02', 'Slab complete', MILESTONE_IDS.construction, '2027-05-15', 52, owner),
    milestone(MILESTONE_IDS.frameComplete, 'CON-03', 'Frame complete', MILESTONE_IDS.construction, '2027-09-30', 53, owner),
    milestone(MILESTONE_IDS.lockUp, 'CON-04', 'Lock-up', MILESTONE_IDS.construction, '2027-12-15', 54, owner),
    milestone(MILESTONE_IDS.practicalCompletion, 'CON-05', 'Practical completion', MILESTONE_IDS.construction, '2028-03-31', 55, owner),

    stage(MILESTONE_IDS.completion, 'CMP', 'Completion', '2028-04-01', '2028-04-30', 60),
    milestone(MILESTONE_IDS.titlesRegistered, 'CMP-01', 'Titles registered', MILESTONE_IDS.completion, '2028-04-20', 61),

    stage(MILESTONE_IDS.settlement, 'SET', 'Settlement', '2028-05-01', '2028-06-30', 70),
    milestone(MILESTONE_IDS.firstSettlement, 'SET-01', 'First settlement', MILESTONE_IDS.settlement, '2028-05-15', 71),
    milestone(MILESTONE_IDS.finalSettlement, 'SET-02', 'Final settlement', MILESTONE_IDS.settlement, '2028-06-30', 72),
  ];
}

function dependency(index: number, predecessorId: MilestoneId, successorId: MilestoneId, lagDays: number): TaskDependency {
  return {
    id: asId<'TaskDependency'>(`dep-riverside-${String(index).padStart(2, '0')}`),
    projectId: P,
    predecessorId,
    successorId,
    type: 'FS',
    lagDays,
  };
}

export function seedDependencies(): readonly TaskDependency[] {
  return [
    dependency(1, MILESTONE_IDS.daApproved, MILESTONE_IDS.siteStart, 10),
    dependency(2, MILESTONE_IDS.landSettlement, MILESTONE_IDS.siteStart, 0),
    dependency(3, MILESTONE_IDS.siteStart, MILESTONE_IDS.slabComplete, 0),
    dependency(4, MILESTONE_IDS.slabComplete, MILESTONE_IDS.frameComplete, 0),
    dependency(5, MILESTONE_IDS.frameComplete, MILESTONE_IDS.lockUp, 0),
    dependency(6, MILESTONE_IDS.lockUp, MILESTONE_IDS.practicalCompletion, 0),
    dependency(7, MILESTONE_IDS.practicalCompletion, MILESTONE_IDS.titlesRegistered, 14),
    dependency(8, MILESTONE_IDS.titlesRegistered, MILESTONE_IDS.firstSettlement, 20),
    dependency(9, MILESTONE_IDS.firstSettlement, MILESTONE_IDS.finalSettlement, 0),
  ];
}
