'use client';

import { useState } from 'react';
import { ActionForm, firstError } from '@/shared/components/ActionForm';
import { Button } from '@/shared/components/Button';
import { Card, CardBody, CardHeader } from '@/shared/components/Card';
import { Chip } from '@/shared/components/Chip';
import { CellMain, CellSub, DataTable, type DataTableColumn } from '@/shared/components/DataTable';
import { FieldGrid, SelectField, TextField } from '@/shared/components/Field';
import { Kpi, KpiGrid } from '@/shared/components/Kpi';
import { Row, Stack, Sub } from '@/shared/components/Layout';
import { Banner } from '@/shared/components/Banner';
import { formatDateLong } from '@/shared/lib/dates';
import { money } from '@/shared/lib/money';
import { formatPpmAsPercent } from '@/shared/finance-engine';
import { addRateStepAction, createFacilityAction, recordFacilityMovementAction } from '../actions';
import {
  FACILITY_TYPE_LABELS,
  FACILITY_TYPES,
  INTEREST_TREATMENT_LABELS,
  MOVEMENT_KIND_LABELS,
  type FacilityMovement,
} from '../model';
import type { FacilityMonthRow, FacilityView, FinanceScreenData } from '../api';
import { exact, monthLabel, whole } from './format';

type Panel = 'none' | 'movement' | 'rate';

