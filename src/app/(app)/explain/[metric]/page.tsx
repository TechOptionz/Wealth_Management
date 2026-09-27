import type { Metadata } from 'next';
import { loadUnitOfWork } from '@/server/db/unit-of-work';
import { notFound } from 'next/navigation';
import { renderGuarded } from '@/shared/components/AccessDenied';
import { resolveAsOfDate } from '@/shared/config/app-config';
import { explainService, METRIC_LABELS, type ExplainableMetric } from '@/modules/dashboard/explain';
import { accessService } from '@/modules/access/service';
import { exportsService } from '@/modules/dashboard/exports';
import { ExplainScreen } from '@/modules/dashboard/components/ExplainScreen';

export const metadata: Metadata = { title: 'Explain this total · Holdfast' };

interface PageProps {
  readonly params: Promise<{ readonly metric: string }>;
  readonly searchParams: Promise<{ readonly asOf?: string }>;
}

/** FR-09 — "Drill-down must explain every total." */
export default async function ExplainPage({ params, searchParams }: PageProps) {
  await loadUnitOfWork();
  const { metric } = await params;
  const { asOf } = await searchParams;

  if (!(metric in METRIC_LABELS)) notFound();
  const typed = metric as ExplainableMetric;

  // The drill-down is guarded by the same capability as the screen it came from.
  return renderGuarded(() => {
    accessService.guard(exportsService.capabilityFor(typed));
    return <ExplainScreen explanation={explainService.explain(typed, asOf ?? resolveAsOfDate())} />;
  });
}
