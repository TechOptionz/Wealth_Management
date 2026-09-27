/**
 * Development Finance — debt facilities, equity and the waterfall
 * (FIN01–FIN06, EQ01–EQ03, WFL01–WFL04, CAL15–CAL20; F06, F10, F11, F12,
 * AT14, AT24). Golden figures are hand-derived, not generated from the code.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { accessService } from '@/modules/access/service';
import { USER_IDS } from '@/modules/access/data/seed';
import { projectsRepository } from '@/modules/projects/repository';
import { projectsService } from '@/modules/projects/service';
import { LEGAL_ENTITY_IDS, PROJECT_IDS, SEED_PARTICIPANT_IDS } from '@/modules/projects/data/seed';
import { fundingRepository } from '@/modules/funding/repository';
import { fundingService } from '@/modules/funding/service';
import { fundingApi } from '@/modules/funding/api';
import { createFacilityAction } from '@/modules/funding/actions';
import { FACILITY_IDS, FACILITY_MOVEMENT_IDS } from '@/modules/funding/data/seed';
import { WATERFALL_TEMPLATE, type DebtFacility, type WaterfallTier } from '@/modules/funding/model';
import { applyFundingOrder, ledgerReconciles, simpleInterest } from '@/shared/finance-engine';
import { fromMajorUnits, money } from '@/shared/lib/money';
import { ConflictError, ForbiddenError, PolicyRequiredError, ValidationError } from '@/shared/lib/errors';
import { IDLE_RESULT, type ActionResult } from '@/shared/lib/action-result';
import type { EquityParticipantId, ProjectId } from '@/shared/types/common';

const $ = (dollars: number): number => Math.round(dollars * 100);
const RIVERSIDE = PROJECT_IDS.riverside;
const AS_OF = '2026-09-06';
const idle = IDLE_RESULT as ActionResult<unknown>;

function formOf(fields: Record<string, string>): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  return form;
}

function templateTiers(participantIds?: readonly EquityParticipantId[]): WaterfallTier[] {
  return WATERFALL_TEMPLATE.map((tier, index) => ({
    order: index + 1,
    kind: tier.kind,
    basis: tier.basis,
    roundingRule: 'residual-to-last-by-id',
    ...(participantIds && index >= 2 ? { participantIds } : {}),
  }));
}

function freshProject(code: string, startDate = '2027-01-01'): ProjectId {
  return projectsService.createProject({
    code,
    name: `Funding test ${code}`,
    legalEntityId: LEGAL_ENTITY_IDS.esteem,
    type: 'apartments',
    address: '1 Test St',
    state: 'QLD',
    startDate,
    expectedCompletion: '2029-01-01',
    forecastHorizonMonths: 24,
    reportingBasis: 'accrual',
    actor: USER_IDS.jawad,
  }).id;
}

function publish(projectId: ProjectId, tiers: readonly WaterfallTier[], reserveCents = 0) {
  const draft = fundingService.draftWaterfall({ projectId, tiers, reserve: money(reserveCents), effectiveFrom: '2027-01-01', reason: 'Test agreement', actor: USER_IDS.mahvish });
  fundingService.approveWaterfall(draft.id, USER_IDS.jawad, 'Reviewed');
  return fundingService.publishWaterfall(draft.id, USER_IDS.jawad);
}

function testFacility(projectId: ProjectId, overrides: Partial<Parameters<typeof fundingService.createFacility>[0]> = {}): DebtFacility {
  return fundingService.createFacility({
    projectId,
    name: 'Test facility',
    lender: 'Test lender',
    borrowerLegalEntityId: LEGAL_ENTITY_IDS.esteem,
    type: 'senior',
    limit: fromMajorUnits(2_000_000),
    availableFrom: '2027-01-01',
    availableTo: '2027-12-31',
    maturityOn: '2027-12-31',
    drawRank: 1,
    repaymentRank: 1,
    ratePpm: 100_000,
    dayCount: 'ACT/365F',
    interestTreatment: 'capitalised',
    actor: USER_IDS.jawad,
    ...overrides,
  });
}

beforeEach(() => {
  projectsRepository.reset();
  fundingRepository.reset();
});
afterEach(() => accessService.switchUser(USER_IDS.jawad));

describe('FIN03 / FIN05 · facility ledger', () => {
  it('F06 through facilityLedger: 1 000 000 drawn 1 Jan 2027 at 10% → 8 493.15 capitalised, closing 1 008 493.15', () => {
    const facility = testFacility(RIVERSIDE);
    fundingService.recordMovement({ facilityId: facility.id, on: '2027-01-01', kind: 'draw', amount: fromMajorUnits(1_000_000), basis: 'planned', actor: USER_IDS.jawad });
    const ledger = fundingService.facilityLedger(facility.id, '2027-01', '2027-01');
    expect(ledger.months[0]?.capitalisedInterestCents).toBe($(8_493.15));
    expect(ledger.months[0]?.closingPrincipalCents).toBe($(1_008_493.15));
    expect(ledgerReconciles(ledger)).toBe(true);
  });

  it('every month of the seeded facility reconciles, with the planned draw, fee and hand-computed October interest', () => {
    const ledger = fundingService.facilityLedger(FACILITY_IDS.riversideConstruction, '2026-07', '2028-06');
    expect(ledger.months).toHaveLength(24);
    for (const month of ledger.months) {
      expect(month.closingPrincipalCents).toBe(month.openingPrincipalCents + month.drawsCents - month.repaymentsCents + month.capitalisedInterestCents);
    }
    const october = ledger.months.find((month) => month.month === '2026-10');
    expect(october?.drawsCents).toBe($(1_000_000));
    expect(october?.feesCents).toBe($(27_500));
    // 1 000 000 × 8.25% × 17 days (15–31 Oct) ÷ 365 = 3 842.47 (FIN05: interest on the draw day)
    expect(october?.capitalisedInterestCents).toBe(simpleInterest($(1_000_000), 82_500, 17));
    expect(october?.capitalisedInterestCents).toBe($(3_842.47));
  });

  it('refuses a draw outside the availability window', () => {
    expect(() =>
      fundingService.recordMovement({ facilityId: FACILITY_IDS.riversideConstruction, on: '2026-10-01', kind: 'draw', amount: fromMajorUnits(1), basis: 'planned', actor: USER_IDS.jawad }),
    ).toThrow(ValidationError);
    expect(() =>
      fundingService.recordMovement({ facilityId: FACILITY_IDS.riversideConstruction, on: '2028-05-01', kind: 'draw', amount: fromMajorUnits(1), basis: 'planned', actor: USER_IDS.jawad }),
    ).toThrow(ValidationError);
  });

  it('allows a limit-breaching draw but audits the warning and keeps the breach visible (FIN03)', () => {
    fundingService.recordMovement({ facilityId: FACILITY_IDS.riversideConstruction, on: '2026-10-20', kind: 'draw', amount: fromMajorUnits(4_200_000), basis: 'actual', actor: USER_IDS.jawad });
    expect(accessService.listAuditEvents(5).some((event) => event.context.includes('LIMIT BREACH') && event.outcome === 'ok')).toBe(true);
    const screen = fundingApi.screen(RIVERSIDE, '2026-10-31');
    expect(screen.debt.breachCount).toBeGreaterThan(0);
    expect(screen.debt.fundingStatus.tone).toBe('bad');
  });

  it('refuses an actual movement in a locked period; a correction dated today naming the original is accepted (CF06)', () => {
    expect(() =>
      fundingService.recordMovement({ facilityId: FACILITY_IDS.riversideConstruction, on: '2026-08-20', kind: 'fee', amount: fromMajorUnits(500), basis: 'actual', actor: USER_IDS.jawad }),
    ).toThrow(ConflictError);
    const today = new Date().toISOString().slice(0, 10);
    const correction = fundingService.recordMovement({
      facilityId: FACILITY_IDS.riversideConstruction,
      on: today,
      kind: 'correction',
      amount: money(-$(10)),
      basis: 'actual',
      note: 'Corrects land settlement draw reference',
      correctsMovementId: FACILITY_MOVEMENT_IDS.landSettlementDraw,
      actor: USER_IDS.jawad,
    });
    expect(correction.correctsMovementId).toBe(FACILITY_MOVEMENT_IDS.landSettlementDraw);
    expect(fundingService.listMovements(FACILITY_IDS.riversideConstruction)).toHaveLength(2);
  });

  it('stores the typed rate "8.25" as 82 500 ppm, never as 0.0825 (FIN01)', async () => {
    const result = await createFacilityAction(
      idle,
      formOf({
        projectId: RIVERSIDE,
        name: 'Mezzanine facility',
        lender: 'Private lender',
        type: 'mezzanine',
        limit: '$500,000.00',
        availableFrom: '2026-11-01',
        availableTo: '2027-12-31',
        maturityOn: '2028-06-30',
        drawRank: '2',
        repaymentRank: '2',
        annualRate: '8.25',
      }),
    );
    expect(result.ok).toBe(true);
    const created = result.ok ? (result.value as DebtFacility) : undefined;
    expect(created?.rateSteps).toEqual([{ from: '2026-11-01', ratePpm: 82_500 }]);
    expect(created?.limit.cents).toBe($(500_000));

    const bad = await createFacilityAction(idle, formOf({ projectId: RIVERSIDE, name: 'x', lender: 'y', limit: '1', availableFrom: '2026-11-01', availableTo: '2027-01-01', maturityOn: '2027-01-01', annualRate: 'eight' }));
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.fieldErrors?.annualRate).toBeDefined();
  });
});

describe('FIN04 · funding sources', () => {
  it('F11 through fundingSources + applyFundingOrder: need 150 000, equity 40 000, debt 100 000 → unfunded 10 000; nothing auto-increased', () => {
    const projectId = freshProject('F11-01');
    const participant = fundingService.createParticipant({ projectId, name: 'Investor', investorReference: 'INV', class: 'ordinary', commitment: fromMajorUnits(40_000), participationWeight: 1, preferredRatePpm: 0, residualShareWeight: 1, actor: USER_IDS.jawad });
    const facility = testFacility(projectId, { limit: fromMajorUnits(100_000) });
    const sources = fundingService.fundingSources(projectId, '2027-03-01');
    const result = applyFundingOrder({
      needCents: $(150_000),
      equitySources: sources.equity.map((source) => ({ id: source.id, rank: source.rank, availableCents: source.availableCents })),
      debtSources: sources.debt.map((source) => ({ id: source.id, rank: source.drawRank, availableCents: source.availableCents })),
    });
    expect(result.equityDraws).toEqual([{ id: participant.id, cents: $(40_000) }]);
    expect(result.debtDraws).toEqual([{ id: facility.id, cents: $(100_000) }]);
    expect(result.unfundedCents).toBe($(10_000));
    expect(fundingService.requireFacility(facility.id).limit.cents).toBe($(100_000));
    expect(fundingService.requireParticipant(participant.id).commitment.cents).toBe($(40_000));
  });

  it('keeps planned and actual apart: planned movements reduce availability but never reach the capital account (EQ02)', () => {
    const before = fundingService.fundingSources(RIVERSIDE, '2026-10-20');
    const esteem = before.equity.find((source) => source.id === SEED_PARTICIPANT_IDS.esteem);
    const hsfi = before.equity.find((source) => source.id === SEED_PARTICIPANT_IDS.hsfi);
    expect(esteem).toMatchObject({ rank: 1, availableCents: $(300_000) });
    expect(hsfi).toMatchObject({ rank: 2, availableCents: $(300_000) });
    // The planned land draw counts toward outstanding debt in the forecast.
    expect(before.debt[0]).toMatchObject({ outstandingCents: $(1_000_000), availableCents: $(4_000_000) });
    // Before availability opens, nothing is drawable.
    expect(fundingService.fundingSources(RIVERSIDE, '2026-10-01').debt[0]?.availableCents).toBe(0);

    fundingService.recordEquityMovement({ projectId: RIVERSIDE, participantId: SEED_PARTICIPANT_IDS.hsfi, on: '2026-10-01', type: 'contribution', amount: fromMajorUnits(100_000), basis: 'planned', actor: USER_IDS.jawad });
    const after = fundingService.fundingSources(RIVERSIDE, '2026-10-20', {
      equityDrawnCents: new Map([[SEED_PARTICIPANT_IDS.esteem, $(50_000)]]),
      debtOutstandingCents: new Map([[FACILITY_IDS.riversideConstruction, $(500_000)]]),
    });
    expect(after.equity.find((source) => source.id === SEED_PARTICIPANT_IDS.hsfi)?.availableCents).toBe($(200_000));
    expect(after.equity.find((source) => source.id === SEED_PARTICIPANT_IDS.esteem)?.availableCents).toBe($(250_000));
    expect(after.debt[0]?.availableCents).toBe($(3_500_000));
    expect(fundingService.capitalAccount(SEED_PARTICIPANT_IDS.hsfi, '2026-10-20').contributed.cents).toBe($(300_000));
    expect(fundingApi.screen(RIVERSIDE, AS_OF).debt.drawnActual.cents).toBe(0);
  });
});

describe('EQ01 / EQ02 · capital accounts, IRR and peaks', () => {
  it('accrues simple ACT/365F preferred return on outstanding capital: 300 000 at 8% over 58 days', () => {
    const account = fundingService.capitalAccount(SEED_PARTICIPANT_IDS.hsfi, AS_OF);
    expect(account.contributed.cents).toBe($(300_000));
    expect(account.outstanding.cents).toBe($(300_000));
    expect(account.preferredAccrued.cents).toBe(simpleInterest($(300_000), 80_000, 58));
    expect(account.preferredAccrued.cents).toBe($(3_813.70));
    expect(account.preferredOutstanding.cents).toBe(account.preferredAccrued.cents);
    // The sponsor carries no preferred rate.
    expect(fundingService.capitalAccount(SEED_PARTICIPANT_IDS.esteem, AS_OF).preferredAccrued.cents).toBe(0);
  });

  it('refuses a contribution beyond the remaining commitment', () => {
    expect(() =>
      fundingService.recordEquityMovement({ projectId: RIVERSIDE, participantId: SEED_PARTICIPANT_IDS.hsfi, on: '2026-09-10', type: 'contribution', amount: money($(300_000) + 1), basis: 'actual', actor: USER_IDS.jawad }),
    ).toThrow(ValidationError);
  });

  it('peak equity from the seed is 900 000 on 15 Aug 2026 (CAL20)', () => {
    expect(fundingService.peakEquity(RIVERSIDE, AS_OF)).toEqual({ cents: $(900_000), on: '2026-08-15' });
    expect(fundingService.peakEquity(RIVERSIDE, AS_OF, [{ date: '2026-12-01', cents: -$(200_000) }]).cents).toBe($(900_000));
  });

  it('peak debt is the maximum day-end principal including capitalised interest', () => {
    const peak = fundingService.peakDebt(RIVERSIDE, '2026-07', '2028-06');
    const ledger = fundingService.facilityLedger(FACILITY_IDS.riversideConstruction, '2026-07', '2028-06');
    expect(peak.cents).toBe(ledger.peakPrincipalCents);
    expect(peak.cents).toBeGreaterThan($(1_000_000));
  });

  it('participant IRR uses actual flows plus forecast; same-sign flows are Not Available', () => {
    const noSign = fundingService.participantIrr(SEED_PARTICIPANT_IDS.hsfi, AS_OF);
    expect(noSign).toEqual({ available: false, reason: 'no-sign-change' });
    const withForecast = fundingService.participantIrr(SEED_PARTICIPANT_IDS.hsfi, AS_OF, [{ date: '2028-06-30', cents: $(390_000) }]);
    expect(withForecast.available).toBe(true);
    if (withForecast.available) {
      expect(withForecast.rate).toBeGreaterThan(0.1);
      expect(withForecast.rate).toBeLessThan(0.2);
    }
  });
});

describe('EQ03 · investor sees only their own participation', () => {
  it('returns only HSFI to Hassan and refuses every other read and write', () => {
    accessService.switchUser(USER_IDS.hassan);
    const view = fundingApi.participation(RIVERSIDE, AS_OF);
    expect(view.participant.id).toBe(SEED_PARTICIPANT_IDS.hsfi);
    expect(view.account.contributed.cents).toBe($(300_000));
    expect(view.movements.every((movement) => movement.participantId === SEED_PARTICIPANT_IDS.hsfi)).toBe(true);
    expect(JSON.stringify(view)).not.toContain('ESTEEM');
    expect(() => fundingApi.screen(RIVERSIDE, AS_OF)).toThrow(ForbiddenError);
    expect(() => fundingApi.preview(RIVERSIDE, { availableCash: '100.00', requiredDebt: '0.00' })).toThrow(ForbiddenError);
    expect(() => fundingApi.recordEquityMovement(RIVERSIDE, { participantId: SEED_PARTICIPANT_IDS.hsfi, on: '2026-09-10', type: 'contribution', amount: '1.00', basis: 'actual' })).toThrow(ForbiddenError);
  });

  it('a finance editor has no participation view without a linked participant', () => {
    expect(() => fundingApi.participation(RIVERSIDE, AS_OF)).toThrow(ForbiddenError);
  });
});

describe('WFL01–WFL04 · agreement and distribution preview', () => {
  it('F10 through distributionPreview: capital 1 000 000, pref 100 000, residual 80/20 → 1 000 000; 100 000; 160 000 and 40 000', () => {
    const projectId = freshProject('F10-01');
    const a = fundingService.createParticipant({ projectId, name: 'A', investorReference: 'A', class: 'preferred', commitment: fromMajorUnits(1_000_000), participationWeight: 1, preferredRatePpm: 100_000, residualShareWeight: 80, actor: USER_IDS.jawad });
    const b = fundingService.createParticipant({ projectId, name: 'B', investorReference: 'B', class: 'ordinary', commitment: money(0), participationWeight: 1, preferredRatePpm: 0, residualShareWeight: 20, actor: USER_IDS.jawad });
    fundingService.recordEquityMovement({ projectId, participantId: a.id, on: '2027-01-01', type: 'contribution', amount: fromMajorUnits(1_000_000), basis: 'actual', actor: USER_IDS.jawad });
    const version = publish(projectId, templateTiers([a.id, b.id]));

    // 365 days at 10% simple on 1 000 000 is exactly 100 000.
    const preview = fundingService.distributionPreview({ projectId, availableCash: fromMajorUnits(1_300_000), asOf: '2028-01-01', requiredDebt: money(0) });
    expect(preview.version.id).toBe(version.id);
    const rowA = preview.result.allocations.find((row) => row.participantId === a.id);
    const rowB = preview.result.allocations.find((row) => row.participantId === b.id);
    expect(rowA?.capitalReturnCents).toBe($(1_000_000));
    expect(rowA?.preferredReturnCents).toBe($(100_000));
    expect(rowA?.residualProfitCents).toBe($(160_000));
    expect(rowB?.residualProfitCents).toBe($(40_000));
    expect(preview.result.totalDistributedCents).toBe($(1_300_000));
    expect(preview.result.residualCashCents).toBe(0);
    expect(preview.participantMetrics.find((metric) => metric.participantId === a.id)?.irr.available).toBe(true);

    // A preview never writes; recording does, with the version id on every movement.
    expect(fundingService.listEquityMovements(projectId)).toHaveLength(1);
    const recorded = fundingService.recordDistribution({ projectId, availableCash: fromMajorUnits(1_300_000), asOf: '2028-01-01', requiredDebt: money(0), actor: USER_IDS.jawad });
    expect(recorded.map((movement) => movement.type).sort()).toEqual(['capital-return', 'preferred-return', 'profit-distribution', 'profit-distribution']);
    expect(recorded.every((movement) => movement.waterfallVersionId === version.id)).toBe(true);
    expect(fundingService.capitalAccount(a.id, '2028-01-01').outstanding.cents).toBe(0);
  });

  it('AT24: the seeded preview pays debt and reserve first and never distributes more than the available cash', () => {
    const preview = fundingApi.preview(RIVERSIDE, { availableCash: '500000.00', requiredDebt: '200000.00', asOf: AS_OF });
    expect(preview.version.version).toBe(1);
    expect(preview.result.debtPaidCents).toBe($(200_000));
    expect(preview.result.reserveRetainedCents).toBe($(50_000));
    expect(preview.result.totalDistributedCents).toBe($(250_000));
    expect(preview.result.debtPaidCents + preview.result.reserveRetainedCents + preview.result.totalDistributedCents + preview.result.residualCashCents).toBe($(500_000));
    expect(preview.result.allocations.every((row) => row.totalCents >= 0)).toBe(true);

    const negative = fundingApi.preview(RIVERSIDE, { availableCash: '-100.00', requiredDebt: '0.00', asOf: AS_OF });
    expect(negative.result.totalDistributedCents).toBe(0);
  });

  it('F12 rounding with three participants: 100.00 split 33.33 / 33.33 / 33.34, residual to the last by id', () => {
    const projectId = freshProject('F12-01');
    const ids = ['C', 'A', 'B'].map(
      (name) => fundingService.createParticipant({ projectId, name, investorReference: name, class: 'ordinary', commitment: money(0), participationWeight: 1, preferredRatePpm: 0, residualShareWeight: 1, actor: USER_IDS.jawad }).id,
    );
    publish(projectId, templateTiers(ids));
    const preview = fundingService.distributionPreview({ projectId, availableCash: money($(100)), asOf: '2027-06-01', requiredDebt: money(0) });
    const bySortedId = [...preview.result.allocations].sort((x, y) => x.participantId.localeCompare(y.participantId));
    expect(bySortedId.map((row) => row.residualProfitCents)).toEqual([3333, 3333, 3334]);
    expect(preview.result.totalDistributedCents).toBe($(100));
  });

  it('no published agreement → PolicyRequiredError, and nothing is recorded', () => {
    const projectId = freshProject('NOW-01');
    expect(() => fundingService.distributionPreview({ projectId, availableCash: money($(100)), asOf: '2027-06-01', requiredDebt: money(0) })).toThrow(PolicyRequiredError);
    expect(() => fundingService.recordDistribution({ projectId, availableCash: money($(100)), asOf: '2027-06-01', requiredDebt: money(0), actor: USER_IDS.jawad })).toThrow(PolicyRequiredError);
    expect(fundingService.currentWaterfall(projectId)).toBeNull();
  });

  it('a tier order other than the template → PolicyRequiredError (WFL01)', () => {
    const tiers = templateTiers();
    const swapped = [tiers[0]!, tiers[1]!, tiers[3]!, tiers[2]!, tiers[4]!];
    expect(() => fundingService.draftWaterfall({ projectId: RIVERSIDE, tiers: swapped, reserve: money(0), effectiveFrom: AS_OF, reason: 'Pref first', actor: USER_IDS.jawad })).toThrow(PolicyRequiredError);
    expect(() => fundingService.draftWaterfall({ projectId: RIVERSIDE, tiers: tiers.slice(0, 4), reserve: money(0), effectiveFrom: AS_OF, reason: 'No residual', actor: USER_IDS.jawad })).toThrow(PolicyRequiredError);
  });

  it('the drafter cannot approve; approval needs publishing authority; publishing needs approval (WFL04)', () => {
    const draft = fundingService.draftWaterfall({ projectId: RIVERSIDE, tiers: templateTiers(), reserve: fromMajorUnits(75_000), effectiveFrom: '2026-10-01', reason: 'Reserve raised', actor: USER_IDS.jawad });
    expect(draft.version).toBe(2);
    expect(() => fundingService.approveWaterfall(draft.id, USER_IDS.jawad, 'Self review')).toThrow(ForbiddenError);
    expect(() => fundingService.publishWaterfall(draft.id, USER_IDS.jawad)).toThrow(ConflictError);

    accessService.switchUser(USER_IDS.accountant); // finance officer: finance.edit but no publish grant
    expect(() => fundingApi.approveWaterfall(RIVERSIDE, draft.id, 'Looks right')).toThrow(ForbiddenError);

    accessService.switchUser(USER_IDS.mahvish);
    fundingApi.approveWaterfall(RIVERSIDE, draft.id, 'Investor consent received');
    const published = fundingApi.publishWaterfall(RIVERSIDE, draft.id);
    expect(published.state).toBe('published');
    expect(fundingService.currentWaterfall(RIVERSIDE)?.version).toBe(2);
    // The earlier version is kept in history, untouched.
    expect(fundingService.listWaterfallVersions(RIVERSIDE)[0]?.reserve.cents).toBe($(50_000));
  });
});

describe('PRJ05 · cloning funding structure', () => {
  it('copies facilities and participants, never movements; a cloned agreement is a draft', () => {
    const target = freshProject('CLN-01');
    const result = fundingService.cloneInto(RIVERSIDE, target, { structure: true, assumptions: true }, USER_IDS.jawad);
    expect(result.facilities).toHaveLength(1);
    expect(result.participants).toHaveLength(2);
    expect(result.waterfall?.state).toBe('draft');
    expect(result.waterfall?.approvedBy).toBeUndefined();
    expect(fundingService.listProjectMovements(target)).toHaveLength(0);
    expect(fundingService.listEquityMovements(target)).toHaveLength(0);
  });
});
