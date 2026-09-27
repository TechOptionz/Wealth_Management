/**
 * Development Finance — projects, tenancy and the permission matrix
 * (IAM01–IAM04, PRJ01–PRJ05, CF06, CF07; AT01 isolation, AT07 authority).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { accessService } from '@/modules/access/service';
import { USER_IDS } from '@/modules/access/data/seed';
import { projectsService } from '@/modules/projects/service';
import { projectsApi } from '@/modules/projects/api';
import { projectsRepository } from '@/modules/projects/repository';
import { LEGAL_ENTITY_IDS, PROJECT_IDS } from '@/modules/projects/data/seed';
import { permissionsFor } from '@/modules/projects/permissions';
import { createProjectAction, publishPolicyAction, transitionProjectAction } from '@/modules/projects/actions';
import { fromMajorUnits, money } from '@/shared/lib/money';
import { asId } from '@/shared/types/common';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '@/shared/lib/errors';
import { IDLE_RESULT, type ActionResult } from '@/shared/lib/action-result';

const idle = IDLE_RESULT as ActionResult<unknown>;
const RIVERSIDE = PROJECT_IDS.riverside;

function formOf(fields: Record<string, string>): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  return form;
}

beforeEach(() => projectsRepository.reset());
afterEach(() => accessService.switchUser(USER_IDS.jawad));

describe('IAM01 / IAM02 · membership and non-disclosing guard (AT01)', () => {
  it('a person with no membership gets NotFound, the same as an unknown id', () => {
    accessService.switchUser(USER_IDS.operator);
    expect(() => projectsService.guard(RIVERSIDE, 'project.read')).toThrow(NotFoundError);
    expect(() => projectsService.guard(asId<'Project'>('proj-nope'), 'project.read')).toThrow(NotFoundError);
    expect(projectsService.listVisibleProjects(USER_IDS.operator)).toEqual([]);
  });

  it('a member without the permission is forbidden, not hidden', () => {
    accessService.switchUser(USER_IDS.hassan); // investor
    expect(() => projectsService.guard(RIVERSIDE, 'project.read')).not.toThrow();
    expect(() => projectsService.guard(RIVERSIDE, 'financials.read')).toThrow(ForbiddenError);
    expect(() => projectsApi.members(RIVERSIDE)).toThrow(ForbiddenError);
  });

  it('the organisation admin reads a project they were never added to, with no grants or authority', () => {
    const created = projectsService.createProject({
      code: 'ISO-01',
      name: 'Isolation test',
      legalEntityId: LEGAL_ENTITY_IDS.esteem,
      type: 'apartments',
      address: '1 Test St',
      state: 'QLD',
      startDate: '2027-01-01',
      expectedCompletion: '2028-01-01',
      forecastHorizonMonths: 12,
      reportingBasis: 'accrual',
      actor: USER_IDS.mahvish,
    });
    const admin = projectsService.scopeFor(USER_IDS.jawad, created.id);
    expect(admin?.isOrgAdmin).toBe(true);
    expect(admin?.permissions).toContain('financials.read');
    expect(admin?.permissions).not.toContain('invoice.approve');
    expect(admin?.approvalLimit).toBeNull();
    // A plain member of another project sees nothing here.
    expect(projectsService.scopeFor(USER_IDS.accountant, created.id)).toBeNull();
  });

  it('revoking a membership takes effect on the next guard (IAM03)', () => {
    const row = projectsRepository.findAccessFor(RIVERSIDE, USER_IDS.accountant);
    projectsService.setAccessStatus(row!.id, 'revoked', USER_IDS.jawad, 'Engagement ended');
    accessService.switchUser(USER_IDS.accountant);
    expect(() => projectsService.guard(RIVERSIDE, 'project.read')).toThrow(NotFoundError);
  });
});

describe('IAM04 / INV09 · authority is a limit, not a role (AT07)', () => {
  it('the finance officer with no limit cannot approve anything', () => {
    const scope = projectsService.scopeFor(USER_IDS.accountant, RIVERSIDE)!;
    expect(scope.permissions).toContain('invoice.capture');
    expect(scope.permissions).toContain('payment.record');
    expect(projectsService.canApprove(scope, fromMajorUnits(1))).toBe(false);
  });

  it('the project manager approves within her limit and not above it', () => {
    const scope = projectsService.scopeFor(USER_IDS.mahvish, RIVERSIDE)!;
    expect(projectsService.canApprove(scope, fromMajorUnits(100_000))).toBe(true);
    expect(projectsService.canApprove(scope, fromMajorUnits(100_000.01))).toBe(false);
  });

  it('an approver role needs a limit to exist at all', () => {
    expect(() =>
      projectsService.grantAccess({
        projectId: RIVERSIDE,
        userId: USER_IDS.operator,
        role: 'approver',
        grants: [],
        approvalLimit: null,
        actor: USER_IDS.jawad,
      }),
    ).toThrow(ValidationError);
  });

  it('follows the §4.2 matrix for grants', () => {
    expect(permissionsFor({ role: 'org-admin', grants: [], approvalLimit: null })).not.toContain('project.edit');
    expect(permissionsFor({ role: 'org-admin', grants: ['project.edit'], approvalLimit: null })).toContain('budget.edit');
    expect(permissionsFor({ role: 'project-manager', grants: [], approvalLimit: null })).not.toContain('payment.record');
    expect(permissionsFor({ role: 'project-manager', grants: ['payment.record'], approvalLimit: null })).toContain('payment.record');
    expect(permissionsFor({ role: 'finance-officer', grants: [], approvalLimit: null })).not.toContain('budget.edit');
    expect(permissionsFor({ role: 'finance-officer', grants: ['finance.fields'], approvalLimit: null })).toContain('budget.edit');
    expect(permissionsFor({ role: 'viewer', grants: [], approvalLimit: null })).not.toContain('report.export');
    expect(permissionsFor({ role: 'investor', grants: [], approvalLimit: null })).toEqual(['project.read', 'participation.read', 'assistant.use']);
  });
});

describe('PRJ01–PRJ03 · lifecycle and setup', () => {
  it('creates a draft from the wizard form and blocks activation until every step is done', async () => {
    const result = await createProjectAction(
      idle,
      formOf({
        code: 'rvt-02',
        name: 'Riverside stage 2',
        legalEntityId: LEGAL_ENTITY_IDS.esteem,
        type: 'townhouses',
        address: '2 Test St',
        state: 'QLD',
        startDate: '2027-03-01',
        expectedCompletion: '2029-03-01',
        forecastHorizonMonths: '24',
        openingCash: '$25,000.00',
      }),
    );
    expect(result.ok).toBe(true);
    const created = projectsRepository.listProjects().find((project) => project.code === 'RVT-02');
    expect(created?.lifecycle).toBe('draft');
    expect(created?.openingCash.cents).toBe(2_500_000);
    expect(created?.setupStepsCompleted).toEqual(['identity']);
    expect(projectsService.activationBlockers(created!).length).toBeGreaterThan(0);
    expect(() => projectsService.transition(created!.id, 'active', USER_IDS.jawad)).toThrow(ValidationError);

    for (const step of ['categories', 'milestones', 'units', 'opening-balances', 'funding', 'tax', 'review'] as const) {
      projectsService.completeSetupStep(created!.id, step, USER_IDS.jawad);
    }
    expect(projectsService.transition(created!.id, 'active', USER_IDS.jawad).lifecycle).toBe('active');
  });

  it('rejects a duplicate code and a completion before the start', () => {
    const base = {
      name: 'Dup',
      legalEntityId: LEGAL_ENTITY_IDS.esteem,
      type: 'apartments' as const,
      address: 'x',
      state: 'QLD' as const,
      startDate: '2027-01-01',
      expectedCompletion: '2028-01-01',
      forecastHorizonMonths: 12,
      reportingBasis: 'accrual' as const,
      actor: USER_IDS.jawad,
    };
    expect(() => projectsService.createProject({ ...base, code: 'RVT-01' })).toThrow(/already used/);
    expect(() => projectsService.createProject({ ...base, code: 'NEW-9', expectedCompletion: '2026-01-01' })).toThrow(ValidationError);
  });

  it('archive is reversible with a reason, and an archived project refuses financial writes', async () => {
    const archived = await transitionProjectAction(idle, formOf({ projectId: RIVERSIDE, to: 'archived', reason: 'Season closed' }));
    expect(archived.ok).toBe(true);
    expect(() => projectsService.assertMutable(RIVERSIDE)).toThrow(ConflictError);
    expect(() => projectsService.bumpRevision(RIVERSIDE)).not.toThrow(); // revision itself is not a financial write

    const withoutReason = await transitionProjectAction(idle, formOf({ projectId: RIVERSIDE, to: 'active' }));
    expect(withoutReason.ok).toBe(false);
    if (!withoutReason.ok) expect(withoutReason.fieldErrors?.reason).toBeDefined();

    const reopened = await transitionProjectAction(idle, formOf({ projectId: RIVERSIDE, to: 'active', reason: 'Reopened for final claims' }));
    expect(reopened.ok).toBe(true);
    expect(projectsService.require(RIVERSIDE).lifecycle).toBe('active');
  });
});

describe('CF07 · optimistic concurrency', () => {
  it('refuses a stale revision with both numbers, never a silent overwrite (AT18)', () => {
    const before = projectsService.require(RIVERSIDE).modelRevision;
    projectsService.updateProject(RIVERSIDE, { name: 'Riverside Townhomes · A' }, USER_IDS.jawad, before);
    let conflict: unknown;
    try {
      projectsService.updateProject(RIVERSIDE, { name: 'Riverside Townhomes · B' }, USER_IDS.mahvish, before);
    } catch (error) {
      conflict = error;
    }
    expect(conflict).toBeInstanceOf(ConflictError);
    expect((conflict as ConflictError).details).toEqual({ yourRevision: before, latestRevision: before + 1 });
    expect(projectsService.require(RIVERSIDE).name).toBe('Riverside Townhomes · A');
  });
});

describe('CF06 / CAL05 · policy versions and period locks', () => {
  it('appends a version, keeps history, and locks periods at the cutoff', async () => {
    const versionsBefore = projectsService.policyHistory(RIVERSIDE).length;
    expect(projectsService.isPeriodLocked(RIVERSIDE, '2026-08-31')).toBe(true);
    expect(projectsService.isPeriodLocked(RIVERSIDE, '2026-09-01')).toBe(false);

    const result = await publishPolicyAction(
      idle,
      formOf({ projectId: RIVERSIDE, actualsCutoff: '2026-09-30', reason: 'September closed', effectiveFrom: '2026-10-01', minimumReserve: '75000' }),
    );
    expect(result.ok).toBe(true);
    const history = projectsService.policyHistory(RIVERSIDE);
    expect(history).toHaveLength(versionsBefore + 1);
    expect(history[versionsBefore]?.actualsCutoff).toBe('2026-09-30');
    expect(history[versionsBefore]?.funding.minimumReserve.cents).toBe(7_500_000);
    // Earlier versions are untouched.
    expect(history[0]?.actualsCutoff).toBe('2026-07-31');
    expect(projectsService.policyFor(RIVERSIDE, '2026-08-15').version).toBe(1);
  });

  it('a reopen needs a reason and the reopen permission', async () => {
    const noReason = await publishPolicyAction(idle, formOf({ projectId: RIVERSIDE, actualsCutoff: '2026-06-30', reason: '' }));
    expect(noReason.ok).toBe(false);

    accessService.switchUser(USER_IDS.hassan);
    const investor = await publishPolicyAction(idle, formOf({ projectId: RIVERSIDE, actualsCutoff: '2026-06-30', reason: 'try' }));
    expect(investor.ok).toBe(false);
    accessService.switchUser(USER_IDS.jawad);

    const reopened = await publishPolicyAction(idle, formOf({ projectId: RIVERSIDE, actualsCutoff: '2026-06-30', reason: 'July invoice misdated' }));
    expect(reopened.ok).toBe(true);
    expect(projectsService.isPeriodLocked(RIVERSIDE, '2026-07-15')).toBe(false);
  });

  it('margin scheme cannot be enabled through policy (CAL11)', () => {
    expect(() =>
      projectsService.newPolicyVersion(RIVERSIDE, { tax: { marginSchemeEnabled: true } }, USER_IDS.jawad, 'try'),
    ).toThrow(/Margin scheme/);
    expect(money(0).cents).toBe(0);
  });
});
