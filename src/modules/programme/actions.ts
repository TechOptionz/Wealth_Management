'use server';

import { revalidatePath } from 'next/cache';
import type { ActionResult } from '@/shared/lib/action-result';
import { runAction } from '@/server/actions/run-action';
import { readChoice, readString, requireString } from '@/shared/lib/form-data';
import { ValidationError } from '@/shared/lib/errors';
import { asId } from '@/shared/types/common';
import { programmeApi } from './api';
import { MILESTONE_KINDS, type MovePreview } from './model';
import type { ApplyMoveResult, MilestoneChanges } from './service';

function revalidateProgramme(projectId: string): void {
  revalidatePath(`/projects/${projectId}/programme`);
  revalidatePath(`/projects/${projectId}`, 'layout');
}

function readRevision(form: FormData): number | undefined {
  const raw = readString(form, 'revision');
  if (raw === undefined) return undefined;
  const parsed = Number(raw);
  return Number.isInteger(parsed) ? parsed : undefined;
}

function readInteger(form: FormData, key: string, label: string): number | undefined {
  const raw = readString(form, key);
  if (raw === undefined) return undefined;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed)) throw new ValidationError(`${label} must be a whole number.`, { fieldErrors: { [key]: ['Enter a whole number.'] } });
  return parsed;
}

/** PRG01 — add a stage, milestone or task. */
export async function createMilestoneAction(_previous: ActionResult<unknown>, form: FormData): Promise<ActionResult<unknown>> {
  return runAction('Programme item added', () => {
    const projectId = requireString(form, 'projectId', 'Project');
    const kind = readChoice(form, 'kind', MILESTONE_KINDS) ?? 'milestone';
    const created = programmeApi.create(
      projectId,
      {
        code: requireString(form, 'code', 'Code'),
        name: requireString(form, 'name', 'Name'),
        kind,
        ...(readString(form, 'parentId') ? { parentId: readString(form, 'parentId') } : {}),
        ...(readString(form, 'plannedStart') ? { plannedStart: readString(form, 'plannedStart') } : {}),
        plannedDate: requireString(form, 'plannedDate', kind === 'milestone' ? 'Planned date' : 'Planned finish'),
        ...(readInteger(form, 'durationDays', 'Duration') !== undefined ? { durationDays: readInteger(form, 'durationDays', 'Duration') } : {}),
        ...(readString(form, 'ownerUserId') ? { ownerUserId: readString(form, 'ownerUserId') } : {}),
      },
      readRevision(form),
    );
    revalidateProgramme(projectId);
    return created;
  });
}

/** PRG01 — descriptive edits; the planned date moves through `applyMoveAction`. */
export async function updateMilestoneAction(_previous: ActionResult<unknown>, form: FormData): Promise<ActionResult<unknown>> {
  return runAction('Programme item saved', () => {
    const projectId = requireString(form, 'projectId', 'Project');
    const milestoneId = requireString(form, 'milestoneId', 'Milestone');
    const owner = form.get('ownerUserId');
    const completion = readInteger(form, 'completionPercent', 'Completion');
    const changes: MilestoneChanges = {
      ...(readString(form, 'name') ? { name: readString(form, 'name') } : {}),
      ...(readString(form, 'code') ? { code: readString(form, 'code') } : {}),
      ...(readString(form, 'plannedStart') ? { plannedStart: readString(form, 'plannedStart') } : {}),
      ...(typeof owner === 'string' ? { ownerUserId: owner.trim() ? asId<'User'>(owner.trim()) : undefined } : {}),
      ...(completion !== undefined ? { completionPercent: completion } : {}),
    };
    const updated = programmeApi.update(milestoneId, changes, readString(form, 'reason'));
    revalidateProgramme(projectId);
    return updated;
  });
}

export type MoveActionValue =
  | ({ readonly mode: 'preview'; readonly newPlannedDate: string } & MovePreview)
  | ({ readonly mode: 'applied' } & ApplyMoveResult);

/**
 * PRG03 — move a planned date. With `preview=1` the action returns the
 * cascade and writes nothing; a second submit with `preview=0` and a reason
 * applies every move as one model revision.
 */
export async function applyMoveAction(_previous: ActionResult<unknown>, form: FormData): Promise<ActionResult<unknown>> {
  const preview = readString(form, 'preview') !== '0';
  return runAction(
    (value: MoveActionValue) =>
      value.mode === 'preview'
        ? `Preview: ${value.moves.length} item(s) would move, ${value.blocked.length} blocked`
        : `Moved ${value.batchMoves.length} item(s) · revision ${value.revision}`,
    (): MoveActionValue => {
      const projectId = requireString(form, 'projectId', 'Project');
      const milestoneId = requireString(form, 'milestoneId', 'Milestone');
      const newPlannedDate = requireString(form, 'newPlannedDate', 'New date');
      if (preview) {
        return { mode: 'preview', newPlannedDate, ...programmeApi.previewMove(milestoneId, newPlannedDate) };
      }
      const result = programmeApi.applyMove(milestoneId, newPlannedDate, requireString(form, 'reason', 'Reason'), readRevision(form));
      revalidateProgramme(projectId);
      return { mode: 'applied', ...result };
    },
  );
}

/** PRG02 — record the date something actually happened. */
export async function recordActualAction(_previous: ActionResult<unknown>, form: FormData): Promise<ActionResult<unknown>> {
  return runAction('Actual date recorded', () => {
    const projectId = requireString(form, 'projectId', 'Project');
    const updated = programmeApi.recordActual(requireString(form, 'milestoneId', 'Milestone'), requireString(form, 'actualDate', 'Actual date'));
    revalidateProgramme(projectId);
    return updated;
  });
}

/** PRG02 — finish-to-start link with explicit lag. */
export async function addDependencyAction(_previous: ActionResult<unknown>, form: FormData): Promise<ActionResult<unknown>> {
  return runAction('Dependency added', () => {
    const projectId = requireString(form, 'projectId', 'Project');
    const created = programmeApi.addDependency(projectId, {
      predecessorId: requireString(form, 'predecessorId', 'Predecessor'),
      successorId: requireString(form, 'successorId', 'Successor'),
      lagDays: readInteger(form, 'lagDays', 'Lag') ?? 0,
    });
    revalidateProgramme(projectId);
    return created;
  });
}

export async function removeDependencyAction(_previous: ActionResult<unknown>, form: FormData): Promise<ActionResult<unknown>> {
  return runAction('Dependency removed', () => {
    const projectId = requireString(form, 'projectId', 'Project');
    programmeApi.removeDependency(projectId, requireString(form, 'dependencyId', 'Dependency'));
    revalidateProgramme(projectId);
    return null;
  });
}
