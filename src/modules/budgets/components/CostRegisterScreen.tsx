'use client';

import { useState } from 'react';
import { ActionForm, firstError } from '@/shared/components/ActionForm';
import { Banner } from '@/shared/components/Banner';
import { Button } from '@/shared/components/Button';
import { Card, CardBody, CardHeader } from '@/shared/components/Card';
import { Chip } from '@/shared/components/Chip';
import { DataTable, CellMain, CellSub, Num, type DataTableColumn } from '@/shared/components/DataTable';
import { FieldGrid, TextField } from '@/shared/components/Field';
import { Kpi, KpiGrid } from '@/shared/components/Kpi';
import { Row, Stack, Sub } from '@/shared/components/Layout';
import { formatMoney, type Money } from '@/shared/lib/money';
import { formatDateLong } from '@/shared/lib/dates';
import { createBaselineAction, createCategoryAction, publishBaselineAction, undoBatchAction } from '../actions';
import { ADJUSTMENT_KIND_LABELS, varianceWords, type AdjustmentKind, type BudgetVersionState } from '../model';
import { BaselineStateChip, VarianceChip } from './BudgetChips';

export interface CategorySummaryRow {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly lineCount: number;
  readonly inactiveCount: number;
  readonly current: Money;
  readonly baseline: Money | null;
}

export interface BaselineRow {
  readonly id: string;
  readonly name: string;
  readonly state: BudgetVersionState;
  readonly total: Money;
  readonly createdAt: string;
  readonly createdByName: string;
  readonly approvedByName: string | null;
  readonly approvedAt: string | null;
  readonly reason: string | null;
  readonly sourceRevision: number;
}

export interface AdjustmentRow {
  readonly id: string;
  readonly kind: AdjustmentKind;
  readonly fromCode: string | null;
  readonly toCode: string | null;
  readonly amount: Money;
  readonly reason: string;
  readonly actorName: string;
  readonly at: string;
  readonly revision: number;
}

export interface BatchRow {
  readonly id: string;
  readonly actorName: string;
  readonly at: string;
  readonly revisionBefore: number;
  readonly revisionAfter: number;
  readonly summary: string;
  readonly compensates: boolean;
  readonly undone: boolean;
}

export interface CostRegisterScreenProps {
  readonly projectId: string;
  readonly revision: number;
  readonly kpis: {
    readonly postingLines: number;
    readonly inactiveLines: number;
    readonly categories: number;
    readonly totalCurrent: Money;
    readonly baselineName: string | null;
    readonly baselineTotal: Money | null;
  };
  readonly categories: readonly CategorySummaryRow[];
  readonly baselines: readonly BaselineRow[];
  readonly adjustments: readonly AdjustmentRow[];
  readonly batches: readonly BatchRow[];
  readonly undo: { readonly allowed: boolean; readonly reason: string | null };
  readonly permissions: { readonly canEdit: boolean; readonly canPublish: boolean };
}

