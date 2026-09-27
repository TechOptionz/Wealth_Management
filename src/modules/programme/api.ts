/**
 * Transport-agnostic handlers for the programme module.
 *
 * Every handler opens with the platform capability guard and the per-project
 * guard (NFR-01, IAM02). Reads need `financials.read`, so an investor — who
 * holds `participation.read` only — is refused. Writes need `programme.edit`.
 */
import { accessService } from '@/modules/access/service';
import { projectsService } from '@/modules/projects/service';
import { resolveAsOfDate } from '@/shared/config/app-config';
import { ValidationError } from '@/shared/lib/errors';
import { asId, type IsoDate, type MilestoneId, type ProjectId, type TaskDependencyId, type UserId } from '@/shared/types/common';
import { programmeService, type ApplyMoveResult, type MilestoneChanges } from './service';
import { effectiveDateOf, type Milestone, type MilestoneKind, type MovePreview, type TaskDependency } from './model';
import type { CreateMilestoneBody, DependencyBody, PatchMilestoneBody } from './validation';

export interface DependencyLink {
  readonly dependencyId: string;
  readonly milestoneId: string;
  readonly name: string;
  readonly lagDays: number;
}

export interface ProgrammeRow {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly kind: MilestoneKind;
  readonly parentId: string | null;
  readonly depth: 0 | 1;
  readonly plannedStart: IsoDate | null;
  readonly plannedDate: IsoDate;
  readonly actualDate: IsoDate | null;
  readonly effectiveDate: IsoDate;
  readonly durationDays: number | null;
  readonly ownerUserId: string | null;
  readonly ownerName: string | null;
  readonly completionPercent: number;
  /** Planned before the as-of date with no actual recorded. */
  readonly late: boolean;
  readonly predecessors: readonly DependencyLink[];
  readonly successors: readonly DependencyLink[];
  readonly history: Milestone['history'];
}

export interface ProgrammeOverview {
  readonly project: {
    readonly id: string;
    readonly code: string;
    readonly name: string;
    readonly startDate: IsoDate;
    readonly expectedCompletion: IsoDate;
    readonly modelRevision: number;
  };
  readonly asOf: IsoDate;
  readonly actualsCutoff: IsoDate;
  readonly rows: readonly ProgrammeRow[];
  readonly people: readonly { readonly id: string; readonly name: string }[];
  readonly permissions: { readonly canEdit: boolean };
}

function guardRead(rawProjectId: string): ProjectId {
  accessService.guard('development.read');
  const projectId = asId<'Project'>(rawProjectId);
  projectsService.guard(projectId, 'financials.read');
  return projectId;
}

function guardEdit(rawProjectId: string): { readonly projectId: ProjectId; readonly actor: UserId } {
  accessService.guard('development.read');
  const projectId = asId<'Project'>(rawProjectId);
  projectsService.guard(projectId, 'programme.edit');
  return { projectId, actor: accessService.getCurrentUser().id };
}

/** Rows in tree order: each stage followed by its children; orphans at the end. */
function toRows(milestones: readonly Milestone[], dependencies: readonly TaskDependency[], asOf: IsoDate): readonly ProgrammeRow[] {
  const byId = new Map(milestones.map((row) => [row.id, row] as const));
  const link = (edge: TaskDependency, other: MilestoneId): DependencyLink => ({
    dependencyId: edge.id,
    milestoneId: other,
    name: byId.get(other)?.name ?? other,
    lagDays: edge.lagDays,
  });
  const toRow = (row: Milestone, depth: 0 | 1): ProgrammeRow => ({
    id: row.id,
    code: row.code,
    name: row.name,
    kind: row.kind,
    parentId: row.parentId ?? null,
    depth,
    plannedStart: row.plannedStart ?? null,
    plannedDate: row.plannedDate,
    actualDate: row.actualDate ?? null,
    effectiveDate: effectiveDateOf(row),
    durationDays: row.durationDays ?? null,
    ownerUserId: row.ownerUserId ?? null,
    ownerName: accessService.resolveUserName(row.ownerUserId),
    completionPercent: row.completionPercent,
    late: !row.actualDate && row.plannedDate < asOf,
    predecessors: dependencies.filter((edge) => edge.successorId === row.id).map((edge) => link(edge, edge.predecessorId)),
    successors: dependencies.filter((edge) => edge.predecessorId === row.id).map((edge) => link(edge, edge.successorId)),
    history: row.history,
  });
  const stages = milestones.filter((row) => row.kind === 'stage');
  const placed = new Set<MilestoneId>();
  const rows: ProgrammeRow[] = [];
  for (const stage of stages) {
    rows.push(toRow(stage, 0));
    placed.add(stage.id);
    for (const child of milestones.filter((row) => row.parentId === stage.id)) {
      rows.push(toRow(child, 1));
      placed.add(child.id);
    }
  }
  for (const row of milestones) if (!placed.has(row.id)) rows.push(toRow(row, row.parentId ? 1 : 0));
  return rows;
}

