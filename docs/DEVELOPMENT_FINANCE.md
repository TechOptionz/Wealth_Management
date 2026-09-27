# Development Finance — build notes and requirements coverage

Traced against **Development_Finance_Requirements.docx** (v1.0, 27 September
2026). Scope agreed with the product owner: **everything in the document except
the integrations**, which come later. "Integrations" here means the Xero and
MYOB connectors, email invoice capture, automated extraction, webhooks and a
language-model provider.

Status key: **Done** · **Partial** (what is missing is named) · **Deferred —
integration** · **Deferred — later release** (the document itself places it in
R2 or R3 and it is not an integration; noted where we built it anyway).

---

## 1. Where it lives

| Screen (§3.1 order) | Route | Module |
| --- | --- | --- |
| Projects list, setup wizard | `/projects` | `projects` |
| Cashflow | `/projects/[id]/cashflow` (+ `/cashflow/cell` drill-through) | `project-model` |
| Summary | `/projects/[id]/summary` | `project-model` |
| Invoices (register, review, payments & reconciliation, commitments) | `/projects/[id]/invoices` | `invoices`, `commitments` |
| Programme (list, Gantt, move preview) | `/projects/[id]/programme` | `programme` (+ `project-model` for the money) |
| Yield | `/projects/[id]/yield` | `sales` |
| Finance (debt, equity, waterfall) | `/projects/[id]/finance` | `funding` |
| Scenarios (compare, sensitivity, publish) | `/projects/[id]/scenarios` | `scenarios` |
| Reports (+ printable view, signed CSV download) | `/projects/[id]/reports` | `reports` |
| Assistant | `/projects/[id]/assistant` | `assistant` |
| Revenue children / Costs children | `/revenue/[groupId]`, `/costs/[categoryId]` | `sales`, `budgets` |
| Settings (identity, setup checklist, policy, members, lifecycle) | `/projects/[id]/settings` | `projects` |

The sidebar gains a **Development** group: Projects, then the nine items in the
document's order (Agent is **Assistant**), then expandable Revenue and Costs
children generated from the project's revenue groups and cost categories.

The calculation lives in one place: `src/shared/finance-engine/` (pure
formulas) driven by `src/modules/project-model/compute.ts` (the project model).
Every screen, report and Assistant answer reads the same immutable
`CalculationRun`.

## 2. Seed — Riverside Townhomes (§16.3)

Fictional project `RVT-01` on the existing Lot 12, Logan Reserve property, held
by Esteem Development. Start 1 Jul 2026, 24-month horizon, actuals cut off
31 Aug 2026 (policy v2). Eight townhouses (three contracted: TH-01 and TH-02
exchanged with deposits in trust, TH-03 reserved) and two storage cages;
acquisition, holding, professional, construction, statutory, marketing,
commission, operating, contingency and finance cost lines; two baselines
(feasibility superseded, post-tender published); three suppliers; the head
contract with an approved and a pending variation; invoices in every review
state including an exact duplicate, a credit note, a part payment, retention
and an unmatched payment in suspense; a $5.0m senior facility at 8.25%
capitalised; two equity participants with a published waterfall; base, delayed
completion and cost increase scenarios.

The seeded model reports a positive margin and is fully funded; the figures
are produced by the engine, never typed in (§16.3).

## 3. Requirements coverage

### Navigation, visual, accessibility (§3)

| Req | Status | Where / notes |
| --- | --- | --- |
| §3.1 nine items, order, Agent → Assistant, Revenue/Costs children | Done | `shared/config/navigation.ts`, `shared/shell/Sidebar.tsx`, `project-model/navigation.ts` |
| §3.2 tokens | Partial — deliberate | Kept the platform's own light/dark tokens instead of a second palette; see §4 |
| §3.3 context bar, frozen grid, 38% document split | Done | `ProjectContextBar`, `FinanceGrid`, `.doc-split` in `styles/finance.css` |
| UI01 keyboard, focus, semantic tables, dialogs | Partial | Semantic `<th scope>` headers, visible focus, keyboard rows; **in-grid cell editing and multi-cell paste are not built** — edits happen on the cost line and in the batch form |
| UI02 legend; green settled, amber approved unpaid; variance in words | Done | `FinanceLegend`; variance chips say "over/under · adverse/favourable" |
| UI03 WCAG 2.2 AA | Partial | Labels beside colour everywhere; not audited with a tool or screen reader |
| UI04 viewports, 200% zoom, reduced motion | Partial | Responsive rules in `finance.css`; not verified in a browser at each size |
| UI05 loading/empty/saving/invalid/stale/offline/denied states | Partial | Empty, invalid, stale and permission-denied states exist; no offline state |

### Organisations, projects, access (§4)

