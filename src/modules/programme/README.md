# Module: programme

**Responsibility** — the development programme: stages, milestones and tasks,
their planned and actual dates, finish-to-start dependencies with lag, and the
date cascade a move causes. Covers PRG01–PRG04 and is the date authority every
milestone-timed cost line and sales event resolves against.

**Key rules**
- **Dates are calendar dates.** `IsoDate` strings only; no instants, no time
  zones (PRG02). Arithmetic goes through `@/shared/lib/dates`.
- **Actual is a fact, plan is a forecast.** `actualDate` never overwrites
  `plannedDate`. `effectiveDate` (and `dateOf` / `dateResolver`) return the
  actual when recorded, the plan otherwise — that is the date other modules
  link to (PRG04). An actual may be dated inside a locked period; the audit
  entry says so.
- **A move is one revision (PRG03).** `previewMove` computes the whole
  finish-to-start cascade and writes nothing. `applyMove` writes every moved
  date, journals each with the reason, and calls `bumpRevision` exactly once
  for the batch. Nothing half-saves.
- **Blocked means blocked, not skipped.** An item with an actual never moves;
  a date landing in a locked period is refused. Both are returned as `blocked`
  with a reason so the person resolves them explicitly. If the item being
  moved is itself blocked, `applyMove` throws `ConflictError`.
- **A successor moves only when it must.** It shifts to
  `predecessor + lag` only if its planned date would otherwise fall earlier.
  Stages and tasks keep their duration: the start shifts with the finish.
- **No loops.** `addDependency` refuses self-links and any link that would
  let a walk return to its start (`ValidationError`).
- **Descriptive edits and date moves are different paths.**
  `updateMilestone` cannot change `plannedDate`; that goes through
  `applyMove`, so the cascade cannot be bypassed.

**Owns** — `Milestone`, `TaskDependency` (collections
`programme.milestones`, `programme.dependencies`).

**Read by other modules** — `listMilestones`, `effectiveDate`, `dateOf`,
`dateResolver`. Seeded ids are stable (`MILESTONE_IDS` in `data/seed.ts`,
e.g. `ms-riverside-final-settlement`) so seeds elsewhere can reference them.

**Depends on** — `access` (users, audit), `projects` (guard, revision, period
lock, lifecycle).

**Screen** — `/projects/[projectId]/programme`: List and Gantt tabs; a
selected row opens edit, two-step "Move date" (preview, then apply with a
reason), "Record actual" and "Add dependency". Reads need `financials.read`
(an investor is refused); writes need `programme.edit`.

**API** — `PATCH /api/v1/milestones/{id}` (a changed `plannedDate` needs a
`reason`; `If-Match` is the model revision).

**Not in this build** — the *financial* preview of a cascade (the project
model composes cost and revenue effects from the date preview); resource
loading; critical-path highlighting; start-to-start or finish-to-finish links.