/** FIN01–FIN06 — facilities, their monthly rollup and dated movements. */
export function DebtTab({ data }: { readonly data: FinanceScreenData }) {
  const { debt, project, permissions } = data;
  const [selectedId, setSelectedId] = useState<string | null>(debt.facilities[0]?.facility.id ?? null);
  const [creating, setCreating] = useState(false);
  const [panel, setPanel] = useState<Panel>('none');
  const selected = debt.facilities.find((view) => view.facility.id === selectedId) ?? null;
  const hidden = { projectId: project.id, revision: String(project.modelRevision) };

  const facilityColumns: readonly DataTableColumn<FacilityView>[] = [
    {
      header: 'Facility',
      lead: true,
      render: (row) => (
        <>
          <CellMain>{row.facility.name}</CellMain>
          <CellSub>
            {row.facility.lender} · {FACILITY_TYPE_LABELS[row.facility.type]} · draw rank {row.facility.drawRank} · repay rank {row.facility.repaymentRank}
          </CellSub>
        </>
      ),
    },
    { header: 'Limit', align: 'right', render: (row) => <span className="num">{whole(row.facility.limit)}</span> },
    { header: 'Drawn (actual)', align: 'right', render: (row) => <span className="num">{whole(row.drawnActual)}</span> },
    { header: 'Rate', render: (row) => `${row.currentRateLabel} · ${row.facility.dayCount}` },
    { header: 'Available', render: (row) => `${formatDateLong(row.facility.availableFrom)} – ${formatDateLong(row.facility.availableTo)}` },
    { header: 'Maturity', render: (row) => formatDateLong(row.facility.maturityOn) },
    {
      header: 'Status',
      render: (row) =>
        row.breaches.length > 0 ? (
          <Chip tone="bad" icon="i-alert">
            {row.breaches.length} breach{row.breaches.length === 1 ? '' : 'es'}
          </Chip>
        ) : (
          <Chip tone="good" icon="i-check">
            Within limit
          </Chip>
        ),
    },
  ];

  return (
    <Stack>
      <KpiGrid>
        <Kpi label="Total committed limits" value={whole(debt.totalLimit)} footer={<Sub>{debt.facilities.length} facilities</Sub>} />
        <Kpi label="Drawn to date (actual)" value={whole(debt.drawnActual)} valueSuffix={`as of ${formatDateLong(data.asOf)}`} footer={<Sub>Planned draws excluded</Sub>} />
        <Kpi label="Unused capacity" value={whole(debt.unusedCapacity)} footer={<Sub>Limits less actual principal drawn</Sub>} />
        <Kpi
          label="Peak debt (horizon)"
          help="Highest day-end sum of every facility's principal, including capitalised interest (CAL20)."
          value={whole(money(debt.peakDebt.cents))}
          valueSuffix={debt.peakDebt.on ? monthLabel(debt.peakDebt.on.slice(0, 7)) : 'no debt'}
          footer={
            debt.breachCount > 0 ? (
              <Chip tone="bad" icon="i-alert">
                {debt.fundingStatus.label}
              </Chip>
            ) : (
              <Chip tone="good" icon="i-check">
                {debt.fundingStatus.label}
              </Chip>
            )
          }
        />
      </KpiGrid>

      {debt.breachCount > 0 ? (
        <Banner tone="warn" title="A facility breaches its limit or maturity">
          The funding position cannot show as green until every breach is cured. Breaches stay visible on the ledger (FIN03).
        </Banner>
      ) : null}

      <Card>
        <CardHeader
          title="Debt facilities"
          aside={
            permissions.canEdit ? (
              <Button small variant="primary" onClick={() => setCreating(true)}>
                + New facility
              </Button>
            ) : (
              <Sub>Read only</Sub>
            )
          }
        />
        {creating ? (
          <CardBody>
            <NewFacilityForm data={data} onClose={() => setCreating(false)} />
          </CardBody>
        ) : null}
        <DataTable
          columns={facilityColumns}
          rows={debt.facilities}
          rowKey={(row) => row.facility.id}
          onRowClick={(row) => {
            setSelectedId(row.facility.id);
            setPanel('none');
          }}
          isRowSelected={(row) => row.facility.id === selectedId}
          empty="No facilities yet. Proceeds from a facility are financing inflows, never revenue (FIN06)."
        />
      </Card>

      {selected ? (
        <>
          <Card>
            <CardHeader
              title={`Monthly rollup · ${selected.facility.name}`}
              aside={
                selected.reconciles ? (
                  <Chip tone="good" icon="i-check">
                    Every month reconciles
                  </Chip>
                ) : (
                  <Chip tone="bad" icon="i-alert">
                    Does not reconcile
                  </Chip>
                )
              }
            />
            <CardBody>
              <Sub style={{ fontSize: 12 }}>
                Closing = opening + draws − repayments + capitalised interest. Interest accrues daily on the balance after that day&apos;s
                movements ({selected.facility.dayCount}) and is posted at month end · {INTEREST_TREATMENT_LABELS[selected.facility.interestTreatment]}.
                Fees and cash interest are finance costs, separate from principal (FIN05, FIN06).
              </Sub>
            </CardBody>
            <DataTable columns={rollupColumns} rows={selected.months} rowKey={(row) => row.month} />
          </Card>

          <Card>
            <CardHeader
              title="Movements"
              aside={
                permissions.canEdit ? (
                  <Row>
                    <Button small variant="primary" onClick={() => setPanel('movement')} aria-pressed={panel === 'movement'}>
                      Record movement
                    </Button>
                    <Button small onClick={() => setPanel('rate')} aria-pressed={panel === 'rate'}>
                      Add rate step
                    </Button>
                  </Row>
                ) : null
              }
            />
            {panel === 'movement' ? (
              <CardBody>
                <ActionForm
                  action={recordFacilityMovementAction}
                  submitLabel="Record movement"
                  hiddenFields={{ ...hidden, facilityId: selected.facility.id }}
                  onCancel={() => setPanel('none')}
                  onSuccess={() => setPanel('none')}
                  footnote={
                    <Sub style={{ fontSize: 12 }}>
                      Actuals dated on or before {formatDateLong(project.actualsCutoff)} are locked. To fix one, record a correction dated
                      today (signed amount) and name the original in the note.
                    </Sub>
                  }
                >
                  {({ fieldErrors }) => (
                    <FieldGrid>
                      <SelectField id="fm-kind" name="kind" label="Kind" defaultValue="draw" options={Object.entries(MOVEMENT_KIND_LABELS).map(([value, label]) => ({ value, label }))} />
                      <TextField id="fm-on" name="on" label="Date" type="date" defaultValue={data.asOf} required invalid={Boolean(firstError(fieldErrors, 'on'))} hint={firstError(fieldErrors, 'on')} />
                      <TextField
                        id="fm-amount" name="amount" label="Amount" inputMode="decimal" placeholder="250,000.00" required
                        invalid={Boolean(firstError(fieldErrors, 'amount'))} hint={firstError(fieldErrors, 'amount') ?? 'A correction may be negative'}
                      />
                      <SelectField id="fm-basis" name="basis" label="Basis" defaultValue="actual" options={[{ value: 'actual', label: 'Actual · recorded' }, { value: 'planned', label: 'Planned · forecast' }]} />
                      <TextField id="fm-ref" name="reference" label="Reference" placeholder="Progress claim 3" />
                      <SelectField
                        id="fm-corrects" name="correctsMovementId" label="Corrects movement"
                        options={[{ value: '', label: 'Not a correction' }, ...selected.movements.map((movement) => ({ value: movement.id, label: `${movement.on} · ${MOVEMENT_KIND_LABELS[movement.kind]} · ${exact(movement.amount)}` }))]}
                      />
                      <TextField id="fm-note" name="note" label="Note" />
                    </FieldGrid>
                  )}
                </ActionForm>
              </CardBody>
            ) : null}
            {panel === 'rate' ? (
              <CardBody>
                <ActionForm
                  action={addRateStepAction}
                  submitLabel="Add rate step"
                  hiddenFields={{ ...hidden, facilityId: selected.facility.id }}
                  onCancel={() => setPanel('none')}
                  onSuccess={() => setPanel('none')}
                  footnote={<Sub style={{ fontSize: 12 }}>Rate steps are appended and effective dated; earlier steps are never edited.</Sub>}
                >
                  {({ fieldErrors }) => (
                    <FieldGrid>
                      <TextField id="rs-from" name="from" label="Effective from" type="date" required invalid={Boolean(firstError(fieldErrors, 'from'))} hint={firstError(fieldErrors, 'from')} />
                      <TextField
                        id="rs-rate" name="annualRate" label="Annual rate (%)" inputMode="decimal" placeholder="8.25" required
                        invalid={Boolean(firstError(fieldErrors, 'annualRate'))} hint={firstError(fieldErrors, 'annualRate') ?? 'Enter 8.25 for 8.25%'}
                      />
                    </FieldGrid>
                  )}
                </ActionForm>
              </CardBody>
            ) : null}
            <CardBody>
              <Sub style={{ fontSize: 12 }}>
                Rate schedule: {selected.facility.rateSteps.map((step) => `${formatPpmAsPercent(step.ratePpm)} from ${formatDateLong(step.from)}`).join(' · ')}
                {selected.facility.fees.length > 0
                  ? ` · Fees: ${selected.facility.fees.map((fee) => `${fee.kind} ${whole(fee.amount)}${fee.on ? ` on ${formatDateLong(fee.on)}` : ''}`).join(' · ')}`
                  : ''}
              </Sub>
            </CardBody>
            <DataTable columns={movementColumns} rows={selected.movements} rowKey={(row) => row.id} empty="No movements recorded." />
          </Card>
        </>
      ) : null}
    </Stack>
  );
}

