/**
 * Funding business logic (FIN01–FIN06, EQ01–EQ03, WFL01–WFL04, CAL15–CAL17, CAL20).
 *
 * Every balance here is derived on read from dated movements: the finance
 * engine runs the facility ledger, accrues preferred return, solves IRR and
 * applies the waterfall. This file decides *which* movements feed a
 * calculation (actual, planned, or both) and enforces the write rules —
 * period locks, availability windows, commitments, template order and the
 * two-person approval of an agreement. It never stores a computed figure.
 */
import { randomUUID } from 'node:crypto';
import {
  accrualScaled,
  addMonthsToKey,
  aggregateByDate,
  monthKeyOf,
  monthKeysBetween,
  peakBalance,
  postAccrual,
  runFacilityLedger,
  runWaterfall,
  xirr,
  type DatedBalanceMovement,
  type DatedCashFlow,
  type FacilityLedgerResult,
  type FacilityMovementInput,
  type FacilityTerms,
  type MonthKey,
  type Ppm,
  type WaterfallInput,
  type WaterfallParticipant,
  type WaterfallResult,
  type XirrResult,
} from '@/shared/finance-engine';
import { ConflictError, ForbiddenError, NotFoundError, PolicyRequiredError, ValidationError } from '@/shared/lib/errors';
import { addMonths, daysBetween } from '@/shared/lib/dates';
import { formatMoney, money, type Money } from '@/shared/lib/money';
import {
  asId,
  type DebtFacilityId,
  type EquityParticipantId,
  type FacilityMovementId,
  type IsoDate,
  type LegalEntityId,
  type ProjectId,
  type UserId,
  type WaterfallVersionId,
} from '@/shared/types/common';
import { accessService } from '@/modules/access/service';
import type { Project } from '@/modules/projects/model';
import { projectsService } from '@/modules/projects/service';
import { fundingRepository } from './repository';
import {
  EQUITY_MOVEMENT_TYPES,
  FACILITY_TYPES,
  MOVEMENT_KINDS,
  PARTICIPANT_CLASSES,
  WATERFALL_TEMPLATE,
  type CapitalAccount,
  type DebtFacility,
  type EquityMovement,
  type EquityMovementType,
  type EquityParticipant,
  type FacilityFee,
  type FacilityMovement,
  type MovementBasis,
  type MovementKind,
  type MovementSource,
  type WaterfallTier,
  type WaterfallVersion,
} from './model';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/* ---------- Public input and output shapes ---------- */

export interface CreateFacilityInput {
  readonly projectId: ProjectId;
  readonly name: string;
  readonly lender: string;
  readonly borrowerLegalEntityId: LegalEntityId;
  readonly type: DebtFacility['type'];
  readonly limit: Money;
  readonly openingPrincipal?: Money;
  /** Defaults to `availableFrom`. */
  readonly openingOn?: IsoDate;
  readonly availableFrom: IsoDate;
  readonly availableTo: IsoDate;
  readonly maturityOn: IsoDate;
  readonly drawRank: number;
  readonly repaymentRank: number;
  /** Annual rate in ppm — 82_500 for 8.25% (FIN01). */
  readonly ratePpm: Ppm;
  /** Defaults to `openingOn`. */
  readonly rateFrom?: IsoDate;
  readonly dayCount?: DebtFacility['dayCount'];
  readonly interestTreatment?: DebtFacility['interestTreatment'];
  readonly fees?: readonly FacilityFee[];
  readonly actor: UserId;
  readonly expectedRevision?: number;
}

export interface RecordMovementInput {
  readonly facilityId: DebtFacilityId;
  readonly on: IsoDate;
  readonly kind: MovementKind;
  /** Positive magnitude; a correction is signed. */
  readonly amount: Money;
  readonly basis: MovementBasis;
  readonly source?: MovementSource;
  readonly reference?: string;
  readonly note?: string;
  readonly correctsMovementId?: FacilityMovementId;
  readonly actor: UserId;
  readonly expectedRevision?: number;
}

export interface CreateParticipantInput {
  readonly projectId: ProjectId;
  readonly name: string;
  readonly investorReference: string;
  readonly class: EquityParticipant['class'];
  readonly commitment: Money;
  readonly participationWeight: number;
  readonly preferredRatePpm: Ppm;
  readonly residualShareWeight: number;
  readonly actor: UserId;
  readonly expectedRevision?: number;
}

export interface RecordEquityMovementInput {
  readonly projectId: ProjectId;
  readonly participantId: EquityParticipantId;
  readonly on: IsoDate;
  readonly type: EquityMovementType;
  readonly amount: Money;
  readonly basis: MovementBasis;
  readonly note?: string;
  readonly actor: UserId;
  readonly expectedRevision?: number;
}

/** A movement the caller has planned but not stored (the project model's own draws). */
export interface ExtraPlannedMovement {
  readonly on: IsoDate;
  readonly kind: 'draw' | 'repayment';
  readonly cents: number;
}

export interface FundingSources {
  readonly equity: readonly { readonly id: EquityParticipantId; readonly rank: number; readonly availableCents: number }[];
  readonly debt: readonly {
    readonly id: DebtFacilityId;
    readonly drawRank: number;
    readonly repayRank: number;
    readonly availableCents: number;
    readonly outstandingCents: number;
    readonly limitCents: number;
  }[];
}

export interface PlannedPosition {
  /** Contributions the caller has already planned per participant, not yet stored. */
  readonly equityDrawnCents: ReadonlyMap<EquityParticipantId, number>;
  /** Principal the caller has already planned per facility, not yet stored. Added to the stored position. */
  readonly debtOutstandingCents: ReadonlyMap<DebtFacilityId, number>;
}

export interface PeakResult {
  readonly cents: number;
  readonly on: IsoDate | null;
}

export interface FinanceCostMonth {
  readonly cashInterestCents: number;
  readonly capitalisedInterestCents: number;
  readonly feesCents: number;
  readonly drawsCents: number;
  readonly repaymentsCents: number;
  readonly closingPrincipalCents: number;
  readonly breaches: number;
}

export interface DraftWaterfallInput {
  readonly projectId: ProjectId;
  readonly tiers: readonly WaterfallTier[];
  readonly reserve: Money;
  readonly effectiveFrom: IsoDate;
  readonly reason: string;
  readonly actor: UserId;
}

export interface DistributionRequest {
  readonly projectId: ProjectId;
  readonly availableCash: Money;
  readonly asOf: IsoDate;
  readonly requiredDebt: Money;
}

