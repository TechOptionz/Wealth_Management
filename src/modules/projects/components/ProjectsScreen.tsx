'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ActionForm, firstError } from '@/shared/components/ActionForm';
import { Button } from '@/shared/components/Button';
import { Card, CardBody, CardHeader } from '@/shared/components/Card';
import { Chip } from '@/shared/components/Chip';
import { DataTable, CellMain, CellSub, type DataTableColumn } from '@/shared/components/DataTable';
import { FieldGrid, SelectField, TextField } from '@/shared/components/Field';
import { Kpi, KpiGrid } from '@/shared/components/Kpi';
import { Row, Stack, Sub, Toolbar } from '@/shared/components/Layout';
import { Stepper } from '@/shared/components/Stepper';
import { formatDateCompact } from '@/shared/lib/dates';
import type { IconName } from '@/shared/components/IconSprite';
import type { Tone } from '@/shared/types/common';
import { createProjectAction } from '../actions';
import {
  AUSTRALIAN_STATES,
  LIFECYCLE_LABELS,
  PROJECT_TYPE_LABELS,
  PROJECT_TYPES,
  SETUP_STEPS,
  SETUP_STEP_LABELS,
  type ProjectLifecycle,
  type ProjectType,
} from '../model';

export interface ProjectListRow {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly type: ProjectType;
  readonly state: string;
  readonly lifecycle: ProjectLifecycle;
  readonly startDate: string;
  readonly expectedCompletion: string;
  readonly modelRevision: number;
  readonly memberCount: number;
  readonly roleLabel: string;
  readonly setupStepsCompleted: readonly string[];
  readonly activationBlockers: readonly string[];
}

export interface ProjectsScreenProps {
  readonly rows: readonly ProjectListRow[];
  readonly legalEntities: readonly { readonly id: string; readonly name: string }[];
  readonly today: string;
  readonly canCreate: boolean;
}

const LIFECYCLE_CHIP: Record<ProjectLifecycle, { tone: Tone; icon: IconName }> = {
  draft: { tone: 'neutral', icon: 'i-clock' },
  active: { tone: 'good', icon: 'i-check' },
  paused: { tone: 'warn', icon: 'i-pause' },
  completed: { tone: 'info', icon: 'i-check-sq' },
  archived: { tone: 'neutral', icon: 'i-x' },
};

