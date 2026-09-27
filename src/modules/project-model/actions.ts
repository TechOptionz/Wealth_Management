'use server';

import type { ActionResult } from '@/shared/lib/action-result';
import { runAction } from '@/server/actions/run-action';
import { projectModelApi } from './api';
import type { MilestoneMovePreview } from './service';

/**
 * PRG03 — the financial effect of moving a milestone, before it is saved.
 * Read-only: computes the model twice (as is, and with the moved dates) and
 * returns the difference. Nothing is stored.
 */
export async function previewMilestoneFinancialsAction(
  projectId: string,
  milestoneId: string,
  newPlannedDate: string,
): Promise<ActionResult<MilestoneMovePreview>> {
  return runAction('Financial effect calculated', () => projectModelApi.previewMilestoneMove(projectId, milestoneId, newPlannedDate));
}