| Req | Status | Where / notes |
| --- | --- | --- |
| IAM01 organisation, membership, explicit project membership | Done | `projects` — `ProjectAccess`; org admin reads all |
| IAM01 OIDC identity, MFA | Deferred — integration | No authentication exists in the platform yet; persona switcher stands in |
| IAM02 server-side checks on every read/write/export/download/Assistant tool; non-disclosing 404 | Done | `projectsService.guard`; `tests/df-projects.test.ts`, `df-integration.test.ts` (AT01) |
| IAM03 expiry, revocation, suspension take effect at once | Done | `setAccessStatus`, `isLive`; download links recheck access |
| §4.2 permission matrix | Done | `projects/permissions.ts` |
| IAM04 authority is a limit; no self approval | Done | `canApprove`; `invoices` decision rules |
| PRJ01 project fields | Done | `Project` model |
| PRJ02 setup wizard, draft, blocked publication | Done | Step 1 on `/projects`; remaining steps as a checklist in Settings |
| PRJ03 lifecycle, reversible archive, no hard delete | Done | `transition`, `assertMutable` |
| PRJ04 cloning structure vs assumptions | Done (service) | `projectModelService.cloneProject`; **no clone button on a screen yet** |
| PRJ05 versioned baselines | Done | `budgets` — `BudgetVersion` |
| PRJ06 notifications | Partial | Exceptions on Summary and the invoice badge; no per-user email preferences (email is an integration) |

### Cashflow, budgets, commitments (§5)

| Req | Status | Where / notes |
| --- | --- | --- |
| CF01 grid, default Current/Expended, column chooser with tooltips | Done | `CashflowScreen` |
| CF02 Current = EAC, Expended = paid cash, "Actual plus forecast" + cutoff | Done | |
| CF03 posting vs summary rows; filtered views labelled | Done | F02 / AT03 tests |
| CF04 one-off, equal, weighted, milestone, manual; residual to last period | Done | S-curves are explicit weights (R2 presets not built) |
| CF05 drill-through with source, status, date, basis, editable | Done | `/cashflow/cell` |
| CF06 cutoff, period lock, controlled reopen; milestone moves never touch actuals | Done | AT11 |
| CF07 atomic batch, optimistic concurrency, conflict view | Done | Conflict shows both revisions and latest values in the message |
| CF08 available cash and unfunded amount; no balancing loan | Done | F11 / CF08 tests |
| CF09 undo latest unshared batch as a compensating revision | Done | `undoLatestBatch` |
| CST01–CST05 | Done | `budgets`, `commitments` |
| CST06 direct spend: consume allowance vs additional scope | Done | AT05 |
| CST07 retention tranches, fixed amounts | Done | Percentage caps are R2 |
| CST08 contingency paired transfer | Done | |

### Invoices (§6)

| Req | Status | Where / notes |
| --- | --- | --- |
| INV01 PDF/PNG/JPEG, 20 MB, content sniffing, checksum, failed intake | Partial | Metadata, checksum and magic-byte checks; **files are not stored** (no object storage) and no virus scan |
| INV02 email intake | Deferred — integration | Manual entry only |
| INV03 extraction | Deferred — integration | Extraction record is `source: manual`; every field editable |
| INV04 duplicates (exact, checksum, similar) with override/dismiss | Done | AT06 |
| INV05 review screen | Done | Preview panel says files are not stored |
| INV06 split across lines, stages, tax codes; ≤1 cent rounding | Done | |
| INV07 validation incl. credit notes, due-date warning, closed period review | Done | |
| §6.3 three status fields | Done | Sync state is always "Not queued · no connection" |
| INV08–INV12 transitions, policy steps, frozen approved revision, outbox, reasons | Done | Outbox events are `not-configured` |
| INV13 payments, partial, refunds, credits, retention release | Done | AT10 |
| INV14 invoices imported from accounting | Deferred — integration | Reconciliation item kind exists |
| INV15 reconciliation queue | Done | Match / exclude with reason; suspense shown in the grid |

### Programme, yield, revenue (§7)

| Req | Status | Where / notes |
| --- | --- | --- |
| PRG01 list and Gantt | Done | |
| PRG02 FS dependencies with lag, cycle detection | Done | Other dependency types are R3 |
| PRG03 preview financial effect; one revision per move | Done | Move form shows profit, finance cost, peak debt, funding gap, completion before/after |
| PRG04 timing mode per line and sale; breaking a link needs a reason | Done | |
| YLD01–YLD06, REV01 | Done | AT12 deposits in trust; F09 withholding |

### Finance, equity, waterfall (§8)

| Req | Status | Where / notes |
| --- | --- | --- |
| FIN01–FIN06 | Done | Senior debt, manual and model-generated draws, ACT/365F daily interest, breaches visible. Covenants not calculated |
| FIN02 ranked facilities, fees, capitalised interest | Done (beyond R1) | Variable rates by rate steps |
| EQ01–EQ03 | Done | Investor sees own participation only |
| WFL01–WFL04 | Done (R2, built) | Only the pilot template; any other order is refused. No UI to draft a new version |

### Scenarios, summary, reports (§9)

