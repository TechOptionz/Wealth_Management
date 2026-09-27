# Module: commitments

**Responsibility** — suppliers, contracts (commitments) and their variations
for a Development Finance project: CST03 (commitments split across cost
lines), CST04 (variations as separate records) and the commitment side of the
CST05 contract position. Invoices, payments and the gross position itself live
in `invoices`, which depends on this module.

**Key rules**
- **Amounts are net, ex GST.** `originalAmount`, stage amounts, allocation
  amounts and variation amounts are all tax-exclusive. The `invoices` module
  grosses them up with the commitment's `taxTreatment` when it shows the
  CST05 position on one gross basis.
- **Σ allocations = contract value, exactly (CST03).** `createCommitment`
  refuses an unbalanced split with a field error, and Σ stages must balance
  too when stages are recorded. Every allocation must name an active posting
  line of the same project (`budgetsService.requireCostLine`).
- **A draft is not an obligation.** Only `authorised` (and later `closed`)
  commitments appear in `allocationsByLine`; authorising is audited.
- **Variations change nothing until approved (CST04).** `revisedValue` is
  original + approved variations; `pendingVariationsTotal` is the submitted
  risk shown separately. The submitter may not approve their own variation
  (IAM04); rejection needs a reason.
- **Per-line shares use `allocateResidualToLast`.** Approved variations land
  where they were allocated, or follow the contract's own split when they name
  no line; the residual cent goes to the last line so shares sum to the
  revised value.
- **Every write bumps the project model revision** (`projectsService.
  bumpRevision`, CF07) and appends an audit event. `createCommitment` accepts
  an `expectedRevision` for optimistic concurrency.

**Owns** — `Supplier`, `Commitment` (with `CommitmentStage`,
`CommitmentAllocation`), `Variation`. Collections `commitments.suppliers`,
`commitments.commitments`, `commitments.variations`.

**Depends on** — `access` (audit, users), `projects` (guard, revision,
mutability), `budgets` (cost line lookup — read only).

**Depended on by** — `invoices` (supplier names, commitment remaining,
contract position), `project-model` (★ `revisedValue`,
`pendingVariationsTotal`, `allocationsByLine`).

**Read model contract (★ consumed by project-model)**
- `revisedValue(commitmentId): Money` — net.
- `pendingVariationsTotal(commitmentId): Money` — net, submitted + draft.
- `allocationsByLine(projectId): ReadonlyMap<CostLineId, CommitmentLineShare[]>`
  — net share of each authorised commitment's revised value per line.

**Not in this build** — contract document storage (only `attachmentName` is
kept), stage certification workflow, retention terms on the contract (retention
is recorded per approved invoice in `invoices`), purchase orders, cloning of
commitments (`cloneInto` copies suppliers only — contracts do not clone).
