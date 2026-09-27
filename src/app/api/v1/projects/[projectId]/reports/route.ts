import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { handleV1 } from '@/server/http/v1';
import type { RouteContext } from '@/server/http/route';
import { reportsApi } from '@/modules/reports/api';
import { REPORT_TEMPLATES, type ReportTemplate } from '@/modules/reports/model';

const generateSchema = z.object({
  template: z.enum(REPORT_TEMPLATES as unknown as [ReportTemplate, ...ReportTemplate[]]),
  basis: z.enum(['economic', 'gross']).optional(),
  includeSensitive: z.boolean().default(false),
  scenarioIds: z.array(z.string()).max(3).default([]),
});

/** GET /api/v1/projects/{id}/reports — report jobs the caller may see, without file bodies. */
export async function GET(request: NextRequest, context: RouteContext<{ projectId: string }>) {
  const { projectId } = await context.params;
  return handleV1(request, () =>
    reportsApi.list(projectId).jobs.map((job) => ({
      id: job.id,
      template: job.template,
      state: job.state,
      runId: job.runId,
      meta: job.meta ?? null,
      dataHash: job.dataHash ?? null,
      error: job.error ?? null,
      createdAt: job.createdAt,
    })),
  );
}

/** POST /api/v1/projects/{id}/reports — generate from the current snapshot (RPT01). Idempotency-Key required. */
export async function POST(request: NextRequest, context: RouteContext<{ projectId: string }>) {
  const { projectId } = await context.params;
  return handleV1(
    request,
    ({ body }) => {
      const job = reportsApi.generate(projectId, body);
      return { id: job.id, template: job.template, state: job.state, runId: job.runId, meta: job.meta ?? null, dataHash: job.dataHash ?? null, error: job.error ?? null };
    },
    { schema: generateSchema, status: 201, idempotent: true },
  );
}
