# Requirements checklist

Traced against **Wealth_Platform_Requirements_Analysis.docx** (v0.1 draft,
6 September 2026), which is the source of truth for functionality.

Status key: **Done** · **Partial** · **Not started** · **Out of scope** (the
document assigns it to Release 2 or later)

Scope note from §2 of the document: the first release is **FR-01–09** plus
security and audit controls. FR-10–12 are Release 2/3 and are correctly *not*
built here.

---

## 1. Core functional requirements (MVP: FR-01–09)

### FR-01 · Entity and relationship register — **Partial**
> Record individuals, companies, trusts and SMSFs as distinct entity types, with
> identifiers, contacts, directors, trustees and beneficiary relationships.
> Relationships shall be dated and linked to supporting documents. Do not require
> a company-only identifier for every entity type.

| Acceptance criterion | Status |
| --- | --- |
| Link a corporate trustee to a trust and an asset without duplicating the asset | ✅ `tests/uat-01-consolidation.test.ts` |
| Inactive relationships remain visible historically | ✅ dated `from`/`to`, never deleted |
| Entity-type-appropriate identifiers (no company-only field for all) | ✅ `descriptor` is free-form per kind |

**Gaps** — contacts and director/trustee *person* records are modelled as
relationships but have no contact detail fields; no entity CRUD UI; documents
link to relationships by id only.

### FR-02 · Assets, ownership and valuations — **Partial**
> Record property address, purchase and settlement costs, ownership interests,
> dwelling/room components and dated valuations with source and confidence. Rooms
> are operational components, not extra property assets. Stale valuations flagged.

| Acceptance criterion | Status |
| --- | --- |
| A property with six rooms appears once in consolidated asset value | ✅ `tests/uat-01-consolidation.test.ts` |
| Partial ownership is reflected | ✅ Watson Rd 50/50 |
| The valuation date is displayed | ✅ on every card and in drill-down |
| Stale valuations flagged | ✅ `tests/uat-07-data-quality.test.ts` |

**Gaps** — **purchase and settlement costs are not modelled** (only valuations);
6 of 7 property-detail tabs are placeholders; no property CRUD.

### FR-03 · Loans and obligations — **Partial**
> Record lender, borrower, balance as-of date, interest rate, repayment type,
> scheduled amount, review date and linked securities. Obligations shall have
> owner, due date, recurrence, amount, evidence and status. Payment evidence
> closes an obligation; a sent reminder does not.

| Acceptance criterion | Status |
| --- | --- |
| A shared loan linked to two properties counts once in total liabilities | ✅ `tests/uat-01-consolidation.test.ts` |
| An unpaid due obligation remains overdue after notification | ✅ status derived from `paidOn`, not from reminders |
| Payment evidence closes; a reminder does not | ✅ `recordPayment` requires a document |

**Gaps** — no loan or obligation CRUD UI; recurrence does not yet expand into
future instances.

### FR-04 · Document and expense records — **Partial**
> Attach invoices, policies, lease files and receipts to the relevant record.
> Expenses shall retain transaction date, amount, currency, category, entity,
> allocation and source. Corrections shall be versioned; deletion must not erase
> audit history.

| Acceptance criterion | Status |
| --- | --- |
| A reviewer can navigate from a report total to its allocated expenses and original evidence | ✅ `/explain/*` + `tests/fr-04-expenses.test.ts` |
| A correction records who changed what and when | ✅ append-only `revisions` |
| Deletion does not erase audit history | ✅ void, never delete |

**Gaps** — **no file upload or storage** (documents are metadata only); no expense
entry/correction UI.

### FR-05 · Leases and payment schedules — **Done**
> Property-level and room-level leases with tenant, dates, rent, frequency,
> effective rent changes and billing reference. Create expected charges from lease
> dates. Amendments must preserve paid history and stop future charges after
> termination. Proration rules require approval.

