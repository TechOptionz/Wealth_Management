import type { NextRequest } from 'next/server';
import { handleV1 } from '@/server/http/v1';
import type { RouteContext } from '@/server/http/route';
import { salesApi } from '@/modules/sales/api';
import { importUnitsSchema } from '@/modules/sales/validation';

/**
 * POST /api/v1/projects/{projectId}/units/import — import a unit schedule
 * (YLD01). All or nothing; needs an Idempotency-Key (API03).
 */
export async function POST(request: NextRequest, context: RouteContext<{ projectId: string }>) {
  const { projectId } = await context.params;
  return handleV1(request, ({ body, ifMatch }) => salesApi.importUnits(projectId, body, ifMatch), {
    schema: importUnitsSchema,
    status: 201,
    idempotent: true,
  });
}
