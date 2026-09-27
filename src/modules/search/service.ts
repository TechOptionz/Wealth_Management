/**
 * Global search business logic (FR-09).
 *
 * A read model over other modules' services — it owns no records. Matching is
 * plain case-insensitive text: every word of the query must appear somewhere in
 * a record's searchable fields, so "compton water" finds the Compton Rd water
 * bill without needing the words to be adjacent.
 *
 * NFR-01 / UAT-04 name search explicitly: a category the caller has no capability
 * for is left out, and a restricted scope only ever sees records tied to the
 * properties and entities it was granted. Filtering happens before ranking and
 * counting, so neither a result nor a total can reveal a record out of reach.
 */
import type { IsoDate, PropertyId } from '@/shared/types/common';
import {
  SEARCH_CATEGORIES,
  SEARCH_CATEGORY_LABELS,
  type SearchCategory,
  type SearchGroup,
  type SearchResult,
  type SearchResults,
} from '@/shared/types/search';
import { accessService } from '@/modules/access/service';
import {
  canReachEntity,
  canReachProperty,
  hasCapability,
  type AccessScope,
  type Capability,
} from '@/modules/access/permissions';
import { propertiesService } from '@/modules/properties/service';
import { leasesService } from '@/modules/leases/service';
import { obligationsService } from '@/modules/obligations/service';
import { loansService } from '@/modules/loans/service';
import { documentsService } from '@/modules/documents/service';

/** Results shown per category. */
export const SEARCH_RESULT_LIMIT = 5;

/** Shorter queries match nearly everything, so they return nothing instead. */
export const SEARCH_MIN_QUERY_LENGTH = 2;

/** The capability each category's own screen requires. */
const CATEGORY_CAPABILITIES: Record<SearchCategory, Capability> = {
  properties: 'property.read',
  tenants: 'lease.read',
  obligations: 'obligation.read',
  loans: 'loan.read',
  documents: 'document.read',
};

/** A record reduced to what matching and display need. */
interface Candidate {
  readonly result: SearchResult;
  /** The field a user most likely typed — matches here rank first. */
  readonly primary: string;
  /** Further searchable text. */
  readonly secondary: readonly string[];
}

