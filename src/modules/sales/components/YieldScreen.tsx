'use client';

import { useMemo, useState } from 'react';
import { ActionForm, firstError } from '@/shared/components/ActionForm';
import { Button } from '@/shared/components/Button';
import { Card, CardBody, CardHeader } from '@/shared/components/Card';
import { DataTable, CellMain, CellSub, Num, type DataTableColumn } from '@/shared/components/DataTable';
import { FieldGrid, SelectField, TextField } from '@/shared/components/Field';
import { FilterGroup } from '@/shared/components/FilterGroup';
import { Kpi, KpiGrid } from '@/shared/components/Kpi';
import { Grid, Row, Stack, Sub, Toolbar } from '@/shared/components/Layout';
import { formatPpmAsPercent, TAX_TREATMENT_LABELS, TAX_TREATMENTS } from '@/shared/finance-engine';
import { formatDateLong, formatDateShort } from '@/shared/lib/dates';
import { formatMoney, formatPercent } from '@/shared/lib/money';
import { createOtherIncomeAction, createUnitAction, setCommissionRuleAction } from '../actions';
import { CANCELLATION_TREATMENTS, COMMISSION_TRIGGERS, SALEABLE_AREA_BASIS_LABELS, SALES_STATUS_LABELS, SALES_STATUSES } from '../model';
import type { UnitRow, YieldOverview } from '../api';
import { BulkPriceForm } from './BulkPriceForm';
import { UnitFields, UnitPanel } from './UnitPanel';
import { SalesStatusChip } from './status';

type Side = 'unit' | 'create' | 'bulk';

