'use server';

/**
 * Funding Server Actions. Each parses FormData, passes the two guards, calls
 * the service and revalidates. Nothing throws across the boundary: `runAction`
 * turns every AppError into an ActionResult with field errors.
 */
import { revalidatePath } from 'next/cache';
import { asId, type ProjectId } from '@/shared/types/common';
import { fromMajorUnits, money, type Money } from '@/shared/lib/money';
import type { ActionResult } from '@/shared/lib/action-result';
import { runAction } from '@/server/actions/run-action';
import { readAmount, readChoice, readString, requireString } from '@/shared/lib/form-data';
import { ValidationError } from '@/shared/lib/errors';
import { resolveAsOfDate } from '@/shared/config/app-config';
import { accessService } from '@/modules/access/service';
import { projectsService } from '@/modules/projects/service';
import { fundingService } from './service';
import { fundingApi, parsePercentField } from './api';
import {
  DAY_COUNTS,
  EQUITY_MOVEMENT_TYPES,
  FACILITY_TYPES,
  INTEREST_TREATMENTS,
  MOVEMENT_BASES,
  MOVEMENT_KINDS,
  PARTICIPANT_CLASSES,
} from './model';

function revalidateFinance(projectId: string): void {
  revalidatePath(`/projects/${projectId}`, 'layout');
  revalidatePath(`/projects/${projectId}/finance`);
}

function readRevision(form: FormData): number | undefined {
  const raw = readString(form, 'revision');
  if (raw === undefined) return undefined;
  const parsed = Number(raw);
  return Number.isInteger(parsed) ? parsed : undefined;
}

/** A money field in major units; blank is absent, never zero. */
function readMoney(form: FormData, key: string, label: string, options: { required?: boolean; allowNegative?: boolean } = {}): Money | undefined {
  let value: number | undefined;
  try {
    value = readAmount(form, key);
  } catch {
    throw new ValidationError(`${label} is not a valid amount.`, { fieldErrors: { [key]: ['Enter an amount such as 1,000,000.00.'] } });
  }
  if (value === undefined) {
    if (options.required) throw new ValidationError(`${label} is required.`, { fieldErrors: { [key]: [`Enter ${label.toLowerCase()}.`] } });
    return undefined;
  }
  if (!options.allowNegative && value < 0) {
    throw new ValidationError(`${label} cannot be negative.`, { fieldErrors: { [key]: ['Enter zero or more.'] } });
  }
  return fromMajorUnits(value);
}

function readInt(form: FormData, key: string, fallback: number): number {
  const raw = readString(form, key);
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed)) throw new ValidationError(`${key} must be a whole number.`, { fieldErrors: { [key]: ['Enter a whole number.'] } });
  return parsed;
}

function readWeight(form: FormData, key: string, fallback: number): number {
  const raw = readString(form, key);
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) throw new ValidationError(`${key} must be a number.`, { fieldErrors: { [key]: ['Enter a number.'] } });
  return parsed;
}

function guardProject(form: FormData, permission: 'finance.edit' | 'baseline.publish'): ProjectId {
  accessService.guard('development.read');
  const projectId = asId<'Project'>(requireString(form, 'projectId', 'Project'));
  projectsService.guard(projectId, permission);
  return projectId;
}

/** FIN01 — a new facility. The rate is a percentage: "8.25" is 8.25%. */
export async function createFacilityAction(_previous: ActionResult<unknown>, form: FormData): Promise<ActionResult<unknown>> {
  return runAction('Facility created', () => {
    const projectId = guardProject(form, 'finance.edit');
    const project = projectsService.require(projectId);
    const rateRaw = readString(form, 'annualRate');
    if (!rateRaw) throw new ValidationError('Enter the annual rate.', { fieldErrors: { annualRate: ['Enter 8.25 for 8.25%.'] } });
    const feeAmount = readMoney(form, 'establishmentFee', 'Establishment fee');
    const availableFrom = requireString(form, 'availableFrom', 'Available from');
    const created = fundingService.createFacility({
      projectId,
      name: requireString(form, 'name', 'Facility name'),
      lender: requireString(form, 'lender', 'Lender'),
      borrowerLegalEntityId: asId<'LegalEntity'>(readString(form, 'borrowerLegalEntityId') ?? project.legalEntityId),
      type: readChoice(form, 'type', FACILITY_TYPES) ?? 'senior',
      limit: readMoney(form, 'limit', 'Committed limit', { required: true }) ?? money(0),
      openingPrincipal: readMoney(form, 'openingPrincipal', 'Opening principal') ?? money(0),
      availableFrom,
      availableTo: requireString(form, 'availableTo', 'Available to'),
      maturityOn: requireString(form, 'maturityOn', 'Maturity'),
      drawRank: readInt(form, 'drawRank', 1),
      repaymentRank: readInt(form, 'repaymentRank', 1),
      ratePpm: parsePercentField(rateRaw, 'annualRate'),
      dayCount: readChoice(form, 'dayCount', DAY_COUNTS) ?? 'ACT/365F',
      interestTreatment: readChoice(form, 'interestTreatment', INTEREST_TREATMENTS) ?? 'capitalised',
      fees: feeAmount && feeAmount.cents > 0 ? [{ kind: 'establishment', amount: feeAmount, on: availableFrom }] : [],
      actor: accessService.getCurrentUser().id,
      expectedRevision: readRevision(form),
    });
    revalidateFinance(projectId);
    return created;
  });
}

