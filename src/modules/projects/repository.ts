/**
 * Projects data access — the only file in this module that touches storage.
 */
import { createCollection } from '@/server/db/collection';
import type { LegalEntityId, OrganisationId, ProjectAccessId, ProjectId, UserId } from '@/shared/types/common';
import type { LegalEntity, Organisation, Project, ProjectAccess, ProjectPolicy } from './model';
import {
  seedLegalEntities,
  seedOrganisations,
  seedProjectAccess,
  seedProjectPolicies,
  seedProjects,
} from './data/seed';

const organisations = createCollection<Organisation>('projects.organisations', seedOrganisations);
const legalEntities = createCollection<LegalEntity>('projects.legal-entities', seedLegalEntities);
const projects = createCollection<Project>('projects.projects', seedProjects);
const policies = createCollection<ProjectPolicy>('projects.policies', seedProjectPolicies);
const access = createCollection<ProjectAccess>('projects.access', seedProjectAccess);

export const projectsRepository = {
  listOrganisations: (): readonly Organisation[] => organisations.list(),
  findOrganisation: (id: OrganisationId): Organisation | undefined => organisations.find(id),

  listLegalEntities: (organisationId?: OrganisationId): readonly LegalEntity[] =>
    organisationId ? legalEntities.where((entity) => entity.organisationId === organisationId) : legalEntities.list(),
  findLegalEntity: (id: LegalEntityId): LegalEntity | undefined => legalEntities.find(id),
  insertLegalEntity: (entity: LegalEntity): LegalEntity => legalEntities.insert(entity),

  listProjects: (): readonly Project[] => projects.list(),
  findProject: (id: ProjectId): Project | undefined => projects.find(id),
  findProjectByCode: (organisationId: OrganisationId, code: string): Project | undefined =>
    projects.findBy((project) => project.organisationId === organisationId && project.code.toLowerCase() === code.toLowerCase()),
  insertProject: (project: Project): Project => projects.insert(project),
  updateProject: (id: ProjectId, changes: Partial<Omit<Project, 'id'>>): Project | undefined => projects.update(id, changes),

  /** Policy versions for a project, oldest first. */
  listPolicies: (projectId: ProjectId): readonly ProjectPolicy[] =>
    [...policies.where((policy) => policy.projectId === projectId)].sort((a, b) => a.version - b.version),
  insertPolicy: (policy: ProjectPolicy): ProjectPolicy => policies.insert(policy),

  listAccess: (projectId: ProjectId): readonly ProjectAccess[] => access.where((row) => row.projectId === projectId),
  listAccessForUser: (userId: UserId): readonly ProjectAccess[] => access.where((row) => row.userId === userId),
  findAccess: (id: ProjectAccessId): ProjectAccess | undefined => access.find(id),
  findAccessFor: (projectId: ProjectId, userId: UserId): ProjectAccess | undefined =>
    access.findBy((row) => row.projectId === projectId && row.userId === userId),
  insertAccess: (row: ProjectAccess): ProjectAccess => access.insert(row),
  updateAccess: (id: ProjectAccessId, changes: Partial<Omit<ProjectAccess, 'id'>>): ProjectAccess | undefined =>
    access.update(id, changes),

  /** Test isolation. */
  reset: (): void => {
    organisations.reset();
    legalEntities.reset();
    projects.reset();
    policies.reset();
    access.reset();
  },
};
