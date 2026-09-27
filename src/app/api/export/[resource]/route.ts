import type { NextRequest } from 'next/server';
import { jsonError } from '@/server/http/respond';
import type { RouteContext } from '@/server/http/route';
import { withUnitOfWork } from '@/server/db/unit-of-work';
import {
  TABLE_EXPORT_RESOURCES,
  isTableExportResource,
  tableExportsService,
} from '@/modules/dashboard/table-exports';
import { resolveAsOfDate } from '@/shared/config/app-config';
import { ValidationError } from '@/shared/lib/errors';

/**
 * GET /api/export/:resource — a list screen as CSV (FR-09).
 *
 * Returns a file rather than the JSON envelope, so it is handled here instead of
 * through `handle()`. Permissions are resolved in the service.
 */
export async function GET(request: NextRequest, context: RouteContext<{ resource: string }>) {
  try {
    const { resource } = await context.params;
    if (!isTableExportResource(resource)) {
      throw new ValidationError(`Unknown export "${resource}".`, { allowed: TABLE_EXPORT_RESOURCES });
    }

    const asOf = request.nextUrl.searchParams.get('asOf') ?? resolveAsOfDate();
    // The date ends up in the Content-Disposition header, so its shape is checked here.
    if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) {
      throw new ValidationError('asOf must be a date in YYYY-MM-DD form.');
    }
    const result = await withUnitOfWork(() => tableExportsService.exportTable(resource, asOf));

    return new Response(result.body, {
      status: 200,
      headers: {
        'Content-Type': result.contentType,
        'Content-Disposition': `attachment; filename="${result.filename}"`,
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}
