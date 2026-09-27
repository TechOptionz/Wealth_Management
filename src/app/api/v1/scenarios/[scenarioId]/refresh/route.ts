import type { NextRequest } from 'next/server';
import { handleV1 } from '@/server/http/v1';
import type { RouteContext } from '@/server/http/route';
import { scenariosApi } from '@/modules/scenarios/api';

/** POST /api/v1/scenarios/{id}/refresh — pull in new actuals as a new version (SCN04). */
export async function POST(request: NextRequest, context: RouteContext<{ scenarioId: string }>) {
  const { scenarioId } = await context.params;
  return handleV1(request, () => scenariosApi.refresh(scenarioId), { idempotent: true });
}
