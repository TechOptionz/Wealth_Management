/**
 * Seeded organisation, legal entity, project, policy and memberships for the
 * Riverside Townhomes demonstration (§16.3).
 *
 * Fictional throughout. The wealth-platform property "Lot 12, Logan Reserve"
 * (under construction, held by Esteem Development) is the site.
 */
import { asId } from '@/shared/types/common';
import { fromMajorUnits, money } from '@/shared/lib/money';
import { USER_IDS } from '@/modules/access/data/seed';
import { ENTITY_IDS, PROPERTY_IDS } from '@/modules/entities/data/seed';
import type { LegalEntity, Organisation, Project, ProjectAccess, ProjectPolicy } from '../model';

export const ORGANISATION_ID = asId<'Organisation'>('org-keyob');

export const LEGAL_ENTITY_IDS = {
  esteem: asId<'LegalEntity'>('le-esteem'),
};

export const PROJECT_IDS = {
  riverside: asId<'Project'>('proj-riverside'),
};

export const PROJECT_ACCESS_IDS = {
  jawad: asId<'ProjectAccess'>('pa-riverside-jawad'),
  mahvish: asId<'ProjectAccess'>('pa-riverside-mahvish'),
  kumar: asId<'ProjectAccess'>('pa-riverside-kumar'),
  hassan: asId<'ProjectAccess'>('pa-riverside-hassan'),
};

/** Participant ids are declared by `funding`; the investor membership references one by value. */
export const SEED_PARTICIPANT_IDS = {
  esteem: asId<'EquityParticipant'>('eqp-riverside-esteem'),
  hsfi: asId<'EquityParticipant'>('eqp-riverside-hsfi'),
};

/** The demonstration project's forecast window: 24 months from July 2026. */
export const RIVERSIDE_START = '2026-07-01';
export const RIVERSIDE_COMPLETION = '2028-06-30';
export const RIVERSIDE_ACTUALS_CUTOFF = '2026-08-31';

export function seedOrganisations(): readonly Organisation[] {
  return [
    {
      id: ORGANISATION_ID,
      name: 'KEYOB',
      legalName: 'KEYOB Holdings Pty Ltd',
      baseCurrency: 'AUD',
      region: 'Australia · Brisbane',
      policyVersion: 1,
    },
  ];
}

export function seedLegalEntities(): readonly LegalEntity[] {
  return [
    {
      id: LEGAL_ENTITY_IDS.esteem,
      organisationId: ORGANISATION_ID,
      legalName: 'Esteem Development Pty Ltd',
      abn: '61 000 000 000',
      gstRegistered: true,
      reportingBasis: 'accrual',
      entityId: ENTITY_IDS.esteem,
    },
  ];
}

export function seedProjects(): readonly Project[] {
  return [
    {
      id: PROJECT_IDS.riverside,
      organisationId: ORGANISATION_ID,
      code: 'RVT-01',
      name: 'Riverside Townhomes',
      legalEntityId: LEGAL_ENTITY_IDS.esteem,
      type: 'townhouses',
      address: 'Lot 12, Logan Reserve QLD 4133',
      state: 'QLD',
      currency: 'AUD',
      timezone: 'Australia/Brisbane',
      startDate: RIVERSIDE_START,
      expectedCompletion: RIVERSIDE_COMPLETION,
      forecastHorizonMonths: 24,
      reportingBasis: 'accrual',
      lifecycle: 'active',
      modelRevision: 12,
      openingCash: fromMajorUnits(150_000),
      openingRestrictedCash: money(0),
      propertyId: PROPERTY_IDS.loganReserve,
      setupStepsCompleted: ['identity', 'categories', 'milestones', 'units', 'opening-balances', 'funding', 'tax', 'review'],
      accountingConnection: 'none',
      createdAt: '2026-06-15T01:00:00.000Z',
      createdBy: USER_IDS.jawad,
      updatedAt: '2026-09-05T06:12:00.000Z',
    },
  ];
}

