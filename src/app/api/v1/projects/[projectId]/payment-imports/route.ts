import type { NextRequest } from 'next/server';
import { handleV1 } from '@/server/http/v1';
import type { RouteContext } from '@/server/http/route';
import { invoicesApi } from '@/modules/invoices/api';
import { paymentImportSchema } from '@/modules/invoices/validation';

/**
 * POST /api/v1/projects/{projectId}/payment-imports — INT07 in two steps.
 * { csvText, filename? } runs a dry run (totals, dates, currency, duplicates
 * by sourceId) and creates nothing; { confirmImportId } confirms it. A
 * repeated confirmation returns the same result and creates nothing more.
 */
export async function POST(request: NextRequest, context: RouteContext<{ projectId: string }>) {
  const { projectId } = await context.params;
  return handleV1(request, ({ body }) => invoicesApi.paymentImport(projectId, body), { schema: paymentImportSchema, idempotent: true });
}
