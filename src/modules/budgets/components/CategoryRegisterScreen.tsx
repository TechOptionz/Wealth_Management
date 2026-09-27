'use client';

import { useMemo, useState } from 'react';
import { ActionForm, firstError } from '@/shared/components/ActionForm';
import { Banner } from '@/shared/components/Banner';
import { Button } from '@/shared/components/Button';
import { Card, CardBody, CardHeader } from '@/shared/components/Card';
import { Chip } from '@/shared/components/Chip';
import { DataTable, CellMain, CellSub, Num, type DataTableColumn } from '@/shared/components/DataTable';
import { FieldGrid, SelectField, TextAreaField, TextField } from '@/shared/components/Field';
import { FilterGroup } from '@/shared/components/FilterGroup';
import { Grid, Row, Stack, Stat, Sub, Toolbar } from '@/shared/components/Layout';
import { Timeline, type TimelineEntry } from '@/shared/components/Timeline';
import { formatPpmAsPercent, TAX_TREATMENT_LABELS, TAX_TREATMENTS } from '@/shared/finance-engine';
import { formatMoney, type Money } from '@/shared/lib/money';
import { formatDateLong } from '@/shared/lib/dates';
import {
  applyForecastBatchAction,
  createCostLineAction,
  deactivateCostLineAction,
  recordAdjustmentAction,
  updateCostLineAction,
} from '../actions';
import {
  ADJUSTMENT_KIND_LABELS,
  ADJUSTMENT_KINDS,
  FORECAST_METHOD_LABELS,
  FORECAST_METHODS,
  INPUT_MODE_LABELS,
  INPUT_MODES,
  type CostLine,
  type ForecastMethod,
  type InputMode,
} from '../model';
import { centsToInput, RowTypeChip, VarianceChip } from './BudgetChips';

export interface MilestoneOption {
  readonly id: string;
  readonly name: string;
  readonly plannedDate: string;
}

export interface NamedOption {
  readonly id: string;
  readonly name: string;
}

export interface LineRow {
  readonly line: CostLine;
  /** Ex GST, derived. */
  readonly current: Money;
  readonly baseline: Money | null;
  readonly parentCode: string | null;
  readonly responsibleName: string | null;
}

export interface ProjectLineOption {
  readonly id: string;
  readonly code: string;
  readonly title: string;
  readonly rowType: 'posting' | 'summary';
  readonly isContingency: boolean;
  readonly active: boolean;
}

export interface CategoryRegisterScreenProps {
  readonly projectId: string;
  readonly revision: number;
  readonly cutoff: string;
  readonly category: { readonly id: string; readonly code: string; readonly name: string };
  readonly categories: readonly { readonly id: string; readonly code: string; readonly name: string }[];
  readonly lines: readonly LineRow[];
  readonly projectLines: readonly ProjectLineOption[];
  readonly milestones: readonly MilestoneOption[];
  readonly people: readonly NamedOption[];
  readonly canEdit: boolean;
}

type Panel = 'detail' | 'new' | 'adjust' | 'batch';
type Show = 'all' | 'active';

const TAX_OPTIONS = TAX_TREATMENTS.filter((treatment) => treatment !== 'margin-scheme').map((treatment) => ({ value: treatment, label: TAX_TREATMENT_LABELS[treatment] }));
const METHOD_OPTIONS = FORECAST_METHODS.map((method) => ({ value: method, label: FORECAST_METHOD_LABELS[method] }));
const MODE_OPTIONS = INPUT_MODES.map((mode) => ({ value: mode, label: INPUT_MODE_LABELS[mode] }));

function percentOf(ppm: number): string {
  return formatPpmAsPercent(ppm, 4).replace('%', '');
}

