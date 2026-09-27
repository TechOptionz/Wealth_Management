import type { Metadata } from 'next';
import { loadUnitOfWork } from '@/server/db/unit-of-work';
import { renderGuarded } from '@/shared/components/AccessDenied';
import { resolveAsOfDate } from '@/shared/config/app-config';
import { asId } from '@/shared/types/common';
import { projectsService } from '@/modules/projects/service';
import { fundingApi } from '@/modules/funding/api';
import { FinanceScreen, ParticipationScreen } from '@/modules/funding/components/FinanceScreen';

export const metadata: Metadata = { title: 'Project finance · Holdfast' };

interface PageProps {
  readonly params: Promise<{ readonly projectId: string }>;
}

/**
 * FIN01–FIN06, EQ01–EQ03, WFL01–WFL04 — debt, equity and the waterfall.
 * An investor (participation only) sees their own capital account (EQ03).
 */
export default async function ProjectFinancePage({ params }: PageProps) {
  await loadUnitOfWork();
  const { projectId } = await params;
  const asOf = resolveAsOfDate();

  return renderGuarded(() => {
    const scope = projectsService.currentScope(asId<'Project'>(projectId));
    if (scope && !scope.permissions.includes('financials.read') && scope.permissions.includes('participation.read')) {
      return <ParticipationScreen view={fundingApi.participation(projectId, asOf)} />;
    }
    return <FinanceScreen data={fundingApi.screen(projectId, asOf)} />;
  });
}
