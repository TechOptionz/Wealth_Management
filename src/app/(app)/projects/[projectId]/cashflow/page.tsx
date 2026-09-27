import type { Metadata } from 'next';
import { loadUnitOfWork } from '@/server/db/unit-of-work';
import { renderGuarded } from '@/shared/components/AccessDenied';
import { formatDateLong } from '@/shared/lib/dates';
import { projectModelApi } from '@/modules/project-model/api';
import { projectModelService, SUMMARY_COLUMN_LABELS, DEFAULT_SUMMARY_COLUMNS } from '@/modules/project-model/service';
import { CashflowScreen } from '@/modules/project-model/components/CashflowScreen';

export const metadata: Metadata = { title: 'Cashflow · Development Finance' };

interface PageProps {
  readonly params: Promise<{ readonly projectId: string }>;
  readonly searchParams: Promise<{ readonly basis?: string }>;
}

/** CF01–CF06 — the monthly project grid. */
export default async function CashflowPage({ params, searchParams }: PageProps) {
  await loadUnitOfWork();
  const { projectId } = await params;
  const { basis } = await searchParams;

  return renderGuarded(() => {
    const payload = projectModelApi.cashflow(projectId, { basis });
    return (
      <CashflowScreen
        projectId={projectId}
        basis={payload.basis}
        months={payload.run.result.months}
        cutoffMonth={payload.run.result.cutoffMonth}
        cutoffLabel={formatDateLong(payload.run.actualsCutoff)}
        rows={payload.view.rows}
        columnLabels={SUMMARY_COLUMN_LABELS}
        initialColumns={DEFAULT_SUMMARY_COLUMNS}
        warnings={projectModelService.describeWarnings(payload.run.warnings)}
        stale={payload.stale}
        runLabel={projectModelService.freshnessLabel(payload.run)}
      />
    );
  });
}
