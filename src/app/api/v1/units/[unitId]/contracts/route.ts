import type { NextRequest } from 'next/server';
import { handleV1 } from '@/server/http/v1';
import type { RouteContext } from '@/server/http/route';
import { salesApi } from '@/modules/sales/api';
import { createContractSchema } from '@/modules/sales/validation';

/**
 * POST /api/v1/units/{unitId}/contracts — record a sale contract (YLD03). It
 * starts reserved; the unit must have no live contract. Needs an
 * Idempotency-Key (API03).
 */
export async function POST(request: NextRequest, context: RouteContext<{ unitId: string }>) {
  const { unitId } = await context.params;
  return handleV1(request, ({ body, ifMatch }) => salesApi.createContract(unitId, body, ifMatch), {
    schema: createContractSchema,
    status: 201,
    idempotent: true,
  });
}
