# MUT-235 — Setup links replace printed passwords

Jira: MUT-235 (Story, epic MUT-34). Blocks MUT-236 (portal `/setup` page). Relates MUT-37, MUT-115, MUT-186, MUT-237.
Status: plan, pending eng review. Server only (`server/`), plus the operator CLI and the demo-seed script.

## 1. Problem and acceptance criteria

`provision:user` and `rotate:password` print a password Basel delivers by hand. Until it is used Basel knows a working password to someone's money, and nobody can change their own password. Decision (2026-10-16, see memory `hosted-onboarding-setup-links`): a one-time setup link instead, 72 h, the same link for operator resets, set in the browser only.

Ticket acceptance criteria (verbatim intent):

1. `provision:user` creates the account and prints a link; no password is printed or stored.
2. Until its link is used the account cannot sign in; the error body is identical to a wrong password and the attempt runs exactly one argon2 verify (eng review A4: an existing account already takes the wrong-password path, not the unknown-email path, as every account does today).
3. A link works once; a second use, a link past 72 h, and a link cancelled by a newer one are refused with distinct reasons.
4. `rotate:password` issues a link; the old password keeps working until the link is used, then stops.
5. Using the link revokes every web and device session of that user.
6. Tokens and passwords never appear in a log line.
7. The route-inventory test passes with only the new setup routes allowed.
8. Store contract tests (memory + Postgres) pass; the migration is additive.
9. Release-QA features + passing specs.

## 2. Design

### 2.1 Data

New table `account_setup_tokens` (Prisma `AccountSetupToken`):

| column | type | notes |
|---|---|---|
| id | uuid pk | |
| userId | uuid fk → users | indexed |
| tokenDigest | varchar(64) unique | `sessionDigest(SESSION_TOKEN_PEPPER, token)` — HMAC-SHA256 hex, the session digest reused |
| purpose | enum `SETUP \| RESET` | for audit and for the portal's wording |
| createdAt, expiresAt | timestamptz | |
| usedAt, cancelledAt | timestamptz null | at most one of them is ever set |

`users.passwordHash` becomes nullable (`DROP NOT NULL`): null = no password yet. Existing rows are untouched, so the migration only relaxes a constraint and adds a table.

Deviation from the ticket text: the ticket says "SHA-256"; the plan stores the HMAC-SHA256 under the session pepper, the same digest sessions use. Strictly stronger, one helper instead of two, and rotating the pepper voids open links exactly as it signs everyone out.

No pruning job: rows are operator-issued, a handful a week. Recorded as debt (§6).

### 2.2 Domain module — `server/src/auth/account-setup.ts` (new)

Pure, no I/O, unit-tested:

- `SETUP_LINK_POLICY = { defaultHours: 72, minHours: 1, maxHours: 720 }`
- `NEW_PASSWORD_POLICY = { minLength: 12, maxLength: 128 }` — reused by MUT-237.
- `generateSetupToken()` — 32 random bytes, base64url (43 chars).
- `setupLinkState(record | null, user | null, now)` → `'valid' | 'expired' | 'used' | 'superseded' | 'invalid'`. `invalid` covers unknown token and a user who is not ACTIVE.
- `setupUrl(origin, token)` → `${origin}/setup#${token}` (fragment: never in a request line, log or Referer).

`schemas.ts` gains `NewPasswordSchema` (`z.string().min(12).max(128)`), `SetupTokenSchema` (43-char base64url), the check/redeem request and response schemas, and `SetupLinkSchema { url, expiresAt, purpose }`.

### 2.3 Store port — `AccountSetupRepository` (ports.ts, memory.ts, prisma.ts)

```ts
interface AccountSetupRepository {
  /** One transaction: locks the user row (SELECT … FOR UPDATE), cancels the user's open links (cancelledAt = at), then creates this one. At most one open link per user, even under concurrent issues (eng review A2). With `lock`, it also sets passwordHash = null and revokes every session in the same transaction (D2). */
  issue(input: { userId; tokenDigest; purpose; at; expiresAt; lock: boolean; audit: AuditContext }): Promise<AccountSetupTokenRecord>;
  findByDigest(tokenDigest: string): Promise<AccountSetupTokenRecord | null>;
  /**
   * One transaction: claims the link with a conditional update
   * (usedAt IS NULL AND cancelledAt IS NULL AND expiresAt > at, and the user ACTIVE),
   * then setPassword, revokeAllForUser('password_set') and the audit rows.
   * Returns the user, or the state that refused it. Two concurrent redeems: exactly one wins.
   */
  redeem(input: { tokenDigest; passwordHash; at; audit: AuditContext }): Promise<{ kind: 'redeemed'; user: UserRecord } | { kind: 'refused'; state: SetupLinkRefusal }>;
}
```

