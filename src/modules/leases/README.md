# Module: leases

**Responsibility** — tenants, leases, rent charges, receipt allocations and
arrears. Covers FR-05 and BR-05.

**Key rules**
- **Arrears are never stored.** They are derived every time as
  `charges due on or before the as-of date − receipts allocated to those charges`,
  so the figure can always be explained down to an individual charge and receipt.
- A negative outstanding is *credit*, shown as "paid ahead", not as arrears.
- A **disputed** lease pauses reminders but not accrual. Pausing communication is
  not the same as forgiving rent.
- `chargeAnchorOn` is separate from `startsOn` because the rent day is often not
  the commencement day.
- **The tenant statement is derived too.** `leaseLedger(leaseId, asOf)` rebuilds
  the running ledger from charges and allocations on every read: charges and
  reversals are debits, receipts and approved credits are credits, and the last
  line's balance always equals `totalCharged − totalReceived`. It reads the same
  records as `arrearsFor`, so the two agree unless money was received against a
  charge not yet due — the statement shows that as credit, the arrears figure
  leaves it out.

**Owns** — `Tenant`, `Lease`, `RentCharge`, `RentAllocation`, `ArrearsPosition`,
`LeaseLedger` (read model for the statement modal).

**Depends on** — `properties` (property and component labels).

**Depended on by** — `dashboard` (arrears KPI and table), `properties` page
(rent roll, per-property arrears, room table).

**Not yet implemented** — charge generation on lease creation, bond handling
(policy not approved), proration of partial first periods (policy not approved),
rent-increase amendments.
