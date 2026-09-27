import type { NextRequest } from 'next/server';
import { handleV1 } from '@/server/http/v1';
import type { RouteContext } from '@/server/http/route';
import { commitmentsApi } from '@/modules/commitments/api';
import { createCommitmentSchema } from '@/modules/commitments/validation';

/**
 * POST /api/v1/projects/{projectId}/commitments — record a contract, net of
 * GST, split across posting cost lines (CST03). The allocations must add up
 * to the contract value. Needs an Idempotency-Key; If-Match carries the model
 * revision.
 */
export async function POST(request: NextRequest, context: RouteContext<{ projectId: string }>) {
  const { projectId } = await context.params;
  return handleV1(request, ({ body, ifMatch }) => commitmentsApi.create(projectId, body, ifMatch), {
    schema: createCommitmentSchema,
    status: 201,
    idempotent: true,
  });
}
