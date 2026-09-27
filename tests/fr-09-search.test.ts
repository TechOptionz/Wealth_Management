/**
 * FR-09 — global search.
 *
 * The top bar finds properties, tenants, obligations, loans and documents by
 * text. UAT-04 names search as a route that must not leak restricted records,
 * so the permission cases here matter as much as the matching ones.
 */
import { describe, expect, it } from 'vitest';
import { resolveAsOfDate } from '@/shared/config/app-config';
import type { SearchCategory, SearchResults } from '@/shared/types/search';
import { accessService } from '@/modules/access/service';
import { USER_IDS } from '@/modules/access/data/seed';
import { PROPERTY_IDS } from '@/modules/entities/data/seed';
import { searchService, SEARCH_RESULT_LIMIT } from '@/modules/search/service';
import { searchApi } from '@/modules/search/api';

const asOf = resolveAsOfDate();

function group(results: SearchResults, category: SearchCategory) {
  return results.groups.find((entry) => entry.category === category);
}

function titles(results: SearchResults, category: SearchCategory): readonly string[] {
  return group(results, category)?.results.map((result) => result.title) ?? [];
}

describe('FR-09 global search · matching', () => {
  it('finds a property by name and links to its detail page', () => {
    const results = searchService.search('compton', asOf);
    const match = group(results, 'properties')?.results[0];

    expect(match?.title).toBe('166 Compton Rd, Woodridge');
    expect(match?.href).toBe(`/properties/${PROPERTY_IDS.comptonRd}`);
  });

  it('finds a property by a part of the address that is not in its name', () => {
    expect(titles(searchService.search('4133', asOf), 'properties')).toEqual(['Lot 12, Logan Reserve']);
    expect([...titles(searchService.search('qld 4110', asOf), 'properties')].sort()).toEqual([
      '20 Benton St, Acacia Ridge',
      'Watson Rd, Acacia Ridge',
    ]);
  });

  it('finds a tenant by name and links to their lease on the leases screen', () => {
    const match = group(searchService.search('nguyen', asOf), 'tenants')?.results[0];

    expect(match?.title).toBe('A. Nguyen');
    expect(match?.subtitle).toContain('166C-R3');
    expect(match?.href).toBe(`/leases?lease=${match?.id}`);
  });

  it('finds a tenant by the billing reference on their lease', () => {
    const found = group(searchService.search('20B-WH', asOf), 'tenants')?.results ?? [];

    // The current lease and the earlier one share the prefix; the live tenancy leads.
    expect(found.map((result) => result.title)).toEqual(['R. Patel', 'C. Doyle']);
    expect(found[1]?.subtitle).toContain('ended');
  });

  it('finds obligations by title and by context', () => {
    const byTitle = group(searchService.search('insurance', asOf), 'obligations');
    expect(byTitle?.results.every((result) => result.title === 'Landlord insurance renewal')).toBe(true);
    expect(byTitle?.results[0]?.href).toBe(`/obligations?obligation=${byTitle?.results[0]?.id}`);

    const byContext = group(searchService.search('terri scheer', asOf), 'obligations');
    expect(byContext?.results.map((result) => result.title)).toEqual(['Landlord insurance renewal']);
    expect(byContext?.results[0]?.subtitle).toContain('Terri Scheer');
  });

  it('finds loans by lender and by facility name', () => {
    const byLender = group(searchService.search('macquarie', asOf), 'loans');
    expect(byLender?.results.map((result) => result.title)).toEqual(['Macquarie · Home loan 4417']);
    expect(byLender?.results[0]?.href).toBe(`/loans?loan=${byLender?.results[0]?.id}`);

    expect(titles(searchService.search('8820', asOf), 'loans')).toEqual(['CBA · Investment loan 8820']);
  });

  it('finds documents by filename', () => {
    const match = group(searchService.search('terri scheer landlord', asOf), 'documents')?.results[0];

    expect(match?.title).toBe('Terri Scheer landlord policy 2026-27.pdf');
    expect(match?.href).toBe(`/documents?document=${match?.id}`);
  });

  it('ignores case and surrounding whitespace, and needs every word to match', () => {
    expect(titles(searchService.search('  WATSON rd ', asOf), 'properties')).toEqual(['Watson Rd, Acacia Ridge']);
    // "compton" and "water" sit in different fields of the same obligation.
    expect(titles(searchService.search('compton water', asOf), 'obligations').length).toBeGreaterThan(0);
    expect(searchService.search('compton zebra', asOf).groups).toEqual([]);
  });

  it('ranks a name that starts with the query above one that merely contains it', () => {
    // "Watson Rd, …" starts with the query; obligations only mention it in context.
    expect(titles(searchService.search('watson', asOf), 'properties')[0]).toBe('Watson Rd, Acacia Ridge');
    expect(titles(searchService.search('cba', asOf), 'loans')[0]).toBe('CBA · Investment loan 8820');
  });
});

