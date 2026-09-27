'use client';

import { useState } from 'react';
import { ActionForm, firstError } from '@/shared/components/ActionForm';
import { Button } from '@/shared/components/Button';
import { Card, CardBody, CardHeader } from '@/shared/components/Card';
import { Chip } from '@/shared/components/Chip';
import { CellMain, CellSub, DataTable, type DataTableColumn } from '@/shared/components/DataTable';
import { FieldGrid, SelectField, TextField } from '@/shared/components/Field';
import { Kpi, KpiGrid } from '@/shared/components/Kpi';
import { Grid, Row, Stack, Stat, Sub } from '@/shared/components/Layout';
import { formatDateLong } from '@/shared/lib/dates';
import { money } from '@/shared/lib/money';
import { createParticipantAction, recordEquityMovementAction } from '../actions';
import {
  EQUITY_MOVEMENT_TYPE_LABELS,
  EQUITY_MOVEMENT_TYPES,
  PARTICIPANT_CLASS_LABELS,
  PARTICIPANT_CLASSES,
  type CapitalAccount,
  type EquityMovement,
} from '../model';
import type { FinanceScreenData, ParticipantView } from '../api';
import { exact, whole } from './format';

type Panel = 'none' | 'movement' | 'participant';

/** EQ01–EQ02 — participants, capital accounts and dated contributions and distributions. */
export function EquityTab({ data }: { readonly data: FinanceScreenData }) {
  const { equity, project, permissions } = data;
  const [selectedId, setSelectedId] = useState<string | null>(equity.participants[0]?.participant.id ?? null);
  const [panel, setPanel] = useState<Panel>('none');
  const selected = equity.participants.find((view) => view.participant.id === selectedId) ?? null;
  const hidden = { projectId: project.id, revision: String(project.modelRevision) };

  const columns: readonly DataTableColumn<ParticipantView>[] = [
    {
      header: 'Participant',
      lead: true,
      render: (row) => (
        <>
          <CellMain>{row.participant.name}</CellMain>
          <CellSub>
            {PARTICIPANT_CLASS_LABELS[row.participant.class]}
            {row.participant.investorReference ? ` · ${row.participant.investorReference}` : ''} · residual share {row.participant.residualShareWeight}
          </CellSub>
        </>
      ),
    },
    { header: 'Commitment', align: 'right', render: (row) => <span className="num">{whole(row.participant.commitment)}</span> },
    { header: 'Contributed', align: 'right', render: (row) => <span className="num">{whole(row.account.contributed)}</span> },
    { header: 'Outstanding capital', align: 'right', render: (row) => <span className="num">{whole(row.account.outstanding)}</span> },
    {
      header: 'Preferred accrued / paid',
      mobileLabel: 'Preferred',
      align: 'right',
      render: (row) => (
        <span className="num">
          {exact(row.account.preferredAccrued)} / {exact(row.account.preferredPaid)}
        </span>
      ),
    },
    { header: 'Pref. rate', render: (row) => row.preferredRateLabel },
    {
      header: 'IRR',
      render: (row) =>
        row.irr.available ? (
          row.irrLabel
        ) : (
          <Chip tone="neutral" icon="i-clock">
            {row.irrLabel}
          </Chip>
        ),
    },
  ];

  return (
    <Stack>
      <KpiGrid>
        <Kpi label="Total commitments" value={whole(equity.totalCommitment)} footer={<Sub>{equity.participants.length} participants</Sub>} />
        <Kpi label="Contributed (actual)" value={whole(equity.totalContributed)} footer={<Sub>Financing inflows, not revenue</Sub>} />
        <Kpi label="Outstanding capital" value={whole(equity.totalOutstanding)} footer={<Sub>Contributions less capital returned</Sub>} />
        <Kpi
          label="Peak equity"
          help="Highest cumulative contributions less capital returned, by day (CAL20)."
          value={whole(money(equity.peakEquity.cents))}
          valueSuffix={equity.peakEquity.on ? formatDateLong(equity.peakEquity.on) : 'none yet'}
        />
      </KpiGrid>

      <Card>
        <CardHeader
          title="Equity participants"
          aside={
            permissions.canEdit ? (
              <Row>
                <Button small variant="primary" onClick={() => setPanel('movement')} aria-pressed={panel === 'movement'}>
                  Record contribution or distribution
                </Button>
                <Button small onClick={() => setPanel('participant')} aria-pressed={panel === 'participant'}>
                  + Participant
                </Button>
              </Row>
            ) : (
              <Sub>Read only</Sub>
            )
          }
        />
        {panel === 'movement' ? (
          <CardBody>
            <ActionForm
              action={recordEquityMovementAction}
              submitLabel="Record movement"
              hiddenFields={hidden}
              onCancel={() => setPanel('none')}
              onSuccess={() => setPanel('none')}
              footnote={
                <Sub style={{ fontSize: 12 }}>
                  A contribution may not exceed the remaining commitment. A distribution is recorded as separate return-of-capital,
                  preferred-return and profit components — use the Waterfall tab to record all three from the agreement.
                </Sub>
              }
            >
              {({ fieldErrors }) => (
                <FieldGrid>
                  <SelectField id="em-participant" name="participantId" label="Participant" defaultValue={selectedId ?? undefined} options={equity.participants.map((view) => ({ value: view.participant.id, label: view.participant.name }))} />
                  <SelectField id="em-type" name="type" label="Type" defaultValue="contribution" options={EQUITY_MOVEMENT_TYPES.map((type) => ({ value: type, label: EQUITY_MOVEMENT_TYPE_LABELS[type] }))} />
                  <TextField id="em-on" name="on" label="Date" type="date" defaultValue={data.asOf} required invalid={Boolean(firstError(fieldErrors, 'on'))} hint={firstError(fieldErrors, 'on')} />
                  <TextField id="em-amount" name="amount" label="Amount" inputMode="decimal" placeholder="150,000.00" required invalid={Boolean(firstError(fieldErrors, 'amount'))} hint={firstError(fieldErrors, 'amount')} />
                  <SelectField id="em-basis" name="basis" label="Basis" defaultValue="actual" options={[{ value: 'actual', label: 'Actual · recorded' }, { value: 'planned', label: 'Planned · forecast' }]} />
                  <TextField id="em-note" name="note" label="Note" />
                </FieldGrid>
              )}
            </ActionForm>
          </CardBody>
        ) : null}
        {panel === 'participant' ? (
          <CardBody>
            <ActionForm action={createParticipantAction} submitLabel="Add participant" hiddenFields={hidden} onCancel={() => setPanel('none')} onSuccess={() => setPanel('none')}>
              {({ fieldErrors }) => (
                <FieldGrid>
                  <TextField id="np-name" name="name" label="Name" required invalid={Boolean(firstError(fieldErrors, 'name'))} hint={firstError(fieldErrors, 'name')} />
                  <TextField id="np-ref" name="investorReference" label="Investor reference" hint="Private to finance editors and that investor" />
                  <SelectField id="np-class" name="class" label="Class" defaultValue="ordinary" options={PARTICIPANT_CLASSES.map((value) => ({ value, label: PARTICIPANT_CLASS_LABELS[value] }))} />
                  <TextField id="np-commitment" name="commitment" label="Commitment" inputMode="decimal" required invalid={Boolean(firstError(fieldErrors, 'commitment'))} hint={firstError(fieldErrors, 'commitment')} />
                  <TextField id="np-weight" name="participationWeight" label="Participation weight" inputMode="decimal" defaultValue="1" />
                  <TextField
                    id="np-pref" name="preferredRate" label="Preferred return (%)" inputMode="decimal" defaultValue="0"
                    invalid={Boolean(firstError(fieldErrors, 'preferredRate'))} hint={firstError(fieldErrors, 'preferredRate') ?? 'Enter 8 for 8% simple, ACT/365F'}
                  />
                  <TextField id="np-residual" name="residualShareWeight" label="Residual profit share" inputMode="decimal" defaultValue="0" hint="Relative weight, e.g. 30" />
                </FieldGrid>
              )}
            </ActionForm>
          </CardBody>
        ) : null}
        <DataTable
          columns={columns}
          rows={equity.participants}
          rowKey={(row) => row.participant.id}
          onRowClick={(row) => setSelectedId(row.participant.id)}
          isRowSelected={(row) => row.participant.id === selectedId}
          empty="No participants yet."
        />
      </Card>

      {selected ? (
        <CapitalAccountCard name={selected.participant.name} account={selected.account} remaining={selected.remainingCommitment} irrLabel={selected.irrLabel} movements={selected.movements} asOf={data.asOf} />
      ) : null}
    </Stack>
  );
}

