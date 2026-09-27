import type { Metadata } from 'next';
import { loadUnitOfWork } from '@/server/db/unit-of-work';
import { renderGuarded } from '@/shared/components/AccessDenied';
import { programmeApi } from '@/modules/programme/api';
import { ProgrammeScreen } from '@/modules/programme/components/ProgrammeScreen';
import { previewMilestoneFinancialsAction } from '@/modules/project-model/actions';

export const metadata: Metadata = { title: 'Programme · Holdfast' };

interface PageProps {
  readonly params: Promise<{ readonly projectId: string }>;
}

/** PRG01–PRG04 — stages, milestones, tasks, dependencies and date moves. */
export default async function ProgrammePage({ params }: PageProps) {
  await loadUnitOfWork();
  const { projectId } = await params;
  return renderGuarded(() => <ProgrammeScreen overview={programmeApi.overview(projectId)} previewFinancials={previewMilestoneFinancialsAction} />);
}
