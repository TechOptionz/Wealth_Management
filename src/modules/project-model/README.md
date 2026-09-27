# Module: project-model

**Responsibility** — compose one project's records into a single calculation
run and serve every figure that is shown for it: the Cashflow grid, the
Summary, drill-through, the programme move preview and the inputs Scenarios,
Reports and the Assistant reuse. Covers CAL01–CAL20 (through the finance
engine), CF01–CF06, CF08, SUM01–SUM03, PRG03 (financial preview), PRJ04
(clone orchestration), FIN04/CAL17 (funding order) and F01–F12 as they apply
end to end.

**Key rules**
- **One formula, one place.** `compute.ts` is pure: `ModelInput` (+ scenario
  overrides) → `ModelResult`. It only calls `@/shared/finance-engine`. Nothing
  else in the app may add up months or derive a KPI.
- **Runs are immutable (CAL05).** `calculate` hashes the input and overrides,
  reuses a matching run, otherwise computes and stores one — and refuses to
  store it if the project's revision moved while it was computing. A run
  carries its frozen input, so scenarios and drill-through replay it exactly.
- **Only posting rows aggregate (CF03).** Summary lines and category groups are
  sums of their posting children; a parent never adds its own amount.
- **Budgets and commitments are tax-exclusive.** Each line is grossed up by its
  own tax treatment and recoverable percentage; the economic view is gross less
  recoverable GST, the gross view is cash. Payable and remaining-cash equations
  are gross (CAL06).
- **Locked periods hold actuals only (CF06).** Forecast amounts dated on or
  before the actuals cutoff move to the first open month and are flagged.
- **Funding is deterministic and bounded (FIN04, CAL17).** Forecast months
  cover a shortfall below the reserve from remaining equity first, then ranked
  debt within availability; cash interest feeds back through the engine's
  facility ledger, iterating at most 100 times to one cent. Anything uncovered
  is an *unfunded* row and a warning — no balancing loan, no invented equity
  (CF08, F11).
- **Restricted trust deposits are memo rows.** They reach unrestricted cash
  only through an explicit release event (YLD04).
- **Not available beats zero.** Margins and IRRs are `Available`/`XirrResult`.
  Equity IRR needs a published waterfall to model the terminal distribution;
  without one it is reported as unavailable.

**Owns** — `CalculationRun`.

**Depends on** — `projects`, `budgets`, `commitments`, `invoices`,
`programme`, `sales`, `funding`, `access`.

**Depended on by** — `scenarios`, `reports`, `assistant`, `dashboard`
(notifications), the project layout (freshness).

**Not in this build** — a background worker (runs are computed in the request;
the seed calculates in well under a second), per-collection loading for very
large projects, S-curve presets (weights are explicit).