| Acceptance criterion | Status |
| --- | --- |
| A fortnightly lease generates the agreed due dates | ✅ `generateCharges` runs inside `createLeaseAction`, so a lease cannot exist without its schedule |
| Early termination removes only unearned future charges, leaving receipts intact | ✅ `tests/fr-05-lease-lifecycle.test.ts` — a future charge with a receipt against it is kept |
| Amendments preserve paid history | ✅ `changeRent` reprices only future *unpaid* charges |

Proration remains correctly surfaced as an unapproved policy rather than guessed.

### FR-06 · Receipt reconciliation and arrears — **Partial**
> Import a defined bank CSV, detect duplicate imports, allocate receipts across
> charges. Support partial, combined and advance payments, reversals and unmatched
> transactions. Suggested matches require confirmation. Disputed balances suppress
> collection reminders.

| Acceptance criterion | Status |
| --- | --- |
| $500 charge, $300 receipt → arrears $200 | ✅ `tests/uat-02-reconciliation.test.ts` |
| Importing that receipt twice does not change the balance | ✅ idempotent on `bankTransactionId` |
| A reversal restores the correct outstanding amount | ✅ negative allocation, original retained |
| Suggested matches require confirmation | ✅ nothing posts without a human; confirmation now persists via a Server Action |
| Disputed balances suppress collection reminders | ✅ `tests/uat-03-reminders.test.ts` |

| Import a bank CSV and detect duplicate imports | ✅ `tests/fr-06-csv-import.test.ts` — generic `Date, Amount, Description, Reference` layout; duplicates skipped on date + amount + reference |

**Gaps** — the CSV layout is a generic one, **not a confirmed bank format** (§7);
the matcher is a **heuristic** (billing reference 0.9, tenant/property name 0.6),
not a matching engine; posting rolls into monthly cash flow only and creates no
rent allocations or expenses.

### FR-07 · Shared bills and recoveries — **Done (read path)**
> Allocate utilities or shared costs by approved fixed amount or percentage across
> active leases and retain the agreement and source bill. Separate recoverable
> tenant charges from owner expenses. Recoverability and deadlines are reviewed
> inputs, not conclusions inferred from the transcript.

| Acceptance criterion | Status |
| --- | --- |
| A $200 bill split 60/40 creates $120 and $80 charges | ✅ `tests/fr-07-shared-bills.test.ts` |
| No duplicate owner expense in consolidation | ✅ recovered ≠ owner expense |
| An invalid allocation is rejected | ✅ percentage/fixed validation + reconciliation guard |
| Recoverability is a reviewed input | ✅ `recoveryReviewedOn: null` ≠ "not recoverable" |
| No inferred statutory deadline | ✅ nothing hard-coded |

**Gaps** — creating bills/agreements through the UI; pushing recovered shares into
the lease charge ledger.

### FR-08 · Reminders and escalation — **Partial**
> Configurable notice offsets, recipient, time zone, quiet hours, channel,
> approval and escalation. Before sending, recheck paid/disputed status and
> permissions. Record queued, sent, delivered, failed and cancelled. Retry safely
> using a unique event-recipient-channel key.

| Acceptance criterion | Status |
| --- | --- |
| Paid items cancel queued notices | ✅ rechecked at send time |
| Repeated job execution does not duplicate sends | ✅ `buildDispatchKey`, `tests/uat-03-reminders.test.ts` |
| Failure creates an owner task | ⚠️ failure is recorded; **task creation not implemented** |
| External messages require verified recipients and approved templates | ❌ **not implemented** — no delivery provider |

**Gaps** — **no scheduler actually runs the job**; no email/SMS provider; no
template approval; quiet hours defer but do not requeue.

### FR-09 · Financial dashboard and exports — **Partial**
> Show as-of assets, liabilities, net worth, receipts, cash outgoings, arrears and
> upcoming obligations. Drill-down must explain every total. Filter by authorised
> entity/property/period and show missing or stale data. Exports must apply the
> same permissions as the screen.

