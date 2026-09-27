import type { NextRequest } from 'next/server';
import { handleV1 } from '@/server/http/v1';
import type { RouteContext } from '@/server/http/route';
import { scenariosApi } from '@/modules/scenarios/api';
import { createScenarioSchema } from '@/modules/scenarios/validation';

/** GET /api/v1/projects/{id}/scenarios */
export async function GET(request: NextRequest, context: RouteContext<{ projectId: string }>) {
  const { projectId } = await context.params;
  return handleV1(request, () => scenariosApi.list(projectId));
}

/** POST /api/v1/projects/{id}/scenarios — snapshot and fork (SCN01). Idempotency-Key required. */
export async function POST(request: NextRequest, context: RouteContext<{ projectId: string }>) {
  const { projectId } = await context.params;
  return handleV1(request, ({ body }) => scenariosApi.create(projectId, body), { schema: createScenarioSchema, status: 201, idempotent: true });
}
