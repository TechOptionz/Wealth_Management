import type { NextRequest } from 'next/server';
import { handleV1 } from '@/server/http/v1';
import type { RouteContext } from '@/server/http/route';
import { commitmentsApi } from '@/modules/commitments/api';
import { submitVariationSchema } from '@/modules/commitments/validation';

/**
 * POST /api/v1/commitments/{commitmentId}/variations — submit a variation
 * (CST04). It is pending risk until someone other than the submitter approves it.
 */
export async function POST(request: NextRequest, context: RouteContext<{ commitmentId: string }>) {
  const { commitmentId } = await context.params;
  return handleV1(request, ({ body }) => commitmentsApi.submitVariation(commitmentId, body), {
    schema: submitVariationSchema,
    status: 201,
    idempotent: true,
  });
}
