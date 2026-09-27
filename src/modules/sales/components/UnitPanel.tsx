'use client';

import { useState } from 'react';
import { ActionForm, firstError } from '@/shared/components/ActionForm';
import { Banner } from '@/shared/components/Banner';
import { Button } from '@/shared/components/Button';
import { Card, CardBody, CardHeader } from '@/shared/components/Card';
import { FieldGrid, SelectField, TextField } from '@/shared/components/Field';
import { Grid, Row, Stat, Sub } from '@/shared/components/Layout';
import { TAX_TREATMENT_LABELS, TAX_TREATMENTS } from '@/shared/finance-engine';
import { formatDateLong } from '@/shared/lib/dates';
import { formatMoney, type Money } from '@/shared/lib/money';
import {
  createContractAction,
  recordDepositAction,
  releaseDepositAction,
  transitionContractAction,
  updateUnitAction,
  varyContractAction,
} from '../actions';
import {
  CONTRACT_TRANSITIONS,
  PRICING_MODE_LABELS,
  PRICING_MODES,
  SALEABLE_AREA_BASES,
  SALEABLE_AREA_BASIS_LABELS,
  isLiveContractState,
  type ContractState,
  type RevenueGroup,
} from '../model';
import type { UnitRow } from '../api';
import { SalesStatusChip } from './status';

type Panel = 'none' | 'edit' | 'contract' | 'advance' | 'cancel' | 'vary' | 'deposit' | 'release';

const TRANSITION_LABELS: Record<ContractState, string> = {
  reserved: 'Reserve',
  exchanged: 'Mark exchanged',
  unconditional: 'Mark unconditional',
  settled: 'Record settlement',
  cancelled: 'Cancel contract',
};

const major = (value: Money | undefined): string => (value ? (value.cents / 100).toFixed(2) : '');

export interface UnitPanelProps {
  readonly projectId: string;
  readonly revision: number;
  readonly row: UnitRow;
  readonly groups: readonly RevenueGroup[];
  readonly milestones: readonly { readonly id: string; readonly label: string }[];
  readonly canEdit: boolean;
  readonly canSeePurchaser: boolean;
  readonly today: string;
}

