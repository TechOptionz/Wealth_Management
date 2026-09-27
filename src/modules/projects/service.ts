/**
 * Projects business logic (IAM01–IAM04, PRJ01–PRJ05, CF06, CF07).
 *
 * `guard` is the enforcement point every Development Finance `api.ts` and
 * Server Action passes through. It answers with a non-disclosing "not found"
 * when the caller has no membership at all, and "forbidden" when they are a
 * member without the permission — so an identifier from another organisation
 * reveals nothing (IAM02, AT01).
 */
import { randomUUID } from 'node:crypto';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '@/shared/lib/errors';
import { money, type Money } from '@/shared/lib/money';
import { asId, type IsoDate, type LegalEntityId, type OrganisationId, type ProjectAccessId, type ProjectId, type UserId } from '@/shared/types/common';
import { accessService } from '@/modules/access/service';
import { limitCovers, permissionsFor } from './permissions';
import { projectsRepository } from './repository';
import {
  LIFECYCLE_LABELS,
  LIFECYCLE_TRANSITIONS,
  SETUP_STEPS,
  isFinanciallyMutable,
  type LegalEntity,
  type Organisation,
  type Project,
  type ProjectAccess,
  type ProjectGrant,
  type ProjectLifecycle,
  type ProjectPermission,
  type ProjectPolicy,
  type ProjectRole,
  type ProjectScope,
  type SetupStep,
} from './model';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface CreateProjectInput {
  readonly organisationId?: OrganisationId;
  readonly code: string;
  readonly name: string;
  readonly legalEntityId: LegalEntityId;
  readonly type: Project['type'];
  readonly address: string;
  readonly state: Project['state'];
  readonly startDate: IsoDate;
  readonly expectedCompletion: IsoDate;
  readonly forecastHorizonMonths: number;
  readonly reportingBasis: Project['reportingBasis'];
  readonly timezone?: string;
  readonly openingCash?: Money;
  readonly openingRestrictedCash?: Money;
  readonly propertyId?: Project['propertyId'];
  readonly actor: UserId;
  readonly clonedFromProjectId?: ProjectId;
  readonly policyTemplate?: ProjectPolicy;
}

export interface PolicyChanges {
  readonly tax?: Partial<ProjectPolicy['tax']>;
  readonly actualsCutoff?: IsoDate;
  readonly approval?: Partial<ProjectPolicy['approval']>;
  readonly funding?: Partial<ProjectPolicy['funding']>;
}

function now(): string {
  return new Date().toISOString();
}

function actorName(userId: UserId): string {
  return accessService.resolveUserName(userId) ?? 'system';
}

