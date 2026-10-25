# MUT-433 — Per-user feature flags, operator-controlled (`agent_access` first)

Epic MUT-432 (bring-your-own-Claude over MCP). Blocks MUT-434 (OAuth), MUT-435 (read tools), MUT-436 (write tools).
Status: planned 2026-10-25, not built.

## Problem

Basel wants to choose, per person, who gets MCP access. There is no per-user flag today:
- firm features are a per-**organization** operator timestamp (ADR-099);
- `EntitlementGrant` is per-user but **billing-tier typed** and read by billing coverage (MUT-358).

## Acceptance criteria (from the ticket)

1. Every flag is off unless an operator grants it; a user with no row has none.
2. The operator can grant and revoke `agent_access` by email (admin route under admin auth + a script); each change is audited.
3. Revoking `agent_access` makes every MCP call by that user fail with 403 immediately and revokes their MCP grants.
4. `agent_access` is granted to sader@basel.ps in prod, as an operator step in `docs/operations/before-release.md`.

Guardrails: purged on account close (MUT-333), OpenAPI updated, API version bump, ADR.

## Decisions

**D1. A new table `user_feature_grants`, one row per user × feature.**
`id`, `userId` (FK → users, `onDelete: Cascade`), `feature` (varchar 64), `grantedBy` (varchar 64, `admin`), `grantedAt`, `revokedAt?`, `@@unique([userId, feature])`, `@@index([feature])`.
Granting again re-opens the row (`revokedAt = null`, `grantedAt = now`). The history lives in `audit_events`, not in extra rows.
- Rejected: a `features String[]` / JSON column on `User`. It can't carry grantedAt/grantedBy, and "who has agent_access" would need a scan.
- Rejected: reusing `EntitlementGrant`. `tier` is a billing enum, and `entitlementsFor` reads every row. A non-billing row there would leak into coverage.

**D2. Feature names are a closed set in code** (`server/src/features.ts`: `FEATURES = ['agent_access'] as const`, plus `isFeature()`). The column stays varchar, so a new flag is a code change with no migration. An unknown name gives `422 VALIDATION_FAILED` with `{ field: 'feature' }`, thrown by the handler through `isFeature()`. The path param is a plain string, because the shared zod `defaultHook` (`app-shell.ts:35-40`) would put `issues` in the details instead (C7). A row for a feature later removed from code can't be revoked through the API; delete it in a migration instead.

**D3. The admin API follows the `/admin/v1/billing/grants` shape**, in `server/src/routes/admin-users.ts` next to disable/enable (eng review D1):
- `PUT /admin/v1/users/{userId}/features/{feature}`: grant. Idempotent. Returns `{ feature, grantedAt, granted: boolean }` (false = it was already on).
- `DELETE /admin/v1/users/{userId}/features/{feature}`: revoke. Idempotent. Returns `{ revoked: boolean }`.
- `GET /admin/v1/features/{feature}`: who holds it now (`[{ userId, email, grantedAt }]`), so the operator can see the pilot list.
- The admin user responses are unchanged (eng review D2: the holders list is the operator view).
- Admin auth comes from the existing `app.use('/admin/*', adminAuth)`. `404` for an unknown user.
- **User state (eng review D5):** a grant to a `PENDING_REVIEW` user gives `409 CONFLICT`, reason `USER_PENDING_REVIEW` (same as the membership grant, `admin-users.ts:345`). Grant and revoke on a `DISABLED` user are allowed; the flag is inert until they can sign in. Revoke is always allowed.

**D4. Audit:** `user.feature_granted` / `user.feature_revoked`, `actorType ADMIN`, `entityType user`, `entityId userId`, `metadata { feature }`. There is one row per profile the person is a **member** of, firms included, through admin-users.ts's own `audit()` / `memberOrganizations()` helpers (`admin-users.ts:157-167`) (eng review D4). A firm then sees when a member's agent can reach its books. The rows are written **in the same transaction** as the change: the store method takes `audit: AuditEventInput[]`, like `createGrant`. Nothing is written when the call changes nothing (an idempotent no-op), as with `disable`/`enable`.

**D5. `/v1/me` gains `features: string[]`** (active only, sorted). `DeviceSessionSchema` extends `MeSchema`, so the phone gets the field as well. That is additive, and the Flutter app ignores unknown fields. The portal's `src/hosted/api/schema.d.ts` is regenerated, with no UI use in this ticket (MUT-434 hides Connect Claude with it). Local mode (`createLocalApp`, memory store) always returns `[]`, because the memory map stays **out of `snapshot()`/`restore()`**, with the same comment the terms and billing maps carry (`memory.ts:266-271`). That keeps the shipped local format and its fingerprint test (`src/hosted/local/__tests__/format-fingerprint.test.ts`) unchanged (C5). The Flutter app decodes with json_serializable and never sets `disallowUnrecognizedKeys` (checked 2026-10-25), so the extra field is safe there.

