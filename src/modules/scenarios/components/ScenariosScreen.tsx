'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ActionForm, firstError } from '@/shared/components/ActionForm';
import { Banner } from '@/shared/components/Banner';
import { Button } from '@/shared/components/Button';
import { Card, CardBody, CardHeader } from '@/shared/components/Card';
import { Chip } from '@/shared/components/Chip';
import { DataTable, CellMain, CellSub, type DataTableColumn } from '@/shared/components/DataTable';
import { FieldGrid, SelectField, TextField } from '@/shared/components/Field';
import { Row, Stack, Sub, Toolbar } from '@/shared/components/Layout';
import { formatMoney, money } from '@/shared/lib/money';
import type { ActionResult } from '@/shared/lib/action-result';
import { archiveScenarioAction, createScenarioAction, publishScenarioAction, refreshScenarioAction, sensitivityAction } from '../actions';
import {
  COMPARISON_LABELS,
  COMPARISON_METRICS,
  HIGHER_IS_BETTER,
  METRIC_KIND,
  SCENARIO_STATE_LABELS,
  SENSITIVITY_DRIVER_LABELS,
  type ComparisonColumn,
  type ComparisonMetric,
  type MetricValue,
  type ScenarioState,
  type SensitivityDriver,
  type SensitivityMatrix,
} from '../model';

export interface ScenarioRow {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly state: ScenarioState;
  readonly assumptions: readonly string[];
  readonly version: number;
  readonly baseRevision: number;
  readonly actualsCutoff: string;
  readonly stale: boolean;
  readonly history: readonly string[];
  readonly publishPreview: { readonly changes: readonly string[]; readonly notPromoted: readonly string[] };
  readonly publishedChanges: readonly string[];
}

export interface ScenariosScreenProps {
  readonly projectId: string;
  readonly scenarios: readonly ScenarioRow[];
  readonly comparison: readonly ComparisonColumn[];
  readonly selectedIds: readonly string[];
  readonly categories: readonly { readonly id: string; readonly name: string }[];
  readonly facilities: readonly { readonly id: string; readonly name: string; readonly rateLabel: string }[];
  readonly permissions: { readonly canEdit: boolean; readonly canPublish: boolean };
  readonly currentRevision: number;
}

function formatValue(metric: ComparisonMetric, value: MetricValue): string {
  if (value.value === null) return value.unavailableReason ?? 'Not available';
  switch (METRIC_KIND[metric]) {
    case 'money':
      return formatMoney(money(value.value as number));
    case 'ratio':
      return `${((value.value as number) * 100).toFixed(2)}%`;
    case 'date':
      return String(value.value);
  }
}

function formatVariance(metric: ComparisonMetric, delta: number | null): { text: string; tone: 'good' | 'bad' | 'neutral' } {
  if (delta === null) return { text: 'Not comparable', tone: 'neutral' };
  if (delta === 0) return { text: 'No change', tone: 'neutral' };
  const better = HIGHER_IS_BETTER[metric];
  const favourable = better === null ? null : better ? delta > 0 : delta < 0;
  const arrow = delta > 0 ? '▲' : '▼';
  const words = favourable === null ? '' : favourable ? ' favourable' : ' adverse';
  switch (METRIC_KIND[metric]) {
    case 'money':
      return { text: `${delta > 0 ? '+' : '−'}${formatMoney(money(Math.abs(delta)))} ${arrow}${words}`, tone: favourable ? 'good' : 'bad' };
    case 'ratio':
      return { text: `${delta > 0 ? '+' : '−'}${Math.abs(delta).toFixed(2)} pp ${arrow}${words}`, tone: favourable ? 'good' : 'bad' };
    case 'date':
      return { text: `${delta > 0 ? '+' : '−'}${Math.abs(delta)} days ${arrow}${words}`, tone: favourable ? 'good' : 'bad' };
  }
}

