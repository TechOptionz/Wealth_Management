'use client';

import { useState } from 'react';
import { Button } from '@/shared/components/Button';
import { Card } from '@/shared/components/Card';
import { Chip } from '@/shared/components/Chip';
import { DataTable, CellMain, CellSub, type DataTableColumn } from '@/shared/components/DataTable';
import { FilterGroup } from '@/shared/components/FilterGroup';
import { Grid, Row, Stack, Toolbar } from '@/shared/components/Layout';
import { formatMoney, type Money } from '@/shared/lib/money';
import { formatDateCompact, formatDateShort } from '@/shared/lib/dates';
import type { LeaseId, Tone } from '@/shared/types/common';
import type { IconName } from '@/shared/components/IconSprite';
import { Card as PanelCard, CardBody, CardHeader } from '@/shared/components/Card';
import { FieldGrid, TextField } from '@/shared/components/Field';
import { ActionForm, firstError } from '@/shared/components/ActionForm';
import { Sub } from '@/shared/components/Layout';
import { changeRentAction, recordRentPaymentAction, terminateLeaseAction } from '../actions';
import { FREQUENCY_SUFFIX, type LeaseLedger, type LeaseStatus } from '../model';
import type { LeaseFilter, LeaseView } from '../service';
import { NewLeaseForm, type NewLeaseFormProps } from './NewLeaseForm';
import { TenantStatementModal } from './TenantStatementModal';

const STATUS_CHIP: Record<LeaseStatus, { tone: Tone; icon: IconName; label: (days: number) => string }> = {
  active: { tone: 'good', icon: 'i-check', label: () => 'Active' },
  'ending-soon': { tone: 'warn', icon: 'i-clock', label: (days) => `Ends in ${days} days` },
  disputed: { tone: 'info', icon: 'i-pause', label: () => 'Disputed' },
  ended: { tone: 'neutral', icon: 'i-x', label: () => 'Ended' },
};

const FILTER_OPTIONS: readonly { value: LeaseFilter; label: string }[] = [
  { value: 'active', label: 'Active' },
  { value: 'ending-soon', label: 'Ending in 60 days' },
  { value: 'ended', label: 'Ended' },
];

const columns: readonly DataTableColumn<LeaseView>[] = [
  {
    header: 'Tenant',
    lead: true,
    render: (row) => (
      <>
        <CellMain>{row.tenantName}</CellMain>
        <CellSub>Ref {row.lease.reference}</CellSub>
      </>
    ),
  },
  { header: 'Property · component', mobileLabel: 'Property', render: (row) => row.propertyLabel },
  {
    header: 'Term',
    render: (row) => `${formatDateCompact(row.lease.startsOn)} – ${formatDateCompact(row.lease.endsOn)}`,
  },
  {
    header: 'Rent',
    align: 'right',
    render: (row) => (
      <span className="num">
        {formatMoney(row.lease.rent)} / {FREQUENCY_SUFFIX[row.lease.frequency]}
      </span>
    ),
  },
  {
    header: 'Next charge',
    render: (row) => (row.nextChargeOn ? formatDateShort(row.nextChargeOn) : 'Paused'),
  },
  {
    header: 'Status',
    render: (row) => {
      const chip = STATUS_CHIP[row.status];
      return (
        <Chip tone={chip.tone} icon={chip.icon}>
          {chip.label(row.daysUntilEnd)}
        </Chip>
      );
    },
  },
];

export interface LeasesScreenProps {
  readonly viewsByFilter: Record<LeaseFilter, readonly LeaseView[]>;
  readonly counts: Record<LeaseFilter, number>;
  readonly newLease: NewLeaseFormProps;
  readonly properties: readonly { readonly id: string; readonly name: string }[];
  readonly today: string;
  /** Outstanding balance per lease id; positive when the tenant is in arrears. */
  readonly outstandingByLease: Readonly<Record<string, Money>>;
  /** Running statement per lease id, as at `today` — what "View statement" opens. */
  readonly ledgerByLease: Readonly<Record<string, LeaseLedger>>;
}

/** Which lifecycle panel is open for the selected lease. */
type LeasePanelKind = 'terminate' | 'rent' | 'payment';
type LeasePanel = { readonly kind: LeasePanelKind; readonly view: LeaseView } | null;

const PANEL_LABELS: Record<LeasePanelKind, string> = {
  terminate: 'End lease early',
  rent: 'Change rent',
  payment: 'Record payment',
};
const PANEL_KINDS: readonly LeasePanelKind[] = ['terminate', 'rent', 'payment'];

