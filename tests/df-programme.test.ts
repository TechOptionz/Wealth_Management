/**
 * Development Finance — programme (PRG01–PRG04).
 *
 * Acceptance: dependencies refuse loops; a move cascades finish-to-start with
 * lag as ONE model revision; actuals and locked periods block rather than
 * move; a preview writes nothing; linked dates resolve actual over plan.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { accessService } from '@/modules/access/service';
import { USER_IDS } from '@/modules/access/data/seed';
import { projectsService } from '@/modules/projects/service';
import { projectsRepository } from '@/modules/projects/repository';
import { PROJECT_IDS } from '@/modules/projects/data/seed';
import { programmeService } from '@/modules/programme/service';
import { programmeApi } from '@/modules/programme/api';
import { programmeRepository } from '@/modules/programme/repository';
import { MILESTONE_IDS } from '@/modules/programme/data/seed';
import { applyMoveAction, addDependencyAction } from '@/modules/programme/actions';
import { ConflictError, ForbiddenError, ValidationError } from '@/shared/lib/errors';
import { IDLE_RESULT, type ActionResult } from '@/shared/lib/action-result';

const RIVERSIDE = PROJECT_IDS.riverside;
const idle = IDLE_RESULT as ActionResult<unknown>;
const JAWAD = USER_IDS.jawad;

function formOf(fields: Record<string, string>): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  return form;
}

const revision = (): number => projectsService.require(RIVERSIDE).modelRevision;
const planned = (id: (typeof MILESTONE_IDS)[keyof typeof MILESTONE_IDS]): string => programmeService.requireMilestone(id).plannedDate;

beforeEach(() => {
  projectsRepository.reset();
  programmeRepository.reset();
});
afterEach(() => accessService.switchUser(JAWAD));

describe('PRG01 · seeded programme', () => {
  it('seeds the seven stages with milestones under them and stable ids', () => {
    const rows = programmeService.listMilestones(RIVERSIDE);
    expect(rows.filter((row) => row.kind === 'stage').map((row) => row.name)).toEqual([
      'Acquisition',
      'Design',
      'Approvals',
      'Presales',
      'Construction',
      'Completion',
      'Settlement',
    ]);
    expect(programmeService.requireMilestone(MILESTONE_IDS.finalSettlement).plannedDate).toBe('2028-06-30');
    expect(programmeService.requireMilestone(MILESTONE_IDS.siteStart).parentId).toBe(MILESTONE_IDS.construction);
    expect(programmeService.listDependencies(RIVERSIDE)).toHaveLength(9);
  });
});

describe('PRG02 · dependencies', () => {
  it('refuses a loop A → B → A and a self-dependency', () => {
    // Seeded: Site start → Slab complete.
    expect(() =>
      programmeService.addDependency({ projectId: RIVERSIDE, predecessorId: MILESTONE_IDS.slabComplete, successorId: MILESTONE_IDS.siteStart, lagDays: 0, actor: JAWAD }),
    ).toThrow(ValidationError);
    // A longer loop: Final settlement → Site start closes Site start → … → Final settlement.
    expect(() =>
      programmeService.addDependency({ projectId: RIVERSIDE, predecessorId: MILESTONE_IDS.finalSettlement, successorId: MILESTONE_IDS.siteStart, lagDays: 0, actor: JAWAD }),
    ).toThrow(/loop/);
    expect(() =>
      programmeService.addDependency({ projectId: RIVERSIDE, predecessorId: MILESTONE_IDS.lockUp, successorId: MILESTONE_IDS.lockUp, lagDays: 0, actor: JAWAD }),
    ).toThrow(/itself/);
    expect(programmeService.listDependencies(RIVERSIDE)).toHaveLength(9);
  });

  it('adds a valid link through the Server Action and reports a loop as a field error', async () => {
    const ok = await addDependencyAction(idle, formOf({ projectId: RIVERSIDE, predecessorId: MILESTONE_IDS.presaleTargetMet, successorId: MILESTONE_IDS.siteStart, lagDays: '0' }));
    expect(ok.ok).toBe(true);
    const loop = await addDependencyAction(idle, formOf({ projectId: RIVERSIDE, predecessorId: MILESTONE_IDS.siteStart, successorId: MILESTONE_IDS.presaleTargetMet, lagDays: '0' }));
    expect(loop.ok).toBe(false);
    if (!loop.ok) expect(loop.fieldErrors?.successorId).toBeDefined();
  });
});

describe('PRG03 · moving a date', () => {
  it('cascades finish-to-start with lag and saves the whole move as one revision', () => {
    const before = revision();
    const result = programmeService.applyMove({
      milestoneId: MILESTONE_IDS.practicalCompletion,
      newPlannedDate: '2028-04-20',
      actor: JAWAD,
      reason: 'Wet season delay',
      expectedRevision: before,
    });
    // Titles registered = PC + 14 → 4 May; First settlement = titles + 20 → 24 May; Final settlement (30 Jun) already later.
    expect(result.batchMoves.map((move) => [move.name, move.to])).toEqual([
      ['Practical completion', '2028-04-20'],
      ['Titles registered', '2028-05-04'],
      ['First settlement', '2028-05-24'],
    ]);
    expect(result.revision).toBe(before + 1);
    expect(revision()).toBe(before + 1);
    expect(planned(MILESTONE_IDS.finalSettlement)).toBe('2028-06-30');
    const history = programmeService.requireMilestone(MILESTONE_IDS.firstSettlement).history;
    expect(history[history.length - 1]).toMatchObject({ field: 'plannedDate', before: '2028-05-15', after: '2028-05-24', reason: 'Wet season delay' });
  });

  it('a stale revision is refused before anything is written', () => {
    const stale = revision() - 1;
    expect(() =>
      programmeService.applyMove({ milestoneId: MILESTONE_IDS.practicalCompletion, newPlannedDate: '2028-04-20', actor: JAWAD, reason: 'x', expectedRevision: stale }),
    ).toThrow(ConflictError);
    expect(planned(MILESTONE_IDS.practicalCompletion)).toBe('2028-03-31');
  });

  it('never moves a milestone with an actual date and reports it blocked', () => {
    programmeService.recordActual(MILESTONE_IDS.titlesRegistered, '2028-04-18', JAWAD);
    const preview = programmeService.previewMove(MILESTONE_IDS.practicalCompletion, '2028-04-20');
    expect(preview.blocked).toEqual([{ milestoneId: MILESTONE_IDS.titlesRegistered, name: 'Titles registered', reason: 'actual-recorded' }]);
    expect(preview.moves.map((move) => move.name)).toEqual(['Practical completion']);

    // The item itself carrying an actual cannot be moved at all.
    expect(programmeService.previewMove(MILESTONE_IDS.contractExchanged, '2026-07-20').blocked[0]?.reason).toBe('actual-recorded');
    expect(() =>
      programmeService.applyMove({ milestoneId: MILESTONE_IDS.contractExchanged, newPlannedDate: '2026-07-20', actor: JAWAD, reason: 'x' }),
    ).toThrow(ConflictError);
  });

  it('blocks a move into a locked period', () => {
    // Actuals cutoff for the seed is 31 Aug 2026.
    const preview = programmeService.previewMove(MILESTONE_IDS.landSettlement, '2026-08-20');
    expect(preview.blocked).toEqual([{ milestoneId: MILESTONE_IDS.landSettlement, name: 'Land settlement', reason: 'locked-period' }]);
    expect(preview.moves).toEqual([]);
  });

  it('previewMove writes nothing', () => {
    const before = revision();
    const preview = programmeService.previewMove(MILESTONE_IDS.daApproved, '2027-02-10');
    expect(preview.moves.map((move) => [move.name, move.to])).toEqual([
      ['DA approved', '2027-02-10'],
      ['Site start', '2027-02-20'],
    ]);
    expect(revision()).toBe(before);
    expect(planned(MILESTONE_IDS.daApproved)).toBe('2027-01-20');
    expect(planned(MILESTONE_IDS.siteStart)).toBe('2027-02-01');
  });

  it('the move action previews first and applies on the second submit with a reason', async () => {
    const before = revision();
    const first = await applyMoveAction(idle, formOf({ projectId: RIVERSIDE, milestoneId: MILESTONE_IDS.daApproved, newPlannedDate: '2027-02-10', preview: '1' }));
    expect(first.ok).toBe(true);
    expect(revision()).toBe(before);
    const noReason = await applyMoveAction(idle, formOf({ projectId: RIVERSIDE, milestoneId: MILESTONE_IDS.daApproved, newPlannedDate: '2027-02-10', preview: '0' }));
    expect(noReason.ok).toBe(false);
    const applied = await applyMoveAction(
      idle,
      formOf({ projectId: RIVERSIDE, milestoneId: MILESTONE_IDS.daApproved, newPlannedDate: '2027-02-10', preview: '0', reason: 'Council RFI', revision: String(before) }),
    );
    expect(applied.ok).toBe(true);
    expect(revision()).toBe(before + 1);
    expect(planned(MILESTONE_IDS.siteStart)).toBe('2027-02-20');
  });
});

describe('PRG04 · linked dates', () => {
  it('dateResolver returns the actual over the plan', () => {
    expect(programmeService.dateResolver(RIVERSIDE)(MILESTONE_IDS.siteStart)).toBe('2027-02-01');
    programmeService.recordActual(MILESTONE_IDS.siteStart, '2027-02-05', JAWAD);
    const resolve = programmeService.dateResolver(RIVERSIDE);
    expect(resolve(MILESTONE_IDS.siteStart)).toBe('2027-02-05');
    expect(resolve(MILESTONE_IDS.contractExchanged)).toBe('2026-07-10');
    expect(programmeService.dateOf(MILESTONE_IDS.siteStart)).toBe('2027-02-05');
    expect(programmeService.requireMilestone(MILESTONE_IDS.siteStart).plannedDate).toBe('2027-02-01');
    expect(programmeService.requireMilestone(MILESTONE_IDS.siteStart).completionPercent).toBe(100);
  });
});

describe('Permissions · programme', () => {
  it('the finance officer cannot move a date through the API', () => {
    accessService.switchUser(USER_IDS.accountant);
    expect(() => programmeApi.overview(RIVERSIDE)).not.toThrow();
    expect(programmeApi.overview(RIVERSIDE).permissions.canEdit).toBe(false);
    expect(() => programmeApi.applyMove(MILESTONE_IDS.daApproved, '2027-02-10', 'try')).toThrow(ForbiddenError);
  });

  it('an investor cannot read the programme', () => {
    accessService.switchUser(USER_IDS.hassan);
    expect(() => programmeApi.overview(RIVERSIDE)).toThrow(ForbiddenError);
  });

  it('the project manager can', () => {
    accessService.switchUser(USER_IDS.mahvish);
    expect(programmeApi.applyMove(MILESTONE_IDS.daApproved, '2027-02-10', 'Council RFI').batchMoves).toHaveLength(2);
  });
});
