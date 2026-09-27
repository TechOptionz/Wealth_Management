# Module: sales

**Responsibility** — the unit register, sale contracts, deposits in trust,
settlement receipts, other income and sales commission. Covers YLD01–YLD06,
REV01 and the settlement tax rule CAL12, and is the revenue source the project
model reads.

**Key rules**
- **Status is derived (YLD03).** `salesStatusOf(unitId)` is the state of the
  unit's latest contract, or `available`. The contract price is that
  contract's consideration. Neither is stored on the unit.
- **Actual events are stored, forecast events are computed.** Deposits held,
  releases, settlements and refunds that happened are records in
  `sales.revenue-events`. `forecastRevenueEvents(projectId, resolver)`
  derives everything expected on read, so a moved milestone or a new price
  moves the forecast with nothing to resynchronise.
- **Deposits in trust are restricted cash (YLD04, AT12).** `deposit-held` is
  `restricted: true`; only `releaseDeposit` (reason = the permission relied on,
  never more than is held) or settlement moves it. At settlement any deposit
  still in trust is released and applied to the price.
- **Settlement uses the finance engine (F09).** Cash to seller =
  consideration + adjustments − deposits applied − withholding
  (`settlementReceipt`). The event's `tax` is the output GST; `withholding`
  is carried on the event as a credit — never an expense, never deducted
  twice (CAL12). Withholding defaults to the GST inside a standard-rated
  price (reviewed default).
- **A contracted price changes only by variation (YLD02).** `updateUnit`
  refuses a price change on a contracted unit; `bulkPriceChange` skips and
  lists contracted units unless `viaContractVariation`, which records the
  variation on each contract. `varyContract` is the single-unit path.
- **Per-m² pricing names its area (YLD02).** `saleableAreaBasis` decides
  whether external area (balconies, courtyards) is priced.
- **Commission is one obligation per contract (YLD05).**
  `commissionObligations` is derived from the rule and keyed by contract id;
  recalculating cannot duplicate it. A cancelled contract's commission is
  reversed, or retained if the rule says so and it had already fallen due.
- **Cancellation removes only that contract's forecast.** Receipts and the
  refund of any deposit in trust stay on record (YLD06).
- **The Yield total reconciles (YLD06).** `yieldSummary.totalGrossRevenue` is
  Σ settlement cash + withholding + deposits applied over non-cancelled
  units, actual and forecast — equal to Σ contract prices plus uncontracted
  forecast prices. Seed: $6,880,000 townhouses + $36,000 cages.
- **Other income (REV01).** One-off lines on their date; recurring lines on
  the 15th of each month from start to end (CAL04), each with tax by its
  explicit treatment.

**Owns** — `RevenueGroup`, `Unit`, `SaleContract`, `RevenueEvent` (actual
only), `OtherIncome`, `CommissionRule`.

**Read by other modules** — `listUnits`, `salesStatusOf`,
`actualRevenueEvents`, `forecastRevenueEvents`, `commissionObligations`,
`yieldSummary`, `revenueGroupsForNav`.

**Depends on** — `access`, `projects` (guard, revision, policy tax rate),
`programme` (milestone dates for settlement timing, clone mapping).

**Permissions** — reads need `financials.read`; an investor is refused units
and contracts. Purchaser references are returned only to people with
`sales.edit`. Writes need `sales.edit`.

**Screens** — `/projects/[projectId]/yield`, `/projects/[projectId]/revenue`,
`/projects/[projectId]/revenue/[groupId]`.

**API** — `POST /api/v1/projects/{id}/units/import`,
`POST /api/v1/units/{id}/contracts` (both need `Idempotency-Key`).

**Not in this build** — margin-scheme sales (refused until finance review,
CAL11); contract documents and buyer identity records; deposit bonds and
guarantees; a CSV parser for the import (the endpoint takes JSON rows);
re-offering a cancelled unit in the forecast (it is excluded until a new
contract is recorded).
