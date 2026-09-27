/**
 * Development Finance — organisations, projects, policies and project access
 * (§4: IAM01–IAM04, PRJ01–PRJ06; §12.2 Organisation, LegalEntity, Project,
 * ProjectPolicy, ProjectAccess).
 *
 * Three rules this model makes structural:
 *  1. **Project membership is explicit.** Organisation membership alone reaches
 *     nothing except for an organisation administrator (IAM01).
 *  2. **Roles are permission bundles; financial authority is a separate
 *     assignment.** An administrator is not an approver until an approval
 *     limit is recorded against them (IAM04).
 *  3. **Policy is versioned, never edited.** Tax, lock date, approval and
 *     funding rules are effective-dated immutable versions, so a published
 *     calculation can always name the policy it ran under (CAL05).
 */
import type { Ppm } from '@/shared/finance-engine';
import type { Money } from '@/shared/lib/money';
import type {
  EntityId,
  EquityParticipantId,
  IsoDate,
  IsoDateTime,
  LegalEntityId,
  OrganisationId,
  ProjectAccessId,
  ProjectId,
  ProjectPolicyId,
  PropertyId,
  UserId,
} from '@/shared/types/common';

export type ProjectType = 'apartments' | 'townhouses' | 'detached-homes' | 'land-lots' | 'mixed';

export const PROJECT_TYPES: readonly ProjectType[] = ['apartments', 'townhouses', 'detached-homes', 'land-lots', 'mixed'];

export const PROJECT_TYPE_LABELS: Record<ProjectType, string> = {
  apartments: 'Apartments',
  townhouses: 'Townhouses',
  'detached-homes': 'Detached homes',
  'land-lots': 'Land lots',
  mixed: 'Mixed',
};

export type AustralianState = 'QLD' | 'NSW' | 'VIC' | 'SA' | 'WA' | 'TAS' | 'ACT' | 'NT';
export const AUSTRALIAN_STATES: readonly AustralianState[] = ['QLD', 'NSW', 'VIC', 'SA', 'WA', 'TAS', 'ACT', 'NT'];

export type ProjectLifecycle = 'draft' | 'active' | 'paused' | 'completed' | 'archived';

export const LIFECYCLE_LABELS: Record<ProjectLifecycle, string> = {
  draft: 'Draft',
  active: 'Active',
  paused: 'Paused',
  completed: 'Completed',
  archived: 'Archived',
};

export type ReportingBasis = 'accrual' | 'cash';

/** How money is presented: economic (net of recoverable GST) or gross cash (CF02, CAL09). */
export type TaxDisplayBasis = 'economic' | 'gross';

export const TAX_DISPLAY_LABELS: Record<TaxDisplayBasis, string> = {
  economic: 'Economic · net of recoverable GST',
  gross: 'Gross · cash including GST',
};

/** The setup wizard steps (PRJ02), in order. */
export type SetupStep = 'identity' | 'categories' | 'milestones' | 'units' | 'opening-balances' | 'funding' | 'tax' | 'review';

export const SETUP_STEPS: readonly SetupStep[] = [
  'identity',
  'categories',
  'milestones',
  'units',
  'opening-balances',
  'funding',
  'tax',
  'review',
];

export const SETUP_STEP_LABELS: Record<SetupStep, string> = {
  identity: 'Project identity',
  categories: 'Categories & template',
  milestones: 'Milestones',
  units: 'Unit schedule',
  'opening-balances': 'Opening balances',
  funding: 'Funding',
  tax: 'Tax assumptions',
  review: 'Review',
};

export interface Organisation {
  readonly id: OrganisationId;
  readonly name: string;
  readonly legalName: string;
  readonly baseCurrency: 'AUD';
  readonly region: string;
  readonly policyVersion: number;
}

export interface LegalEntity {
  readonly id: LegalEntityId;
  readonly organisationId: OrganisationId;
  readonly legalName: string;
  readonly abn?: string;
  readonly gstRegistered: boolean;
  readonly reportingBasis: ReportingBasis;
  /** The wealth-platform entity this legal entity corresponds to, when it has one. */
  readonly entityId?: EntityId;
}

export interface Project {
  readonly id: ProjectId;
  readonly organisationId: OrganisationId;
  /** Unique within the organisation. */
  readonly code: string;
  readonly name: string;
  readonly legalEntityId: LegalEntityId;
  readonly type: ProjectType;
  /** Descriptive only — it never decides tax treatment (PRJ01). */
  readonly address: string;
  readonly state: AustralianState;
  readonly currency: 'AUD';
  readonly timezone: string;
  readonly startDate: IsoDate;
  readonly expectedCompletion: IsoDate;
  readonly forecastHorizonMonths: number;
  readonly reportingBasis: ReportingBasis;
  readonly lifecycle: ProjectLifecycle;
  readonly lifecycleReason?: string;
  /**
   * Increments on every financial mutation. Clients send the revision they
   * edited against; a mismatch is a conflict, never a silent overwrite (CF07).
   */
  readonly modelRevision: number;
  readonly openingCash: Money;
  /** Trust deposits and other restricted balances, kept apart from unrestricted cash (YLD04). */
  readonly openingRestrictedCash: Money;
  /** The wealth-platform property this development sits on, when it is recorded there. */
  readonly propertyId?: PropertyId;
  readonly setupStepsCompleted: readonly SetupStep[];
  readonly clonedFromProjectId?: ProjectId;
  /** No provider is connected in this build; the label is what the screen shows (§13 deferred). */
  readonly accountingConnection: 'none';
  readonly createdAt: IsoDateTime;
  readonly createdBy: UserId;
  readonly updatedAt: IsoDateTime;
  readonly archivedAt?: IsoDateTime;
}

