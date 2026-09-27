/**
 * Transport-agnostic handlers for the funding module.
 *
 * Every handler opens with the platform capability guard and then the
 * per-project guard (NFR-01, IAM02). Reads need `financials.read`; an
 * investor holds only `participation.read` and can reach nothing here except
 * `participation`, which returns their own capital account alone (EQ03).
 * Writes need `finance.edit`; approving and publishing an agreement need
 * `baseline.publish`.
 */
import { formatPpmAsPercent, percentToPpm, XIRR_UNAVAILABLE_LABELS, type FacilityBreach, type XirrResult } from '@/shared/finance-engine';
import { resolveAsOfDate } from '@/shared/config/app-config';
import { ForbiddenError, ValidationError } from '@/shared/lib/errors';
import { formatPercent, money, type Money } from '@/shared/lib/money';
import { asId, type IsoDate, type ProjectId, type WaterfallVersionId } from '@/shared/types/common';
import { accessService } from '@/modules/access/service';
import { projectsService } from '@/modules/projects/service';
import type { CapitalAccount, DebtFacility, EquityMovement, EquityParticipant, FacilityMovement, WaterfallVersion } from './model';
import { fundingService, projectHorizon, type DistributionPreview, type PeakResult } from './service';
import {
  decimalToMoney,
  type CreateFacilityBody,
  type CreateParticipantBody,
  type DistributionRequestBody,
  type EquityMovementBody,
  type FacilityMovementBody,
} from './validation';

/* ---------- View shapes (serialisable: no Maps, no bigints) ---------- */

export interface FacilityMonthRow {
  readonly month: string;
  readonly opening: Money;
  readonly draws: Money;
  readonly repayments: Money;
  readonly capitalised: Money;
  readonly cashInterest: Money;
  readonly fees: Money;
  readonly closing: Money;
  readonly unused: Money;
  readonly breaches: readonly FacilityBreach[];
  readonly reconciles: boolean;
}

export interface FacilityView {
  readonly facility: DebtFacility;
  readonly borrowerName: string;
  readonly currentRateLabel: string;
  /** Actual draws less actual repayments to the as-of date. Planned movements never enter this figure. */
  readonly drawnActual: Money;
  readonly months: readonly FacilityMonthRow[];
  readonly peak: PeakResult;
  readonly breaches: readonly FacilityBreach[];
  readonly reconciles: boolean;
  readonly movements: readonly FacilityMovement[];
}

export interface DebtView {
  readonly facilities: readonly FacilityView[];
  readonly totalLimit: Money;
  readonly drawnActual: Money;
  readonly unusedCapacity: Money;
  readonly peakDebt: PeakResult;
  readonly breachCount: number;
  /** Green only when no facility breaches its limit or maturity anywhere in the horizon (FIN03). */
  readonly fundingStatus: { readonly tone: 'good' | 'bad'; readonly label: string };
}

export interface ParticipantView {
  readonly participant: Omit<EquityParticipant, 'investorReference'> & { readonly investorReference: string | null };
  readonly account: CapitalAccount;
  readonly remainingCommitment: Money;
  readonly irr: XirrResult;
  readonly irrLabel: string;
  readonly preferredRateLabel: string;
  readonly movements: readonly EquityMovement[];
}

export interface EquityView {
  readonly participants: readonly ParticipantView[];
  readonly totalCommitment: Money;
  readonly totalContributed: Money;
  readonly totalOutstanding: Money;
  readonly peakEquity: PeakResult;
}

export interface WaterfallVersionView {
  readonly version: WaterfallVersion;
  readonly draftedByName: string;
  readonly approvedByName: string | null;
  readonly canApproveHere: boolean;
}

export interface WaterfallView {
  readonly current: WaterfallVersionView | null;
  readonly versions: readonly WaterfallVersionView[];
  readonly participantNames: Readonly<Record<string, string>>;
}

export interface FinanceScreenData {
  readonly project: {
    readonly id: string;
    readonly code: string;
    readonly name: string;
    readonly modelRevision: number;
    readonly startDate: IsoDate;
    readonly expectedCompletion: IsoDate;
    readonly fromMonth: string;
    readonly toMonth: string;
    readonly actualsCutoff: IsoDate;
    readonly legalEntityId: string;
  };
  readonly asOf: IsoDate;
  readonly debt: DebtView;
  readonly equity: EquityView;
  readonly waterfall: WaterfallView;
  readonly legalEntities: readonly { readonly id: string; readonly name: string }[];
  readonly permissions: { readonly canEdit: boolean; readonly canPublish: boolean; readonly userId: string };
}

export interface ParticipationView {
  readonly project: { readonly id: string; readonly code: string; readonly name: string };
  readonly asOf: IsoDate;
  readonly participant: EquityParticipant;
  readonly account: CapitalAccount;
  readonly remainingCommitment: Money;
  readonly irr: XirrResult;
  readonly irrLabel: string;
  readonly preferredRateLabel: string;
  readonly movements: readonly EquityMovement[];
}

