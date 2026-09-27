# Project memory

Running record for future sessions. Read this first; it should let you resume
without re-deriving anything.

**Last updated:** 2026-09-27 (session 5 — Postgres persistence)
**Build status:** 318 tests ✅ (5 need TEST_DATABASE_URL) · typecheck ✅ · lint ✅ · build ✅ · 22 routes live

---

## 1. Where things stand

A Next.js 15 + TypeScript implementation of the Holdfast platform, built against
two sources of truth: `design/wealth-platform-design.html` for design and
`Wealth_Platform_Requirements_Analysis.docx` for functionality.

**Session 1** built the app from the design alone, inferring requirements from
the FR/BR/NFR identifiers the design cites.
**Session 2** received the requirements document and closed the gaps it exposed.

Eleven feature modules, thirteen screens, twenty-one routes, 137 tests.

## 2. What the requirements document changed

This is the most important section for a future session — it records where
inference went wrong.

| Inferred in session 1 | Actually | Consequence |
| --- | --- | --- |
| FR-07 = *unknown* | **"Shared bills and recoveries"** — an MVP requirement | A whole module was missing. Built in session 2. |
| FR-10 = *unknown* | "Assisted statement analysis" (Release 2) | Correctly out of scope |
| FR-11 = "receivable is an asset" | "Budgeting, lending and scenarios" (Release 2); the receivable rule is one acceptance criterion inside it | The rule was right; the scope was much larger |
| FR-12 = did not exist | "Extended portfolio and family modules" (Later) | Out of scope |
| BR-01…BR-05 | Correct | — |
| **BR-06 did not exist** | Money/date discipline rule | Rounding, effective vs posting dates, amount provenance all added |
| NFR-01/03/07 | Correct, but NFR-02/04/05/06/08 also exist | Mostly deployment concerns; documented as not started |

**Lesson for next time:** the design's FR references were reliable for *which*
requirements exist but not for *what they say*. Two of eleven were misread.

## 3. Key decisions, and why

### 3.1 CSS ported verbatim, not reimplemented
348 of 348 rule lines byte-identical to the design. No Tailwind, no token rewrite.
*Why:* only way to guarantee pixel fidelity; future design changes are a one-file
diff against the source.

### 3.2 `Available<T>` instead of `number | null` for ratios
*Why:* BR-04 says "a zero/missing denominator returns unavailable, never zero
risk". A nullable number lets a caller write `lvr ?? 0`. This type makes that
impossible. Still the single most load-bearing type decision in the codebase.

### 3.3 `allocateMoney` uses largest-remainder, not per-part rounding
*Why:* BR-06 requires rounding defined at allocation boundaries "so totals
balance". Naive rounding loses or gains cents on a 60/40 split of an odd amount.
Tested against six awkward divisions.

### 3.4 Permissions enforced at each module's `api.ts`
*Why:* NFR-01 says "enforce server-side across views, search, jobs, downloads and
exports", and UAT-04 tests that a delegate cannot reach totals "through direct
URLs, exports, search or document links". A check in a component is bypassed by a
direct URL; a check per route file means one forgotten file is a hole. The module
API is a single door that pages, JSON routes and exports all pass through.

### 3.5 Exports resolve two permissions, not one
*Why:* "Exports must apply the same permissions as the screen." An accountant
holds `export.create` but not `portfolio.totals.read`, so they can export
expenses and are refused net worth. Holding one right without the other denies.

### 3.6 Corrections append; nothing is overwritten or deleted
Expenses version, reversals are new negative allocations, documents are hidden.
*Why:* FR-04 — "corrections shall be versioned; deletion must not erase audit
history".

### 3.7 Derived state is never stored
Obligation status, lease status, arrears, bill splits, import counters.
*Why:* a stored status drifts the moment a due date passes. Also makes every
figure explainable from its inputs, which FR-09 requires.

### 3.8 Staged transactions and posted cash flow are separate collections
*Why:* an import in progress must never move a historical figure. Also lets the
chart and month KPIs match the design exactly. `postToLedger` is the only bridge
between the two, and it stamps each row `postedAt` so no row crosses twice.

### 3.9 Computed figures over prototype placeholders
Where the prototype's numbers do not reconcile with the records on the same
screen, the app computes and the divergence is documented with arithmetic in
`docs/DESIGN_FIDELITY.md` §3. The requirements document vindicated two of these:
the prototype counts a receivable as debt (contra FR-11) and reports a repayment
split that its own IO facility makes impossible.

## 3.10 The seed is a demonstration dataset, deliberately shaped

Every section now holds enough data to demonstrate its filters and states: 23
obligations, 142 documents, 49 expenses, 11 shared bills, 6 ended leases, 28
audit events, 12 valuations, 12 months of posted cash flow.

**Properties, loans and arrears-bearing leases were left untouched on purpose.**
They drive the figures that match the prototype exactly, and changing them would
silently break that correspondence. If you add to them, expect
`tests/uat-05-dashboard-fixtures.test.ts` to fail — its fixtures are hand-derived,
so a failure there means *update the fixture consciously*, not patch the test.

Two mistakes made while building this dataset, both caught by tests, both worth
avoiding again:

- A "historical" Mians Rd valuation was dated **after** the 2023 purchase price it
  was meant to precede, so `latestValuation` silently picked it up and assets fell
  by $25,000. Valuation history must be dated before the current record.
- Electricity bills were pointed at the 60/40 **water** agreement, whose effective
  period starts 1 July, so every earlier bill showed as blocked. Common-area
  electricity now has its own standing agreement.

## 4. Assumptions still needing confirmation