/** CST02, CST08, CF03, CF04, CF07 — the lines of one category with their detail, edit and batch forms. */
export function CategoryRegisterScreen({ projectId, revision, cutoff, category, categories, lines, projectLines, milestones, people, canEdit }: CategoryRegisterScreenProps) {
  const [show, setShow] = useState<Show>('all');
  const [selectedId, setSelectedId] = useState<string | null>(lines.find((row) => row.line.rowType === 'posting')?.line.id ?? null);
  const [panel, setPanel] = useState<Panel>('detail');
  const inactive = lines.filter((row) => !row.line.active).length;
  const rows = show === 'active' ? lines.filter((row) => row.line.active) : lines;
  const selected = lines.find((row) => row.line.id === selectedId) ?? null;
  const milestoneName = (id: string | undefined): string => (id ? (milestones.find((entry) => entry.id === id)?.name ?? id) : '—');

  const columns: readonly DataTableColumn<LineRow>[] = [
    {
      header: 'Line',
      lead: true,
      render: (row) => (
        <>
          <CellMain>{row.parentCode ? '↳ ' : ''}{row.line.code} · {row.line.title}</CellMain>
          <CellSub>{row.line.isContingency ? 'Contingency allowance · ' : ''}{row.parentCode ? `Part of ${row.parentCode}` : (row.line.description ?? '')}</CellSub>
        </>
      ),
    },
    { header: 'Row', render: (row) => <RowTypeChip rowType={row.line.rowType} /> },
    { header: 'Input', render: (row) => (row.line.rowType === 'summary' ? '—' : INPUT_MODE_LABELS[row.line.inputMode]) },
    {
      header: 'Qty × rate',
      align: 'right',
      render: (row) => (row.line.inputMode === 'quantity-rate' && row.line.rate ? <Num>{row.line.quantity} {row.line.unit ?? ''} × {formatMoney(row.line.rate, { showCents: true })}</Num> : '—'),
    },
    { header: 'Original (ex GST)', mobileLabel: 'Original', align: 'right', render: (row) => <Num>{row.line.rowType === 'summary' ? '—' : formatMoney(row.line.originalBudget)}</Num> },
    { header: 'Current (ex GST)', mobileLabel: 'Current', align: 'right', render: (row) => <Num>{formatMoney(row.current)}{row.line.rowType === 'summary' ? ' · sum' : ''}</Num> },
    { header: 'Baseline (ex GST)', mobileLabel: 'Baseline', align: 'right', render: (row) => <Num>{row.baseline ? formatMoney(row.baseline) : '—'}</Num> },
    { header: 'Variance', render: (row) => <VarianceChip current={row.current} baseline={row.baseline} /> },
    { header: 'Method', render: (row) => (row.line.rowType === 'summary' ? '—' : FORECAST_METHOD_LABELS[row.line.forecastMethod]) },
    { header: 'Milestone', render: (row) => milestoneName(row.line.milestoneId) },
    { header: 'Active', render: (row) => (row.line.active ? <Chip tone="neutral" icon="i-check">Active</Chip> : <Chip tone="warn" icon="i-pause">Closed · still in totals</Chip>) },
  ];

  return (
    <Stack>
      <Toolbar>
        <FilterGroup
          label="Which lines to show"
          value={show}
          onChange={setShow}
          options={[
            { value: 'all', label: 'All lines', count: lines.length },
            { value: 'active', label: 'Active only', ...(inactive > 0 ? { count: lines.length - inactive } : {}) },
          ]}
        />
        {canEdit ? (
          <Row>
            <Button small onClick={() => setPanel('adjust')} aria-pressed={panel === 'adjust'}>Contingency draw / transfer</Button>
            <Button small onClick={() => setPanel('batch')} aria-pressed={panel === 'batch'}>Batch edit</Button>
            <Button small variant="primary" onClick={() => setPanel('new')} aria-pressed={panel === 'new'}>+ New line</Button>
          </Row>
        ) : null}
      </Toolbar>
      {show === 'active' && inactive > 0 ? (
        <Banner tone="info" title={`${inactive} closed line${inactive === 1 ? ' is' : 's are'} hidden from this list`}>
          Closed lines still count in category and project totals (CF03). Choose “All lines” to see them.
        </Banner>
      ) : null}

      <Grid columns={2}>
        <Card>
          <CardHeader title={`${category.code} · ${category.name}`} aside={<Sub>Amounts ex GST · revision {revision}</Sub>} />
          <DataTable
            columns={columns}
            rows={rows}
            rowKey={(row) => row.line.id}
            onRowClick={(row) => {
              setSelectedId(row.line.id);
              setPanel('detail');
            }}
            isRowSelected={(row) => row.line.id === selectedId}
            rowStyle={(row) => (row.line.id === selectedId ? { background: 'var(--surface-2)' } : undefined)}
            empty="No lines in this category yet."
          />
        </Card>

        {panel === 'new' && canEdit ? (
          <NewLineForm projectId={projectId} revision={revision} cutoff={cutoff} categoryId={category.id} projectLines={projectLines} milestones={milestones} people={people} onClose={() => setPanel('detail')} />
        ) : panel === 'adjust' && canEdit ? (
          <AdjustmentForm projectId={projectId} revision={revision} projectLines={projectLines} onClose={() => setPanel('detail')} />
        ) : panel === 'batch' && canEdit ? (
          <BatchEditForm projectId={projectId} revision={revision} projectLines={projectLines} onClose={() => setPanel('detail')} />
        ) : selected ? (
          <LineDetail
            key={selected.line.id}
            projectId={projectId}
            revision={revision}
            cutoff={cutoff}
            row={selected}
            categories={categories}
            projectLines={projectLines}
            milestones={milestones}
            people={people}
            canEdit={canEdit}
          />
        ) : (
          <Card>
            <CardBody>
              <Sub>Select a line to see its detail and history.</Sub>
            </CardBody>
          </Card>
        )}
      </Grid>
    </Stack>
  );
}

