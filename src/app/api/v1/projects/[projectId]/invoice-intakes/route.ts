import type { NextRequest } from 'next/server';
import { handleV1 } from '@/server/http/v1';
import type { RouteContext } from '@/server/http/route';
import { invoicesApi } from '@/modules/invoices/api';
import { invoiceIntakeSchema } from '@/modules/invoices/validation';

/**
 * POST /api/v1/projects/{projectId}/invoice-intakes — receive a PDF, PNG or
 * JPEG (INV01). contentBase64, when sent, is checked by magic bytes and
 * hashed, then discarded: files are not stored in this build. An optional
 * invoice body creates the invoice from a clean intake; a failed intake stays
 * visible and creates none.
 */
export async function POST(request: NextRequest, context: RouteContext<{ projectId: string }>) {
  const { projectId } = await context.params;
  return handleV1(
    request,
    ({ body }) => {
      const intake = invoicesApi.createIntake(projectId, {
        filename: body.filename,
        mimeType: body.mimeType,
        sizeBytes: body.sizeBytes,
        ...(body.contentBase64 ? { contentBase64: body.contentBase64 } : {}),
      });
      const invoice = body.invoice && intake.scanState !== 'failed' ? invoicesApi.createInvoice(projectId, body.invoice, intake.id) : null;
      return { intake, invoice };
    },
    { schema: invoiceIntakeSchema, status: 201, idempotent: true },
  );
}
