/**
 * Seeded scenarios for Riverside Townhomes (§16.3): base, delayed completion
 * and cost increase. They have no base run yet — each pins the current model
 * on its first calculation, and is flagged stale as soon as the model moves on.
 */
import { asId } from '@/shared/types/common';
import { USER_IDS } from '@/modules/access/data/seed';
import { PROJECT_IDS, RIVERSIDE_ACTUALS_CUTOFF } from '@/modules/projects/data/seed';
import type { Scenario } from '../model';

export const SCENARIO_IDS = {
  base: asId<'Scenario'>('scn-riverside-base'),
  delayed: asId<'Scenario'>('scn-riverside-delayed'),
  costIncrease: asId<'Scenario'>('scn-riverside-cost-increase'),
};

/** The construction category id the budgets seed uses. */
const CONSTRUCTION_CATEGORY_ID = 'cc-riverside-con';

export function seedScenarios(): readonly Scenario[] {
  const version = (reason: string) => [
    { version: 1, baseRunId: null, baseRevision: 12, actualsCutoff: RIVERSIDE_ACTUALS_CUTOFF, at: '2026-09-05T06:30:00.000Z', by: USER_IDS.mahvish, reason },
  ];
  return [
    {
      id: SCENARIO_IDS.base,
      projectId: PROJECT_IDS.riverside,
      name: 'Base case',
      description: 'The current model with no overrides — the reference for comparisons.',
      state: 'draft',
      overrides: {},
      versions: version('Created from the current model'),
      createdAt: '2026-09-05T06:30:00.000Z',
      createdBy: USER_IDS.mahvish,
    },
    {
      id: SCENARIO_IDS.delayed,
      projectId: PROJECT_IDS.riverside,
      name: 'Delayed completion',
      description: 'Every open milestone and forecast three months later: wet season and a slower approval.',
      state: 'draft',
      overrides: { programmeShiftDays: 92 },
      versions: version('Created to test a three-month slip'),
      createdAt: '2026-09-05T06:35:00.000Z',
      createdBy: USER_IDS.mahvish,
    },
    {
      id: SCENARIO_IDS.costIncrease,
      projectId: PROJECT_IDS.riverside,
      name: 'Construction cost increase',
      description: 'Uncommitted construction forecast and unbilled construction commitments 8% higher.',
      state: 'draft',
      overrides: { costUplift: { ppm: 80_000, categoryIds: [CONSTRUCTION_CATEGORY_ID], includeUnbilledCommitments: true } },
      versions: version('Created after the builder flagged escalation'),
      createdAt: '2026-09-05T06:40:00.000Z',
      createdBy: USER_IDS.jawad,
    },
  ];
}
