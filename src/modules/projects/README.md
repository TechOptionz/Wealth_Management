# Module: projects

**Responsibility** — the Development Finance organisation, legal entities,
projects, effective-dated project policy and per-project access. Covers IAM01–
IAM04, PRJ01–PRJ05 and the concurrency/period-lock rules CF06 and CF07 that
every other Development Finance module relies on.

**Key rules**
- **Membership is explicit (IAM01).** `scopeFor` returns `null` for anyone
  without a live membership; only an organisation administrator reads every
  project, and then with no grants and no approval authority.
- **`guard` is non-disclosing (IAM02).** No membership → `NotFoundError`, the
  same as an id that does not exist. Member without the permission →
  `ForbiddenError`. Every Development Finance `api.ts` and Server Action calls
  it after `accessService.guard('development.read')`.
- **Authority is a limit, not a role (IAM04).** `canApprove(scope, gross)` needs
  the `invoice.approve` permission *and* a limit at or above the gross value.
  A null limit is no authority, whatever the role. The matrix is
  `permissions.ts`; change it there and nowhere else.
- **Policy is versioned (CAL05).** `newPolicyVersion` appends; nothing edits a
  published version. `policyFor(projectId, on)` picks the version in force.
- **Periods lock at the actuals cutoff (CF06).** Moving the cutoff earlier is a
  reopen: it needs `period.reopen` and a reason, and is audited.
- **Every financial mutation bumps `modelRevision` (CF07).** Callers that pass
  the revision they edited against get a `ConflictError` carrying both numbers
  when it is stale — never a silent last-write-wins.
- **Archived projects refuse financial writes (PRJ03).** `assertMutable`.

**Owns** — `Organisation`, `LegalEntity`, `Project`, `ProjectPolicy`,
`ProjectAccess`, `IdempotencyRecord`.

**Depends on** — `access` (users, audit, platform capability).

**Depended on by** — every other Development Finance module.

**Not in this build** — OIDC identity, MFA enforcement, invitation emails,
session revocation (the platform has no authentication yet; the persona
switcher stands in), project cloning of structure and assumptions (lives in
`project-model`, which can see every module), notification email preferences.
