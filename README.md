# Holdfast — Wealth & Property Platform

A Next.js + TypeScript implementation of the Holdfast wealth and property
operations platform, built from two sources of truth:

| Source | Governs | Location |
| --- | --- | --- |
| The HTML design prototype | Visual design, layout, interaction | `design/wealth-platform-design.html` |
| The requirements document | Functionality and business rules | `Wealth_Platform_Requirements_Analysis.docx` |

> **Scope:** the requirements document specifies **FR-01–09 plus security and
> audit controls** as the first release; FR-10–12 are Release 2/3. This build
> implements the first-release scope. Requirement-by-requirement status, including
> every gap, is in [`docs/REQUIREMENTS_CHECKLIST.md`](docs/REQUIREMENTS_CHECKLIST.md).
> Where the running app differs from the prototype's illustrative numbers, the
> arithmetic is recorded in [`docs/DESIGN_FIDELITY.md`](docs/DESIGN_FIDELITY.md).

## Quick start

```bash
npm install
npm run dev          # http://localhost:3000
```

```bash
npm test             # 137 tests, incl. the document's UAT-01…07 scenarios
npm run typecheck    # tsc --noEmit
npm run lint
npm run build
```

No environment variables are required to run. Copy `.env.example` to `.env.local`
to change the reporting locale or the as-of date. Values are trimmed and surrounding
quotes are stripped, and an unrecognised `NEXT_PUBLIC_LOCALE` falls back to `en-AU`,
so a value pasted into a hosting dashboard (Vercel, Netlify) cannot fail the build.

## What it does

Ten screens, each backed by its own feature module:

| Screen | Route | Requirement |
| --- | --- | --- |
| Dashboard | `/dashboard` | FR-09, BR-01, BR-02, BR-03 |
| Obligations & reminders | `/obligations` | FR-03, FR-08 |
| Bank import & matching | `/bank-import` | FR-06 |
| Shared bills & recoveries | `/shared-bills` | FR-07 |
| Expenses | `/expenses` | FR-04 |
| Loans & liabilities | `/loans` | FR-03, FR-11, BR-04 |
| Properties & assets | `/properties`, `/properties/[id]` | FR-02 |
| Leases & tenants | `/leases` | FR-05, BR-05 |
| Entities & ownership | `/entities` | FR-01, BR-02 |
| Documents | `/documents` | FR-04 |
| Access & audit | `/access` | NFR-01, NFR-03 |
| Design system | `/design-system` | NFR-07 |
| Drill-down ("explain this total") | `/explain/[metric]` | FR-09 |

A JSON API mirrors the read models under `/api/*` — see
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md#http-api).

## The rules the app enforces

These are load-bearing. They are implemented in types, not just in prose:

- **BR-01 — Net worth carries a date.** Included asset interests minus included
  liabilities, always evaluated at a stated as-of date.
- **BR-02 — Look-through consolidation.** Each asset counted once at the owning
  entity's share. Control relationships (director, trustee, beneficiary, member)
  carry no ownership share, and the domain model *throws* if one is given a share.
- **BR-03 — Cash basis.** Internal transfers and loan drawdowns are excluded from
  cash-flow reporting.
- **BR-04 — Unavailable beats zero.** Ratios return `Available<T>`, so a missing
  or stale valuation renders "Unavailable" and never 0%.
- **BR-05 — Arrears are derived,** never stored: due charges minus allocated
  receipts and approved credits, adjusted for reversals. Future rent is not
  arrears.
- **BR-06 — Rounding is defined at allocation boundaries.** A 60/40 split of any
  amount sums back to that amount exactly. Effective dates are kept separate from
  posting dates, and actual/forecast/estimated amounts stay visibly distinct.
- **FR-07 — A recovered cost is a tenant charge, not an owner expense.** Splits
  come from an approved agreement; an unapproved one blocks the split rather than
  guessing it.
- **FR-11 — A receivable is an asset.** Money lent out is never counted as debt
  or as an expense.
- **FR-03/FR-08 — Evidence closes an obligation; a reminder does not.** An
  obligation without an owner is not eligible for reminders at all.
- **FR-06 — A suggestion is not a posting.** Nothing reaches the ledger without a
  human confirmation, and the raw bank text is never overwritten.
- **NFR-07 — Status is never colour alone.** Every status chip pairs a colour with
  an icon and words.
- **NFR-01 — Deny by default, enforced server-side.** Permissions are checked at
  each module's API, so a direct URL or an export cannot bypass them.
- **FR-08 — Retries never double-send.** Dispatch is keyed on
  obligation-recipient-channel-date and status is rechecked immediately before
  sending, so a paid item cancels rather than sends.
- **FR-09 — Every total can be explained.** `/explain/[metric]` lists the records
  behind a figure and asserts that they reconcile to it.

## Documentation

| Document | Purpose |
| --- | --- |
| [`AGENTS.md`](AGENTS.md) | How to work in this codebase (humans and AI) |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Layers, data flow, dependency rules |
| [`docs/MODULE_MAP.md`](docs/MODULE_MAP.md) | Every module, what it owns, what it depends on |
| [`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md) | What was built, in what order, and what is next |
| [`docs/REQUIREMENTS_CHECKLIST.md`](docs/REQUIREMENTS_CHECKLIST.md) | Requirement-by-requirement status |
| [`docs/DESIGN_SYSTEM_GUIDE.md`](docs/DESIGN_SYSTEM_GUIDE.md) | **Portable design system** — tokens, components, rules and the full stylesheet. Self-contained; reusable in other projects. |
| [`docs/DESIGN_FIDELITY.md`](docs/DESIGN_FIDELITY.md) | Design verification and every divergence, with arithmetic |
| [`PROJECT_MEMORY.md`](PROJECT_MEMORY.md) | Decisions, assumptions, open questions, next steps |
| `src/modules/*/README.md` | Per-module responsibility and rules |

## Tech

Next.js 15 (App Router) · React 19 · TypeScript 5.8 (strict, with
`noUncheckedIndexedAccess`) · Zod 3 for boundary validation · Vitest · no UI
framework — the design prototype's CSS is ported verbatim.
