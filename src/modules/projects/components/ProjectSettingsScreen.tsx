'use client';

import { useState } from 'react';
import { ActionForm, firstError } from '@/shared/components/ActionForm';
import { Button } from '@/shared/components/Button';
import { Card, CardBody, CardHeader } from '@/shared/components/Card';
import { Chip } from '@/shared/components/Chip';
import { DataTable, CellMain, CellSub, type DataTableColumn } from '@/shared/components/DataTable';
import { FieldGrid, SelectField, TextField } from '@/shared/components/Field';
import { Grid, Row, Stack, Stat, Sub } from '@/shared/components/Layout';
import { Stepper } from '@/shared/components/Stepper';
import { Tabs } from '@/shared/components/Tabs';
import { Banner } from '@/shared/components/Banner';
import { formatMoney, type Money } from '@/shared/lib/money';
import { formatDateLong } from '@/shared/lib/dates';
import {
  completeSetupStepAction,
  grantProjectAccessAction,
  publishPolicyAction,
  setProjectAccessStatusAction,
  transitionProjectAction,
  updateProjectAction,
} from '../actions';
import {
  AUSTRALIAN_STATES,
  LIFECYCLE_LABELS,
  LIFECYCLE_TRANSITIONS,
  PROJECT_GRANTS,
  PROJECT_GRANT_LABELS,
  PROJECT_ROLE_LABELS,
  PROJECT_ROLES,
  PROJECT_TYPE_LABELS,
  PROJECT_TYPES,
  SETUP_STEPS,
  SETUP_STEP_LABELS,
  type ProjectGrant,
  type ProjectLifecycle,
  type ProjectRole,
  type SetupStep,
} from '../model';
import { ROLE_DESCRIPTIONS } from '../permissions';

export interface MemberRow {
  readonly accessId: string;
  readonly userId: string;
  readonly name: string;
  readonly role: ProjectRole;
  readonly grants: readonly ProjectGrant[];
  readonly approvalLimit: Money | null;
  readonly status: 'active' | 'suspended' | 'revoked';
  readonly expiresAt: string | null;
}

export interface PolicyRow {
  readonly version: number;
  readonly effectiveFrom: string;
  readonly reason: string;
  readonly actualsCutoff: string;
  readonly standardRateLabel: string;
  readonly displayBasis: string;
  readonly minimumReserve: Money;
  readonly twoPersonThreshold: Money | null;
  readonly createdByName: string;
}

export interface ProjectSettingsScreenProps {
  readonly project: {
    readonly id: string;
    readonly code: string;
    readonly name: string;
    readonly type: string;
    readonly address: string;
    readonly state: string;
    readonly lifecycle: ProjectLifecycle;
    readonly lifecycleReason: string | null;
    readonly startDate: string;
    readonly expectedCompletion: string;
    readonly forecastHorizonMonths: number;
    readonly reportingBasis: string;
    readonly modelRevision: number;
    readonly openingCash: Money;
    readonly openingRestrictedCash: Money;
    readonly setupStepsCompleted: readonly SetupStep[];
    readonly legalEntityName: string;
  };
  readonly activationBlockers: readonly string[];
  readonly policies: readonly PolicyRow[];
  readonly members: readonly MemberRow[];
  readonly people: readonly { readonly id: string; readonly name: string }[];
  readonly participants: readonly { readonly id: string; readonly name: string }[];
  readonly permissions: {
    readonly canEdit: boolean;
    readonly canManageMembers: boolean;
    readonly canReopen: boolean;
  };
  readonly today: string;
}

type Tab = 'identity' | 'setup' | 'policy' | 'members' | 'lifecycle';

