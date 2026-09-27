import type { NextRequest } from 'next/server';
import { handleV1 } from '@/server/http/v1';
import type { RouteContext } from '@/server/http/route';
import { budgetsApi } from '@/modules/budgets/api';
import { createBaselineSchema } from '@/modules/budgets/validation';

/** POST /api/v1/projects/{projectId}/baselines — snapshot a baseline candidate (PRJ05). */
export async function POST(request: NextRequest, context: RouteContext<{ projectId: string }>) {
  const { projectId } = await context.params;
  return handleV1(request, ({ body }) => budgetsApi.createBaseline(projectId, body), { schema: createBaselineSchema, status: 201 });
}
