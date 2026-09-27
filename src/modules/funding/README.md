# Module: funding

**Responsibility** — how a Development Finance project is funded: debt
facilities and their dated ledgers, equity participants and capital accounts,
and the versioned distribution waterfall. Covers FIN01–FIN06, EQ01–EQ03,
WFL01–WFL04, CAL15–CAL17 and CAL20 (peak debt, peak equity). Fixtures F06, F10,
F11 and F12 run through this service in `tests/df-funding.test.ts`.

**Key rules**
- **Balances are computed, never stored.** Principal, outstanding capital,
  preferred return and IRR come from dated movements on every read. The
  finance engine does the arithmetic (`runFacilityLedger`, `runWaterfall`,
  `xirr`, `peakBalance`, `accrualScaled`/`postAccrual`); this module only
  chooses which movements go in.
- **Actual and planned are kept apart (EQ02, FIN02).** Both are stored with a
  `basis`. Capital accounts, IRR and "drawn to date" use actuals only. Ledgers
  and `fundingSources` use actuals plus planned movements dated after the
  actuals cutoff. A planned movement inside a closed period is ignored.
- **Closed periods lock actuals (CF06).** An actual dated on or before the
  cutoff gets a `ConflictError`. To fix one, record a `correction` dated today
  with a signed amount and `correctsMovementId`. The original is never edited.
- **Draws respect availability; limits are shown, not hidden (FIN03).** A draw
  outside `availableFrom..availableTo` gets a `ValidationError`. A draw over the
  limit is recorded, audited with a `LIMIT BREACH` warning, and shows as a
  ledger breach. Any breach turns the funding status red.
- **Interest (FIN05).** Interest accrues daily at ACT/365F by default, on the
  balance after that day's movements. It is posted at month end and, if
  capitalised, counts in principal from the next day. It is a finance cost and a
  debt movement, never a supplier payment or revenue (FIN06).
- **Rates are ppm.** Forms say "Annual rate (%)" with the hint "Enter 8.25 for
  8.25%". The text goes through `percentToPpm`, so 8.25 becomes 82 500.
- **Funding order (FIN04).** `fundingSources` gives what can be drawn on a day:
  equity first (sponsor first, then by participation weight, then by id), then
  debt with draw and repayment ranks. `applyFundingOrder` and
  `applyRepaymentOrder` apply the order. Nothing here draws automatically or
  raises a limit or commitment.
- **One waterfall template (WFL01).** The tiers must be, in order: required
  debt, reserve, return of capital, preferred return, residual split. Anything
  else gets `PolicyRequiredError('waterfall-template')`. Preferred return is
  simple ACT/365F interest on outstanding capital and never compounds. Pro-rata
  splits give the leftover cent to the last participant by id.
- **Agreements are versioned and approved (WFL04).** Each version goes draft →
  approved (by someone other than the drafter, with `baseline.publish`) →
  published. `currentWaterfall` is the latest published version; older ones
  stay in history. `distributionPreview` never writes. `recordDistribution`
  writes one movement per component per participant, each carrying the version
  id. It records a person's decision; it pays nobody.
- **Investors see only their own account (EQ03).** `fundingApi.participation`
  is the only handler that `participation.read` can reach. Every other handler
  needs `financials.read` and throws `ForbiddenError` for an investor. Investor
  references are shown only to finance editors and to that investor.

**Seed** — Riverside construction facility: $5.0m senior at 8.25%, capitalised,
available 15 Oct 2026 – 30 Apr 2028. It has one *planned* $1m land-settlement
draw and no actuals. The $27,500 establishment fee is declared on the
facility, so the ledger's fee column shows it. **No fee movement is seeded**:
the FIN-01 budget cost line carries that cash, and a movement would count it
twice. Participants: Esteem (sponsor, $900k committed, $600k paid in) and HSFI
(preferred 8%, $600k committed, $300k paid in). Waterfall v1 was drafted by
Mahvish and approved and published by Jawad, with a $50k reserve and a 70/30
residual split.

**Owns** — `DebtFacility`, `FacilityMovement`, `EquityParticipant`,
`EquityMovement`, `WaterfallVersion`.

**Depends on** — `projects` (guard, revision, period lock, legal entities),
`access` (audit, users), `@/shared/finance-engine`.

**Depended on by** — `project-model` (the ★ members of `fundingService`),
project settings (`listParticipants`).

**Not in this build** — covenants, automatic draws, floating rates, line fees
accrued on undrawn balances, and any waterfall order other than the template.
There are no payments or bank instructions. `updateFacility` changes limits,
dates and state only. A change of terms needs a new facility or a rate step.