Audit is written inside the transaction (the MUT-182 pattern), so a half-applied redeem can't exist. `UserRecord.passwordHash` and `CreateUserInput.passwordHash` become `string | null`.

### 2.4 Sign-in — no new code path

`signIn()` already verifies `user?.passwordHash ?? dummyHash`, so a null hash runs one argon2 verify against the dummy and fails as `INVALID_CREDENTIALS` (AC 2). A test pins it for both `/v1/sessions` and `/v1/device-sessions`. Failed attempts on a pending account count toward the lockout as today; redeem clears it (`setPassword` already does).

### 2.5 Public routes — `server/src/routes/account-setup.ts` (new)

| operation | body | answers |
|---|---|---|
| `POST /v1/account-setup/check` | `{ token }` | 200 `{ state: 'valid', email, locale, purpose, expiresAt }` or 200 `{ state: 'expired' \| 'used' \| 'superseded' \| 'invalid' }` |
| `POST /v1/account-setup` | `{ token, password }` | 200 `{ email }` · 410 `SETUP_LINK_UNUSABLE` `details.state` · 422 `VALIDATION_FAILED` (policy) · 429 |

- Both are `security: []`, the token travels in the body only, and both require `isSameOriginRequest` (the portal is the only browser caller; the seed script sends `Origin`).
- Both share the sign-in IP limiter (`SlidingWindowRateLimiter(SIGN_IN_POLICY.ipPerMinute)`) under the key `account-setup:<ip>`.
- Redeem does not issue a session. The portal (MUT-236) signs in with the email it got back and the password it just set, through the existing `POST /v1/sessions`, so there is still exactly one way to mint a session.
- New error code `SETUP_LINK_UNUSABLE` (410) in `errors.ts`.

### 2.6 Admin routes — `server/src/routes/admin-users.ts`

- `POST /admin/v1/users`: creates with `passwordHash: null`, issues a SETUP link, and returns `setupLink` in place of `initialPassword`. An optional `setupLinkValidHours` (1–720) is added to the request.
- `POST /admin/v1/users/{userId}/password` is removed and replaced by `POST /admin/v1/users/{userId}/setup-link` (optional `validHours`, optional `lock: boolean`). By default it issues a RESET link (SETUP when the user has no password yet), changes no password and revokes no session, so the old password works until the link is used (AC 4). With `lock: true` (D2, the takeover case) it also clears the password and revokes every web and device session at once, then issues the link. A DISABLED user → 409 `CONFLICT` `details.reason USER_DISABLED`.
- Audit metadata on `user.setup_link_issued` records `lock` when it is true.
- The link origin is `sessions.portalOrigin ?? new URL(c.req.url).origin`.
- Audit: `user.setup_link_issued` (actor ADMIN, metadata `{ purpose, expiresAt }`) replaces `user.password_reset`. `user.password_set` (actor USER) is written by redeem.

