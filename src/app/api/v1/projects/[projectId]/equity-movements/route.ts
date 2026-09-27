import type { NextRequest } from 'next/server';
import { handleV1 } from '@/server/http/v1';
import type { RouteContext } from '@/server/http/route';
import { fundingApi } from '@/modules/funding/api';
import { equityMovementSchema } from '@/modules/funding/validation';

/**
 * POST /api/v1/projects/{projectId}/equity-movements — record a contribution
 * or distribution component (EQ02). Needs an Idempotency-Key; If-Match
 * carries the model revision (API02, API03).
 */
export async function POST(request: NextRequest, context: RouteContext<{ projectId: string }>) {
  const { projectId } = await context.params;
  return handleV1(request, ({ body, ifMatch }) => fundingApi.recordEquityMovement(projectId, body, ifMatch), {
    schema: equityMovementSchema,
    status: 201,
    idempotent: true,
  });
}
