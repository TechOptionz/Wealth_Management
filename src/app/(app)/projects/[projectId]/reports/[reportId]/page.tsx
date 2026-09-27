import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { loadUnitOfWork } from '@/server/db/unit-of-work';
import { renderGuarded } from '@/shared/components/AccessDenied';
import { isAppError } from '@/shared/lib/errors';
import { accessService } from '@/modules/access/service';
import { projectsService } from '@/modules/projects/service';
import { reportsApi } from '@/modules/reports/api';
import { ReportView } from '@/modules/reports/components/ReportView';

export const metadata: Metadata = { title: 'Report · Development Finance' };

interface PageProps {
  readonly params: Promise<{ readonly projectId: string; readonly reportId: string }>;
}

/** The printable report view (RPT02). */
export default async function ReportPage({ params }: PageProps) {
  await loadUnitOfWork();
  const { projectId, reportId } = await params;

  let job;
  try {
    job = reportsApi.get(reportId);
  } catch (error) {
    if (isAppError(error) && error.code === 'NOT_FOUND') notFound();
    throw error;
  }
  if (job.projectId !== projectId) notFound();

  return renderGuarded(() => {
    const scope = projectsService.guard(job.projectId, 'project.read');
    const authors = Object.fromEntries(job.comments.map((comment) => [comment.by, accessService.resolveUserName(comment.by) ?? 'Unknown']));
    return <ReportView projectId={projectId} job={job} commentAuthors={authors} canComment={scope.permissions.includes('comment.write')} />;
  });
}
