'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Banner } from '@/shared/components/Banner';
import { Card, CardHeader } from '@/shared/components/Card';
import { Chip } from '@/shared/components/Chip';
import { FinanceGrid, type FinanceGridColumn, type FinanceGridRow } from '@/shared/components/FinanceGrid';
import { FinanceLegend } from '@/shared/components/FinanceLegend';
import { FilterGroup } from '@/shared/components/FilterGroup';
import { Row, Stack, Sub, Toolbar } from '@/shared/components/Layout';
import { formatMoney, money } from '@/shared/lib/money';
import type { GridRow, GridSection } from '../model';

export type CashflowColumnKey = 'current' | 'expended' | 'baseline' | 'variance' | 'committed' | 'approvedUnpaid' | 'remainingForecast';

export interface CashflowScreenProps {
  readonly projectId: string;
  readonly basis: 'economic' | 'gross';
  readonly months: readonly string[];
  readonly cutoffMonth: string;
  readonly cutoffLabel: string;
  readonly rows: readonly GridRow[];
  readonly columnLabels: Readonly<Record<CashflowColumnKey, { readonly label: string; readonly basis: string }>>;
  readonly initialColumns: readonly CashflowColumnKey[];
  readonly warnings: readonly string[];
  readonly stale: boolean;
  readonly runLabel: string;
}

type SectionFilter = 'all' | GridSection;

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function monthLabel(key: string): string {
  const [year, month] = key.split('-');
  return `${MONTH_NAMES[Number(month) - 1] ?? month} ${year?.slice(2)}`;
}

function cellText(cents: number, whole: boolean): string {
  if (cents === 0) return '–';
  return formatMoney(money(cents), { showCents: !whole });
}

/**
 * CF01–CF05 — the monthly grid. Item and summary columns are frozen, months
 * scroll. Actual months carry a green tint *and* the word "actual" in the
 * header (UI02). Every month cell links to its drill-through; aggregates are
 * never editable as leaves — editing happens on the cost line.
 */
