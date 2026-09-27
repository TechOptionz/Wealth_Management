'use server';

import { revalidatePath } from 'next/cache';
import { asId, type ProjectId } from '@/shared/types/common';
import { fromMajorUnits, money } from '@/shared/lib/money';
import { percentToPpm } from '@/shared/finance-engine';
import type { ActionResult } from '@/shared/lib/action-result';
import { runAction } from '@/server/actions/run-action';
import { readAmount, readChoice, readString, requireString } from '@/shared/lib/form-data';
import { ValidationError } from '@/shared/lib/errors';
import { accessService } from '@/modules/access/service';
import { projectsService } from './service';
import {
  AUSTRALIAN_STATES,
  PROJECT_GRANTS,
  PROJECT_ROLES,
  PROJECT_TYPES,
  SETUP_STEPS,
  type ProjectGrant,
  type ProjectLifecycle,
  type TaxDisplayBasis,
} from './model';

const LIFECYCLES: readonly ProjectLifecycle[] = ['draft', 'active', 'paused', 'completed', 'archived'];
const DISPLAY_BASES: readonly TaxDisplayBasis[] = ['economic', 'gross'];

function revalidateProject(projectId?: string): void {
  revalidatePath('/projects');
  if (projectId) revalidatePath(`/projects/${projectId}`, 'layout');
}

function readRevision(form: FormData): number | undefined {
  const raw = readString(form, 'revision');
  if (raw === undefined) return undefined;
  const parsed = Number(raw);
  return Number.isInteger(parsed) ? parsed : undefined;
}

/** PRJ01/PRJ02 — the first wizard step creates a draft project. */
export async function createProjectAction(_previous: ActionResult<unknown>, form: FormData): Promise<ActionResult<unknown>> {
  return runAction('Project draft created', () => {
    accessService.guard('development.read');
    const actor = accessService.getCurrentUser();
    const horizonRaw = readString(form, 'forecastHorizonMonths');
    const horizon = horizonRaw === undefined ? 24 : Number(horizonRaw);
    const openingCash = readAmount(form, 'openingCash');
    const openingRestricted = readAmount(form, 'openingRestrictedCash');
    const legalEntityId = readString(form, 'legalEntityId');
    if (!legalEntityId) {
      throw new ValidationError('Choose the owning legal entity.', { fieldErrors: { legalEntityId: ['Select an entity.'] } });
    }
    const created = projectsService.createProject({
      code: requireString(form, 'code', 'Project code'),
      name: requireString(form, 'name', 'Project name'),
      legalEntityId: asId<'LegalEntity'>(legalEntityId),
      type: readChoice(form, 'type', PROJECT_TYPES) ?? 'townhouses',
      address: requireString(form, 'address', 'Address'),
      state: readChoice(form, 'state', AUSTRALIAN_STATES) ?? 'QLD',
      startDate: requireString(form, 'startDate', 'Start date'),
      expectedCompletion: requireString(form, 'expectedCompletion', 'Expected completion'),
      forecastHorizonMonths: horizon,
      reportingBasis: readChoice(form, 'reportingBasis', ['accrual', 'cash'] as const) ?? 'accrual',
      openingCash: openingCash === undefined ? money(0) : fromMajorUnits(openingCash),
      openingRestrictedCash: openingRestricted === undefined ? money(0) : fromMajorUnits(openingRestricted),
      actor: actor.id,
    });
    revalidateProject(created.id);
    return created;
  });
}

export async function updateProjectAction(_previous: ActionResult<unknown>, form: FormData): Promise<ActionResult<unknown>> {
  return runAction('Project updated', () => {
    accessService.guard('development.read');
    const projectId = asId<'Project'>(requireString(form, 'projectId', 'Project'));
    projectsService.guard(projectId, 'project.edit');
    const actor = accessService.getCurrentUser();
    const openingCash = readAmount(form, 'openingCash');
    const openingRestricted = readAmount(form, 'openingRestrictedCash');
    const horizonRaw = readString(form, 'forecastHorizonMonths');
    const updated = projectsService.updateProject(
      projectId,
      {
        ...(readString(form, 'name') ? { name: readString(form, 'name') } : {}),
        ...(readString(form, 'address') ? { address: readString(form, 'address') } : {}),
        ...(readChoice(form, 'type', PROJECT_TYPES) ? { type: readChoice(form, 'type', PROJECT_TYPES) } : {}),
        ...(readChoice(form, 'state', AUSTRALIAN_STATES) ? { state: readChoice(form, 'state', AUSTRALIAN_STATES) } : {}),
        ...(readString(form, 'expectedCompletion') ? { expectedCompletion: readString(form, 'expectedCompletion') } : {}),
        ...(horizonRaw ? { forecastHorizonMonths: Number(horizonRaw) } : {}),
        ...(openingCash !== undefined ? { openingCash: fromMajorUnits(openingCash) } : {}),
        ...(openingRestricted !== undefined ? { openingRestrictedCash: fromMajorUnits(openingRestricted) } : {}),
      },
      actor.id,
      readRevision(form),
    );
    revalidateProject(projectId);
    return updated;
  });
}

/** PRJ02 — mark a wizard step complete. The review step activates when nothing blocks. */
export async function completeSetupStepAction(_previous: ActionResult<unknown>, form: FormData): Promise<ActionResult<unknown>> {
  return runAction('Setup step saved', () => {
    accessService.guard('development.read');
    const projectId = asId<'Project'>(requireString(form, 'projectId', 'Project'));
    projectsService.guard(projectId, 'project.edit');
    const step = readChoice(form, 'step', SETUP_STEPS);
    if (!step) throw new ValidationError('Choose a setup step.');
    const updated = projectsService.completeSetupStep(projectId, step, accessService.getCurrentUser().id);
    revalidateProject(projectId);
    return updated;
  });
}