/** SCN01–SCN06 — scenarios, comparison, sensitivity and publication. */
export function ScenariosScreen({ projectId, scenarios, comparison, selectedIds, categories, facilities, permissions, currentRevision }: ScenariosScreenProps) {
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<string | null>(scenarios[0]?.id ?? null);
  const [matrix, setMatrix] = useState<SensitivityMatrix | null>(null);
  const base = `/projects/${encodeURIComponent(projectId)}/scenarios`;
  const scenario = scenarios.find((row) => row.id === selected) ?? null;

  const columns: readonly DataTableColumn<ScenarioRow>[] = [
    {
      header: 'Scenario',
      lead: true,
      render: (row) => (
        <>
          <CellMain>{row.name}</CellMain>
          <CellSub>{row.assumptions.join(' · ')}</CellSub>
        </>
      ),
    },
    {
      header: 'State',
      render: (row) => (
        <Chip tone={row.state === 'published' ? 'good' : row.state === 'archived' ? 'neutral' : 'info'} icon={row.state === 'published' ? 'i-check' : row.state === 'archived' ? 'i-x' : 'i-clock'}>
          {SCENARIO_STATE_LABELS[row.state]}
        </Chip>
      ),
    },
    { header: 'Version', align: 'right', render: (row) => <span className="num">v{row.version}</span> },
    {
      header: 'Base',
      render: (row) =>
        row.stale ? (
          <Chip tone="warn" icon="i-alert">Stale · model rev {currentRevision}, base rev {row.baseRevision}</Chip>
        ) : (
          <Chip tone="neutral">Rev {row.baseRevision} · actuals to {row.actualsCutoff}</Chip>
        ),
    },
    {
      header: 'Compare',
      render: (row) => {
        const on = selectedIds.includes(row.id);
        const next = on ? selectedIds.filter((id) => id !== row.id) : [...selectedIds, row.id].slice(-3);
        return (
          <Link className="btn sm" href={next.length ? `${base}?compare=${next.join(',')}` : base} aria-pressed={on}>
            {on ? 'Remove from comparison' : 'Compare'}
          </Link>
        );
      },
    },
  ];

  return (
    <Stack>
      <Toolbar>
        <Sub>Scenarios are isolated: they change forecasts only and never rewrite recorded actuals (SCN01).</Sub>
        {permissions.canEdit ? (
          <Button variant="primary" onClick={() => setCreating(true)}>
            + New scenario
          </Button>
        ) : null}
      </Toolbar>

      {creating ? (
        <Card>
          <CardHeader title="New scenario" aside={<Sub>Pinned to the current model when created</Sub>} />
          <CardBody>
            <ActionForm action={createScenarioAction} submitLabel="Create scenario" hiddenFields={{ projectId }} onCancel={() => setCreating(false)} onSuccess={() => setCreating(false)}>
              {({ fieldErrors }) => (
                <FieldGrid>
                  <TextField id="sc-name" name="name" label="Name" required invalid={Boolean(firstError(fieldErrors, 'name'))} hint={firstError(fieldErrors, 'name')} />
                  <TextField id="sc-desc" name="description" label="Description" />
                  <TextField id="sc-price" name="unsoldPricePercent" label="Unsold price change (%)" placeholder="-5" hint={firstError(fieldErrors, 'unsoldPricePercent') ?? 'Uncontracted units only; signed contracts stay fixed'} invalid={Boolean(firstError(fieldErrors, 'unsoldPricePercent'))} />
                  <TextField id="sc-cost" name="costPercent" label="Remaining cost change (%)" placeholder="8" hint={firstError(fieldErrors, 'costPercent') ?? 'Uncommitted forecast; paid costs are excluded'} invalid={Boolean(firstError(fieldErrors, 'costPercent'))} />
                  <SelectField id="sc-cat" name="costCategoryIds" label="Cost change applies to" options={[{ value: '', label: 'All categories' }, ...categories.map((c) => ({ value: c.id, label: c.name }))]} />
                  <SelectField id="sc-unbilled" name="includeUnbilledCommitments" label="Also unbilled commitments" options={[{ value: '', label: 'No — uncommitted forecast only' }, { value: 'on', label: 'Yes — include unbilled contract balances' }]} />
                  <TextField id="sc-shift" name="programmeShiftDays" label="Programme shift (days)" type="number" placeholder="90" />
                  <TextField id="sc-lag" name="settlementLagMonths" label="GST settlement lag (months)" type="number" min={0} max={6} />
                  <TextField id="sc-tax" name="taxRatePercent" label="GST rate (%)" placeholder="10" />
                  {facilities.map((facility) => (
                    <TextField key={facility.id} id={`sc-rate-${facility.id}`} name={`rate:${facility.id}`} label={`${facility.name} rate (%)`} placeholder={facility.rateLabel} hint={`Currently ${facility.rateLabel} · enter 9.25 for 9.25%`} />
                  ))}
                </FieldGrid>
              )}
            </ActionForm>
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardHeader title="Scenarios" aside={<Sub>Select up to three to compare with the current model</Sub>} />
        <DataTable
          columns={columns}
          rows={scenarios}
          rowKey={(row) => row.id}
          onRowClick={(row) => setSelected(row.id)}
          isRowSelected={(row) => row.id === selected}
          rowStyle={(row) => (row.id === selected ? { background: 'var(--gold-soft)' } : undefined)}
          empty="No scenarios yet."
        />
      </Card>

      <Card>
        <CardHeader title="Comparison" aside={<Sub>Money variance is scenario minus current; percentages compare in percentage points (SCN03)</Sub>} />
        <div className="tbl-wrap">
          <table>
            <thead>
              <tr>
                <th>Metric</th>
                {comparison.map((column) => (
                  <th key={column.key} className="r">
                    {column.label}
                    {column.stale ? ' · stale' : ''}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {COMPARISON_METRICS.map((metric) => (
                <tr key={metric}>
                  <td>{COMPARISON_LABELS[metric]}</td>
                  {comparison.map((column) => {
                    const delta = column.variances ? formatVariance(metric, column.variances[metric]) : null;
                    return (
                      <td key={column.key} className="r">
                        <span className="num">{formatValue(metric, column.values[metric])}</span>
                        {delta ? (
                          <span className="tcell-sub" style={{ color: delta.tone === 'good' ? 'var(--good)' : delta.tone === 'bad' ? 'var(--bad)' : undefined }}>
                            {delta.text}
                          </span>
                        ) : null}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {scenario ? (
        <Card>
          <CardHeader title={`${scenario.name} · v${scenario.version}`} aside={<Chip tone="neutral">{SCENARIO_STATE_LABELS[scenario.state]}</Chip>} />
          <CardBody className="stack">
            <Sub>{scenario.description || 'No description.'}</Sub>
            {scenario.stale ? (
              <Banner tone="warn" title="The model has moved on since this scenario's base">
                Refresh to pull in the latest actuals and changes as a new version before publishing (SCN04, SCN05).
              </Banner>
            ) : null}
            <div>
              <b>History</b>
              <ul className="list">
                {scenario.history.map((line, index) => (
                  <li key={index}><div className="li-main"><span style={{ whiteSpace: 'normal' }}>{line}</span></div></li>
                ))}
              </ul>
            </div>
            {scenario.state === 'draft' ? (
              <>
                <div>
                  <b>Publishing would change</b>
                  <ul className="list">
                    {scenario.publishPreview.changes.length === 0 ? <li><div className="li-main"><span>Nothing — the scenario has no promotable assumptions.</span></div></li> : null}
                    {scenario.publishPreview.changes.map((line) => (
                      <li key={line}><div className="li-main"><span style={{ whiteSpace: 'normal' }}>{line}</span></div></li>
                    ))}
                    {scenario.publishPreview.notPromoted.map((line) => (
                      <li key={line}><Chip tone="warn" icon="i-alert">Not promoted</Chip><div className="li-main"><span style={{ whiteSpace: 'normal' }}>{line}</span></div></li>
                    ))}
                  </ul>
                </div>
                <Row>
                  {permissions.canEdit ? <ActionForm action={refreshScenarioAction} submitLabel="Refresh with latest actuals" render="inline" submitVariant="default" hiddenFields={{ scenarioId: scenario.id }} /> : null}
                </Row>
                {permissions.canPublish ? (
                  <ActionForm action={publishScenarioAction} submitLabel="Publish scenario" submitVariant="gold" hiddenFields={{ scenarioId: scenario.id }}>
                    {({ fieldErrors }) => (
                      <TextField id="sc-reason" name="reason" label="Reason for publishing" required invalid={Boolean(firstError(fieldErrors, 'reason'))} hint={firstError(fieldErrors, 'reason') ?? 'Promotes forecast assumptions only; payments, suppliers and approvals are untouched.'} />
                    )}
                  </ActionForm>
                ) : (
                  <Sub>Publishing needs publisher authority on this project.</Sub>
                )}
                {permissions.canEdit ? (
                  <ActionForm action={archiveScenarioAction} submitLabel="Archive" submitVariant="ghost" hiddenFields={{ scenarioId: scenario.id }}>
                    {() => <TextField id="sc-archive" name="reason" label="Reason for archiving" />}
                  </ActionForm>
                ) : null}
              </>
            ) : scenario.publishedChanges.length > 0 ? (
              <div>
                <b>Promoted when published</b>
                <ul className="list">
                  {scenario.publishedChanges.map((line) => (
                    <li key={line}><div className="li-main"><span style={{ whiteSpace: 'normal' }}>{line}</span></div></li>
                  ))}
                </ul>
              </div>
            ) : null}
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardHeader title="Sensitivity matrix" aside={<Sub>Profit on the same pinned base in every cell (SCN06)</Sub>} />
        <CardBody className="stack">
          <SensitivityForm projectId={projectId} scenarioId={scenario?.id ?? null} onResult={setMatrix} />
          {matrix ? <SensitivityTable matrix={matrix} /> : null}
        </CardBody>
      </Card>
    </Stack>
  );
}

const DRIVER_OPTIONS = (Object.keys(SENSITIVITY_DRIVER_LABELS) as SensitivityDriver[]).map((value) => ({ value, label: SENSITIVITY_DRIVER_LABELS[value] }));

function SensitivityForm({ projectId, scenarioId, onResult }: { readonly projectId: string; readonly scenarioId: string | null; readonly onResult: (matrix: SensitivityMatrix) => void }) {
  const action = async (previous: ActionResult<unknown>, form: FormData): Promise<ActionResult<unknown>> => {
    const result = await sensitivityAction(previous, form);
    if (result.ok && result.value) onResult(result.value as SensitivityMatrix);
    return result;
  };
  return (
    <ActionForm action={action} submitLabel="Calculate matrix" submitVariant="default" hiddenFields={{ projectId, ...(scenarioId ? { scenarioId } : {}) }}>
      {() => (
        <FieldGrid>
          <SelectField id="sx-rd" name="rowDriver" label="Rows" defaultValue="unsold-price" options={DRIVER_OPTIONS} />
          <Row>
            <TextField id="sx-rf" name="rowFrom" label="From" defaultValue="-10" />
            <TextField id="sx-rt" name="rowTo" label="To" defaultValue="10" />
            <TextField id="sx-rs" name="rowStep" label="Step" defaultValue="5" />
          </Row>
          <SelectField id="sx-cd" name="colDriver" label="Columns" defaultValue="uncommitted-construction" options={DRIVER_OPTIONS} />
          <Row>
            <TextField id="sx-cf" name="colFrom" label="From" defaultValue="-5" />
            <TextField id="sx-ct" name="colTo" label="To" defaultValue="15" />
            <TextField id="sx-cs" name="colStep" label="Step" defaultValue="5" />
          </Row>
        </FieldGrid>
      )}
    </ActionForm>
  );
}

function SensitivityTable({ matrix }: { readonly matrix: SensitivityMatrix }) {
  return (
    <div className="tbl-wrap">
      <table className="matrix">
        <caption className="sr">Profit by {SENSITIVITY_DRIVER_LABELS[matrix.rows.driver]} and {SENSITIVITY_DRIVER_LABELS[matrix.columns.driver]}</caption>
        <thead>
          <tr>
            <th>{SENSITIVITY_DRIVER_LABELS[matrix.rows.driver]} ↓ / {SENSITIVITY_DRIVER_LABELS[matrix.columns.driver]} →</th>
            {matrix.columnValues.map((value) => (
              <th key={value} className="r">{value}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {matrix.rowValues.map((rowValue, r) => (
            <tr key={rowValue}>
              <th scope="row">{rowValue}</th>
              {matrix.columnValues.map((columnValue, c) => {
                const profit = matrix.profit[r]?.[c] ?? 0;
                const margin = matrix.marginOnCost[r]?.[c] ?? null;
                const isBase = rowValue === 0 && columnValue === 0;
                return (
                  <td key={columnValue} className={['r', profit < matrix.baseProfitCents ? 'neg' : profit > matrix.baseProfitCents ? 'pos' : '', isBase ? 'base' : ''].filter(Boolean).join(' ')}>
                    <span className="num">{formatMoney(money(profit))}</span>
                    <span className="tcell-sub">{margin === null ? 'MoC n/a' : `MoC ${(margin * 100).toFixed(1)}%`}{isBase ? ' · base' : ''}</span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <Sub style={{ fontSize: 12 }}>Green cells beat the base profit of {formatMoney(money(matrix.baseProfitCents))}; red cells fall short. The outlined cell is the base.</Sub>
    </div>
  );
}