export interface DistributionPreviewView extends DistributionPreview {
  readonly participantNames: Readonly<Record<string, string>>;
  readonly availableCash: Money;
  readonly requiredDebt: Money;
  readonly asOf: IsoDate;
}

/* ---------- Helpers ---------- */

export function irrLabel(irr: XirrResult): string {
  return irr.available ? formatPercent(irr.rate, 2) : XIRR_UNAVAILABLE_LABELS[irr.reason];
}

/** "8.25" → 82_500 ppm, with a field error rather than a RangeError when the text is not a percentage. */
export function parsePercentField(raw: string, field: string): number {
  try {
    return percentToPpm(raw);
  } catch {
    throw new ValidationError('Enter the annual rate as a percentage, e.g. 8.25 for 8.25%.', {
      fieldErrors: { [field]: [`"${raw}" is not a percentage. Enter 8.25 for 8.25%.`] },
    });
  }
}

function currentRate(facility: DebtFacility, on: IsoDate): number {
  let rate = 0;
  for (const step of facility.rateSteps) if (step.from <= on) rate = step.ratePpm;
  return rate || facility.rateSteps[0]?.ratePpm || 0;
}

function participantView(participant: EquityParticipant, asOf: IsoDate, revealReference: boolean): ParticipantView {
  const account = fundingService.capitalAccount(participant.id, asOf);
  const irr = fundingService.participantIrr(participant.id, asOf);
  return {
    participant: { ...participant, investorReference: revealReference ? participant.investorReference : null },
    account,
    remainingCommitment: money(Math.max(participant.commitment.cents - account.contributed.cents, 0)),
    irr,
    irrLabel: irrLabel(irr),
    preferredRateLabel: formatPpmAsPercent(participant.preferredRatePpm),
    movements: fundingService.movementsForParticipant(participant.id),
  };
}

function versionView(version: WaterfallVersion, actorId: string, canPublish: boolean): WaterfallVersionView {
  return {
    version,
    draftedByName: accessService.resolveUserName(version.draftedBy) ?? 'Unknown',
    approvedByName: accessService.resolveUserName(version.approvedBy) ?? null,
    canApproveHere: canPublish && version.state === 'draft' && version.draftedBy !== actorId,
  };
}

/* ---------- Handlers ---------- */

