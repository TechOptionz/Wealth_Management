import type { NextRequest } from 'next/server';
import { jsonError } from '@/server/http/respond';
import { withUnitOfWork } from '@/server/db/unit-of-work';
import { reportsApi } from '@/modules/reports/api';

interface Context {
  readonly params: Promise<{ readonly reportId: string }>;
}

/**
 * GET /api/v1/reports/{id}/download?expires=…&signature=… — an expiring,
 * person-bound link (RPT03). Access is rechecked now, not when the link was
 * issued, so a revoked member cannot use an old link (IAM03).
 */
export async function GET(request: NextRequest, context: Context) {
  try {
    const { reportId } = await context.params;
    const expires = Number(request.nextUrl.searchParams.get('expires'));
    const signature = request.nextUrl.searchParams.get('signature') ?? '';
    const file = await withUnitOfWork(() => reportsApi.download(reportId, expires, signature));
    return new Response(file.body, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${file.filename}"`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}