**D6. AC3 is split honestly.** MCP and OAuth grants don't exist until MUT-434, so this ticket ships the check plus the seam:
- `hasFeature(store, userId, feature)` is one read on the unique index, done at request time with no cache. A revoke therefore takes effect on the very next call; that is the "immediately" part.
- **Store-guard class (C4):** `features.activeFor` is `sessionOnly` (it is read by `/v1/me` on the session-scoped store); `grant`, `revoke` and `holders` are `operator`. `Principal` today is only `'apiKey' | 'session'` (`writability.ts:20`), so MUT-434 must reclassify `activeFor` for its MCP principal or read it from the unguarded store. Without that, MCP requests fail closed with `PRINCIPAL_NOT_ACCEPTED`.
- MUT-434 owns calling it on every MCP/OAuth request (403 `FEATURE_NOT_ENABLED`) and revoking that user's OAuth grants when `agent_access` is revoked. Comments on MUT-433 and MUT-434 move those two AC lines there, so neither ticket claims what the other builds (eng review D3). The MUT-434 comment also says that MCP enforcement must apply the closure gate and the user-status check (`middleware.ts:209-210`), not only `hasFeature`. Otherwise a closing account keeps agent access until the purge (outside-voice finding 6).

**D7. Purge:** the FK cascades on user delete. Add `'user_feature_grants.userId': 'delete'` to `PURGE_USER_COLUMNS` in `prisma-purge-tables.ts`; the memory store's user delete drops the rows itself (C1). The catalog test fails without it, which is the guard working. Account close (soft) needs nothing in this ticket. A closing account keeps a session limited to `CLOSING_OPEN_ENDPOINTS` (`middleware.ts:209-210`), and `/v1/me` simply shows its flags. MCP enforcement of closure is MUT-434's (D6).

**D8. CLI** (`server/src/scripts/users.ts`, same `call()` + `userByEmail()`):
- `npm run feature:grant -- --email <e> --feature agent_access`
- `npm run feature:revoke -- --email <e> --feature agent_access`
- `npm run feature:list -- --feature agent_access`
Each gets a USAGE line and a header-comment line.

**D9. Prod grant for sader@basel.ps** goes in `docs/operations/before-release.md` as an operator step after the release that carries the migration: `MUTABA3A_ADMIN_TOKEN=… npm run feature:grant -- --url https://<api> --email sader@basel.ps --feature agent_access`. Claude does not run it (no deploys, no prod admin calls).

**D10. Numbering:** ADR-196 and API `1.73.0-mut433`. Re-check both at merge, because parallel lanes bump them. Migration: `<ts>_mut433_user_feature_grants`.

## Files

| Layer | File | Change |
|---|---|---|
| Schema | `server/prisma/schema.prisma` | `model UserFeatureGrant` + `User.featureGrants` relation |
| Migration | `server/prisma/migrations/<ts>_mut433_user_feature_grants/migration.sql` | create table, unique, index, FK cascade |
| Domain | `server/src/features.ts` (new) | `FEATURES`, `Feature`, `isFeature`, `hasFeature` |
| Port | `server/src/repositories/ports.ts` | `UserFeatureRecord`; `FeaturesRepository { grant, revoke, activeFor(userId), holders(feature) }`; `store.features` |
| Prisma | `server/src/repositories/prisma.ts` | implementation, audit in the same `$transaction`, race-safe no-op (C3) |
| Memory | `server/src/repositories/memory.ts` | same semantics, rows dropped on user delete (C1), map kept out of snapshot/restore (C5) |
| Purge | `server/src/repositories/prisma-purge-tables.ts` | FK map entry |
| Guard | `server/src/auth/store-guard.ts` | classify `features.*` (C4); `store-guard.test.ts` checks the map matches the memory store |
| Routes | `server/src/routes/admin-users.ts` (no new route file, no app.ts wiring) | D3 |
| Me | `server/src/routes/me.ts` (`buildMe`), `server/src/schemas.ts` (`MeSchema.features`, admin feature schemas) | D5 |
| CLI | `server/src/scripts/users.ts`, `server/package.json` scripts | D8 |
| OpenAPI | `npm --prefix server run openapi:generate`, then root `npm run hosted:types` (C2) | |
| Version | `server/src/app.ts` `API_VERSION` | D10 |
| Docs | `.claude/DECISIONS.md` ADR-196, `CHANGELOG.md`, `SYSTEM_OVERVIEW.md` (admin surface), `TEST_PLAN.md`, `docs/operations/before-release.md` | |

