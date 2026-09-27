# Module map

One row per module. Use this to find the owner of a concept before reading any
code.

## Feature modules

| Module | Owns (aggregates) | Requirements | Depends on | Screen |
| --- | --- | --- | --- | --- |
| `access` | `User`, `AccessGrant`, `AuditEvent`, `ContinuityPosture` | NFR-01, NFR-03 | — | `/access` |
| `entities` | `Entity`, `Relationship`, `OwnershipClaim` | FR-01, BR-02 | `access` | `/entities` |
| `properties` | `Property`, `Valuation`, `PropertyComponent` | FR-02 | `entities` | `/properties`, `/properties/[id]` |
| `loans` | `Loan`, `Repayment`, `LoanSecurity`, `DebtAllocationPolicy` | FR-03, FR-11, BR-04 | `properties`, `entities` | `/loans` |
| `leases` | `Tenant`, `Lease`, `RentCharge`, `RentAllocation` | FR-05, BR-05 | `properties` | `/leases` |
| `shared-bills` | `SharedBill`, `AllocationAgreement`, `BillShare` | FR-07 | `properties`, `leases` | `/shared-bills` |
| `expenses` | `Expense`, `ExpenseRevision`, `ExpenseAllocation` | FR-04 | `access`, `entities`, `properties` | `/expenses` |
| `obligations` | `Obligation`, `ReminderPolicy`, `ReminderEvent` | FR-03, FR-08 | `access` | `/obligations` |
| `reconciliation` | `BankImport`, `StagedTransaction`, `PostedCashFlowMonth` | FR-06, BR-03 | `access`, `leases`, `properties` | `/bank-import` |
| `documents` | `DocumentRecord`, `DocumentVersion`, `DocumentLink` | FR-04 | `access` | `/documents` |
| `dashboard` | `PortfolioSnapshot` | FR-09, BR-01, BR-02, BR-03 | all of the above | `/dashboard`, `/explain/[metric]` |
| `search` | nothing — read model; wire types in `shared/types/search.ts` | FR-09, NFR-01 | `access`, `properties`, `leases`, `obligations`, `loans`, `documents` | top bar · `/api/search` |
| `design-system` | reference data only | NFR-07 | — | `/design-system` |

## Who owns which concept

| If you are looking for… | Go to |
| --- | --- |
| Who owns a property, and by how much | `entities` |
| Whether a valuation is stale or eligible for a ratio | `properties` |
| How many rooms are let | `properties` |
| Debt attributed to a property | `loans` |
| Any LVR or gearing ratio | `loans` |
| Whether money lent out is an asset | `loans` (`direction: 'receivable'`) |
| Rent arrears, for anything | `leases` |
| Next rent charge date | `leases` |
| Whether an obligation can be reminded on | `obligations` |
| What closes an obligation | `obligations` (payment evidence only) |
| Match confidence and confirmation | `reconciliation` |
| Monthly cash flow figures | `reconciliation` (`PostedCashFlowMonth`) |
| Document linkage and versions | `documents` |
| A person's display name | `access` (`resolveUserName`) |
| The audit trail | `access` (`record()`) |
| Whether a user may do something | `access/permissions.ts` (NFR-01) |
| A shared bill's 60/40 split | `shared-bills` |
| Whether a cost is recoverable or the owner's | `shared-bills` (`recovered` vs `ownerExpense`) |
| Expense corrections and their history | `expenses` (append-only `revisions`) |
| What sits behind a headline total | `dashboard/explain.ts` (FR-09 drill-down) |
| Permission-filtered CSV export | `dashboard/exports.ts` |
| Reminder idempotency | `obligations` (`buildDispatchKey`) |
| What the top-bar search matches, and who may see it | `search` |
| What the top-bar bell lists, and who may see it | `dashboard/notifications.ts` |
| Net worth, assets, liabilities | `dashboard` |
| Per-entity consolidated position | `dashboard` |

## Shared kernel