export const projectsService = {
  organisation(): Organisation {
    const organisation = projectsRepository.listOrganisations()[0];
    if (!organisation) throw new NotFoundError('Organisation', 'default');
    return organisation;
  },

  listLegalEntities(): readonly LegalEntity[] {
    return projectsRepository.listLegalEntities();
  },

  requireLegalEntity(id: LegalEntityId): LegalEntity {
    const entity = projectsRepository.findLegalEntity(id);
    if (!entity) throw new NotFoundError('Legal entity', id);
    return entity;
  },

  /** Every project, regardless of caller. Use `listVisibleProjects` for anything user-facing. */
  listAll(): readonly Project[] {
    return projectsRepository.listProjects();
  },

  require(projectId: ProjectId): Project {
    const project = projectsRepository.findProject(projectId);
    if (!project) throw new NotFoundError('Project', projectId);
    return project;
  },

  /**
   * The membership a user holds on a project, or null. An organisation
   * administrator who is a member of any project reads every project (IAM01);
   * their synthesised scope carries only the grants of their real membership.
   */
  scopeFor(userId: UserId, projectId: ProjectId): ProjectScope | null {
    const project = projectsRepository.findProject(projectId);
    if (!project) return null;

    const direct = projectsRepository.findAccessFor(projectId, userId);
    const membership = direct && isLive(direct) ? direct : undefined;

    const adminElsewhere = projectsRepository
      .listAccessForUser(userId)
      .find((row) => row.role === 'org-admin' && isLive(row));

    const effective: ProjectAccess | undefined =
      membership ??
      (adminElsewhere
        ? { ...adminElsewhere, projectId, grants: [], approvalLimit: null, participantId: undefined }
        : undefined);
    if (!effective) return null;

    return {
      userId,
      projectId,
      role: effective.role,
      permissions: permissionsFor(effective),
      approvalLimit: effective.approvalLimit,
      participantId: effective.participantId ?? null,
      isOrgAdmin: effective.role === 'org-admin',
    };
  },

  currentScope(projectId: ProjectId): ProjectScope | null {
    return projectsService.scopeFor(accessService.getCurrentUser().id, projectId);
  },

  /**
   * Assert the caller may act on a project. No membership → NotFound, so the
   * response is the same as for an id that does not exist (IAM02).
   */
  guard(projectId: ProjectId, permission: ProjectPermission): ProjectScope {
    const scope = projectsService.currentScope(projectId);
    if (!scope) throw new NotFoundError('Project', projectId);
    projectsService.requirePermission(scope, permission);
    return scope;
  },

  requirePermission(scope: ProjectScope, permission: ProjectPermission): void {
    if (!scope.permissions.includes(permission)) {
      throw new ForbiddenError(`This membership does not allow ${permission.replace(/[.]/g, ' ')} on this project.`);
    }
  },

  hasPermission(scope: ProjectScope, permission: ProjectPermission): boolean {
    return scope.permissions.includes(permission);
  },

  /** Approval authority is a limit, not a role (IAM04, INV09). */
  canApprove(scope: ProjectScope, gross: Money): boolean {
    return scope.permissions.includes('invoice.approve') && limitCovers(scope.approvalLimit, gross);
  },

  /** Projects the user may open, in seeded order. */
  listVisibleProjects(userId: UserId = accessService.getCurrentUser().id): readonly Project[] {
    return projectsRepository.listProjects().filter((project) => projectsService.scopeFor(userId, project.id) !== null);
  },

  /** Refuse a financial mutation on an archived project (PRJ03). */
  assertMutable(projectId: ProjectId): Project {
    const project = projectsService.require(projectId);
    if (!isFinanciallyMutable(project.lifecycle)) {
      throw new ConflictError(`${project.name} is archived; reopen it before recording financial changes.`);
    }
    return project;
  },

  /**
   * Advance the model revision after a financial mutation (CF07, API02).
   *
   * When the caller names the revision it edited against and it is stale, the
   * write is refused with both numbers, so the user can see what moved.
   */
  bumpRevision(projectId: ProjectId, expectedRevision?: number): number {
    const project = projectsService.require(projectId);
    if (expectedRevision !== undefined && expectedRevision !== project.modelRevision) {
      throw new ConflictError('Someone else changed this project since you loaded it. Review the latest values and try again.', {
        yourRevision: expectedRevision,
        latestRevision: project.modelRevision,
      });
    }
    const next = project.modelRevision + 1;
    projectsRepository.updateProject(projectId, { modelRevision: next, updatedAt: now() });
    return next;
  },

  /** The policy in force on a date (the latest version effective on or before it). */
  policyFor(projectId: ProjectId, on?: IsoDate): ProjectPolicy {
    const versions = projectsRepository.listPolicies(projectId);
    const applicable = on ? versions.filter((policy) => policy.effectiveFrom <= on) : versions;
    const policy = applicable[applicable.length - 1] ?? versions[0];
    if (!policy) throw new NotFoundError('Project policy', projectId);
    return policy;
  },

  policyHistory(projectId: ProjectId): readonly ProjectPolicy[] {
    return projectsRepository.listPolicies(projectId);
  },

  /** Whether a date falls in a locked period (CF06). */
  isPeriodLocked(projectId: ProjectId, date: IsoDate): boolean {
    return date <= projectsService.policyFor(projectId).actualsCutoff;
  },

  createProject(input: CreateProjectInput): Project {
    const organisation = input.organisationId
      ? projectsRepository.findOrganisation(input.organisationId)
      : projectsService.organisation();
    if (!organisation) throw new NotFoundError('Organisation', String(input.organisationId));

    const code = input.code.trim().toUpperCase();
    if (!/^[A-Z0-9][A-Z0-9-]{1,19}$/.test(code)) {
      throw new ValidationError('Enter a project code of 2–20 letters, digits or hyphens.', {
        fieldErrors: { code: ['Use letters, digits and hyphens only, e.g. RVT-02.'] },
      });
    }
    if (projectsRepository.findProjectByCode(organisation.id, code)) {
      throw new ValidationError(`Project code ${code} is already used in ${organisation.name}.`, {
        fieldErrors: { code: ['Each project code must be unique within the organisation.'] },
      });
    }
    if (!input.name.trim()) {
      throw new ValidationError('Enter a project name.', { fieldErrors: { name: ['A project needs a name.'] } });
    }
    projectsService.requireLegalEntity(input.legalEntityId);
    if (!ISO_DATE.test(input.startDate) || !ISO_DATE.test(input.expectedCompletion)) {
      throw new ValidationError('Enter dates as YYYY-MM-DD.');
    }
    if (input.expectedCompletion <= input.startDate) {
      throw new ValidationError('Expected completion must be after the start date.', {
        fieldErrors: { expectedCompletion: ['Choose a date after the start date.'] },
      });
    }
    if (!Number.isInteger(input.forecastHorizonMonths) || input.forecastHorizonMonths < 1 || input.forecastHorizonMonths > 120) {
      throw new ValidationError('The forecast horizon must be between 1 and 120 months.', {
        fieldErrors: { forecastHorizonMonths: ['Enter a whole number of months from 1 to 120.'] },
      });
    }

    const at = now();
    const project: Project = {
      id: asId<'Project'>(`proj-${randomUUID()}`),
      organisationId: organisation.id,
      code,
      name: input.name.trim(),
      legalEntityId: input.legalEntityId,
      type: input.type,
      address: input.address.trim(),
      state: input.state,
      currency: 'AUD',
      timezone: input.timezone ?? 'Australia/Brisbane',
      startDate: input.startDate,
      expectedCompletion: input.expectedCompletion,
      forecastHorizonMonths: input.forecastHorizonMonths,
      reportingBasis: input.reportingBasis,
      lifecycle: 'draft',
      modelRevision: 1,
      openingCash: input.openingCash ?? money(0),
      openingRestrictedCash: input.openingRestrictedCash ?? money(0),
      ...(input.propertyId ? { propertyId: input.propertyId } : {}),
      setupStepsCompleted: ['identity'],
      ...(input.clonedFromProjectId ? { clonedFromProjectId: input.clonedFromProjectId } : {}),
      accountingConnection: 'none',
      createdAt: at,
      createdBy: input.actor,
      updatedAt: at,
    };
    const created = projectsRepository.insertProject(project);

    const template = input.policyTemplate;
    projectsRepository.insertPolicy({
      id: asId<'ProjectPolicy'>(`pol-${randomUUID()}`),
      projectId: created.id,
      version: 1,
      effectiveFrom: created.startDate,
      createdAt: at,
      createdBy: input.actor,
      reason: template ? `Copied from ${template.projectId} at clone` : 'Initial policy at project setup',
      tax: template?.tax ?? {
        standardRatePpm: 100_000,
        displayBasis: 'economic',
        marginSchemeEnabled: false,
        settlementLagMonths: 1,
        defaultRecoverablePpm: 1_000_000,
      },
      // A new project has no actuals yet: nothing is locked.
      actualsCutoff: addDaysIso(created.startDate, -1),
      approval: template?.approval ?? { steps: [{ minimumGross: money(0), approversRequired: 1 }], allowSelfApproval: false },
      funding: template?.funding ?? {
        order: 'equity-then-debt',
        minimumReserve: money(0),
        repayExcessCash: true,
        autoFundForecast: true,
      },
    });

    // The creator manages the project they set up.
    projectsRepository.insertAccess({
      id: asId<'ProjectAccess'>(`pa-${randomUUID()}`),
      projectId: created.id,
      userId: input.actor,
      role: 'project-manager',
      grants: ['publish', 'members.invite', 'payment.record'],
      approvalLimit: null,
      status: 'active',
      invitedAt: at,
    });

    accessService.record({
      actor: actorName(input.actor),
      summary: `Project created · ${created.code} ${created.name}`,
      context: `${input.clonedFromProjectId ? 'Cloned · ' : ''}draft · ${created.type} · ${created.state}`,
    });
    return created;
  },

  updateProject(
    projectId: ProjectId,
    changes: Partial<Pick<Project, 'name' | 'address' | 'type' | 'state' | 'expectedCompletion' | 'forecastHorizonMonths' | 'reportingBasis' | 'openingCash' | 'openingRestrictedCash' | 'legalEntityId' | 'propertyId' | 'timezone'>>,
    actor: UserId,
    expectedRevision?: number,
  ): Project {
    const project = projectsService.assertMutable(projectId);
    if (changes.expectedCompletion && changes.expectedCompletion <= project.startDate) {
      throw new ValidationError('Expected completion must be after the start date.', {
        fieldErrors: { expectedCompletion: ['Choose a date after the start date.'] },
      });
    }
    if (changes.openingCash && changes.openingCash.cents < 0) {
      throw new ValidationError('Opening cash cannot be negative.', { fieldErrors: { openingCash: ['Enter zero or more.'] } });
    }
    if (changes.openingRestrictedCash && changes.openingRestrictedCash.cents < 0) {
      throw new ValidationError('Opening restricted cash cannot be negative.', {
        fieldErrors: { openingRestrictedCash: ['Enter zero or more.'] },
      });
    }
    projectsService.bumpRevision(projectId, expectedRevision);
    const updated = projectsRepository.updateProject(projectId, { ...changes, updatedAt: now() });
    if (!updated) throw new NotFoundError('Project', projectId);

    const changed = Object.keys(changes).join(', ') || 'nothing';
    accessService.record({
      actor: actorName(actor),
      summary: `Project updated · ${updated.code}`,
      context: `Fields: ${changed}`,
    });
    return updated;
  },

  /** Record a setup wizard step as complete (PRJ02). Steps may be completed in any order. */
  completeSetupStep(projectId: ProjectId, step: SetupStep, actor: UserId): Project {
    const project = projectsService.assertMutable(projectId);
    if (!SETUP_STEPS.includes(step)) throw new ValidationError(`"${step}" is not a setup step.`);
    const steps = project.setupStepsCompleted.includes(step)
      ? project.setupStepsCompleted
      : [...project.setupStepsCompleted, step];
    const updated = projectsRepository.updateProject(projectId, { setupStepsCompleted: steps, updatedAt: now() });
    if (!updated) throw new NotFoundError('Project', projectId);
    accessService.record({
      actor: actorName(actor),
      summary: `Setup step completed · ${project.code} · ${step}`,
      context: `${steps.length} of ${SETUP_STEPS.length} steps complete`,
    });
    return updated;
  },

  /** What still blocks activation (PRJ02). Empty means the project may go live. */
  activationBlockers(project: Project): readonly string[] {
    const blockers: string[] = [];
    for (const step of SETUP_STEPS) {
      if (!project.setupStepsCompleted.includes(step)) blockers.push(`Setup step not complete: ${step}`);
    }
    if (!project.name.trim()) blockers.push('Project name is missing');
    if (!project.address.trim()) blockers.push('Address is missing');
    if (project.openingCash.cents < 0 || project.openingRestrictedCash.cents < 0) {
      blockers.push('Opening balances do not reconcile (negative balance)');
    }
    return blockers;
  },

  /** Move a project between lifecycle states (PRJ03). Archive is reversible with a reason. */
  transition(projectId: ProjectId, to: ProjectLifecycle, actor: UserId, reason?: string): Project {
    const project = projectsService.require(projectId);
    const allowed = LIFECYCLE_TRANSITIONS[project.lifecycle];
    if (!allowed.includes(to)) {
      throw new ConflictError(`A ${LIFECYCLE_LABELS[project.lifecycle].toLowerCase()} project cannot move to ${LIFECYCLE_LABELS[to].toLowerCase()}.`);
    }
    if (project.lifecycle === 'draft' && to === 'active') {
      const blockers = projectsService.activationBlockers(project);
      if (blockers.length > 0) {
        throw new ValidationError(`The project cannot be activated yet: ${blockers[0]}.`, { blockers });
      }
    }
    const needsReason = project.lifecycle === 'archived' || to === 'archived' || to === 'paused';
    if (needsReason && !reason?.trim()) {
      throw new ValidationError('Give a reason for this change.', {
        fieldErrors: { reason: [`A reason is required to move a project to ${LIFECYCLE_LABELS[to].toLowerCase()}.`] },
      });
    }
    const updated = projectsRepository.updateProject(projectId, {
      lifecycle: to,
      ...(reason ? { lifecycleReason: reason.trim() } : {}),
      updatedAt: now(),
      ...(to === 'archived' ? { archivedAt: now() } : {}),
    });
    if (!updated) throw new NotFoundError('Project', projectId);
    accessService.record({
      actor: actorName(actor),
      summary: `Project ${LIFECYCLE_LABELS[to].toLowerCase()} · ${project.code}`,
      context: `${LIFECYCLE_LABELS[project.lifecycle]} → ${LIFECYCLE_LABELS[to]}${reason ? ` · ${reason.trim()}` : ''}`,
    });
    return updated;
  },

  /**
   * Publish a new policy version (immutable, effective dated). Moving the
   * actuals cutoff *earlier* reopens closed periods and needs a reason and the
   * reopen permission — the caller checks the permission, this checks the reason.
   */
  newPolicyVersion(projectId: ProjectId, changes: PolicyChanges, actor: UserId, reason: string, effectiveFrom?: IsoDate): ProjectPolicy {
    projectsService.assertMutable(projectId);
    if (!reason.trim()) throw new ValidationError('Give a reason for the policy change.', { fieldErrors: { reason: ['A reason is required.'] } });
    const current = projectsService.policyFor(projectId);
    const cutoff = changes.actualsCutoff ?? current.actualsCutoff;
    if (!ISO_DATE.test(cutoff)) throw new ValidationError('Enter the actuals cutoff as YYYY-MM-DD.');
    if (changes.tax?.marginSchemeEnabled) {
      throw new ValidationError('Margin scheme treatment stays disabled until finance review supplies eligibility, method and basis (CAL11).', {
        fieldErrors: { marginSchemeEnabled: ['Not available in this release.'] },
      });
    }
    const steps = changes.approval?.steps ?? current.approval.steps;
    if (steps.length === 0 || steps.some((step) => step.approversRequired < 1 || step.minimumGross.cents < 0)) {
      throw new ValidationError('Approval steps need at least one approver each and a non-negative threshold.');
    }
    const version: ProjectPolicy = {
      id: asId<'ProjectPolicy'>(`pol-${randomUUID()}`),
      projectId,
      version: current.version + 1,
      effectiveFrom: effectiveFrom ?? new Date().toISOString().slice(0, 10),
      createdAt: now(),
      createdBy: actor,
      reason: reason.trim(),
      tax: { ...current.tax, ...changes.tax },
      actualsCutoff: cutoff,
      approval: { ...current.approval, ...changes.approval, steps: [...steps].sort((a, b) => a.minimumGross.cents - b.minimumGross.cents) },
      funding: { ...current.funding, ...changes.funding },
    };
    projectsRepository.insertPolicy(version);
    projectsService.bumpRevision(projectId);
    accessService.record({
      actor: actorName(actor),
      summary: `Project policy v${version.version} published · ${projectsService.require(projectId).code}`,
      context: `${reason.trim()} · actuals cutoff ${cutoff}${cutoff < current.actualsCutoff ? ' · period reopened' : ''}`,
    });
    return version;
  },

  listMembers(projectId: ProjectId): readonly ProjectAccess[] {
    return projectsRepository.listAccess(projectId);
  },

  grantAccess(input: {
    readonly projectId: ProjectId;
    readonly userId: UserId;
    readonly role: ProjectRole;
    readonly grants: readonly ProjectGrant[];
    readonly approvalLimit: Money | null;
    readonly participantId?: ProjectAccess['participantId'];
    readonly expiresAt?: IsoDate;
    readonly actor: UserId;
  }): ProjectAccess {
    projectsService.require(input.projectId);
    accessService.requireUser(input.userId);
    if (input.role === 'approver' && input.approvalLimit === null) {
      throw new ValidationError('An approver needs an approval limit.', {
        fieldErrors: { approvalLimit: ['Enter the gross value this person may approve up to.'] },
      });
    }
    if (input.approvalLimit && input.approvalLimit.cents <= 0) {
      throw new ValidationError('An approval limit must be greater than zero.', {
        fieldErrors: { approvalLimit: ['Enter an amount greater than zero, or leave blank for no authority.'] },
      });
    }
    const existing = projectsRepository.findAccessFor(input.projectId, input.userId);
    const at = now();
    const row: ProjectAccess = {
      id: existing?.id ?? asId<'ProjectAccess'>(`pa-${randomUUID()}`),
      projectId: input.projectId,
      userId: input.userId,
      role: input.role,
      grants: [...new Set(input.grants)],
      approvalLimit: input.approvalLimit,
      ...(input.participantId ? { participantId: input.participantId } : {}),
      status: 'active',
      invitedAt: existing?.invitedAt ?? at,
      ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
    };
    const saved = existing
      ? projectsRepository.updateAccess(existing.id, { ...row, revokedAt: undefined })
      : projectsRepository.insertAccess(row);
    if (!saved) throw new NotFoundError('Project access', String(existing?.id));
    accessService.record({
      actor: actorName(input.actor),
      summary: `Project access ${existing ? 'changed' : 'granted'} · ${actorName(input.userId)} · ${input.role}`,
      context: `${projectsService.require(input.projectId).code} · limit ${input.approvalLimit ? input.approvalLimit.cents / 100 : 'none'} · grants ${row.grants.join(', ') || 'none'}`,
    });
    return saved;
  },

  /** Revoking or suspending takes effect immediately: the next guard finds no live membership (IAM03). */
  setAccessStatus(accessId: ProjectAccessId, status: ProjectAccess['status'], actor: UserId, reason?: string): ProjectAccess {
    const row = projectsRepository.findAccess(accessId);
    if (!row) throw new NotFoundError('Project access', accessId);
    const updated = projectsRepository.updateAccess(accessId, {
      status,
      ...(status === 'revoked' ? { revokedAt: now() } : {}),
    });
    if (!updated) throw new NotFoundError('Project access', accessId);
    accessService.record({
      actor: actorName(actor),
      summary: `Project access ${status} · ${actorName(row.userId)}`,
      context: `${projectsService.require(row.projectId).code}${reason ? ` · ${reason}` : ''}`,
    });
    return updated;
  },
};

function isLive(row: ProjectAccess): boolean {
  if (row.status !== 'active') return false;
  if (row.expiresAt && row.expiresAt < new Date().toISOString().slice(0, 10)) return false;
  return true;
}

function addDaysIso(date: IsoDate, days: number): IsoDate {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}
