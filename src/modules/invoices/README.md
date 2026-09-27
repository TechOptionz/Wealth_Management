# Module: invoices

**Responsibility** — the invoice life of a Development Finance project:
document intake, manual capture, review, approval, append-only revisions,
payments and settlements, retention, the reconciliation queue and payment CSV
import. Covers INV01–INV15, CST05 (the gross contract position), CST06, CST07,
CAL03, CAL06, CAL07, INT07 and AT23.

**Key rules**
- **Three status fields (§6.3).** `reviewState` (received → needs review →
  ready → awaiting approval → approved / on hold / rejected, or void) and
  `syncState` (always `not-queued` — no accounting provider) are stored. The
  settlement state (unpaid / part paid / paid / credit due / reconciled) is
  **derived** from settlement allocations on every read; paid means the
  balance is within one cent, never a badge (INV13).
- **Intake checks the bytes, then discards them (INV01).** PDF/PNG/JPEG, 20 MB
  limit (refused outright), the real type read from magic bytes, sha256
  recorded. A mismatch is a visible `failed` intake that can never become an
  invoice. **Bytes are not retained — there is no object storage in this
  build**, so the review screen shows filename, size and checksum with
  "Preview unavailable · files are not stored in this build".
- **Extraction is manual (INV02/INV03 deferred).** Every revision carries
  `extraction: { source: 'manual', confidence: null, fields: {} }` and a new
  invoice goes straight to needs review.
- **Allocations balance (INV06).** Σ net and Σ tax of the allocations equal
  the invoice; a difference of at most one cent is accepted only when passed
  explicitly as `roundingAdjustment` and is recorded on the revision.
- **Validation splits hard errors from review blockers (INV07).** Negative
  amounts, a margin-scheme or missing tax treatment, a summary or foreign cost
  line are refused. An empty coding or a direct-spend row without an
  allowance choice (CST06) keeps the invoice in review. Warnings — due before
  invoice date, future-dated, closed-period — must be acknowledged; the last
  two only by a `payment.record` holder (finance review).
- **Duplicates are layered and computed on read (INV04).** Exact (project +
  supplier + normalised number, same type — credit notes never collide with
  invoices), checksum (same file), similarity (same supplier and gross, dates
  within 7 days). Exact and checksum findings block submission and approval
  until a `payment.record` holder records an override with a reason linked to
  the suspect; a similarity warning needs a reason to dismiss.
- **Approval follows policy (INV09, IAM04).** The step is the highest
  `minimumGross` ≤ gross; authority is `projectsService.canApprove`; the
  submitter may not approve (unless the policy allows self-approval); a two-
  approver step needs distinct people. The same actor repeating the same
  decision on the same revision returns the existing row — no duplicate.
- **Approval is local (INV11).** It freezes the revision, bumps the model
  revision and records an `OutboxEvent` with status `not-configured`. The UI
  says "Approved · not synced · no accounting connection". Payment is never
  inferred.
- **Revisions append (INV10).** A change to any revision field creates a new
  revision; on an approved invoice this is a correction — the approved
  revision stays frozen and keeps counting in `approvedAllocationsByLine`
  until the new one is approved, the invoice returns to needs review, and an
  `invoice.corrected` outbox event is recorded. Comments append.
- **Nothing is deleted (INV12).** Hold, reject, void and duplicate overrides
  need reasons. Voiding a settled invoice (or an applied credit note) is a
  `ConflictError` until a refund or adjustment is recorded.
- **Locked periods (CF06, AT23).** A manual payment dated on or before the
  actuals cutoff is refused. `reversePayment` is the controlled adjustment: a
  new opposite-direction payment dated in an open period (today by default)
  with `reversesPaymentId` and `refund` settlements against the same
  invoices. The original is untouched. Imported payments are the record and
  may carry locked-period dates.
- **Settlement (CAL06/CAL07, CST07).** Types cash, credit, withholding,
  retention-release, refund, other-noncash, each with its own effective
  date. A settlement cannot exceed the unapplied part of its payment or credit
  note. Retention is a fixed tranche of an approved invoice with a release
  condition and forecast date; it is part of the unpaid balance and never
  reduces recognised cost.
- **Reconciliation (INV14, INV15).** An unallocated payment remainder opens an
  `unmatched-payment` item (suspense). Matching all or part of it is a cash
  settlement in the same step; the item closes when nothing is left.
  Exclusion needs a reason. An `external-bill` item records an invoice's
  `externalAuthorisation` separately from local approval.
- **CSV import (INT07).** Columns Date, Amount, Reference, SourceId, optional
  Supplier and Currency. The dry run validates dates, amounts, AUD and
  duplicates by sourceId (existing and within the file) and creates nothing.
  Confirmation creates payments, auto-matches a row whose Reference is an
  approved invoice number of the same supplier with gross within one cent, and
  queues the rest. The result is stored, so a second confirmation returns it
  and creates nothing more.

**Owns** — `InvoiceIntake`, `Invoice`, `InvoiceRevision`, `ApprovalDecision`,
`Payment`, `SettlementAllocation`, `RetentionTranche`, `ReconciliationItem`,
`PaymentImport`, `OutboxEvent`. Collections `invoices.*`.

**Depends on** — `access` (audit, users), `projects` (guards, authority,
policy, revision, period lock), `budgets` (cost lines, read only),
`commitments` (suppliers, commitments, revised value), `reconciliation`
(`csv-parser` helpers only).

**Depended on by** — `project-model`, which reads the ★ contract:
`listInvoices`, `currentRevision`, `approvedRevision`, `duplicateFindings`,
`approvedAllocationsByLine`, `settlementsByInvoice`, `settlementSummary`,
`settledCashByLine` (credit applications excluded — the credit note already
reduces approved cost), `approvedUnpaidByLine` (unapplied credit notes appear
as negative rows), `unmatchedPayments`, `awaitingApprovalCount`,
`contractPosition`.

**Not in this build** — file storage and document preview, email intake and
automated extraction (INV02/INV03), an accounting connection (outbox events
are recorded as `not-configured` and never sent), matching engine beyond the
exact reference + gross rule, multi-currency, and un-releasing a retention
tranche when its release payment is later reversed.
