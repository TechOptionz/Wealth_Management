import type { NextRequest } from 'next/server';
import { handleV1 } from '@/server/http/v1';
import type { RouteContext } from '@/server/http/route';
import { budgetsApi } from '@/modules/budgets/api';
import { forecastBatchSchema } from '@/modules/budgets/validation';

/**
 * POST /api/v1/projects/{projectId}/forecast-batches — save several line edits
 * atomically (CF07). `If-Match` carries the model revision edited against; a
 * stale one is a 409 whose details hold the latest stored values.
 */
export async function POST(request: NextRequest, context: RouteContext<{ projectId: string }>) {
  const { projectId } = await context.params;
  return handleV1(request, ({ body, ifMatch }) => budgetsApi.forecastBatch(projectId, body, ifMatch), {
    schema: forecastBatchSchema,
    status: 201,
  });
}