export const fundingApi = {
  /** Everything the Finance screen shows. Investors are refused here and use `participation`. */
  screen(rawProjectId: string, asOf: IsoDate = resolveAsOfDate()): FinanceScreenData {
    accessService.guard('development.read');
    const projectId = asId<'Project'>(rawProjectId);
    const scope = projectsService.guard(projectId, 'financials.read');
    const project = projectsService.require(projectId);
    const policy = projectsService.policyFor(projectId);
    const { fromMonth, toMonth } = projectHorizon(project);
    const canEdit = scope.permissions.includes('finance.edit');
    const canPublish = scope.permissions.includes('baseline.publish');

    const facilities = fundingService.listFacilities(projectId).map((facility): FacilityView => {
      const ledger = fundingService.facilityLedger(facility.id, fromMonth, toMonth);
      const movements = fundingService.listMovements(facility.id);
      const drawnActual = movements
        .filter((movement) => movement.basis === 'actual' && movement.on <= asOf)
        .reduce((sum, movement) => {
          switch (movement.kind) {
            case 'draw':
              return sum + movement.amount.cents;
            case 'repayment':
              return sum - movement.amount.cents;
            case 'correction':
              return sum + movement.amount.cents;
            case 'fee':
              return sum;
          }
        }, 0);
      return {
        facility,
        borrowerName: projectsService.requireLegalEntity(facility.borrowerLegalEntityId).legalName,
        currentRateLabel: formatPpmAsPercent(currentRate(facility, asOf)),
        drawnActual: money(drawnActual),
        months: ledger.months.map((month) => ({
          month: month.month,
          opening: money(month.openingPrincipalCents),
          draws: money(month.drawsCents),
          repayments: money(month.repaymentsCents),
          capitalised: money(month.capitalisedInterestCents),
          cashInterest: money(month.cashInterestCents),
          fees: money(month.feesCents),
          closing: money(month.closingPrincipalCents),
          unused: money(month.unusedCapacityCents),
          breaches: month.breaches,
          reconciles:
            month.closingPrincipalCents === month.openingPrincipalCents + month.drawsCents - month.repaymentsCents + month.capitalisedInterestCents,
        })),
        peak: { cents: ledger.peakPrincipalCents, on: ledger.peakOn },
        breaches: ledger.breaches,
        reconciles: ledger.months.every((month) => month.closingPrincipalCents === month.openingPrincipalCents + month.drawsCents - month.repaymentsCents + month.capitalisedInterestCents),
        movements,
      };
    });
    const totalLimit = facilities.reduce((sum, view) => sum + view.facility.limit.cents, 0);
    const drawnActual = facilities.reduce((sum, view) => sum + view.drawnActual.cents, 0);
    const breachCount = facilities.reduce((sum, view) => sum + view.breaches.length, 0);

    const participants = fundingService.listParticipants(projectId).map((participant) => participantView(participant, asOf, canEdit));
    const versions = fundingService.listWaterfallVersions(projectId).map((version) => versionView(version, scope.userId, canPublish));
    const current = fundingService.currentWaterfall(projectId);

    return {
      project: {
        id: project.id,
        code: project.code,
        name: project.name,
        modelRevision: project.modelRevision,
        startDate: project.startDate,
        expectedCompletion: project.expectedCompletion,
        fromMonth,
        toMonth,
        actualsCutoff: policy.actualsCutoff,
        legalEntityId: project.legalEntityId,
      },
      asOf,
      debt: {
        facilities,
        totalLimit: money(totalLimit),
        drawnActual: money(drawnActual),
        unusedCapacity: money(Math.max(totalLimit - drawnActual, 0)),
        peakDebt: fundingService.peakDebt(projectId, fromMonth, toMonth),
        breachCount,
        fundingStatus:
          breachCount === 0
            ? { tone: 'good', label: 'Funded within limits' }
            : { tone: 'bad', label: `${breachCount} breach${breachCount === 1 ? '' : 'es'} in the horizon` },
      },
      equity: {
        participants,
        totalCommitment: money(participants.reduce((sum, view) => sum + view.participant.commitment.cents, 0)),
        totalContributed: money(participants.reduce((sum, view) => sum + view.account.contributed.cents, 0)),
        totalOutstanding: money(participants.reduce((sum, view) => sum + view.account.outstanding.cents, 0)),
        peakEquity: fundingService.peakEquity(projectId, asOf),
      },
      waterfall: {
        current: current ? versionView(current, scope.userId, canPublish) : null,
        versions,
        participantNames: Object.fromEntries(participants.map((view) => [view.participant.id, view.participant.name])),
      },
      legalEntities: projectsService.listLegalEntities().map((entity) => ({ id: entity.id, name: entity.legalName })),
      permissions: { canEdit, canPublish, userId: scope.userId },
    };
  },

  /** An investor's own participation and nothing else (EQ03). */
  participation(rawProjectId: string, asOf: IsoDate = resolveAsOfDate()): ParticipationView {
    accessService.guard('development.read');
    const projectId = asId<'Project'>(rawProjectId);
    const scope = projectsService.guard(projectId, 'participation.read');
    if (!scope.participantId) {
      throw new ForbiddenError('This membership is not linked to an equity participant. Ask the project manager to link it.');
    }
    const participant = fundingService.requireParticipant(scope.participantId);
    if (participant.projectId !== projectId) throw new ForbiddenError('The linked participant belongs to another project.');
    const project = projectsService.require(projectId);
    const view = participantView(participant, asOf, true);
    return {
      project: { id: project.id, code: project.code, name: project.name },
      asOf,
      participant,
      account: view.account,
      remainingCommitment: view.remainingCommitment,
      irr: view.irr,
      irrLabel: view.irrLabel,
      preferredRateLabel: view.preferredRateLabel,
      movements: view.movements,
    };
  },

  createFacility(rawProjectId: string, body: CreateFacilityBody, expectedRevision?: number): DebtFacility {
    accessService.guard('development.read');
    const projectId: ProjectId = asId<'Project'>(rawProjectId);
    projectsService.guard(projectId, 'finance.edit');
    return fundingService.createFacility({
      projectId,
      name: body.name,
      lender: body.lender,
      borrowerLegalEntityId: asId<'LegalEntity'>(body.borrowerLegalEntityId),
      type: body.type,
      limit: decimalToMoney(body.limit),
      ...(body.openingPrincipal !== undefined ? { openingPrincipal: decimalToMoney(body.openingPrincipal) } : {}),
      ...(body.openingOn ? { openingOn: body.openingOn } : {}),
      availableFrom: body.availableFrom,
      availableTo: body.availableTo,
      maturityOn: body.maturityOn,
      drawRank: body.drawRank,
      repaymentRank: body.repaymentRank,
      ratePpm: parsePercentField(body.annualRatePercent, 'annualRatePercent'),
      ...(body.rateFrom ? { rateFrom: body.rateFrom } : {}),
      dayCount: body.dayCount,
      interestTreatment: body.interestTreatment,
      fees: body.fees.map((fee) => ({ kind: fee.kind, amount: decimalToMoney(fee.amount), ...(fee.on ? { on: fee.on } : {}) })),
      actor: accessService.getCurrentUser().id,
      expectedRevision,
    });
  },

  recordFacilityMovement(rawProjectId: string, body: FacilityMovementBody, expectedRevision?: number): FacilityMovement {
    accessService.guard('development.read');
    const projectId: ProjectId = asId<'Project'>(rawProjectId);
    projectsService.guard(projectId, 'finance.edit');
    const facility = fundingService.requireFacility(asId<'DebtFacility'>(body.facilityId));
    if (facility.projectId !== projectId) throw new ForbiddenError('That facility belongs to another project.');
    return fundingService.recordMovement({
      facilityId: facility.id,
      on: body.on,
      kind: body.kind,
      amount: decimalToMoney(body.amount),
      basis: body.basis,
      source: 'manual',
      reference: body.reference,
      note: body.note,
      ...(body.correctsMovementId ? { correctsMovementId: asId<'FacilityMovement'>(body.correctsMovementId) } : {}),
      actor: accessService.getCurrentUser().id,
      expectedRevision,
    });
  },

  createParticipant(rawProjectId: string, body: CreateParticipantBody, expectedRevision?: number): EquityParticipant {
    accessService.guard('development.read');
    const projectId: ProjectId = asId<'Project'>(rawProjectId);
    projectsService.guard(projectId, 'finance.edit');
    return fundingService.createParticipant({
      projectId,
      name: body.name,
      investorReference: body.investorReference,
      class: body.class,
      commitment: decimalToMoney(body.commitment),
      participationWeight: body.participationWeight,
      preferredRatePpm: parsePercentField(body.preferredRatePercent, 'preferredRatePercent'),
      residualShareWeight: body.residualShareWeight,
      actor: accessService.getCurrentUser().id,
      expectedRevision,
    });
  },

  recordEquityMovement(rawProjectId: string, body: EquityMovementBody, expectedRevision?: number): EquityMovement {
    accessService.guard('development.read');
    const projectId: ProjectId = asId<'Project'>(rawProjectId);
    projectsService.guard(projectId, 'finance.edit');
    return fundingService.recordEquityMovement({
      projectId,
      participantId: asId<'EquityParticipant'>(body.participantId),
      on: body.on,
      type: body.type,
      amount: decimalToMoney(body.amount),
      basis: body.basis,
      note: body.note,
      actor: accessService.getCurrentUser().id,
      expectedRevision,
    });
  },

  /** A read: runs the published agreement and writes nothing (WFL04). */
  preview(rawProjectId: string, body: DistributionRequestBody): DistributionPreviewView {
    accessService.guard('development.read');
    const projectId: ProjectId = asId<'Project'>(rawProjectId);
    projectsService.guard(projectId, 'financials.read');
    const availableCash = decimalToMoney(body.availableCash);
    const requiredDebt = decimalToMoney(body.requiredDebt);
    const asOf = body.asOf ?? resolveAsOfDate();
    const preview = fundingService.distributionPreview({ projectId, availableCash, asOf, requiredDebt });
    return {
      ...preview,
      participantNames: Object.fromEntries(fundingService.listParticipants(projectId).map((participant) => [participant.id, participant.name])),
      availableCash,
      requiredDebt,
      asOf,
    };
  },

  recordDistribution(rawProjectId: string, body: DistributionRequestBody, expectedRevision?: number): readonly EquityMovement[] {
    accessService.guard('development.read');
    const projectId: ProjectId = asId<'Project'>(rawProjectId);
    projectsService.guard(projectId, 'finance.edit');
    return fundingService.recordDistribution({
      projectId,
      availableCash: decimalToMoney(body.availableCash),
      requiredDebt: decimalToMoney(body.requiredDebt),
      asOf: body.asOf ?? resolveAsOfDate(),
      actor: accessService.getCurrentUser().id,
      expectedRevision,
    });
  },

  approveWaterfall(rawProjectId: string, rawVersionId: string, reason: string): WaterfallVersion {
    accessService.guard('development.read');
    const projectId: ProjectId = asId<'Project'>(rawProjectId);
    projectsService.guard(projectId, 'baseline.publish');
    const versionId: WaterfallVersionId = asId<'WaterfallVersion'>(rawVersionId);
    return fundingService.approveWaterfall(versionId, accessService.getCurrentUser().id, reason);
  },

  publishWaterfall(rawProjectId: string, rawVersionId: string, expectedRevision?: number): WaterfallVersion {
    accessService.guard('development.read');
    const projectId: ProjectId = asId<'Project'>(rawProjectId);
    projectsService.guard(projectId, 'baseline.publish');
    return fundingService.publishWaterfall(asId<'WaterfallVersion'>(rawVersionId), accessService.getCurrentUser().id, expectedRevision);
  },
};