/** YLD01–YLD04 — the selected unit: facts, edit, contract lifecycle and deposits. */
export function UnitPanel({ projectId, revision, row, groups, milestones, canEdit, canSeePurchaser, today }: UnitPanelProps) {
  const [panel, setPanel] = useState<Panel>('none');
  const { unit, contract } = row;
  const live = contract && isLiveContractState(contract.state) ? contract : null;
  const next = live ? CONTRACT_TRANSITIONS[live.state].filter((state) => state !== 'cancelled') : [];
  const close = (): void => setPanel('none');
  const toggle = (value: Panel): void => setPanel((current) => (current === value ? 'none' : value));
  const hidden = { projectId, unitId: unit.id, revision: String(revision) };

  return (
    <Card>
      <CardHeader
        title={
          <span>
            {unit.code} <Sub>· {row.groupName}</Sub>
          </span>
        }
        aside={<SalesStatusChip status={row.status} />}
      />
      <CardBody className="stack">
        <Grid columns={3}>
          <Stat label="Product" value={unit.productType} meta={`${unit.bedrooms} bed · ${unit.carSpaces} car${unit.level ? ` · level ${unit.level}` : ''}`} />
          <Stat label="Areas" value={`${unit.internalAreaSqm} m² + ${unit.externalAreaSqm} m²`} meta={`Saleable ${row.saleableAreaSqm} m² · ${SALEABLE_AREA_BASIS_LABELS[unit.saleableAreaBasis]}`} />
          <Stat label="Pricing" value={formatMoney(unit.forecastPrice)} meta={`Asking ${formatMoney(unit.askingPrice)} · ${PRICING_MODE_LABELS[unit.pricingMode]}${unit.pricePerSqm ? ` at ${formatMoney(unit.pricePerSqm)}/m²` : ''}`} />
        </Grid>

        {contract ? (
          <Grid columns={3}>
            <Stat
              label="Contract price"
              value={formatMoney(contract.consideration)}
              meta={`${TAX_TREATMENT_LABELS[contract.taxTreatment]} · withholding ${formatMoney(contract.withholding)}`}
            />
            <Stat
              label="Settlement"
              value={contract.actualSettlement ? formatDateLong(contract.actualSettlement) : formatDateLong(contract.expectedSettlement)}
              meta={contract.actualSettlement ? 'Actual' : `Expected · contract ${formatDateLong(contract.contractDate)}`}
            />
            <Stat
              label="Purchaser"
              value={canSeePurchaser ? (contract.purchaserReference ?? '—') : 'Restricted'}
              meta={canSeePurchaser ? 'Reference only · buyer details stay in the contract file' : 'Visible to people who can edit sales'}
            />
          </Grid>
        ) : null}

        {contract ? (
          <Grid columns={3}>
            <Stat label="Deposits in trust" value={formatMoney(row.depositsInTrust)} meta="Restricted cash" />
            <Stat label="Released" value={formatMoney(row.depositsReleased)} meta="Funds the project" />
            <Stat
              label="Deposit schedule"
              value={contract.depositSchedule.length === 0 ? 'None' : contract.depositSchedule.map((entry) => formatMoney(entry.amount)).join(' + ')}
              meta={contract.depositSchedule.map((entry) => `due ${formatDateLong(entry.dueOn)}`).join(' · ') || undefined}
            />
          </Grid>
        ) : null}
        {contract?.cancellationReason ? <Banner tone="warn" title={`Cancelled · ${contract.cancellationReason}`}>Receipts and refunds stay on record; the unit can be contracted again.</Banner> : null}

        {canEdit ? (
          <Row>
            <Button small variant={panel === 'edit' ? 'gold' : 'default'} aria-pressed={panel === 'edit'} onClick={() => toggle('edit')}>Edit unit</Button>
            {!live && row.status !== 'settled' ? (
              <Button small variant={panel === 'contract' ? 'gold' : 'default'} aria-pressed={panel === 'contract'} onClick={() => toggle('contract')}>Record contract</Button>
            ) : null}
            {live ? (
              <>
                {next.length > 0 ? <Button small variant={panel === 'advance' ? 'gold' : 'default'} aria-pressed={panel === 'advance'} onClick={() => toggle('advance')}>{TRANSITION_LABELS[next[0]!]}</Button> : null}
                <Button small variant={panel === 'deposit' ? 'gold' : 'default'} aria-pressed={panel === 'deposit'} onClick={() => toggle('deposit')}>Record deposit</Button>
                <Button small variant={panel === 'release' ? 'gold' : 'default'} aria-pressed={panel === 'release'} onClick={() => toggle('release')}>Release deposit</Button>
                <Button small variant={panel === 'vary' ? 'gold' : 'default'} aria-pressed={panel === 'vary'} onClick={() => toggle('vary')}>Vary price</Button>
                <Button small variant={panel === 'cancel' ? 'gold' : 'default'} aria-pressed={panel === 'cancel'} onClick={() => toggle('cancel')}>Cancel contract</Button>
              </>
            ) : null}
          </Row>
        ) : null}

        {canEdit && panel === 'edit' ? (
          <ActionForm key={`edit-${unit.id}`} action={updateUnitAction} submitLabel="Save unit" hiddenFields={hidden} onCancel={close} onSuccess={close}
            footnote={live ? <Sub style={{ fontSize: 12 }}>This unit is contracted: price changes are refused here and go through &quot;Vary price&quot;.</Sub> : undefined}>
            {({ fieldErrors }) => <UnitFields fieldErrors={fieldErrors} groups={groups} milestones={milestones} values={row} />}
          </ActionForm>
        ) : null}

        {canEdit && panel === 'contract' ? (
          <ActionForm key={`contract-${unit.id}`} action={createContractAction} submitLabel="Record contract" hiddenFields={hidden} onCancel={close} onSuccess={close}
            footnote={<Sub style={{ fontSize: 12 }}>A new contract starts reserved. Withholding defaults to the GST inside a standard-rated price (reviewed default, CAL12).</Sub>}>
            {({ fieldErrors }) => (
              <FieldGrid>
                <TextField id="sc-ref" name="purchaserReference" label="Purchaser reference" placeholder="PUR-2026-0450" invalid={Boolean(firstError(fieldErrors, 'purchaserReference'))} hint={firstError(fieldErrors, 'purchaserReference') ?? 'A reference only — buyer details stay in the contract file'} />
                <TextField id="sc-price" name="consideration" label="Consideration (incl. GST)" inputMode="decimal" defaultValue={major(unit.forecastPrice)} invalid={Boolean(firstError(fieldErrors, 'consideration'))} hint={firstError(fieldErrors, 'consideration')} />
                <SelectField id="sc-tax" name="taxTreatment" label="Tax treatment" defaultValue={unit.taxTreatment} options={TAX_TREATMENTS.map((value) => ({ value, label: TAX_TREATMENT_LABELS[value] }))} />
                <TextField id="sc-date" name="contractDate" label="Contract date" type="date" defaultValue={today} invalid={Boolean(firstError(fieldErrors, 'contractDate'))} hint={firstError(fieldErrors, 'contractDate')} />
                <TextField id="sc-settle" name="expectedSettlement" label="Expected settlement" type="date" invalid={Boolean(firstError(fieldErrors, 'expectedSettlement'))} hint={firstError(fieldErrors, 'expectedSettlement')} />
                <TextField id="sc-dep" name="depositAmount" label="Deposit" inputMode="decimal" defaultValue={(unit.forecastPrice.cents / 1000).toFixed(2)} invalid={Boolean(firstError(fieldErrors, 'depositSchedule'))} hint={firstError(fieldErrors, 'depositSchedule') ?? '10% by default'} />
                <TextField id="sc-dep-due" name="depositDueOn" label="Deposit due" type="date" />
                <TextField id="sc-wh" name="withholding" label="GST withholding (optional)" inputMode="decimal" hint="Blank uses the reviewed default" />
              </FieldGrid>
            )}
          </ActionForm>
        ) : null}

        {canEdit && live && panel === 'advance' && next[0] ? (
          <ActionForm key={`advance-${live.id}`} action={transitionContractAction} submitLabel={TRANSITION_LABELS[next[0]]} hiddenFields={{ projectId, contractId: live.id, to: next[0], revision: String(revision) }} onCancel={close} onSuccess={close}
            footnote={next[0] === 'settled' ? <Sub style={{ fontSize: 12 }}>Settlement records one receipt: consideration and adjustments less deposits applied and GST withholding. Deposits still in trust are released and applied. Withholding is a credit against GST, not an expense.</Sub> : undefined}>
            {({ fieldErrors }) => (
              <FieldGrid>
                <TextField id="ct-on" name="on" label={next[0] === 'settled' ? 'Settlement date' : 'Date'} type="date" defaultValue={today} invalid={Boolean(firstError(fieldErrors, 'on'))} hint={firstError(fieldErrors, 'on')} />
              </FieldGrid>
            )}
          </ActionForm>
        ) : null}

        {canEdit && live && panel === 'cancel' ? (
          <ActionForm key={`cancel-${live.id}`} action={transitionContractAction} submitLabel="Cancel contract" submitVariant="default" hiddenFields={{ projectId, contractId: live.id, to: 'cancelled', revision: String(revision) }} onCancel={close} onSuccess={close}
            footnote={<Sub style={{ fontSize: 12 }}>Only this contract&apos;s forecast events and commission are removed. Deposits still in trust are refunded; every receipt and refund stays on record.</Sub>}>
            {({ fieldErrors }) => (
              <FieldGrid>
                <TextField id="cc-reason" name="reason" label="Reason" invalid={Boolean(firstError(fieldErrors, 'reason'))} hint={firstError(fieldErrors, 'reason')} />
                <TextField id="cc-on" name="on" label="Date" type="date" defaultValue={today} />
              </FieldGrid>
            )}
          </ActionForm>
        ) : null}

        {canEdit && live && panel === 'vary' ? (
          <ActionForm key={`vary-${live.id}`} action={varyContractAction} submitLabel="Record variation" hiddenFields={{ projectId, contractId: live.id }} onCancel={close} onSuccess={close}>
            {({ fieldErrors }) => (
              <FieldGrid>
                <TextField id="cv-price" name="consideration" label="New consideration" inputMode="decimal" defaultValue={major(live.consideration)} invalid={Boolean(firstError(fieldErrors, 'consideration'))} hint={firstError(fieldErrors, 'consideration')} />
                <TextField id="cv-reason" name="reason" label="Reason" invalid={Boolean(firstError(fieldErrors, 'reason'))} hint={firstError(fieldErrors, 'reason')} />
              </FieldGrid>
            )}
          </ActionForm>
        ) : null}

        {canEdit && live && (panel === 'deposit' || panel === 'release') ? (
          <Banner tone="info" icon="i-shield" title="Deposits are held in trust">
            A deposit received is restricted cash. It funds the project only when a permitted release is recorded here; otherwise it is applied to the price at settlement (YLD04).
          </Banner>
        ) : null}

        {canEdit && live && panel === 'deposit' ? (
          <ActionForm key={`dep-${live.id}`} action={recordDepositAction} submitLabel="Record deposit" hiddenFields={{ projectId, contractId: live.id }} onCancel={close} onSuccess={close}>
            {({ fieldErrors }) => (
              <FieldGrid>
                <TextField id="dp-amount" name="amount" label="Amount received" inputMode="decimal" defaultValue={major(live.depositSchedule[0]?.amount)} invalid={Boolean(firstError(fieldErrors, 'amount'))} hint={firstError(fieldErrors, 'amount')} />
                <TextField id="dp-on" name="on" label="Date received" type="date" defaultValue={today} />
              </FieldGrid>
            )}
          </ActionForm>
        ) : null}

        {canEdit && live && panel === 'release' ? (
          <ActionForm key={`rel-${live.id}`} action={releaseDepositAction} submitLabel="Record release" hiddenFields={{ projectId, contractId: live.id }} onCancel={close} onSuccess={close}>
            {({ fieldErrors }) => (
              <FieldGrid>
                <TextField id="rl-amount" name="amount" label="Amount released" inputMode="decimal" defaultValue={major(row.depositsInTrust)} invalid={Boolean(firstError(fieldErrors, 'amount'))} hint={firstError(fieldErrors, 'amount') ?? `Up to ${formatMoney(row.depositsInTrust, { showCents: true })} in trust`} />
                <TextField id="rl-on" name="on" label="Release date" type="date" defaultValue={today} />
                <TextField id="rl-reason" name="reason" label="Permission for the release" placeholder="Clause 4.2 · purchaser consent" invalid={Boolean(firstError(fieldErrors, 'reason'))} hint={firstError(fieldErrors, 'reason')} />
              </FieldGrid>
            )}
          </ActionForm>
        ) : null}
      </CardBody>
    </Card>
  );
}