export function CashflowScreen({ projectId, basis, months, cutoffMonth, cutoffLabel, rows, columnLabels, initialColumns, warnings, stale, runLabel }: CashflowScreenProps) {
  const [section, setSection] = useState<SectionFilter>('all');
  const [columns, setColumns] = useState<readonly CashflowColumnKey[]>(initialColumns);
  const [whole, setWhole] = useState(true);
  const [density, setDensity] = useState<'compact' | 'comfortable'>('compact');
  const base = `/projects/${encodeURIComponent(projectId)}`;

  const visibleRows = useMemo(() => (section === 'all' ? rows : rows.filter((row) => row.section === section || row.section === 'cash')), [rows, section]);

  const gridColumns: FinanceGridColumn[] = [
    ...columns.map((key, index) => ({
      key: `s:${key}`,
      header: columnLabels[key].label,
      title: columnLabels[key].basis,
      ...(index < 2 ? { frozen: (index + 1) as 1 | 2 } : {}),
    })),
    ...months.map((month) => ({
      key: `m:${month}`,
      header: monthLabel(month),
      subheader: month <= cutoffMonth ? 'actual' : 'forecast',
      actual: month <= cutoffMonth,
      month: true,
    })),
  ];

  const gridRows: FinanceGridRow[] = visibleRows.map((row) => {
    const cells: Record<string, FinanceGridRow['cells'][string]> = {};
    for (const key of columns) {
      const value = row.summary[key];
      if (value === null || value === undefined) {
        cells[`s:${key}`] = { content: key === 'baseline' || key === 'variance' ? 'No baseline' : '–', zero: true };
        continue;
      }
      if (key === 'variance' && row.section === 'costs') {
        cells[`s:${key}`] = {
          content: value === 0 ? 'On baseline' : `${cellText(Math.abs(value), whole)} ${value > 0 ? 'over ▲' : 'under ▼'}`,
          negative: value > 0,
          title: value > 0 ? 'Adverse: expected cost above baseline' : 'Favourable: expected cost below baseline',
        };
        continue;
      }
      cells[`s:${key}`] = { content: cellText(value, whole), zero: value === 0 };
    }
    for (const month of months) {
      const value = row.months[month] ?? 0;
      const drillable = row.kind === 'posting' || row.kind === 'group' || row.kind === 'parent';
      cells[`m:${month}`] = {
        content: cellText(value, whole),
        negative: value < 0,
        zero: value === 0,
        locked: month <= cutoffMonth && value !== 0,
        ...(drillable && value !== 0 ? { href: `${base}/cashflow/cell?row=${encodeURIComponent(row.id)}&month=${month}&basis=${basis}` } : {}),
      };
    }
    return {
      id: row.id,
      kind: row.kind,
      level: row.level,
      label: row.code ? `${row.code} · ${row.label}` : row.label,
      cells,
      ...(row.section === 'costs' && row.kind === 'group' && row.refId ? { labelHref: `${base}/costs/${encodeURIComponent(row.refId)}` } : {}),
      ...(row.section === 'revenue' && row.kind === 'posting' && row.refId ? { labelHref: `${base}/revenue/${encodeURIComponent(row.refId)}` } : {}),
    };
  });

  const toggleColumn = (key: CashflowColumnKey): void => {
    setColumns((current) => (current.includes(key) ? current.filter((c) => c !== key) : [...current, key]));
  };

  return (
    <Stack>
      <Toolbar>
        <FilterGroup<SectionFilter>
          label="Section"
          value={section}
          onChange={setSection}
          options={[
            { value: 'all', label: 'All' },
            { value: 'revenue', label: 'Revenue' },
            { value: 'costs', label: 'Costs' },
            { value: 'tax', label: 'GST' },
            { value: 'financing', label: 'Financing' },
          ]}
        />
        <Row>
          <a className="btn sm" href={`${base}/reports?template=monthly-cashflow`}>
            Export
          </a>
          <button type="button" className="btn sm" aria-pressed={!whole} onClick={() => setWhole((value) => !value)}>
            {whole ? 'Show cents' : 'Whole dollars'}
          </button>
          <button type="button" className="btn sm" aria-pressed={density === 'comfortable'} onClick={() => setDensity((d) => (d === 'compact' ? 'comfortable' : 'compact'))}>
            {density === 'compact' ? 'Comfortable rows' : 'Compact rows'}
          </button>
        </Row>
      </Toolbar>

      <Banner tone="info" icon="i-clock" title={`Actual plus forecast · actuals to ${cutoffLabel}`}>
        Months up to the cutoff show recorded payments and receipts only; later months are forecast. Showing the{' '}
        {basis === 'economic' ? 'economic view (net of recoverable GST)' : 'gross cash view (including GST)'}. Month-only forecasts are dated the 15th.
      </Banner>
      {stale ? (
        <Banner tone="warn" title="This calculation is behind the model">
          Reload the page to recalculate against the latest revision.
        </Banner>
      ) : null}
      {warnings.length > 0 ? (
        <Banner tone="warn" title={`${warnings.length} calculation warning${warnings.length === 1 ? '' : 's'}`}>
          {warnings.slice(0, 4).join(' · ')}
          {warnings.length > 4 ? ` · and ${warnings.length - 4} more on the Summary` : ''}
        </Banner>
      ) : null}

      <Card>
        <CardHeader
          title="Monthly cashflow"
          aside={
            <FinanceLegend
              items={[
                { label: 'Actual month · settled (paid or received)', swatch: 'var(--good-bg)' },
                { label: 'Forecast month', swatch: 'var(--surface)' },
                { label: 'Outflow shown in red with a minus sign', swatch: 'var(--bad-bg)' },
              ]}
            />
          }
        />
        <div className="card-b" style={{ paddingTop: 8, paddingBottom: 8 }}>
          <Row>
            <Sub style={{ fontSize: 12 }}>Columns:</Sub>
            {(Object.keys(columnLabels) as CashflowColumnKey[]).map((key) => (
              <button key={key} type="button" className="filter" aria-pressed={columns.includes(key)} title={columnLabels[key].basis} onClick={() => toggleColumn(key)}>
                {columnLabels[key].label}
              </button>
            ))}
          </Row>
        </div>
        <FinanceGrid caption="Monthly project cashflow" itemHeader="Item" columns={gridColumns} rows={gridRows} density={density} empty="No cost lines or revenue yet." />
      </Card>

      <Row>
        <Chip tone="neutral" icon="i-calc">
          {runLabel}
        </Chip>
        <Sub style={{ fontSize: 12 }}>
          Select a month figure to see the payments, approvals and forecasts behind it. Parent rows marked “summary” add their children only;
          Revenue and Costs children are in the sidebar. <Link href={`${base}/costs`}>Edit budgets and schedules</Link>.
        </Sub>
      </Row>
    </Stack>
  );
}
