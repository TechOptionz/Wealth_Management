'use client';

import { useActionState, useState } from 'react';
import { ActionForm, firstError } from '@/shared/components/ActionForm';
import { Banner } from '@/shared/components/Banner';
import { Button } from '@/shared/components/Button';
import { Card, CardBody, CardHeader } from '@/shared/components/Card';
import { Chip } from '@/shared/components/Chip';
import { CellMain, CellSub, DataTable, type DataTableColumn } from '@/shared/components/DataTable';
import { FieldGrid, TextField } from '@/shared/components/Field';
import { Grid, Row, Stack, Stat, Sub } from '@/shared/components/Layout';
import { IDLE_RESULT, type ActionResult } from '@/shared/lib/action-result';
import { formatDateLong } from '@/shared/lib/dates';
import { formatPercent, money } from '@/shared/lib/money';
import { XIRR_UNAVAILABLE_LABELS, type ParticipantAllocation } from '@/shared/finance-engine';
import { approveWaterfallAction, previewDistributionAction, publishWaterfallAction, recordDistributionAction } from '../actions';
import { WATERFALL_BASIS_LABELS, WATERFALL_STATE_LABELS, WATERFALL_TIER_LABELS, type WaterfallTier } from '../model';
import type { DistributionPreviewView, FinanceScreenData, WaterfallVersionView } from '../api';
import { exact, toInput, whole } from './format';

/** WFL01–WFL04 — the agreement, its approval trail and a read-only distribution preview. */
export function WaterfallTab({ data }: { readonly data: FinanceScreenData }) {
  const { waterfall, project, permissions } = data;
  const [previewState, previewAction, previewPending] = useActionState(previewDistributionAction, IDLE_RESULT as ActionResult<unknown>);
  const [inputs, setInputs] = useState({ availableCash: '', requiredDebt: '0.00' });
  const preview = previewState.ok ? (previewState.value as DistributionPreviewView | undefined) : undefined;

  return (
    <Stack>
      {waterfall.current ? (
        <VersionCard view={waterfall.current} names={waterfall.participantNames} title={`Current agreement · v${waterfall.current.version.version}`} />
      ) : (
        <Banner tone="warn" title="No published agreement — preview unavailable">
          Draft, approve and publish a distribution agreement before any distribution can be previewed or recorded (WFL04).
        </Banner>
      )}

      <Card>
        <CardHeader title="Agreement versions" aside={<Sub>Approval by a second authorised person before publication</Sub>} />
        <DataTable
          columns={versionColumns(project, permissions)}
          rows={[...waterfall.versions].reverse()}
          rowKey={(row) => row.version.id}
          empty="No agreement versions yet."
        />
      </Card>

      <Card>
        <CardHeader title="Distribution preview" aside={<Sub>A read: nothing is paid or recorded</Sub>} />
        <CardBody>
          <form
            action={previewAction}
            className="stack"
            onChange={(event) => {
              const form = event.currentTarget;
              setInputs({
                availableCash: (form.elements.namedItem('availableCash') as HTMLInputElement | null)?.value ?? '',
                requiredDebt: (form.elements.namedItem('requiredDebt') as HTMLInputElement | null)?.value ?? '',
              });
            }}
          >
            <input type="hidden" name="projectId" value={project.id} />
            <input type="hidden" name="asOf" value={data.asOf} />
            <FieldGrid>
              <TextField
                id="wp-cash" name="availableCash" label="Available cash" inputMode="decimal" placeholder="1,300,000.00" required
                invalid={!previewState.ok && Boolean(previewState.fieldErrors?.availableCash)}
                hint={(!previewState.ok ? previewState.fieldErrors?.availableCash?.[0] : undefined) ?? 'Cash after obligations, at the as-of date'}
              />
              <TextField id="wp-debt" name="requiredDebt" label="Required debt service" inputMode="decimal" defaultValue="0.00" />
            </FieldGrid>
            {!previewState.ok && previewState.message ? (
              <Banner tone="warn" title={previewState.message} />
            ) : null}
            <Row>
              <Button variant="primary" type="submit" disabled={previewPending || !waterfall.current}>
                {previewPending ? 'Calculating…' : 'Preview distribution'}
              </Button>
              {!waterfall.current ? <Sub>Unavailable until an agreement is published.</Sub> : null}
            </Row>
          </form>
        </CardBody>
      </Card>

      {preview ? <PreviewResult preview={preview} /> : null}

      {preview ? (
        <Card>
          <CardHeader title="Record this distribution" />
          <CardBody>
            {permissions.canEdit ? (
              <ActionForm
                action={recordDistributionAction}
                submitLabel="Record distribution"
                hiddenFields={{
                  projectId: project.id,
                  revision: String(project.modelRevision),
                  availableCash: inputs.availableCash || toInput(preview.availableCash),
                  requiredDebt: inputs.requiredDebt || toInput(preview.requiredDebt),
                  asOf: preview.asOf,
                }}
                footnote={
                  <Sub style={{ fontSize: 12 }}>
                    Records return-of-capital, preferred-return and profit movements per participant under v{preview.version.version}. It
                    records a decision; it does not pay anyone, and no automation can run it.
                  </Sub>
                }
              />
            ) : (
              <Banner tone="info" title="Recording needs finance edit permission">
                You can preview; ask a finance editor to record the distribution.
              </Banner>
            )}
          </CardBody>
        </Card>
      ) : null}
    </Stack>
  );
}