describe('FR-09 global search · shape', () => {
  it('caps each category at five results but reports the full match count', () => {
    const obligations = group(searchService.search('compton', asOf), 'obligations');

    expect(obligations?.results).toHaveLength(SEARCH_RESULT_LIMIT);
    expect(obligations?.total).toBeGreaterThan(SEARCH_RESULT_LIMIT);
    searchService
      .search('rd', asOf)
      .groups.forEach((entry) => expect(entry.results.length).toBeLessThanOrEqual(SEARCH_RESULT_LIMIT));
  });

  it('returns groups in display order and omits empty categories', () => {
    const categories = searchService.search('compton', asOf).groups.map((entry) => entry.category);

    // Tenants match on name or reference only, and no loan mentions Compton Rd.
    expect(categories).toEqual(['properties', 'obligations', 'documents']);
  });

  it('returns nothing for an empty, one-character or unmatched query', () => {
    expect(searchService.search('', asOf).groups).toEqual([]);
    expect(searchService.search('   ', asOf).groups).toEqual([]);
    expect(searchService.search('a', asOf).groups).toEqual([]);
    expect(searchService.search('no-such-record-xyz', asOf).groups).toEqual([]);
  });

  it('links every result to its own record, never to a bare list screen', () => {
    const PARAM: Record<SearchCategory, string | null> = {
      properties: null,
      tenants: 'lease',
      obligations: 'obligation',
      loans: 'loan',
      documents: 'document',
    };
    const results = ['compton', 'cba', 'nguyen', 'rates'].flatMap(
      (query) => searchService.search(query, asOf).groups.flatMap((entry) => entry.results),
    );

    expect(new Set(results.map((result) => result.category)).size).toBe(5);
    results.forEach((result) => {
      const param = PARAM[result.category];
      const url = new URL(result.href, 'http://localhost');
      if (param === null) expect(url.pathname).toBe(`/properties/${result.id}`);
      else expect(url.searchParams.get(param)).toBe(result.id);
    });
  });

  it('serves the same results through the module API for the current user', () => {
    expect(searchApi.search({ q: 'macquarie' })).toEqual(searchService.search('macquarie', asOf));
  });
});

describe('FR-09 global search · NFR-01 / UAT-04 permissions', () => {
  it('hides properties outside a delegate’s grant, and everything tied to them', () => {
    const delegate = accessService.scopeFor(USER_IDS.mahvish);
    const results = searchService.search('watson', asOf, delegate);

    // The owner sees Watson Rd as a property, in obligations and in documents.
    expect(searchService.search('watson', asOf).groups.length).toBeGreaterThan(0);
    expect(results.groups).toEqual([]);
  });

  it('still lets the delegate find records on their assigned properties', () => {
    const delegate = accessService.scopeFor(USER_IDS.mahvish);
    const results = searchService.search('compton', asOf, delegate);

    expect(titles(results, 'properties')).toEqual(['166 Compton Rd, Woodridge']);
    expect(titles(results, 'obligations').length).toBeGreaterThan(0);
  });

  it('omits the loans category for a role without loan.read', () => {
    const delegate = accessService.scopeFor(USER_IDS.mahvish);

    expect(group(searchService.search('cba', asOf), 'loans')).toBeDefined();
    expect(group(searchService.search('cba', asOf, delegate), 'loans')).toBeUndefined();
  });

  it('limits a family contributor to obligations that are not tied to a property', () => {
    const contributor = accessService.scopeFor(USER_IDS.hassan);

    expect(searchService.search('compton', asOf, contributor).groups).toEqual([]);

    const landTax = searchService.search('land tax', asOf, contributor);
    expect(landTax.groups.map((entry) => entry.category)).toEqual(['obligations']);
    expect(titles(landTax, 'obligations')).toEqual(['Land tax assessment']);
  });

  it('returns nothing at all to the technical operator', () => {
    const operator = accessService.scopeFor(USER_IDS.operator);

    expect(searchService.search('compton', asOf, operator).groups).toEqual([]);
    expect(searchService.search('macquarie', asOf, operator).groups).toEqual([]);
  });
});
