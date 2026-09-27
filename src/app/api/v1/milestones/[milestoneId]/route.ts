import type { NextRequest } from 'next/server';
import { handleV1 } from '@/server/http/v1';
import type { RouteContext } from '@/server/http/route';
import { programmeApi } from '@/modules/programme/api';
import { patchMilestoneSchema } from '@/modules/programme/validation';

/**
 * PATCH /api/v1/milestones/{milestoneId} — edit a programme item (PRG01–PRG03).
 * A changed `plannedDate` needs a `reason` and cascades as one revision;
 * `If-Match` carries the model revision the client edited against (API02).
 */
export async function PATCH(request: NextRequest, context: RouteContext<{ milestoneId: string }>) {
  const { milestoneId } = await context.params;
  return handleV1(request, ({ body, ifMatch }) => programmeApi.patch(milestoneId, body, ifMatch), { schema: patchMilestoneSchema });
}