## Tests (written first)

`server/src/__tests__/user-features.test.ts` (memory store, through the app):
- A new user's `/v1/me` has `features: []` (AC1).
- Grant via PUT → 200 `granted:true`; `/v1/me` shows `['agent_access']`; a second PUT → `granted:false`, with no second audit row (AC2).
- Revoke via DELETE → `revoked:true`; `/v1/me` back to `[]`; `hasFeature` is false on the very next read; a second DELETE → `revoked:false` (AC2, AC3-seam).
- Grant after revoke re-opens it, with a new `grantedAt`.
- Unknown feature → 422; unknown user → 404; no admin token → 401.
- Audit: one `user.feature_granted` row per membership profile, `actorType ADMIN`, `metadata.feature` (AC2).
- `GET /admin/v1/features/agent_access` lists only the current holders.
- Two racing grants for the same person write one row and one audit row (C3; **test:db only**: the memory store never yields between check and write, so a `Promise.all` there proves nothing).
- A grant to a `PENDING_REVIEW` user → 409 `USER_PENDING_REVIEW`, no row; grant and revoke on a `DISABLED` user → 200 (D5).
- Audit rows land on every profile the person is a member of, a firm they only belong to included (D4).
- `snapshot()` of a memory store holding a grant has the same keys as before; the format-fingerprint test stays green (C5).
- A flagged user who is closed and purged leaves no feature row (C1; both stores).

`server/src/repositories/__tests__/` (test:db, Postgres): unique (userId, feature); cascade on user delete; audit and change commit or roll back together. The existing purge-catalog test covers D7.

`server/src/scripts/__tests__/users-cli.test.ts`: `feature-grant` / `feature-revoke` resolve the email, then hit PUT / DELETE with the right path; `feature-list` prints the holders; an unknown command or a missing `--feature` gives usage.

Commands (through the heavy queue, Node 22):
- `npm --prefix server run typecheck`
- `npm --prefix server run lint`
- `npm --prefix server run openapi:check`
- `npm --prefix server test -- user-features users-cli`, then the full server suite
- root `npm run typecheck` (regenerated portal schema)

## QA scenarios (release-qa)

None user-visible: this is an operator-only API plus a `/me` field nobody renders yet. The coverage is the API tests above. Map the new server files in `qa/features/portal-selfservice/*.yaml` the way `admin-signup-reviews.ts` is mapped, so `release-qa lint` reports no unmapped files. The first user-visible scenario (Connect Claude hidden or shown) belongs to MUT-434.

## Scale and cost

One indexed read per `/me` and, later, per MCP call. No caching, which is what keeps revocation instant. There are few rows (one per pilot person per flag). No new infra, no third-party calls.

## Out of scope

Self-serve toggles, plan-based entitlement, a flag UI, flag expiry, and per-organization flags (ADR-099 stays as it is).

## Eng review (2026-10-25, /plan-eng-review, target: this file)

**Scope record:** feature answers: none cut; structure: B, smaller arrangement (D1, answered 2026-10-25): routes in `admin-users.ts`, `features.ts` the only new module; accepted scope: plan as written, with routes moved into admin-users.ts; pending remedies: R2, R3 (both since answered: D2, D3).

### Factual corrections (no behavior change; required to meet already-approved ACs)
- C1: The purge entry goes in `PURGE_USER_COLUMNS` (`prisma-purge-tables.ts:53`), and the prisma purge relies on the FK cascade for `delete` rows (`prisma.ts:2337` handles only `anonymize`). The **memory store** deletes per-user rows itself (`memory.ts:2476`, `for (const [key, grant] of this.grants) if (grant.userId === id) ...`), so its user delete must also drop feature rows. Test: close-and-purge a flagged user in both stores.
- C2: The commands are `npm --prefix server run openapi:generate` (`server/package.json:28`) and root `npm run hosted:types` (`package.json:32`), not `openapi:export`.
- C3 (revised by outside voice, finding 3): "No audit row on a no-op" must be race-safe without exceptions, because a unique violation aborts a Postgres interactive transaction. Grant, inside one `$transaction`:
  1. `createMany({ data, skipDuplicates: true })` and take the count;
  2. if 0, `updateMany({ where: { userId, feature, revokedAt: { not: null } }, data: { revokedAt: null, grantedAt } })`;
  3. `findUnique` for the response;
  4. audit only when either count is above 0.
  Revoke mirrors `revokeGrant` (`prisma.ts:2130-2136`). Two racing grants write one row and one audit row.
