/**
 * Access & audit domain model (NFR-01 access control, NFR-03 auditability).
 *
 * This module owns the `User` record. Every other module references people by
 * `UserId` and resolves display names through `access/service`.
 */
import type { EntityId, IsoDate, IsoDateTime, PropertyId, UserId } from '@/shared/types/common';

export type AccessRole =
  | 'portfolio-owner'
  | 'operations-delegate'
  | 'family-contributor'
  | 'accountant-readonly'
  | 'technical-operator';

export const ROLE_LABELS: Record<AccessRole, string> = {
  'portfolio-owner': 'Portfolio owner',
  'operations-delegate': 'Operations delegate',
  'family-contributor': 'Family contributor',
  'accountant-readonly': 'Accountant · read-only',
  'technical-operator': 'Technical operator',
};

/**
 * What each role may do, in plain words. Shown when granting access so the
 * choice is informed; `permissions.ts` remains the enforcement.
 */
export const ROLE_SUMMARIES: Record<AccessRole, string> = {
  'portfolio-owner': 'Everything, including whole-portfolio totals and granting access.',
  'operations-delegate':
    'Bills, rent tasks, expenses and documents on the chosen properties. No portfolio totals, no granting access.',
  'family-contributor': 'Assigned tasks only, plus any development project they are a member of. No properties, totals, exports or granting access.',
  'accountant-readonly': 'Read-only records and exports until the expiry date. No edits, no granting access.',
  'technical-operator': 'Audit log only. No business data.',
};

export type MfaState = 'on' | 'not-required';

export interface User {
  readonly id: UserId;
  readonly name: string;
  /** Masked for display, e.g. "jawad@…". Full addresses are never rendered. */
  readonly emailMasked?: string;
  readonly role: AccessRole;
  /** Marks people outside the household — shown as an "External" sub-label. */
  readonly external: boolean;
  readonly mfa: MfaState;
}

export interface AccessGrant {
  readonly id: string;
  readonly userId: UserId;
  /**
   * Whether the grant reaches the whole portfolio or a named subset.
   * `restricted` grants are enforced server-side, not merely described.
   */
  readonly scope: 'all' | 'restricted';
  /** Properties a restricted grant reaches. Empty for `all`. */
  readonly propertyIds: readonly PropertyId[];
  /** Entities a restricted grant reaches. Empty for `all`. */
  readonly entityIds: readonly EntityId[];
  /** Plain-language description of what this person can see. */
  readonly canSee: string;
  /** Secondary limitation line, e.g. "No whole-portfolio totals". */
  readonly canSeeNote?: string;
  /** Time-limited grants expire; the UI surfaces the date in the note. */
  readonly expiresOn?: IsoDate;
  readonly lastActiveAt: IsoDateTime;
  /** Human phrasing the prototype uses: "Today 09:12", "Yesterday", "3 days ago". */
  readonly lastActiveLabel: string;
}

export type AuditOutcome = 'ok' | 'failed';

export interface AuditEvent {
  readonly id: string;
  readonly at: IsoDateTime;
  /** Actor display name, or "system" for scheduled work. */
  readonly actor: string;
  readonly summary: string;
  /** Second line: timestamp, actor and context. */
  readonly context: string;
  readonly outcome: AuditOutcome;
}

/**
 * Emergency access and business-continuity posture. Explicit, time-limited and
 * audited — never a standing shared credential.
 */
export interface ContinuityPosture {
  readonly emergencyContactName: string;
  readonly emergencyContactNote: string;
  readonly instructionsReviewedOn: IsoDate;
  readonly instructionsNote: string;
  readonly backupsSummary: string;
  readonly backupsNote: string;
}