const rollupColumns: readonly DataTableColumn<FacilityMonthRow>[] = [
  {
    header: 'Month',
    lead: true,
    render: (row) => (
      <>
        <CellMain>{monthLabel(row.month)}</CellMain>
        {row.breaches.length > 0 ? (
          <CellSub>
            <Chip tone="bad" icon="i-alert">
              {row.breaches.map((breach) => `${breach.kind} breach ${formatDateLong(breach.on)}`).join(' · ')}
            </Chip>
          </CellSub>
        ) : null}
      </>
    ),
  },
  { header: 'Opening', align: 'right', render: (row) => <span className="num">{exact(row.opening)}</span> },
  { header: 'Draws', align: 'right', render: (row) => <span className="num">{exact(row.draws)}</span> },
  { header: 'Repayments', align: 'right', render: (row) => <span className="num">{exact(row.repayments)}</span> },
  { header: 'Capitalised', align: 'right', render: (row) => <span className="num">{exact(row.capitalised)}</span> },
  { header: 'Cash interest', align: 'right', render: (row) => <span className="num">{exact(row.cashInterest)}</span> },
  { header: 'Fees', align: 'right', render: (row) => <span className="num">{exact(row.fees)}</span> },
  { header: 'Closing', align: 'right', render: (row) => <span className="num" style={{ fontWeight: 500 }}>{exact(row.closing)}</span> },
  { header: 'Unused', align: 'right', render: (row) => <span className="num">{exact(row.unused)}</span> },
];

