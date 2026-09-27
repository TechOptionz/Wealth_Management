import type { NextRequest } from 'next/server';
import { handleV1 } from '@/server/http/v1';
import type { RouteContext } from '@/server/http/route';
import { draftChangesFromWire, invoicesApi } from '@/modules/invoices/api';
import { draftChangesSchema } from '@/modules/invoices/validation';

/**
 * POST /api/v1/invoices/{invoiceId}/corrections — correct an approved invoice
 * (INV10). A new revision is appended and needs renewed approval; the
 * approved revision stays frozen and an invoice.corrected outbox event is
 * recorded (not sent: there is no accounting connection).
 */
export async function POST(request: NextRequest, context: RouteContext<{ invoiceId: string }>) {
  const { invoiceId } = await context.params;
  return handleV1(
    request,
    ({ body, ifMatch }) => invoicesApi.correct(invoiceId, { ...draftChangesFromWire(body), ...(ifMatch !== undefined ? { expectedRevision: ifMatch } : {}) }),
    { schema: draftChangesSchema, status: 201, idempotent: true },
  );
}
