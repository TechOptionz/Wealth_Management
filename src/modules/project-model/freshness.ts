/**
 * What the project context bar says about calculation freshness (§3.3, SUM01).
 *
 * Reads the latest stored run without triggering a calculation — a layout must
 * not write, and a fresh calculation is a write.
 */
import type { ProjectId } from '@/shared/types/common';
import { projectModelService } from './service';

export interface ProjectContextFreshness {
  /** "run rev 12 · 27 Sep · engine 1.0.0", or null before any calculation. */
  readonly label: string | null;
  readonly scenarioLabel: string;
}

export function projectContextFreshness(projectId: ProjectId): ProjectContextFreshness {
  const run = projectModelService.latestRun(projectId);
  return { label: run ? projectModelService.freshnessLabel(run) : null, scenarioLabel: 'Current model' };
}