| Path | Contents | Notes |
| --- | --- | --- |
| `shared/lib/money.ts` | `Money`, arithmetic, formatting | Integer cents; `money()` rejects non-integers |
| `shared/lib/dates.ts` | `IsoDate` arithmetic and formatting | UTC only |
| `shared/lib/errors.ts` | `AppError` taxonomy | Thrown by services, mapped by `server/http` |
| `shared/lib/result.ts` | `Result<T,E>`, `Available<T>` | `Available` enforces BR-04 |
| `shared/lib/money.ts` → `allocateMoney` | Largest-remainder split | Enforces BR-06 rounding at allocation boundaries |
| `shared/types/amounts.ts` | `AmountBasis`, `DatedEntry` | BR-06: actual/forecast/estimated; effective vs posted date |
| `modules/access/permissions.ts` | `Capability`, `AccessScope` | NFR-01: deny by default |
| `shared/types/common.ts` | Branded ids, `Provenance`, `Tone` | No module imports allowed here |
| `shared/config/app-config.ts` | As-of date, currency, thresholds | `STALE_VALUATION_MONTHS`, `UPCOMING_WINDOW_DAYS` |
| `shared/config/navigation.ts` | Nav model | Drives sidebar, tab bar, page titles |
| `shared/components/` | Design-system primitives | See below |
| `shared/shell/` | `AppShell`, `Sidebar`, `TopBar`, `TabBar`, `Scrim`, toast + nav context | |

## Shared components

| Component | Design class | Purpose |
| --- | --- | --- |
| `Icon` / `IconSprite` | `svg.i` | 25 symbols, ported verbatim |
| `Chip` | `.chip` | Status — always icon + words (NFR-07) |
| `Card` / `CardHeader` / `CardBody` | `.card` | Surface container |
| `Kpi` / `KpiGrid` / `Delta` | `.kpi` | Metric tiles; one `accent` hero per screen |
| `DataTable` | `table.stack-m` | Collapses to label/value cards ≤840px; optional keyboard-accessible row click |
| `FilterGroup` | `.filter` | Pill filters with `aria-pressed` |
| `Banner` | `.banner` | Inline warn/info notice |
| `Timeline` | `.tl` | Reminder schedules, audit log |
| `Stepper` | `.stepper` | Import wizard progress |
| `Confidence` | `.conf` | Match confidence bar — marks suggestions as suggestions |
| `Avatar` / `OwnerTag` | `.avatar`, `.owner` | People; dashed variant for unassigned |
| `List` / `ListRow` / `DateBox` | `.list`, `.date-box` | Dated list rows |
| `Tabs` | `.tabs` | Underlined tab strip |
| `TextField` / `SelectField` / `FieldGrid` | `.field`, `.fgrid` | Forms with hint and error states |
| `Stack` / `Row` / `Grid` / `Stat` / `Sub` | `.stack`, `.row`, `.grid` | Layout primitives |

## Server infrastructure

| Path | Purpose |
| --- | --- |
| `server/db/collection.ts` | The single data-access seam: the synchronous handle every repository builds on |
| `server/db/unit-of-work.ts` | Per-request snapshot and write journal for the Postgres adapter: `withUnitOfWork()` for route handlers and Server Actions, `loadUnitOfWork()` for pages and layouts |
| `server/db/postgres-storage.ts` | The Postgres backend: one JSONB row per record, tables created and seeded on first use |
| `server/db/memory-store.ts` | The seeded in-process store used when no `DATABASE_URL` is set |
| `server/actions/run-action.ts` | `runAction()` for Server Actions: the shared helper, run inside a unit of work |
| `server/http/respond.ts` | Response envelope; the only file mapping errors to status codes |
| `server/http/route.ts` | `handle()`, `parseBody()`, `parseQuery()` |

## Adding to the map

A new module belongs here the moment it exists. If two modules both want to own a
concept, one of them is wrong — decide which, and record the decision in
`PROJECT_MEMORY.md`.
