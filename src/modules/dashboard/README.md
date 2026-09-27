# Module: dashboard

**Responsibility** — the portfolio read model. Covers FR-09 and implements BR-01
and BR-02.

**Key rules**
- **BR-01** — net worth = included asset interests − included liabilities, always
  at a stated as-of date.
- **BR-02** — look-through consolidation. Each property is counted once at the
  owning entity's share; an entity's equity is never added on top of the assets
  it already holds. Ownership claims are *direct* by design: a shareholder does
  not inherit a claim on the company's properties.
- Debt is attributed to the entities named as borrowers, split evenly across
  them, so every facility appears exactly once across all positions.
- Deltas compare against the most recent `PortfolioSnapshot` rather than
  recomputing history, so a restated valuation cannot silently rewrite a
  previously reported movement.
- An unallocated ownership share is simply not counted — the platform never
  assumes ownership it has not been told about.

**Owns** — `PortfolioSnapshot` only. Everything else is composed.

**Depends on** — `entities`, `properties`, `loans`, `leases`, `obligations`,
`reconciliation`. **All dependency arrows point into this module; it exports to
none of them.** That is what keeps the graph acyclic.

**Scope switching (FR-09)** — `/dashboard?entityId=<id>` narrows net worth,
assets, liabilities, stale valuations and the ownership view to one consolidated
entity's attributed share. `dashboardService.resolveScope` maps an unknown or
non-consolidated id to the whole portfolio. Snapshot movement is `null` when
scoped, because snapshots are portfolio-wide. Cash flow, arrears, obligations and
the attention strip carry no entity dimension and stay whole-portfolio; the page
says so in a banner. The `/api/dashboard*` routes accept the same `entityId`.

**Notifications** — `notifications.ts` exports `getNotifications(asOf, scope)`, the feed
behind the top bar's bell: overdue rent, overdue obligations, obligations due
within 14 days, and one rolled-up reminder for unmatched bank rows. Derived on
read and permission-filtered the same way search is. Wire types live in
`shared/types/notifications.ts` because the shell may not import a module.

**What-if scenarios (FR-11)** — `scenarios.ts` answers "what happens to monthly
cash flow if rates rise or a property falls vacant?". `scenarioInputs(asOf)`
gathers the baseline (the latest posted month, BR-03), the variable-rate
liabilities and each rented property's live monthly rent; `applyScenario` in
`scenario-math.ts` is the pure arithmetic and the only place it lives, so the
`ScenarioDrawer` re-runs it in the browser on every click while the JSON route
and the tests run the same function on the server. A rate shock touches variable
liabilities only — a fixed rate is a contract until review, and a receivable is
money owed *to* the portfolio. A vacancy removes the property's whole
monthly-equivalent rent. Interest is one month of simple interest on the current
balance; nothing is re-amortised and nothing is stored.

**Not yet implemented** — scope switching by property/period, entity-scoped
drill-down ("Explain this total" is withheld on scoped tiles), snapshot creation
on period close.
