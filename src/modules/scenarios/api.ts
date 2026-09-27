/**
 * Transport-agnostic handlers for scenarios. Reads need financial read access;
 * creating and changing drafts needs budget edit; publishing needs publisher
 * authority (SCN05).
 */
import { accessService } from '@/modules/access/service';
import { projectsService } from '@/modules/projects/service';
import { asId, type ProjectId } from '@/shared/types/common';
import { scenariosService } from './service';
import { toOverrides, type RawOverrides } from './overrides';
import type { ComparisonColumn, Scenario, SensitivityAxis, SensitivityMatrix } from './model';
import type { CalculationRun } from '@/modules/project-model/model';

function projectOf(scenarioId: string): { readonly scenario: Scenario; readonly projectId: ProjectId } {
  const scenario = scenariosService.require(asId<'Scenario'>(scenarioId));
  return { scenario, projectId: scenario.projectId };
}

export const scenariosApi = {
  list(rawProjectId: string): readonly Scenario[] {
    accessService.guard('development.read');
    const projectId = asId<'Project'>(rawProjectId);
    projectsService.guard(projectId, 'financials.read');
    return scenariosService.list(projectId);
  },

  create(rawProjectId: string, body: { readonly name: string; readonly description?: string; readonly overrides: RawOverrides }): Scenario {
    accessService.guard('development.read');
    const projectId = asId<'Project'>(rawProjectId);
    projectsService.guard(projectId, 'budget.edit');
    return scenariosService.create({ projectId, name: body.name, description: body.description, overrides: toOverrides(body.overrides), actor: accessService.getCurrentUser().id });
  },

  calculate(scenarioId: string): CalculationRun {
    accessService.guard('development.read');
    const { projectId } = projectOf(scenarioId);
    // A missing scenario and a scenario in a project the caller cannot see look the same.
    projectsService.guard(projectId, 'financials.read');
    return scenariosService.calculate(asId<'Scenario'>(scenarioId), accessService.getCurrentUser().id);
  },

  refresh(scenarioId: string): Scenario {
    accessService.guard('development.read');
    const { projectId } = projectOf(scenarioId);
    projectsService.guard(projectId, 'budget.edit');
    return scenariosService.refresh(asId<'Scenario'>(scenarioId), accessService.getCurrentUser().id);
  },

  publish(scenarioId: string, reason: string): Scenario {
    accessService.guard('development.read');
    const { projectId } = projectOf(scenarioId);
    projectsService.guard(projectId, 'scenario.publish');
    return scenariosService.publish({ scenarioId: asId<'Scenario'>(scenarioId), actor: accessService.getCurrentUser().id, reason });
  },

  compare(rawProjectId: string, scenarioIds: readonly string[], basis: 'economic' | 'gross'): readonly ComparisonColumn[] {
    accessService.guard('development.read');
    const projectId = asId<'Project'>(rawProjectId);
    projectsService.guard(projectId, 'financials.read');
    return scenariosService.compare(projectId, scenarioIds.map((id) => asId<'Scenario'>(id)), basis);
  },

  sensitivity(rawProjectId: string, body: { readonly scenarioId?: string; readonly rows: SensitivityAxis; readonly columns: SensitivityAxis }): SensitivityMatrix {
    accessService.guard('development.read');
    const projectId = asId<'Project'>(rawProjectId);
    projectsService.guard(projectId, 'financials.read');
    return scenariosService.sensitivity({ projectId, ...(body.scenarioId ? { scenarioId: asId<'Scenario'>(body.scenarioId) } : {}), rows: body.rows, columns: body.columns });
  },
};