/** The unit's editable fields, shared by the create and edit forms. */
export function UnitFields({
  fieldErrors,
  groups,
  milestones,
  values,
}: {
  readonly fieldErrors: Readonly<Record<string, readonly string[]>>;
  readonly groups: readonly RevenueGroup[];
  readonly milestones: readonly { readonly id: string; readonly label: string }[];
  readonly values?: UnitRow;
}) {
  const unit = values?.unit;
  const err = (key: string) => ({ invalid: Boolean(firstError(fieldErrors, key)), hint: firstError(fieldErrors, key) });
  return (
    <FieldGrid>
      <SelectField id="uf-group" name="groupId" label="Revenue group" defaultValue={unit?.groupId ?? groups[0]?.id} options={groups.map((group) => ({ value: group.id, label: group.name }))} {...err('groupId')} />
      <TextField id="uf-code" name="code" label="Unit code" defaultValue={unit?.code} placeholder="TH-09" {...err('code')} />
      <TextField id="uf-type" name="productType" label="Product type" defaultValue={unit?.productType} placeholder="3-bed townhouse" {...err('productType')} />
      <TextField id="uf-stage" name="stage" label="Stage" defaultValue={unit?.stage} />
      <TextField id="uf-level" name="level" label="Level" defaultValue={unit?.level} />
      <TextField id="uf-beds" name="bedrooms" label="Bedrooms" type="number" min={0} defaultValue={unit?.bedrooms ?? 0} {...err('bedrooms')} />
      <TextField id="uf-cars" name="carSpaces" label="Car spaces" type="number" min={0} defaultValue={unit?.carSpaces ?? 0} {...err('carSpaces')} />
      <TextField id="uf-int" name="internalAreaSqm" label="Internal area (m²)" inputMode="decimal" defaultValue={unit?.internalAreaSqm} {...err('internalAreaSqm')} />
      <TextField id="uf-ext" name="externalAreaSqm" label="External area (m²)" inputMode="decimal" defaultValue={unit?.externalAreaSqm ?? 0} {...err('externalAreaSqm')} />
      <SelectField id="uf-basis" name="saleableAreaBasis" label="Saleable area basis" defaultValue={unit?.saleableAreaBasis ?? 'internal'} options={SALEABLE_AREA_BASES.map((value) => ({ value, label: SALEABLE_AREA_BASIS_LABELS[value] }))} hint="A per-m² price applies to this area only" />
      <SelectField id="uf-mode" name="pricingMode" label="Pricing" defaultValue={unit?.pricingMode ?? 'per-unit'} options={PRICING_MODES.map((value) => ({ value, label: PRICING_MODE_LABELS[value] }))} />
      <TextField id="uf-psm" name="pricePerSqm" label="Price per m² (per-m² pricing)" inputMode="decimal" defaultValue={major(unit?.pricePerSqm)} {...err('pricePerSqm')} />
      <TextField id="uf-ask" name="askingPrice" label="Asking price" inputMode="decimal" defaultValue={major(unit?.askingPrice)} {...err('askingPrice')} />
      <TextField id="uf-fc" name="forecastPrice" label="Forecast price" inputMode="decimal" defaultValue={major(unit?.forecastPrice)} {...err('forecastPrice')} />
      <SelectField id="uf-tax" name="taxTreatment" label="Tax treatment" defaultValue={unit?.taxTreatment ?? 'standard-gst'} options={TAX_TREATMENTS.map((value) => ({ value, label: TAX_TREATMENT_LABELS[value] }))} />
      <SelectField id="uf-ms" name="forecastSettlementMilestoneId" label="Forecast settlement · milestone" defaultValue={unit?.forecastSettlementMilestoneId ?? ''} options={[{ value: '', label: 'None' }, ...milestones.map((row) => ({ value: row.id, label: row.label }))]} hint="Moves when the milestone moves" />
      <TextField id="uf-fsd" name="forecastSettlementDate" label="Forecast settlement · fixed date" type="date" defaultValue={unit?.forecastSettlementDate} invalid={Boolean(firstError(fieldErrors, 'forecastSettlementDate'))} hint={firstError(fieldErrors, 'forecastSettlementDate') ?? 'Takes priority over the milestone'} />
    </FieldGrid>
  );
}
