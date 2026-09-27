import type { NextRequest } from 'next/server';
import { handle, parseQuery } from '@/server/http/route';
import { dashboardApi } from '@/modules/dashboard/api';
import { scenarioQuerySchema } from '@/modules/dashboard/validation';

/**
 * GET /api/dashboard/scenario?rateDeltaPercent=0.5&vacantPropertyIds=a,b
 * — a what-if on monthly cash flow (FR-11). Read-only; nothing is stored.
 */
export function GET(request: NextRequest) {
  return handle(() => {
    const query = parseQuery(request, scenarioQuerySchema);
    return dashboardApi.simulateScenario(query);
  });
}