/** The capital account for one participant — shared by the editor view and the investor's own card (EQ02, EQ03). */
export function CapitalAccountCard({
  name,
  account,
  remaining,
  irrLabel,
  movements,
  asOf,
}: {
  readonly name: string;
  readonly account: CapitalAccount;
  readonly remaining: CapitalAccount['contributed'];
  readonly irrLabel: string;
  readonly movements: readonly EquityMovement[];
  readonly asOf: string;
}) {
  return (
    <Card>
      <CardHeader title={`Capital account · ${name}`} aside={<Sub>As of {formatDateLong(asOf)} · actual movements only</Sub>} />
      <CardBody>
        <Grid columns={4}>
          <Stat label="Contributed" value={exact(account.contributed)} meta={`Remaining commitment ${exact(remaining)}`} />
          <Stat label="Capital returned" value={exact(account.capitalReturned)} meta={`Outstanding ${exact(account.outstanding)}`} />
          <Stat label="Preferred return" value={exact(account.preferredAccrued)} meta={`Paid ${exact(account.preferredPaid)} · owed ${exact(account.preferredOutstanding)}`} />
          <Stat label="Profit distributed" value={exact(account.profitDistributed)} meta={`IRR ${irrLabel}`} />
        </Grid>
      </CardBody>
      <DataTable
        columns={equityMovementColumns}
        rows={movements}
        rowKey={(row) => row.id}
        empty="No movements yet."
      />
    </Card>
  );
}

const equityMovementColumns: readonly DataTableColumn<EquityMovement>[] = [
  {
    header: 'Date',
    lead: true,
    render: (row) => (
      <>
        <CellMain>{formatDateLong(row.on)}</CellMain>
        <CellSub>{row.note ?? '—'}</CellSub>
      </>
    ),
  },
  { header: 'Type', render: (row) => EQUITY_MOVEMENT_TYPE_LABELS[row.type] },
  {
    header: 'Basis',
    render: (row) =>
      row.basis === 'actual' ? (
        <Chip tone="good" icon="i-check">
          Actual
        </Chip>
      ) : (
        <Chip tone="info" icon="i-clock">
          Planned
        </Chip>
      ),
  },
  {
    header: 'Amount',
    align: 'right',
    render: (row) => <span className="num">{row.type === 'contribution' ? exact(row.amount) : `+${exact(row.amount)}`}</span>,
  },
];