/** FIN01 — append an effective-dated rate step. */
export async function addRateStepAction(_previous: ActionResult<unknown>, form: FormData): Promise<ActionResult<unknown>> {
  return runAction('Rate step added', () => {
    const projectId = guardProject(form, 'finance.edit');
    const facility = fundingService.requireFacility(asId<'DebtFacility'>(requireString(form, 'facilityId', 'Facility')));
    if (facility.projectId !== projectId) throw new ValidationError('That facility belongs to another project.');
    const rateRaw = readString(form, 'annualRate');
    if (!rateRaw) throw new ValidationError('Enter the annual rate.', { fieldErrors: { annualRate: ['Enter 8.25 for 8.25%.'] } });
    const updated = fundingService.addRateStep({
      facilityId: facility.id,
      from: requireString(form, 'from', 'Effective from'),
      ratePpm: parsePercentField(rateRaw, 'annualRate'),
      actor: accessService.getCurrentUser().id,
      expectedRevision: readRevision(form),
    });
    revalidateFinance(projectId);
    return updated;
  });
}

/** FIN02/FIN03 — a dated draw, repayment, fee or correction. */
export async function recordFacilityMovementAction(_previous: ActionResult<unknown>, form: FormData): Promise<ActionResult<unknown>> {
  return runAction('Movement recorded', () => {
    const projectId = guardProject(form, 'finance.edit');
    const facility = fundingService.requireFacility(asId<'DebtFacility'>(requireString(form, 'facilityId', 'Facility')));
    if (facility.projectId !== projectId) throw new ValidationError('That facility belongs to another project.');
    const kind = readChoice(form, 'kind', MOVEMENT_KINDS) ?? 'draw';
    const corrects = readString(form, 'correctsMovementId');
    const created = fundingService.recordMovement({
      facilityId: facility.id,
      on: requireString(form, 'on', 'Date'),
      kind,
      amount: readMoney(form, 'amount', 'Amount', { required: true, allowNegative: kind === 'correction' }) ?? money(0),
      basis: readChoice(form, 'basis', MOVEMENT_BASES) ?? 'actual',
      source: 'manual',
      reference: readString(form, 'reference'),
      note: readString(form, 'note'),
      ...(corrects ? { correctsMovementId: asId<'FacilityMovement'>(corrects) } : {}),
      actor: accessService.getCurrentUser().id,
      expectedRevision: readRevision(form),
    });
    revalidateFinance(projectId);
    return created;
  });
}

/** EQ01 — a new participant. */
export async function createParticipantAction(_previous: ActionResult<unknown>, form: FormData): Promise<ActionResult<unknown>> {
  return runAction('Participant added', () => {
    const projectId = guardProject(form, 'finance.edit');
    const created = fundingService.createParticipant({
      projectId,
      name: requireString(form, 'name', 'Name'),
      investorReference: readString(form, 'investorReference') ?? '',
      class: readChoice(form, 'class', PARTICIPANT_CLASSES) ?? 'ordinary',
      commitment: readMoney(form, 'commitment', 'Commitment', { required: true }) ?? money(0),
      participationWeight: readWeight(form, 'participationWeight', 1),
      preferredRatePpm: parsePercentField(readString(form, 'preferredRate') ?? '0', 'preferredRate'),
      residualShareWeight: readWeight(form, 'residualShareWeight', 0),
      actor: accessService.getCurrentUser().id,
      expectedRevision: readRevision(form),
    });
    revalidateFinance(projectId);
    return created;
  });
}

