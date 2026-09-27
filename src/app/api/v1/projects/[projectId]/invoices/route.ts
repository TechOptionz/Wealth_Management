import type { NextRequest } from 'next/server';
import { handleV1, parseV1Query } from '@/server/http/v1';
import type { RouteContext } from '@/server/http/route';
import { invoicesApi } from '@/modules/invoices/api';
import { invoiceListQuerySchema } from '@/modules/invoices/validation';

/**
 * GET /api/v1/projects/{projectId}/invoices?reviewState=awaiting-approval —
 * the register with review, settlement and duplicate status (INV05, section 6.3).
 */
export async function GET(request: NextRequest, context: RouteContext<{ projectId: string }>) {
  const { projectId } = await context.params;
  return handleV1(request, () => invoicesApi.list(projectId, parseV1Query(request, invoiceListQuerySchema)));
}