- C4: store-guard classification (see D6). C5: memory map outside snapshot (see D5). C6: Flutter decoding verified safe (see D5). C7: 422 shape thrown in the handler (see D2).

## Decision ledger

### R2: show a person's flags on GET /admin/v1/users/{userId} (D2)
Finding: P3, confidence 8/10, plan D3 bullet 4; `serializeUser(` is called at 5 sites in routes/*.ts, so adding `features` there means a read at every call site.
Plan baseline: D3 adds `features` to the serialized user.
Runtime evidence: serializeUser is shared by create/update/disable/enable/get routes (grep count 5).
Options: A) Drop it (recommended): no features field on admin user responses; the holders list is the operator view. B) Show flags on GET user only: one indexed read on that route.
State: approved
Actual answer: A, Drop it (D2, 2026-10-25)
Accepted scope: remove the GET-user features bullet and its test; serializeUser untouched.

### R3: AC3 (MCP 403 + grant revocation) moves to MUT-434
Finding: P2, confidence 9/10, plan D6; MCP/OAuth grants do not exist until MUT-434, so AC3 can't be met here.
Plan baseline: D6 splits it: `hasFeature` request-time check here; enforcement + grant revocation and a Jira comment on MUT-434.
Options: A) Split, with comments (recommended). B) Keep it on MUT-433 (stubbed, unmet at qa-reconcile).
State: approved
Actual answer: A, Split, with comments (D3, 2026-10-25)
Accepted scope: hasFeature request-time check + next-read test here; comments on MUT-433 and MUT-434 moving 'MCP calls 403 FEATURE_NOT_ENABLED' and 'revoke OAuth grants on revoke' to MUT-434.

### R4: audit scope for feature grants (D4)
Finding: Medium, confidence 9/10, outside voice #4; `admin-billing.ts:66-69` (owned only, closure-local `auditOn`) vs `admin-users.ts:157-167` (every membership).
Plan baseline: D4 used owned profiles only.
Options: A) Every membership (recommended). B) Owned profiles only.
State: approved
Actual answer: A, Every membership (D4, 2026-10-25)
Accepted scope: audit on memberOrganizations(userId) via admin-users.ts's audit(); test that a firm the person only belongs to gets the row.

### R5: user state on grant (D5)
Finding: Medium, confidence 9/10, outside voice #5; `admin-users.ts:345` refuses PENDING_REVIEW for the membership grant; a pending signup has no approved profiles, so its grant would be unaudited.
Plan baseline: D3 defined only 404.
Options: A) Refuse pending, allow disabled (recommended). B) Refuse pending and disabled.
State: approved
Actual answer: A, Refuse pending, allow disabled (D5, 2026-10-25)
Accepted scope: grant on PENDING_REVIEW → 409 CONFLICT reason USER_PENDING_REVIEW; DISABLED allowed; revoke always allowed; tests for both.

Approval readiness: PASS (R2 ← D2, R3 ← D3, R4 ← D4, R5 ← D5, structure ← D1; C1–C7 are corrections needed to meet already-approved ACs)

## Review body

**Step 0 (scope):** scope accepted as-is; arrangement reduced to one new module (D1). Reality rows:
- premise-table: pass, 0 unverified (every claim cites a file:line, plan D1–D10, C1–C7)
- already-done: pass, no prior work (`git log --all --grep` found no feature-flag commits)
- surface-check: finding, fixed. `openapi:export` doesn't exist; it's `openapi:generate` (C2).
- binding-decisions: pass. Recent eng decisions (MUT-262/424/426) don't touch admin or flags.
- numbers: pass. 5 serializeUser call sites `[measured: grep]`; ~120 added lines in admin-users.ts `[estimated]`.
- deferred-asks: AC3 moved to MUT-434 by owner answer D3.
- pr-count: one branch, one merge.

**Architecture (1 finding):** the store-guard class was missing (C4, fixed). No other boundary issues: a per-user table with an FK cascade, admin-token routes, and a session-guarded read on `/v1/me`.
**Code quality (3):** race-safe grant (C3), memory snapshot (C5), 422 shape (C7). All fixed in the plan text.
**Test review:** diagram below; 4 gaps added to Tests (race on test:db, D4, D5, snapshot).
**Performance:** no issues. One indexed read per `/v1/me` (`@@unique([userId, feature])`), with few rows (a handful of pilot users × 1 flag).

```
CODE PATHS                                                USER FLOWS (operator)
[+] PUT /admin/v1/users/{id}/features/{f}                 [+] feature:grant --email X
  ├── no admin token → 401        [GAP→added]               ├── unknown email → CLI error   [GAP→added users-cli]
  ├── unknown user → 404          [GAP→added]               └── grant → "granted" / "already on"
  ├── !isFeature(f) → 422 field   [GAP→added]             [+] feature:revoke / feature:list
  ├── PENDING_REVIEW → 409        [GAP→added D5]
  ├── DISABLED → 200              [GAP→added D5]          [+] Person (session)
  ├── new → row + audit/membership [GAP→added D4]           ├── /v1/me features [] by default
  ├── active → granted:false, no audit                      └── /v1/me ['agent_access'] after grant,
  ├── revoked → reopen + audit                                  [] on next read after revoke
  └── race x2 → 1 row, 1 audit    [→test:db]
[+] DELETE …/features/{f}: revoked:true/false, audit once  [+] Purge: flagged user closed + purged → no row (both stores)
[+] GET /admin/v1/features/{f}: current holders only       [+] Local mode: snapshot keys unchanged
COVERAGE after plan tests: every branch above has a planned ★★/★★★ test.
```

**Failure modes:**
- A concurrent double grant writes a duplicate audit row: covered by the race test and the C3 algorithm.
- Grant to a pending signup goes unaudited: refused with a 409 (D5) and tested.
- MCP requests silently pass for a revoked person: not possible here (no MCP yet). MUT-434 owns it through the D3 comment.
- `/v1/me` 500s on the guarded store: covered by C4 and the store-guard test.

No silent gaps without tests. **Critical gaps: 0.**

**NOT in scope:** firm-owner consent for agent access to firm data. Recorded in ADR-196 as deferred; revisit at MUT-435, because a per-user flag lets a member's agent read firm profiles with no say from the owner (outside voice, strategic). Also out: self-serve toggles, flag expiry, a flag UI, and per-organization flags.
**What already exists:**
- `EntitlementGrant` + `/admin/v1/billing/grants` (shape copied, not reused: billing-typed).
- admin-users.ts `audit()`/`memberOrganizations()` (reused).
- users.ts `call()`/`userByEmail()` (reused).
- `PURGE_USER_COLUMNS`/FK cascade (reused).
**TODOS:** none proposed.
**Outside voice:** native Claude Plan subagent (Codex CLI not installed), completed within the 5-minute limit. 10 findings + 1 strategic:
- #1/#2/#3/#7/#8: fixed as corrections C3–C7;
- #4/#5: owner answers D4/D5;
- #6: added to the MUT-434 hand-off;
- #9 (`grantedBy` single-valued): rejected, kept for parity with `EntitlementGrant`;
- #10: checked and safe.
**Parallelization:** sequential implementation, no parallelization opportunity (one module, server/).

## Implementation Tasks
- [ ] **T1 (P1, human ~3h / CC ~25min)**: server data layer: model, migration, ports, prisma (C3), memory (C1, C5), purge map, store-guard (C4). Verify: `npm --prefix server test -- user-features store-guard` + test:db.
- [ ] **T2 (P1, human ~2h / CC ~15min)**: admin-users.ts routes, D2/D3/D4/D5, plus `/v1/me` features. Verify: `user-features.test.ts`.
- [ ] **T3 (P2, human ~1h / CC ~10min)**: CLI `feature:grant|revoke|list` + package.json scripts. Verify: `users-cli.test.ts`.
- [ ] **T4 (P2, human ~1h / CC ~10min)**: `openapi:generate`, `hosted:types`, API_VERSION 1.73.0-mut433, ADR-196 (including deferred firm consent), knowledge files, before-release.md grant step for sader@basel.ps, QA yaml path mapping.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Outside Review | native Claude Plan subagent (codex not installed) | Independent 2nd opinion | 1 | issues_found (in-host; outside coverage unavailable) | 10 findings + 1 strategic; 7 fixed, 2 by owner answer, 1 rejected |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | issues_open (all resolved in plan) | 8 issues, 0 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | — (no UI) |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **OUTSIDE COVERAGE:** Codex not installed; native fallback completed. No external-provider coverage.
- **VERDICT:** ENG reviewed, all findings resolved in the plan (D1–D5 answered, C1–C7 applied). Ready to implement.

NO UNRESOLVED DECISIONS