export interface ApprovalStep {
  /** Invoices with gross value at or above this need this step. Steps are ordered ascending. */
  readonly minimumGross: Money;
  readonly approversRequired: number;
}

export interface ProjectPolicy {
  readonly id: ProjectPolicyId;
  readonly projectId: ProjectId;
  readonly version: number;
  readonly effectiveFrom: IsoDate;
  readonly createdAt: IsoDateTime;
  readonly createdBy: UserId;
  readonly reason: string;
  readonly tax: {
    readonly standardRatePpm: Ppm;
    readonly displayBasis: TaxDisplayBasis;
    /** Stays false until finance review supplies eligibility, method and basis (CAL11). */
    readonly marginSchemeEnabled: boolean;
    /** Months between a period's net GST position and its remittance or refund (CAL10). */
    readonly settlementLagMonths: number;
    readonly defaultRecoverablePpm: Ppm;
  };
  /** Periods on or before this date are locked; imported actuals are the record (CF06). */
  readonly actualsCutoff: IsoDate;
  readonly approval: {
    readonly steps: readonly ApprovalStep[];
    readonly allowSelfApproval: boolean;
  };
  readonly funding: {
    readonly order: 'equity-then-debt';
    readonly minimumReserve: Money;
    readonly repayExcessCash: boolean;
    /** Fill forecast shortfalls from committed equity and ranked debt (FIN04). Actual months use recorded movements only. */
    readonly autoFundForecast: boolean;
  };
}

export type ProjectRole = 'org-admin' | 'project-manager' | 'finance-officer' | 'approver' | 'viewer' | 'investor';

export const PROJECT_ROLES: readonly ProjectRole[] = [
  'org-admin',
  'project-manager',
  'finance-officer',
  'approver',
  'viewer',
  'investor',
];

export const PROJECT_ROLE_LABELS: Record<ProjectRole, string> = {
  'org-admin': 'Organisation admin',
  'project-manager': 'Project manager',
  'finance-officer': 'Finance officer',
  approver: 'Approver',
  viewer: 'Viewer',
  investor: 'Investor',
};

/** Explicit grants that extend a role (§4.2 "with … grant"). */
export type ProjectGrant =
  | 'project.edit'
  | 'invoice.capture'
  | 'payment.record'
  | 'accounting.connect'
  | 'publish'
  | 'export'
  | 'members.invite'
  | 'finance.fields';

export const PROJECT_GRANTS: readonly ProjectGrant[] = [
  'project.edit',
  'invoice.capture',
  'payment.record',
  'accounting.connect',
  'publish',
  'export',
  'members.invite',
  'finance.fields',
];

export const PROJECT_GRANT_LABELS: Record<ProjectGrant, string> = {
  'project.edit': 'Edit project, budgets and programme',
  'invoice.capture': 'Capture and code invoices',
  'payment.record': 'Record manual payment evidence',
  'accounting.connect': 'Connect accounting',
  publish: 'Publish baselines and scenarios',
  export: 'Export reports',
  'members.invite': 'Invite members to assigned projects',
  'finance.fields': 'Edit assigned financial fields',
};

export type ProjectAccessStatus = 'active' | 'suspended' | 'revoked';

export interface ProjectAccess {
  readonly id: ProjectAccessId;
  readonly projectId: ProjectId;
  readonly userId: UserId;
  readonly role: ProjectRole;
  readonly grants: readonly ProjectGrant[];
  /**
   * Financial authority (IAM04). Null means no authority to approve, whatever
   * the role. Limits compare against invoice gross value including tax.
   */
  readonly approvalLimit: Money | null;
  /** For investors: the participant whose capital account they may see (EQ03). */
  readonly participantId?: EquityParticipantId;
  readonly status: ProjectAccessStatus;
  readonly invitedAt: IsoDateTime;
  readonly expiresAt?: IsoDate;
  readonly revokedAt?: IsoDateTime;
}

/** What a member may do on a project. Absence is denial. */
export type ProjectPermission =
  | 'project.read'
  | 'financials.read'
  | 'participation.read'
  | 'project.edit'
  | 'members.manage'
  | 'budget.edit'
  | 'programme.edit'
  | 'sales.edit'
  | 'finance.edit'
  | 'invoice.capture'
  | 'invoice.approve'
  | 'payment.record'
  | 'accounting.connect'
  | 'baseline.publish'
  | 'scenario.publish'
  | 'period.reopen'
  | 'report.export'
  | 'comment.write'
  | 'assistant.use';

export interface ProjectScope {
  readonly userId: UserId;
  readonly projectId: ProjectId;
  readonly role: ProjectRole;
  readonly permissions: readonly ProjectPermission[];
  readonly approvalLimit: Money | null;
  readonly participantId: EquityParticipantId | null;
  readonly isOrgAdmin: boolean;
}

/** Lifecycle transitions that are allowed, and whether they need a reason (PRJ03). */
export const LIFECYCLE_TRANSITIONS: Record<ProjectLifecycle, readonly ProjectLifecycle[]> = {
  draft: ['active', 'archived'],
  active: ['paused', 'completed', 'archived'],
  paused: ['active', 'archived'],
  completed: ['active', 'archived'],
  archived: ['draft', 'active', 'paused', 'completed'],
};

export function isFinanciallyMutable(lifecycle: ProjectLifecycle): boolean {
  return lifecycle !== 'archived';
}