function VersionCard({ view, names, title }: { readonly view: WaterfallVersionView; readonly names: Readonly<Record<string, string>>; readonly title: string }) {
  const { version } = view;
  return (
    <Card>
      <CardHeader
        title={title}
        aside={
          <Chip tone="good" icon="i-check">
            {WATERFALL_STATE_LABELS[version.state]}
          </Chip>
        }
      />
      <CardBody className="stack">
        <Grid columns={4}>
          <Stat label="Reserve retained" value={whole(version.reserve)} />
          <Stat label="Effective from" value={formatDateLong(version.effectiveFrom)} meta={version.reason} />
          <Stat label="Drafted by" value={view.draftedByName} />
          <Stat label="Approved by" value={view.approvedByName ?? '—'} meta={version.approvedAt ? formatDateLong(version.approvedAt.slice(0, 10)) : undefined} />
        </Grid>
      </CardBody>
      <DataTable columns={tierColumns(names)} rows={version.tiers} rowKey={(row) => String(row.order)} />
    </Card>
  );
}

function tierColumns(names: Readonly<Record<string, string>>): readonly DataTableColumn<WaterfallTier>[] {
  return [
    { header: 'Tier', lead: true, render: (row) => <CellMain>{row.order}. {WATERFALL_TIER_LABELS[row.kind]}</CellMain> },
    { header: 'Basis', render: (row) => WATERFALL_BASIS_LABELS[row.basis] },
    { header: 'Participants', render: (row) => (row.participantIds ? row.participantIds.map((id) => names[id] ?? id).join(', ') : row.kind === 'required-debt' || row.kind === 'reserve' ? '—' : 'All participants') },
    { header: 'Rounding', render: () => 'Residual cent to last participant by id' },
  ];
}

