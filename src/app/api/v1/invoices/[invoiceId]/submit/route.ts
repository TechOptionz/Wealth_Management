import type { NextRequest } from 'next/server';
import { handleV1 } from '@/server/http/v1';
import type { RouteContext } from '@/server/http/route';
import { invoicesApi } from '@/modules/invoices/api';
import { submitSchema } from '@/modules/invoices/validation';

/**
 * POST /api/v1/invoices/{invoiceId}/submit — validate and submit for approval
 * (INV08). Unresolved duplicate findings refuse it with 409 (INV04).
 */
export async function POST(request: NextRequest, context: RouteContext<{ invoiceId: string }>) {
  const { invoiceId } = await context.params;
  return handleV1(request, ({ body }) => invoicesApi.submit(invoiceId, body.acknowledgeWarnings), { schema: submitSchema });
}