Breaking admin-contract change. The only callers are `scripts/users.ts` and `scripts/seed-demo-account/adminAccount.ts`, both updated here. API_VERSION → `1.29.0-mut235` (renumber at merge if MUT-228's successor lands first). Regenerate `src/hosted/api/schema.d.ts`.

### 2.7 Operator CLI — `server/src/scripts/users.ts`

- `create`: prints `Setup link — shown once; send it to the person over a secure channel. Valid until <local time>:` then the URL. New `--valid-hours`.
- `rotate` (npm name `rotate:password` kept): calls `/setup-link` and adds `Their current password keeps working until they use this link.`
- `rotate --lock` (D2): sends `lock: true` and prints `Their password no longer works and every session is signed out.` instead. USAGE explains when to use it (a suspected takeover).
- USAGE and `server/README.md` are updated.

### 2.8 Demo seed — `scripts/seed-demo-account/adminAccount.ts`

`ensureSeedAccount` issues a link through the admin API, then redeems it through `POST /v1/account-setup` with a freshly generated password (24 base64url chars ≥ 12) and `Origin: <base url origin>`. Behaviour is unchanged for callers: the seed always gets a fresh, correct password; `keepPassword` is untouched.

### 2.9 Test helper (DRY)

About 20 route test files sign in with `created.initialPassword`. New `server/src/__tests__/helpers/provision.ts`:

```ts
export async function provisionUser(app, body, opts?: { password?: string }):
  Promise<{ user; memberships; personalProfile; password }>
```

It runs admin create → redeem with a fixed test password. Each file's local helper switches to it in a mechanical change, with no behaviour change to those tests.

## 3. Reuse analysis

| need | reused |
|---|---|
| token digest | `sessionDigest` + `SESSION_TOKEN_PEPPER` (auth/sessions.ts) |
| constant-time-ish refusal for a pending account | `signIn` dummy-hash path, unchanged |
| IP budget | the shared sign-in `SlidingWindowRateLimiter` |
| CSRF rule | `isSameOriginRequest` |
| password write + lockout clear | `users.setPassword` |
| session revocation | `sessions.revokeAllForUser` |
| admin HTTP client | `adminClient` in scripts/users.ts |
| transaction + audit-in-tx | the MUT-182 profile repository pattern |

Nothing new in the COMPONENT_REGISTRY (server only). New pattern worth recording in PATTERNS.md: "single-use link token = HMAC digest + conditional claim inside the side-effect transaction".

## 4. Impact

- ADR-037 decision 1 gets an override note pointing to the new **ADR-088 "Operator-issued setup links: the only public account routes are sign-in and setup-link redemption"**. It still says no signup, invite, forgot or self-reset.
- `no-self-registration.test.ts`: the FORBIDDEN regex stays, and a new assertion pins the public account-affecting operations to exactly `POST /v1/sessions`, `POST /v1/device-sessions`, `POST /v1/account-setup/check` and `POST /v1/account-setup`.
- `route-security.test.ts`: `PUBLIC_OPERATIONS` gains the two setup operations.
- Release coupling: once MUT-235 is live, a new account's link points at `/setup`, which only MUT-236 renders. The portal is served by the same server build (app.ts `portal?: { distDir }`), so both ship in one `make release server`: don't cut a server release between merging 235 and 236 (eng review A3).
- Flutter: unaffected. The app signs in with the password the person set; `/setup` stays out of `ALLOWED_APPLINKS_PATHS`.
- Malafat: does not call these admin routes.

## 5. i18n, cost, infra

- Server messages are English developer text; the portal (MUT-236) localises by `state` / error code. The check response returns `locale` so `/setup` opens in the person's language.
- Cost: one extra table, a handful of rows a month. One argon2 hash per redeem, about the same cost as a sign-in.
- Infra: one migration, no new env var (`PORTAL_ORIGIN` and `SESSION_TOKEN_PEPPER` already exist).

## 6. Tech debt to record

- TD: setup-token rows are never pruned. Add pruning if the table ever passes ~10k rows.
- TD: admin user detail doesn't show whether a link is pending or a password is set. Add it if support needs it.

## 7. Files

New: `server/src/auth/account-setup.ts`, `server/src/routes/account-setup.ts`, `server/prisma/migrations/2026101612xxxx_mut235_account_setup_tokens/migration.sql`, `server/src/repositories/__tests__/store-contract-account-setup.ts`, `server/src/__tests__/account-setup.test.ts`, `server/src/__tests__/routes-account-setup.test.ts`, `server/src/__tests__/helpers/provision.ts`, `qa/features/portal/account-setup.yaml`, `qa/specs/portal/account-setup.spec.ts`.

Touched: `prisma/schema.prisma`, `repositories/ports.ts`, `repositories/memory.ts`, `repositories/prisma.ts`, `routes/admin-users.ts`, `schemas.ts`, `errors.ts`, `serializers.ts` (if any), `app.ts` (route + API_VERSION), `scripts/users.ts`, `scripts/seed-demo-account/adminAccount.ts`, `__tests__/no-self-registration.test.ts`, `__tests__/route-security.test.ts`, `__tests__/routes-users.test.ts`, `__tests__/logger.test.ts`, ~20 route tests (helper switch), `src/hosted/api/schema.d.ts`, `server/README.md`, `.claude/{DECISIONS,CHANGELOG,SYSTEM_OVERVIEW,PATTERNS,TECH_DEBT,TEST_PLAN}.md`, `.claude/designs/hosted-portal.md` §3.

## 8. QA scenarios (release-qa, app `portal`)

1. **Operator onboards a person with a link** (`tier: core`): the operator provisions a user (admin API with the QA admin token), checks the link (valid), sets a password through the setup route, then signs in on the portal's sign-in page with that password and lands on Home.
2. **A used link can't be used again**: redeem, then check again → `used`, and a second redeem → 410.
3. **A reset keeps the old password until the link is used**: rotate, sign in with the old password (works), redeem, sign in with the old password (refused), sign in with the new one (works).

4. **A takeover reset locks the account at once** (D2): rotate with `--lock`; the old password is refused and an open portal session is signed out right away; redeem the link; sign in with the new password.

MUT-236 later replaces the API step in scenario 1 with the `/setup` UI.

---

# Eng review — 2026-10-16 (/plan-eng-review, target: this file + mut-235-setup-links-tests.md)

## Scope Challenge

- Existing pieces reused: `sessionDigest` (auth/sessions.ts:43), `signIn` dummy-hash path (auth/sign-in.ts:68), `isSameOriginRequest` (auth/sessions.ts:91), the shared sign-in `SlidingWindowRateLimiter` (app.ts:178), `users.setPassword` (prisma.ts:211), `sessions.revokeAllForUser` (prisma.ts:269), `adminClient` (scripts/users.ts).
- Complexity: about 9 new files and about 30 touched, 20 of them a mechanical switch of test helpers. New units: `auth/account-setup.ts`, `routes/account-setup.ts`, `AccountSetupRepository` (memory + Prisma), `__tests__/helpers/provision.ts`. Gate B trips (8+ files, 2+ new units).
- No feature cuts proposed: every piece maps to a ticket AC or to a caller that breaks without it (the seed script, ~20 route tests).

## Findings

Architecture
- A1 [P1] (confidence 9/10) server/src/routes/admin-users.ts:290-294 — today a reset kills the old password and every session at once (`store.users.setPassword(...)`, `store.sessions.revokeAllForUser(user.id, 'password_reset', now)`). The plan (AC 4) keeps the old password working until the link is used. For a compromised account that removes the instant lockout. `disable:user` can't stand in for it, because redeem refuses DISABLED users. → D2.
- A2 [P2] (8/10) plan §2.3 `issue` — two concurrent issues for the same user can both run "cancel open links" before either inserts, leaving two open links. That breaks the at-most-one-open-link contract AC 3 implies. Fix: `SELECT … FOR UPDATE` on the user row inside the issue transaction (the pattern at prisma.ts `updateMalafatSuggestions`). Necessary to deliver the approved contract, so it's carried into scope without a question.
- A3 [P2] (9/10) app.ts:70 `portal?: { distDir: string }` — the portal is served by the same server build, so MUT-235 and MUT-236 ship in the same `make release server`. Correction to §4: don't cut a server release between merging 235 and 236. No flag is needed.
- A4 [P3] (9/10) auth/sign-in.ts:75-81 — an existing user's failure calls `store.users.recordFailedSignIn`, so a pending account takes the wrong-password path, not the unknown-email path. That difference already holds for every account today. Correction to AC 2: "identical body to a wrong password; one argon2 verify". No behaviour change.
- A5 [P2] (7/10) MUT-236 (not this ticket) — the `/setup` page should drop the fragment from the address bar after reading it (`history.replaceState`), so the token doesn't sit in history or show in a screenshot. To note on MUT-236.

Code quality
- C1 [P3] (8/10) `NewPasswordSchema` `.min(12)` counts UTF-16 code units, so an emoji counts as 2. Accepted; documented in the schema comment.
- C2 [P3] (8/10) scripts/seed-demo-account/adminAccount.ts — the redeem call must send `Origin: new URL(baseUrl).origin`. The portal and API share an origin (A3), so that passes `isSameOriginRequest`. Folded into §2.8.

Tests: see the coverage diagram below. One gap added: a concurrent-issue test (Postgres) for A2.

Performance: no issues. One indexed lookup per check; redeem is one transaction of about five statements; a handful of rows a month.

Outside voice: Codex isn't installed, and the native fallback needs TaskOutput, which this session doesn't have. Coverage is unavailable.

## Decision ledger

### R1: Module arrangement (complexity gate)
Finding: Scope Challenge B — about 9 new files and about 30 touched; 4 new units.
Plan baseline: Original arrangement (§2.2, §2.3, §2.5).
Runtime evidence: sessions already follow this split (auth/sessions.ts + SessionRepository in ports.ts).
Comparison grid: | R1 | current: Original (proposed) | A: Original | B: helpers in users.ts, methods on UserRepository |
Question D1: How should the new setup-link code be arranged? Recommendation: Original.
Header: D1 Structure
Options:
A) Original arrangement (Recommended)
B) Smaller arrangement
State: approved
Actual answer: A, Original arrangement (2026-10-16)
Accepted scope: §2.2/§2.3/§2.5 as written.