function versionColumns(
  project: FinanceScreenData['project'],
  permissions: FinanceScreenData['permissions'],
): readonly DataTableColumn<WaterfallVersionView>[] {
  return [
    {
      header: 'Version',
      lead: true,
      render: (row) => (
        <>
          <CellMain>v{row.version.version} · {row.version.reason}</CellMain>
          <CellSub>Drafted by {row.draftedByName}{row.approvedByName ? ` · approved by ${row.approvedByName}` : ''}</CellSub>
        </>
      ),
    },
    {
      header: 'State',
      render: (row) => (
        <Chip tone={row.version.state === 'published' ? 'good' : row.version.state === 'approved' ? 'info' : 'neutral'} icon={row.version.state === 'draft' ? 'i-clock' : 'i-check'}>
          {WATERFALL_STATE_LABELS[row.version.state]}
        </Chip>
      ),
    },
    { header: 'Reserve', align: 'right', render: (row) => <span className="num">{whole(row.version.reserve)}</span> },
    {
      header: 'Actions',
      render: (row) => {
        if (row.version.state === 'published') return '—';
        if (!permissions.canPublish) return <Sub>Needs publishing authority</Sub>;
        if (row.version.state === 'draft') {
          if (!row.canApproveHere) return <Sub>You drafted this version; another person must approve it</Sub>;
          return (
            <ActionForm action={approveWaterfallAction} submitLabel="Approve" hiddenFields={{ projectId: project.id, versionId: row.version.id }}>
              {({ fieldErrors }) => (
                <TextField id={`wa-reason-${row.version.id}`} name="reason" label="Reason" required invalid={Boolean(firstError(fieldErrors, 'reason'))} hint={firstError(fieldErrors, 'reason')} />
              )}
            </ActionForm>
          );
        }
        return (
          <ActionForm
            action={publishWaterfallAction}
            submitLabel="Publish"
            render="inline"
            submitVariant="primary"
            hiddenFields={{ projectId: project.id, versionId: row.version.id, revision: String(project.modelRevision) }}
          />
        );
      },
    },
  ];
}

function PreviewResult({ preview }: { readonly preview: DistributionPreviewView }) {
  const { result } = preview;
  const name = (id: string): string => preview.participantNames[id] ?? id;
  const columns: readonly DataTableColumn<ParticipantAllocation>[] = [
    { header: 'Participant', lead: true, render: (row) => <CellMain>{name(row.participantId)}</CellMain> },
    {
      header: 'Return of capital',
      align: 'right',
      render: (row) => (
        <>
          <span className="num">{exact(money(row.capitalReturnCents))}</span>
          {row.capitalShortfallCents > 0 ? <CellSub>Carried forward {exact(money(row.capitalShortfallCents))}</CellSub> : null}
        </>
      ),
    },
    {
      header: 'Preferred return',
      align: 'right',
      render: (row) => (
        <>
          <span className="num">{exact(money(row.preferredReturnCents))}</span>
          {row.preferredShortfallCents > 0 ? <CellSub>Carried forward {exact(money(row.preferredShortfallCents))}</CellSub> : null}
        </>
      ),
    },
    { header: 'Residual profit', align: 'right', render: (row) => <span className="num">{exact(money(row.residualProfitCents))}</span> },
    { header: 'Total', align: 'right', render: (row) => <span className="num" style={{ fontWeight: 500 }}>{exact(money(row.totalCents))}</span> },
  ];

  return (
    <Card>
      <CardHeader title={`Preview under agreement v${preview.version.version}`} aside={<Sub>As of {formatDateLong(preview.asOf)}</Sub>} />
      <CardBody>
        <Grid columns={4}>
          <Stat label="Available cash" value={exact(preview.availableCash)} />
          <Stat label="Required debt paid" value={exact(money(result.debtPaidCents))} meta={result.debtShortfallCents > 0 ? `Shortfall ${exact(money(result.debtShortfallCents))}` : undefined} />
          <Stat label="Reserve retained" value={exact(money(result.reserveRetainedCents))} meta={result.reserveShortfallCents > 0 ? `Shortfall ${exact(money(result.reserveShortfallCents))}` : undefined} />
          <Stat label="Distributed · residual cash" value={exact(money(result.totalDistributedCents))} meta={`Residual cash ${exact(money(result.residualCashCents))}`} />
        </Grid>
      </CardBody>
      <DataTable columns={columns} rows={result.allocations} rowKey={(row) => row.participantId} />
      <CardBody>
        <Row>
          {preview.participantMetrics.map((metric) => (
            <Stat
              key={metric.participantId}
              label={metric.name}
              value={exact(money(metric.totalCents))}
              meta={`IRR incl. this distribution: ${metric.irr.available ? formatPercent(metric.irr.rate, 2) : XIRR_UNAVAILABLE_LABELS[metric.irr.reason]}`}
            />
          ))}
        </Row>
      </CardBody>
    </Card>
  );
}