| # | Assumption | Impact if wrong |
| --- | --- | --- |
| 1 | Only property and receivables are in scope as assets | Net worth is $2,163,300, not the prototype's $4,821,300 |
| 2 | Portfolio LVR uses securing collateral; stale valuations are ineligible | The tile reads "Unavailable" instead of 32.6% |
| 3 | "Due soon" horizon is 14 days for both KPI and list | Now matches the prototype exactly: 7 items · $9,320 |
| 4 | Facility debt splits evenly across named borrowers | Per-entity positions change |
| 5 | Pool allocation stays unapproved, so no pooled per-property LVR is published | CBA-secured properties show a chip instead of a ratio |
| 6 | Repayment principal/interest come from statements, not derivation | Split reads $854/$11,086, not the prototype's $9,140/$2,800 |
| 7 | Counts derive from records rather than the prototype's labels | Now aligned: obligations 23, documents 142, entities 6 |
| 8 | A financial position reports the latest *posted* month, not the current one | August figures shown on a 6 Sep as-of date |

## 5. Known gaps

### Blocked on decisions (see `REQUIREMENTS_CHECKLIST.md` §7)
- Bank CSV format undefined → the parser reads a generic `Date, Amount,
  Description, Reference` layout only; a real bank's export still needs mapping.
- Cross-collateral allocation policy unapproved → every pooled LVR is withheld.
- Proration and bond rules unapproved → surfaced as blocking notes, not guessed.

### Required by the document, not yet built
- **FR-05**: early termination (remove only unearned future charges), effective
  rent changes, charge persistence on lease creation.