/** PRJ03 — lifecycle transitions; archive is reversible and reasons are recorded. */
export async function transitionProjectAction(_previous: ActionResult<unknown>, form: FormData): Promise<ActionResult<unknown>> {
  return runAction(
    (project: { lifecycle: string }) => `Project is now ${project.lifecycle}`,
    () => {
      accessService.guard('development.read');
      const projectId = asId<'Project'>(requireString(form, 'projectId', 'Project'));
      projectsService.guard(projectId, 'project.edit');
      const to = readChoice(form, 'to', LIFECYCLES);
      if (!to) throw new ValidationError('Choose the state to move to.');
      const updated = projectsService.transition(projectId, to, accessService.getCurrentUser().id, readString(form, 'reason'));
      revalidateProject(projectId);
      return updated;
    },
  );
}

/** CF06 / CAL08 / INV09 / FIN04 — publish a new policy version. */
export async function publishPolicyAction(_previous: ActionResult<unknown>, form: FormData): Promise<ActionResult<unknown>> {
  return runAction(
    (policy: { version: number }) => `Policy v${policy.version} published`,
    () => {
      accessService.guard('development.read');
      const projectId: ProjectId = asId<'Project'>(requireString(form, 'projectId', 'Project'));
      const scope = projectsService.guard(projectId, 'project.edit');
      const actor = accessService.getCurrentUser();
      const current = projectsService.policyFor(projectId);

      const cutoff = readString(form, 'actualsCutoff');
      if (cutoff && cutoff < current.actualsCutoff) projectsService.requirePermission(scope, 'period.reopen');

      const rateRaw = readString(form, 'standardRatePercent');
      const reserve = readAmount(form, 'minimumReserve');
      const approverThreshold = readAmount(form, 'twoPersonThreshold');
      const steps = [{ minimumGross: money(0), approversRequired: 1 }];
      if (approverThreshold !== undefined && approverThreshold > 0) {
        steps.push({ minimumGross: fromMajorUnits(approverThreshold), approversRequired: 2 });
      }
      const lagRaw = readString(form, 'settlementLagMonths');

      const version = projectsService.newPolicyVersion(
        projectId,
        {
          tax: {
            ...(rateRaw ? { standardRatePpm: percentToPpm(rateRaw) } : {}),
            ...(readChoice(form, 'displayBasis', DISPLAY_BASES) ? { displayBasis: readChoice(form, 'displayBasis', DISPLAY_BASES) } : {}),
            ...(lagRaw ? { settlementLagMonths: Number(lagRaw) } : {}),
          },
          ...(cutoff ? { actualsCutoff: cutoff } : {}),
          approval: { steps, allowSelfApproval: false },
          funding: {
            ...(reserve !== undefined ? { minimumReserve: fromMajorUnits(reserve) } : {}),
            repayExcessCash: readChoice(form, 'repayExcessCash', ['yes', 'no'] as const) !== 'no',
            autoFundForecast: readChoice(form, 'autoFundForecast', ['yes', 'no'] as const) !== 'no',
          },
        },
        actor.id,
        requireString(form, 'reason', 'Reason'),
        readString(form, 'effectiveFrom'),
      );
      revalidateProject(projectId);
      return version;
    },
  );
}

/** IAM01/IAM04 — grant or change a membership; authority is the limit. */
export async function grantProjectAccessAction(_previous: ActionResult<unknown>, form: FormData): Promise<ActionResult<unknown>> {
  return runAction('Project access saved', () => {
    accessService.guard('development.read');
    const projectId = asId<'Project'>(requireString(form, 'projectId', 'Project'));
    projectsService.guard(projectId, 'members.manage');
    const role = readChoice(form, 'role', PROJECT_ROLES);
    if (!role) throw new ValidationError('Choose a role.', { fieldErrors: { role: ['Select a role.'] } });
    const grants = form.getAll('grants').filter((value): value is string => typeof value === 'string' && (PROJECT_GRANTS as readonly string[]).includes(value)) as ProjectGrant[];
    const limit = readAmount(form, 'approvalLimit');
    const participantId = readString(form, 'participantId');
    const saved = projectsService.grantAccess({
      projectId,
      userId: asId<'User'>(requireString(form, 'userId', 'Person')),
      role,
      grants,
      approvalLimit: limit === undefined ? null : fromMajorUnits(limit),
      ...(participantId ? { participantId: asId<'EquityParticipant'>(participantId) } : {}),
      ...(readString(form, 'expiresAt') ? { expiresAt: readString(form, 'expiresAt') } : {}),
      actor: accessService.getCurrentUser().id,
    });
    revalidateProject(projectId);
    return saved;
  });
}

/** IAM03 — revoke or suspend a membership; takes effect on the next request. */
export async function setProjectAccessStatusAction(_previous: ActionResult<unknown>, form: FormData): Promise<ActionResult<unknown>> {
  return runAction('Project access updated', () => {
    accessService.guard('development.read');
    const projectId = asId<'Project'>(requireString(form, 'projectId', 'Project'));
    projectsService.guard(projectId, 'members.manage');
    const status = readChoice(form, 'status', ['active', 'suspended', 'revoked'] as const);
    if (!status) throw new ValidationError('Choose a status.');
    const updated = projectsService.setAccessStatus(
      asId<'ProjectAccess'>(requireString(form, 'accessId', 'Membership')),
      status,
      accessService.getCurrentUser().id,
      readString(form, 'reason'),
    );
    revalidateProject(projectId);
    return updated;
  });
}
