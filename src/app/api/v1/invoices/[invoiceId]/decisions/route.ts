import type { NextRequest } from 'next/server';
import { handleV1 } from '@/server/http/v1';
import type { RouteContext } from '@/server/http/route';
import { invoicesApi } from '@/modules/invoices/api';
import { decisionSchema } from '@/modules/invoices/validation';

/**
 * POST /api/v1/invoices/{invoiceId}/decisions — approve, hold or reject the
 * named invoiceRevision (INV09 to INV11). Idempotent twice over: the
 * Idempotency-Key replays the stored response, and the same actor repeating
 * the same decision gets the existing decision back. The response is
 * { reviewState, approvalEventId, newModelRevision, syncState }: approval is
 * local, never synced, and never reports the invoice as paid.
 */
export async function POST(request: NextRequest, context: RouteContext<{ invoiceId: string }>) {
  const { invoiceId } = await context.params;
  return handleV1(
    request,
    ({ body }) =>
      invoicesApi.decide(invoiceId, {
        decision: body.decision,
        invoiceRevision: body.invoiceRevision,
        ...(body.reason ? { reason: body.reason } : {}),
        ...(body.scheduledPaymentDate ? { scheduledPaymentDate: body.scheduledPaymentDate } : {}),
      }),
    { schema: decisionSchema, idempotent: true },
  );
}