export const programmeApi = {
  /** PRG01 — everything the list and Gantt views need. */
  overview(rawProjectId: string): ProgrammeOverview {
    const projectId = guardRead(rawProjectId);
    const scope = projectsService.guard(projectId, 'project.read');
    const project = projectsService.require(projectId);
    const asOf = resolveAsOfDate();
    return {
      project: {
        id: project.id,
        code: project.code,
        name: project.name,
        startDate: project.startDate,
        expectedCompletion: project.expectedCompletion,
        modelRevision: project.modelRevision,
      },
      asOf,
      actualsCutoff: projectsService.policyFor(projectId).actualsCutoff,
      rows: toRows(programmeService.listMilestones(projectId), programmeService.listDependencies(projectId), asOf),
      people: accessService.listUsers().map((user) => ({ id: user.id, name: user.name })),
      permissions: { canEdit: scope.permissions.includes('programme.edit') },
    };
  },

  /** PRG03 — the date preview of a move; writes nothing. */
  previewMove(rawMilestoneId: string, newPlannedDate: IsoDate): MovePreview {
    accessService.guard('development.read');
    const milestone = programmeService.requireMilestone(asId<'Milestone'>(rawMilestoneId));
    projectsService.guard(milestone.projectId, 'financials.read');
    return programmeService.previewMove(milestone.id, newPlannedDate);
  },

  applyMove(rawMilestoneId: string, newPlannedDate: IsoDate, reason: string, expectedRevision?: number): ApplyMoveResult {
    accessService.guard('development.read');
    const milestone = programmeService.requireMilestone(asId<'Milestone'>(rawMilestoneId));
    const { actor } = guardEdit(milestone.projectId);
    return programmeService.applyMove({ milestoneId: milestone.id, newPlannedDate, actor, reason, expectedRevision });
  },

  recordActual(rawMilestoneId: string, actualDate: IsoDate): Milestone {
    accessService.guard('development.read');
    const milestone = programmeService.requireMilestone(asId<'Milestone'>(rawMilestoneId));
    const { actor } = guardEdit(milestone.projectId);
    return programmeService.recordActual(milestone.id, actualDate, actor);
  },

  create(rawProjectId: string, body: CreateMilestoneBody, expectedRevision?: number): Milestone {
    const { projectId, actor } = guardEdit(rawProjectId);
    return programmeService.createMilestone({
      projectId,
      code: body.code,
      name: body.name,
      kind: body.kind as MilestoneKind,
      ...(body.parentId ? { parentId: asId<'Milestone'>(body.parentId) } : {}),
      ...(body.plannedStart ? { plannedStart: body.plannedStart } : {}),
      plannedDate: body.plannedDate,
      ...(body.durationDays !== undefined ? { durationDays: body.durationDays } : {}),
      ...(body.ownerUserId ? { ownerUserId: asId<'User'>(body.ownerUserId) } : {}),
      actor,
      expectedRevision,
    });
  },

  update(rawMilestoneId: string, changes: MilestoneChanges, reason?: string): Milestone {
    accessService.guard('development.read');
    const milestone = programmeService.requireMilestone(asId<'Milestone'>(rawMilestoneId));
    const { actor } = guardEdit(milestone.projectId);
    return programmeService.updateMilestone(milestone.id, changes, actor, reason);
  },

  /**
   * PATCH /v1/milestones/{id}. A changed planned date is a move (reason
   * required, cascade applied, one revision); an actual date is recorded as
   * a fact; anything else is a descriptive edit.
   */
  patch(rawMilestoneId: string, body: PatchMilestoneBody, expectedRevision?: number): { readonly milestone: Milestone; readonly move: ApplyMoveResult | null } {
    accessService.guard('development.read');
    const milestone = programmeService.requireMilestone(asId<'Milestone'>(rawMilestoneId));
    const { actor } = guardEdit(milestone.projectId);
    let move: ApplyMoveResult | null = null;
    if (body.plannedDate !== undefined && body.plannedDate !== milestone.plannedDate) {
      if (!body.reason?.trim()) throw new ValidationError('Moving a planned date needs a reason.', { fieldErrors: { reason: ['Give a reason for the move.'] } });
      move = programmeService.applyMove({ milestoneId: milestone.id, newPlannedDate: body.plannedDate, actor, reason: body.reason, expectedRevision });
    }
    const changes: MilestoneChanges = {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.code !== undefined ? { code: body.code } : {}),
      ...(body.plannedStart !== undefined ? { plannedStart: body.plannedStart } : {}),
      ...(body.durationDays !== undefined ? { durationDays: body.durationDays } : {}),
      ...(body.ownerUserId !== undefined ? { ownerUserId: body.ownerUserId ? asId<'User'>(body.ownerUserId) : undefined } : {}),
      ...(body.completionPercent !== undefined ? { completionPercent: body.completionPercent } : {}),
      ...(body.parentId !== undefined ? { parentId: asId<'Milestone'>(body.parentId) } : {}),
    };
    if (Object.keys(changes).length > 0) programmeService.updateMilestone(milestone.id, changes, actor, body.reason);
    if (body.actualDate !== undefined) programmeService.recordActual(milestone.id, body.actualDate, actor);
    return { milestone: programmeService.requireMilestone(milestone.id), move };
  },

  addDependency(rawProjectId: string, body: DependencyBody): TaskDependency {
    const { projectId, actor } = guardEdit(rawProjectId);
    return programmeService.addDependency({
      projectId,
      predecessorId: asId<'Milestone'>(body.predecessorId),
      successorId: asId<'Milestone'>(body.successorId),
      lagDays: body.lagDays,
      actor,
    });
  },

  removeDependency(rawProjectId: string, rawDependencyId: string): void {
    const { projectId, actor } = guardEdit(rawProjectId);
    const id: TaskDependencyId = asId<'TaskDependency'>(rawDependencyId);
    const row = programmeService.listDependencies(projectId).find((edge) => edge.id === id);
    if (!row) throw new ValidationError('That dependency is not part of this project.');
    programmeService.removeDependency(id, actor);
  },
};