### R2: Reset lockdown for a takeover
Finding: A1 [P1] (9/10) admin-users.ts:290-294.
Plan baseline: the old password always survives until the link is used (ticket AC 4).
Runtime evidence: today's reset kills the password and sessions at once; redeem refuses DISABLED users (plan §2.2).
Comparison grid: | R2 | current: none | A: default as ticket + `--lock` (clear hash, revoke sessions at issue) | B: ticket only |
Question D2: When Basel resets a password, does the old one stop working immediately or only once the link is used? Recommendation: A.
Header: D2 Reset
Options:
A) Default + --lock flag (Recommended)
B) Ticket as written
State: approved
Actual answer: A, default + --lock flag (2026-10-16)
Accepted scope: `lock` on `POST /admin/v1/users/{id}/setup-link` and `AccountSetupRepository.issue`; `rotate --lock` in the CLI; tests in the test plan; QA scenario 4.

Carried without a question (necessary to an approved contract): A2 row lock in `issue`. Corrections recorded: A3 release note, A4 AC 2 wording, C1, C2.

Approval readiness: PASS (R1 ← D1 answer A; R2 ← D2 answer A).

## Test coverage (planned)

```
CODE PATHS                                              USER FLOWS
[+] auth/account-setup.ts (unit)                        [+] Operator onboards a person      [→E2E] QA 1
  ├── generateSetupToken            [★★ planned]          ├── provision → link printed      [★★★ planned]
  ├── setupLinkState valid/expired/used/superseded/       ├── check valid → set → sign in   [★★★ planned]
  │   invalid/disabled + boundary   [★★★ planned]         └── unredeemed account sign-in    [★★★ planned] AC2
  └── setupUrl fragment-only        [★★ planned]        [+] Operator reset
[+] AccountSetupRepository (memory + Postgres)            ├── default: old pwd works until used [★★★] QA 3
  ├── issue: cancel + row lock      [★★★ planned]         └── --lock: old pwd + sessions dead   [★★★] QA 4
  ├── issue lock:true               [★★★ planned]       [+] Link misuse
  ├── redeem claim/race/refusals    [★★★ planned]         ├── reused link → used/410        [★★★] QA 2
  └── refused redeem writes nothing [★★★ planned]         ├── expired / superseded / invalid [★★★ planned]
[+] routes/account-setup.ts                               └── cross-site / rate limit       [★★★ planned]
  ├── check / redeem / 410 / 422 / 403 / 429 [★★★]      [+] Regression
[+] routes/admin-users.ts create / setup-link / 409       ├── 20 route suites via helpers/provision.ts
[+] scripts/users.ts create / rotate / --lock             ├── seed-demo-account fresh password
[+] seed-demo-account ensureSeedAccount                   └── no-self-registration + route-security
COVERAGE (planned): every branch above has a ★★ or ★★★ test; no LLM/eval scope.
```

