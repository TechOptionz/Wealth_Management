import type { NextRequest } from 'next/server';
import { handleV1 } from '@/server/http/v1';
import type { RouteContext } from '@/server/http/route';
import { scenariosApi } from '@/modules/scenarios/api';
import { publishScenarioSchema } from '@/modules/scenarios/validation';

/** POST /api/v1/scenarios/{id}/publish — promote forecast assumptions; a stale base is 409 (SCN05). */
export async function POST(request: NextRequest, context: RouteContext<{ scenarioId: string }>) {
  const { scenarioId } = await context.params;
  return handleV1(request, ({ body }) => scenariosApi.publish(scenarioId, body.reason), { schema: publishScenarioSchema, idempotent: true });
}