/** CST01, CST08, PRJ05, CF07, CF09 — the project cost register. Every amount is ex GST. */
export function CostRegisterScreen({ projectId, revision, kpis, categories, baselines, adjustments, batches, undo, permissions }: CostRegisterScreenProps) {
  const [addingCategory, setAddingCategory] = useState(false);
  const [publishing, setPublishing] = useState<string | null>(null);
  const variance = varianceWords(kpis.totalCurrent, kpis.baselineTotal);

  const categoryColumns: readonly DataTableColumn<CategorySummaryRow>[] = [
    {
      header: 'Category',
      lead: true,
      render: (row) => (
        <>
          <CellMain>
            <a href={`/projects/${encodeURIComponent(projectId)}/costs/${encodeURIComponent(row.id)}`}>{row.code} · {row.name}</a>
          </CellMain>
          {row.inactiveCount > 0 ? <CellSub>Includes {row.inactiveCount} closed line{row.inactiveCount === 1 ? '' : 's'}</CellSub> : null}
        </>
      ),
    },
    { header: 'Lines', align: 'right', render: (row) => <Num>{row.lineCount}</Num> },
    { header: 'Current budget (ex GST)', mobileLabel: 'Current', align: 'right', render: (row) => <Num>{formatMoney(row.current)}</Num> },
    { header: 'Baseline (ex GST)', mobileLabel: 'Baseline', align: 'right', render: (row) => <Num>{row.baseline ? formatMoney(row.baseline) : '—'}</Num> },
    { header: 'Variance', render: (row) => <VarianceChip current={row.current} baseline={row.baseline} /> },
  ];

  const baselineColumns: readonly DataTableColumn<BaselineRow>[] = [
    {
      header: 'Baseline',
      lead: true,
      render: (row) => (
        <>
          <CellMain>{row.name}</CellMain>
          <CellSub>
            {row.approvedAt
              ? `Approved by ${row.approvedByName ?? 'unknown'} · ${formatDateLong(row.approvedAt.slice(0, 10))}${row.reason ? ` · ${row.reason}` : ''}`
              : `Candidate by ${row.createdByName} · ${formatDateLong(row.createdAt.slice(0, 10))}`}
          </CellSub>
        </>
      ),
    },
    { header: 'State', render: (row) => <BaselineStateChip state={row.state} /> },
    { header: 'Total (ex GST)', mobileLabel: 'Total', align: 'right', render: (row) => <Num>{formatMoney(row.total)}</Num> },
    { header: 'From revision', align: 'right', render: (row) => <Num>{row.sourceRevision}</Num> },
    {
      header: 'Actions',
      render: (row) =>
        row.state === 'draft' && permissions.canPublish ? (
          <Button small variant="gold" onClick={() => setPublishing(row.id)}>Publish</Button>
        ) : (
          '—'
        ),
    },
  ];

  const adjustmentColumns: readonly DataTableColumn<AdjustmentRow>[] = [
    {
      header: 'Adjustment',
      lead: true,
      render: (row) => (
        <>
          <CellMain>{ADJUSTMENT_KIND_LABELS[row.kind]} · {[row.fromCode, row.toCode].filter(Boolean).join(' → ')}</CellMain>
          <CellSub>{row.reason}</CellSub>
        </>
      ),
    },
    {
      header: 'Effect on total',
      render: (row) =>
        row.fromCode && row.toCode ? (
          <Chip tone="neutral" icon="i-link">Paired · total unchanged</Chip>
        ) : row.toCode ? (
          <Chip tone="warn" icon="i-up">Increases total</Chip>
        ) : (
          <Chip tone="info" icon="i-down">Decreases total</Chip>
        ),
    },
    { header: 'Amount (ex GST)', mobileLabel: 'Amount', align: 'right', render: (row) => <Num>{formatMoney(row.amount, { showCents: true })}</Num> },
    { header: 'By', render: (row) => `${row.actorName} · ${formatDateLong(row.at.slice(0, 10))} · rev ${row.revision}` },
  ];

  const batchColumns: readonly DataTableColumn<BatchRow>[] = [
    {
      header: 'Batch',
      lead: true,
      render: (row) => (
        <>
          <CellMain>{row.summary}</CellMain>
          <CellSub>{row.actorName} · {formatDateLong(row.at.slice(0, 10))}</CellSub>
        </>
      ),
    },
    { header: 'Revision', render: (row) => `${row.revisionBefore} → ${row.revisionAfter}` },
    {
      header: 'Status',
      render: (row) =>
        row.compensates ? (
          <Chip tone="info" icon="i-clock">Undo · compensating</Chip>
        ) : row.undone ? (
          <Chip tone="neutral" icon="i-x">Undone · kept in history</Chip>
        ) : (
          <Chip tone="neutral" icon="i-check">Saved</Chip>
        ),
    },
  ];

  const publishingRow = baselines.find((row) => row.id === publishing) ?? null;

  return (
    <Stack>
      <KpiGrid>
        <Kpi label="Posting lines" value={kpis.postingLines} valueSuffix={kpis.inactiveLines > 0 ? `incl. ${kpis.inactiveLines} closed` : undefined} footer={<Sub>Summary rows are not added (F02)</Sub>} />
        <Kpi label="Categories" value={kpis.categories} />
        <Kpi label="Current budget" help="Original budgets plus adjustments, posting lines only, ex GST" value={formatMoney(kpis.totalCurrent)} valueSuffix="ex GST" accent />
        <Kpi
          label={kpis.baselineName ? `Baseline · ${kpis.baselineName}` : 'Baseline'}
          value={kpis.baselineTotal ? formatMoney(kpis.baselineTotal) : 'None published'}
          valueSuffix={kpis.baselineTotal ? 'ex GST' : undefined}
          footer={<VarianceChip current={kpis.totalCurrent} baseline={kpis.baselineTotal} />}
          help={variance.adverse ? 'Current budget is above the selected baseline — adverse for a cost.' : 'Current budget compared with the selected baseline.'}
        />
      </KpiGrid>

      <Card>
        <CardHeader
          title="Categories"
          aside={permissions.canEdit ? <Button small onClick={() => setAddingCategory(true)}>+ Category</Button> : <Sub>Model revision {revision}</Sub>}
        />
        {addingCategory ? (
          <CardBody>
            <ActionForm action={createCategoryAction} submitLabel="Add category" hiddenFields={{ projectId }} onCancel={() => setAddingCategory(false)} onSuccess={() => setAddingCategory(false)}>
              {({ fieldErrors }) => (
                <FieldGrid>
                  <TextField id="cat-code" name="code" label="Code" placeholder="LAND" required invalid={Boolean(firstError(fieldErrors, 'code'))} hint={firstError(fieldErrors, 'code') ?? '2–10 letters or digits'} />
                  <TextField id="cat-name" name="name" label="Name" placeholder="Land subdivision" required invalid={Boolean(firstError(fieldErrors, 'name'))} hint={firstError(fieldErrors, 'name')} />
                </FieldGrid>
              )}
            </ActionForm>
          </CardBody>
        ) : null}
        <DataTable columns={categoryColumns} rows={categories} rowKey={(row) => row.id} empty="No categories yet." />
      </Card>

      <Card>
        <CardHeader
          title="Baselines"
          aside={<Sub>Superseded baselines stay readable; publishing never edits an earlier one (PRJ05)</Sub>}
        />
        <DataTable columns={baselineColumns} rows={baselines} rowKey={(row) => row.id} empty="No baselines yet." />
        {permissions.canEdit || publishingRow ? (
          <CardBody className="stack">
            {publishingRow ? (
              <ActionForm
                action={publishBaselineAction}
                submitLabel={`Publish ${publishingRow.name}`}
                submitVariant="gold"
                hiddenFields={{ projectId, baselineId: publishingRow.id }}
                onCancel={() => setPublishing(null)}
                onSuccess={() => setPublishing(null)}
                footnote={<Sub style={{ fontSize: 12 }}>Publishing re-snapshots every posting line at the current revision, records you as approver, and marks the current baseline superseded.</Sub>}
              >
                {({ fieldErrors }) => (
                  <TextField id="bl-reason" name="reason" label="Reason" required placeholder="Post-variation rebaseline" invalid={Boolean(firstError(fieldErrors, 'reason'))} hint={firstError(fieldErrors, 'reason')} />
                )}
              </ActionForm>
            ) : null}
            {permissions.canEdit && !publishingRow ? (
              <ActionForm action={createBaselineAction} submitLabel="Create baseline candidate" submitVariant="default" hiddenFields={{ projectId }}>
                {({ fieldErrors }) => (
                  <TextField id="bl-name" name="name" label="Candidate name" required placeholder={`Baseline ${baselines.length + 1} · …`} invalid={Boolean(firstError(fieldErrors, 'name'))} hint={firstError(fieldErrors, 'name') ?? 'Snapshots every posting line’s current budget'} />
                )}
              </ActionForm>
            ) : null}
          </CardBody>
        ) : null}
      </Card>

      <Card>
        <CardHeader title="Budget adjustments" aside={<Sub>Corrections append; nothing here is edited or deleted</Sub>} />
        <DataTable columns={adjustmentColumns} rows={[...adjustments].reverse()} rowKey={(row) => row.id} empty="No adjustments yet." />
      </Card>

      <Card>
        <CardHeader
          title="Forecast batches"
          aside={
            permissions.canEdit ? (
              <Row>
                {undo.allowed ? (
                  <ActionForm action={undoBatchAction} submitLabel="Undo my latest batch" render="inline" submitVariant="default" hiddenFields={{ projectId }} />
                ) : null}
              </Row>
            ) : undefined
          }
        />
        {permissions.canEdit && !undo.allowed && undo.reason ? (
          <CardBody>
            <Banner tone="info" icon="i-clock" title="Undo is not available">
              {undo.reason} An undo creates a compensating batch; it never deletes an approval, payment or exported history (CF09).
            </Banner>
          </CardBody>
        ) : null}
        <DataTable columns={batchColumns} rows={[...batches].reverse()} rowKey={(row) => row.id} empty="No forecast batches yet." />
      </Card>
    </Stack>
  );
}
