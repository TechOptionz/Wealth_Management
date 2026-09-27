/**
 * UAT-04 — "A delegate cannot retrieve restricted totals through direct URLs,
 * exports, search or document links."
 *
 * NFR-01 — "Deny by default; enforce record/entity permissions server-side."
 */
import { afterEach, describe, expect, it } from 'vitest';
import { asId } from '@/shared/types/common';
import { accessApi } from '@/modules/access/api';
import { accessService } from '@/modules/access/service';
import { USER_IDS } from '@/modules/access/data/seed';
import { PROPERTY_IDS } from '@/modules/entities/data/seed';
import { propertiesService } from '@/modules/properties/service';
import { ForbiddenError, NotFoundError } from '@/shared/lib/errors';

describe('NFR-01 / UAT-04 · permission enforcement', () => {
  it('grants the portfolio owner whole-portfolio totals', () => {
    const scope = accessService.scopeFor(USER_IDS.jawad);

    expect(scope.scope).toBe('all');
    expect(() => accessService.requireCapability(scope, 'portfolio.totals.read')).not.toThrow();
  });

  it('denies an operations delegate the whole-portfolio totals', () => {
    const scope = accessService.scopeFor(USER_IDS.mahvish);

    expect(() => accessService.requireCapability(scope, 'portfolio.totals.read')).toThrow(ForbiddenError);
  });

  it('lets a delegate reach only their assigned properties', () => {
    const scope = accessService.scopeFor(USER_IDS.mahvish);

    expect(() => accessService.requireProperty(scope, PROPERTY_IDS.comptonRd)).not.toThrow();
    expect(() => accessService.requireProperty(scope, PROPERTY_IDS.bentonSt)).not.toThrow();
    // Watson Rd and Mians Rd are outside the grant — a direct id must not work.
    expect(() => accessService.requireProperty(scope, PROPERTY_IDS.watsonRd)).toThrow(ForbiddenError);
    expect(() => accessService.requireProperty(scope, PROPERTY_IDS.miansRd)).toThrow(ForbiddenError);
  });

  it('filters list results to the scope, so a delegate cannot enumerate the portfolio', () => {
    const scope = accessService.scopeFor(USER_IDS.mahvish);
    const visible = accessService.filterProperties(scope, propertiesService.list());

    expect(visible.map((property) => property.id).sort()).toEqual(
      [PROPERTY_IDS.bentonSt, PROPERTY_IDS.comptonRd].sort(),
    );
    expect(propertiesService.list().length).toBeGreaterThan(visible.length);
  });

  it('denies a family contributor everything except their assigned tasks', () => {
    const scope = accessService.scopeFor(USER_IDS.hassan);

    expect(() => accessService.requireCapability(scope, 'obligation.read')).not.toThrow();
    expect(() => accessService.requireCapability(scope, 'portfolio.totals.read')).toThrow(ForbiddenError);
    expect(() => accessService.requireCapability(scope, 'property.read')).toThrow(ForbiddenError);
    expect(() => accessService.requireCapability(scope, 'export.create')).toThrow(ForbiddenError);
  });

  it('gives the accountant read and export but never write or access management', () => {
    const scope = accessService.scopeFor(USER_IDS.accountant);

    expect(() => accessService.requireCapability(scope, 'export.create')).not.toThrow();
    expect(() => accessService.requireCapability(scope, 'expense.read')).not.toThrow();
    expect(() => accessService.requireCapability(scope, 'obligation.write')).toThrow(ForbiddenError);
    expect(() => accessService.requireCapability(scope, 'access.write')).toThrow(ForbiddenError);
  });

  it('keeps the technical operator out of business data', () => {
    const scope = accessService.scopeFor(USER_IDS.operator);

    expect(() => accessService.requireCapability(scope, 'audit.read')).not.toThrow();
    expect(() => accessService.requireCapability(scope, 'property.read')).toThrow(ForbiddenError);
    expect(() => accessService.requireCapability(scope, 'portfolio.totals.read')).toThrow(ForbiddenError);
    expect(() => accessService.requireCapability(scope, 'expense.read')).toThrow(ForbiddenError);
  });

  describe('switchUser · acting as a test persona', () => {
    // The active user is process-wide state; leave it as the owner for other suites.
    afterEach(() => {
      accessService.switchUser(USER_IDS.jawad);
    });

    it('starts as the portfolio owner, whose guard passes for portfolio totals', () => {
      expect(accessService.getCurrentUser().id).toBe(USER_IDS.jawad);
      expect(() => accessService.guard('portfolio.totals.read')).not.toThrow();
    });

    it('blocks portfolio totals for the accountant while still allowing expenses', () => {
      const user = accessService.switchUser(USER_IDS.accountant);

      expect(user.role).toBe('accountant-readonly');
      expect(accessService.getCurrentUser().id).toBe(USER_IDS.accountant);
      expect(() => accessService.guard('portfolio.totals.read')).toThrow(ForbiddenError);
      expect(() => accessService.guard('expense.read')).not.toThrow();
    });

    it('scopes property views for the operations delegate', () => {
      accessService.switchUser(USER_IDS.mahvish);
      const scope = accessService.guard('property.read');

      expect(scope.scope).toBe('restricted');
      expect(() => accessService.requireProperty(scope, PROPERTY_IDS.comptonRd)).not.toThrow();
      expect(() => accessService.requireProperty(scope, PROPERTY_IDS.watsonRd)).toThrow(ForbiddenError);
      expect(
        accessService.filterProperties(scope, propertiesService.list()).map((property) => property.id).sort(),
      ).toEqual([PROPERTY_IDS.bentonSt, PROPERTY_IDS.comptonRd].sort());
      expect(() => accessService.guard('portfolio.totals.read')).toThrow(ForbiddenError);
    });

    it('refuses the accountant the access screen — no people, no audit log, no inviting', () => {
      accessService.switchUser(USER_IDS.accountant);

      expect(() => accessApi.getOverview()).toThrow(ForbiddenError);
      expect(() => accessApi.listAuditEvents({})).toThrow(ForbiddenError);
    });

    it('shows the technical operator the audit log only', () => {
      accessService.switchUser(USER_IDS.operator);
      const overview = accessApi.getOverview();

      expect(overview.auditEvents.length).toBeGreaterThan(0);
      expect(overview.people).toEqual([]);
      expect(overview.continuity).toBeNull();
      expect(overview.canInvite).toBe(false);
    });

    it('lets the portfolio owner see everything and invite', () => {
      const overview = accessApi.getOverview();

      expect(overview.people.length).toBeGreaterThan(0);
      expect(overview.auditEvents.length).toBeGreaterThan(0);
      expect(overview.canInvite).toBe(true);
    });

    it('rejects an unknown user and leaves the active user unchanged', () => {
      expect(() => accessService.switchUser(asId<'User'>('usr-nobody'))).toThrow(NotFoundError);
      expect(accessService.getCurrentUser().id).toBe(USER_IDS.jawad);
    });

    it('records the switch in the audit log', () => {
      accessService.switchUser(USER_IDS.accountant);

      // Found by content, not position: switches in the same millisecond tie on `at`.
      const event = accessService
        .listAuditEvents()
        .find((entry) => entry.summary === 'Switched user · now acting as A. Kumar, CPA');
      expect(event?.actor).toBe('Jawad Siddique');
      expect(event?.outcome).toBe('ok');
    });
  });

  it('denies by default — no capability is granted implicitly', () => {
    const contributor = accessService.scopeFor(USER_IDS.hassan);
    const everyCapability = [
      'portfolio.totals.read',
      'property.read',
      'lease.read',
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
    ] as const;

    // A family contributor holds exactly two capabilities; everything else denies.
    // `development.read` is a door, not a grant: a development project still
    // shows nothing without a membership on that project (tests/df-projects).
    const granted = everyCapability.filter((capability) => contributor.capabilities.includes(capability));
    expect(granted).toEqual([]);
    expect(contributor.capabilities).toEqual(['obligation.read', 'development.read']);
  });
});
