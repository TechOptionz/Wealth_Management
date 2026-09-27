# Working in this codebase

Guidance for anyone — human or AI — changing this project. It is written to keep
the amount of context needed for a change small.

## Read this much, and no more

To change one feature, you need **three files**, not the whole repo:

1. `src/modules/<feature>/README.md` — what the module owns and the rules it protects
2. `src/modules/<feature>/model.ts` — its types
3. the specific file you are changing

`docs/MODULE_MAP.md` tells you which module owns what. Start there if you do not
already know.

## The layer rule

```
components/  presentation      — no business logic, no data access
service.ts   business logic    — no HTTP types, no React, no storage calls
repository.ts data access      — the ONLY file that touches the collection
model.ts     types + invariants
validation.ts Zod schemas at the boundary
api.ts       transport-agnostic handlers (no NextRequest/NextResponse)
actions.ts   Server Actions    — parse FormData, call the service, revalidate
```

**Server Actions never throw across the boundary.** A thrown error reaches the
client as an opaque digest, which is useless to someone filling in a form. Wrap
the work in `runAction` and return an `ActionResult`; attach `fieldErrors` to a
`ValidationError`'s `details` so the form can mark the offending input:

```ts
throw new ValidationError('Enter an amount greater than zero.', {
  fieldErrors: { amount: ['An expense must be greater than zero.'] },
});
```

Read form values through `@/shared/lib/form-data` — it handles "$1,860.00" and
keeps "empty means absent, not zero" in one place.

Route files in `src/app/api/**` are thin adapters. If a route file contains
business logic, it is in the wrong place.

## The dependency rule

Feature modules may depend on `@/shared/*`, `@/server/*`, and on modules **below
them** in this order:

```
access → entities → properties → loans → leases → shared-bills
                                    ↘ obligations, reconciliation, expenses, documents ↙
                                              dashboard
```

`dashboard` composes everything and is depended on by nothing. If you find
yourself needing an upward import, the logic probably belongs in `dashboard` or
in the page that composes both modules.

## Conventions that matter

- **Money is integer cents.** Use `Money` from `@/shared/lib/money`. Never
  `number` for an amount, never floating-point arithmetic on currency.
- **Dates are `IsoDate` strings** (`"2026-09-06"`), manipulated only through
  `@/shared/lib/dates`. All arithmetic is UTC.
- **Ids are branded** (`PropertyId`, `LeaseId`, …). Use `asId<'Property'>(raw)`
  only at a trust boundary.
- **Ratios return `Available<T>`,** not `number | null`. This forces the caller
  to render "Unavailable" rather than silently printing 0.
- **Derived state is never stored.** Obligation status, lease status, arrears and
  bill splits are computed on read. If you are tempted to cache one, don't — it
  will drift.
- **Splitting money uses `allocateMoney`,** never `amount * ratio` per part. The
  helper assigns leftover cents so the parts sum to the total exactly (BR-06).
- **Every module `api.ts` opens with `accessService.guard(capability)`.** That is
  the enforcement point for NFR-01; a check in a component is not enforcement.
- **Corrections append, they do not overwrite.** Expenses version; reversals are
  new negative allocations; documents are hidden, not deleted.
- **Services throw `AppError` subclasses.** Only `src/server/http/respond.ts`
  knows about status codes.
- **Data access is synchronous; saving is per request.** Repositories read and
  write a snapshot that `withUnitOfWork` (route handlers, Server Actions) loads
  and saves. A page or layout must `await loadUnitOfWork()` before its first
  read, and must not write. See `src/server/db/unit-of-work.ts`.

## Design fidelity

`src/styles/*.css` is ported **verbatim** from
`design/wealth-platform-design.html` and verified byte-identical (348 rule lines).

- **Do not edit the CSS to make a component fit.** Change the component's markup
  to use the existing class names.
- New UI should compose `@/shared/components` — those carry the design system's
  class names. `docs/DESIGN_SYSTEM_GUIDE.md` documents every class, rule and
  token, and ends with an adoption checklist worth running before you ship a screen. If you need a new primitive, add it there rather than styling
  inline in a feature module.
- If you genuinely must change a design token, change it in the design file too
  and record it in `docs/DESIGN_FIDELITY.md`.

## Accessibility is part of the design

- Status is **never colour alone** — every chip takes an icon and words.
- Selection state uses real ARIA (`aria-pressed`, `aria-current`,
  `aria-selected`), not just a CSS class.
- Clickable rows get keyboard handlers and `tabIndex`, which `DataTable` supplies
  when you pass `onRowClick`.

## Adding a feature module

1. `src/modules/<name>/` with `README.md`, `model.ts`, `data/seed.ts`,
   `repository.ts`, `service.ts`, `validation.ts`, `api.ts`, `components/`.
   Import the repository in `src/modules/all-repositories.ts` so a fresh
   database seeds it.
2. Register the screen in `src/shared/config/navigation.ts` — it drives the
   sidebar, the mobile tab bar and page titles.
3. Add the page under `src/app/(app)/<route>/page.tsx` (a Server Component that
   first awaits `loadUnitOfWork()` from `@/server/db/unit-of-work`, then calls
   the service directly).
4. Add route handlers under `src/app/api/<route>/`.
5. Update `docs/MODULE_MAP.md` and `PROJECT_MEMORY.md`.

## Before you call it done

```bash
npm test && npm run typecheck && npm run lint && npm run build
```

**Stop any running dev server before `npm run build`.** Both write to `.next`, and
building over a live server corrupts it — you get `Cannot find module './<n>.js'`
at runtime. Recover with `npm run clean && npm run build`.

The test suite encodes the requirements document's UAT-01…07 acceptance
scenarios. If you change a calculation and a UAT test fails, the calculation is
wrong until proven otherwise — those fixtures are hand-derived, not generated
from the code.

Then update `PROJECT_MEMORY.md` with what changed, what you assumed, and what is
still open. That file is what makes the next session cheap.

## What this build does not do

Seeded sample data (in memory by default; Postgres when `DATABASE_URL` is set,
see `src/server/db/`), no authentication or MFA, no file storage, no reminder
*scheduler* (dispatch logic exists and is tested; nothing runs it), no matching
engine, no CSV parsing, no backups. See `docs/REQUIREMENTS_CHECKLIST.md` for the
complete requirement-by-requirement list — it is deliberately explicit so nobody
has to guess.
