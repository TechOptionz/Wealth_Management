import Link from 'next/link';
import { Card, CardBody, CardHeader } from '@/shared/components/Card';
import { Chip } from '@/shared/components/Chip';
import { DataTable, CellMain, CellSub, Num, type DataTableColumn } from '@/shared/components/DataTable';
import { Stack, Sub } from '@/shared/components/Layout';
import { formatDateLong } from '@/shared/lib/dates';
import { formatMoney } from '@/shared/lib/money';
import { REVENUE_EVENT_LABELS, type RevenueEvent } from '../model';
import type { RevenueGroupDetail, RevenueGroupTotal, UnitRow } from '../api';
import { SalesStatusChip } from './status';

/** The Revenue register: each group with contracted, forecast and received totals. */
export function RevenueGroupsScreen({ projectId, groups }: { readonly projectId: string; readonly groups: readonly RevenueGroupTotal[] }) {
  const columns: readonly DataTableColumn<RevenueGroupTotal>[] = [
    {
      header: 'Group',
      lead: true,
      render: (row) => (
        <>
          <CellMain>
            <Link href={`/projects/${projectId}/revenue/${row.group.id}`}>{row.group.name}</Link>
          </CellMain>
          <br />
          <CellSub>{row.group.code}</CellSub>
        </>
      ),
    },
    { header: 'Units', align: 'right', render: (row) => <Num>{row.unitCount}</Num> },
    { header: 'Contracted', align: 'right', render: (row) => <Num>{formatMoney(row.contracted)}</Num> },
    { header: 'Uncontracted forecast', align: 'right', render: (row) => <Num>{formatMoney(row.uncontractedForecast)}</Num> },
    { header: 'Other income', align: 'right', render: (row) => <Num>{formatMoney(row.otherIncome)}</Num> },
    { header: 'Received to date', align: 'right', render: (row) => <Num>{formatMoney(row.actualReceived)}</Num> },
  ];
  return (
    <Card>
      <CardHeader title="Revenue register" aside={<Sub>Gross incl. GST · received includes deposits held in trust</Sub>} />
      <DataTable columns={columns} rows={groups} rowKey={(row) => row.group.id} empty="No revenue groups." />
    </Card>
  );
}

function eventColumns(): readonly DataTableColumn<RevenueEvent>[] {
  return [
    { header: 'Date', lead: true, render: (row) => formatDateLong(row.date) },
    { header: 'Event', render: (row) => (<><CellMain>{REVENUE_EVENT_LABELS[row.type]}</CellMain><br /><CellSub>{row.note ?? ''}</CellSub></>) },
    {
      header: 'Cash',
      render: (row) => (row.restricted ? <Chip tone="warn" icon="i-shield">Restricted · trust</Chip> : <Chip tone="good" icon="i-check">Unrestricted</Chip>),
    },
    { header: 'Gross', align: 'right', render: (row) => <Num>{formatMoney(row.type === 'refund' ? { ...row.gross, cents: -row.gross.cents } : row.gross, { showCents: true })}</Num> },
    { header: 'GST', align: 'right', render: (row) => <Num>{formatMoney(row.tax, { showCents: true })}</Num> },
    { header: 'Withholding', align: 'right', render: (row) => <Num>{row.withholding ? formatMoney(row.withholding, { showCents: true }) : '—'}</Num> },
  ];
}

/** One revenue group: its units and its actual (and expected) revenue events. */
export function RevenueGroupScreen({ projectId, detail }: { readonly projectId: string; readonly detail: RevenueGroupDetail }) {
  const unitColumns: readonly DataTableColumn<UnitRow>[] = [
    { header: 'Unit', lead: true, render: (row) => (<><CellMain>{row.unit.code}</CellMain><br /><CellSub>{row.unit.productType}</CellSub></>) },
    { header: 'Status', render: (row) => <SalesStatusChip status={row.status} /> },
    { header: 'Forecast', align: 'right', render: (row) => <Num>{formatMoney(row.unit.forecastPrice)}</Num> },
    { header: 'Contract', align: 'right', render: (row) => <Num>{row.contractPrice ? formatMoney(row.contractPrice) : '—'}</Num> },
    { header: 'Purchaser', render: (row) => (row.contract ? (detail.canSeePurchaser ? row.contract.purchaserReference : <Sub>Restricted</Sub>) : '—') },
    { header: 'In trust', align: 'right', render: (row) => <Num>{formatMoney(row.depositsInTrust)}</Num> },
  ];
  return (
    <Stack>
      <Sub>
        <Link href={`/projects/${projectId}/revenue`}>Revenue register</Link> · {detail.group.name}
      </Sub>
      {detail.units.length > 0 ? (
        <Card>
          <CardHeader title={`${detail.group.name} · units`} aside={<Sub>{detail.units.length} units</Sub>} />
          <DataTable columns={unitColumns} rows={detail.units} rowKey={(row) => row.unit.id} />
        </Card>
      ) : null}
      {detail.otherIncome.length > 0 ? (
        <Card>
          <CardHeader title="Income lines" />
          <CardBody>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
              {detail.otherIncome.map((line) => (
                <li key={line.id}>
                  <b>{line.description}</b> · {line.mode === 'recurring' ? `${formatMoney(line.monthlyAmount)}/month, 15th of each month` : `${formatMoney(line.amount)} one-off`}
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      ) : null}
      <Card>
        <CardHeader title="Actual revenue events" aside={<Sub>Recorded receipts, releases and refunds · never edited</Sub>} />
        <DataTable columns={eventColumns()} rows={detail.actualEvents} rowKey={(row) => row.id} empty="Nothing received yet." />
      </Card>
      <Card>
        <CardHeader title="Expected revenue events" aside={<Sub>Derived from contracts, forecasts and milestone dates · not stored</Sub>} />
        <DataTable columns={eventColumns()} rows={detail.forecastEvents} rowKey={(row) => row.id} empty="Nothing further expected." />
      </Card>
    </Stack>
  );
}
