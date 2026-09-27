/**
 * Development Finance — programme (PRG01–PRG04).
 *
 * The programme is a tree of stages, milestones and tasks joined by
 * finish-to-start dependencies with explicit lag. Three rules are structural:
 *
 *  1. **Dates are calendar dates, not instants.** Every date is an `IsoDate`
 *     string; nothing here carries a time zone (PRG02).
 *  2. **Actual is separate from forecast.** `actualDate` is a recorded fact and
 *     never overwrites `plannedDate`; the effective date of a milestone is the
 *     actual when it exists, the plan otherwise (PRG02, PRG03).
 *  3. **Edits are journaled.** `history` records every field change with the
 *     actor and the reason given, so a moved date can always be explained.
 */
import type { IsoDate, IsoDateTime, MilestoneId, ProjectId, TaskDependencyId, UserId } from '@/shared/types/common';

export type MilestoneKind = 'stage' | 'milestone' | 'task';

export const MILESTONE_KINDS: readonly MilestoneKind[] = ['stage', 'milestone', 'task'];

export const MILESTONE_KIND_LABELS: Record<MilestoneKind, string> = {
  stage: 'Stage',
  milestone: 'Milestone',
  task: 'Task',
};

export interface MilestoneHistoryEntry {
  readonly at: IsoDateTime;
  readonly actor: UserId;
  readonly field: string;
  readonly before: unknown;
  readonly after: unknown;
  readonly reason?: string;
}

export interface Milestone {
  readonly id: MilestoneId;
  readonly projectId: ProjectId;
  /** Unique within the project. */
  readonly code: string;
  readonly name: string;
  readonly kind: MilestoneKind;
  /** The stage this item sits under. Stages have no parent. */
  readonly parentId?: MilestoneId;
  /** Stages and tasks span a window; a milestone is a point in time. */
  readonly plannedStart?: IsoDate;
  /** Planned finish for stages and tasks; the planned date for a milestone. */
  readonly plannedDate: IsoDate;
  /** A recorded fact. Never derived and never overwritten by a plan change. */
  readonly actualDate?: IsoDate;
  readonly durationDays?: number;
  readonly ownerUserId?: UserId;
  /** 0–100. Recording an actual sets it to 100. */
  readonly completionPercent: number;
  readonly sortOrder: number;
  readonly history: readonly MilestoneHistoryEntry[];
}

/** Finish-to-start: the successor may not be planned before predecessor + lag (PRG02). */
export interface TaskDependency {
  readonly id: TaskDependencyId;
  readonly projectId: ProjectId;
  readonly predecessorId: MilestoneId;
  readonly successorId: MilestoneId;
  readonly type: 'FS';
  readonly lagDays: number;
}

export interface MilestoneMove {
  readonly milestoneId: MilestoneId;
  readonly name: string;
  readonly from: IsoDate;
  readonly to: IsoDate;
}

export type MoveBlockReason = 'actual-recorded' | 'locked-period';

export const MOVE_BLOCK_LABELS: Record<MoveBlockReason, string> = {
  'actual-recorded': 'An actual date is recorded; the plan no longer moves it',
  'locked-period': 'The target date falls in a locked period',
};

export interface BlockedMove {
  readonly milestoneId: MilestoneId;
  readonly name: string;
  readonly reason: MoveBlockReason;
}

/** What a date move would do, before anything is saved (PRG03). */
export interface MovePreview {
  readonly moves: readonly MilestoneMove[];
  readonly blocked: readonly BlockedMove[];
}

/** The effective date of a milestone: the recorded actual when it exists, the plan otherwise. */
export function effectiveDateOf(milestone: Pick<Milestone, 'actualDate' | 'plannedDate'>): IsoDate {
  return milestone.actualDate ?? milestone.plannedDate;
}