/** PRJ01–PRJ03 — the projects the person may open, and the first step of the setup wizard. */
export function ProjectsScreen({ rows, legalEntities, today, canCreate }: ProjectsScreenProps) {
  const [isCreating, setCreating] = useState(false);

  const columns: readonly DataTableColumn<ProjectListRow>[] = [
    {
      header: 'Project',
      lead: true,
      render: (row) => (
        <>
          <CellMain>
            <Link href={`/projects/${encodeURIComponent(row.id)}/summary`}>
              {row.code} · {row.name}
            </Link>
          </CellMain>
          <CellSub>
            {PROJECT_TYPE_LABELS[row.type]} · {row.state}
          </CellSub>
        </>
      ),
    },
    {
      header: 'State',
      render: (row) => (
        <Chip tone={LIFECYCLE_CHIP[row.lifecycle].tone} icon={LIFECYCLE_CHIP[row.lifecycle].icon}>
          {LIFECYCLE_LABELS[row.lifecycle]}
        </Chip>
      ),
    },
    { header: 'Your role', render: (row) => row.roleLabel },
    { header: 'Start', render: (row) => formatDateCompact(row.startDate) },
    { header: 'Completion', render: (row) => formatDateCompact(row.expectedCompletion) },
    { header: 'Model rev', align: 'right', render: (row) => <span className="num">{row.modelRevision}</span> },
    { header: 'Members', align: 'right', render: (row) => <span className="num">{row.memberCount}</span> },
    {
      header: 'Setup',
      render: (row) =>
        row.lifecycle === 'draft' ? (
          <Chip tone={row.activationBlockers.length === 0 ? 'good' : 'warn'} icon={row.activationBlockers.length === 0 ? 'i-check' : 'i-alert'}>
            {row.setupStepsCompleted.length} of {SETUP_STEPS.length} steps
          </Chip>
        ) : (
          <Chip tone="neutral">Complete</Chip>
        ),
    },
  ];

  const active = rows.filter((row) => row.lifecycle === 'active').length;
  const drafts = rows.filter((row) => row.lifecycle === 'draft').length;

  return (
    <Stack>
      <Toolbar>
        <Sub>Development projects you are a member of · organisation admins see every project</Sub>
        {canCreate ? (
          <Button variant="primary" onClick={() => setCreating(true)}>
            + New project
          </Button>
        ) : null}
      </Toolbar>

      {isCreating ? (
        <Card>
          <CardHeader
            title="New project · step 1 of 8 · identity"
            aside={<Sub>Save a draft now; the other steps live in project settings</Sub>}
          />
          <CardBody className="stack">
            <Stepper
              label="Setup steps"
              steps={SETUP_STEPS.map((step, index) => ({ label: SETUP_STEP_LABELS[step], state: index === 0 ? 'current' : 'todo' }))}
            />
            <ActionForm
              action={createProjectAction}
              submitLabel="Create draft project"
              onCancel={() => setCreating(false)}
              onSuccess={() => setCreating(false)}
              footnote={
                <Sub style={{ fontSize: 12 }}>
                  The address is descriptive; it never decides tax treatment. Publication is blocked until every step is
                  complete and the opening balances reconcile (PRJ02).
                </Sub>
              }
            >
              {({ fieldErrors }) => (
                <FieldGrid>
                  <TextField
                    id="pj-code" name="code" label="Project code" required placeholder="RVT-02"
                    invalid={Boolean(firstError(fieldErrors, 'code'))} hint={firstError(fieldErrors, 'code') ?? 'Unique within the organisation'}
                  />
                  <TextField
                    id="pj-name" name="name" label="Project name" required placeholder="Riverside Townhomes stage 2"
                    invalid={Boolean(firstError(fieldErrors, 'name'))} hint={firstError(fieldErrors, 'name')}
                  />
                  <SelectField
                    id="pj-entity" name="legalEntityId" label="Owning legal entity" required
                    invalid={Boolean(firstError(fieldErrors, 'legalEntityId'))} hint={firstError(fieldErrors, 'legalEntityId')}
                    options={[{ value: '', label: 'Choose an entity…' }, ...legalEntities.map((entity) => ({ value: entity.id, label: entity.name }))]}
                  />
                  <SelectField
                    id="pj-type" name="type" label="Project type" defaultValue="townhouses"
                    options={PROJECT_TYPES.map((type) => ({ value: type, label: PROJECT_TYPE_LABELS[type] }))}
                  />
                  <TextField id="pj-address" name="address" label="Address" required placeholder="Lot 12, Logan Reserve QLD 4133" />
                  <SelectField
                    id="pj-state" name="state" label="State" defaultValue="QLD"
                    options={AUSTRALIAN_STATES.map((state) => ({ value: state, label: state }))}
                  />
                  <TextField id="pj-start" name="startDate" label="Start date" type="date" required defaultValue={today} />
                  <TextField
                    id="pj-completion" name="expectedCompletion" label="Expected completion" type="date" required
                    invalid={Boolean(firstError(fieldErrors, 'expectedCompletion'))} hint={firstError(fieldErrors, 'expectedCompletion')}
                  />
                  <TextField
                    id="pj-horizon" name="forecastHorizonMonths" label="Forecast horizon (months)" type="number" min={1} max={120} defaultValue={24}
                    invalid={Boolean(firstError(fieldErrors, 'forecastHorizonMonths'))} hint={firstError(fieldErrors, 'forecastHorizonMonths')}
                  />
                  <SelectField
                    id="pj-basis" name="reportingBasis" label="Reporting basis" defaultValue="accrual"
                    options={[{ value: 'accrual', label: 'Accrual' }, { value: 'cash', label: 'Cash' }]}
                  />
                  <TextField id="pj-cash" name="openingCash" label="Opening unrestricted cash" inputMode="decimal" placeholder="$0.00" />
                  <TextField id="pj-restricted" name="openingRestrictedCash" label="Opening restricted (trust) cash" inputMode="decimal" placeholder="$0.00" />
                </FieldGrid>
              )}
            </ActionForm>
          </CardBody>
        </Card>
      ) : null}

      <KpiGrid>
        <Kpi accent label="Projects you can open" value={rows.length} footer={`${active} active · ${drafts} draft`} />
        <Kpi label="Currency" value="AUD" footer="Single-currency projects · Australia/Brisbane" />
        <Kpi label="Accounting connection" value="None" footer="No provider connected · imports are reviewed manually" />
        <Kpi label="Engine" value="1.0.0" footer="Same calculation for grid, summary, reports and Assistant" />
      </KpiGrid>

      <Card>
        <CardHeader title="Projects" aside={<Sub>Open a project to reach its Cashflow, Summary, Invoices and more</Sub>} />
        <DataTable columns={columns} rows={rows} rowKey={(row) => row.id} empty="You are not a member of any development project yet." />
      </Card>
      <Row>
        <Sub style={{ fontSize: 12 }}>
          Membership is per project. An organisation admin reads every project; anyone else sees only the projects they
          were added to (IAM01).
        </Sub>
      </Row>
    </Stack>
  );
}
