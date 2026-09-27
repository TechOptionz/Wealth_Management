/**
 * Scenarios data access — the only file in this module that touches storage.
 */
import { createCollection } from '@/server/db/collection';
import type { ProjectId, ScenarioId } from '@/shared/types/common';
import type { Scenario } from './model';
import { seedScenarios } from './data/seed';

const scenarios = createCollection<Scenario>('scenarios.scenarios', seedScenarios);

export const scenariosRepository = {
  list: (projectId: ProjectId): readonly Scenario[] => scenarios.where((scenario) => scenario.projectId === projectId),
  find: (id: ScenarioId): Scenario | undefined => scenarios.find(id),
  insert: (scenario: Scenario): Scenario => scenarios.insert(scenario),
  update: (id: ScenarioId, changes: Partial<Omit<Scenario, 'id'>>): Scenario | undefined => scenarios.update(id, changes),
  /** Test isolation. */
  reset: (): void => scenarios.reset(),
};
