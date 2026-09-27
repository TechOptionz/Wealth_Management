# Module: budgets

**Responsibility** — the Development Finance cost register: configurable cost
categories, cost lines, budget adjustments (contingency draws, transfers,
scope changes), versioned baselines and forecast batches. Covers CST01, CST02,
CST08, CF03, CF04, CF06, CF07, CF09, PRJ04 (cost register part) and PRJ05.

**Key rules**
- **Every amount is ex GST.** Budgets, rates, adjustments and baselines are
  tax-exclusive. The project model grosses up per the line's `taxTreatment`
  and `recoverablePpm`; `lineSchedule` distributes whatever cents it is given.
- **Only posting rows carry money (CF03, F02).** A summary row (the land
  acquisition parent) reports the sum of its posting descendants and never adds
  its own amount. `postingLines` and `currentBudgetByLine` exclude summaries, so
  summing them gives the project total exactly once. Closed lines stay in
  totals; `listCostLines` includes them unless the caller filters and says so.
- **The current budget is derived (CST08).** `original + Σ adjustments to − Σ
  adjustments from`, recomputed on every read, never stored.
- **Quantity × rate or a direct amount, never both (CST02).** Quantity × rate is
  one exact `mulDivCents` with the quantity scaled to four decimals; the input
  mode is kept in history.
- **Contingency is an explicit allowance (CST08).** A draw is a paired
  adjustment from the allowance to a non-contingency line, so the project total
  does not move; a draw beyond the remaining allowance is refused. Nothing is
  ever a percentage of contingency or of funding inflows.
- **Baselines are immutable (PRJ05, AT02).** Publishing snapshots every posting
  line's current budget, needs a reason, records approver and time and the
  source revision, and marks the previous baseline `superseded` — never edited
  or deleted. `selectedBaseline` is the latest published.
- **Batches are atomic and revisioned (CF07).** `applyForecastBatch` validates
  every edit first (weights total 100%, manual schedules reconcile, no new
  forecast in a closed period, a reason for any budget change), then writes all
  or nothing and bumps the revision once. Budget changes become `manual`
  adjustments. A stale revision is a `ConflictError` whose details carry
  `yourRevision`, `latestRevision` and the latest stored values.
- **Undo compensates (CF09).** Only the author's latest batch, only once, and
  not after a baseline was published on top of it. The original batch stays,
  marked `undoneByBatchId`; the undo is a new batch and a new audit record.
- **Locked periods hold no forecast (CF06).** `lineSchedule` moves anything
  dated on or before the actuals cutoff to the 15th of the next month and counts
  it in `shifted`.
- **Cloning never copies history (PRJ04).** `cloneInto` takes structure and
  assumptions as separate choices; adjustments, baselines and batches are never
  copied.

**Owns** — `CostCategory`, `CostLine`, `BudgetAdjustment`, `BudgetVersion`,
`ForecastBatch`. Seed ids are stable: `cc-riverside-<code>`,
`cl-riverside-<code>`, `bv-riverside-1|2` (`COST_CATEGORY_IDS`,
`COST_LINE_IDS`, `BUDGET_VERSION_IDS`).

**Depends on** — `access` (users, audit), `projects` (guard, revision, policy
and actuals cutoff), `shared/finance-engine` (schedules, exact arithmetic).

**Depended on by** — `project-model` (cash flow, cost position), invoices and
commitments (cost line ids), sales (COMM-01).

**Not in this build** — programme milestones are not passed to the category
screen yet (the page has a TODO for `project-model`), no commitment or invoice
figures on the register (EAC lives in the project model), no drag-to-reorder,
no category editing or deletion.
