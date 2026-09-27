'use server';

import { revalidatePath } from 'next/cache';
import { percentToPpm, TAX_TREATMENTS, type TaxTreatment } from '@/shared/finance-engine';
import type { ActionResult } from '@/shared/lib/action-result';
import { runAction } from '@/server/actions/run-action';
import { readAmount, readBoolean, readChoice, readString, requireString } from '@/shared/lib/form-data';
import { ValidationError } from '@/shared/lib/errors';
import { fromMajorUnits, type Money } from '@/shared/lib/money';
import { asId } from '@/shared/types/common';
import { salesApi } from './api';
import {
  CANCELLATION_TREATMENTS,
  COMMISSION_TRIGGERS,
  CONTRACT_STATES,
  PRICING_MODES,
  SALEABLE_AREA_BASES,
} from './model';
import type { BulkPriceChangeResult, UnitInput } from './service';

function revalidateSales(projectId: string): void {
  revalidatePath(`/projects/${projectId}/yield`);
  revalidatePath(`/projects/${projectId}/revenue`, 'layout');
  revalidatePath(`/projects/${projectId}`, 'layout');
}

function readRevision(form: FormData): number | undefined {
  const raw = readString(form, 'revision');
  if (raw === undefined) return undefined;
  const parsed = Number(raw);
  return Number.isInteger(parsed) ? parsed : undefined;
}

function readMoney(form: FormData, key: string): Money | undefined {
  const value = readAmount(form, key);
  return value === undefined ? undefined : fromMajorUnits(value);
}

function requireMoney(form: FormData, key: string, label: string): Money {
  const value = readMoney(form, key);
  if (value === undefined) throw new ValidationError(`${label} is required.`, { fieldErrors: { [key]: [`Enter the ${label.toLowerCase()}.`] } });
  return value;
}

function readNumber(form: FormData, key: string, label: string, fallback?: number): number {
  const raw = readString(form, key);
  if (raw === undefined) {
    if (fallback !== undefined) return fallback;
    throw new ValidationError(`${label} is required.`, { fieldErrors: { [key]: [`Enter ${label.toLowerCase()}.`] } });
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) throw new ValidationError(`${label} must be a number.`, { fieldErrors: { [key]: ['Enter a number.'] } });
  return parsed;
}

function readTreatment(form: FormData): TaxTreatment {
  return readChoice(form, 'taxTreatment', TAX_TREATMENTS) ?? 'standard-gst';
}

function unitFromForm(form: FormData): UnitInput {
  const milestone = readString(form, 'forecastSettlementMilestoneId');
  const fixed = readString(form, 'forecastSettlementDate');
  return {
    groupId: requireString(form, 'groupId', 'Revenue group'),
    code: requireString(form, 'code', 'Unit code'),
    ...(readString(form, 'stage') ? { stage: readString(form, 'stage') } : {}),
    productType: requireString(form, 'productType', 'Product type'),
    ...(readString(form, 'level') ? { level: readString(form, 'level') } : {}),
    bedrooms: readNumber(form, 'bedrooms', 'Bedrooms', 0),
    carSpaces: readNumber(form, 'carSpaces', 'Car spaces', 0),
    internalAreaSqm: readNumber(form, 'internalAreaSqm', 'Internal area'),
    externalAreaSqm: readNumber(form, 'externalAreaSqm', 'External area', 0),
    saleableAreaBasis: readChoice(form, 'saleableAreaBasis', SALEABLE_AREA_BASES) ?? 'internal',
    pricingMode: readChoice(form, 'pricingMode', PRICING_MODES) ?? 'per-unit',
    ...(readMoney(form, 'askingPrice') ? { askingPrice: readMoney(form, 'askingPrice') } : {}),
    ...(readMoney(form, 'forecastPrice') ? { forecastPrice: readMoney(form, 'forecastPrice') } : {}),
    ...(readMoney(form, 'pricePerSqm') ? { pricePerSqm: readMoney(form, 'pricePerSqm') } : {}),
    taxTreatment: readTreatment(form),
    ...(milestone ? { forecastSettlementMilestoneId: asId<'Milestone'>(milestone) } : {}),
    ...(fixed ? { forecastSettlementDate: fixed } : {}),
  };
}

