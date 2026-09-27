import type { NextRequest } from 'next/server';
import { handleV1, decimalStringToCents } from '@/server/http/v1';
import type { RouteContext } from '@/server/http/route';
import { money } from '@/shared/lib/money';
import { invoicesApi } from '@/modules/invoices/api';
import { matchItemSchema } from '@/modules/invoices/validation';

/**
 * POST /api/v1/reconciliation-items/{itemId}/match — match all or part (a
 * split) of an open item to an invoice (INV15). A payment item becomes a cash
 * settlement and leaves suspense in the same transaction.
 */
export async function POST(request: NextRequest, context: RouteContext<{ itemId: string }>) {
  const { itemId } = await context.params;
  return handleV1(request, ({ body }) => invoicesApi.matchItem(itemId, body.invoiceId, money(decimalStringToCents(body.amount))), {
    schema: matchItemSchema,
    idempotent: true,
  });
}
