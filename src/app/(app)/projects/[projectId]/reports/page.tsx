import type { Metadata } from 'next';
import { loadUnitOfWork } from '@/server/db/unit-of-work';
import { renderGuarded } from '@/shared/components/AccessDenied';
import { asId } from '@/shared/types/common';
import { accessService } from '@/modules/access/service';
import { reportsApi } from '@/modules/reports/api';
import { REPORT_TEMPLATES, type ReportTemplate } from '@/modules/reports/model';
import { ReportsScreen, type ReportRow } from '@/modules/reports/components/ReportsScreen';
import { scenariosService } from '@/modules/scenarios/service';
import { projectsService } from '@/modules/projects/service';

export const metadata: Metadata = { title: 'Reports · Development Finance' };

interface PageProps {
  readonly params: Promise<{ readonly projectId: string }>;
  readonly searchParams: Promise<{ readonly template?: string }>;
}

/** RPT01–RPT04 — versioned exports and reporting packs. */
export default async function ReportsPage({ params, searchParams }: PageProps) {
  await loadUnitOfWork();
  const { projectId } = await params;
  const { template } = await searchParams;

  return renderGuarded(() => {
    const { jobs, templates, canExport, canIncludeSensitive } = reportsApi.list(projectId);
    const scope = projectsService.guard(asId<'Project'>(projectId), 'project.read');
    const rows: ReportRow[] = jobs.map((job) => ({
      id: job.id,
      template: job.template,
      state: job.state,
      createdAt: job.createdAt,
      createdByName: accessService.resolveUserName(job.createdBy) ?? 'Unknown',
      modelRevision: job.meta?.modelRevision ?? null,
      basis: job.basis,
      error: job.error ?? null,
      investorCopy: job.participantId !== null,
    }));
    const initial = template && (REPORT_TEMPLATES as readonly string[]).includes(template) ? (template as ReportTemplate) : null;
    return (
      <ReportsScreen
        projectId={projectId}
        jobs={rows}
        templates={templates}
        scenarios={scope.permissions.includes('financials.read') ? scenariosService.list(asId<'Project'>(projectId)).map((s) => ({ id: s.id, name: s.name })) : []}
        canExport={canExport}
        canIncludeSensitive={canIncludeSensitive}
        initialTemplate={initial}
      />
    );
  });
}
