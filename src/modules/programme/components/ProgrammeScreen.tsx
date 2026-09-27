'use client';

import { useMemo, useState } from 'react';
import { ActionForm, firstError } from '@/shared/components/ActionForm';
import { Button } from '@/shared/components/Button';
import { Card, CardBody, CardHeader } from '@/shared/components/Card';
import { Chip } from '@/shared/components/Chip';
import { DataTable, CellMain, CellSub, Num, type DataTableColumn } from '@/shared/components/DataTable';
import { FieldGrid, SelectField, TextField } from '@/shared/components/Field';
import { Grid, Row, Stack, Stat, Sub } from '@/shared/components/Layout';
import { Tabs } from '@/shared/components/Tabs';
import { Banner } from '@/shared/components/Banner';
import type { IconName } from '@/shared/components/IconSprite';
import type { Tone } from '@/shared/types/common';
import { formatDateLong, formatDateShort } from '@/shared/lib/dates';
import { addDependencyAction, createMilestoneAction, recordActualAction, removeDependencyAction, updateMilestoneAction } from '../actions';
import { MILESTONE_KIND_LABELS, MILESTONE_KINDS, type MilestoneKind } from '../model';
import type { ProgrammeOverview, ProgrammeRow } from '../api';
import { MoveDateForm, type MoveDateFormProps } from './MoveDateForm';
import { ProgrammeGantt } from './ProgrammeGantt';

type Tab = 'list' | 'gantt';
type Panel = 'edit' | 'move' | 'actual' | 'dependency';

const KIND_CHIP: Record<MilestoneKind, { tone: Tone; icon: IconName }> = {
  stage: { tone: 'neutral', icon: 'i-grid' },
  milestone: { tone: 'gold', icon: 'i-check-sq' },
  task: { tone: 'info', icon: 'i-file' },
};

function StatusChip({ row }: { readonly row: ProgrammeRow }) {
  if (row.actualDate) return <Chip tone="good" icon="i-check">Actual {formatDateShort(row.actualDate)}</Chip>;
  if (row.late) return <Chip tone="warn" icon="i-alert">Late · no actual</Chip>;
  return <Chip tone="info" icon="i-clock">Planned</Chip>;
}

