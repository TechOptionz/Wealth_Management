/**
 * Programme business logic (PRG01–PRG04).
 *
 * The rule this file exists to make structural: a milestone move is *one*
 * financial mutation. `previewMove` computes the whole finish-to-start cascade
 * without writing anything; `applyMove` writes every moved date and bumps the
 * model revision exactly once, so a cascade can never half-save (PRG03, CF07).
 *
 * Milestones with a recorded actual never move — the actual is a fact, the
 * plan is not — and a date landing in a locked period is refused. Both are
 * reported as `blocked` so the person resolves them explicitly rather than
 * the system quietly skipping them.
 */
import { randomUUID } from 'node:crypto';
import { ConflictError, NotFoundError, ValidationError } from '@/shared/lib/errors';
import { addDays, daysBetween } from '@/shared/lib/dates';
import { asId, type IsoDate, type MilestoneId, type ProjectId, type TaskDependencyId, type UserId } from '@/shared/types/common';
import { accessService } from '@/modules/access/service';
import { projectsService } from '@/modules/projects/service';
import { programmeRepository } from './repository';
import {
  MILESTONE_KINDS,
  effectiveDateOf,
  type BlockedMove,
  type Milestone,
  type MilestoneHistoryEntry,
  type MilestoneKind,
  type MilestoneMove,
  type MovePreview,
  type TaskDependency,
} from './model';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface CreateMilestoneInput {
  readonly projectId: ProjectId;
  readonly code: string;
  readonly name: string;
  readonly kind: MilestoneKind;
  readonly parentId?: MilestoneId;
  readonly plannedStart?: IsoDate;
  readonly plannedDate: IsoDate;
  readonly durationDays?: number;
  readonly ownerUserId?: UserId;
  readonly actor: UserId;
  readonly expectedRevision?: number;
}

/** Fields an edit may change. The planned date moves through `applyMove`, so the cascade cannot be bypassed. */
export type MilestoneChanges = Partial<
  Pick<Milestone, 'code' | 'name' | 'parentId' | 'plannedStart' | 'durationDays' | 'ownerUserId' | 'completionPercent'>
>;

export interface ApplyMoveInput {
  readonly milestoneId: MilestoneId;
  readonly newPlannedDate: IsoDate;
  readonly actor: UserId;
  readonly reason: string;
  readonly expectedRevision?: number;
}

export interface ApplyMoveResult {
  readonly batchMoves: readonly MilestoneMove[];
  readonly blocked: readonly BlockedMove[];
  readonly revision: number;
}

export interface CloneOptions {
  readonly structure: boolean;
  readonly assumptions: boolean;
}

/** The standard stage template used by `seedStagesFor`: share of the project window each stage occupies. */
const STAGE_TEMPLATE: readonly { code: string; name: string; startShare: number; endShare: number }[] = [
  { code: 'ACQ', name: 'Acquisition', startShare: 0, endShare: 0.15 },
  { code: 'DES', name: 'Design', startShare: 0.02, endShare: 0.3 },
  { code: 'APP', name: 'Approvals', startShare: 0.12, endShare: 0.3 },
  { code: 'PRE', name: 'Presales', startShare: 0.08, endShare: 0.38 },
  { code: 'CON', name: 'Construction', startShare: 0.3, endShare: 0.88 },
  { code: 'CMP', name: 'Completion', startShare: 0.88, endShare: 0.92 },
  { code: 'SET', name: 'Settlement', startShare: 0.92, endShare: 1 },
];

function now(): string {
  return new Date().toISOString();
}

function actorName(userId: UserId): string {
  return accessService.resolveUserName(userId) ?? 'system';
}

function assertIsoDate(value: string | undefined, label: string, field: string): void {
  if (value !== undefined && !ISO_DATE.test(value)) {
    throw new ValidationError(`Enter ${label} as YYYY-MM-DD.`, { fieldErrors: { [field]: ['Use the format YYYY-MM-DD.'] } });
  }
}

