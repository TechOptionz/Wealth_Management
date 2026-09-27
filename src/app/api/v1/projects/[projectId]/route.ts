import type { NextRequest } from 'next/server';
import { handleV1 } from '@/server/http/v1';
import type { RouteContext } from '@/server/http/route';
import { projectsApi } from '@/modules/projects/api';
import { patchProjectSchema } from '@/modules/projects/validation';

/** GET /api/v1/projects/{id} — project, policy and the caller's scope. */
export async function GET(request: NextRequest, context: RouteContext<{ projectId: string }>) {
  const { projectId } = await context.params;
  return handleV1(request, () => projectsApi.get(projectId));
}

/** PATCH /api/v1/projects/{id} — edit metadata; If-Match carries the model revision (API02). */
export async function PATCH(request: NextRequest, context: RouteContext<{ projectId: string }>) {
  const { projectId } = await context.params;
  return handleV1(request, ({ body, ifMatch }) => projectsApi.patch(projectId, body, ifMatch), { schema: patchProjectSchema });
}