/* ---------- Budget and schedule inputs ---------- */

function BudgetInputs({ prefix, line, fieldErrors }: { readonly prefix: string; readonly line?: CostLine; readonly fieldErrors: Readonly<Record<string, readonly string[]>> }) {
  const [mode, setMode] = useState<InputMode>(line?.inputMode ?? 'direct');
  return (
    <>
      <SelectField id={`${prefix}-mode`} name="inputMode" label="Budget input" value={mode} onChange={(event) => setMode(event.target.value as InputMode)} options={MODE_OPTIONS} hint="Quantity × rate and a direct amount are mutually exclusive" />
      {mode === 'quantity-rate' ? (
        <>
          <TextField id={`${prefix}-qty`} name="quantity" label="Quantity" inputMode="decimal" defaultValue={line?.quantity ?? ''} invalid={Boolean(firstError(fieldErrors, 'quantity'))} hint={firstError(fieldErrors, 'quantity') ?? 'Up to four decimal places'} />
          <TextField id={`${prefix}-unit`} name="unit" label="Unit" defaultValue={line?.unit ?? ''} placeholder="each, m², hours" />
          <TextField id={`${prefix}-rate`} name="rate" label="Rate (ex GST)" inputMode="decimal" defaultValue={line?.rate ? centsToInput(line.rate.cents) : ''} invalid={Boolean(firstError(fieldErrors, 'rate'))} hint={firstError(fieldErrors, 'rate')} />
        </>
      ) : (
        <TextField
          id={`${prefix}-budget`} name="originalBudget" label="Original budget (ex GST)" inputMode="decimal"
          defaultValue={line ? centsToInput(line.originalBudget.cents) : ''} placeholder="1,860.00"
          invalid={Boolean(firstError(fieldErrors, 'originalBudget'))} hint={firstError(fieldErrors, 'originalBudget') ?? 'Adjustments are recorded separately'}
        />
      )}
    </>
  );
}