/** PRJ01–PRJ05, IAM03–IAM04, CF06 — everything about a project that is not a financial record. */
export function ProjectSettingsScreen({ project, activationBlockers, policies, members, people, participants, permissions, today }: ProjectSettingsScreenProps) {
  const [tab, setTab] = useState<Tab>('identity');
  const current = policies[policies.length - 1];

  return (
    <Stack>
      <Tabs
        tabs={[
          { value: 'identity', label: 'Identity' },
          { value: 'setup', label: 'Setup checklist' },
          { value: 'policy', label: 'Policy & periods' },
          { value: 'members', label: 'Members & authority' },
          { value: 'lifecycle', label: 'Lifecycle' },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === 'identity' ? (
        <Card>
          <CardHeader title="Project identity" aside={<Sub>Model revision {project.modelRevision} · {project.legalEntityName}</Sub>} />
          <CardBody>
            {permissions.canEdit ? (
              <ActionForm
                action={updateProjectAction}
                submitLabel="Save project"
                hiddenFields={{ projectId: project.id, revision: String(project.modelRevision) }}
                footnote={
                  <Sub style={{ fontSize: 12 }}>
                    Saves against model revision {project.modelRevision}. If someone else changed the project first, the save is
                    refused and you are shown the latest values (CF07).
                  </Sub>
                }
              >
                {({ fieldErrors }) => (
                  <FieldGrid>
                    <TextField id="ps-name" name="name" label="Project name" defaultValue={project.name} />
                    <TextField id="ps-address" name="address" label="Address" defaultValue={project.address} />
                    <SelectField id="ps-type" name="type" label="Project type" defaultValue={project.type} options={PROJECT_TYPES.map((type) => ({ value: type, label: PROJECT_TYPE_LABELS[type] }))} />
                    <SelectField id="ps-state" name="state" label="State" defaultValue={project.state} options={AUSTRALIAN_STATES.map((state) => ({ value: state, label: state }))} />
                    <TextField id="ps-start" name="startDate" label="Start date" type="date" defaultValue={project.startDate} disabled hint="Fixed once created" />
                    <TextField
                      id="ps-completion" name="expectedCompletion" label="Expected completion" type="date" defaultValue={project.expectedCompletion}
                      invalid={Boolean(firstError(fieldErrors, 'expectedCompletion'))} hint={firstError(fieldErrors, 'expectedCompletion')}
                    />
                    <TextField id="ps-horizon" name="forecastHorizonMonths" label="Forecast horizon (months)" type="number" min={1} max={120} defaultValue={project.forecastHorizonMonths} />
                    <TextField
                      id="ps-cash" name="openingCash" label="Opening unrestricted cash" inputMode="decimal" defaultValue={(project.openingCash.cents / 100).toFixed(2)}
                      invalid={Boolean(firstError(fieldErrors, 'openingCash'))} hint={firstError(fieldErrors, 'openingCash')}
                    />
                    <TextField
                      id="ps-restricted" name="openingRestrictedCash" label="Opening restricted (trust) cash" inputMode="decimal" defaultValue={(project.openingRestrictedCash.cents / 100).toFixed(2)}
                      invalid={Boolean(firstError(fieldErrors, 'openingRestrictedCash'))} hint={firstError(fieldErrors, 'openingRestrictedCash')}
                    />
                  </FieldGrid>
                )}
              </ActionForm>
            ) : (
              <Grid columns={3}>
                <Stat label="Name" value={project.name} />
                <Stat label="Address" value={project.address} meta={project.state} />
                <Stat label="Type" value={PROJECT_TYPE_LABELS[project.type as keyof typeof PROJECT_TYPE_LABELS] ?? project.type} />
                <Stat label="Start" value={formatDateLong(project.startDate)} />
                <Stat label="Expected completion" value={formatDateLong(project.expectedCompletion)} />
                <Stat label="Opening cash" value={formatMoney(project.openingCash, { showCents: true })} meta={`Restricted ${formatMoney(project.openingRestrictedCash, { showCents: true })}`} />
              </Grid>
            )}
          </CardBody>
        </Card>
      ) : null}

      {tab === 'setup' ? (
        <Card>
          <CardHeader title="Setup checklist" aside={<Sub>{project.setupStepsCompleted.length} of {SETUP_STEPS.length} complete</Sub>} />
          <CardBody className="stack">
            <Stepper
              label="Setup steps"
              steps={SETUP_STEPS.map((step) => ({
                label: SETUP_STEP_LABELS[step],
                state: project.setupStepsCompleted.includes(step) ? 'done' : 'todo',
              }))}
            />
            {activationBlockers.length > 0 ? (
              <Banner tone="warn" title="Publication is blocked">
                {activationBlockers.join(' · ')}
              </Banner>
            ) : (
              <Banner tone="info" icon="i-check" title="Every step is complete">
                {project.lifecycle === 'draft' ? 'The project can be activated from the Lifecycle tab.' : 'The project is live.'}
              </Banner>
            )}
            {permissions.canEdit ? (
              <Row>
                {SETUP_STEPS.filter((step) => !project.setupStepsCompleted.includes(step)).map((step) => (
                  <ActionForm
                    key={step}
                    action={completeSetupStepAction}
                    submitLabel={`Mark "${SETUP_STEP_LABELS[step]}" done`}
                    render="inline"
                    hiddenFields={{ projectId: project.id, step }}
                  />
                ))}
              </Row>
            ) : null}
            <Sub style={{ fontSize: 12 }}>
              Categories, milestones, units, funding and tax assumptions are entered on their own screens; marking a step done
              records that the review has happened.
            </Sub>
          </CardBody>
        </Card>
      ) : null}

      {tab === 'policy' ? (
        <Stack>
          {current ? (
            <Card>
              <CardHeader title={`Current policy · v${current.version}`} aside={<Sub>Effective {formatDateLong(current.effectiveFrom)} · {current.createdByName}</Sub>} />
              <CardBody>
                <Grid columns={4}>
                  <Stat label="Actuals cutoff" value={formatDateLong(current.actualsCutoff)} meta="Periods on or before are locked" />
                  <Stat label="Standard GST" value={current.standardRateLabel} meta={current.displayBasis} />
                  <Stat label="Approval" value={current.twoPersonThreshold ? `2 approvers ≥ ${formatMoney(current.twoPersonThreshold)}` : 'One authorised approver'} meta="Self-approval prohibited" />
                  <Stat label="Funding" value="Equity, then ranked debt" meta={`Reserve ${formatMoney(current.minimumReserve)}`} />
                </Grid>
              </CardBody>
            </Card>
          ) : null}

          {permissions.canEdit ? (
            <Card>
              <CardHeader title="Publish a new policy version" aside={<Sub>Versions are immutable and effective dated (CAL05)</Sub>} />
              <CardBody>
                <ActionForm
                  action={publishPolicyAction}
                  submitLabel="Publish policy version"
                  hiddenFields={{ projectId: project.id }}
                  footnote={
                    <Sub style={{ fontSize: 12 }}>
                      Moving the actuals cutoff earlier reopens closed periods and needs the reopen permission
                      {permissions.canReopen ? ' (you have it)' : ' (you do not have it)'}. Margin scheme stays disabled until finance
                      review supplies a method (CAL11).
                    </Sub>
                  }
                >
                  {({ fieldErrors }) => (
                    <FieldGrid>
                      <TextField id="pp-cutoff" name="actualsCutoff" label="Actuals cutoff" type="date" defaultValue={current?.actualsCutoff} />
                      <TextField id="pp-effective" name="effectiveFrom" label="Effective from" type="date" defaultValue={today} />
                      <TextField id="pp-rate" name="standardRatePercent" label="Standard GST rate (%)" inputMode="decimal" defaultValue={current?.standardRateLabel.replace('%', '')} />
                      <SelectField id="pp-basis" name="displayBasis" label="Default display basis" defaultValue={current?.displayBasis.startsWith('Gross') ? 'gross' : 'economic'} options={[{ value: 'economic', label: 'Economic · net of recoverable GST' }, { value: 'gross', label: 'Gross · cash including GST' }]} />
                      <TextField id="pp-lag" name="settlementLagMonths" label="GST settlement lag (months)" type="number" min={0} max={6} defaultValue={1} />
                      <TextField id="pp-reserve" name="minimumReserve" label="Minimum cash reserve" inputMode="decimal" defaultValue={current ? (current.minimumReserve.cents / 100).toFixed(2) : '0.00'} />
                      <TextField id="pp-two" name="twoPersonThreshold" label="Two-person approval from (gross)" inputMode="decimal" defaultValue={current?.twoPersonThreshold ? (current.twoPersonThreshold.cents / 100).toFixed(2) : ''} hint="Leave blank for a single approver at any value" />
                      <SelectField id="pp-repay" name="repayExcessCash" label="Repay debt from excess cash" defaultValue="yes" options={[{ value: 'yes', label: 'Yes · by repayment rank' }, { value: 'no', label: 'No · hold cash' }]} />
                      <SelectField id="pp-auto" name="autoFundForecast" label="Fill forecast shortfalls automatically" defaultValue="yes" options={[{ value: 'yes', label: 'Yes · equity then ranked debt' }, { value: 'no', label: 'No · show as unfunded' }]} />
                      <TextField id="pp-reason" name="reason" label="Reason" required placeholder="September actuals reviewed and closed" invalid={Boolean(firstError(fieldErrors, 'reason'))} hint={firstError(fieldErrors, 'reason')} />
                    </FieldGrid>
                  )}
                </ActionForm>
              </CardBody>
            </Card>
          ) : null}

          <Card>
            <CardHeader title="Policy history" />
            <DataTable
              columns={[
                { header: 'Version', lead: true, render: (row: PolicyRow) => <CellMain>v{row.version} · {row.reason}</CellMain> },
                { header: 'Effective', render: (row: PolicyRow) => formatDateLong(row.effectiveFrom) },
                { header: 'Cutoff', render: (row: PolicyRow) => formatDateLong(row.actualsCutoff) },
                { header: 'GST', render: (row: PolicyRow) => row.standardRateLabel },
                { header: 'Reserve', align: 'right', render: (row: PolicyRow) => <span className="num">{formatMoney(row.minimumReserve)}</span> },
                { header: 'By', render: (row: PolicyRow) => row.createdByName },
              ]}
              rows={[...policies].reverse()}
              rowKey={(row) => String(row.version)}
            />
          </Card>
        </Stack>
      ) : null}

      {tab === 'members' ? <MembersTab project={project} members={members} people={people} participants={participants} canManage={permissions.canManageMembers} /> : null}

      {tab === 'lifecycle' ? (
        <Card>
          <CardHeader title="Lifecycle" aside={<Chip tone="neutral">{LIFECYCLE_LABELS[project.lifecycle]}</Chip>} />
          <CardBody className="stack">
            {project.lifecycleReason ? <Sub>Last reason: {project.lifecycleReason}</Sub> : null}
            <Sub style={{ fontSize: 12 }}>
              Archive is reversible and keeps history and reports; an archived project refuses new financial changes. Reopening
              needs a reason (PRJ03).
            </Sub>
            {permissions.canEdit ? (
              <ActionForm action={transitionProjectAction} submitLabel="Change state" hiddenFields={{ projectId: project.id }}>
                {({ fieldErrors }) => (
                  <FieldGrid>
                    <SelectField
                      id="pl-to" name="to" label="Move to"
                      options={LIFECYCLE_TRANSITIONS[project.lifecycle].map((state) => ({ value: state, label: LIFECYCLE_LABELS[state] }))}
                    />
                    <TextField id="pl-reason" name="reason" label="Reason" placeholder="Required for pause, archive and reopen" invalid={Boolean(firstError(fieldErrors, 'reason'))} hint={firstError(fieldErrors, 'reason')} />
                  </FieldGrid>
                )}
              </ActionForm>
            ) : null}
          </CardBody>
        </Card>
      ) : null}
    </Stack>
  );
}

function MembersTab({
  project,
  members,
  people,
  participants,
  canManage,
}: {
  readonly project: ProjectSettingsScreenProps['project'];
  readonly members: readonly MemberRow[];
  readonly people: readonly { readonly id: string; readonly name: string }[];
  readonly participants: readonly { readonly id: string; readonly name: string }[];
  readonly canManage: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const [role, setRole] = useState<ProjectRole>('viewer');

  const columns: readonly DataTableColumn<MemberRow>[] = [
    {
      header: 'Person',
      lead: true,
      render: (row) => (
        <>
          <CellMain>{row.name}</CellMain>
          <CellSub>{PROJECT_ROLE_LABELS[row.role]}{row.expiresAt ? ` · expires ${row.expiresAt}` : ''}</CellSub>
        </>
      ),
    },
    {
      header: 'Approval authority',
      render: (row) =>
        row.approvalLimit ? (
          <Chip tone="gold" icon="i-check">up to {formatMoney(row.approvalLimit)}</Chip>
        ) : (
          <Chip tone="neutral">No authority</Chip>
        ),
    },
    { header: 'Grants', render: (row) => (row.grants.length === 0 ? '—' : row.grants.map((grant) => PROJECT_GRANT_LABELS[grant]).join(' · ')) },
    {
      header: 'Status',
      render: (row) => (
        <Chip tone={row.status === 'active' ? 'good' : row.status === 'suspended' ? 'warn' : 'bad'} icon={row.status === 'active' ? 'i-check' : row.status === 'suspended' ? 'i-pause' : 'i-x'}>
          {row.status}
        </Chip>
      ),
    },
    {
      header: 'Actions',
      render: (row) =>
        canManage ? (
          <Row>
            {row.status === 'active' ? (
              <ActionForm action={setProjectAccessStatusAction} submitLabel="Suspend" render="inline" hiddenFields={{ projectId: project.id, accessId: row.accessId, status: 'suspended' }} />
            ) : (
              <ActionForm action={setProjectAccessStatusAction} submitLabel="Reactivate" render="inline" hiddenFields={{ projectId: project.id, accessId: row.accessId, status: 'active' }} />
            )}
            {row.status !== 'revoked' ? (
              <ActionForm action={setProjectAccessStatusAction} submitLabel="Revoke" render="inline" hiddenFields={{ projectId: project.id, accessId: row.accessId, status: 'revoked' }} />
            ) : null}
          </Row>
        ) : (
          '—'
        ),
    },
  ];

  return (
    <Stack>
      <Card>
        <CardHeader
          title="Members & authority"
          aside={canManage ? <Button small variant="primary" onClick={() => setAdding(true)}>+ Add or change member</Button> : <Sub>Roles are bundles; authority is the limit (IAM04)</Sub>}
        />
        {adding ? (
          <CardBody>
            <ActionForm
              action={grantProjectAccessAction}
              submitLabel="Save membership"
              onCancel={() => setAdding(false)}
              onSuccess={() => setAdding(false)}
              hiddenFields={{ projectId: project.id }}
              footnote={<Sub style={{ fontSize: 12 }}>{ROLE_DESCRIPTIONS[role]}</Sub>}
            >
              {({ fieldErrors }) => (
                <FieldGrid>
                  <SelectField id="pm-user" name="userId" label="Person" required options={[{ value: '', label: 'Choose a person…' }, ...people.map((person) => ({ value: person.id, label: person.name }))]} />
                  <SelectField
                    id="pm-role" name="role" label="Role" value={role} onChange={(event) => setRole(event.target.value as ProjectRole)}
                    options={PROJECT_ROLES.map((value) => ({ value, label: PROJECT_ROLE_LABELS[value] }))}
                    invalid={Boolean(firstError(fieldErrors, 'role'))} hint={firstError(fieldErrors, 'role')}
                  />
                  <TextField
                    id="pm-limit" name="approvalLimit" label="Approval limit (gross, incl. GST)" inputMode="decimal" placeholder="Leave blank for no authority"
                    invalid={Boolean(firstError(fieldErrors, 'approvalLimit'))} hint={firstError(fieldErrors, 'approvalLimit')}
                  />
                  <TextField id="pm-expires" name="expiresAt" label="Expires" type="date" />
                  {role === 'investor' ? (
                    <SelectField id="pm-participant" name="participantId" label="Participant" options={[{ value: '', label: 'Not linked' }, ...participants.map((participant) => ({ value: participant.id, label: participant.name }))]} />
                  ) : null}
                  <div className="field" style={{ gridColumn: '1 / -1' }}>
                    <label htmlFor="pm-grants">Grants</label>
                    <div className="row" id="pm-grants">
                      {PROJECT_GRANTS.map((grant) => (
                        <label key={grant} style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 12.5 }}>
                          <input type="checkbox" name="grants" value={grant} /> {PROJECT_GRANT_LABELS[grant]}
                        </label>
                      ))}
                    </div>
                  </div>
                </FieldGrid>
              )}
            </ActionForm>
          </CardBody>
        ) : null}
        <DataTable columns={columns} rows={members} rowKey={(row) => row.accessId} empty="No members yet." />
      </Card>
      <Sub style={{ fontSize: 12 }}>
        Revoking or suspending takes effect on the next request; a revoked person loses the screens, exports and Assistant
        answers of this project at once (IAM03).
      </Sub>
    </Stack>
  );
}