/** FR-05 — leases, tenants and the new-lease form. */
export function LeasesScreen({
  viewsByFilter,
  counts,
  newLease,
  today,
  outstandingByLease,
  ledgerByLease,
}: LeasesScreenProps) {
  const [filter, setFilter] = useState<LeaseFilter>('active');
  const [panel, setPanel] = useState<LeasePanel>(null);
  const [isCreating, setCreating] = useState(false);
  const [viewingStatement, setViewingStatement] = useState<LeaseId | null>(null);
  const close = (): void => setPanel(null);
  const statement = viewingStatement ? ledgerByLease[viewingStatement] : undefined;

  return (
    <Stack>
      <Toolbar>
        <FilterGroup
          label="Filter leases"
          options={FILTER_OPTIONS.map((option) => ({
            value: option.value,
            label: option.label,
            ...(counts[option.value] > 0 && option.value !== 'ended' ? { count: counts[option.value] } : {}),
          }))}
          value={filter}
          onChange={setFilter}
        />
        <Row>
          <a className="btn sm" href="/api/export/leases" download>
            Export CSV
          </a>
          <Button variant="primary" onClick={() => setCreating(true)}>
            + New lease
          </Button>
        </Row>
      </Toolbar>

      <Grid columns={2}>
        <Card>
          <DataTable
            columns={columns}
            rows={viewsByFilter[filter]}
            rowKey={(row) => row.lease.id}
            onRowClick={(row) => setPanel({ kind: 'terminate', view: row })}
            isRowSelected={(row) => row.lease.id === panel?.view.lease.id}
            rowStyle={(row) => (row.lease.id === panel?.view.lease.id ? { background: 'var(--gold-soft)' } : undefined)}
            empty="No leases match this filter."
          />
        </Card>

        {panel ? (
          <PanelCard>
            <CardHeader
              title={`${panel.view.tenantName} · ${panel.view.lease.reference}`}
              aside={
                <Row>
                  {PANEL_KINDS.map((kind) => (
                    <Button
                      key={kind}
                      small
                      variant="ghost"
                      aria-pressed={panel.kind === kind}
                      onClick={() => setPanel({ kind, view: panel.view })}
                    >
                      {PANEL_LABELS[kind]}
                    </Button>
                  ))}
                  <Button small variant="ghost" onClick={() => setViewingStatement(panel.view.lease.id)}>
                    View statement
                  </Button>
                </Row>
              }
            />
            <CardBody>
              {panel.kind === 'terminate' ? (
                <ActionForm
                  action={terminateLeaseAction}
                  submitLabel="End lease"
                  onCancel={close}
                  onSuccess={close}
                  hiddenFields={{ leaseId: panel.view.lease.id }}
                  footnote={
                    <Sub style={{ fontSize: 12 }}>
                      Only unearned future charges are removed. Charges already due, and anything received against them,
                      are left untouched.
                    </Sub>
                  }
                >
                  {({ fieldErrors }) => (
                    <FieldGrid>
                      <TextField
                        id="term-date" name="endsOn" label="New end date" type="date" defaultValue={today} required
                        invalid={Boolean(firstError(fieldErrors, 'endsOn'))}
                        hint={firstError(fieldErrors, 'endsOn')}
                      />
                      <TextField
                        id="term-reason" name="reason" label="Reason" required placeholder="Tenant relocating"
                        invalid={Boolean(firstError(fieldErrors, 'reason'))}
                        hint={firstError(fieldErrors, 'reason')}
                      />
                    </FieldGrid>
                  )}
                </ActionForm>
              ) : panel.kind === 'payment' ? (
                <ActionForm
                  key={panel.view.lease.id}
                  action={recordRentPaymentAction}
                  submitLabel="Record payment"
                  onCancel={close}
                  onSuccess={close}
                  hiddenFields={{ leaseId: panel.view.lease.id }}
                  footnote={
                    <Sub style={{ fontSize: 12 }}>
                      The payment settles the oldest unpaid charges first. Anything left over is held as credit.
                    </Sub>
                  }
                >
                  {({ fieldErrors }) => {
                    const outstanding = outstandingByLease[panel.view.lease.id];
                    const suggested = outstanding && outstanding.cents > 0 ? outstanding : panel.view.lease.rent;
                    return (
                      <FieldGrid>
                        <TextField
                          id="pay-amount" name="amount" label="Amount received" required
                          defaultValue={(suggested.cents / 100).toFixed(2)}
                          invalid={Boolean(firstError(fieldErrors, 'amount'))}
                          hint={
                            firstError(fieldErrors, 'amount') ??
                            (outstanding && outstanding.cents > 0 ? `${formatMoney(outstanding)} outstanding` : undefined)
                          }
                        />
                        <TextField
                          id="pay-received" name="receivedOn" label="Date received" type="date" defaultValue={today} required
                          invalid={Boolean(firstError(fieldErrors, 'receivedOn'))}
                          hint={firstError(fieldErrors, 'receivedOn')}
                        />
                        <TextField id="pay-note" name="note" label="Note" placeholder="e.g. Bank transfer, cash" />
                      </FieldGrid>
                    );
                  }}
                </ActionForm>
              ) : (
                <ActionForm
                  action={changeRentAction}
                  submitLabel="Change rent"
                  onCancel={close}
                  onSuccess={close}
                  hiddenFields={{ leaseId: panel.view.lease.id }}
                  footnote={
                    <Sub style={{ fontSize: 12 }}>
                      Only future unpaid charges are repriced. Paid history is never restated.
                    </Sub>
                  }
                >
                  {({ fieldErrors }) => (
                    <FieldGrid>
                      <TextField
                        id="rent-new" name="rent" label="New rent" required
                        defaultValue={(panel.view.lease.rent.cents / 100).toFixed(2)}
                        invalid={Boolean(firstError(fieldErrors, 'rent'))}
                        hint={firstError(fieldErrors, 'rent')}
                      />
                      <TextField
                        id="rent-from" name="effectiveFrom" label="Effective from" type="date" defaultValue={today} required
                      />
                    </FieldGrid>
                  )}
                </ActionForm>
              )}
            </CardBody>
          </PanelCard>
        ) : isCreating ? (
          <NewLeaseForm {...newLease} onClose={() => setCreating(false)} />
        ) : (
          <NewLeaseForm {...newLease} />
        )}
      </Grid>

      {statement ? <TenantStatementModal ledger={statement} onClose={() => setViewingStatement(null)} /> : null}
    </Stack>
  );
}
