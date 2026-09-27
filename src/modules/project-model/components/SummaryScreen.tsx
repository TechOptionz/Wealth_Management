import Link from 'next/link';
import { Banner } from '@/shared/components/Banner';
import { Card, CardBody, CardHeader } from '@/shared/components/Card';
import { Chip } from '@/shared/components/Chip';
import { DataTable, CellMain, CellSub } from '@/shared/components/DataTable';
import { Kpi, KpiGrid } from '@/shared/components/Kpi';
import { Grid, Stack, Sub } from '@/shared/components/Layout';
import { formatMoney, money } from '@/shared/lib/money';
import { formatDateLong } from '@/shared/lib/dates';
import { XIRR_UNAVAILABLE_LABELS, type XirrResult } from '@/shared/finance-engine';
import type { Available } from '@/shared/lib/result';
import type { ModelKpis, MonthTotals } from '../model';
import type { ExceptionItem } from '../service';

export interface SummaryScreenProps {
  readonly projectId: string;
  readonly basis: 'economic' | 'gross';
  readonly kpis: ModelKpis;
  readonly totals: readonly MonthTotals[];
  readonly exceptions: readonly ExceptionItem[];
  readonly warnings: readonly string[];
  readonly runLabel: string;
  readonly stale: boolean;
  readonly baselineName: string | null;
}

function pct(value: Available<number>): string {
  return value.available ? `${(value.value * 100).toFixed(1)}%` : value.reason;
}

function irr(value: XirrResult): string {
  return value.available ? `${(value.rate * 100).toFixed(2)}%` : XIRR_UNAVAILABLE_LABELS[value.reason];
}

const $ = (cents: number): string => formatMoney(money(cents));

/**
 * SUM01–SUM03 — feasibility at a glance. Figures come from the same run as the
 * grid; each chart has a table alternative directly below it (UI03).
 */