/** PRG01–PRG03 — the programme list, Gantt and the selected item's panel. */
export function ProgrammeScreen({ overview, previewFinancials }: { readonly overview: ProgrammeOverview; readonly previewFinancials?: MoveDateFormProps['previewFinancials'] }) {
  const { project, rows, people, permissions, asOf, actualsCutoff } = overview;
  const [tab, setTab] = useState<Tab>('list');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>('edit');
  const [isCreating, setCreating] = useState(false);

  const selected = useMemo(() => rows.find((row) => row.id === selectedId) ?? null, [rows, selectedId]);
  const stages = rows.filter((row) => row.kind === 'stage');
  const select = (id: string): void => {
    setSelectedId(id);
    setCreating(false);
    setPanel('edit');
  };

  const columns: readonly DataTableColumn<ProgrammeRow>[] = [
    {
      header: 'Item',
      lead: true,
      render: (row) => (
        <span style={{ display: 'inline-block', paddingLeft: row.depth * 18 }}>
          <CellMain>{row.kind === 'stage' ? <b>{row.name}</b> : row.name}</CellMain>
          <br />
          <CellSub>{row.code}</CellSub>
        </span>
      ),
    },
    { header: 'Kind', render: (row) => <Chip tone={KIND_CHIP[row.kind].tone} icon={KIND_CHIP[row.kind].icon}>{MILESTONE_KIND_LABELS[row.kind]}</Chip> },
    { header: 'Planned start', render: (row) => (row.plannedStart ? formatDateShort(row.plannedStart) : '—') },
    { header: 'Planned finish', render: (row) => formatDateShort(row.plannedDate) },
    { header: 'Duration', align: 'right', render: (row) => <Num>{row.durationDays === null ? '—' : `${row.durationDays} d`}</Num> },
    { header: 'Status', render: (row) => <StatusChip row={row} /> },
    { header: 'Owner', render: (row) => row.ownerName ?? <Sub>Unassigned</Sub> },
    { header: '% complete', align: 'right', render: (row) => <Num>{row.completionPercent}%</Num> },
    {
      header: 'Depends on',
      render: (row) =>
        row.predecessors.length === 0 ? (
          <Sub>—</Sub>
        ) : (
          <CellSub>{row.predecessors.map((link) => `${link.name}${link.lagDays ? ` +${link.lagDays}d` : ''}`).join(' · ')}</CellSub>
        ),
    },
  ];

  return (
    <Stack>
      <Row style={{ justifyContent: 'space-between' }}>
        <Tabs
          tabs={[
            { value: 'list', label: 'List' },
            { value: 'gantt', label: 'Gantt' },
          ]}
          value={tab}
          onChange={setTab}
        />
        <Row>
          <Sub>As of {formatDateLong(asOf)} · periods locked to {formatDateLong(actualsCutoff)} · revision {project.modelRevision}</Sub>
          {permissions.canEdit ? (
            <Button variant="primary" onClick={() => { setCreating(true); setSelectedId(null); }}>
              + Add milestone
            </Button>
          ) : null}
        </Row>
      </Row>

      {tab === 'gantt' ? (
        <ProgrammeGantt rows={rows} windowStart={project.startDate} windowEnd={project.expectedCompletion} onSelect={select} selectedId={selectedId} />
      ) : null}

      <Grid columns={2}>
        {tab === 'list' ? (
          <Card>
            <CardHeader title="Programme" aside={<Sub>{stages.length} stages · {rows.length - stages.length} milestones and tasks</Sub>} />
            <DataTable
              columns={columns}
              rows={rows}
              rowKey={(row) => row.id}
              onRowClick={(row) => select(row.id)}
              isRowSelected={(row) => row.id === selectedId}
              rowStyle={(row) => (row.id === selectedId ? { background: 'var(--gold-soft)' } : undefined)}
              empty="No programme yet. Add a stage to begin."
            />
          </Card>
        ) : (
          <Card>
            <CardHeader title="Legend" />
            <CardBody className="stack">
              <Sub>Bars are planned windows; a green bar has its actual recorded; an amber bar is planned before the as-of date with no actual. Diamonds are milestones.</Sub>
              <Sub>Select a row in the Gantt to open its panel.</Sub>
            </CardBody>
          </Card>
        )}

        {isCreating && permissions.canEdit ? (
          <CreateMilestoneForm projectId={project.id} revision={project.modelRevision} stages={stages} people={people} onClose={() => setCreating(false)} />
        ) : selected ? (
          <Card>
            <CardHeader
              title={
                <span>
                  {selected.name} <Sub>· {selected.code}</Sub>
                </span>
              }
              aside={<StatusChip row={selected} />}
            />
            <CardBody className="stack">
              <Grid columns={3}>
                <Stat label="Planned" value={selected.plannedStart ? `${formatDateShort(selected.plannedStart)} → ${formatDateShort(selected.plannedDate)}` : formatDateLong(selected.plannedDate)} meta={selected.durationDays === null ? undefined : `${selected.durationDays} days`} />
                <Stat label="Actual" value={selected.actualDate ? formatDateLong(selected.actualDate) : 'Not recorded'} meta={selected.actualDate ? 'Plan no longer moves it' : 'Forecast follows the plan'} />
                <Stat label="Owner" value={selected.ownerName ?? 'Unassigned'} meta={`${selected.completionPercent}% complete`} />
              </Grid>

              {selected.predecessors.length > 0 || selected.successors.length > 0 ? (
                <div>
                  <Sub style={{ fontSize: 12 }}>Dependencies (finish-to-start)</Sub>
                  <ul style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: 13 }}>
                    {selected.predecessors.map((link) => (
                      <li key={link.dependencyId}>
                        After <b>{link.name}</b> {link.lagDays ? `+ ${link.lagDays} days` : ''}
                        {permissions.canEdit ? (
                          <>
                            {' '}
                            <ActionForm action={removeDependencyAction} submitLabel="Remove" render="inline" hiddenFields={{ projectId: project.id, dependencyId: link.dependencyId }} />
                          </>
                        ) : null}
                      </li>
                    ))}
                    {selected.successors.map((link) => (
                      <li key={link.dependencyId}>
                        Before <b>{link.name}</b> {link.lagDays ? `+ ${link.lagDays} days` : ''}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {permissions.canEdit ? (
                <Row>
                  <Button small variant={panel === 'edit' ? 'gold' : 'default'} onClick={() => setPanel('edit')} aria-pressed={panel === 'edit'}>Edit</Button>
                  <Button small variant={panel === 'move' ? 'gold' : 'default'} onClick={() => setPanel('move')} aria-pressed={panel === 'move'}>Move date</Button>
                  <Button small variant={panel === 'actual' ? 'gold' : 'default'} onClick={() => setPanel('actual')} aria-pressed={panel === 'actual'} disabled={Boolean(selected.actualDate)}>Record actual</Button>
                  <Button small variant={panel === 'dependency' ? 'gold' : 'default'} onClick={() => setPanel('dependency')} aria-pressed={panel === 'dependency'}>Add dependency</Button>
                </Row>
              ) : null}

              {permissions.canEdit && panel === 'edit' ? (
                <ActionForm
                  key={`edit-${selected.id}`}
                  action={updateMilestoneAction}
                  submitLabel="Save"
                  hiddenFields={{ projectId: project.id, milestoneId: selected.id }}
                >
                  {({ fieldErrors }) => (
                    <FieldGrid>
                      <TextField id="pm-name" name="name" label="Name" defaultValue={selected.name} invalid={Boolean(firstError(fieldErrors, 'name'))} hint={firstError(fieldErrors, 'name')} />
                      <TextField id="pm-code" name="code" label="Code" defaultValue={selected.code} invalid={Boolean(firstError(fieldErrors, 'code'))} hint={firstError(fieldErrors, 'code')} />
                      {selected.kind !== 'milestone' ? (
                        <TextField id="pm-start" name="plannedStart" label="Planned start" type="date" defaultValue={selected.plannedStart ?? ''} invalid={Boolean(firstError(fieldErrors, 'plannedStart'))} hint={firstError(fieldErrors, 'plannedStart') ?? 'The finish moves through "Move date"'} />
                      ) : null}
                      <SelectField id="pm-owner" name="ownerUserId" label="Owner" defaultValue={selected.ownerUserId ?? ''} options={[{ value: '', label: 'Unassigned' }, ...people.map((person) => ({ value: person.id, label: person.name }))]} />
                      <TextField id="pm-complete" name="completionPercent" label="% complete" type="number" min={0} max={100} defaultValue={selected.completionPercent} invalid={Boolean(firstError(fieldErrors, 'completionPercent'))} hint={firstError(fieldErrors, 'completionPercent')} />
                      <TextField id="pm-reason" name="reason" label="Reason (optional)" placeholder="Why this changed" />
                    </FieldGrid>
                  )}
                </ActionForm>
              ) : null}

              {permissions.canEdit && panel === 'move' ? (
                <MoveDateForm key={`move-${selected.id}`} projectId={project.id} milestoneId={selected.id} currentDate={selected.plannedDate} revision={project.modelRevision} hasActual={Boolean(selected.actualDate)} previewFinancials={previewFinancials} />
              ) : null}

              {permissions.canEdit && panel === 'actual' ? (
                <ActionForm
                  key={`actual-${selected.id}`}
                  action={recordActualAction}
                  submitLabel="Record actual"
                  hiddenFields={{ projectId: project.id, milestoneId: selected.id }}
                  footnote={<Sub style={{ fontSize: 12 }}>An actual is a fact: it may fall inside a locked period and is audited. Once recorded, the plan no longer moves this item and dependent forecasts follow the actual.</Sub>}
                >
                  {({ fieldErrors }) => (
                    <FieldGrid>
                      <TextField id="pm-actual" name="actualDate" label="Actual date" type="date" defaultValue={asOf} invalid={Boolean(firstError(fieldErrors, 'actualDate'))} hint={firstError(fieldErrors, 'actualDate')} />
                    </FieldGrid>
                  )}
                </ActionForm>
              ) : null}

              {permissions.canEdit && panel === 'dependency' ? (
                <ActionForm
                  key={`dep-${selected.id}`}
                  action={addDependencyAction}
                  submitLabel="Add dependency"
                  hiddenFields={{ projectId: project.id, successorId: selected.id }}
                  footnote={<Sub style={{ fontSize: 12 }}>Finish-to-start: {selected.name} may not be planned before the predecessor plus the lag. Links that would form a loop are refused.</Sub>}
                >
                  {({ fieldErrors }) => (
                    <FieldGrid>
                      <SelectField
                        id="pm-pred"
                        name="predecessorId"
                        label={`${selected.name} comes after`}
                        options={rows.filter((row) => row.id !== selected.id).map((row) => ({ value: row.id, label: `${row.code} · ${row.name}` }))}
                        invalid={Boolean(firstError(fieldErrors, 'successorId'))}
                        hint={firstError(fieldErrors, 'successorId')}
                      />
                      <TextField id="pm-lag" name="lagDays" label="Lag (days)" type="number" defaultValue={0} invalid={Boolean(firstError(fieldErrors, 'lagDays'))} hint={firstError(fieldErrors, 'lagDays')} />
                    </FieldGrid>
                  )}
                </ActionForm>
              ) : null}

              {selected.history.length > 0 ? (
                <div>
                  <Sub style={{ fontSize: 12 }}>History</Sub>
                  <ul style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: 12.5 }}>
                    {[...selected.history].reverse().slice(0, 8).map((entry, index) => (
                      <li key={index}>
                        {entry.field}: {String(entry.before ?? '—')} → {String(entry.after ?? '—')}
                        {entry.reason ? <Sub> · {entry.reason}</Sub> : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </CardBody>
          </Card>
        ) : (
          <Card>
            <CardHeader title="Select an item" />
            <CardBody>
              <Sub>Choose a stage, milestone or task to see its dates, dependencies and history{permissions.canEdit ? ', or to move it' : ''}.</Sub>
            </CardBody>
          </Card>
        )}
      </Grid>
    </Stack>
  );
}

function CreateMilestoneForm({
  projectId,
  revision,
  stages,
  people,
  onClose,
}: {
  readonly projectId: string;
  readonly revision: number;
  readonly stages: readonly ProgrammeRow[];
  readonly people: readonly { readonly id: string; readonly name: string }[];
  readonly onClose: () => void;
}) {
  const [kind, setKind] = useState<MilestoneKind>('milestone');
  return (
    <Card>
      <CardHeader title="Add to the programme" aside={<Sub>Saves against revision {revision}</Sub>} />
      <CardBody>
        <ActionForm action={createMilestoneAction} submitLabel="Add" hiddenFields={{ projectId, revision: String(revision) }} onCancel={onClose} onSuccess={onClose}>
          {({ fieldErrors }) => (
            <Stack>
              <FieldGrid>
                <SelectField id="pc-kind" name="kind" label="Kind" value={kind} onChange={(event) => setKind(event.target.value as MilestoneKind)} options={MILESTONE_KINDS.map((value) => ({ value, label: MILESTONE_KIND_LABELS[value] }))} />
                {kind !== 'stage' ? (
                  <SelectField id="pc-parent" name="parentId" label="Stage" options={stages.map((stage) => ({ value: stage.id, label: stage.name }))} invalid={Boolean(firstError(fieldErrors, 'parentId'))} hint={firstError(fieldErrors, 'parentId')} />
                ) : null}
                <TextField id="pc-code" name="code" label="Code" placeholder="CON-06" invalid={Boolean(firstError(fieldErrors, 'code'))} hint={firstError(fieldErrors, 'code')} />
                <TextField id="pc-name" name="name" label="Name" invalid={Boolean(firstError(fieldErrors, 'name'))} hint={firstError(fieldErrors, 'name')} />
                {kind !== 'milestone' ? (
                  <TextField id="pc-start" name="plannedStart" label="Planned start" type="date" invalid={Boolean(firstError(fieldErrors, 'plannedStart'))} hint={firstError(fieldErrors, 'plannedStart')} />
                ) : null}
                <TextField id="pc-date" name="plannedDate" label={kind === 'milestone' ? 'Planned date' : 'Planned finish'} type="date" invalid={Boolean(firstError(fieldErrors, 'plannedDate'))} hint={firstError(fieldErrors, 'plannedDate')} />
                <SelectField id="pc-owner" name="ownerUserId" label="Owner" defaultValue="" options={[{ value: '', label: 'Unassigned' }, ...people.map((person) => ({ value: person.id, label: person.name }))]} />
              </FieldGrid>
              {kind === 'milestone' ? (
                <Banner tone="info" title="Cost lines and sales events can link to this milestone">
                  Anything timed by milestone offset follows this date when it moves (PRG04).
                </Banner>
              ) : null}
            </Stack>
          )}
        </ActionForm>
      </CardBody>
    </Card>
  );
}
