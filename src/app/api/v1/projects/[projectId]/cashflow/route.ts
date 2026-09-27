import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { centsToDecimalString, handleV1, parseV1Query } from '@/server/http/v1';
import type { RouteContext } from '@/server/http/route';
import { projectModelApi } from '@/modules/project-model/api';

const querySchema = z.object({
  basis: z.enum(['economic', 'gross']).optional(),
  from: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}$/).optional(),
});

const money = (cents: number) => ({ amount: centsToDecimalString(cents), currency: 'AUD' });

/**
 * GET /api/v1/projects/{id}/cashflow — the grid from the current calculation
 * run (CF01, CAL05). Amounts are decimal strings; `from`/`to` narrow the months.
 */
export async function GET(request: NextRequest, context: RouteContext<{ projectId: string }>) {
  const { projectId } = await context.params;
  return handleV1(request, () => {
    const query = parseV1Query(request, querySchema);
    const payload = projectModelApi.cashflow(projectId, { basis: query.basis });
    const months = payload.run.result.months.filter((m) => (!query.from || m >= query.from) && (!query.to || m <= query.to));
    return {
      runId: payload.run.id,
      modelRevision: payload.run.modelRevision,
      engineVersion: payload.run.engineVersion,
      actualsCutoff: payload.run.actualsCutoff,
      basis: payload.basis,
      stale: payload.stale,
      months,
      rows: payload.view.rows.map((row) => ({
        id: row.id,
        section: row.section,
        kind: row.kind,
        label: row.label,
        code: row.code ?? null,
        posting: row.posting,
        current: money(row.summary.current),
        expended: money(row.summary.expended),
        months: Object.fromEntries(months.map((m) => [m, money(row.months[m] ?? 0)])),
      })),
      warnings: payload.run.warnings.map((w) => w.message),
    };
  });
}
