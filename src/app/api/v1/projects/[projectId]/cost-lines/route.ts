import type { NextRequest } from 'next/server';
import { handleV1, parseV1Query } from '@/server/http/v1';
import type { RouteContext } from '@/server/http/route';
import { budgetsApi } from '@/modules/budgets/api';
import { costLineListQuerySchema, createCostLineSchema } from '@/modules/budgets/validation';

/**
 * GET /api/v1/projects/{projectId}/cost-lines — the cost register (CST02, CF03).
 * Inactive lines are included unless `includeInactive=false`. Amounts are ex GST.
 */
export async function GET(request: NextRequest, context: RouteContext<{ projectId: string }>) {
  const { projectId } = await context.params;
  return handleV1(request, () => budgetsApi.listCostLines(projectId, parseV1Query(request, costLineListQuerySchema)));
}

/**
 * POST /api/v1/projects/{projectId}/cost-lines — create a line (CST02).
 * Quantity × rate and a direct amount are mutually exclusive.
 */
export async function POST(request: NextRequest, context: RouteContext<{ projectId: string }>) {
  const { projectId } = await context.params;
  return handleV1(request, ({ body, ifMatch }) => budgetsApi.createCostLine(projectId, body, ifMatch), {
    schema: createCostLineSchema,
    status: 201,
  });
}
