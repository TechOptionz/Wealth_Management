import type { NextRequest } from 'next/server';
import { handleV1 } from '@/server/http/v1';
import type { RouteContext } from '@/server/http/route';
import { reportsApi } from '@/modules/reports/api';

/** POST /api/v1/reports/{id}/link — issue an expiring, person-bound download link (RPT03). */
export async function POST(request: NextRequest, context: RouteContext<{ reportId: string }>) {
  const { reportId } = await context.params;
  return handleV1(request, () => reportsApi.downloadLink(reportId));
}