function normalise(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Rank of a candidate against the query, or null when it does not match.
 * 0 = primary field starts with the query, 1 = primary field contains every
 * word, 2 = matched only with the help of a secondary field.
 */
function rank(candidate: Candidate, query: string, words: readonly string[]): number | null {
  const primary = normalise(candidate.primary);
  if (primary.startsWith(query)) return 0;
  if (words.every((word) => primary.includes(word))) return 1;

  const everything = [primary, ...candidate.secondary.map(normalise)].join(' ');
  return words.every((word) => everything.includes(word)) ? 2 : null;
}

/**
 * Link to a list screen with one record picked out. Tenants, obligations, loans
 * and documents have no page of their own, so the list screen reads this
 * parameter and selects, highlights and scrolls to the record.
 */
function recordHref(path: string, param: string, id: string): string {
  return `${path}?${param}=${encodeURIComponent(id)}`;
}

function reachesAll(scope: AccessScope, propertyIds: readonly PropertyId[]): boolean {
  return propertyIds.every((propertyId) => canReachProperty(scope, propertyId));
}

/** Candidates per category, already narrowed to what the scope may reach. */
const CANDIDATE_SOURCES: Record<SearchCategory, (asOf: IsoDate, scope: AccessScope) => readonly Candidate[]> = {
  properties: (_asOf, scope) =>
    accessService.filterProperties(scope, propertiesService.list()).map((property) => ({
      result: {
        id: property.id,
        category: 'properties',
        title: property.name,
        subtitle: property.fullAddress,
        href: `/properties/${property.id}`,
      },
      primary: property.name,
      secondary: [property.fullAddress],
    })),

  tenants: (asOf, scope) =>
    leasesService
      .list()
      .filter((lease) => canReachProperty(scope, lease.propertyId))
      .map((lease) => leasesService.view(lease, asOf))
      // Current tenancies first, so a past tenant never crowds out a live one.
      .sort((a, b) => Number(a.status === 'ended') - Number(b.status === 'ended'))
      .map((view) => ({
        result: {
          id: view.lease.id,
          category: 'tenants',
          title: view.tenantName,
          subtitle: `${view.propertyLabel} · ${view.lease.reference}${view.status === 'ended' ? ' · ended' : ''}`,
          href: recordHref('/leases', 'lease', view.lease.id),
        },
        primary: view.tenantName,
        secondary: [view.lease.reference],
      })),

  obligations: (asOf, scope) =>
    obligationsService
      .listViews(asOf, 'all')
      // An obligation with no property is portfolio-level; the capability covers it.
      .filter(({ obligation }) => !obligation.propertyId || canReachProperty(scope, obligation.propertyId))
      .map((view) => ({
        result: {
          id: view.obligation.id,
          category: 'obligations',
          title: view.obligation.title,
          subtitle: `${view.obligation.contextLabel} · ${view.statusLabel}`,
          href: recordHref('/obligations', 'obligation', view.obligation.id),
        },
        primary: view.obligation.title,
        secondary: [view.obligation.contextLabel],
      })),

  loans: (_asOf, scope) =>
    loansService
      .list()
      .filter((loan) => reachesAll(scope, loan.security.propertyIds))
      .map((loan) => ({
        result: {
          id: loan.id,
          category: 'loans',
          title: loan.lender === loan.facilityName ? loan.lender : `${loan.lender} · ${loan.facilityName}`,
          subtitle: loan.security.label,
          href: recordHref('/loans', 'loan', loan.id),
        },
        primary: loan.lender,
        secondary: [loan.facilityName],
      })),

  documents: (_asOf, scope) =>
    documentsService
      .list('all')
      .filter(({ record }) =>
        record.links.every((link) => {
          if (link.type === 'property') return canReachProperty(scope, link.propertyId);
          if (link.type === 'entity') return canReachEntity(scope, link.entityId);
          return true;
        }),
      )
      .map((view) => ({
        result: {
          id: view.record.id,
          category: 'documents',
          title: view.record.filename,
          subtitle: [view.typeLabel, view.linkLabel ?? 'Unlinked'].join(' · '),
          href: recordHref('/documents', 'document', view.record.id),
        },
        primary: view.record.filename,
        secondary: [],
      })),
};

export const searchService = {
  /**
   * Records matching `query`, grouped by category and capped per category.
   *
   * `asOf` decides the derived text shown beside a result — an obligation's
   * status, whether a lease has ended. `scope` defaults to the current user.
   */
  search(query: string, asOf: IsoDate, scope: AccessScope = accessService.currentScope()): SearchResults {
    const normalised = normalise(query);
    if (normalised.length < SEARCH_MIN_QUERY_LENGTH) return { query: normalised, groups: [] };
    const words = normalised.split(' ');

    const groups = SEARCH_CATEGORIES.flatMap((category): SearchGroup[] => {
      // Deny by default: no capability, no group — not even an empty one.
      if (!hasCapability(scope, CATEGORY_CAPABILITIES[category])) return [];

      const matches = CANDIDATE_SOURCES[category](asOf, scope)
        .map((candidate) => ({ candidate, rank: rank(candidate, normalised, words) }))
        .filter((entry): entry is { candidate: Candidate; rank: number } => entry.rank !== null)
        // Stable sort: equal ranks keep the source module's own ordering.
        .sort((a, b) => a.rank - b.rank);
      if (matches.length === 0) return [];

      return [
        {
          category,
          label: SEARCH_CATEGORY_LABELS[category],
          results: matches.slice(0, SEARCH_RESULT_LIMIT).map((entry) => entry.candidate.result),
          total: matches.length,
        },
      ];
    });

    return { query: normalised, groups };
  },
};