export function SummaryScreen({ projectId, basis, kpis, totals, exceptions, warnings, runLabel, stale, baselineName }: SummaryScreenProps) {
  const base = `/projects/${encodeURIComponent(projectId)}`;
  const variance = kpis.costVarianceCents;

  let cumulative = 0;
  const cumulativeRows = totals.map((t) => {
    cumulative = t.closingCashCents;
    return { ...t, cumulative };
  });
  const maxAbs = Math.max(1, ...cumulativeRows.map((t) => Math.abs(t.closingCashCents)), ...totals.map((t) => t.debtClosingCents));

  return (
    <Stack>
      {stale ? <Banner tone="warn" title="This calculation is behind the model">Reload to recalculate against the latest revision.</Banner> : null}

      <KpiGrid>
        <Kpi
          accent
          label="Development profit (before income tax)"
          value={$(kpis.profitCents)}
          footer={`Margin on cost ${pct(kpis.marginOnCost)} · on revenue ${pct(kpis.marginOnRevenue)}`}
        />
        <Kpi label="Net revenue" value={$(kpis.netRevenueCents)} footer={`Gross ${$(kpis.grossRevenueCents)} less output GST ${$(kpis.outputGstCents)}`} />
        <Kpi
          label="Economic cost incl. finance"
          value={$(kpis.economicCostCents + kpis.financeCostCents)}
          footer={
            variance === null ? (
              'No baseline published'
            ) : (
              <>
                <Chip tone={variance > 0 ? 'bad' : 'good'} icon={variance > 0 ? 'i-up' : 'i-down'}>
                  {$(Math.abs(variance))} {variance > 0 ? 'over baseline · adverse' : variance < 0 ? 'under baseline · favourable' : 'on baseline'}
                </Chip>
              </>
            )
          }
        />
        <Kpi label="Finance costs" value={$(kpis.financeCostCents)} footer="Interest, fees and finance cost lines" />
        <Kpi label="Project IRR" value={irr(kpis.projectIrr)} footer="Unlevered, dated flows, before income tax" />
        <Kpi label="Equity IRR" value={irr(kpis.equityIrr)} footer="Contributions against modelled distributions" />
        <Kpi label="Peak debt" value={$(kpis.peakDebtCents)} footer={kpis.peakDebtOn ? `on ${formatDateLong(kpis.peakDebtOn)}` : 'No debt drawn'} />
        <Kpi label="Peak equity" value={$(kpis.peakEquityCents)} footer={kpis.peakEquityOn ? `on ${formatDateLong(kpis.peakEquityOn)}` : 'No equity contributed'} />
      </KpiGrid>

      <KpiGrid>
        <Kpi
          label="Funding gap"
          value={kpis.fundingGapCents === 0 ? 'Fully funded' : $(kpis.fundingGapCents)}
          footer={
            kpis.fundingGapCents === 0 ? (
              <Chip tone="good" icon="i-check">Covered by authorised equity and debt</Chip>
            ) : (
              <Chip tone="bad" icon="i-alert">Uncovered · not auto-balanced</Chip>
            )
          }
        />
        <Kpi label="Peak cash requirement" value={$(kpis.peakCashRequirementCents)} footer="Before equity and debt" />
        <Kpi label="Contracted revenue" value={$(kpis.contractedRevenueCents)} footer={`Uncontracted forecast ${$(kpis.uncontractedRevenueCents)}`} />
        <Kpi label="Completion" value={formatDateLong(kpis.completionDate)} footer={baselineName ? `Baseline: ${baselineName}` : 'No baseline'} />
      </KpiGrid>

      <Grid columns={2}>
        <Card>
          <CardHeader title="Cumulative cash and debt" aside={<Sub>{basis === 'gross' ? 'Gross cash' : 'Economic view'}</Sub>} />
          <CardBody>
            <svg className="chart" viewBox={`0 0 ${totals.length * 26 + 20} 160`} role="img" aria-label="Closing cash and debt outstanding by month; the table below has the same figures">
              <line x1="0" x2={totals.length * 26 + 20} y1="80" y2="80" stroke="var(--line)" />
              {cumulativeRows.map((t, index) => {
                const h = (Math.abs(t.closingCashCents) / maxAbs) * 70;
                const d = (t.debtClosingCents / maxAbs) * 70;
                return (
                  <g key={t.month}>
                    <rect x={10 + index * 26} y={t.closingCashCents >= 0 ? 80 - h : 80} width="10" height={Math.max(h, 0.5)} fill={t.closingCashCents >= 0 ? 'var(--bar)' : 'var(--bad)'}>
                      <title>{`${t.month} closing cash ${$(t.closingCashCents)}`}</title>
                    </rect>
                    <rect x={21 + index * 26} y={80 - d} width="8" height={Math.max(d, 0.5)} fill="var(--gold)">
                      <title>{`${t.month} debt ${$(t.debtClosingCents)}`}</title>
                    </rect>
                  </g>
                );
              })}
            </svg>
            <div className="legend" style={{ marginTop: 8 }}>
              <span><i style={{ background: 'var(--bar)' }} />Closing cash</span>
              <span><i style={{ background: 'var(--gold)' }} />Debt outstanding</span>
              <span><i style={{ background: 'var(--bad)' }} />Negative cash</span>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Exceptions" aside={<Sub>{exceptions.length} to review</Sub>} />
          {exceptions.length === 0 ? (
            <CardBody><Sub>Nothing needs attention.</Sub></CardBody>
          ) : (
            <ul className="list">
              {exceptions.map((item) => (
                <li key={item.rule}>
                  <Chip tone={item.severity} icon={item.severity === 'info' ? 'i-clock' : 'i-alert'}>
                    {item.severity === 'bad' ? 'Action' : item.severity === 'warn' ? 'Review' : 'Note'}
                  </Chip>
                  <div className="li-main">
                    <b><Link href={item.href}>{item.title}</Link></b>
                    <span>{item.detail} · {item.rule}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </Grid>

      <Card>
        <CardHeader title="Monthly receipts, payments and funding" aside={<Sub>Table alternative to the chart · same run</Sub>} />
        <DataTable
          columns={[
            { header: 'Month', lead: true, render: (t: MonthTotals) => <><CellMain>{t.month}</CellMain><CellSub>{t.actual ? 'Actual' : 'Forecast'}</CellSub></> },
            { header: 'Receipts', align: 'right', render: (t: MonthTotals) => <span className="num">{$(t.receiptsCents + t.depositsReleasedCents)}</span> },
            { header: 'Payments', align: 'right', render: (t: MonthTotals) => <span className="num">{$(t.developmentPaymentsCents)}</span> },
            { header: 'GST net', align: 'right', render: (t: MonthTotals) => <span className="num">{$(t.taxRefundCents - t.taxRemittanceCents)}</span> },
            { header: 'Equity', align: 'right', render: (t: MonthTotals) => <span className="num">{$(t.equityContributionsCents)}</span> },
            { header: 'Debt draws', align: 'right', render: (t: MonthTotals) => <span className="num">{$(t.debtDrawsCents - t.principalRepaymentsCents)}</span> },
            { header: 'Interest & fees', align: 'right', render: (t: MonthTotals) => <span className="num">{$(t.cashInterestCents + t.capitalisedInterestCents + t.feesCents)}</span> },
            { header: 'Closing cash', align: 'right', render: (t: MonthTotals) => <span className="num">{$(t.closingCashCents)}</span> },
            { header: 'Unfunded', align: 'right', render: (t: MonthTotals) => (t.unfundedCents > 0 ? <Chip tone="bad" icon="i-alert">{$(t.unfundedCents)}</Chip> : '–') },
          ]}
          rows={totals}
          rowKey={(t) => t.month}
        />
      </Card>

      {warnings.length > 0 ? (
        <Card>
          <CardHeader title="Calculation warnings" />
          <ul className="list">
            {warnings.map((warning, index) => (
              <li key={index}><div className="li-main"><span style={{ whiteSpace: 'normal' }}>{warning}</span></div></li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Sub style={{ fontSize: 12 }}>
        {runLabel}. Profit is net revenue less economic development costs less finance costs; income tax is excluded (CAL13).{' '}
        <Link href={`${base}/cashflow`}>Open the Cashflow grid</Link> to trace any figure to its source.
      </Sub>
    </Stack>
  );
}