export function seedProjectPolicies(): readonly ProjectPolicy[] {
  return [
    {
      id: asId<'ProjectPolicy'>('pol-riverside-1'),
      projectId: PROJECT_IDS.riverside,
      version: 1,
      effectiveFrom: RIVERSIDE_START,
      createdAt: '2026-06-15T01:05:00.000Z',
      createdBy: USER_IDS.jawad,
      reason: 'Initial policy at project setup',
      tax: {
        standardRatePpm: 100_000,
        displayBasis: 'economic',
        marginSchemeEnabled: false,
        settlementLagMonths: 1,
        defaultRecoverablePpm: 1_000_000,
      },
      actualsCutoff: '2026-07-31',
      approval: {
        steps: [{ minimumGross: money(0), approversRequired: 1 }],
        allowSelfApproval: false,
      },
      funding: {
        order: 'equity-then-debt',
        minimumReserve: fromMajorUnits(50_000),
        repayExcessCash: true,
        autoFundForecast: true,
      },
    },
    {
      id: asId<'ProjectPolicy'>('pol-riverside-2'),
      projectId: PROJECT_IDS.riverside,
      version: 2,
      effectiveFrom: '2026-09-01',
      createdAt: '2026-09-03T23:40:00.000Z',
      createdBy: USER_IDS.accountant,
      reason: 'August actuals imported and reviewed · period closed',
      tax: {
        standardRatePpm: 100_000,
        displayBasis: 'economic',
        marginSchemeEnabled: false,
        settlementLagMonths: 1,
        defaultRecoverablePpm: 1_000_000,
      },
      actualsCutoff: RIVERSIDE_ACTUALS_CUTOFF,
      approval: {
        steps: [{ minimumGross: money(0), approversRequired: 1 }],
        allowSelfApproval: false,
      },
      funding: {
        order: 'equity-then-debt',
        minimumReserve: fromMajorUnits(50_000),
        repayExcessCash: true,
        autoFundForecast: true,
      },
    },
  ];
}

export function seedProjectAccess(): readonly ProjectAccess[] {
  return [
    {
      id: PROJECT_ACCESS_IDS.jawad,
      projectId: PROJECT_IDS.riverside,
      userId: USER_IDS.jawad,
      role: 'org-admin',
      grants: ['project.edit', 'invoice.capture', 'payment.record', 'publish', 'export', 'accounting.connect'],
      approvalLimit: fromMajorUnits(500_000),
      status: 'active',
      invitedAt: '2026-06-15T01:00:00.000Z',
    },
    {
      id: PROJECT_ACCESS_IDS.mahvish,
      projectId: PROJECT_IDS.riverside,
      userId: USER_IDS.mahvish,
      role: 'project-manager',
      grants: ['publish', 'members.invite'],
      approvalLimit: fromMajorUnits(100_000),
      status: 'active',
      invitedAt: '2026-06-16T02:30:00.000Z',
    },
    {
      // Codes invoices and records payments; holds no approval authority (IAM04).
      id: PROJECT_ACCESS_IDS.kumar,
      projectId: PROJECT_IDS.riverside,
      userId: USER_IDS.accountant,
      role: 'finance-officer',
      grants: [],
      approvalLimit: null,
      status: 'active',
      invitedAt: '2026-06-20T04:00:00.000Z',
      expiresAt: '2027-06-30',
    },
    {
      // Investor: sees their own participation only (EQ03).
      id: PROJECT_ACCESS_IDS.hassan,
      projectId: PROJECT_IDS.riverside,
      userId: USER_IDS.hassan,
      role: 'investor',
      grants: ['export'],
      approvalLimit: null,
      participantId: SEED_PARTICIPANT_IDS.hsfi,
      status: 'active',
      invitedAt: '2026-07-02T00:00:00.000Z',
    },
  ];
}
