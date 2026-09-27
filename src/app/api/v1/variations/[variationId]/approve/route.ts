import type { NextRequest } from 'next/server';
import { handleV1 } from '@/server/http/v1';
import type { RouteContext } from '@/server/http/route';
import { commitmentsApi } from '@/modules/commitments/api';
import { decideVariationSchema } from '@/modules/commitments/validation';

/**
 * POST /api/v1/variations/{variationId}/approve — approve (or, with
 * decision "rejected" and a reason, reject) a submitted variation. Needs
 * budget.edit; the submitter cannot approve their own (IAM04).
 */
export async function POST(request: NextRequest, context: RouteContext<{ variationId: string }>) {
  const { variationId } = await context.params;
  return handleV1(request, ({ body }) => commitmentsApi.decideVariation(variationId, body), {
    schema: decideVariationSchema,
    idempotent: true,
  });
}