/** YLD01 — add a unit to the register. */
export async function createUnitAction(_previous: ActionResult<unknown>, form: FormData): Promise<ActionResult<unknown>> {
  return runAction('Unit added', () => {
    const projectId = requireString(form, 'projectId', 'Project');
    const created = salesApi.createUnit(projectId, unitFromForm(form), readRevision(form));
    revalidateSales(projectId);
    return created;
  });
}

/** YLD01/YLD02 — edit a unit. A contracted unit's price is refused here: vary the contract. */
export async function updateUnitAction(_previous: ActionResult<unknown>, form: FormData): Promise<ActionResult<unknown>> {
  return runAction('Unit saved', () => {
    const projectId = requireString(form, 'projectId', 'Project');
    const input = unitFromForm(form);
    const updated = salesApi.updateUnit(requireString(form, 'unitId', 'Unit'), input, readString(form, 'reason'));
    revalidateSales(projectId);
    return updated;
  });
}

/** YLD02 — preview (`preview=1`) or apply a bulk price change. */
export async function bulkPriceChangeAction(_previous: ActionResult<unknown>, form: FormData): Promise<ActionResult<unknown>> {
  const preview = readString(form, 'preview') !== '0';
  return runAction(
    (value: BulkPriceChangeResult & { readonly preview: boolean }) =>
      `${value.preview ? 'Preview: ' : ''}${value.changes.length} unit(s) ${value.preview ? 'would change' : 'repriced'}, ${value.skipped.length} contracted skipped`,
    () => {
      const projectId = requireString(form, 'projectId', 'Project');
      const mode = readChoice(form, 'mode', ['percent', 'amount', 'set'] as const) ?? 'percent';
      const value = requireString(form, 'value', 'Change');
      let valuePpm: number | undefined;
      let amount: Money | undefined;
      if (mode === 'percent') {
        try {
          valuePpm = percentToPpm(value);
        } catch {
          throw new ValidationError(`"${value}" is not a percentage.`, { fieldErrors: { value: ['Enter a percentage such as 2.5 or -3.'] } });
        }
      } else {
        amount = requireMoney(form, 'value', 'Amount');
      }
      const variation = readBoolean(form, 'viaContractVariation');
      const result = salesApi.bulkPriceChange(projectId, {
        ...(readString(form, 'groupId') ? { groupId: readString(form, 'groupId') } : {}),
        mode,
        ...(valuePpm !== undefined ? { valuePpm } : {}),
        ...(amount ? { amount } : {}),
        includeContracted: variation,
        viaContractVariation: variation,
        preview,
        ...(readString(form, 'reason') ? { reason: readString(form, 'reason') } : {}),
      });
      if (!preview) revalidateSales(projectId);
      return { ...result, preview };
    },
  );
}

/** YLD03 — record a contract; it starts reserved. */
export async function createContractAction(_previous: ActionResult<unknown>, form: FormData): Promise<ActionResult<unknown>> {
  return runAction('Contract recorded', () => {
    const projectId = requireString(form, 'projectId', 'Project');
    const depositAmount = readString(form, 'depositAmount');
    const depositDue = readString(form, 'depositDueOn');
    const withholding = readMoney(form, 'withholding');
    const created = salesApi.recordContract(
      requireString(form, 'unitId', 'Unit'),
      {
        purchaserReference: requireString(form, 'purchaserReference', 'Purchaser reference'),
        consideration: requireMoney(form, 'consideration', 'Consideration'),
        taxTreatment: readTreatment(form),
        contractDate: requireString(form, 'contractDate', 'Contract date'),
        expectedSettlement: requireString(form, 'expectedSettlement', 'Expected settlement'),
        depositSchedule: depositAmount && depositDue ? [{ dueOn: depositDue, amount: requireMoney(form, 'depositAmount', 'Deposit') }] : [],
        ...(withholding ? { withholding } : {}),
      },
      readRevision(form),
    );
    revalidateSales(projectId);
    return created;
  });
}

/** YLD03/YLD04 — move a contract on, or cancel it with a reason. */
export async function transitionContractAction(_previous: ActionResult<unknown>, form: FormData): Promise<ActionResult<unknown>> {
  return runAction(
    (contract: { state: string }) => `Contract is now ${contract.state}`,
    () => {
      const projectId = requireString(form, 'projectId', 'Project');
      const to = readChoice(form, 'to', CONTRACT_STATES);
      if (!to) throw new ValidationError('Choose the state to move to.');
      const updated = salesApi.transitionContract(requireString(form, 'contractId', 'Contract'), to, readString(form, 'on'), readString(form, 'reason'), readRevision(form));
      revalidateSales(projectId);
      return updated;
    },
  );
}

