/**
 * Programme data access — the only file in this module that touches storage.
 */
import { createCollection } from '@/server/db/collection';
import type { MilestoneId, ProjectId, TaskDependencyId } from '@/shared/types/common';
import type { Milestone, TaskDependency } from './model';
import { seedDependencies, seedMilestones } from './data/seed';

const milestones = createCollection<Milestone>('programme.milestones', seedMilestones);
const dependencies = createCollection<TaskDependency>('programme.dependencies', seedDependencies);

export const programmeRepository = {
  /** Milestones of a project in display order. */
  listMilestones: (projectId: ProjectId): readonly Milestone[] =>
    [...milestones.where((row) => row.projectId === projectId)].sort(
      (a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code),
    ),
  findMilestone: (id: MilestoneId): Milestone | undefined => milestones.find(id),
  findMilestoneByCode: (projectId: ProjectId, code: string): Milestone | undefined =>
    milestones.findBy((row) => row.projectId === projectId && row.code.toLowerCase() === code.toLowerCase()),
  insertMilestone: (row: Milestone): Milestone => milestones.insert(row),
  updateMilestone: (id: MilestoneId, changes: Partial<Omit<Milestone, 'id'>>): Milestone | undefined =>
    milestones.update(id, changes),

  listDependencies: (projectId: ProjectId): readonly TaskDependency[] =>
    dependencies.where((row) => row.projectId === projectId),
  findDependency: (id: TaskDependencyId): TaskDependency | undefined => dependencies.find(id),
  insertDependency: (row: TaskDependency): TaskDependency => dependencies.insert(row),
  removeDependency: (id: TaskDependencyId): boolean => dependencies.remove(id),

  /** Test isolation. */
  reset: (): void => {
    milestones.reset();
    dependencies.reset();
  },
};