export interface ParticipantMetric {
  readonly participantId: EquityParticipantId;
  readonly name: string;
  readonly totalCents: number;
  readonly irr: XirrResult;
}

export interface DistributionPreview {
  readonly version: WaterfallVersion;
  readonly input: WaterfallInput;
  readonly result: WaterfallResult;
  readonly participantMetrics: readonly ParticipantMetric[];
}

export interface CloneOptions {
  readonly structure: boolean;
  readonly assumptions: boolean;
}

export interface CloneResult {
  readonly facilities: readonly DebtFacility[];
  readonly participants: readonly EquityParticipant[];
  readonly waterfall: WaterfallVersion | null;
}

/* ---------- Small helpers ---------- */

function now(): string {
  return new Date().toISOString();
}

function actorName(userId: UserId): string {
  return accessService.resolveUserName(userId) ?? 'system';
}

function audit(actor: UserId, summary: string, context: string): void {
  accessService.record({ actor: actorName(actor), summary, context });
}

function requireIsoDate(value: string | undefined, field: string, label: string): IsoDate {
  if (!value || !ISO_DATE.test(value)) {
    throw new ValidationError(`Enter ${label.toLowerCase()} as YYYY-MM-DD.`, { fieldErrors: { [field]: ['Use the format YYYY-MM-DD.'] } });
  }
  return value;
}

function requirePositive(value: Money, field: string, label: string): void {
  if (value.cents <= 0) {
    throw new ValidationError(`Enter ${label.toLowerCase()} greater than zero.`, {
      fieldErrors: { [field]: [`${label} must be greater than zero.`] },
    });
  }
}

function requireRank(value: number, field: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new ValidationError('Ranks are whole numbers starting at 1.', { fieldErrors: { [field]: ['Enter 1 for the first facility used, 2 for the next.'] } });
  }
}

function requirePpm(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new ValidationError('Enter the annual rate as a percentage, e.g. 8.25 for 8.25%.', {
      fieldErrors: { [field]: ['Enter a rate of zero or more, e.g. 8.25.'] },
    });
  }
}

function principalDelta(movement: { readonly kind: MovementKind; readonly cents: number }): number {
  switch (movement.kind) {
    case 'draw':
      return movement.cents;
    case 'repayment':
      return -movement.cents;
    case 'correction':
      return movement.cents;
    case 'fee':
      return 0;
  }
}

function actualsCutoffOf(projectId: ProjectId): IsoDate {
  return projectsService.policyFor(projectId).actualsCutoff;
}

/**
 * The movements a calculation may use: every actual, plus planned movements
 * dated after the actuals cutoff. A planned movement inside a closed period
 * is superseded by whatever was actually recorded there (CF06, FIN02).
 */
function isEffective(movement: { readonly basis: MovementBasis; readonly on: IsoDate }, cutoff: IsoDate): boolean {
  return movement.basis === 'actual' || movement.on > cutoff;
}

function ledgerInputs(facility: DebtFacility, extraPlanned?: readonly ExtraPlannedMovement[]): FacilityMovementInput[] {
  const cutoff = actualsCutoffOf(facility.projectId);
  const inputs: FacilityMovementInput[] = fundingRepository
    .listMovements(facility.id)
    .filter((movement) => isEffective(movement, cutoff))
    .map((movement) => ({ on: movement.on, kind: movement.kind, cents: movement.amount.cents }));
  // Declared fees dated inside the life of the facility show in the fee column (FIN06).
  for (const fee of facility.fees) {
    if (fee.on) inputs.push({ on: fee.on, kind: 'fee', cents: fee.amount.cents });
  }
  for (const extra of extraPlanned ?? []) inputs.push({ on: extra.on, kind: extra.kind, cents: extra.cents });
  return inputs;
}

function earliestMonth(facility: DebtFacility, inputs: readonly FacilityMovementInput[]): MonthKey {
  let earliest = facility.openingOn;
  for (const input of inputs) if (input.on < earliest) earliest = input.on;
  return monthKeyOf(earliest);
}

/**
 * Principal outstanding at the end of `on`, including interest capitalised at
 * earlier month ends: the prior month's ledger closing plus this month's
 * movements up to and including the day (FIN05).
 */
function principalOn(facility: DebtFacility, on: IsoDate, extraPlanned?: readonly ExtraPlannedMovement[]): number {
  const inputs = ledgerInputs(facility, extraPlanned);
  const startMonth = earliestMonth(facility, inputs);
  const onMonth = monthKeyOf(on);
  let principal = 0;
  if (onMonth > startMonth) {
    principal = runFacilityLedger(fundingService.facilityTerms(facility), inputs, startMonth, addMonthsToKey(onMonth, -1)).closingPrincipalCents;
  }
  const monthStart = `${onMonth}-01`;
  if (facility.openingOn >= monthStart && facility.openingOn <= on) principal += facility.openingPrincipal.cents;
  for (const input of inputs) {
    if (input.on >= monthStart && input.on <= on) principal += principalDelta(input);
  }
  return principal;
}

/** Signed day-by-day principal changes inside a ledger window, for a cross-facility peak (CAL20). */
function dailyPrincipalDeltas(
  facility: DebtFacility,
  inputs: readonly FacilityMovementInput[],
  ledger: FacilityLedgerResult,
  fromMonth: MonthKey,
): DatedBalanceMovement[] {
  const windowStart = `${fromMonth}-01`;
  const deltas: DatedBalanceMovement[] = [];
  const opening = ledger.months[0]?.openingPrincipalCents ?? 0;
  if (opening !== 0) deltas.push({ date: windowStart, cents: opening });
  if (facility.openingOn >= windowStart && facility.openingPrincipal.cents !== 0) {
    deltas.push({ date: facility.openingOn, cents: facility.openingPrincipal.cents });
  }
  for (const input of inputs) {
    if (input.on < windowStart) continue;
    const delta = principalDelta(input);
    if (delta !== 0) deltas.push({ date: input.on, cents: delta });
  }
  for (const posting of ledger.interestPostings) {
    if (posting.treatment === 'capitalised' && posting.cents !== 0) deltas.push({ date: posting.on, cents: posting.cents });
  }
  return deltas;
}

function participantIdsOf(tier: WaterfallTier | undefined): ReadonlySet<string> | null {
  if (!tier || !tier.participantIds) return null;
  return new Set(tier.participantIds);
}

function inTier(allowed: ReadonlySet<string> | null, participantId: EquityParticipantId): boolean {
  return allowed === null || allowed.has(participantId);
}

