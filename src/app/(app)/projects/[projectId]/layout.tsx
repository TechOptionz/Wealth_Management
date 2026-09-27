import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { loadUnitOfWork } from '@/server/db/unit-of-work';
import { renderGuarded } from '@/shared/components/AccessDenied';
import { Stack } from '@/shared/components/Layout';
import { isAppError } from '@/shared/lib/errors';
import { projectsApi } from '@/modules/projects/api';
import { ProjectContextBar } from '@/modules/projects/components/ProjectContextBar';
import { projectContextFreshness } from '@/modules/project-model/freshness';

interface LayoutProps {
  readonly children: ReactNode;
  readonly params: Promise<{ readonly projectId: string }>;
}

/**
 * Chrome for every screen inside one project: the context bar with project,
 * scenario, model revision, currency, tax basis and freshness (§3.3).
 *
 * The project guard runs here once. No membership is a 404, the same as an
 * unknown id (IAM02); a member without the permission sees the access banner.
 */
export default async function ProjectLayout({ children, params }: LayoutProps) {
  await loadUnitOfWork();
  const { projectId } = await params;

  let summary;
  try {
    summary = projectsApi.get(projectId);
  } catch (error) {
    if (isAppError(error) && error.code === 'NOT_FOUND') notFound();
    if (isAppError(error) && error.code === 'FORBIDDEN') return renderGuarded(() => { throw error; });
    throw error;
  }

  const { project, policy, scope } = summary;
  const freshness = projectContextFreshness(project.id);

  return (
    <Stack>
      <ProjectContextBar
        projectId={project.id}
        code={project.code}
        name={project.name}
        lifecycle={project.lifecycle}
        currency={project.currency}
        modelRevision={project.modelRevision}
        policyVersion={policy.version}
        actualsCutoff={policy.actualsCutoff}
        displayBasis={policy.tax.displayBasis}
        freshnessLabel={freshness.label}
        scenarioLabel={freshness.scenarioLabel}
        canEditSettings={scope.permissions.includes('project.edit') || scope.permissions.includes('members.manage')}
      />
      {children}
    </Stack>
  );
}
