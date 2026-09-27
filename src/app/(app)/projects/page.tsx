import type { Metadata } from 'next';
import { loadUnitOfWork } from '@/server/db/unit-of-work';
import { renderGuarded } from '@/shared/components/AccessDenied';
import { resolveAsOfDate } from '@/shared/config/app-config';
import { projectsApi } from '@/modules/projects/api';
import { PROJECT_ROLE_LABELS } from '@/modules/projects/model';
import { ProjectsScreen, type ProjectListRow } from '@/modules/projects/components/ProjectsScreen';

export const metadata: Metadata = { title: 'Development projects · Holdfast' };

/** PRJ01–PRJ03 — the projects the signed-in person may open. */
export default async function ProjectsPage() {
  await loadUnitOfWork();
  const asOf = resolveAsOfDate();

  return renderGuarded(() => {
    const { items } = projectsApi.list({ lifecycle: 'all' });
    const rows: readonly ProjectListRow[] = items.map(({ project, scope, memberCount, activationBlockers }) => ({
      id: project.id,
      code: project.code,
      name: project.name,
      type: project.type,
      state: project.state,
      lifecycle: project.lifecycle,
      startDate: project.startDate,
      expectedCompletion: project.expectedCompletion,
      modelRevision: project.modelRevision,
      memberCount,
      roleLabel: PROJECT_ROLE_LABELS[scope.role],
      setupStepsCompleted: project.setupStepsCompleted,
      activationBlockers,
    }));
    return (
      <ProjectsScreen
        rows={rows}
        legalEntities={projectsApi.legalEntities().map((entity) => ({ id: entity.id, name: entity.legalName }))}
        today={asOf}
        canCreate
      />
    );
  });
}
