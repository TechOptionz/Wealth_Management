import type { NextRequest } from 'next/server';
import { handleV1 } from '@/server/http/v1';
import type { RouteContext } from '@/server/http/route';
import { budgetsApi } from '@/modules/budgets/api';
import { publishBaselineSchema } from '@/modules/budgets/validation';

/**
 * POST /api/v1/baselines/{baselineId}/publish — publish a candidate with a
 * reason (PRJ05). Needs an Idempotency-Key; the previous baseline becomes
 * superseded and stays readable (AT02).
 */
export async function POST(request: NextRequest, context: RouteContext<{ baselineId: string }>) {
  const { baselineId } = await context.params;
  return handleV1(request, ({ body }) => budgetsApi.publishBaseline(baselineId, body), {
    schema: publishBaselineSchema,
    idempotent: true,
  });
}