Tests made obsolete: routes-users.test.ts cases asserting `initialPassword` and `POST …/password` (rewritten, not deleted).

## NOT in scope

- Emailing links: no email provider; Basel delivers by hand (ticket scope out).
- A pending-link indicator in the admin user detail: TD in §6; add if support needs it.
- Pruning old token rows: TD in §6.
- Stripping the fragment from the address bar: belongs to MUT-236 (A5).

## Failure modes

| Path | Realistic failure | Covered by | User sees |
|---|---|---|---|
| issue | PORTAL_ORIGIN unset in prod → link built from the request origin | origin fallback + admin test | a correct link (portal and API share an origin) |
| redeem | two tabs submit the same link | conditional claim + race test | the second tab gets "already used" (410) |
| redeem | link expires while the form is open | 410 `expired` | "ask for a new link" (MUT-236) |
| sign-in | pending account tries to sign in | null-hash dummy verify | the usual wrong-password message |
| seed | Origin mismatch on redeem | seed test | the script fails loudly with 403, no silent half-state |

Critical gaps: none (every failure has a test and a visible error).

## Worktree parallelization

Sequential implementation, no parallelization opportunity: one module (`server/`), and every step builds on the store port.

## Implementation Tasks

- [ ] **T1 (P1, human ~3h / CC ~20 min)** — store — Migration, `AccountSetupRepository` (memory + Prisma) with the row-locked issue, `lock`, and claim-in-transaction redeem; nullable `passwordHash`.
  - Surfaced by: A2, D2. Files: prisma/schema.prisma, migration, repositories/{ports,memory,prisma}.ts, store-contract-account-setup.ts. Verify: `npm --prefix server test`, `npm --prefix server run test:db`.