/** The forecast window of a project: `forecastHorizonMonths` from the start month. */
export function projectHorizon(project: Project): { readonly fromMonth: MonthKey; readonly toMonth: MonthKey } {
  const fromMonth = monthKeyOf(project.startDate);
  const toMonth = monthKeyOf(addMonths(project.startDate, Math.max(project.forecastHorizonMonths, 1) - 1));
  return { fromMonth, toMonth };
}

/* ---------- The service ---------- */

export const fundingService = {
  /* ----- Debt facilities (FIN01–FIN03) ----- */

  listFacilities(projectId: ProjectId): readonly DebtFacility[] {
    return fundingRepository.listFacilities(projectId);
  },

  requireFacility(id: DebtFacilityId): DebtFacility {
    const facility = fundingRepository.findFacility(id);
    if (!facility) throw new NotFoundError('Debt facility', id);
    return facility;
  },

  createFacility(input: CreateFacilityInput): DebtFacility {
    projectsService.assertMutable(input.projectId);
    if (!input.name.trim()) throw new ValidationError('Enter a facility name.', { fieldErrors: { name: ['A facility needs a name.'] } });
    if (!input.lender.trim()) throw new ValidationError('Enter the lender.', { fieldErrors: { lender: ['Name the lender.'] } });
    projectsService.requireLegalEntity(input.borrowerLegalEntityId);
    if (!FACILITY_TYPES.includes(input.type)) throw new ValidationError(`"${input.type}" is not a facility type.`, { fieldErrors: { type: ['Choose senior, mezzanine or other.'] } });
    requirePositive(input.limit, 'limit', 'Committed limit');
    const openingPrincipal = input.openingPrincipal ?? money(0);
    if (openingPrincipal.cents < 0) throw new ValidationError('Opening principal cannot be negative.', { fieldErrors: { openingPrincipal: ['Enter zero or more.'] } });
    const availableFrom = requireIsoDate(input.availableFrom, 'availableFrom', 'Available from');
    const availableTo = requireIsoDate(input.availableTo, 'availableTo', 'Available to');
    const maturityOn = requireIsoDate(input.maturityOn, 'maturityOn', 'Maturity');
    const openingOn = requireIsoDate(input.openingOn ?? availableFrom, 'openingOn', 'Opening date');
    const rateFrom = requireIsoDate(input.rateFrom ?? openingOn, 'rateFrom', 'Rate effective from');
    if (availableTo < availableFrom) throw new ValidationError('The availability window ends before it starts.', { fieldErrors: { availableTo: ['Choose a date on or after "available from".'] } });
    if (maturityOn < availableTo) throw new ValidationError('Maturity must be on or after the end of availability.', { fieldErrors: { maturityOn: ['Choose a date on or after "available to".'] } });
    requireRank(input.drawRank, 'drawRank');
    requireRank(input.repaymentRank, 'repaymentRank');
    requirePpm(input.ratePpm, 'annualRate');
    for (const fee of input.fees ?? []) {
      if (fee.amount.cents < 0) throw new ValidationError('A fee cannot be negative.', { fieldErrors: { fees: ['Enter zero or more.'] } });
      if (fee.on) requireIsoDate(fee.on, 'fees', 'Fee date');
    }

    projectsService.bumpRevision(input.projectId, input.expectedRevision);
    const facility: DebtFacility = {
      id: asId<'DebtFacility'>(`fac-${randomUUID()}`),
      projectId: input.projectId,
      name: input.name.trim(),
      lender: input.lender.trim(),
      borrowerLegalEntityId: input.borrowerLegalEntityId,
      type: input.type,
      limit: input.limit,
      openingPrincipal,
      openingOn,
      availableFrom,
      availableTo,
      maturityOn,
      drawRank: input.drawRank,
      repaymentRank: input.repaymentRank,
      rateSteps: [{ from: rateFrom, ratePpm: input.ratePpm }],
      dayCount: input.dayCount ?? 'ACT/365F',
      interestTreatment: input.interestTreatment ?? 'capitalised',
      fees: input.fees ?? [],
      state: 'active',
      createdAt: now(),
      createdBy: input.actor,
    };
    const created = fundingRepository.insertFacility(facility);
    audit(
      input.actor,
      `Facility created · ${created.name} · ${created.lender}`,
      `${projectsService.require(input.projectId).code} · limit ${formatMoney(created.limit)} · ${created.type} · ${created.availableFrom}→${created.availableTo} · matures ${created.maturityOn} · rate ${created.rateSteps[0]?.ratePpm ?? 0} ppm from ${rateFrom}`,
    );
    return created;
  },

  /** Rates are effective dated: a new step is appended; nothing rewrites history (FIN01). */
  addRateStep(input: { readonly facilityId: DebtFacilityId; readonly from: IsoDate; readonly ratePpm: Ppm; readonly actor: UserId; readonly expectedRevision?: number }): DebtFacility {
    const facility = fundingService.requireFacility(input.facilityId);
    projectsService.assertMutable(facility.projectId);
    const from = requireIsoDate(input.from, 'from', 'Effective from');
    requirePpm(input.ratePpm, 'annualRate');
    if (facility.rateSteps.some((step) => step.from === from)) {
      throw new ValidationError(`A rate already takes effect on ${from}. Choose a different day.`, { fieldErrors: { from: ['A step already starts on this day.'] } });
    }
    projectsService.bumpRevision(facility.projectId, input.expectedRevision);
    const rateSteps = [...facility.rateSteps, { from, ratePpm: input.ratePpm }].sort((a, b) => a.from.localeCompare(b.from));
    const updated = fundingRepository.updateFacility(facility.id, { rateSteps });
    if (!updated) throw new NotFoundError('Debt facility', facility.id);
    audit(input.actor, `Rate step added · ${facility.name}`, `${input.ratePpm} ppm from ${from} · ${rateSteps.length} steps`);
    return updated;
  },

  /** Limits and dates may move; terms, ranks and history do not (use a new facility instead). */
  updateFacility(
    id: DebtFacilityId,
    changes: Partial<Pick<DebtFacility, 'limit' | 'availableFrom' | 'availableTo' | 'maturityOn' | 'state'>>,
    actor: UserId,
    expectedRevision?: number,
  ): DebtFacility {
    const facility = fundingService.requireFacility(id);
    projectsService.assertMutable(facility.projectId);
    const next = { ...facility, ...changes };
    if (changes.limit) requirePositive(changes.limit, 'limit', 'Committed limit');
    if (changes.availableFrom) requireIsoDate(changes.availableFrom, 'availableFrom', 'Available from');
    if (changes.availableTo) requireIsoDate(changes.availableTo, 'availableTo', 'Available to');
    if (changes.maturityOn) requireIsoDate(changes.maturityOn, 'maturityOn', 'Maturity');
    if (next.availableTo < next.availableFrom) throw new ValidationError('The availability window ends before it starts.', { fieldErrors: { availableTo: ['Choose a date on or after "available from".'] } });
    if (next.maturityOn < next.availableTo) throw new ValidationError('Maturity must be on or after the end of availability.', { fieldErrors: { maturityOn: ['Choose a date on or after "available to".'] } });
    projectsService.bumpRevision(facility.projectId, expectedRevision);
    const updated = fundingRepository.updateFacility(id, changes);
    if (!updated) throw new NotFoundError('Debt facility', id);
    audit(actor, `Facility updated · ${facility.name}`, `Fields: ${Object.keys(changes).join(', ') || 'nothing'}`);
    return updated;
  },

  listMovements(facilityId: DebtFacilityId): readonly FacilityMovement[] {
    return fundingRepository.listMovements(facilityId);
  },

  listProjectMovements(projectId: ProjectId): readonly FacilityMovement[] {
    return fundingRepository.listProjectMovements(projectId);
  },

  /**
   * Record a dated draw, repayment, fee or correction (FIN02, FIN03).
   *
   * A draw outside the availability window is refused. A draw that takes the
   * facility over its limit is *recorded* — the lender's ledger will show it
   * too — but the audit entry carries the warning and the ledger shows the
   * breach until it is cured. An actual movement in a closed period is refused;
   * record a correction dated today that names the original instead (CF06).
   */
  recordMovement(input: RecordMovementInput): FacilityMovement {
    const facility = fundingService.requireFacility(input.facilityId);
    const project = projectsService.assertMutable(facility.projectId);
    const on = requireIsoDate(input.on, 'on', 'Movement date');
    if (!MOVEMENT_KINDS.includes(input.kind)) throw new ValidationError(`"${input.kind}" is not a movement kind.`, { fieldErrors: { kind: ['Choose draw, repayment, fee or correction.'] } });
    if (input.kind === 'correction') {
      if (input.amount.cents === 0) throw new ValidationError('A correction needs a signed amount other than zero.', { fieldErrors: { amount: ['Enter a positive amount to add principal or a negative amount to remove it.'] } });
    } else {
      requirePositive(input.amount, 'amount', 'Amount');
    }
    if (input.kind === 'draw' && (on < facility.availableFrom || on > facility.availableTo)) {
      throw new ValidationError(`${facility.name} can only be drawn between ${facility.availableFrom} and ${facility.availableTo}.`, {
        fieldErrors: { on: [`Choose a date between ${facility.availableFrom} and ${facility.availableTo}.`] },
      });
    }
    if (input.correctsMovementId) {
      const original = fundingRepository.findMovement(input.correctsMovementId);
      if (!original || original.facilityId !== facility.id) {
        throw new ValidationError('The movement being corrected was not found on this facility.', { fieldErrors: { correctsMovementId: ['Choose a movement of this facility.'] } });
      }
    }
    if (input.basis === 'actual' && projectsService.isPeriodLocked(project.id, on)) {
      throw new ConflictError(
        `${on} falls in a closed period (actuals to ${actualsCutoffOf(project.id)}). Record a correction dated today that names the original movement instead.`,
        { lockedThrough: actualsCutoffOf(project.id) },
      );
    }

    const delta = principalDelta({ kind: input.kind, cents: input.amount.cents });
    let warning: string | null = null;
    if (delta > 0) {
      const after = principalOn(facility, on) + delta;
      if (after > facility.limit.cents) {
        warning = `LIMIT BREACH · principal ${formatMoney(money(after))} exceeds limit ${formatMoney(facility.limit)} by ${formatMoney(money(after - facility.limit.cents))}`;
      }
    }

    projectsService.bumpRevision(project.id, input.expectedRevision);
    const movement: FacilityMovement = {
      id: asId<'FacilityMovement'>(`fmv-${randomUUID()}`),
      projectId: project.id,
      facilityId: facility.id,
      on,
      kind: input.kind,
      amount: input.amount,
      basis: input.basis,
      source: input.source ?? 'manual',
      ...(input.reference?.trim() ? { reference: input.reference.trim() } : {}),
      ...(input.note?.trim() ? { note: input.note.trim() } : {}),
      ...(input.correctsMovementId ? { correctsMovementId: input.correctsMovementId } : {}),
      createdAt: now(),
      createdBy: input.actor,
    };
    const created = fundingRepository.insertMovement(movement);
    audit(
      input.actor,
      `Facility ${input.kind} recorded · ${facility.name} · ${formatMoney(input.amount, { showCents: true })}`,
      `${project.code} · ${input.basis} · ${on}${input.reference ? ` · ${input.reference}` : ''}${input.correctsMovementId ? ` · corrects ${input.correctsMovementId}` : ''}${warning ? ` · ${warning}` : ''}`,
    );
    return created;
  },

  /**
   * The dated ledger and monthly rollup of one facility (FIN03, FIN05, CAL15).
   * Actual and effective planned movements, declared fees and the caller's
   * extra planned movements all run through the engine together.
   */
  facilityLedger(facilityId: DebtFacilityId, fromMonth: MonthKey, toMonth: MonthKey, extraPlanned?: readonly ExtraPlannedMovement[]): FacilityLedgerResult {
    const facility = fundingService.requireFacility(facilityId);
    return runFacilityLedger(fundingService.facilityTerms(facility), ledgerInputs(facility, extraPlanned), fromMonth, toMonth);
  },

  facilityTerms(facility: DebtFacility): FacilityTerms {
    return {
      limitCents: facility.limit.cents,
      openingPrincipalCents: facility.openingPrincipal.cents,
      openingOn: facility.openingOn,
      rateSteps: facility.rateSteps,
      dayCount: facility.dayCount,
      interestTreatment: facility.interestTreatment,
      maturityOn: facility.maturityOn,
    };
  },

  /**
   * What the funding order may draw on a day (FIN04). Equity is ranked sponsor
   * first, then by participation weight, then id; debt carries its own ranks.
   * The engine's `applyFundingOrder` consumes this — nothing here draws.
   */
  fundingSources(projectId: ProjectId, on: IsoDate, planned?: PlannedPosition): FundingSources {
    const cutoff = actualsCutoffOf(projectId);
    const ranked = [...fundingRepository.listParticipants(projectId)]
      .sort(
        (a, b) =>
          (a.class === 'sponsor' ? 0 : 1) - (b.class === 'sponsor' ? 0 : 1) ||
          b.participationWeight - a.participationWeight ||
          a.id.localeCompare(b.id),
      )
      .map((participant, index) => {
        const contributed = fundingRepository
          .listMovementsForParticipant(participant.id)
          .filter((movement) => movement.type === 'contribution' && movement.on <= on && isEffective(movement, cutoff))
          .reduce((sum, movement) => sum + movement.amount.cents, 0);
        const extra = planned?.equityDrawnCents.get(participant.id) ?? 0;
        return { id: participant.id, rank: index + 1, availableCents: Math.max(participant.commitment.cents - contributed - extra, 0) };
      });

    const debt = fundingRepository.listFacilities(projectId).map((facility) => {
      const outstanding = principalOn(facility, on) + (planned?.debtOutstandingCents.get(facility.id) ?? 0);
      const open = facility.state === 'active' && on >= facility.availableFrom && on <= facility.availableTo && on <= facility.maturityOn;
      return {
        id: facility.id,
        drawRank: facility.drawRank,
        repayRank: facility.repaymentRank,
        availableCents: open ? Math.max(facility.limit.cents - outstanding, 0) : 0,
        outstandingCents: outstanding,
        limitCents: facility.limit.cents,
      };
    });
    return { equity: ranked, debt };
  },

  /* ----- Equity participants (EQ01–EQ02) ----- */

  listParticipants(projectId: ProjectId): readonly EquityParticipant[] {
    return fundingRepository.listParticipants(projectId);
  },

  requireParticipant(id: EquityParticipantId): EquityParticipant {
    const participant = fundingRepository.findParticipant(id);
    if (!participant) throw new NotFoundError('Equity participant', id);
    return participant;
  },

  createParticipant(input: CreateParticipantInput): EquityParticipant {
    projectsService.assertMutable(input.projectId);
    if (!input.name.trim()) throw new ValidationError('Enter the participant name.', { fieldErrors: { name: ['A participant needs a name.'] } });
    if (!PARTICIPANT_CLASSES.includes(input.class)) throw new ValidationError(`"${input.class}" is not a participant class.`, { fieldErrors: { class: ['Choose sponsor, preferred or ordinary.'] } });
    if (input.commitment.cents < 0) throw new ValidationError('A commitment cannot be negative.', { fieldErrors: { commitment: ['Enter zero or more.'] } });
    if (!Number.isFinite(input.participationWeight) || input.participationWeight < 0) throw new ValidationError('Participation weight must be zero or more.', { fieldErrors: { participationWeight: ['Enter zero or more.'] } });
    if (!Number.isFinite(input.residualShareWeight) || input.residualShareWeight < 0) throw new ValidationError('Residual share must be zero or more.', { fieldErrors: { residualShareWeight: ['Enter zero or more.'] } });
    requirePpm(input.preferredRatePpm, 'preferredRate');
    projectsService.bumpRevision(input.projectId, input.expectedRevision);
    const participant: EquityParticipant = {
      id: asId<'EquityParticipant'>(`eqp-${randomUUID()}`),
      projectId: input.projectId,
      name: input.name.trim(),
      investorReference: input.investorReference.trim(),
      class: input.class,
      commitment: input.commitment,
      participationWeight: input.participationWeight,
      preferredRatePpm: input.preferredRatePpm,
      residualShareWeight: input.residualShareWeight,
      createdAt: now(),
    };
    const created = fundingRepository.insertParticipant(participant);
    audit(
      input.actor,
      `Equity participant added · ${created.name}`,
      `${projectsService.require(input.projectId).code} · ${created.class} · commitment ${formatMoney(created.commitment)} · preferred ${created.preferredRatePpm} ppm · residual share ${created.residualShareWeight}`,
    );
    return created;
  },

  listEquityMovements(projectId: ProjectId): readonly EquityMovement[] {
    return fundingRepository.listEquityMovements(projectId);
  },

  movementsForParticipant(participantId: EquityParticipantId): readonly EquityMovement[] {
    return fundingRepository.listMovementsForParticipant(participantId);
  },

  /**
   * Record a contribution or one component of a distribution (EQ01, EQ02).
   * A contribution may not exceed the remaining commitment on its basis; a
   * capital return may not exceed outstanding capital; an actual in a closed
   * period is refused.
   */
  recordEquityMovement(input: RecordEquityMovementInput): EquityMovement {
    const participant = fundingService.requireParticipant(input.participantId);
    if (participant.projectId !== input.projectId) throw new NotFoundError('Equity participant', input.participantId);
    const project = projectsService.assertMutable(input.projectId);
    const on = requireIsoDate(input.on, 'on', 'Movement date');
    if (!EQUITY_MOVEMENT_TYPES.includes(input.type)) throw new ValidationError(`"${input.type}" is not an equity movement type.`, { fieldErrors: { type: ['Choose a movement type.'] } });
    requirePositive(input.amount, 'amount', 'Amount');

    const cutoff = actualsCutoffOf(project.id);
    const movements = fundingRepository.listMovementsForParticipant(participant.id);
    if (input.type === 'contribution') {
      const counted = movements.filter(
        (movement) => movement.type === 'contribution' && (input.basis === 'actual' ? movement.basis === 'actual' : isEffective(movement, cutoff)),
      );
      const remaining = participant.commitment.cents - counted.reduce((sum, movement) => sum + movement.amount.cents, 0);
      if (input.amount.cents > remaining) {
        throw new ValidationError(`${participant.name} has ${formatMoney(money(Math.max(remaining, 0)), { showCents: true })} of commitment remaining.`, {
          fieldErrors: { amount: [`Enter at most ${formatMoney(money(Math.max(remaining, 0)), { showCents: true })}, or raise the commitment first.`] },
        });
      }
    }
    if (input.type === 'capital-return' && input.basis === 'actual') {
      const account = fundingService.capitalAccount(participant.id, on);
      if (input.amount.cents > account.outstanding.cents) {
        throw new ValidationError(`${participant.name} has ${formatMoney(account.outstanding, { showCents: true })} of capital outstanding.`, {
          fieldErrors: { amount: ['A return of capital cannot exceed outstanding capital.'] },
        });
      }
    }
    if (input.basis === 'actual' && projectsService.isPeriodLocked(project.id, on)) {
      throw new ConflictError(`${on} falls in a closed period (actuals to ${cutoff}). Record the movement dated today with a note instead.`, { lockedThrough: cutoff });
    }

    projectsService.bumpRevision(project.id, input.expectedRevision);
    const movement: EquityMovement = {
      id: asId<'EquityMovement'>(`eqm-${randomUUID()}`),
      projectId: project.id,
      participantId: participant.id,
      on,
      type: input.type,
      amount: input.amount,
      basis: input.basis,
      ...(input.note?.trim() ? { note: input.note.trim() } : {}),
      createdAt: now(),
      createdBy: input.actor,
    };
    const created = fundingRepository.insertEquityMovement(movement);
    audit(
      input.actor,
      `Equity ${input.type} recorded · ${participant.name} · ${formatMoney(input.amount, { showCents: true })}`,
      `${project.code} · ${input.basis} · ${on}${input.note ? ` · ${input.note}` : ''}`,
    );
    return created;
  },

  /**
   * A participant's capital account from actual movements (EQ02, WFL02).
   * Preferred return is simple ACT/365F interest on the day-by-day outstanding
   * capital from each contribution date to `asOf`, accrued exactly and rounded
   * once at the end; it never compounds.
   */
  capitalAccount(participantId: EquityParticipantId, asOf: IsoDate): CapitalAccount {
    const participant = fundingService.requireParticipant(participantId);
    const actual = fundingRepository.listMovementsForParticipant(participantId).filter((movement) => movement.basis === 'actual' && movement.on <= asOf);
    const sumOf = (type: EquityMovementType): number =>
      actual.filter((movement) => movement.type === type).reduce((sum, movement) => sum + movement.amount.cents, 0);
    const contributed = sumOf('contribution');
    const capitalReturned = sumOf('capital-return');
    const preferredPaid = sumOf('preferred-return');
    const profitDistributed = sumOf('profit-distribution');

    const changes = aggregateByDate(
      actual
        .filter((movement) => movement.type === 'contribution' || movement.type === 'capital-return')
        .map((movement) => ({ date: movement.on, cents: movement.type === 'contribution' ? movement.amount.cents : -movement.amount.cents })),
    );
    let scaled = 0n;
    let balance = 0;
    changes.forEach((change, index) => {
      balance += change.cents;
      const until = changes[index + 1]?.date ?? asOf;
      const days = Math.max(daysBetween(change.date, until), 0);
      scaled += accrualScaled(Math.max(balance, 0), participant.preferredRatePpm, days);
    });
    const preferredAccrued = postAccrual(scaled, 'ACT/365F').cents;

    return {
      contributed: money(contributed),
      capitalReturned: money(capitalReturned),
      outstanding: money(contributed - capitalReturned),
      preferredAccrued: money(preferredAccrued),
      preferredPaid: money(preferredPaid),
      preferredOutstanding: money(preferredAccrued - preferredPaid),
      profitDistributed: money(profitDistributed),
    };
  },

  /** IRR from the participant's own dated flows: contributions out, distributions in, plus any forecast (EQ02, CAL18). */
  participantIrr(participantId: EquityParticipantId, asOf: IsoDate, forecastFlows?: readonly DatedCashFlow[]): XirrResult {
    fundingService.requireParticipant(participantId);
    const actual: DatedCashFlow[] = fundingRepository
      .listMovementsForParticipant(participantId)
      .filter((movement) => movement.basis === 'actual' && movement.on <= asOf)
      .map((movement) => ({ date: movement.on, cents: movement.type === 'contribution' ? -movement.amount.cents : movement.amount.cents }));
    return xirr([...actual, ...(forecastFlows ?? [])]);
  },

  /** Peak equity: the highest cumulative contributions less capital returned, by day (CAL20). */
  peakEquity(projectId: ProjectId, asOf: IsoDate, plannedFlows?: readonly { readonly date: IsoDate; readonly cents: number }[]): PeakResult {
    const actual: DatedBalanceMovement[] = fundingRepository
      .listEquityMovements(projectId)
      .filter((movement) => movement.basis === 'actual' && movement.on <= asOf && (movement.type === 'contribution' || movement.type === 'capital-return'))
      .map((movement) => ({ date: movement.on, cents: movement.type === 'contribution' ? movement.amount.cents : -movement.amount.cents }));
    return peakBalance([...actual, ...(plannedFlows ?? [])]);
  },

  /** Peak debt: the highest day-by-day sum of every facility's principal inside the window (CAL20). */
  peakDebt(projectId: ProjectId, fromMonth: MonthKey, toMonth: MonthKey, extraPlannedByFacility?: ReadonlyMap<DebtFacilityId, readonly ExtraPlannedMovement[]>): PeakResult {
    const deltas: DatedBalanceMovement[] = [];
    for (const facility of fundingRepository.listFacilities(projectId)) {
      const extra = extraPlannedByFacility?.get(facility.id);
      const inputs = ledgerInputs(facility, extra);
      const ledger = runFacilityLedger(fundingService.facilityTerms(facility), inputs, fromMonth, toMonth);
      deltas.push(...dailyPrincipalDeltas(facility, inputs, ledger, fromMonth));
    }
    return peakBalance(deltas);
  },

  /** Financing costs and debt movements by month across every facility (FIN06, CAL16). */
  financeCostsByMonth(
    projectId: ProjectId,
    fromMonth: MonthKey,
    toMonth: MonthKey,
    extraPlannedByFacility?: ReadonlyMap<DebtFacilityId, readonly ExtraPlannedMovement[]>,
  ): ReadonlyMap<MonthKey, FinanceCostMonth> {
    const totals = new Map<MonthKey, FinanceCostMonth>();
    for (const month of monthKeysBetween(fromMonth, toMonth)) {
      totals.set(month, { cashInterestCents: 0, capitalisedInterestCents: 0, feesCents: 0, drawsCents: 0, repaymentsCents: 0, closingPrincipalCents: 0, breaches: 0 });
    }
    for (const facility of fundingRepository.listFacilities(projectId)) {
      const ledger = fundingService.facilityLedger(facility.id, fromMonth, toMonth, extraPlannedByFacility?.get(facility.id));
      for (const month of ledger.months) {
        const current = totals.get(month.month);
        if (!current) continue;
        totals.set(month.month, {
          cashInterestCents: current.cashInterestCents + month.cashInterestCents,
          capitalisedInterestCents: current.capitalisedInterestCents + month.capitalisedInterestCents,
          feesCents: current.feesCents + month.feesCents,
          drawsCents: current.drawsCents + month.drawsCents,
          repaymentsCents: current.repaymentsCents + month.repaymentsCents,
          closingPrincipalCents: current.closingPrincipalCents + month.closingPrincipalCents,
          breaches: current.breaches + month.breaches.length,
        });
      }
    }
    return totals;
  },

  /* ----- Waterfall agreements (WFL01–WFL04) ----- */

  listWaterfallVersions(projectId: ProjectId): readonly WaterfallVersion[] {
    return fundingRepository.listWaterfalls(projectId);
  },

  /** The agreement in force: the latest published version. Superseded versions stay in history. */
  currentWaterfall(projectId: ProjectId): WaterfallVersion | null {
    const published = fundingRepository.listWaterfalls(projectId).filter((version) => version.state === 'published');
    return published[published.length - 1] ?? null;
  },

  /**
   * Draft a new agreement version (WFL01, WFL02). Only the pilot template is
   * supported: required debt, reserve, return of capital, preferred return,
   * residual split, in that order. Any other order needs a policy decision.
   */
  draftWaterfall(input: DraftWaterfallInput): WaterfallVersion {
    const project = projectsService.assertMutable(input.projectId);
    if (!input.reason.trim()) throw new ValidationError('Give a reason for the new agreement version.', { fieldErrors: { reason: ['A reason is required.'] } });
    const effectiveFrom = requireIsoDate(input.effectiveFrom, 'effectiveFrom', 'Effective from');
    if (input.reserve.cents < 0) throw new ValidationError('The reserve cannot be negative.', { fieldErrors: { reserve: ['Enter zero or more.'] } });

    const kinds = input.tiers.map((tier) => tier.kind).join(' → ');
    const matches =
      input.tiers.length === WATERFALL_TEMPLATE.length &&
      input.tiers.every((tier, index) => tier.kind === WATERFALL_TEMPLATE[index]?.kind && tier.basis === WATERFALL_TEMPLATE[index]?.basis && tier.roundingRule === 'residual-to-last-by-id');
    if (!matches) {
      throw new PolicyRequiredError(
        'waterfall-template',
        `This release supports one distribution order: ${WATERFALL_TEMPLATE.map((tier) => tier.kind).join(' → ')}. "${kinds || 'empty'}" needs a policy decision before it can be modelled.`,
      );
    }
    const known = new Set(fundingRepository.listParticipants(project.id).map((participant) => participant.id));
    for (const tier of input.tiers) {
      for (const participantId of tier.participantIds ?? []) {
        if (!known.has(participantId)) throw new ValidationError(`Participant "${participantId}" is not part of ${project.code}.`);
      }
    }

    const versions = fundingRepository.listWaterfalls(project.id);
    const version: WaterfallVersion = {
      id: asId<'WaterfallVersion'>(`wfv-${randomUUID()}`),
      projectId: project.id,
      version: (versions[versions.length - 1]?.version ?? 0) + 1,
      state: 'draft',
      tiers: input.tiers.map((tier, index) => ({ ...tier, order: index + 1 })),
      reserve: input.reserve,
      draftedBy: input.actor,
      effectiveFrom,
      reason: input.reason.trim(),
      createdAt: now(),
    };
    const created = fundingRepository.insertWaterfall(version);
    audit(input.actor, `Waterfall v${created.version} drafted · ${project.code}`, `${created.reason} · reserve ${formatMoney(created.reserve)} · effective ${effectiveFrom}`);
    return created;
  },

  /** Approval is a second person's act: the drafter may not approve their own version (WFL04). */
  approveWaterfall(id: WaterfallVersionId, actor: UserId, reason: string): WaterfallVersion {
    const version = fundingRepository.findWaterfall(id);
    if (!version) throw new NotFoundError('Waterfall version', id);
    projectsService.assertMutable(version.projectId);
    if (version.state !== 'draft') throw new ConflictError(`Waterfall v${version.version} is already ${version.state}.`);
    if (version.draftedBy === actor) throw new ForbiddenError('The person who drafted an agreement cannot approve it. Ask another authorised person to review it.');
    if (!reason.trim()) throw new ValidationError('Give a reason for the approval.', { fieldErrors: { reason: ['A reason is required.'] } });
    const updated = fundingRepository.updateWaterfall(id, { state: 'approved', approvedBy: actor, approvedAt: now() });
    if (!updated) throw new NotFoundError('Waterfall version', id);
    audit(actor, `Waterfall v${version.version} approved · ${projectsService.require(version.projectId).code}`, `${reason.trim()} · drafted by ${actorName(version.draftedBy)}`);
    return updated;
  },

  /** Publication needs an approved version; it supersedes the previous published one, which stays in history. */
  publishWaterfall(id: WaterfallVersionId, actor: UserId, expectedRevision?: number): WaterfallVersion {
    const version = fundingRepository.findWaterfall(id);
    if (!version) throw new NotFoundError('Waterfall version', id);
    const project = projectsService.assertMutable(version.projectId);
    if (version.state !== 'approved') {
      throw new ConflictError(version.state === 'draft' ? `Waterfall v${version.version} has not been approved yet.` : `Waterfall v${version.version} is already published.`);
    }
    projectsService.bumpRevision(project.id, expectedRevision);
    const updated = fundingRepository.updateWaterfall(id, { state: 'published', publishedAt: now() });
    if (!updated) throw new NotFoundError('Waterfall version', id);
    audit(actor, `Waterfall v${version.version} published · ${project.code}`, `approved by ${actorName(version.approvedBy ?? actor)} · supersedes earlier versions`);
    return updated;
  },

  /**
   * Run the published agreement over a cash figure without writing anything
   * (WFL03, WFL04). Every preview names the version, the available cash, each
   * tier's allocation, the residual and the participants' metrics.
   */
  distributionPreview(request: DistributionRequest): DistributionPreview {
    const version = fundingService.currentWaterfall(request.projectId);
    if (!version) {
      throw new PolicyRequiredError('waterfall-published', 'No published distribution agreement exists for this project, so a preview is not available. Draft, approve and publish one first.');
    }
    requireIsoDate(request.asOf, 'asOf', 'As-of date');
    const capitalTier = participantIdsOf(version.tiers.find((tier) => tier.kind === 'return-of-capital'));
    const preferredTier = participantIdsOf(version.tiers.find((tier) => tier.kind === 'preferred-return'));
    const residualTier = participantIdsOf(version.tiers.find((tier) => tier.kind === 'residual-split'));

    const participants = fundingRepository.listParticipants(request.projectId);
    const engineParticipants: WaterfallParticipant[] = participants.map((participant) => {
      const account = fundingService.capitalAccount(participant.id, request.asOf);
      return {
        id: participant.id,
        outstandingCapitalCents: inTier(capitalTier, participant.id) ? Math.max(account.outstanding.cents, 0) : 0,
        accruedPreferredCents: inTier(preferredTier, participant.id) ? Math.max(account.preferredOutstanding.cents, 0) : 0,
        residualShareWeight: inTier(residualTier, participant.id) ? participant.residualShareWeight : 0,
      };
    });
    const input: WaterfallInput = {
      availableCashCents: request.availableCash.cents,
      requiredDebtCents: request.requiredDebt.cents,
      reserveCents: version.reserve.cents,
      participants: engineParticipants,
    };
    const result = runWaterfall(input);
    const participantMetrics = participants.map((participant): ParticipantMetric => {
      const totalCents = result.allocations.find((allocation) => allocation.participantId === participant.id)?.totalCents ?? 0;
      return {
        participantId: participant.id,
        name: participant.name,
        totalCents,
        irr: fundingService.participantIrr(participant.id, request.asOf, totalCents > 0 ? [{ date: request.asOf, cents: totalCents }] : []),
      };
    });
    return { version, input, result, participantMetrics };
  },

  /**
   * Turn a preview into actual movements, one per component per participant,
   * each naming the agreement version (EQ02, WFL04). This records a decision a
   * person made; it moves no money and cannot be triggered by automation.
   */
  recordDistribution(request: DistributionRequest & { readonly actor: UserId; readonly expectedRevision?: number }): readonly EquityMovement[] {
    const project = projectsService.assertMutable(request.projectId);
    const preview = fundingService.distributionPreview(request);
    if (projectsService.isPeriodLocked(project.id, request.asOf)) {
      throw new ConflictError(`${request.asOf} falls in a closed period (actuals to ${actualsCutoffOf(project.id)}). Date the distribution today or later.`);
    }
    if (preview.result.totalDistributedCents <= 0) {
      throw new ValidationError('Nothing is distributable: the required debt and reserve absorb the available cash.', {
        fieldErrors: { availableCash: ['Increase available cash or reduce required debt.'] },
      });
    }
    projectsService.bumpRevision(project.id, request.expectedRevision);
    const at = now();
    const note = `Waterfall v${preview.version.version} · available ${formatMoney(request.availableCash, { showCents: true })} · required debt ${formatMoney(request.requiredDebt, { showCents: true })}`;
    const created: EquityMovement[] = [];
    for (const allocation of preview.result.allocations) {
      const components: readonly [EquityMovementType, number][] = [
        ['capital-return', allocation.capitalReturnCents],
        ['preferred-return', allocation.preferredReturnCents],
        ['profit-distribution', allocation.residualProfitCents],
      ];
      for (const [type, cents] of components) {
        if (cents <= 0) continue;
        created.push(
          fundingRepository.insertEquityMovement({
            id: asId<'EquityMovement'>(`eqm-${randomUUID()}`),
            projectId: project.id,
            participantId: asId<'EquityParticipant'>(allocation.participantId),
            on: request.asOf,
            type,
            amount: money(cents),
            basis: 'actual',
            note,
            waterfallVersionId: preview.version.id,
            createdAt: at,
            createdBy: request.actor,
          }),
        );
      }
    }
    audit(
      request.actor,
      `Distribution recorded · ${project.code} · ${formatMoney(money(preview.result.totalDistributedCents), { showCents: true })}`,
      `waterfall ${preview.version.id} (v${preview.version.version}) · ${request.asOf} · ${created.length} movements · residual cash ${formatMoney(money(preview.result.residualCashCents), { showCents: true })}`,
    );
    return created;
  },

  /**
   * Copy the funding structure of one project into another (PRJ05): facilities
   * and participants with `structure`, the current agreement as a *draft* with
   * `assumptions`. Movements, approvals and publications are never copied.
   */
  cloneInto(sourceProjectId: ProjectId, targetProjectId: ProjectId, options: CloneOptions, actor: UserId): CloneResult {
    const source = projectsService.require(sourceProjectId);
    const target = projectsService.assertMutable(targetProjectId);
    const at = now();
    const facilities: DebtFacility[] = [];
    const participants: EquityParticipant[] = [];
    const participantMap = new Map<EquityParticipantId, EquityParticipantId>();

    if (options.structure) {
      for (const facility of fundingRepository.listFacilities(source.id)) {
        facilities.push(
          fundingRepository.insertFacility({ ...facility, id: asId<'DebtFacility'>(`fac-${randomUUID()}`), projectId: target.id, state: 'active', createdAt: at, createdBy: actor }),
        );
      }
      for (const participant of fundingRepository.listParticipants(source.id)) {
        const copy = fundingRepository.insertParticipant({ ...participant, id: asId<'EquityParticipant'>(`eqp-${randomUUID()}`), projectId: target.id, createdAt: at });
        participants.push(copy);
        participantMap.set(participant.id, copy.id);
      }
    }

    let waterfall: WaterfallVersion | null = null;
    if (options.assumptions) {
      const versions = fundingRepository.listWaterfalls(source.id);
      const template = fundingService.currentWaterfall(source.id) ?? versions[versions.length - 1] ?? null;
      if (template) {
        const existing = fundingRepository.listWaterfalls(target.id);
        waterfall = fundingRepository.insertWaterfall({
          id: asId<'WaterfallVersion'>(`wfv-${randomUUID()}`),
          projectId: target.id,
          version: (existing[existing.length - 1]?.version ?? 0) + 1,
          state: 'draft',
          tiers: template.tiers.map((tier) => {
            const mapped = tier.participantIds?.map((id) => participantMap.get(id)).filter((id): id is EquityParticipantId => id !== undefined);
            return { order: tier.order, kind: tier.kind, basis: tier.basis, roundingRule: tier.roundingRule, ...(mapped && mapped.length > 0 ? { participantIds: mapped } : {}) };
          }),
          reserve: template.reserve,
          draftedBy: actor,
          effectiveFrom: target.startDate,
          reason: `Cloned from ${source.code} v${template.version} · needs approval`,
          createdAt: at,
        });
      }
    }

    if (facilities.length > 0 || participants.length > 0 || waterfall) projectsService.bumpRevision(target.id);
    audit(
      actor,
      `Funding cloned · ${source.code} → ${target.code}`,
      `${facilities.length} facilities · ${participants.length} participants · ${waterfall ? `waterfall draft v${waterfall.version}` : 'no waterfall'} · movements not copied`,
    );
    return { facilities, participants, waterfall };
  },
};