function ScheduleInputs({
  prefix,
  line,
  cutoff,
  milestones,
  fieldErrors,
}: {
  readonly prefix: string;
  readonly line?: CostLine;
  readonly cutoff: string;
  readonly milestones: readonly MilestoneOption[];
  readonly fieldErrors: Readonly<Record<string, readonly string[]>>;
}) {
  const [method, setMethod] = useState<ForecastMethod>(line?.forecastMethod ?? 'one-off');
  const schedule = line?.schedule ?? {};
  const err = (key: string): string | undefined => firstError(fieldErrors, key) ?? firstError(fieldErrors, `schedule.${key}`);
  const weightsDefault = JSON.stringify((schedule.weights ?? []).map((weight) => ({ month: weight.month, percent: percentOf(weight.weightPpm) })), null, 1);
  const manualDefault = JSON.stringify((schedule.manual ?? []).map((entry) => ({ date: entry.date, amount: centsToInput(entry.cents) })), null, 1);

  return (
    <>
      <SelectField id={`${prefix}-method`} name="forecastMethod" label="Forecast method" value={method} onChange={(event) => setMethod(event.target.value as ForecastMethod)} options={METHOD_OPTIONS} hint={`Periods on or before ${formatDateLong(cutoff)} are closed (CF06)`} />
      {method === 'one-off' ? (
        <TextField id={`${prefix}-date`} name="oneOffDate" label="Date" type="date" defaultValue={schedule.oneOffDate ?? ''} invalid={Boolean(err('oneOffDate'))} hint={err('oneOffDate')} />
      ) : null}
      {method === 'equal-monthly' ? (
        <>
          <TextField id={`${prefix}-start`} name="startMonth" label="Start month" type="month" defaultValue={schedule.startMonth ?? ''} invalid={Boolean(err('startMonth'))} hint={err('startMonth')} />
          <TextField id={`${prefix}-months`} name="months" label="Months" type="number" min={1} defaultValue={schedule.months ?? 1} invalid={Boolean(err('months'))} hint={err('months') ?? 'Residual cents land on the final month'} />
        </>
      ) : null}
      {method === 'weighted-monthly' ? (
        <div style={{ gridColumn: '1 / -1' }}>
          <TextAreaField
            id={`${prefix}-weights`} name="weightsJson" label="Weights (JSON)" rows={5} defaultValue={weightsDefault === '[]' ? '[{"month":"2027-02","percent":"60"},{"month":"2027-03","percent":"40"}]' : weightsDefault}
            invalid={Boolean(firstError(fieldErrors, 'weightsJson') ?? err('weights'))}
            hint={firstError(fieldErrors, 'weightsJson') ?? err('weights') ?? 'Percent per month; must total exactly 100%. The residual goes to the last month.'}
          />
        </div>
      ) : null}
      {method === 'milestone-linked' ? (
        <>
          <SelectField
            id={`${prefix}-ms`} name="milestoneId" label="Milestone" defaultValue={line?.milestoneId ?? ''}
            options={[{ value: '', label: milestones.length === 0 ? 'No programme milestones yet' : 'Choose a milestone…' }, ...milestones.map((entry) => ({ value: entry.id, label: `${entry.name} · ${formatDateLong(entry.plannedDate)}` }))]}
            invalid={Boolean(firstError(fieldErrors, 'milestoneId'))} hint={firstError(fieldErrors, 'milestoneId') ?? 'Moving the milestone moves this forecast'}
          />
          <TextField id={`${prefix}-offset`} name="milestoneOffsetDays" label="Offset (days)" type="number" defaultValue={schedule.milestoneOffsetDays ?? 0} invalid={Boolean(err('milestoneOffsetDays'))} hint={err('milestoneOffsetDays')} />
        </>
      ) : null}
      {method !== 'milestone-linked' ? (
        <SelectField
          id={`${prefix}-ms-link`} name="milestoneId" label="Milestone link (optional)" defaultValue={line?.milestoneId ?? ''}
          options={[{ value: '', label: 'None' }, ...milestones.map((entry) => ({ value: entry.id, label: entry.name }))]}
          hint="For reporting; timing follows the method above"
        />
      ) : null}
      {method === 'manual' ? (
        <div style={{ gridColumn: '1 / -1' }}>
          <TextAreaField
            id={`${prefix}-manual`} name="manualJson" label="Manual schedule (JSON, ex GST)" rows={5} defaultValue={manualDefault === '[]' ? '[{"date":"2028-05-15","amount":"0.00"}]' : manualDefault}
            invalid={Boolean(firstError(fieldErrors, 'manualJson') ?? err('manual'))}
            hint={firstError(fieldErrors, 'manualJson') ?? err('manual') ?? 'Dated amounts that must total the line’s current budget'}
          />
        </div>
      ) : null}
    </>
  );
}

function PeopleSelect({ id, people, defaultValue }: { readonly id: string; readonly people: readonly NamedOption[]; readonly defaultValue?: string }) {
  return (
    <SelectField id={id} name="responsibleUserId" label="Responsible person" defaultValue={defaultValue ?? ''} options={[{ value: '', label: 'Not assigned' }, ...people.map((person) => ({ value: person.id, label: person.name }))]} />
  );
}

/* ---------- Detail ---------- */

