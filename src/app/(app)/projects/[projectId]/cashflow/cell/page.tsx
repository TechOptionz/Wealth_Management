import type { Metadata } from 'next';
import Link from 'next/link';
import { loadUnitOfWork } from '@/server/db/unit-of-work';
import { renderGuarded } from '@/shared/components/AccessDenied';
import { Card, CardHeader } from '@/shared/components/Card';
import { Chip } from '@/shared/components/Chip';
import { DataTable, CellMain, CellSub } from '@/shared/components/DataTable';
import { Row, Stack, Sub } from '@/shared/components/Layout';
import { Banner } from '@/shared/components/Banner';
import { formatMoney, money } from '@/shared/lib/money';
import { formatDateLong } from '@/shared/lib/dates';
import { projectModelApi } from '@/modules/project-model/api';
import { projectModelService } from '@/modules/project-model/service';
import type { CellContribution } from '@/modules/project-model/model';

export const metadata: Metadata = { title: 'Cell detail · Cashflow' };

interface PageProps {
  readonly params: Promise<{ readonly projectId: string }>;
  readonly searchParams: Promise<{ readonly row?: string; readonly month?: string; readonly basis?: string }>;
}

const BASIS_CHIP: Record<CellContribution['basis'], { tone: 'good' | 'warn' | 'neutral'; label: string; icon: 'i-check' | 'i-clock' | 'i-calc' }> = {
  actual: { tone: 'good', label: 'Actual', icon: 'i-check' },
  approved: { tone: 'warn', label: 'Approved · unpaid', icon: 'i-clock' },
  forecast: { tone: 'neutral', label: 'Forecast', icon: 'i-calc' },
};

/** CF05 — what makes up one Cashflow cell. */
export default async function CellPage({ params, searchParams }: PageProps) {
  await loadUnitOfWork();
  const { projectId } = await params;
  const { row = '', month = '', basis } = await searchParams;
  const base = `/projects/${encodeURIComponent(projectId)}`;

  return renderGuarded(() => {
    const { run, basis: resolved, contributions } = projectModelApi.cell(projectId, { rowId: row, month, basis });
    const gridRow = projectModelService.rowById(run, resolved, row);
    const cellValue = gridRow?.months[month] ?? 0;
    const isAggregate = gridRow ? gridRow.kind !== 'posting' : false;
    const total = contributions.reduce((sum, c) => sum + c.cents, 0);

    return (
      <Stack>
        <Row>
          <Link className="btn sm" href={`${base}/cashflow?basis=${resolved}`}>
            ← Back to Cashflow
          </Link>
          <Sub>
            {gridRow ? `${gridRow.code ? `${gridRow.code} · ` : ''}${gridRow.label}` : row} · {month} · {resolved} basis
          </Sub>
        </Row>
        {isAggregate ? (
          <Banner tone="info" title="This is a total, not an editable amount">
            It adds the posting rows beneath it. Open a cost line to change its budget or schedule.
          </Banner>
        ) : null}
        <Card>
          <CardHeader title={`Cell value ${formatMoney(money(cellValue), { showCents: true })}`} aside={<Sub>Run rev {run.modelRevision} · engine {run.engineVersion}</Sub>} />
          <DataTable
            columns={[
              {
                header: 'Contribution',
                lead: true,
                render: (c: CellContribution) => (
                  <>
                    <CellMain>{c.href ? <Link href={`${base}/${c.href}`}>{c.label}</Link> : c.label}</CellMain>
                    <CellSub>{c.source}</CellSub>
                  </>
                ),
              },
              { header: 'Date', render: (c: CellContribution) => formatDateLong(c.date) },
              {
                header: 'Status',
                render: (c: CellContribution) => (
                  <Chip tone={BASIS_CHIP[c.basis].tone} icon={BASIS_CHIP[c.basis].icon}>
                    {BASIS_CHIP[c.basis].label} · {c.status}
                  </Chip>
                ),
              },
              { header: 'Tax basis', render: (c: CellContribution) => c.taxBasis },
              { header: 'Editable', render: (c: CellContribution) => (c.editable ? 'Yes · on its record' : 'No · recorded fact') },
              { header: 'Amount', align: 'right', render: (c: CellContribution) => <span className="num">{formatMoney(money(c.cents), { showCents: true })}</span> },
            ]}
            rows={contributions}
            rowKey={(c) => `${c.source}:${c.label}:${c.date}:${c.cents}`}
            empty={isAggregate ? 'Totals are made of the rows beneath them — open a posting row for its contributions.' : 'Nothing contributes to this cell.'}
          />
        </Card>
        {!isAggregate && contributions.length > 0 ? (
          <Sub style={{ fontSize: 12 }}>
            Contributions total {formatMoney(money(total), { showCents: true })}
            {total === cellValue ? ' — reconciles to the cell.' : ' — does not reconcile; investigate before relying on this figure.'}
          </Sub>
        ) : null}
      </Stack>
    );
  });
}
