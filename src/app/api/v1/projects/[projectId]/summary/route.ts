import type { NextRequest } from 'next/server';
import { handleV1 } from '@/server/http/v1';
import type { RouteContext } from '@/server/http/route';
import { projectModelApi } from '@/modules/project-model/api';

/** GET /api/v1/projects/{id}/summary — KPIs, monthly totals and exceptions (SUM01–SUM03). */
export async function GET(request: NextRequest, context: RouteContext<{ projectId: string }>) {
  const { projectId } = await context.params;
  const basis = request.nextUrl.searchParams.get('basis') ?? undefined;
  return handleV1(request, () => {
    const payload = projectModelApi.summary(projectId, { basis });
    return {
      runId: payload.run.id,
      modelRevision: payload.run.modelRevision,
      basis: payload.basis,
      stale: payload.stale,
      kpis: payload.view.kpis,
      totals: payload.view.totals,
      exceptions: payload.exceptions,
    };
  });
}