| Acceptance criterion | Status |
| --- | --- |
| Dashboard totals reconcile to a seeded test dataset to the cent | ✅ `tests/uat-05-dashboard-fixtures.test.ts` |
| Transfers and duplicate ownership paths do not inflate income or wealth | ✅ same file |
| Drill-down explains every total | ✅ `/explain/*`, 6 metrics, all reconcile |
| Exports apply the same permissions as the screen | ✅ `tests/fr-09-exports.test.ts` |
| Show missing or stale data | ✅ attention strip + caveats on drill-down lines |
| Filter by authorised entity/property/period | ❌ **scope switcher is static** |

Write paths for FR-01–09 are wired: every action button on every screen now calls
a Server Action that validates its input, calls the module service, records an
audit entry and revalidates. `tests/actions.test.ts` covers all of them.

---

## 2. Later releases — correctly out of scope

| ID | Requirement | Release | Status |
| --- | --- | --- | --- |
| FR-10 | Assisted statement analysis (PDF extraction, subscription detection) | 2 | Out of scope. `aiExtractionApproved` exists and defaults to false. |
| FR-11 | Budgeting, lending and scenarios | 2 | Out of scope, **except** its rule "principal lent is a receivable, not a household expense", which is implemented and tested. |
| FR-12 | Extended portfolio and family modules | Later | Out of scope. SMSF is modelled as `manual-summary` and excluded from totals, matching "read-only summaries". |

---

## 3. Business rules — all MVP

| ID | Rule | Status | Evidence |
| --- | --- | --- | --- |
| **BR-01** | Net worth = included asset interests − included liabilities at a stated date; a principal residence is an asset even without rent; only unpaid amounts are liabilities | ✅ **Done** | `tests/uat-01`, `tests/uat-05` |
| **BR-02** | Consolidation picks look-through **or** equity valuation, not both; beneficiary status assigns no percentage; cross-collateral debt needs an explicit allocation policy | ✅ **Done** | `assertShareIntegrity` throws; `tests/uat-01` |
| **BR-03** | Cash flow = receipts − outgoings; transfers and loan proceeds are not income; loan principal is cash out but not interest expense; report cash flow, operating result and tax separately | ✅ **Done** | `financialPosition()`, `tests/br-03` |
| **BR-04** | LVR = debt ÷ eligible collateral; missing denominator returns unavailable, never zero; label single-property and pool LVR separately; display valuation date, debt date and allocation basis | ✅ **Done** | `Available<T>`, `tests/uat-07` |
| **BR-05** | Arrears = due charges − allocated receipts − approved credits, adjusted for reversals; future rent is not arrears; bonds kept separate | ✅ **Done** | `tests/uat-02` |
| **BR-06** | Decimal money with currency codes; rounding defined at allocation boundaries; effective dates separate from posting dates; actual/forecast/estimated visibly distinct; multi-currency deferred | ✅ **Done** | `allocateMoney`, `AmountBasis`, `tests/br-06` |

---

## 4. Non-functional requirements

| ID | Requirement | Status | Notes |
| --- | --- | --- | --- |
| **NFR-01** | MFA for privileged users; deny by default; enforce record/entity permissions server-side across views, search, jobs, downloads and exports | ⚠️ **Partial** | Capability + record scoping **enforced at every module API** (`tests/uat-04`). **MFA not implemented** — no authentication exists. |
| **NFR-02** | Encrypt transport, documents and backups; managed secret store; no raw credentials in records, prompts or logs | ❌ **Not started** | Deployment concern. No document storage exists yet. |
| **NFR-03** | Log edits, approvals, grants, exports and notification events with actor, time and record; protect logs from user modification | ⚠️ **Partial** | `accessService.record()` called by every mutating service and by exports. Log is append-only in the repository but **not access-restricted**. |
| **NFR-04** | RPO 24h, RTO 8h; daily backups; restore test before go-live and quarterly | ❌ **Not started** | Operational. Continuity posture is displayed but not enacted. |
| **NFR-05** | 99.5% availability; notification jobs start within 5 minutes of schedule | ❌ **Not started** | No scheduler or monitoring. |
| **NFR-06** | 5 concurrent users, 50 properties, 250 leases, 100k transactions; p95 < 3s; 10k-row CSV staged < 2 min | ❌ **Not measured** | Postgres persistence now exists (one JSONB row per record, every collection loaded once per request). Not load-tested; the per-request full load will need per-collection or indexed loading before 100k transactions. |
| **NFR-07** | Responsive UI, keyboard access, labelled fields, clear validation, **no colour-only statuses**, Unicode, WCAG 2.2 AA target | ⚠️ **Partial** | Colour-only statuses eliminated; keyboard access on interactive rows; fields labelled; responsive verified. **No formal WCAG audit.** |
| **NFR-08** | Define retention, deletion, export, processor access and data region; never send unapproved documents to a model; test malicious document instructions | ⚠️ **Partial** | Documents are hide-not-delete; assisted extraction is opt-in per document and defaults off. **No retention policy, no prompt-injection tests** (nothing reaches a model yet). |

