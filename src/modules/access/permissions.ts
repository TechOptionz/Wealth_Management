/**
 * Permission model (NFR-01).
 *
 * "Deny by default; enforce record/entity permissions server-side across views,
 * search, jobs, downloads and exports."
 *
 * The rule this file exists to make structural: a permission decision is taken
 * **once, in the service layer**, and every route — page, API, export, search —
 * goes through it. A permission enforced only in a component is not enforced at
 * all, because a direct URL bypasses the component entirely (UAT-04).
 */
import type { EntityId, PropertyId, UserId } from '@/shared/types/common';
import type { AccessRole } from './model';

/** Capabilities a role may hold. Absence of a capability is a denial. */
export type Capability =
  | 'portfolio.totals.read' // whole-portfolio net worth, assets, liabilities
  | 'property.read'
  | 'lease.read'
  | 'obligation.read'
  | 'obligation.write'
  | 'expense.read'
  | 'document.read'
  | 'bank-import.read'
  | 'bank-import.write'
  | 'loan.read'
  | 'entity.read'
  | 'access.read'
  | 'access.write'
  | 'audit.read'
  | 'export.create'
  /** Development Finance: may open project screens. What a person may do inside a project is decided per project (`modules/projects`). */
  | 'development.read';

/**
 * Capabilities granted by each role. Deny by default: anything not listed here
 * is refused, so adding a capability is a deliberate act.
 */
const ROLE_CAPABILITIES: Record<AccessRole, readonly Capability[]> = {
  'portfolio-owner': [
    'portfolio.totals.read',
    'property.read',
    'lease.read',
    'obligation.read',
    'obligation.write',
    'expense.read',
    'document.read',
    'bank-import.read',
    'bank-import.write',
    'loan.read',
    'entity.read',
    'access.read',
    'access.write',
    'audit.read',
    'export.create',
    'development.read',
  ],
  // Operational work on assigned properties only — explicitly no portfolio totals.
  'operations-delegate': [
    'property.read',
    'lease.read',
    'obligation.read',
    'obligation.write',
    'expense.read',
    'document.read',
    'bank-import.read',
    'development.read',
  ],
  // Assigned tasks and budgets; no sensitive totals unless separately granted.
  // `development.read` only opens the door: a development project shows this
  // person nothing unless they hold a membership on it (an investor, typically).
  'family-contributor': ['obligation.read', 'development.read'],
  // Approved records and exports, read-only. No messaging, edits or grants.
  'accountant-readonly': [
    'property.read',
    'lease.read',
    'obligation.read',
    'expense.read',
    'document.read',
    'loan.read',
    'entity.read',
    'export.create',
    'development.read',
  ],
  // Deployment and recovery. No routine business data — access is an audited exception.
  'technical-operator': ['audit.read'],
};

/**
 * The records a user may see.
 *
 * `scope: 'all'` is whole-portfolio access. A scoped grant lists the specific
 * properties and entities the user may reach; everything else is denied.
 */
export interface AccessScope {
  readonly userId: UserId;
  readonly role: AccessRole;
  readonly capabilities: readonly Capability[];
  readonly scope: 'all' | 'restricted';
  readonly propertyIds: readonly PropertyId[];
  readonly entityIds: readonly EntityId[];
}

export function capabilitiesFor(role: AccessRole): readonly Capability[] {
  return ROLE_CAPABILITIES[role];
}

export function hasCapability(scope: AccessScope, capability: Capability): boolean {
  return scope.capabilities.includes(capability);
}

/** Whether a scope reaches a specific property. Unscoped users reach everything. */
export function canReachProperty(scope: AccessScope, propertyId: PropertyId): boolean {
  if (scope.scope === 'all') return true;
  return scope.propertyIds.includes(propertyId);
}

export function canReachEntity(scope: AccessScope, entityId: EntityId): boolean {
  if (scope.scope === 'all') return true;
  return scope.entityIds.includes(entityId);
}