function LineDetail({
  projectId,
  revision,
  cutoff,
  row,
  categories,
  projectLines,
  milestones,
  people,
  canEdit,
}: {
  readonly projectId: string;
  readonly revision: number;
  readonly cutoff: string;
  readonly row: LineRow;
  readonly categories: CategoryRegisterScreenProps['categories'];
  readonly projectLines: readonly ProjectLineOption[];
  readonly milestones: readonly MilestoneOption[];
  readonly people: readonly NamedOption[];
  readonly canEdit: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [closing, setClosing] = useState(false);
  const { line } = row;
  const summary = line.rowType === 'summary';

  const history: readonly TimelineEntry[] = [...line.history].reverse().map((entry, index) => ({
    id: `${entry.at}-${index}`,
    state: 'done',
    title: entry.field === 'created' ? 'Created' : `${entry.field} changed`,
    meta: `${formatDateLong(entry.at.slice(0, 10))} · ${people.find((person) => person.id === entry.actor)?.name ?? entry.actor}${entry.reason ? ` · ${entry.reason}` : ''}${entry.field !== 'created' ? ` · ${describe(entry.before)} → ${describe(entry.after)}` : ''}`,
  }));

  return (
    <Card>
      <CardHeader title={`${line.code} · ${line.title}`} aside={<RowTypeChip rowType={line.rowType} />} />
      <CardBody className="stack">
        {summary ? (
          <Banner tone="info" icon="i-grid" title="Summary row">
            Its figure is the sum of the posting rows beneath it and is never added again (F02).
          </Banner>
        ) : null}
        <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Stat label="Current budget (ex GST)" value={<span className="num">{formatMoney(row.current, { showCents: true })}</span>} meta={summary ? 'Sum of posting rows' : `Original ${formatMoney(line.originalBudget, { showCents: true })}`} />
          <Stat label="Baseline (ex GST)" value={<span className="num">{row.baseline ? formatMoney(row.baseline, { showCents: true }) : '—'}</span>} meta={<VarianceChip current={row.current} baseline={row.baseline} />} />
          <Stat label="Input" value={summary ? '—' : INPUT_MODE_LABELS[line.inputMode]} meta={line.inputMode === 'quantity-rate' && line.rate ? `${line.quantity} ${line.unit ?? ''} × ${formatMoney(line.rate, { showCents: true })}` : undefined} />
          <Stat label="Tax" value={TAX_TREATMENT_LABELS[line.taxTreatment]} meta={`${formatPpmAsPercent(line.recoverablePpm, 0)} of GST recoverable`} />
          <Stat label="Forecast" value={summary ? '—' : FORECAST_METHOD_LABELS[line.forecastMethod]} meta={summary ? undefined : scheduleText(line)} />
          <Stat label="Responsible" value={row.responsibleName ?? 'Not assigned'} meta={line.active ? 'Active' : 'Closed · still in totals'} />
        </div>

        {canEdit ? (
          <Row>
            <Button small onClick={() => setEditing((value) => !value)} aria-pressed={editing}>{editing ? 'Hide edit form' : 'Edit line'}</Button>
            {line.active ? <Button small variant="ghost" onClick={() => setClosing((value) => !value)} aria-pressed={closing}>Close line</Button> : null}
          </Row>
        ) : null}

        {closing ? (
          <ActionForm action={deactivateCostLineAction} submitLabel="Close line" hiddenFields={{ projectId, costLineId: line.id }} onCancel={() => setClosing(false)} onSuccess={() => setClosing(false)}
            footnote={<Sub style={{ fontSize: 12 }}>A closed line keeps its budget in totals and baselines; it stops receiving new forecast.</Sub>}
          >
            {({ fieldErrors }) => <TextField id="cl-close-reason" name="reason" label="Reason" required invalid={Boolean(firstError(fieldErrors, 'reason'))} hint={firstError(fieldErrors, 'reason')} />}
          </ActionForm>
        ) : null}

        {editing ? (
          <ActionForm
            action={updateCostLineAction}
            submitLabel="Save line"
            hiddenFields={{ projectId, costLineId: line.id, revision: String(revision) }}
            onCancel={() => setEditing(false)}
            onSuccess={() => setEditing(false)}
            footnote={<Sub style={{ fontSize: 12 }}>Saves against revision {revision}; if someone changed the project first you are told and shown the latest values (CF07). The code {line.code} never changes.</Sub>}
          >
            {({ fieldErrors }) => (
              <FieldGrid>
                <TextField id="cl-title" name="title" label="Title" defaultValue={line.title} invalid={Boolean(firstError(fieldErrors, 'title'))} hint={firstError(fieldErrors, 'title')} />
                <SelectField id="cl-cat" name="categoryId" label="Category" defaultValue={line.categoryId} options={categories.map((entry) => ({ value: entry.id, label: `${entry.code} · ${entry.name}` }))} />
                <TextField id="cl-desc" name="description" label="Description" defaultValue={line.description ?? ''} />
                {summary ? null : <BudgetInputs prefix="cl" line={line} fieldErrors={fieldErrors} />}
                <SelectField id="cl-tax" name="taxTreatment" label="Tax treatment" defaultValue={line.taxTreatment} options={TAX_OPTIONS} invalid={Boolean(firstError(fieldErrors, 'taxTreatment'))} hint={firstError(fieldErrors, 'taxTreatment')} />
                <TextField id="cl-rec" name="recoverablePercent" label="GST recoverable (%)" inputMode="decimal" defaultValue={percentOf(line.recoverablePpm)} invalid={Boolean(firstError(fieldErrors, 'recoverablePercent'))} hint={firstError(fieldErrors, 'recoverablePercent')} />
                {summary ? null : <ScheduleInputs prefix="cl" line={line} cutoff={cutoff} milestones={milestones} fieldErrors={fieldErrors} />}
                <PeopleSelect id="cl-resp" people={people} defaultValue={line.responsibleUserId} />
                <TextField id="cl-reason" name="reason" label="Reason" placeholder="Required when the budget changes" invalid={Boolean(firstError(fieldErrors, 'reason'))} hint={firstError(fieldErrors, 'reason')} />
              </FieldGrid>
            )}
          </ActionForm>
        ) : null}

        <div>
          <Sub>History · {line.history.length} entr{line.history.length === 1 ? 'y' : 'ies'}{projectLines.some((entry) => entry.id === line.parentLineId) ? ` · part of ${projectLines.find((entry) => entry.id === line.parentLineId)?.code}` : ''}</Sub>
          <Timeline entries={history} />
        </div>
      </CardBody>
    </Card>
  );
}

function describe(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'object' && value !== null && 'cents' in value && typeof (value as { cents: unknown }).cents === 'number') {
    return formatMoney(value as Money, { showCents: true });
  }
  if (typeof value === 'object') return 'updated';
  return String(value);
}

