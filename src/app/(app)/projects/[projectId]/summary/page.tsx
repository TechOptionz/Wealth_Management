import type { Metadata } from 'next';
import { loadUnitOfWork } from '@/server/db/unit-of-work';
import { renderGuarded } from '@/shared/components/AccessDenied';
import { asId } from '@/shared/types/common';
import { projectModelApi } from '@/modules/project-model/api';
import { projectModelService } from '@/modules/project-model/service';
import { SummaryScreen } from '@/modules/project-model/components/SummaryScreen';
import { budgetsService } from '@/modules/budgets/service';

export const metadata: Metadata = { title: 'Summary · Development Finance' };

interface PageProps {
  readonly params: Promise<{ readonly projectId: string }>;
  readonly searchParams: Promise<{ readonly basis?: string }>;
}

/** SUM01–SUM03 — feasibility, returns and exceptions. */
export default async function SummaryPage({ params, searchParams }: PageProps) {
  await loadUnitOfWork();
  const { projectId } = await params;
  const { basis } = await searchParams;

  return renderGuarded(() => {
    const payload = projectModelApi.summary(projectId, { basis });
    const baseline = budgetsService.selectedBaseline(asId<'Project'>(projectId));
    return (
      <SummaryScreen
        projectId={projectId}
        basis={payload.basis}
        kpis={payload.view.kpis}
        totals={payload.view.totals}
        exceptions={payload.exceptions}
        warnings={projectModelService.describeWarnings(payload.run.warnings)}
        runLabel={projectModelService.freshnessLabel(payload.run)}
        stale={payload.stale}
        baselineName={baseline?.name ?? null}
      />
    );
  });
}
