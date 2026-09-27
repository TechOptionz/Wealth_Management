# Module: search

**Responsibility** — global search from the top bar (FR-09). A read model over
other modules' services; it owns no records and has no repository.

**Key rules**
- **Matching** is case-insensitive text. Every word of the query must appear in a
  record's searchable fields, so "compton water" finds the Compton Rd water bill.
  Queries under two characters return nothing.
- **Searchable fields** — properties: name, address · tenants: name, lease
  reference · obligations: title, context label · loans: lender, facility name ·
  documents: filename.
- **Ranking** — primary field starts with the query, then primary field contains
  every word, then matched with the help of a secondary field. Ties keep the
  source module's order; current tenancies come before ended ones.
- **Five results per category** (`SEARCH_RESULT_LIMIT`). `total` carries the
  uncapped count so the menu can say "5 of 12".
- **NFR-01 / UAT-04** — search is named as a route that must not leak. A category
  the caller lacks the capability for is omitted entirely. A restricted scope
  sees only records tied to properties/entities it was granted; a loan needs
  *every* security property in reach, a document *every* property and entity link.
  Records tied to no property (a portfolio-level obligation, an unsecured loan)
  follow the capability alone. Filtering runs **before** ranking and counting, so
  `total` cannot reveal a hidden record.
- `api.ts` does not open with a single `guard()`: no one capability covers five
  modules. It resolves the scope and the service applies each category's own.

**Owns** — nothing. Wire types live in `@/shared/types/search` because the shell
renders them and `shared/` may not import a module.

**Depends on** — `access`, `properties`, `leases`, `obligations`, `loans`,
`documents`. Like `dashboard`, nothing depends on it.

**Surface** — `GET /api/search?q=…[&asOf=YYYY-MM-DD]` →
`{ data: { query, groups: [{ category, label, results, total }] } }`.
UI: `src/shared/shell/GlobalSearch.tsx` (ARIA combobox, 200 ms debounce).

**Where a result lands** — a property opens `/properties/[id]`. Tenants,
obligations, loans and documents have no page of their own, so the link names
the record on its list screen: `/leases?lease=…`, `/obligations?obligation=…`,
`/loans?loan=…`, `/documents?document=…`. Each page reads the parameter and the
screen opens on it — the right filter, the row selected and highlighted, and
scrolled into view (`useScrollToSelectedRow`). A lease opens with its "Record
payment" panel, never "End lease". An unknown id is ignored and the screen opens
as normal. The page keys the screen by the id so a second search on the same
screen re-selects.

**Not done** — no highlighting of the matched text; no fuzzy matching; entities,
expenses and development projects are not searched.
