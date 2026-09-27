import type { NextRequest } from 'next/server';
import { handleV1 } from '@/server/http/v1';
import type { RouteContext } from '@/server/http/route';
import { draftChangesFromWire, invoicesApi } from '@/modules/invoices/api';
import { draftChangesSchema } from '@/modules/invoices/validation';

/**
 * PATCH /api/v1/invoices/{invoiceId}/draft — edit the invoice (INV07, INV10).
 * A change to any revision field appends a new revision; If-Match carries
 * the model revision edited against.
 */
export async function PATCH(request: NextRequest, context: RouteContext<{ invoiceId: string }>) {
  const { invoiceId } = await context.params;
  return handleV1(
    request,
    ({ body, ifMatch }) => invoicesApi.updateDraft(invoiceId, { ...draftChangesFromWire(body), ...(ifMatch !== undefined ? { expectedRevision: ifMatch } : {}) }),
    { schema: draftChangesSchema },
  );
}