---

## 5. Mandatory acceptance scenarios (§9)

| ID | Scenario | Status |
| --- | --- | --- |
| **UAT-01** | Joint ownership, corporate trustee, home and two-property secured loan consolidate without duplicate assets/debt | ✅ `tests/uat-01-consolidation.test.ts` (10 tests) |
| **UAT-02** | Partial/advance/combined payments, refunds and duplicate CSV imports reconcile exactly | ✅ `tests/uat-02-reconciliation.test.ts` (9 tests) |
| **UAT-03** | Paid or disputed obligations suppress queued messages; retries produce no duplicates | ✅ `tests/uat-03-reminders.test.ts` (10 tests) |
| **UAT-04** | A delegate cannot retrieve restricted totals through direct URLs, exports, search or document links | ⚠️ `tests/uat-04-permissions.test.ts` (8 tests) — enforced at the module API, so URLs and exports are covered. **Search** is built and permission-filtered per category and per record scope (`tests/fr-09-search.test.ts`, 5 permission tests). **Document links are not built**, so that path is untested. |
| **UAT-05** | Dashboard cash flow and net worth match independently calculated fixtures | ✅ `tests/uat-05-dashboard-fixtures.test.ts` (8 tests) |
| **UAT-06** | Restore the deployment from backup and reconcile record counts and sample balances | ⚠️ **Partial** — records persist in Postgres when `DATABASE_URL` is set, so a provider backup and restore can be exercised; no backup schedule or restore procedure is defined |
| **UAT-07** | Stale valuations, missing due dates and unmatched transactions are clearly flagged | ✅ `tests/uat-07-data-quality.test.ts` (10 tests) |

**137 tests, all passing.** Run with `npm test`.

---

## 6. Explicit exclusions honoured (§2)

Every first-release exclusion in the document is respected: no payment
initiation, trading, payroll, full accounting or tax lodgement, automated legal
advice, tenant portals, raw password storage, autonomous AI actions, or
construction ERP. No automated external valuations or bank feeds.

Per §1, **no unverified rule is encoded**: the 30-day recovery claim is not
hard-coded, no CGT or depreciation outcome is calculated, and recoverability and
deadlines are recorded as reviewed inputs.

---

## 7. Open decisions blocking further work (§10)

These come from the document's own decision register; the platform is built to
accept an answer rather than assume one.

| Decision | Blocks | Current behaviour |
| --- | --- | --- |
| Ownership, trustee treatment and consolidation method | Financial model | Look-through only; equity valuation not offered |
| Rent due-date, proration, credit and dispute rules | Lease implementation | Proration surfaced as unapproved; credits require an approver |
| Recoverable bills, tax/depreciation and bond rules | Activation of those rules | Bond flagged unapproved; no tax estimate produced |
| Bank samples, imports and opening balances | Import design | CSV format undefined, so no parser written |
| Jurisdictions, currencies and financial year | Reporting baseline | AUD only; `CurrencyCode` widens easily |
| Reminder channels, consent, costs and templates | External messaging | Dispatch is idempotent but sends nowhere |
| Cross-collateral allocation policy | Per-property LVR | Withheld as "Pool only · allocation policy needed" |
| Who can see family wealth; emergency handover | Permission setup | Roles implemented per §2 table; emergency access displayed, not enacted |