function scheduleText(line: CostLine): string {
  const schedule = line.schedule;
  switch (line.forecastMethod) {
    case 'one-off':
      return schedule.oneOffDate ? formatDateLong(schedule.oneOffDate) : 'No date';
    case 'equal-monthly':
      return `${schedule.months ?? 1} months from ${schedule.startMonth ?? '—'}`;
    case 'weighted-monthly': {
      const weights = schedule.weights ?? [];
      return weights.length ? `${weights.length} months, ${weights[0]?.month} → ${weights[weights.length - 1]?.month}` : 'No weights';
    }
    case 'milestone-linked':
      return `${schedule.milestoneOffsetDays ?? 0} days from the milestone`;
    case 'manual':
      return `${schedule.manual?.length ?? 0} dated amounts`;
  }
}

/* ---------- New line ---------- */

function NewLineForm({
  projectId,
  revision,
  cutoff,
  categoryId,
  projectLines,
  milestones,
  people,
  onClose,
}: {
  readonly projectId: string;
  readonly revision: number;
  readonly cutoff: string;
  readonly categoryId: string;
  readonly projectLines: readonly ProjectLineOption[];
  readonly milestones: readonly MilestoneOption[];
  readonly people: readonly NamedOption[];
  readonly onClose: () => void;
}) {
  const [rowType, setRowType] = useState<'posting' | 'summary'>('posting');
  const parents = projectLines.filter((entry) => entry.rowType === 'summary');
  return (
    <Card>
      <CardHeader title="New cost line" aside={<Sub>Amounts ex GST</Sub>} />
      <CardBody>
        <ActionForm action={createCostLineAction} submitLabel="Create line" hiddenFields={{ projectId, categoryId, revision: String(revision) }} onCancel={onClose} onSuccess={onClose}>
          {({ fieldErrors }) => (
            <FieldGrid>
              <TextField id="nl-code" name="code" label="Code" required placeholder="CON-04" invalid={Boolean(firstError(fieldErrors, 'code'))} hint={firstError(fieldErrors, 'code') ?? 'Unique in the project; never changes'} />
              <TextField id="nl-title" name="title" label="Title" required invalid={Boolean(firstError(fieldErrors, 'title'))} hint={firstError(fieldErrors, 'title')} />
              <TextField id="nl-desc" name="description" label="Description" />
              <SelectField id="nl-row" name="rowType" label="Row type" value={rowType} onChange={(event) => setRowType(event.target.value as 'posting' | 'summary')} options={[{ value: 'posting', label: 'Posting · carries budget' }, { value: 'summary', label: 'Summary · groups other lines' }]} />
              <SelectField id="nl-parent" name="parentLineId" label="Part of" options={[{ value: '', label: 'No parent' }, ...parents.map((entry) => ({ value: entry.id, label: `${entry.code} · ${entry.title}` }))]} invalid={Boolean(firstError(fieldErrors, 'parentLineId'))} hint={firstError(fieldErrors, 'parentLineId')} />
              {rowType === 'posting' ? <BudgetInputs prefix="nl" fieldErrors={fieldErrors} /> : null}
              <SelectField id="nl-tax" name="taxTreatment" label="Tax treatment" defaultValue="standard-gst" options={TAX_OPTIONS} />
              <TextField id="nl-rec" name="recoverablePercent" label="GST recoverable (%)" inputMode="decimal" defaultValue="100" />
              {rowType === 'posting' ? <ScheduleInputs prefix="nl" cutoff={cutoff} milestones={milestones} fieldErrors={fieldErrors} /> : null}
              <PeopleSelect id="nl-resp" people={people} />
              {rowType === 'posting' ? (
                <div className="field">
                  <label htmlFor="nl-cont">Contingency</label>
                  <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 12.5 }}>
                    <input id="nl-cont" type="checkbox" name="isContingency" /> This line is an explicit contingency allowance
                  </label>
                </div>
              ) : null}
            </FieldGrid>
          )}
        </ActionForm>
      </CardBody>
    </Card>
  );
}