/** YLD01–YLD06, REV01 — the unit register, sales progress and revenue assumptions. */
export function YieldScreen({ overview, today }: { readonly overview: YieldOverview; readonly today: string }) {
  const { project, summary, groups, units, otherIncome, commissionRule, commissions, milestones, permissions } = overview;
  const [group, setGroup] = useState<string>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [side, setSide] = useState<Side>('unit');
  const rows = useMemo(() => units.filter((row) => group === 'all' || row.unit.groupId === group), [units, group]);
  const selected = units.find((row) => row.unit.id === selectedId) ?? null;
  const unitGroups = groups.filter((row) => units.some((unit) => unit.unit.groupId === row.id));

  const columns: readonly DataTableColumn<UnitRow>[] = [
    { header: 'Unit', lead: true, render: (row) => (<><CellMain>{row.unit.code}</CellMain><br /><CellSub>{row.groupName}</CellSub></>) },
    { header: 'Type', render: (row) => (<><CellMain>{row.unit.productType}</CellMain><br /><CellSub>{row.unit.bedrooms} bed · {row.unit.carSpaces} car</CellSub></>) },
    {
      header: 'Areas',
      align: 'right',
      render: (row) => (<><Num>{row.saleableAreaSqm} m²</Num><br /><CellSub>{row.unit.internalAreaSqm} int + {row.unit.externalAreaSqm} ext · {row.unit.saleableAreaBasis === 'internal' ? 'internal basis' : 'int + ext basis'}</CellSub></>),
    },
    { header: 'Asking', align: 'right', render: (row) => <Num>{formatMoney(row.unit.askingPrice)}</Num> },
    { header: 'Forecast', align: 'right', render: (row) => <Num>{formatMoney(row.unit.forecastPrice)}</Num> },
    { header: 'Contract', align: 'right', render: (row) => <Num>{row.contractPrice ? formatMoney(row.contractPrice) : '—'}</Num> },
    { header: 'Status', render: (row) => <SalesStatusChip status={row.status} /> },
  ];

  const avg = summary.averageSalePrice;
  const progress = summary.salesProgressRatio;
  const contractedCount = summary.unitCount - summary.byStatus.available - summary.byStatus.cancelled;

  return (
    <Stack>
      <KpiGrid>
        <Kpi accent label="Total gross revenue" help="Contract prices and uncontracted forecast prices; reconciles to the settlement, withholding and deposit events" value={formatMoney(summary.totalGrossRevenue)} footer={<Sub>{summary.unitCount} units · {summary.saleableAreaSqm.toLocaleString('en-AU')} m² saleable</Sub>} />
        <Kpi label="Contracted" value={formatMoney(summary.contractedRevenue)} footer={<Sub>{contractedCount} of {summary.unitCount} units</Sub>} />
        <Kpi label="Uncontracted forecast" value={formatMoney(summary.uncontractedForecastRevenue)} footer={<Sub>{summary.byStatus.available} available</Sub>} />
        <Kpi label="Average sale price" value={avg.available ? formatMoney(avg.value) : 'Not available'} footer={<Sub>{avg.available ? 'Contracted units' : `Not available · ${avg.reason}`}</Sub>} />
        <Kpi label="Sales progress" value={progress.available ? formatPercent(progress.value) : 'Not available'} footer={<Sub>{SALES_STATUSES.filter((status) => summary.byStatus[status] > 0).map((status) => `${summary.byStatus[status]} ${SALES_STATUS_LABELS[status].toLowerCase()}`).join(' · ')}</Sub>} />
        <Kpi label="Deposits in trust" help="Restricted cash: funds the project only once a permitted release is recorded" value={formatMoney(summary.heldDeposits)} footer={<Sub>Released {formatMoney(summary.releasedDeposits)}</Sub>} />
      </KpiGrid>

      <Toolbar>
        <FilterGroup
          label="Filter units by revenue group"
          options={[{ value: 'all', label: 'All', count: units.length }, ...unitGroups.map((row) => ({ value: row.id, label: row.name, count: units.filter((unit) => unit.unit.groupId === row.id).length }))]}
          value={group}
          onChange={setGroup}
        />
        {permissions.canEdit ? (
          <Row>
            <Button onClick={() => setSide('bulk')} aria-pressed={side === 'bulk'}>Bulk price change</Button>
            <Button variant="primary" onClick={() => { setSide('create'); setSelectedId(null); }}>+ Add unit</Button>
          </Row>
        ) : null}
      </Toolbar>

      <Grid columns={2}>
        <Card>
          <CardHeader title="Unit register" aside={<Sub>Areas in m² · prices gross incl. GST</Sub>} />
          <DataTable
            columns={columns}
            rows={rows}
            rowKey={(row) => row.unit.id}
            onRowClick={(row) => { setSelectedId(row.unit.id); setSide('unit'); }}
            isRowSelected={(row) => row.unit.id === selectedId}
            rowStyle={(row) => (row.unit.id === selectedId ? { background: 'var(--gold-soft)' } : undefined)}
            empty="No units yet."
          />
        </Card>

        {side === 'bulk' && permissions.canEdit ? (
          <BulkPriceForm projectId={project.id} groups={unitGroups} onClose={() => setSide('unit')} />
        ) : side === 'create' && permissions.canEdit ? (
          <Card>
            <CardHeader title="Add a unit" aside={<Sub>Code unique within the project · areas and prices never negative</Sub>} />
            <CardBody>
              <ActionForm action={createUnitAction} submitLabel="Add unit" hiddenFields={{ projectId: project.id, revision: String(project.modelRevision) }} onCancel={() => setSide('unit')} onSuccess={() => setSide('unit')}>
                {({ fieldErrors }) => <UnitFields fieldErrors={fieldErrors} groups={groups} milestones={milestones} />}
              </ActionForm>
            </CardBody>
          </Card>
        ) : selected ? (
          <UnitPanel
            key={selected.unit.id}
            projectId={project.id}
            revision={project.modelRevision}
            row={selected}
            groups={groups}
            milestones={milestones}
            canEdit={permissions.canEdit}
            canSeePurchaser={permissions.canSeePurchaser}
            today={today}
          />
        ) : (
          <Card>
            <CardHeader title="Select a unit" />
            <CardBody>
              <Sub>Choose a unit to see its areas, pricing basis and contract{permissions.canEdit ? ', or to record a contract, deposit or release' : ''}.</Sub>
            </CardBody>
          </Card>
        )}
      </Grid>

      <Grid columns={2}>
        <Card>
          <CardHeader title="Other income" aside={<Sub>Recurring lines are dated the 15th of each month</Sub>} />
          <CardBody className="stack">
            {otherIncome.length === 0 ? <Sub>No other income.</Sub> : (
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
                {otherIncome.map((line) => (
                  <li key={line.id}>
                    <b>{line.description}</b> · {TAX_TREATMENT_LABELS[line.taxTreatment]} ·{' '}
                    {line.mode === 'recurring'
                      ? `${formatMoney(line.monthlyAmount)}/month ${line.startDate ? formatDateShort(line.startDate) : ''} → ${line.endDate ? formatDateLong(line.endDate) : ''}`
                      : `${formatMoney(line.amount)} on ${line.date ? formatDateLong(line.date) : '—'}`}
                  </li>
                ))}
              </ul>
            )}
            {permissions.canEdit ? (
              <ActionForm action={createOtherIncomeAction} submitLabel="Add income line" hiddenFields={{ projectId: project.id }}>
                {({ fieldErrors }) => (
                  <FieldGrid>
                    <TextField id="oi-desc" name="description" label="Description" invalid={Boolean(firstError(fieldErrors, 'description'))} hint={firstError(fieldErrors, 'description')} />
                    <SelectField id="oi-group" name="groupId" label="Revenue group" defaultValue={groups.find((row) => row.code === 'OTH')?.id ?? groups[0]?.id} options={groups.map((row) => ({ value: row.id, label: row.name }))} />
                    <SelectField id="oi-tax" name="taxTreatment" label="Tax treatment" defaultValue="standard-gst" options={TAX_TREATMENTS.map((value) => ({ value, label: TAX_TREATMENT_LABELS[value] }))} />
                    <SelectField id="oi-mode" name="mode" label="Timing" defaultValue="one-off" options={[{ value: 'one-off', label: 'One-off · dated' }, { value: 'recurring', label: 'Recurring · monthly' }]} />
                    <TextField id="oi-date" name="date" label="Date (one-off)" type="date" invalid={Boolean(firstError(fieldErrors, 'date'))} hint={firstError(fieldErrors, 'date')} />
                    <TextField id="oi-amount" name="amount" label="Amount (one-off, gross)" inputMode="decimal" invalid={Boolean(firstError(fieldErrors, 'amount'))} hint={firstError(fieldErrors, 'amount')} />
                    <TextField id="oi-start" name="startDate" label="Start (recurring)" type="date" invalid={Boolean(firstError(fieldErrors, 'startDate'))} hint={firstError(fieldErrors, 'startDate')} />
                    <TextField id="oi-end" name="endDate" label="End (recurring)" type="date" invalid={Boolean(firstError(fieldErrors, 'endDate'))} hint={firstError(fieldErrors, 'endDate')} />
                    <TextField id="oi-monthly" name="monthlyAmount" label="Monthly amount (gross)" inputMode="decimal" invalid={Boolean(firstError(fieldErrors, 'monthlyAmount'))} hint={firstError(fieldErrors, 'monthlyAmount')} />
                  </FieldGrid>
                )}
              </ActionForm>
            ) : null}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Commission" aside={<Sub>One cost obligation per contract · cost line COMM-01</Sub>} />
          <CardBody className="stack">
            <Sub>
              {commissionRule
                ? `${commissionRule.basis === 'rate' ? `${formatPpmAsPercent(commissionRule.ratePpm ?? 0)} of consideration` : formatMoney(commissionRule.amount)} · due at ${commissionRule.trigger} · on cancellation ${commissionRule.cancellationTreatment === 'reverse' ? 'reversed' : 'retained'}`
                : 'No commission rule.'}
            </Sub>
            {commissions.length > 0 ? (
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
                {commissions.map((row) => (
                  <li key={row.contractId}>
                    <b>{row.unitCode}</b> · {formatMoney(row.amount)} · {row.basis === 'actual' ? 'due' : 'forecast'} {formatDateLong(row.triggerDate)}
                  </li>
                ))}
              </ul>
            ) : null}
            {permissions.canEdit ? (
              <ActionForm action={setCommissionRuleAction} submitLabel="Save rule" hiddenFields={{ projectId: project.id }}>
                {({ fieldErrors }) => (
                  <FieldGrid>
                    <SelectField id="cr-basis" name="basis" label="Basis" defaultValue={commissionRule?.basis ?? 'rate'} options={[{ value: 'rate', label: 'Rate of consideration' }, { value: 'amount', label: 'Fixed amount per contract' }]} />
                    <TextField id="cr-rate" name="rate" label="Rate (%)" inputMode="decimal" defaultValue={commissionRule?.ratePpm !== undefined ? formatPpmAsPercent(commissionRule.ratePpm).replace('%', '') : ''} invalid={Boolean(firstError(fieldErrors, 'rate'))} hint={firstError(fieldErrors, 'rate')} />
                    <TextField id="cr-amount" name="amount" label="Amount" inputMode="decimal" defaultValue={commissionRule?.amount ? (commissionRule.amount.cents / 100).toFixed(2) : ''} invalid={Boolean(firstError(fieldErrors, 'amount'))} hint={firstError(fieldErrors, 'amount')} />
                    <SelectField id="cr-trigger" name="trigger" label="Falls due at" defaultValue={commissionRule?.trigger ?? 'settlement'} options={COMMISSION_TRIGGERS.map((value) => ({ value, label: value }))} />
                    <SelectField id="cr-cancel" name="cancellationTreatment" label="On cancellation" defaultValue={commissionRule?.cancellationTreatment ?? 'reverse'} options={CANCELLATION_TREATMENTS.map((value) => ({ value, label: value === 'reverse' ? 'Reverse' : 'Retain if already due' }))} />
                  </FieldGrid>
                )}
              </ActionForm>
            ) : null}
          </CardBody>
        </Card>
      </Grid>
      <Sub style={{ fontSize: 12 }}>
        Saleable area follows each unit&apos;s basis ({SALEABLE_AREA_BASIS_LABELS.internal.toLowerCase()} or {SALEABLE_AREA_BASIS_LABELS['internal-plus-external'].toLowerCase()}). Purchaser GST withholding is a credit against the GST liability, not an expense (CAL12).
      </Sub>
    </Stack>
  );
}