- **FR-02**: purchase and settlement costs.
- **FR-08**: no scheduler runs the dispatch job (it runs only from the "Run
  reminder dispatch" button on `/obligations`); no delivery provider; "failure
  creates an owner task" needs a task entity.
- **FR-09**: scope switching by entity/property/period — the sidebar pill is static.
- **NFR-01**: MFA (no authentication exists at all).
- **NFR-02/04/05/06**: encryption, backups, availability, performance benchmarks.
- **UAT-06**: cannot pass without persistence and backups.

### Write paths — now wired
Every action button calls a Server Action. The pattern is one `actions.ts` per
module: parse `FormData` → call the service → record an audit entry →
`revalidatePath`. Actions **never throw across the boundary** — a thrown error
reaches the client as an opaque digest, useless to someone filling in a form — so
they return `ActionResult` with field-level errors instead.

Loans can be added from `/loans` (single-security or unsecured only). Rooms /
components can be added from the property detail's rooms tab. Relationships
(ownership or control) can be recorded from `/entities`. A property's name,
address, status and rental mode can be edited from its detail header. Still
read-only: six of seven property-detail tabs, editing an existing loan, and
editing an entity after creation.

## 6. Non-obvious things worth knowing

- **`createCollection` caches on `globalThis`.** Editing a seed file does **not**
  reseed a running dev server — restart it. This has cost time twice; it looks
  like stale data or a broken calculation.
- **`pkill -f "next start"` does not kill the server.** The process is named
  `next-server`. Use `lsof -ti :3000 -sTCP:LISTEN | xargs kill`. This cost time
  once: new routes appeared to 404 while a stale build was being served.
- **Never run `npm run build` while a dev server is live.** Both write to
  `.next`, and the production build overwrites chunks the running server still
  holds references to. The result is a runtime error like
  `Cannot find module './1331.js'` with a `webpack-runtime.js` require stack, and
  `.next` ends up holding *both* `static/development` and a production
  `server/webpack-runtime.js` — that mixture is the tell. Recovery:

  ```bash
  lsof -ti :3000 -sTCP:LISTEN | xargs -r kill
  npm run clean && npm run build && npm run start
  ```

  Stop the server first, or build into a separate checkout.
- `src/shared/config/navigation.ts` is the single source for the sidebar, mobile
  tab bar and page titles. Adding a screen means one entry there.
- `DataTable` emits each column header as `data-l` on its cells; that attribute
  drives the ≤840px collapse to label/value cards. Omitting a header breaks mobile.
- `UPCOMING_WINDOW_DAYS` in `app-config.ts` drives both the "Due in next N days"
  KPI and the dashboard list. Set it to 24 to reproduce the prototype's four-row card.
- `AS_OF_DATE` defaults to `2026-09-06` so the app reproduces the pinned prototype.
- The June snapshot in `dashboard/data/seed.ts` is set so the *reported movements*
  (+2.1%, $14,200) match the design while absolute totals stay derived.
- `Collection.reset()` is exposed on `leasesRepository`,
  `sharedBillsRepository` and `obligationsRepository` for tests. Add it to others as they gain write paths.
- Tests import from `@/` via the alias in `vitest.config.ts`.
- **Environment values go through `readEnv` in `app-config.ts`.** Hosting
  dashboards store what was typed verbatim: a line pasted from `.env.example`
  arrives as `"en-AU"` with the quotes, an accidental blank arrives as `""`.
  Either reached `Intl.NumberFormat` and threw `RangeError: Incorrect locale
  information provided` during the `next build` prerender (Vercel, 2026-09-27;
  reported on `/access` only because that page rendered first). `resolveLocale`
  now trims, unquotes, validates with `Intl.NumberFormat.supportedLocalesOf`
  and falls back to `en-AU`. A build that fails in "Generating static pages"
  with a `RangeError` is the tell that a config value is malformed.

## 7. Next session — start here

1. **Work the open-decision register** (`REQUIREMENTS_CHECKLIST.md` §7). Nothing
   downstream of those decisions can be built correctly without them.
2. **Close the FR-05 gaps** — termination and rent changes are explicit
   acceptance criteria that currently fail.
3. **Persistence is done** (session 5). Still open there: connect the real
   Supabase URL in `.env.local` and on Vercel, then measure NFR-06; the
   per-request full load will need per-collection loading before 100k rows.

## 8. Change log

| Date | Change |
| --- | --- |
| 2026-09-27 | **Postgres persistence.** `DATABASE_URL` (or `POSTGRES_URL`) switches the app from the seeded in-memory store to Postgres; nothing else changes. Design: the `Collection` seam stays synchronous because services compose reads inside `.map`/`.filter` chains and ~500 test call sites would need `await` otherwise. Instead each request works on a `Snapshot` (`src/server/db/snapshot.ts`) loaded once from one JSONB table (`holdfast_records`: collection, id, position, data) and journalled writes are saved in one transaction when the request ends: `withUnitOfWork()` wraps `handle()` and the new `@/server/actions/run-action` (`runAction` moved there because `@/shared/lib/action-result` is imported by a client component); every page and the app layout `await loadUnitOfWork()` first (read-only, shared via React `cache`). Empty databases seed themselves on first use (`holdfast_collections` records which collections have been seeded, so an emptied collection is not reseeded); `npm run db:reset` drops both tables. The active test persona moved from `globalThis` to an `access.session` record so it persists too. `force-dynamic` on the app layout: every page now renders per request (they were prerendered at build time before). TLS: hosted hosts encrypt with the certificate unverified unless `DATABASE_CA_CERT` is set; Supabase certificates are not publicly signed. Verified: 11 unit-of-work tests on a fake storage, 5 tests against Postgres 16 in Docker, and a dev-server run against Docker Postgres (seeded 419 rows across 25 collections, recorded a payment through the API, read it back from a new request and in psql). **Known limits:** last write wins on the same record across concurrent requests; every request loads all rows, fine for hundreds, not for 100k. Seeding is complete on the first request whatever it loads: `openSnapshot` dynamically imports `src/modules/all-repositories.ts`, a manifest of every repository (add a line there for a new module). **Supabase verified:** the user's Transaction-pooler string (region ap-northeast-2, Postgres 17) is in `.env.local` with the password URL-encoded (it contains `@`); `.env.example` was restored after the user pasted the secret into it. Ran the dev server against it: 25 collections, 419 rows, every count equal to the seed; a payment recorded through the API persisted; `npm run db:reset` then one page load reseeded to exactly 419 rows. Vercel still needs `DATABASE_URL` set and the branch pushed. |
| 2026-09-27 | **Vercel deploy fix.** `next build` failed while prerendering `/access` with `RangeError: Incorrect locale information provided` from `Intl.NumberFormat`. Cause: `NEXT_PUBLIC_LOCALE` was read straight from `process.env`, and a hosting dashboard stores the value verbatim — blank, `"en-AU"` with quotes, or `en_AU` all throw. `src/shared/config/app-config.ts` now exports `readEnv` (trim, strip one pair of matching quotes, blank → unset) and `resolveLocale` (validate with `Intl.NumberFormat.supportedLocalesOf`, fall back to `DEFAULT_LOCALE = 'en-AU'`); `APP_NAME` and `AS_OF_DATE` go through `readEnv` too. 12 tests in `tests/app-config.test.ts`. Verified locally: `NEXT_PUBLIC_LOCALE=en_AU npm run build` now succeeds, all 31 pages. README and `.env.example` document the behaviour. **Open:** the Vercel project's env vars were not inspected — if `NEXT_PUBLIC_LOCALE` is set there, correct or remove it; the fallback only stops a bad value failing the build. |
| 2026-09-20 | FR-02 "Edit property" on `/properties/[propertyId]`: `propertiesRepository.update`, `updatePropertyAction` in `properties/actions.ts` (reads `propertyId` / `name` / `fullAddress` / `status` / `rentalMode`, audits "Property updated · <name>" with a `field: old → new` list of what actually changed, revalidates the literal `/properties/${id}` plus `/properties`, `/dashboard`, `/loans`, `/leases`). In `PropertyDetail` the inert "More actions" ghost button is replaced by an "Edit property" / "Close" toggle (`aria-expanded`) opening an `ActionForm` prefilled from three new props (`name`, `status`, `rentalMode`; the address comes from `title`). Six tests in `tests/fr-02-property-detail.test.ts`, each editing a property it creates so the seed stays intact. **Decisions:** (a) empty name or address is a `ValidationError` with `fieldErrors`; (b) an absent status/mode keeps the stored value, an unrecognised one is rejected by `readChoice`; (c) only those four fields can change — ownership label, holding note, cost basis and consolidation flag are untouched (tested); (d) the unused `Icon` import was dropped from `PropertyDetail`. **Open:** no capability guard on the action (same as the other property actions); switching rental mode does not touch existing components or leases, so a `by-room` property switched to `whole` keeps its rooms; `ownershipLabel` / `holdingNote` / purchase price still cannot be edited; a save with nothing changed still audits ("No fields changed"). Not driven in a browser; not built with `npm run build`. 285 tests. |
| 2026-09-20 | FR-04 "New version" on `/documents`: `documentsService.addVersion({ documentId, note?, sizeMb?, actor })` appends a `DocumentVersion` (number = `versions.length + 1`, `uploadedAt` now, `uploadedBy` actor), audits "Document version added", and leaves every earlier version untouched. `addDocumentVersionAction` in `documents/actions.ts` reads `documentId` / `note` / `sizeMb` and revalidates `/documents`, `/dashboard` and `/properties`. `DocumentsScreen` has a ghost "New version" button beside "Add link" / "Link to record" on every row, opening a third panel kind (`new-version`) with note + size inputs; the header says which version number it becomes. Three tests in the new `tests/fr-04-documents.test.ts`. **Decisions:** (a) no size given = the current size carries forward, rather than a made-up default; (b) a size ≤ 0 is a `ValidationError` with `fieldErrors.sizeMb`; (c) a removed (hidden) document refuses a new version; (d) the form is keyed by document id so typed values do not carry to the next row. **Open:** metadata only — still no file storage; the record's `uploadedOn` / `uploadedBy` stay those of v1, so the "Uploaded" column does not move when a version is added; there is no screen listing a document's full version history (the table shows the count and latest note only); a version cannot be withdrawn. Not driven in a browser; not built with `npm run build`. 279 tests. |
| 2026-09-20 | FR-01 / BR-02 entity breakdown card on `/entities`: `entitiesService.entityHoldings(entityId, asOf, sources)` returns `{ grossAssets, attributedDebt, netEquity, holdings[] }`; new `EntityBreakdownCard` (monogram, name, descriptor chip, three `Stat`s, `DataTable` of holdings linking to `/properties/[id]`) sits above `OwnershipMap`. `EntityList` rows are now selectable (`role="button"`, `aria-pressed`, Enter/Space, a "Selected" chip so it is not colour alone); `EntitiesScreen` holds `selectedEntityId` (defaults to the first entity, survives a filter change). The page precomputes `holdingsByEntity` for every entity. Five tests in `tests/fr-01-entities.test.ts`, hand-derived from the seed (Watson Rd 50/50: $526,000 / $306,200 / $219,800 each). **Deviation from the brief:** the brief's signature was `(entityId, asOf)` inside `entities`, but `entities` sits below `properties` and `loans` (and `properties` already imports `entities`), so the function takes a third `HoldingsSources` argument and `dashboardService.entityHoldings(entityId, asOf)` supplies it. **Decisions:** (a) debt follows the *borrower*, split evenly between consolidated co-borrowers with `allocateMoney` — the same rule as `ownershipPositions`, and a test pins the two together; (b) a holding's `debt` is the entity's borrowed debt secured on that property, pools spread equally only under an `equal-split` policy — so Esteem shows $1,184,000 total but $592,000 on Benton St (the other half is secured on the trust's Compton Rd), and Compton Rd shows $0 for the trust; (c) `grossAssets` is property only, so Jawad's net equity ($219,800) is $120,000 below his figure in the list, which includes the Khalid receivable — the card says "Property interests only". **Open:** the provisional (unapproved) pool split is shown without a "provisional" marker; receivables are not on the card; a non-consolidated entity would show property value but no debt. Not driven in a browser; not built with `npm run build`. 276 tests. |
| 2026-09-20 | Notifications panel on the top-bar bell: new `src/modules/dashboard/notifications.ts` (`getNotifications(asOf, scope = currentScope())`, `NOTIFICATION_WINDOW_DAYS = 14`), wire types in `src/shared/types/notifications.ts`, and `src/shared/shell/NotificationsDrawer.tsx`. Items: one per arrears position (`leasesService.listArrears` — tenant, amount, days late → `/leases`), one per overdue obligation and one per unpaid obligation due within 14 days (→ `/obligations`), and a single rolled-up "N unmatched bank transactions" reminder (→ `/bank-import`). Groups: Action required (`bad`) / Upcoming (`warn`) / Reminders (`info`). `TopBar` owns `isOpen` and the read ids; the bell has `aria-expanded`/`aria-controls`, Escape closes and returns focus to the bell, a click outside closes, and each item is a `next/link`. The `unreadNotifications` prop (hard-coded `3`) is replaced by `notifications`, computed in `(app)/layout.tsx`. Built from `.card`, `.card-h`, `.list`, `.li-main`, `.chip`, `.btn ghost sm`, `.icon-btn` with inline styles for positioning only. Nine tests in `tests/notifications.test.ts`. **Decisions:** (a) it lives in `dashboard` because it composes three modules; (b) permission-filtered like search — a capability gates each source and a restricted scope only sees records on granted properties, so the accountant gets no bank reminder and the technical operator gets nothing; (c) unmatched rows are one item, not one per row, so a large import cannot flood the panel; (d) a third "Reminders" group was added beyond the brief's two, because an unmatched transaction is neither overdue nor upcoming; (e) each item carries a tone chip with icon + word and unread items say "New" in text — never colour alone. **Open:** "Mark all read" is held in React state only, so a full page reload brings the dot back for anything still unresolved; no per-item read/dismiss; items land on the list screen (no per-record URLs exist); disputed arrears are still listed (marked "disputed"); not driven in a browser; not built with `npm run build`. 271 tests. |
| 2026-09-20 | FR-09 "Export CSV" on `/properties`, `/leases`, `/loans`, `/obligations`: new `src/modules/dashboard/table-exports.ts` (`tableExportsService.exportTable(resource, asOf)`, `centsToDollars`, `TABLE_EXPORT_RESOURCES`) and `GET /api/export/:resource` (note: singular `export`; the metric exports stay at `/api/exports/:metric`). Requires `export.create` **and** the table's read capability, audits "Export · <resource> table (permission-filtered)", filename `{resource}-{asOf}.csv`. Each toolbar has an `<a className="btn sm" download>`; on properties, leases and loans the two buttons are wrapped in a `Row` (same reason as the dispatch button). `csvCell` is now exported from `exports.ts`. Eleven tests in `tests/fr-09-exports.test.ts`. **Decisions:** (a) it lives in `dashboard` because it composes four modules; (b) amounts are plain dollars (`1860.00`, negative `-412.50`, absent = empty cell, never `0.00`) so spreadsheets read numbers — unlike the metric export, which writes display strings; (c) rows are narrowed to the scope's properties the way search does (a loan needs every security property), so this is stricter than the list screens; (d) the file holds **every** record, not just the filter currently selected on screen; (e) free-text cells starting with `= + - @` get a leading apostrophe so a spreadsheet cannot run them as a formula; (f) lines end `\r\n` (RFC 4180); (g) the route checks `asOf` is `YYYY-MM-DD` because it lands in a response header. Lease "Balance" is `balanceForLease` (negative = owing); loan "Repayment" is the monthly amount; unsecured loan LVR is empty, other unavailable LVRs carry their reason. **Open:** the button shows for every persona — someone without `export.create` gets the JSON 403 in the browser rather than a hidden button; the older `/api/exports/:metric` route does not validate `asOf`. Not driven in a browser; not built with `npm run build`. 262 tests. |
| 2026-09-20 | FR-05 / BR-05 "Record payment" on `/leases`: `leasesService.allocatePaymentToLease({ leaseId, amount, receivedOn, note?, actor })` sorts the lease's unpaid charges by `dueOn` and applies the payment oldest-first through `recordReceipt`, audits "Rent payment recorded", and returns `{ chargesSettled, remainingBalance }` (balance = `arrearsFor(...).outstanding` as of `receivedOn`). `recordRentPaymentAction` in `leases/actions.ts` parses `amount` via `readAmount`. The lease panel header now has three `aria-pressed` buttons (End lease early / Change rent / Record payment); the amount defaults to the outstanding balance when in arrears, else the scheduled rent. The page passes a new `outstandingByLease` prop. Three tests in `tests/fr-05-lease-lifecycle.test.ts`. **Decisions:** (a) "unpaid" counts every allocation on a charge regardless of date, and includes future charges, so an overpayment flows on to the next charge; (b) anything left after every charge is settled is over-allocated to the last unpaid charge (or the latest charge if nothing is owing) — the same shape as the Williams paid-ahead seed — so money received is never dropped; (c) the service calls `accessService.record` itself, as the brief asked, unlike `terminate`/`changeRent` whose audit lives in the action. **Open:** no `bankTransactionId`, so a manual payment and a later bank import of the same money would double-count; no guard on `/leases` capability; no way to reverse a payment from the UI (`recordReversal` exists). Not driven in a browser; not built with `npm run build`. 251 tests. |
| 2026-09-20 | NFR-01 Access & audit screen was unguarded: `accessApi.getOverview` had no capability check, so the accountant persona could open `/access`, read the people table and audit log, and see the invite form (only the final `inviteAction` submit was refused). Now `getOverview` throws `ForbiddenError` for a caller holding neither `access.read` nor `audit.read`; with `audit.read` alone (technical operator) it returns the audit log only (`people: []`, `continuity: null`). `accessApi.listAuditEvents` guards `audit.read`. `AccessOverview` gained `canSeePeople` / `canSeeAudit` / `canInvite`; `AccessScreen` hides the Invite button and form without `access.write` and the page sends the property list only to someone who can invite. New `ROLE_SUMMARIES` in `access/model.ts` — the role select's hint now states what the chosen role can do. Three tests in `tests/uat-04-permissions.test.ts`. **Decisions:** (a) no single `guard()` on `getOverview` because the screen legitimately serves two capabilities; (b) `ROLE_SUMMARIES` is descriptive text kept by hand beside `ROLE_CAPABILITIES` — change both together. **Open:** the sidebar still lists "Access & audit" for every persona (they get the `AccessDenied` banner); `/obligations` and `/expenses` pages still call `accessService.listAccess()` directly for name lookups; roles remain fixed capability sets — there is no per-person capability picking. Not built with `npm run build` — a dev server was live on :3000. 248 tests. |
| 2026-09-20 | FR-09 global search: new `search` module (`service.ts`, `api.ts`, `validation.ts`, README — no repository or seed, it owns nothing), `GET /api/search?q=…`, and `src/shared/shell/GlobalSearch.tsx` replacing the inert top-bar input. `searchService.search(query, asOf, scope = currentScope())` matches properties (name, address), tenants (name, lease reference), obligations (title, context), loans (lender, facility) and documents (filename); every query word must appear; ranked prefix → primary-field → secondary-field; 5 per category with an uncapped `total`; queries under 2 characters return nothing. The UI is an ARIA combobox (`aria-activedescendant`, listbox → group → option), 200 ms debounce with `AbortController`, arrows wrap, Enter takes the highlighted or top result, first Escape closes and second clears; built from `.search`, `.card`, `.list`, `.li-main`, `.chip`, `.sub` with inline styles for positioning and the active-row `--surface-2` background only. 18 tests in `tests/fr-09-search.test.ts`. **Decisions:** (a) wire types live in `shared/types/search.ts` because `shared/` imports no module; (b) UAT-04 names search, so a category without its capability is omitted and a restricted scope only sees records tied to granted properties/entities (a loan needs every security property, a document every property/entity link), filtered *before* counting — this is **stricter than the list screens**, which do not record-scope at all, so with the persona switcher a delegate sees Watson Rd on `/obligations` but not in search; (c) `searchApi` has no single `guard()` — no one capability spans five modules; (d) the route goes through `searchApi` rather than calling the service directly, to keep the layer rule. **Open:** tenant/obligation/loan/document results land on the list screen (no per-record URLs exist); the dropdown was checked via SSR markup and the live `/api/search`, **not driven in a browser** — keyboard behaviour is untested end-to-end; search stays hidden ≤840px by the design CSS; entities and expenses are not searched. Not built with `npm run build`. 245 tests. |
| 2026-09-20 | NFR-01 test-persona switcher: `accessService.switchUser(userId)` validates the id against `listUsers()`, stores the active id, and audits "Switched user · now acting as X" (actor = the previous user). `getCurrentUser()` and `currentScope()` now resolve the active user, falling back to `CURRENT_USER_ID`. `switchUserAction` in `access/actions.ts` revalidates `('/', 'layout')`. New `src/shared/shell/UserMenu.tsx`: the top bar avatar toggles a `.card` showing name + role chip and the personas (owner, operations delegate, accountant) as submit buttons with `aria-pressed` + tick on the current one; outcome is toasted. Five tests in `tests/uat-04-permissions.test.ts`. **Decisions:** (a) the active id lives in `accessRepository` on `globalThis` (same reason as collections — survives hot reload), so it is **process-wide, not per-browser**: one tester switching switches everyone on that server; (b) `switchUser` requires no capability, otherwise a restricted persona could never switch back — it must be removed or gated when real auth lands; (c) the shell does not import `access`: the layout passes the personas, role label and the action down as props; (d) persona notes (`PERSONA_NOTES`) live in `(app)/layout.tsx`; roles without a note (family contributor, technical operator) are not offered. **Follow-up the same day:** switching to the accountant crashed `/dashboard` with a raw `ForbiddenError` (the guard was right; nothing presented it). Added `shared/components/AccessDenied.tsx` — `AccessDenied` (a warn `Banner`) and `renderGuarded(render)`, which turns a `ForbiddenError` into that banner and rethrows anything else. Used by the three pages that pass a guard: `/dashboard`, `/access`, `/explain/[metric]`. The guarded body is called as a plain function, not rendered as a component, so the throw happens inside the `try`. **Open — important for testers:** only those three pages pass a guard; every other page under `src/app/(app)` calls services directly, so property, lease, expense etc. screens still render everything for any persona. A new guarded page must use `renderGuarded` or it will crash the same way — there is still no `error.tsx`. The sidebar scope label still reads "Whole portfolio" for every persona. The menu is `hide-m` like the avatar it replaced, so there is no switcher on mobile. Not built with `npm run build`. 227 tests. |
| 2026-09-20 | FR-02 purchase price, settlement costs and capital growth: `Property` gained optional `purchasePrice` / `settlementCosts` (`settledOn` already existed); `createPropertyAction` parses both (empty = absent; a price ≤ 0 or negative costs is a `ValidationError` with `fieldErrors`), and the "Add property" form has the two inputs. `propertiesService.capitalGrowth(propertyId, asOf)` returns a `CapitalGrowth` (model.ts): cost basis = price + costs, growth = latest valuation on/before `asOf` − basis, percent = growth ÷ basis; derived on read, nulls when an input is missing. "Cost basis & capital growth" stat block on the Overview tab of `PropertyDetail` (growth green `--good` / red `--bad`, plus "Up/Down x% on cost basis" in words); the page passes `capitalGrowth` and a formatted `settledOnLabel`. Seven tests in `tests/fr-02-property-detail.test.ts`. **Deviations from the brief:** (a) the seed keeps each purchase price equal to the property's existing `purchase-price` valuation and settlement date (Compton 812k + 34.5k, Benton 795k + 33.2k, Watson 640k + 24.8k settled 2019-09-30, Mians 760k + 28k) rather than the brief's "Watson Rd 760k / 2021-03-15" example, which would have contradicted the valuation trail; Logan Reserve has none (under construction, at cost); (b) the return type also carries `settlementCosts` and `settledOn`, which the card needs; (c) `growthPercent` is `number \| null` as the brief specified, not `Available<T>` (§3.2) — it is display-only and feeds no other ratio. **Assumptions:** growth uses the latest valuation even when stale or of `purchase-price` basis, so Mians Rd reads −$28,000 (its settlement costs) until a market valuation is recorded; costs with no purchase price give no basis. **Open:** no way to edit these fields on an existing property; capital growth is not shown on the `/properties` cards or the dashboard; construction cost is not folded into a cost basis for Logan Reserve. Not built with `npm run build`. 222 tests. |
| 2026-09-20 | FR-08 "Run reminder dispatch" on `/obligations`: `runReminderDispatchAction` in `obligations/actions.ts` reads `asOf` (falls back to `resolveAsOfDate()`), calls the unchanged `obligationsService.runReminderJob(asOf)`, counts processed / sent / skipped and skips per reason, audits "Reminder dispatch run · X sent, Y cancelled/skipped" with the reason breakdown in the context, revalidates, and returns "Reminder job completed: X sent, Y cancelled/skipped" with the summary as the value. Inline `ActionForm` button beside "+ New obligation" in `ObligationsScreen`. Four tests in `tests/uat-03-reminders.test.ts` (success + audit, second run sends nothing and reports `already-sent`, an item paid before the run is cancelled not sent, a malformed date fails without throwing). **Deviations from the brief:** (a) the button uses the default variant — `Button` has no `secondary`; (b) the two toolbar buttons are wrapped in a `Row`, because `Toolbar` is `space-between` and a third child would have floated the new button to the middle. **Assumptions:** the job runs at its default hour (8), which is outside quiet hours, so a manual run never reports `quiet-hours`; a malformed `asOf` is a `ValidationError`. **Open:** the counts are per channel, not per obligation (one obligation on two channels counts as 2 sent); the outcome is only a toast + audit entry — no on-screen breakdown of which items were skipped and why; still no scheduler or delivery provider, so "sent" means "recorded as sent". Not built with `npm run build`. 215 tests. |
| 2026-09-20 | FR-03 recurring rollover: `obligationsService.recordPayment` now calls the new `scheduleNextOccurrence`, which inserts the next instance of a `monthly`/`quarterly`/`yearly` obligation (+1/+3/+12 months via `addMonths`) carrying title, context label, property, owner, amount, recurrence and reminder policy; it starts unpaid, undisputed, evidence `none`. `once` schedules nothing. The audit context gains "· next occurrence scheduled for <date>". Three tests in `tests/uat-03-reminders.test.ts` (one-off, yearly rollover, paying twice adds no duplicate). **Decisions:** (a) the next date steps from the *due* date, not the paid date, so a late payment does not drift the schedule; (b) idempotency is a match on title + propertyId + next due date — there is no series id linking instances; (c) `validatedAt`/`validatedBy` are not carried over, so the new instance has no "validated" timeline entry even though its owner makes it reminder-eligible. **Open:** the amount is copied as-is (next year's premium will differ, and nothing edits an obligation yet); two genuinely different obligations with the same title, property and date would be treated as one; seeded paid recurring items have no seeded successor unless the seed lists one. Not built with `npm run build`. 211 tests. |
| 2026-09-20 | FR-04 "Correct expense" on `/expenses`: toggle button in the `ExpenseDetail` card header opens an `ActionForm` wired to the existing `correctExpenseAction` (unchanged) — reason (required), amount, category, description, effective date, prefilled from the current revision. Two tests in `tests/fr-04-expenses.test.ts` (form submit appends v2 and leaves v1 equal to what was entered; an empty reason adds no version). The category option list is now one `CATEGORY_OPTIONS` constant shared by the create and correct forms. **Deviations from the brief:** (a) the button uses the default variant — `Button` has no `secondary`; (b) the void form is hidden while correcting, so the card never shows two "reason" inputs; (c) `ExpenseDetail` is keyed by expense id, otherwise the open form and its prefilled values would carry over to the next row selected. **Open:** the action treats an empty field as "unchanged", so a description cannot be cleared; allocation, basis and evidence cannot be corrected from the form; a correction that changes nothing still appends a version. Not built with `npm run build`. 208 tests. |
| 2026-09-20 | FR-01 "+ Add relationship" on `/entities`: form in `EntitiesScreen` wired to the existing `createRelationshipAction` (unchanged). The page passes `entities`, `properties` and `today`; properties come from `propertiesService` in the page, not the module, because `properties` sits above `entities`. The form renders only one target select (property *or* entity) and renders `sharePercent` only for `owns`, so a control link never submits a share (BR-02) and the action's "exactly one target" rule holds. The subject is excluded from the entity-target list. `tests/fr-01-entities.test.ts` (3 tests). **Addition to the brief:** a `today` prop (`resolveAsOfDate()`, same as shared-bills/expenses) for the "effective from" default — the wall clock could post-date the as-of date and make a new relationship invisible. **Open:** the action does not stop a property being allocated past 100% (the dashboard surfaces the gap but nothing refuses it), does not check the ids exist, and does not bound the share to 0–100; no edit/end-date for a relationship; an entity→entity `owns` is stored and listed but deliberately creates no property claim (no multi-level look-through). Every seeded property is fully allocated, so the success test owns a share of a company instead. Not built with `npm run build`. 206 tests. |
| 2026-09-20 | FR-07 "Post to tenant ledger": `sharedBillsService.postSharesToLeases(billId, actor, postedOn?)` turns each recoverable share into a lease charge (`kind: 'utility'`, due on the bill's due date, description "Water recovery · Urban Utilities", `sourceBillId`), stamps `SharedBill.postedToLeasesOn` and audits. `postBillToLeasesAction`, button / "Charged to lease · date" chip in `BillDetail`, `leasesRepository.addCharge`, `sharedBillsRepository.reset`, three tests in `tests/fr-07-shared-bills.test.ts`. `RentCharge` gained optional `kind`, `description`, `sourceBillId`; absent `kind` means rent. **Knock-on fixes:** a utility charge would otherwise have been treated as rent, so `changeRent` no longer reprices it, `terminate` no longer removes it as unearned, and the dashboard operating-income figure excludes it (a recovery passes a cost through; it is not income). It *does* count towards arrears. **Deviations from the brief:** (a) `billId` is a plain `string` — the module has no branded `SharedBillId`; (b) posting is refused until the recovery review is recorded, because recoverability is a reviewed input, so the button only appears on reviewed bills; (c) a second posting throws `ConflictError` rather than returning 0. **Assumption:** `postedToLeasesOn` uses `resolveAsOfDate()`. **Open:** no way to reverse a posting; the leases screen does not yet label utility charges separately from rent; the charge does not check the lease was active for the bill period (the share definitions are trusted). Typecheck was failing at the time on `entities/components/EntitiesScreen.tsx`, which someone else had mid-edit — not part of this change. 203 tests. |
| 2026-09-20 | FR-06 CSV statement upload on `/bank-import`: `reconciliation/csv-parser.ts` (RFC 4180 split, amounts to integer cents without floats, ISO and DD/MM/YYYY dates), `reconciliationService.createImportFromCsv`, `uploadBankCsvAction` (file wins over pasted text), `UploadStatementForm` + "+ Upload new statement" button, shared `TextAreaField` primitive, `insertImport`/`insertTransaction`/`listAllTransactions` on the repository, `tests/fr-06-csv-import.test.ts` (21 tests). `reconciliation` now depends on `leases` and `properties` (read-only). `latestImport` breaks a same-day tie by insertion order. **Deviations from the brief:** (a) the stage is `'match'` — the model has no `'matching'`; (b) an import with duplicates skipped also opens at `'match'`, not `'duplicates'`, because `postToLedger` refuses anything before `match` and nothing advances the stage, so it would have been a dead end. **Assumptions:** (c) a name match scores 0.6, which equals `HIGH_CONFIDENCE_THRESHOLD`, so it is `auto-matched` and swept by bulk confirm — raise the threshold or lower the score if name matches should need individual review; (d) a lease only matches money coming in, and only if it was running on the transaction date; (e) a file that is entirely duplicates is a `ConflictError` and creates no import; (f) identical rows *within* one file are both staged — two same-day payments are legitimate; (g) `importedOn` uses `resolveAsOfDate()`. **Open:** the "Review skipped rows" link still points nowhere; no OFX; no transfer detection. 195 tests. |
| 2026-09-20 | Added "+ Add room / component" on `/properties/[propertyId]`: `propertiesService.addComponent` (rules + position), `addComponentAction` in `properties/actions.ts` (parses, calls the service, audits, revalidates), `propertiesRepository.addComponent`/`resetComponents`, toggle form above the rooms table in `PropertyDetail`, eight tests in `tests/fr-02-property-detail.test.ts`. A component is operational only — adding one leaves valuation and total assets unchanged (BR-02, tested). **Rules:** a label is unique per property (case-insensitive); at most one `whole` component per property, but a `whole` may sit beside others (Mians Rd + a granny flat is the driving case). **Trap found:** `occupancy` counts any component without `vacantSince` as *let*, so a new room added without it read "7 rooms · 6 let" with no tenant. The form therefore always sends `isVacant=true`; the action only sets `vacantSince` when it receives it. **Deviation from the brief:** revalidates the literal `/properties/${id}` — a `'/properties/[propertyId]'` pattern needs the `(app)` route-group path plus a `'page'` type, and silently does nothing otherwise. **Assumption:** `vacantSince` uses `resolveAsOfDate()`, not the wall clock. **Open:** (a) no edit/remove for components; (b) pre-existing — nothing clears `vacantSince` when a lease is created, so occupancy chips drift from the leases screen (stored state that should be derived; fixing it belongs in `dashboard`, since `properties` sits below `leases`); (c) on `/properties`, a whole-let property with zero rent shows "Lease ended <vacantSince>", which is the wrong wording for a never-let component. Not built with `npm run build` — a server was live on :3000. 200 tests. |
| 2026-09-20 | FR-06 "Post to ledger": `reconciliationService.postToLedger`, `postImportToLedgerAction`, `updateImport`/posted-cash-flow writes/`reset` on the repository, button + banners on `/bank-import`, `tests/fr-06-post-to-ledger.test.ts`. New terminal `ImportStage` `'posted'` (not a stepper step; step 5 shows done). Rows are stamped `postedAt`, so re-posting cannot double-count and a late allocation can be posted on its own. **Assumptions:** (a) any `unmatched` row counts as reviewed — there is no separate "reviewed" flag, so a never-opened unmatched row does not block posting, it just stays unposted; (b) posting adds to the seeded month on top of its existing figures, treating the seed as other accounts' history — after posting, August reads $35,250 in / $34,200.13 out; (c) `loanPrincipalComponent` is not updated. (a) and (b) were confirmed by the owner on 2026-09-20. **Open:** posting rolls into monthly cash flow only — it does not create rent allocations or expense records. 171 tests. |
| 2026-09-20 | Added "+ Add facility" on `/loans`: `loans/actions.ts` (`createLoanAction`), `loansRepository.insert`/`reset`, form in `LoansScreen` (now a client component), `tests/fr-03-loans.test.ts`. A new facility is `single`-secured or unsecured — pools cannot be created from the form. **Assumption:** with no statement yet, the principal/interest split is one month's simple interest on the opening balance, capped at the repayment (IO = all interest); it is a working figure, not the lender's. 162 tests. |
| 2026-09-07 | Session 1: built from the design alone. 9 modules, 10 screens, 16 API routes, full documentation. Design verified byte-identical. |
| 2026-09-08 | Session 4: wired every action button to a Server Action (17 stubs → 0). Implemented the two failing FR-05 criteria — charge generation on lease creation, early termination removing only *unearned* charges, and effective rent changes that never restate paid history. Added `ActionForm`, `ActionResult` and `FormData` parsing helpers. 137 tests. |
| 2026-09-08 | Session 3: filled the seed out into a demonstration dataset — every section and filter now has content. Closed five documented divergences (obligations 23, documents 142, entities 6, unlinked 2, upcoming 7 items/$9,320). Headline figures unchanged and still fixture-tested. |
| 2026-09-07 | Session 2: requirements document received. Added `shared-bills` (FR-07) and `expenses` (FR-04); BR-06 money/date discipline; BR-03 separated reporting; BR-05 credits and reversals; FR-06 duplicate-import protection; FR-08 idempotent dispatch; FR-09 drill-down and permission-parity exports; NFR-01 server-side enforcement. 110 tests including UAT-01…07. Fixed a cash-flow chart anchoring bug the tests exposed. |