/** EQ02 — a contribution or one distribution component. */
export async function recordEquityMovementAction(_previous: ActionResult<unknown>, form: FormData): Promise<ActionResult<unknown>> {
  return runAction('Equity movement recorded', () => {
    const projectId = guardProject(form, 'finance.edit');
    const type = readChoice(form, 'type', EQUITY_MOVEMENT_TYPES);
    if (!type) throw new ValidationError('Choose a movement type.', { fieldErrors: { type: ['Choose a type.'] } });
    const created = fundingService.recordEquityMovement({
      projectId,
      participantId: asId<'EquityParticipant'>(requireString(form, 'participantId', 'Participant')),
      on: requireString(form, 'on', 'Date'),
      type,
      amount: readMoney(form, 'amount', 'Amount', { required: true }) ?? money(0),
      basis: readChoice(form, 'basis', MOVEMENT_BASES) ?? 'actual',
      note: readString(form, 'note'),
      actor: accessService.getCurrentUser().id,
      expectedRevision: readRevision(form),
    });
    revalidateFinance(projectId);
    return created;
  });
}

/** WFL04 — approve a draft; the drafter may not approve. */
export async function approveWaterfallAction(_previous: ActionResult<unknown>, form: FormData): Promise<ActionResult<unknown>> {
  return runAction('Agreement approved', () => {
    const projectId = guardProject(form, 'baseline.publish');
    const reason = readString(form, 'reason');
    if (!reason) throw new ValidationError('Give a reason for the approval.', { fieldErrors: { reason: ['A reason is required.'] } });
    const updated = fundingService.approveWaterfall(asId<'WaterfallVersion'>(requireString(form, 'versionId', 'Version')), accessService.getCurrentUser().id, reason);
    revalidateFinance(projectId);
    return updated;
  });
}

/** WFL04 — publish an approved version. */
export async function publishWaterfallAction(_previous: ActionResult<unknown>, form: FormData): Promise<ActionResult<unknown>> {
  return runAction('Agreement published', () => {
    const projectId = guardProject(form, 'baseline.publish');
    const updated = fundingService.publishWaterfall(
      asId<'WaterfallVersion'>(requireString(form, 'versionId', 'Version')),
      accessService.getCurrentUser().id,
      readRevision(form),
    );
    revalidateFinance(projectId);
    return updated;
  });
}

/** WFL03/WFL04 — record the movements a preview proposes. A person's decision, not automation. */
export async function recordDistributionAction(_previous: ActionResult<unknown>, form: FormData): Promise<ActionResult<unknown>> {
  return runAction(
    (movements: readonly unknown[]) => `Distribution recorded · ${movements.length} movements`,
    () => {
      const projectId = guardProject(form, 'finance.edit');
      const created = fundingService.recordDistribution({
        projectId,
        availableCash: readMoney(form, 'availableCash', 'Available cash', { required: true, allowNegative: true }) ?? money(0),
        requiredDebt: readMoney(form, 'requiredDebt', 'Required debt') ?? money(0),
        asOf: readString(form, 'asOf') ?? resolveAsOfDate(),
        actor: accessService.getCurrentUser().id,
        expectedRevision: readRevision(form),
      });
      revalidateFinance(projectId);
      return created;
    },
  );
}

/**
 * WFL04 — run the published agreement over a cash figure. A read: nothing is
 * written, so it needs only `financials.read`. The form reads the preview from
 * the result's `value`.
 */
export async function previewDistributionAction(_previous: ActionResult<unknown>, form: FormData): Promise<ActionResult<unknown>> {
  return runAction('Preview ready', () => {
    accessService.guard('development.read');
    const projectId = requireString(form, 'projectId', 'Project');
    const available = readMoney(form, 'availableCash', 'Available cash', { required: true, allowNegative: true }) ?? money(0);
    const required = readMoney(form, 'requiredDebt', 'Required debt') ?? money(0);
    return fundingApi.preview(projectId, {
      availableCash: (available.cents / 100).toFixed(2),
      requiredDebt: (required.cents / 100).toFixed(2),
      asOf: readString(form, 'asOf') ?? resolveAsOfDate(),
    });
  });
}
