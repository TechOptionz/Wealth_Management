/**
 * Transport-agnostic handlers for reports. Generation needs `report.export`;
 * listing and viewing need project read; downloads recheck access at the
 * moment of download, so a revoked member's old link stops working (IAM03).
 */
import { resolveAsOfDate } from '@/shared/config/app-config';
import { NotFoundError } from '@/shared/lib/errors';
import { asId, type ProjectId } from '@/shared/types/common';
import { accessService } from '@/modules/access/service';
import { projectsService } from '@/modules/projects/service';
import { reportsService, allowedTemplates } from './service';
import type { ReportJob, ReportTemplate } from './model';

function visibleJob(id: string): { readonly job: ReportJob; readonly projectId: ProjectId } {
  const job = reportsService.require(asId<'ReportJob'>(id));
  const scope = projectsService.guard(job.projectId, 'project.read');
  const visible = reportsService.list(job.projectId, scope).some((candidate) => candidate.id === job.id);
  // Someone else's investor report looks exactly like one that does not exist.
  if (!visible) throw new NotFoundError('Report', id);
  return { job, projectId: job.projectId };
}

export const reportsApi = {
  list(rawProjectId: string): { readonly jobs: readonly ReportJob[]; readonly templates: readonly ReportTemplate[]; readonly canExport: boolean; readonly canIncludeSensitive: boolean } {
    accessService.guard('development.read');
    const projectId = asId<'Project'>(rawProjectId);
    const scope = projectsService.guard(projectId, 'project.read');
    return {
      jobs: reportsService.list(projectId, scope),
      templates: allowedTemplates(scope),
      canExport: scope.permissions.includes('report.export'),
      canIncludeSensitive: scope.permissions.includes('sales.edit') || scope.permissions.includes('finance.edit') || scope.permissions.includes('payment.record'),
    };
  },

  get(reportId: string): ReportJob {
    accessService.guard('development.read');
    return visibleJob(reportId).job;
  },

  generate(rawProjectId: string, body: { readonly template: ReportTemplate; readonly basis?: 'economic' | 'gross'; readonly includeSensitive?: boolean; readonly scenarioIds?: readonly string[] }): ReportJob {
    accessService.guard('development.read');
    const projectId = asId<'Project'>(rawProjectId);
    const scope = projectsService.guard(projectId, 'report.export');
    return reportsService.generate({
      projectId,
      template: body.template,
      scope,
      ...(body.basis ? { basis: body.basis } : {}),
      includeSensitive: body.includeSensitive ?? false,
      scenarioIds: (body.scenarioIds ?? []).map((id) => asId<'Scenario'>(id)),
      asOf: resolveAsOfDate(),
      actor: accessService.getCurrentUser().id,
    });
  },

  downloadLink(reportId: string): { readonly url: string; readonly expiresAt: string } {
    accessService.guard('development.read');
    const { job } = visibleJob(reportId);
    projectsService.guard(job.projectId, 'report.export');
    return reportsService.issueDownloadLink(job.id, accessService.getCurrentUser().id);
  },

  download(reportId: string, expires: number, signature: string): { readonly filename: string; readonly body: string } {
    accessService.guard('development.read');
    const { job } = visibleJob(reportId);
    projectsService.guard(job.projectId, 'report.export');
    const verified = reportsService.verifyDownload(job.id, accessService.getCurrentUser().id, expires, signature);
    accessService.record({
      actor: accessService.getCurrentUser().name,
      summary: `Report downloaded · ${verified.template}`,
      context: `${verified.meta?.projectCode ?? ''} · ${verified.id}`,
    });
    return { filename: reportsService.filename(verified), body: verified.csv ?? '' };
  },
};
