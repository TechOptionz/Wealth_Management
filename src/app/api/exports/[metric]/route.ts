import type { NextRequest } from 'next/server';
import { jsonError } from '@/server/http/respond';
import type { RouteContext } from '@/server/http/route';
import { withUnitOfWork } from '@/server/db/unit-of-work';
import { exportsService } from '@/modules/dashboard/exports';
import { METRIC_LABELS, type ExplainableMetric } from '@/modules/dashboard/explain';
import { resolveAsOfDate } from '@/shared/config/app-config';
import { ValidationError } from '@/shared/lib/errors';

/**
 * GET /api/exports/:metric — CSV of the records behind a total (FR-09).
 *
 * Returns a file rather than the JSON envelope, so it is handled here instead of
 * through `handle()`. Permissions are still resolved in the service, which is
 * what keeps an export and its screen on identical rules.
 */
export async function GET(request: NextRequest, context: RouteContext<{ metric: string }>) {
  try {
    const { metric } = await context.params;
    if (!(metric in METRIC_LABELS)) {
      throw new ValidationError(`Unknown metric "${metric}".`, {
        allowed: Object.keys(METRIC_LABELS),
      });
    }

    const asOf = request.nextUrl.searchParams.get('asOf') ?? resolveAsOfDate();
    const result = await withUnitOfWork(() =>
      exportsService.exportExplanation(metric as ExplainableMetric, asOf),
    );

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