/* ---------- Adjustments ---------- */

function AdjustmentForm({ projectId, revision, projectLines, onClose }: { readonly projectId: string; readonly revision: number; readonly projectLines: readonly ProjectLineOption[]; readonly onClose: () => void }) {
  const [kind, setKind] = useState<(typeof ADJUSTMENT_KINDS)[number]>('contingency-draw');
  const posting = projectLines.filter((entry) => entry.rowType === 'posting' && entry.active);
  const sources = kind === 'contingency-draw' ? posting.filter((entry) => entry.isContingency) : posting;
  const targets = kind === 'contingency-draw' ? posting.filter((entry) => !entry.isContingency) : posting;
  const oneSided = kind === 'scope-change' || kind === 'manual';
  const option = (entry: ProjectLineOption) => ({ value: entry.id, label: `${entry.code} · ${entry.title}` });

  return (
    <Card>
      <CardHeader title="Contingency draw, transfer or scope change" aside={<Sub>Ex GST</Sub>} />
      <CardBody>
        <ActionForm
          action={recordAdjustmentAction}
          submitLabel="Record adjustment"
          hiddenFields={{ projectId, revision: String(revision) }}
          onCancel={onClose}
          onSuccess={onClose}
          footnote={
            <Sub style={{ fontSize: 12 }}>
              {kind === 'contingency-draw'
                ? 'A draw reduces the allowance and increases the target by the same amount, so the project total does not move. A draw larger than the remaining allowance is refused (CST08).'
                : oneSided
                  ? 'Choose a target to increase the budget, or a source to decrease it — not both. This changes the project total.'
                  : 'A transfer moves budget between two posting lines; the project total does not move.'}
            </Sub>
          }
        >
          {({ fieldErrors }) => (
            <FieldGrid>
              <SelectField id="adj-kind" name="kind" label="Kind" value={kind} onChange={(event) => setKind(event.target.value as typeof kind)} options={ADJUSTMENT_KINDS.map((value) => ({ value, label: ADJUSTMENT_KIND_LABELS[value] }))} />
              <TextField id="adj-amount" name="amount" label="Amount (ex GST)" inputMode="decimal" required placeholder="18,000.00" invalid={Boolean(firstError(fieldErrors, 'amount'))} hint={firstError(fieldErrors, 'amount')} />
              <SelectField id="adj-from" name="fromLineId" label={kind === 'contingency-draw' ? 'From allowance' : 'From line'} options={[{ value: '', label: oneSided ? 'None · increase only' : 'Choose…' }, ...sources.map(option)]} invalid={Boolean(firstError(fieldErrors, 'fromLineId'))} hint={firstError(fieldErrors, 'fromLineId')} />
              <SelectField id="adj-to" name="toLineId" label="To line" options={[{ value: '', label: oneSided ? 'None · decrease only' : 'Choose…' }, ...targets.map(option)]} invalid={Boolean(firstError(fieldErrors, 'toLineId'))} hint={firstError(fieldErrors, 'toLineId')} />
              <TextField id="adj-reason" name="reason" label="Reason" required placeholder="Rock excavation variation" invalid={Boolean(firstError(fieldErrors, 'reason'))} hint={firstError(fieldErrors, 'reason')} />
            </FieldGrid>
          )}
        </ActionForm>
      </CardBody>
    </Card>
  );
}

