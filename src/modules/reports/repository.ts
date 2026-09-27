/**
 * Report jobs — the only file in this module that touches storage.
 */
import { createCollection } from '@/server/db/collection';
import type { ProjectId, ReportJobId } from '@/shared/types/common';
import type { ReportJob } from './model';

const jobs = createCollection<ReportJob>('reports.jobs', () => []);

export const reportsRepository = {
  list: (projectId: ProjectId): readonly ReportJob[] =>
    [...jobs.where((job) => job.projectId === projectId)].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
  find: (id: ReportJobId): ReportJob | undefined => jobs.find(id),
  insert: (job: ReportJob): ReportJob => jobs.insert(job),
  update: (id: ReportJobId, changes: Partial<Omit<ReportJob, 'id'>>): ReportJob | undefined => jobs.update(id, changes),
  /** Test isolation. */
  reset: (): void => jobs.reset(),
};
