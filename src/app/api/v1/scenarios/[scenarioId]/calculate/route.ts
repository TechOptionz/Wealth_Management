import type { NextRequest } from 'next/server';
import { handleV1 } from '@/server/http/v1';
import type { RouteContext } from '@/server/http/route';
import { scenariosApi } from '@/modules/scenarios/api';

/** POST /api/v1/scenarios/{id}/calculate — a versioned run on the pinned base (SCN01, CAL05). */
export async function POST(request: NextRequest, context: RouteContext<{ scenarioId: string }>) {
  const { scenarioId } = await context.params;
  return handleV1(request, () => {
    const run = scenariosApi.calculate(scenarioId);
    return { runId: run.id, inputHash: run.inputHash, modelRevision: run.modelRevision, status: run.status, kpis: run.result.economic.kpis, warnings: run.warnings };
  });
}
