/**
 * Calculation runs — the only file in this module that touches storage.
 *
 * Runs are immutable (CAL05): they are inserted and read, never updated. The
 * newest run per project (and per scenario) is what every screen shows.
 */
import { createCollection } from '@/server/db/collection';
import type { CalculationRunId, ProjectId, ScenarioId } from '@/shared/types/common';
import type { CalculationRun } from './model';

const runs = createCollection<CalculationRun>('project-model.runs', () => []);

export const projectModelRepository = {
  listRuns: (projectId: ProjectId): readonly CalculationRun[] =>
    [...runs.where((run) => run.projectId === projectId)].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
  findRun: (id: CalculationRunId): CalculationRun | undefined => runs.find(id),
  findByHash: (projectId: ProjectId, inputHash: string, scenarioId: ScenarioId | null): CalculationRun | undefined =>
    runs.findBy((run) => run.projectId === projectId && run.inputHash === inputHash && run.scenarioId === scenarioId && run.status !== 'failed'),
  latestRun: (projectId: ProjectId, scenarioId: ScenarioId | null = null): CalculationRun | undefined =>
    projectModelRepository.listRuns(projectId).find((run) => run.scenarioId === scenarioId),
  insertRun: (run: CalculationRun): CalculationRun => runs.insert(run),
  /** Test isolation. */
  reset: (): void => runs.reset(),
};