const movementColumns: readonly DataTableColumn<FacilityMovement>[] = [
  {
    header: 'Date',
    lead: true,
    render: (row) => (
      <>
        <CellMain>{formatDateLong(row.on)}</CellMain>
        <CellSub>{row.reference ?? row.note ?? '—'}</CellSub>
      </>
    ),
  },
  { header: 'Kind', render: (row) => MOVEMENT_KIND_LABELS[row.kind] },
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
  { header: 'Amount', align: 'right', render: (row) => <span className="num">{exact(row.amount)}</span> },
  { header: 'Source', render: (row) => (row.correctsMovementId ? `${row.source} · corrects ${row.correctsMovementId}` : row.source) },
];

function NewFacilityForm({ data, onClose }: { readonly data: FinanceScreenData; readonly onClose: () => void }) {
  const { project } = data;
  return (
    <ActionForm
      action={createFacilityAction}
      submitLabel="Create facility"
      hiddenFields={{ projectId: project.id, revision: String(project.modelRevision) }}
      onCancel={onClose}
      onSuccess={onClose}
      footnote={
        <Sub style={{ fontSize: 12 }}>
          This release models fixed-rate facilities with manual draws. Ranks and fees are recorded; covenants and automatic draws are not
          modelled (FIN02).
        </Sub>
      }
    >
      {({ fieldErrors }) => {
        const field = (key: string) => ({ invalid: Boolean(firstError(fieldErrors, key)), hint: firstError(fieldErrors, key) });
        return (
          <FieldGrid>
            <TextField id="nf-name" name="name" label="Facility name" required {...field('name')} />
            <TextField id="nf-lender" name="lender" label="Lender" required {...field('lender')} />
            <SelectField id="nf-borrower" name="borrowerLegalEntityId" label="Borrower entity" defaultValue={project.legalEntityId} options={data.legalEntities.map((entity) => ({ value: entity.id, label: entity.name }))} />
            <SelectField id="nf-type" name="type" label="Type" defaultValue="senior" options={FACILITY_TYPES.map((type) => ({ value: type, label: FACILITY_TYPE_LABELS[type] }))} />
            <TextField id="nf-limit" name="limit" label="Committed limit" inputMode="decimal" placeholder="5,000,000.00" required {...field('limit')} />
            <TextField id="nf-opening" name="openingPrincipal" label="Opening principal" inputMode="decimal" placeholder="0.00" {...field('openingPrincipal')} />
            <TextField id="nf-from" name="availableFrom" label="Available from" type="date" required {...field('availableFrom')} />
            <TextField id="nf-to" name="availableTo" label="Available to" type="date" required {...field('availableTo')} />
            <TextField id="nf-maturity" name="maturityOn" label="Maturity" type="date" required {...field('maturityOn')} />
            <TextField
              id="nf-rate" name="annualRate" label="Annual rate (%)" inputMode="decimal" placeholder="8.25" required
              invalid={Boolean(firstError(fieldErrors, 'annualRate'))} hint={firstError(fieldErrors, 'annualRate') ?? 'Enter 8.25 for 8.25%'}
            />
            <SelectField id="nf-daycount" name="dayCount" label="Day count" defaultValue="ACT/365F" options={[{ value: 'ACT/365F', label: 'ACT/365 Fixed' }, { value: 'ACT/360', label: 'ACT/360' }]} />
            <SelectField id="nf-treatment" name="interestTreatment" label="Interest treatment" defaultValue="capitalised" options={Object.entries(INTEREST_TREATMENT_LABELS).map(([value, label]) => ({ value, label }))} />
            <TextField id="nf-draw" name="drawRank" label="Draw rank" type="number" min={1} defaultValue={1} {...field('drawRank')} />
            <TextField id="nf-repay" name="repaymentRank" label="Repayment rank" type="number" min={1} defaultValue={1} {...field('repaymentRank')} />
            <TextField id="nf-fee" name="establishmentFee" label="Establishment fee" inputMode="decimal" placeholder="27,500.00" hint="Dated on the first available day" />
          </FieldGrid>
        );
      }}
    </ActionForm>
  );
}
