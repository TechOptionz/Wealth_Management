'use server';

import { revalidatePath } from 'next/cache';
import { asId } from '@/shared/types/common';
import type { ActionResult } from '@/shared/lib/action-result';
import { runAction } from '@/server/actions/run-action';
import { readBoolean, readChoice, readString, requireString } from '@/shared/lib/form-data';
import { resolveAsOfDate } from '@/shared/config/app-config';
import { accessService } from '@/modules/access/service';
import { projectsService } from '@/modules/projects/service';
import { reportsService } from './service';
import { reportsApi } from './api';
import { REPORT_TEMPLATES } from './model';

function revalidate(projectId: string): void {
  revalidatePath(`/projects/${projectId}/reports`);
}

/** RPT01 — generate a report from the current snapshot. */
export async function generateReportAction(_previous: ActionResult<unknown>, form: FormData): Promise<ActionResult<unknown>> {
  return runAction(
    (job: { state: string; error?: string }) => (job.state === 'completed' ? 'Report generated' : `Report failed: ${job.error ?? 'unknown error'}`),
    () => {
      const projectId = requireString(form, 'projectId', 'Project');
      const template = readChoice(form, 'template', REPORT_TEMPLATES) ?? 'feasibility-summary';
      const scenarioIds = form.getAll('scenarioIds').filter((value): value is string => typeof value === 'string' && value !== '');
      const basis = readChoice(form, 'basis', ['economic', 'gross'] as const);
      const job = reportsApi.generate(projectId, { template, includeSensitive: readBoolean(form, 'includeSensitive'), scenarioIds, ...(basis ? { basis } : {}) });
      revalidate(projectId);
      return job;
    },
  );
}

/** RPT03 — retry a failed job without touching earlier successful reports. */
export async function retryReportAction(_previous: ActionResult<unknown>, form: FormData): Promise<ActionResult<unknown>> {
  return runAction('Report retried', () => {
    accessService.guard('development.read');
    const job = reportsService.require(asId<'ReportJob'>(requireString(form, 'reportId', 'Report')));
    const scope = projectsService.guard(job.projectId, 'report.export');
    const retried = reportsService.retry(job.id, scope, accessService.getCurrentUser().id, resolveAsOfDate());
    revalidate(job.projectId);
    return retried;
  });
}

/** RPT04 — comment on an approved snapshot without changing it. */
export async function commentReportAction(_previous: ActionResult<unknown>, form: FormData): Promise<ActionResult<unknown>> {
  return runAction('Comment added', () => {
    accessService.guard('development.read');
    const job = reportsService.require(asId<'ReportJob'>(requireString(form, 'reportId', 'Report')));
    projectsService.guard(job.projectId, 'comment.write');
    const updated = reportsService.addComment(job.id, readString(form, 'text') ?? '', accessService.getCurrentUser().id, readString(form, 'attachmentName'));
    revalidatePath(`/projects/${job.projectId}/reports/${job.id}`);
    return updated;
  });
}

/** Issue a short-lived signed download link. */
export async function downloadLinkAction(_previous: ActionResult<unknown>, form: FormData): Promise<ActionResult<unknown>> {
  return runAction('Download link ready · valid for 15 minutes', () => reportsApi.downloadLink(requireString(form, 'reportId', 'Report')));
}
