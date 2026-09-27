/**
 * Transport-agnostic handlers for the projects module.
 *
 * Every handler opens with the platform capability guard and then the
 * per-project guard, so pages, JSON routes and exports all pass through the
 * same two doors (NFR-01, IAM02).
 */
import { accessService } from '@/modules/access/service';
import { fromMajorUnits, money } from '@/shared/lib/money';
import { asId, type ProjectId } from '@/shared/types/common';
import { projectsService } from './service';
import type { LegalEntity, Project, ProjectAccess, ProjectPolicy, ProjectScope } from './model';
import type { CreateProjectBody, PatchProjectBody, ProjectListQuery } from './validation';

export interface ProjectSummary {
  readonly project: Project;
  readonly policy: ProjectPolicy;
  readonly scope: ProjectScope;
  readonly memberCount: number;
  readonly activationBlockers: readonly string[];
}

function decimalToMoney(value: string | undefined | null) {
  if (value === undefined || value === null) return undefined;
  return fromMajorUnits(Number(value));
}

export const projectsApi = {
  list(query: ProjectListQuery): { readonly items: readonly ProjectSummary[] } {
    accessService.guard('development.read');
    const items = projectsService
      .listVisibleProjects()
      .filter((project) => query.lifecycle === 'all' || project.lifecycle === query.lifecycle)
      .map((project) => projectsApi.get(project.id));
    return { items };
  },

  get(rawProjectId: string): ProjectSummary {
    accessService.guard('development.read');
    const projectId = asId<'Project'>(rawProjectId);
    const scope = projectsService.guard(projectId, 'project.read');
    const project = projectsService.require(projectId);
    return {
      project,
      policy: projectsService.policyFor(projectId),
      scope,
      memberCount: projectsService.listMembers(projectId).filter((row) => row.status === 'active').length,
      activationBlockers: project.lifecycle === 'draft' ? projectsService.activationBlockers(project) : [],
    };
  },

  legalEntities(): readonly LegalEntity[] {
    accessService.guard('development.read');
    return projectsService.listLegalEntities();
  },

  create(body: CreateProjectBody): Project {
    accessService.guard('development.read');
    const actor = accessService.getCurrentUser();
    return projectsService.createProject({
      code: body.code,
      name: body.name,
      legalEntityId: asId<'LegalEntity'>(body.legalEntityId),
      type: body.type as Project['type'],
      address: body.address,
      state: body.state as Project['state'],
      startDate: body.startDate,
      expectedCompletion: body.expectedCompletion,
      forecastHorizonMonths: body.forecastHorizonMonths,
      reportingBasis: body.reportingBasis,
      openingCash: decimalToMoney(body.openingCash) ?? money(0),
      openingRestrictedCash: decimalToMoney(body.openingRestrictedCash) ?? money(0),
      actor: actor.id,
    });
  },

  patch(rawProjectId: string, body: PatchProjectBody, expectedRevision?: number): Project {
    accessService.guard('development.read');
    const projectId = asId<'Project'>(rawProjectId);
    projectsService.guard(projectId, 'project.edit');
    const actor = accessService.getCurrentUser();
    return projectsService.updateProject(
      projectId,
      {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.address !== undefined ? { address: body.address } : {}),
        ...(body.type !== undefined ? { type: body.type as Project['type'] } : {}),
        ...(body.state !== undefined ? { state: body.state as Project['state'] } : {}),
        ...(body.expectedCompletion !== undefined ? { expectedCompletion: body.expectedCompletion } : {}),
        ...(body.forecastHorizonMonths !== undefined ? { forecastHorizonMonths: body.forecastHorizonMonths } : {}),
        ...(body.reportingBasis !== undefined ? { reportingBasis: body.reportingBasis } : {}),
        ...(body.openingCash !== undefined ? { openingCash: decimalToMoney(body.openingCash) } : {}),
        ...(body.openingRestrictedCash !== undefined ? { openingRestrictedCash: decimalToMoney(body.openingRestrictedCash) } : {}),
      },
      actor.id,
      expectedRevision,
    );
  },

  members(rawProjectId: string): readonly ProjectAccess[] {
    accessService.guard('development.read');
    const projectId: ProjectId = asId<'Project'>(rawProjectId);
    projectsService.guard(projectId, 'members.manage');
    return projectsService.listMembers(projectId);
  },

  policyHistory(rawProjectId: string): readonly ProjectPolicy[] {
    accessService.guard('development.read');
    const projectId: ProjectId = asId<'Project'>(rawProjectId);
    projectsService.guard(projectId, 'financials.read');
    return projectsService.policyHistory(projectId);
  },
};
