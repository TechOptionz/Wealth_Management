import type { NextRequest } from 'next/server';
import { handleV1 } from '@/server/http/v1';
import type { RouteContext } from '@/server/http/route';
import { fundingApi } from '@/modules/funding/api';
import { createFacilitySchema } from '@/modules/funding/validation';

/**
 * POST /api/v1/projects/{projectId}/facilities — create a debt facility (FIN01).
 * Money is a decimal string; the rate is a percentage string ("8.25").
 * Needs an Idempotency-Key; If-Match carries the model revision (API02, API03).
 */
export async function POST(request: NextRequest, context: RouteContext<{ projectId: string }>) {
  const { projectId } = await context.params;
  return handleV1(request, ({ body, ifMatch }) => fundingApi.createFacility(projectId, body, ifMatch), {
    schema: createFacilitySchema,
    status: 201,
    idempotent: true,
  });
}