/* ---------- Batch edit ---------- */

interface ParsedBatch {
  readonly edits: readonly { readonly costLineId: string; readonly budget: string; readonly reason?: string }[];
  readonly problems: readonly string[];
  readonly preview: readonly string[];
}

/** "CON-03=90,000" per line → edits in the API's wire shape. Parsed in the browser; validated again on the server. */
function parseBatch(text: string, reason: string, lines: readonly ProjectLineOption[]): ParsedBatch {
  const edits: { costLineId: string; budget: string; reason?: string }[] = [];
  const problems: string[] = [];
  const preview: string[] = [];
  text.split(/\r?\n/).forEach((raw, index) => {
    const entry = raw.trim();
    if (!entry) return;
    const match = /^([A-Za-z0-9-]+)\s*[=:]\s*\$?\s*([\d,]+(?:\.\d{1,2})?)$/.exec(entry);
    if (!match) {
      problems.push(`Line ${index + 1}: use CODE=amount, e.g. CON-03=90000.`);
      return;
    }
    const code = (match[1] ?? '').toUpperCase();
    const line = lines.find((candidate) => candidate.code === code);
    if (!line) {
      problems.push(`Line ${index + 1}: no cost line ${code} in this project.`);
      return;
    }
    const [whole = '0', fraction = ''] = (match[2] ?? '').replace(/,/g, '').split('.');
    const budget = `${Number(whole)}.${fraction.padEnd(2, '0')}`;
    edits.push({ costLineId: line.id, budget, ...(reason.trim() ? { reason: reason.trim() } : {}) });
    preview.push(`${code} → $${Number(whole).toLocaleString('en-AU')}.${fraction.padEnd(2, '0')} ex GST`);
  });
  return { edits, problems, preview };
}

function BatchEditForm({ projectId, revision, projectLines, onClose }: { readonly projectId: string; readonly revision: number; readonly projectLines: readonly ProjectLineOption[]; readonly onClose: () => void }) {
  const [text, setText] = useState('');
  const [reason, setReason] = useState('');
  const parsed = useMemo(() => parseBatch(text, reason, projectLines), [text, reason, projectLines]);

  return (
    <Card>
      <CardHeader title="Batch edit budgets" aside={<Sub>Saved together against revision {revision}</Sub>} />
      <CardBody className="stack">
        <FieldGrid>
          <div style={{ gridColumn: '1 / -1' }}>
            <TextAreaField id="be-lines" label="New current budgets (ex GST), one per line" rows={6} value={text} onChange={(event) => setText(event.target.value)} placeholder={'CON-03=90,000\nMKT-01=70000.00'} hint="Each changed budget becomes a manual adjustment; either every line saves or none does (CF07)." />
          </div>
          <TextField id="be-reason" label="Reason for these changes" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Quotes received" required />
        </FieldGrid>
        {parsed.problems.length > 0 ? (
          <Banner tone="warn" title="Some lines could not be read">{parsed.problems.join(' ')}</Banner>
        ) : parsed.preview.length > 0 ? (
          <Banner tone="info" icon="i-check" title={`${parsed.preview.length} line${parsed.preview.length === 1 ? '' : 's'} ready`}>{parsed.preview.join(' · ')}</Banner>
        ) : null}
        <ActionForm
          action={applyForecastBatchAction}
          submitLabel="Save batch"
          hiddenFields={{ projectId, revision: String(revision), edits: JSON.stringify(parsed.edits) }}
          onCancel={onClose}
          onSuccess={() => {
            setText('');
            onClose();
          }}
          footnote={
            <Sub style={{ fontSize: 12 }}>
              If someone saved a change after you loaded this page, the batch is refused with your revision, the latest one and the latest stored values for your lines — nothing is overwritten. Reload to edit from the latest values.
            </Sub>
          }
        />
      </CardBody>
    </Card>
  );
}