/** YLD02 — the one path that changes a contracted price. */
export async function varyContractAction(_previous: ActionResult<unknown>, form: FormData): Promise<ActionResult<unknown>> {
  return runAction('Contract varied', () => {
    const projectId = requireString(form, 'projectId', 'Project');
    const updated = salesApi.varyContract(requireString(form, 'contractId', 'Contract'), requireMoney(form, 'consideration', 'Consideration'), requireString(form, 'reason', 'Reason'));
    revalidateSales(projectId);
    return updated;
  });
}

/** YLD04 — a deposit received is held in trust. */
export async function recordDepositAction(_previous: ActionResult<unknown>, form: FormData): Promise<ActionResult<unknown>> {
  return runAction('Deposit recorded · held in trust', () => {
    const projectId = requireString(form, 'projectId', 'Project');
    const event = salesApi.recordDeposit(requireString(form, 'contractId', 'Contract'), requireMoney(form, 'amount', 'Amount'), requireString(form, 'on', 'Date received'));
    revalidateSales(projectId);
    return event;
  });
}

/** YLD04 — an explicit, permitted release is the only way a deposit funds the project. */
export async function releaseDepositAction(_previous: ActionResult<unknown>, form: FormData): Promise<ActionResult<unknown>> {
  return runAction('Deposit released', () => {
    const projectId = requireString(form, 'projectId', 'Project');
    const event = salesApi.releaseDeposit(
      requireString(form, 'contractId', 'Contract'),
      requireMoney(form, 'amount', 'Amount'),
      requireString(form, 'on', 'Release date'),
      readString(form, 'reason') ?? '',
    );
    revalidateSales(projectId);
    return event;
  });
}

/** REV01 — dated other income with explicit tax treatment. */
export async function createOtherIncomeAction(_previous: ActionResult<unknown>, form: FormData): Promise<ActionResult<unknown>> {
  return runAction('Other income added', () => {
    const projectId = requireString(form, 'projectId', 'Project');
    const mode = readChoice(form, 'mode', ['one-off', 'recurring'] as const) ?? 'one-off';
    const created = salesApi.createOtherIncome(projectId, {
      groupId: requireString(form, 'groupId', 'Revenue group'),
      description: requireString(form, 'description', 'Description'),
      taxTreatment: readTreatment(form),
      mode,
      ...(mode === 'one-off'
        ? { date: readString(form, 'date'), amount: readMoney(form, 'amount') }
        : { startDate: readString(form, 'startDate'), endDate: readString(form, 'endDate'), monthlyAmount: readMoney(form, 'monthlyAmount') }),
    });
    revalidateSales(projectId);
    return created;
  });
}

/** YLD05 — commission as a rate or an amount, with trigger and cancellation treatment. */
export async function setCommissionRuleAction(_previous: ActionResult<unknown>, form: FormData): Promise<ActionResult<unknown>> {
  return runAction('Commission rule saved', () => {
    const projectId = requireString(form, 'projectId', 'Project');
    const basis = readChoice(form, 'basis', ['rate', 'amount'] as const) ?? 'rate';
    let ratePpm: number | undefined;
    if (basis === 'rate') {
      const raw = requireString(form, 'rate', 'Rate');
      try {
        ratePpm = percentToPpm(raw);
      } catch {
        throw new ValidationError(`"${raw}" is not a percentage.`, { fieldErrors: { rate: ['Enter a percentage such as 2.'] } });
      }
    }
    const saved = salesApi.setCommissionRule(projectId, {
      basis,
      ...(ratePpm !== undefined ? { ratePpm } : {}),
      ...(basis === 'amount' ? { amount: requireMoney(form, 'amount', 'Amount') } : {}),
      trigger: readChoice(form, 'trigger', COMMISSION_TRIGGERS) ?? 'settlement',
      cancellationTreatment: readChoice(form, 'cancellationTreatment', CANCELLATION_TREATMENTS) ?? 'reverse',
    });
    revalidateSales(projectId);
    return saved;
  });
}
