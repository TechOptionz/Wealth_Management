import type { NextRequest } from 'next/server';
import { handleV1, parseV1Query } from '@/server/http/v1';
import type { RouteContext } from '@/server/http/route';
import { scenariosApi } from '@/modules/scenarios/api';
import { comparisonQuerySchema } from '@/modules/scenarios/validation';

/** GET /api/v1/projects/{id}/comparisons?scenarios=a,b,c — current model vs up to three scenarios (SCN03). */
export async function GET(request: NextRequest, context: RouteContext<{ projectId: string }>) {
  const { projectId } = await context.params;
  return handleV1(request, () => {
    const query = parseV1Query(request, comparisonQuerySchema);
    return scenariosApi.compare(projectId, (query.scenarios ?? '').split(',').filter(Boolean), query.basis);
  });
}