function historyEntry(actor: UserId, field: string, before: unknown, after: unknown, reason?: string): MilestoneHistoryEntry {
  return { at: now(), actor, field, before, after, ...(reason ? { reason } : {}) };
}

/** Whether adding `predecessorId → successorId` would let a walk return to its start (PRG02). */
function wouldCycle(edges: readonly TaskDependency[], predecessorId: MilestoneId, successorId: MilestoneId): boolean {
  const successorsOf = new Map<MilestoneId, MilestoneId[]>();
  for (const edge of edges) {
    const list = successorsOf.get(edge.predecessorId) ?? [];
    list.push(edge.successorId);
    successorsOf.set(edge.predecessorId, list);
  }
  // A cycle exists if the predecessor is reachable from the successor.
  const seen = new Set<MilestoneId>();
  const stack: MilestoneId[] = [successorId];
  while (stack.length > 0) {
    const current = stack.pop() as MilestoneId;
    if (current === predecessorId) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    for (const next of successorsOf.get(current) ?? []) stack.push(next);
  }
  return false;
}

export const programmeService = {
  /** Every stage, milestone and task of a project in display order. */
  listMilestones(projectId: ProjectId): readonly Milestone[] {
    return programmeRepository.listMilestones(projectId);
  },

  requireMilestone(id: MilestoneId): Milestone {
    const milestone = programmeRepository.findMilestone(id);
    if (!milestone) throw new NotFoundError('Milestone', id);
    return milestone;
  },

  /** The date other modules should link to: the actual when recorded, the plan otherwise. */
  effectiveDate(milestone: Pick<Milestone, 'actualDate' | 'plannedDate'>): IsoDate {
    return effectiveDateOf(milestone);
  },

  dateOf(milestoneId: MilestoneId): IsoDate {
    return effectiveDateOf(programmeService.requireMilestone(milestoneId));
  },

  /**
   * A resolver over one project's milestones, read once. Consumers that date
   * many cost lines or sales events by milestone call this instead of
   * `dateOf` per line (PRG04).
   */
  dateResolver(projectId: ProjectId): (id: MilestoneId) => IsoDate {
    const byId = new Map(programmeRepository.listMilestones(projectId).map((row) => [row.id, effectiveDateOf(row)] as const));
    return (id: MilestoneId): IsoDate => {
      const date = byId.get(id);
      if (!date) throw new NotFoundError('Milestone', id);
      return date;
    };
  },

  createMilestone(input: CreateMilestoneInput): Milestone {
    projectsService.assertMutable(input.projectId);
    const code = input.code.trim().toUpperCase();
    if (!/^[A-Z0-9][A-Z0-9-]{0,19}$/.test(code)) {
      throw new ValidationError('Enter a code of 1–20 letters, digits or hyphens.', {
        fieldErrors: { code: ['Use letters, digits and hyphens only, e.g. CON-06.'] },
      });
    }
    if (programmeRepository.findMilestoneByCode(input.projectId, code)) {
      throw new ValidationError(`Code ${code} is already used in this programme.`, {
        fieldErrors: { code: ['Each code must be unique within the project.'] },
      });
    }
    if (!input.name.trim()) throw new ValidationError('Enter a name.', { fieldErrors: { name: ['A milestone needs a name.'] } });
    if (!MILESTONE_KINDS.includes(input.kind)) throw new ValidationError(`"${input.kind}" is not a programme item kind.`);
    assertIsoDate(input.plannedDate, 'the planned date', 'plannedDate');
    assertIsoDate(input.plannedStart, 'the planned start', 'plannedStart');
    if (input.plannedStart && input.plannedStart > input.plannedDate) {
      throw new ValidationError('The planned start must be on or before the planned finish.', {
        fieldErrors: { plannedStart: ['Choose a start on or before the finish.'] },
      });
    }
    if (input.kind !== 'milestone' && !input.plannedStart) {
      throw new ValidationError('A stage or task needs a planned start.', { fieldErrors: { plannedStart: ['Enter the planned start.'] } });
    }
    if (input.durationDays !== undefined && (!Number.isInteger(input.durationDays) || input.durationDays < 0)) {
      throw new ValidationError('Duration must be a whole number of days.', { fieldErrors: { durationDays: ['Enter zero or more days.'] } });
    }
    if (input.parentId) {
      const parent = programmeService.requireMilestone(input.parentId);
      if (parent.projectId !== input.projectId) throw new NotFoundError('Milestone', input.parentId);
      if (parent.kind !== 'stage') {
        throw new ValidationError('Only a stage can hold milestones and tasks.', { fieldErrors: { parentId: ['Choose a stage.'] } });
      }
    }
    if (input.ownerUserId) accessService.requireUser(input.ownerUserId);

    const siblings = programmeRepository.listMilestones(input.projectId);
    const parent = input.parentId ? siblings.find((row) => row.id === input.parentId) : undefined;
    // New items sit at the end of their stage; new stages sit at the end of the programme.
    const sortOrder = parent
      ? Math.max(parent.sortOrder, ...siblings.filter((row) => row.parentId === parent.id).map((row) => row.sortOrder)) + 1
      : Math.max(0, ...siblings.map((row) => row.sortOrder)) + 10;

    const created = programmeRepository.insertMilestone({
      id: asId<'Milestone'>(`ms-${randomUUID()}`),
      projectId: input.projectId,
      code,
      name: input.name.trim(),
      kind: input.kind,
      ...(input.parentId ? { parentId: input.parentId } : {}),
      ...(input.plannedStart ? { plannedStart: input.plannedStart } : {}),
      plannedDate: input.plannedDate,
      ...(input.durationDays !== undefined
        ? { durationDays: input.durationDays }
        : input.plannedStart
          ? { durationDays: daysBetween(input.plannedStart, input.plannedDate) }
          : {}),
      ...(input.ownerUserId ? { ownerUserId: input.ownerUserId } : {}),
      completionPercent: 0,
      sortOrder,
      history: [historyEntry(input.actor, 'created', null, input.plannedDate)],
    });
    projectsService.bumpRevision(input.projectId, input.expectedRevision);
    accessService.record({
      actor: actorName(input.actor),
      summary: `Programme item created · ${created.code} ${created.name}`,
      context: `${projectsService.require(input.projectId).code} · ${created.kind} · planned ${created.plannedDate}`,
    });
    return created;
  },

  /** Edit descriptive fields. Dates move through `applyMove`; actuals through `recordActual`. */
  updateMilestone(id: MilestoneId, changes: MilestoneChanges, actor: UserId, reason?: string): Milestone {
    const current = programmeService.requireMilestone(id);
    projectsService.assertMutable(current.projectId);
    if (changes.code !== undefined) {
      const code = changes.code.trim().toUpperCase();
      const clash = programmeRepository.findMilestoneByCode(current.projectId, code);
      if (clash && clash.id !== id) {
        throw new ValidationError(`Code ${code} is already used in this programme.`, { fieldErrors: { code: ['Each code must be unique.'] } });
      }
      changes = { ...changes, code };
    }
    if (changes.name !== undefined && !changes.name.trim()) {
      throw new ValidationError('Enter a name.', { fieldErrors: { name: ['A milestone needs a name.'] } });
    }
    assertIsoDate(changes.plannedStart, 'the planned start', 'plannedStart');
    if (changes.plannedStart && changes.plannedStart > current.plannedDate) {
      throw new ValidationError('The planned start must be on or before the planned finish.', {
        fieldErrors: { plannedStart: ['Choose a start on or before the finish.'] },
      });
    }
    if (changes.completionPercent !== undefined && (changes.completionPercent < 0 || changes.completionPercent > 100)) {
      throw new ValidationError('Completion is a percentage from 0 to 100.', { fieldErrors: { completionPercent: ['Enter 0–100.'] } });
    }
    if (changes.durationDays !== undefined && (!Number.isInteger(changes.durationDays) || changes.durationDays < 0)) {
      throw new ValidationError('Duration must be a whole number of days.', { fieldErrors: { durationDays: ['Enter zero or more days.'] } });
    }
    if (changes.parentId) {
      const parent = programmeService.requireMilestone(changes.parentId);
      if (parent.projectId !== current.projectId || parent.kind !== 'stage' || parent.id === id) {
        throw new ValidationError('Only a stage in this project can be the parent.', { fieldErrors: { parentId: ['Choose a stage.'] } });
      }
    }
    if (changes.ownerUserId) accessService.requireUser(changes.ownerUserId);

    const entries: MilestoneHistoryEntry[] = [];
    for (const [field, after] of Object.entries(changes)) {
      const before = current[field as keyof Milestone];
      if (before !== after) entries.push(historyEntry(actor, field, before ?? null, after ?? null, reason));
    }
    if (entries.length === 0) return current;

    const updated = programmeRepository.updateMilestone(id, {
      ...changes,
      ...(changes.plannedStart ? { durationDays: changes.durationDays ?? daysBetween(changes.plannedStart, current.plannedDate) } : {}),
      history: [...current.history, ...entries],
    });
    if (!updated) throw new NotFoundError('Milestone', id);
    projectsService.bumpRevision(current.projectId);
    accessService.record({
      actor: actorName(actor),
      summary: `Programme item updated · ${updated.code} ${updated.name}`,
      context: `Fields: ${entries.map((entry) => entry.field).join(', ')}${reason ? ` · ${reason}` : ''}`,
    });
    return updated;
  },

  listDependencies(projectId: ProjectId): readonly TaskDependency[] {
    return programmeRepository.listDependencies(projectId);
  },

  /** Add a finish-to-start link. Self-links and anything that would close a loop are refused (PRG02). */
  addDependency(input: {
    readonly projectId: ProjectId;
    readonly predecessorId: MilestoneId;
    readonly successorId: MilestoneId;
    readonly lagDays: number;
    readonly actor: UserId;
  }): TaskDependency {
    projectsService.assertMutable(input.projectId);
    if (input.predecessorId === input.successorId) {
      throw new ValidationError('A milestone cannot depend on itself.', { fieldErrors: { successorId: ['Choose a different milestone.'] } });
    }
    const predecessor = programmeService.requireMilestone(input.predecessorId);
    const successor = programmeService.requireMilestone(input.successorId);
    if (predecessor.projectId !== input.projectId || successor.projectId !== input.projectId) {
      throw new ValidationError('Both milestones must belong to this project.');
    }
    if (!Number.isInteger(input.lagDays)) {
      throw new ValidationError('Lag must be a whole number of days.', { fieldErrors: { lagDays: ['Enter a whole number of days.'] } });
    }
    const existing = programmeRepository.listDependencies(input.projectId);
    if (existing.some((row) => row.predecessorId === input.predecessorId && row.successorId === input.successorId)) {
      throw new ValidationError(`${successor.name} already depends on ${predecessor.name}.`);
    }
    if (wouldCycle(existing, input.predecessorId, input.successorId)) {
      throw new ValidationError(
        `Linking ${predecessor.name} → ${successor.name} would create a loop: ${predecessor.name} already follows ${successor.name}.`,
        { fieldErrors: { successorId: ['This link would create a circular dependency.'] } },
      );
    }
    const created = programmeRepository.insertDependency({
      id: asId<'TaskDependency'>(`dep-${randomUUID()}`),
      projectId: input.projectId,
      predecessorId: input.predecessorId,
      successorId: input.successorId,
      type: 'FS',
      lagDays: input.lagDays,
    });
    projectsService.bumpRevision(input.projectId);
    accessService.record({
      actor: actorName(input.actor),
      summary: `Dependency added · ${predecessor.name} → ${successor.name}`,
      context: `${projectsService.require(input.projectId).code} · finish-to-start · lag ${input.lagDays} days`,
    });
    return created;
  },

  removeDependency(id: TaskDependencyId, actor: UserId): void {
    const row = programmeRepository.findDependency(id);
    if (!row) throw new NotFoundError('Dependency', id);
    projectsService.assertMutable(row.projectId);
    programmeRepository.removeDependency(id);
    projectsService.bumpRevision(row.projectId);
    accessService.record({
      actor: actorName(actor),
      summary: `Dependency removed · ${programmeService.requireMilestone(row.predecessorId).name} → ${programmeService.requireMilestone(row.successorId).name}`,
      context: projectsService.require(row.projectId).code,
    });
  },

  /**
   * The finish-to-start cascade a date move would cause, with nothing written.
   *
   * A successor moves only when its planned date would fall before its
   * predecessor's new date plus lag; an item with an actual never moves and is
   * reported blocked; a target date in a locked period is reported blocked
   * (PRG03, CF06). Blocked items stop their own branch of the cascade.
   */
  previewMove(milestoneId: MilestoneId, newPlannedDate: IsoDate): MovePreview {
    assertIsoDate(newPlannedDate, 'the new date', 'newPlannedDate');
    const root = programmeService.requireMilestone(milestoneId);
    const projectId = root.projectId;
    const milestones = new Map(programmeRepository.listMilestones(projectId).map((row) => [row.id, row] as const));
    const dependencies = programmeRepository.listDependencies(projectId);

    const moves: MilestoneMove[] = [];
    const blocked: BlockedMove[] = [];
    const newDates = new Map<MilestoneId, IsoDate>();

    const tryMove = (item: Milestone, to: IsoDate): boolean => {
      if (item.actualDate) {
        blocked.push({ milestoneId: item.id, name: item.name, reason: 'actual-recorded' });
        return false;
      }
      if (projectsService.isPeriodLocked(projectId, to)) {
        blocked.push({ milestoneId: item.id, name: item.name, reason: 'locked-period' });
        return false;
      }
      moves.push({ milestoneId: item.id, name: item.name, from: item.plannedDate, to });
      newDates.set(item.id, to);
      return true;
    };

    if (root.plannedDate !== newPlannedDate && tryMove(root, newPlannedDate)) {
      const queue: MilestoneId[] = [root.id];
      while (queue.length > 0) {
        const currentId = queue.shift() as MilestoneId;
        const currentDate = newDates.get(currentId) as IsoDate;
        for (const edge of dependencies.filter((row) => row.predecessorId === currentId)) {
          const successor = milestones.get(edge.successorId);
          if (!successor) continue;
          const earliest = addDays(currentDate, edge.lagDays);
          const successorDate = newDates.get(successor.id) ?? successor.plannedDate;
          if (successorDate >= earliest) continue;
          if (blocked.some((row) => row.milestoneId === successor.id)) continue;
          if (newDates.has(successor.id)) {
            // Already moved by another predecessor; push further and re-cascade from it.
            const index = moves.findIndex((row) => row.milestoneId === successor.id);
            const previous = moves[index];
            if (previous) moves[index] = { ...previous, to: earliest };
            newDates.set(successor.id, earliest);
            queue.push(successor.id);
          } else if (tryMove(successor, earliest)) {
            queue.push(successor.id);
          }
        }
      }
    }
    return { moves, blocked };
  },

  /**
   * Save a date move and its whole cascade as one model revision (PRG03).
   *
   * If the item itself cannot move, nothing is saved and the block is the
   * error. Successors that cannot move stay where they are and are returned
   * as `blocked` so the person can resolve them deliberately.
   */
  applyMove(input: ApplyMoveInput): ApplyMoveResult {
    const root = programmeService.requireMilestone(input.milestoneId);
    projectsService.assertMutable(root.projectId);
    if (!input.reason.trim()) {
      throw new ValidationError('Give a reason for the move.', { fieldErrors: { reason: ['A reason is required to move a date.'] } });
    }
    const preview = programmeService.previewMove(input.milestoneId, input.newPlannedDate);
    const rootBlock = preview.blocked.find((row) => row.milestoneId === input.milestoneId);
    if (rootBlock) {
      throw new ConflictError(
        rootBlock.reason === 'actual-recorded'
          ? `${root.name} has an actual date recorded; the plan no longer moves it.`
          : `${input.newPlannedDate} falls in a locked period; reopen the period before planning into it.`,
        { blocked: preview.blocked },
      );
    }
    if (preview.moves.length === 0) {
      return { batchMoves: [], blocked: preview.blocked, revision: projectsService.require(root.projectId).modelRevision };
    }

    // One revision for the whole cascade: the stale check runs before any write.
    const revision = projectsService.bumpRevision(root.projectId, input.expectedRevision);
    for (const move of preview.moves) {
      const item = programmeService.requireMilestone(move.milestoneId);
      const shift = daysBetween(move.from, move.to);
      const entries = [historyEntry(input.actor, 'plannedDate', move.from, move.to, input.reason.trim())];
      // A window keeps its duration: the start shifts with the finish.
      const newStart = item.plannedStart ? addDays(item.plannedStart, shift) : undefined;
      if (item.plannedStart && newStart) entries.push(historyEntry(input.actor, 'plannedStart', item.plannedStart, newStart, input.reason.trim()));
      programmeRepository.updateMilestone(move.milestoneId, {
        plannedDate: move.to,
        ...(newStart ? { plannedStart: newStart } : {}),
        history: [...item.history, ...entries],
      });
    }
    accessService.record({
      actor: actorName(input.actor),
      summary: `Milestone moved · ${root.name} → ${input.newPlannedDate}`,
      context: `${projectsService.require(root.projectId).code} · ${preview.moves.length} item(s) moved · ${preview.blocked.length} blocked · ${input.reason.trim()} · revision ${revision}`,
    });
    return { batchMoves: preview.moves, blocked: preview.blocked, revision };
  },

  /** Record the date something actually happened. Actuals are facts, so a locked period does not refuse them; the audit says so. */
  recordActual(milestoneId: MilestoneId, actualDate: IsoDate, actor: UserId): Milestone {
    const current = programmeService.requireMilestone(milestoneId);
    projectsService.assertMutable(current.projectId);
    assertIsoDate(actualDate, 'the actual date', 'actualDate');
    const locked = projectsService.isPeriodLocked(current.projectId, actualDate);
    const updated = programmeRepository.updateMilestone(milestoneId, {
      actualDate,
      completionPercent: 100,
      history: [...current.history, historyEntry(actor, 'actualDate', current.actualDate ?? null, actualDate)],
    });
    if (!updated) throw new NotFoundError('Milestone', milestoneId);
    projectsService.bumpRevision(current.projectId);
    accessService.record({
      actor: actorName(actor),
      summary: `Actual recorded · ${current.name} · ${actualDate}`,
      context: `${projectsService.require(current.projectId).code} · planned ${current.plannedDate}${locked ? ' · dated inside a locked period' : ''}`,
    });
    return updated;
  },

  /** Create the seven standard stages across a project's window. Refused when the project already has a programme. */
  seedStagesFor(projectId: ProjectId, actor: UserId): readonly Milestone[] {
    const project = projectsService.assertMutable(projectId);
    if (programmeRepository.listMilestones(projectId).length > 0) {
      throw new ConflictError(`${project.code} already has a programme; add stages individually instead.`);
    }
    const span = daysBetween(project.startDate, project.expectedCompletion);
    const created = STAGE_TEMPLATE.map((template, index) =>
      programmeRepository.insertMilestone({
        id: asId<'Milestone'>(`ms-${randomUUID()}`),
        projectId,
        code: template.code,
        name: template.name,
        kind: 'stage',
        plannedStart: addDays(project.startDate, Math.round(span * template.startShare)),
        plannedDate: addDays(project.startDate, Math.round(span * template.endShare)),
        durationDays: Math.round(span * (template.endShare - template.startShare)),
        completionPercent: 0,
        sortOrder: (index + 1) * 10,
        history: [historyEntry(actor, 'created', null, 'standard stages')],
      }),
    );
    projectsService.bumpRevision(projectId);
    accessService.record({
      actor: actorName(actor),
      summary: `Standard stages seeded · ${project.code}`,
      context: `${created.length} stages from ${project.startDate} to ${project.expectedCompletion}`,
    });
    return created;
  },

  /**
   * Copy a programme into another project (PRJ04). `structure` copies stages,
   * milestones, tasks and dependencies; `assumptions` keeps their dates,
   * otherwise every date is re-based to the target's start preserving offsets.
   * Actuals and history are never copied — they belong to the source.
   */
  cloneInto(sourceProjectId: ProjectId, targetProjectId: ProjectId, options: CloneOptions, actor: UserId): readonly Milestone[] {
    if (!options.structure) return [];
    const source = projectsService.require(sourceProjectId);
    const target = projectsService.assertMutable(targetProjectId);
    if (programmeRepository.listMilestones(targetProjectId).length > 0) {
      throw new ConflictError(`${target.code} already has a programme; clear it before cloning into it.`);
    }
    const offset = options.assumptions ? 0 : daysBetween(source.startDate, target.startDate);
    const idMap = new Map<MilestoneId, MilestoneId>();
    const sourceRows = programmeRepository.listMilestones(sourceProjectId);
    for (const row of sourceRows) idMap.set(row.id, asId<'Milestone'>(`ms-${randomUUID()}`));

    const created = sourceRows.map((row) =>
      programmeRepository.insertMilestone({
        id: idMap.get(row.id) as MilestoneId,
        projectId: targetProjectId,
        code: row.code,
        name: row.name,
        kind: row.kind,
        ...(row.parentId && idMap.has(row.parentId) ? { parentId: idMap.get(row.parentId) } : {}),
        ...(row.plannedStart ? { plannedStart: addDays(row.plannedStart, offset) } : {}),
        plannedDate: addDays(row.plannedDate, offset),
        ...(row.durationDays !== undefined ? { durationDays: row.durationDays } : {}),
        ...(row.ownerUserId ? { ownerUserId: row.ownerUserId } : {}),
        completionPercent: 0,
        sortOrder: row.sortOrder,
        history: [historyEntry(actor, 'cloned', source.code, options.assumptions ? 'dates kept' : `re-based by ${offset} days`)],
      }),
    );
    for (const edge of programmeRepository.listDependencies(sourceProjectId)) {
      const predecessorId = idMap.get(edge.predecessorId);
      const successorId = idMap.get(edge.successorId);
      if (!predecessorId || !successorId) continue;
      programmeRepository.insertDependency({
        id: asId<'TaskDependency'>(`dep-${randomUUID()}`),
        projectId: targetProjectId,
        predecessorId,
        successorId,
        type: 'FS',
        lagDays: edge.lagDays,
      });
    }
    projectsService.bumpRevision(targetProjectId);
    accessService.record({
      actor: actorName(actor),
      summary: `Programme cloned · ${source.code} → ${target.code}`,
      context: `${created.length} items · ${options.assumptions ? 'dates kept' : 'dates re-based to the target start'} · actuals not copied`,
    });
    return created;
  },
};