| Req | Status | Where / notes |
| --- | --- | --- |
| SCN01–SCN05 | Done | AT16 |
| SCN06 sensitivity | Done (R2, built) | Max 9 × 9 |
| SUM01–SUM03 | Done | Chart has a table alternative |
| RPT01 seven report templates | Done | |
| RPT02 CSV + printable view | Done | PDF/XLSX are R2 and not built |
| RPT03 jobs, expiring links, repeatable, safe retry | Done | Generated in the request, no background worker |
| RPT04 comments on snapshots | Done | Attachment names only; scheduled email is R3 |

### Assistant (§10)

| Req | Status | Where / notes |
| --- | --- | --- |
| AI01–AI03 read-only, cited, permission-checked tools | Done | Deterministic routing; **no language model** |
| AI04 extraction proposals | Deferred — integration | |
| AI05 change proposals | Deferred — later release (R3) | Commit route refuses |
| AI06 prompt-injection resistance | Done | AT19 |
| AI07 no secrets in context, org switch | Done | `ASSISTANT_DISABLED`; bank-like digits masked |
| AI08 request log, clear insufficient-evidence answer | Done | |

### Calculation contract (§11)

| Req | Status | Where / notes |
| --- | --- | --- |
| CAL01 exact decimal | Done | Integer cents; rates in parts per million; `bigint` intermediates for interest |
| CAL02 half away from zero, residual recorded | Done | |
| CAL03 signs and directions | Done | |
| CAL04 actual dates, 15th-of-month default disclosed | Done | |
| CAL05 immutable runs, stale detection, publish only if current | Done | |
| CAL06–CAL07 cost decomposition, settlement allocations | Done | F03, F03a, F03b, F04 |
| CAL08–CAL12 GST, recoverability, lag, margin scheme disabled, withholding | Done | F01, F09 |
| CAL13 profit and margins | Done | F07 |
| CAL14–CAL17 cash, principal, interest, bounded funding | Done | F06, F11; 100-iteration cap, one-cent tolerance |
| CAL18–CAL20 IRRs and peaks | Done | F05; multiple sign changes flagged |
| F01–F12 golden fixtures | Done | `tests/df-engine-fixtures.test.ts` |

### Data, API, integrations (§12–§13)

| Req | Status | Where / notes |
| --- | --- | --- |
| §12 entity catalogue | Done | Stored as JSONB records like the rest of the platform, not as typed SQL tables |
| DB01–DB03 invariants, atomic writes, projection rebuild | Partial | Enforced in services inside one unit of work; no database constraints or row security |
| API01 `/api/v1`, decimal strings, `request_id` | Done | `server/http/v1.ts` |
| API02 If-Match → 409, validation 400 with field detail | Partial | Status 400 (the platform's existing code) rather than 422 for validation |
| API03 Idempotency-Key | Done | Stored per user; replay returns the stored result |
| §13.2 endpoint catalogue | Done | Connections/webhooks/proposals return a clear refusal |
| INT01–INT07 | Deferred — integration | INT07 CSV payment import with dry run **is** built |

### Architecture and operations (§14)

| Req | Status | Where / notes |
| --- | --- | --- |
| Engine as a standalone package | Done | `src/shared/finance-engine` (a folder, not a separate npm workspace) |
| Background worker | Not built | Calculations and reports run in the request |
| OPS01–OPS04, SEC04–SEC05 | Not built | Deployment concerns, same as the rest of the platform |
| SEC01–SEC03 | Partial | Signed expiring links, formula neutralisation, no bank details from invoices; no object storage or scanning |

## 4. Decisions and deviations

1. **One visual system.** The document proposes a separate dark palette. The
   platform already has a verified light/dark design system; a second palette
   would split it. The workspace layout, density, frozen columns, legend and
   status wording follow the document; the colours are the platform's.
2. **Budgets and commitments are tax-exclusive.** Each line grosses up by its
   own treatment and recoverable percentage. The economic view is gross less
   recoverable GST; payable and remaining cash are gross (CAL06).
3. **Pages calculate but only actions store.** A page render is read-only under
   Postgres, so it shows the deterministic run without storing it; the next
   action, report or API call stores it.
4. **Withholding defaults to the full GST in a sale price** (1/11 at 10%) as a
   reviewed default in the seed; each contract can record its own amount.
5. **Seed prices.** Three townhouses were contracted early at presale prices;
   the five river-frontage units are forecast higher. Chosen so the demo is
   plausible and fully funded; every total is computed.
6. **Validation errors are 400**, matching the rest of the platform, not the
   document's 422. Stale revisions are 409, missing access 404, insufficient
   authority 403.

## 5. Release gates (§15.3)

R1 manual journey acceptance tests covered by automated tests: AT01–AT08,
AT10–AT18 (AT09 needs an accounting provider). AT19 and AT24 (R2) are also
covered. AT20 (keyboard at 200% zoom), AT21 (worker retries) and AT22 (restore)
are not automated. Nothing has been driven in a browser in this session.
