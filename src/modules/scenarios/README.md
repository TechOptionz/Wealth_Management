# Module: scenarios

**Responsibility** — controlled alternatives to the current model: create,
calculate, compare, stress and publish. Covers SCN01–SCN06 and F08.

**Key rules**
- **Pinned base (SCN01).** A scenario stores the id of the calculation run it
  was forked from. Its figures are that run's frozen input plus the scenario's
  overrides, so recorded actuals inside a scenario can never change.
  A seeded scenario pins the current model on its first calculation.
- **Forecast only (SCN02).** Overrides touch unsold prices, eligible remaining
  costs (the uncommitted allowance, optionally unbilled commitments), open
  milestone dates, facility rates, extra equity and GST assumptions. Settled
  cash and signed contract prices are excluded by the model itself.
- **Explicit refresh (SCN04).** New actuals arrive only by `refresh`, which adds
  a version and says whether the actuals cutoff moved. Overnight changes never
  alter an existing comparison.
- **Publication (SCN05).** Needs `scenario.publish`, a reason and an up to date
  base; a stale base is a `ConflictError`. Each promoted change goes through its
  owning module (budget adjustment, bulk price change, milestone move, rate
  step, policy version), so locks and audit apply as for a manual edit. Extra
  equity and uplifts on contracted commitments are listed as *not promoted*.
- **Comparison (SCN03).** Current model plus at most three scenarios; money
  variance is scenario minus current, ratios in percentage points, dates in
  days, each with an arrow and the word favourable/adverse.
- **Sensitivity (SCN06).** At most 9 × 9 cells, computed without storing, each
  on the same base; two cost drivers or two rate drivers cannot be paired.

**Owns** — `Scenario`, `ScenarioVersion`.

**Depends on** — `project-model`, `projects`, `budgets`, `programme`, `sales`,
`funding`, `access`.
