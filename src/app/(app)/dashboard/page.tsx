import type { Metadata } from 'next';
import { loadUnitOfWork } from '@/server/db/unit-of-work';
import { Banner } from '@/shared/components/Banner';
import { Card, CardBody, CardHeader } from '@/shared/components/Card';
import { Grid, Stack } from '@/shared/components/Layout';
import { renderGuarded } from '@/shared/components/AccessDenied';
import { resolveAsOfDate } from '@/shared/config/app-config';
import type { IsoDate } from '@/shared/types/common';
import { dashboardApi } from '@/modules/dashboard/api';
import { obligationsService } from '@/modules/obligations/service';
import { ScopeSwitcher } from '@/modules/dashboard/components/ScopeSwitcher';
import { DashboardKpis } from '@/modules/dashboard/components/DashboardKpis';
import { AttentionStrip } from '@/modules/dashboard/components/AttentionStrip';
import { CashFlowChart } from '@/modules/dashboard/components/CashFlowChart';
import { UpcomingList } from '@/modules/dashboard/components/UpcomingList';
import { ArrearsTable } from '@/modules/dashboard/components/ArrearsTable';
import { OwnershipView } from '@/modules/dashboard/components/OwnershipView';

export const metadata: Metadata = { title: 'Dashboard · Holdfast' };

interface PageProps {
  readonly searchParams: Promise<{ readonly entityId?: string | readonly string[] }>;
}

/**
 * FR-09 — portfolio overview. Rendered on the server from live module reads.
 *
 * `?entityId=` scopes the balance-sheet figures to one consolidated entity. The
 * id is resolved by the module API, so an unknown value shows the whole
 * portfolio rather than failing.
 */
export default async function DashboardPage({ searchParams }: PageProps) {
  await loadUnitOfWork();
  const asOf = resolveAsOfDate();
  const { entityId } = await searchParams;
  const requested = typeof entityId === 'string' ? entityId : undefined;

  // A user without portfolio totals sees an explanation, not a crash (NFR-01).
  return renderGuarded(() => dashboardView(asOf, requested));
}

/** Called as a plain function, not rendered, so the guard throws inside `renderGuarded`. */
function dashboardView(asOf: IsoDate, entityId: string | undefined) {
  const overview = dashboardApi.overview(asOf, entityId);
  const scope = overview.scope;

  return (
    <Stack>
      <ScopeSwitcher options={dashboardApi.scopeOptions()} selectedEntityId={scope?.entityId ?? null} />

      {scope ? (
        <Banner tone="info" icon="i-link" title={`Showing ${scope.entityName} only`}>
          Net worth, assets, liabilities and the ownership view are this entity&apos;s attributed share. Cash flow,
          arrears, obligations and alerts are not recorded per entity, so they remain whole-portfolio figures.
        </Banner>
      ) : null}

      <DashboardKpis
        scopeName={scope?.entityName ?? null}
        netWorth={overview.netWorth}
        monthlyCash={overview.monthlyCash}
        arrears={overview.arrears}
        upcoming={overview.upcomingSummary}
      />

      <AttentionStrip items={overview.attention} />

      <Grid columns={2}>
        <Card>
          <CardHeader
            title="Cash flow · last 6 months"
            aside={
              <div className="legend">
                <span>
                  <i style={{ background: 'var(--bar)' }} />
                  Receipts
                </span>
                <span>
                  <i style={{ background: 'var(--gold)' }} />
                  Outgoings
                </span>
              </div>
            }
          />
          <CardBody>
            <CashFlowChart points={overview.cashFlow} note={overview.cashFlowNote} />
          </CardBody>
        </Card>

        <UpcomingList items={overview.upcoming} totalCount={obligationsService.openCount(asOf)} />
      </Grid>

      <Grid columns={2}>
        <ArrearsTable positions={overview.arrearsPositions} />
        <OwnershipView positions={overview.ownership} />
      </Grid>
    </Stack>
  );
}