- [ ] **T2 (P1, human ~3h / CC ~20 min)** — routes — `auth/account-setup.ts`, `routes/account-setup.ts`, admin create + `/setup-link` with `lock`, `SETUP_LINK_UNUSABLE`, API_VERSION, OpenAPI regen.
  - Surfaced by: §2.5–2.6, D2. Verify: routes-account-setup + routes-users suites, `openapi:check`.
- [ ] **T3 (P1, human ~2h / CC ~15 min)** — tests — `helpers/provision.ts` and the switch of ~20 route suites; inventory, route-security and logger tests.
  - Surfaced by: §2.9, AC 6–7. Verify: full server suite green.
- [ ] **T4 (P1, human ~1h / CC ~10 min)** — scripts — `users.ts` create / rotate / `--lock`; seed-demo-account redeems with `Origin`.
  - Surfaced by: D2, C2. Verify: scripts tests.
- [ ] **T5 (P2, human ~2h / CC ~20 min)** — release-QA — `qa/features/portal/account-setup.yaml` + spec for scenarios 1–4, run once green.
  - Surfaced by: §8. Verify: `release-qa run --attach --only <id>`, `release-qa lint`.
- [ ] **T6 (P2, human ~1h / CC ~10 min)** — docs — ADR-088 + ADR-037 override note, README, CHANGELOG, SYSTEM_OVERVIEW, PATTERNS, TECH_DEBT, TEST_PLAN, hosted-portal.md §3.
  - Surfaced by: §4, §6.
- [ ] **T7 (P3, human ~5 min / CC ~1 min)** — tracker — comment on MUT-236: strip the fragment after reading (A5) and the shared-release note (A3).

## Completion summary

- Step 0: Scope Challenge — scope accepted as-is (Original arrangement kept)
- Architecture Review: 5 issues found (A1–A5)
- Code Quality Review: 2 issues found (C1, C2)
- Test Review: diagram produced, 1 gap identified (concurrent issue), now planned
- Performance Review: 0 issues found
- NOT in scope: written
- What already exists: written (Scope Challenge)
- TODOS.md updates: 0 items proposed (debt goes to TECH_DEBT.md per CLAUDE.md)
- Failure modes: 0 critical gaps flagged
- Unresolved decisions: 0 in this review
- Outside voice: codex, unavailable (CLI not installed; no TaskOutput for the native fallback)
- Parallelization: 1 lane, 0 parallel / 1 sequential
- Lake Score: 1/1

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Outside Review | codex (`/plan-eng-review` outside voice) | Independent 2nd opinion | 1 | unavailable | CLI not installed |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | issues_open | 8 issues, 0 critical gaps (all resolved into the plan) |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | — |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **OUTSIDE COVERAGE:** codex, plan-review phase, unavailable (not installed); native fallback unavailable (no TaskOutput). No outside findings.
- **VERDICT:** Eng review complete with every finding resolved into the plan; status issues_open records mapped work, not open risk. Ready to implement.

NO UNRESOLVED DECISIONS
