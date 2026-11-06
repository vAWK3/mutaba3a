# MUT-559 — Server: accountant grants per profile (plan)

Epic MUT-558. Repo: mini-crm (`server/`). No blockers. Blocks MUT-561..565. ADR-245 (next free). API 1.99.0-mut534 → 1.100.0-mut559.

## Core decision: a separate grant table, not a Membership role

Accountant access lives in a new `AccountantGrant` table, **not** as `MembershipRole.ACCOUNTANT`.

Why: every existing membership query would otherwise have to learn to skip accountants, and any one that forgets leaks client data or misbehaves:
- `GET /v1/entries` (`listByUser`) and `/v1/summaries/verdict` read across all of a user's memberships.
- `/v1/profiles/{id}*`, the co-owner owner lists and `MAX_PROFILE_OWNERS`, purge-plan R18, the firm checks, the MCP `ownsProfile` check and the `/v1/me` profile list (which the phone's Capture, widgets and switcher read).

With a separate table, all of these stay untouched and default-deny. Access is added at exactly one point: `selectProfile`.

## Data (Prisma migration)

```
enum AccountantGrantStatus { PENDING ACTIVE REVOKED LEFT }
model AccountantGrant {
  id               uuid pk
  organizationId   → Organization (onDelete Cascade)
  inviteEmail      citext/lowercased
  locale           'en' | 'ar'
  invitedByUserId  → User (SetNull)
  accountantUserId → User? (Cascade)       // set on accept
  status           AccountantGrantStatus
  tokenDigest      String? @unique          // sha256 of invite token; nulled on accept/revoke
  inviteExpiresAt  DateTime                 // createdAt + 14 d; "expired" is computed, no cron
  acceptedAt, revokedAt, lastViewedAt  DateTime?
  createdAt
  @@unique(organizationId, accountantUserId)   // one grant per accountant per profile
  @@index(accountantUserId, status)
}
```
- Partial unique: only one PENDING/ACTIVE grant per (organizationId, inviteEmail). Enforced with a raw-SQL partial index in the migration.
- Cap: 5 PENDING+ACTIVE grants per profile (`config.ACCOUNTANTS_PER_PROFILE_MAX`) to stop invite spam. The accountant-side 3-client cap belongs to MUT-565.
- Cascades: the owner's account closure deletes the org, which deletes its grants. The accountant's closure deletes their grants. Neither touches memberships, so purge-plan R18 is unaffected (asserted by a test).

## Authorization (the single entry point)

`src/auth/middleware.ts` `selectProfile` (:356): when the membership lookup misses, look up an ACTIVE grant for (userId, orgId).
- **No grant:** 404 PROFILE_NOT_FOUND, exactly as today, so a revoked grant looks like it never existed.
- **Grant found:** `SessionAuth` gets `access: 'accountant'`, `membershipRole: null` and `scopes = accountantScopes()`.

New `accountantScopes()` in `src/auth/writability.ts`:
- Only the `:read` scopes of these domains: expenses, payments, attachments, summaries, conversions, customers, projects.
- Customers and projects are included only so income rows show client and matter names. Agreements, audit and integration are excluded.

Three layers, all in `finishSessionAuth` right after `selectProfile`, which runs before any route handler:
1. **Method gate:** any non-GET/HEAD for an accountant session returns 403 `ACCOUNTANT_READ_ONLY`. This also covers routes whose writes aren't scope-checked (income `capture:write`, inbox file-as-*, previews).
2. **Derived GET allowlist (D1):** a GET is allowed only if the route has at least one `requireScope` tag in the existing `buildRouteAccessIndex` and every one of those scopes is in `accountantScopes()`. Unscoped GETs are denied, including `/v1/records-export`, which also re-checks membership at `records-export.ts:56`. Download belongs to MUT-314. There is no hand-written route list.
3. **Data-layer read-only guard (D2):** accountant requests run on a `requestScopedStore` whose guard (in `store-guard.ts`, built on `STORE_ACCESS`) throws 403 `ACCOUNTANT_READ_ONLY` on any write method. The hourly `lastViewedAt` touch and SYSTEM catch-up posting (`lazyPostingOf`) keep using the base store, as they do today.

`SessionAuth` gains `access: 'member' | 'accountant'`, and `membershipRole` becomes `MembershipRole | null` (`middleware.ts:43`). `ownsProfile(..., null)` already returns false, so every owner gate refuses an accountant without further changes.

Lapse: the owner's READ_ONLY standing already lets GETs through. If the owner reaches LOCKED, an accountant session is gated as READ_ONLY instead (decision: the accountant keeps read and download).

`lastViewedAt`: touched at most once an hour per grant, the same way `sessions.touch` is throttled. The first view of each UTC day also writes an audit row `accountant.viewed`.

## Routes (new file `src/routes/accountants.ts`, OpenAPI regenerated)

Owner side (session; `ownsProfile` required, otherwise 403 NOT_OWNER; co-owners count as owners):

| Method | Path | Result |
|---|---|---|
| POST | `/v1/profiles/{profileId}/accountants` `{email, locale?}` | 201 grant (PENDING) and sends the email. 409 `ALREADY_INVITED` if a PENDING/ACTIVE grant exists for that email. 409 `ACCOUNTANT_LIMIT` at the cap. 422 for an invalid email. 422 `SELF_INVITE` for the owner's own email. Rate-limited per user. |
| GET | `/v1/profiles/{profileId}/accountants` | `[{id, email, name?, status: pending\|expired\|active, invitedAt, acceptedAt, lastViewedAt}]`. REVOKED and LEFT grants are hidden. |
| DELETE | `/v1/profiles/{profileId}/accountants/{grantId}` | 204. Revokes a pending or active grant; the next accountant request returns 404. |

Accountant side:

| Method | Path | Auth | Result |
|---|---|---|---|
| POST | `/v1/accountant-invites/check` `{token}` | public | `{profileName, ownerName, maskedEmail, expired}`. Unknown, used and revoked tokens all return the same 404. **D3:** the token travels in the body, as on `/v1/account-setup/check`, never in a path. The portal reads it from the link's fragment. |
| POST | `/v1/accountant-invites/accept` `{token}` | session | **D4:** allowed when the signed-in email equals the invite email, **or** both are on the same domain and that domain is in none of the `free-webmail`, `disposable` or `relay` lists (`src/email/domains/lists.ts` `isListedDomain`; exact domain, no subdomains). Otherwise 403 `INVITE_EMAIL_MISMATCH`, with the masked invite address. 409 if the user already owns or belongs to that profile. The status change is conditional (`status=PENDING AND tokenDigest=…`) so a double accept can't race. Sets ACTIVE and nulls the token. |
| POST | `/v1/accountant-invites/signup` `{token, displayName?, password}` | public | Creates the user with the invite email, **status ACTIVE (no signup review)**, plus their personal profile (MUT-120). Accepts the grant and returns a session the same way setup redemption does. 409 `ACCOUNT_EXISTS` → the client shows sign-in. Turnstile is the same as on signup. |
| DELETE | `/v1/clients/{profileId}` | session | The accountant leaves: LEFT. |

`/v1/me` gets a new `clients: [{profileId, name, ownerName, sharedSince}]`, which is empty for most users. `profiles[]` stays exactly as it is, so Capture, widgets and the switcher never see client profiles (MUT-564 AC).

Personal profiles: the grant routes never call `ownedProfileConflict`, so personal profiles can be shared. The admin membership grant still returns 409 PERSONAL_PROFILE (regression test). This amends MUT-120 decision 3 in ADR-245.

Malafat-linked profiles: nothing special. The accountant reads what the owner reads.

## Email

Template `accountant-invite` in `src/email/ports.ts` and `templates/copy.ts` (en and ar), sent with `mailer.send` and the idempotency key `accountant-invite:{grantId}`.
- **Content:** owner name, profile name, what the accountant will see (read-only), the expiry date and the `{PORTAL}/accountant-invite#{token}` link. The token sits in the fragment (D3), which browsers never send to the server.
- **Failure:** never throws, same as `passkey-notice.ts`. If sending fails, the grant stays PENDING and the owner can revoke and invite again.

## Telemetry

Server-side PostHog `accountant_invited`, `accountant_accepted` (and `accountant_left` / `accountant_revoked`), each with `surface: 'api'` and the client surface passed by the caller. They go through `observability/telemetry-gate.ts` and carry no email or name.

## Dark launch

`config.ACCOUNTANT_ACCESS` (env, default false in prod, true in dev and QA). When false, every new route returns 404 and `clients` is omitted, so the server can deploy before MUT-561..564.

## Files

- **New (D5, smaller arrangement):** `src/accountants/grants.ts`, which covers invite, token digest, the email/domain match, accept, revoke, leave and lastViewed; and `src/routes/accountants.ts`. The access derivation sits next to `selectProfile` in `middleware.ts`; the read-only guard goes in `store-guard.ts`.
- **Changed:** `prisma/schema.prisma` + migration; `src/repositories/ports.ts`, `memory.ts` and `prisma.ts` (`accountantGrants` repository); `src/auth/middleware.ts` (`selectProfile`, `finishSessionAuth`); `src/auth/writability.ts` (`accountantScopes`); `src/routes/me.ts` + `serializers.ts` (`clients`); `src/email/ports.ts` + `templates/copy.ts`; `src/config.ts`; `src/errors.ts` (ACCOUNTANT_READ_ONLY, INVITE_EMAIL_MISMATCH, ALREADY_INVITED, ACCOUNTANT_LIMIT, SELF_INVITE); `src/app.ts` (registration + API_VERSION); OpenAPI; `npm run hosted:types`.
- **Docs:** ADR-245 in `.claude/DECISIONS.md`; design brief `.claude/designs/MUT-559-accountant-grants.md` (this file) committed on the build branch.

## Tests (TDD; `npm --prefix server test`, plus `test:db` for the Prisma repository)

1. **`accountant-route-matrix.test.ts`:** enumerates every registered profile-scoped route (all 116) from the route-access index, not a hand list.
   - Every write → 403 ACCOUNTANT_READ_ONLY.
   - Every GET outside the allowlist → 403.
   - Every allowlisted GET → 200 with only the shared profile's rows.
   - A route added later without a classification fails the test.
2. **Isolation:** the accountant sends the header of a second, unshared profile → 404. `/v1/entries` and `/v1/summaries/verdict` contain only the accountant's own data. `/v1/profiles/{clientId}` → 404.
3. **Invite lifecycle:**
   - Create, list, then email sent (fake mailer, en and ar).
   - Duplicate → 409. Cap → 409. Self-invite → 422.
   - Expired after 14 days (fake clock) → accept 404, list shows `expired`.
   - Revoke → the next request returns 404.
   - Leave → gone from `/v1/me.clients`.
4. **Accept and signup:**
   - Exact email → ACTIVE.
   - Same professional domain (`a@firm.com` invited, `b@firm.com` accepts) → ACTIVE.
   - Same free-webmail domain (gmail.com) → 403.
   - Subdomain (`b@mail.firm.com`) → 403.
   - Different domain → 403 with a masked address.
   - Double accept in parallel → one ACTIVE, one 404.
   - OpenAPI has no `{token}` path parameter.
   - Signup → ACTIVE user with no SignupReview row, personal profile created, grant ACTIVE.
   - Signup for an existing email → 409.
5. **Personal profile:** invite on a personal profile → 201. Admin co-owner grant on the same profile → still 409 PERSONAL_PROFILE.
6. **Lapse:** owner READ_ONLY → accountant GET 200. Owner LOCKED → accountant GET 200, write 403.
7. **Closure:** closing the owner's account removes the grants. Closing the accountant's account removes their grants. Purge plan not BLOCKED by grants.
8. **Audit:** `lastViewedAt` throttled. One `accountant.viewed` per day. Invited, accepted, revoked and left audit rows written.
9. **Flag off:** the new routes return 404 and `/v1/me` has no `clients`.
10. **Store guard (D2):** under an accountant request, a repository write method throws 403, while the `lastViewedAt` touch and catch-up posting still succeed.

Checks before merge (through the heavy queue): `typecheck`, `lint`, `openapi:check`, `test`, `test:db`.

## Scale and cost

- One indexed lookup on (accountantUserId, orgId), and only when the membership lookup misses, so normal users pay nothing.
- `lastViewedAt` writes at most once an hour per grant.
- No new infrastructure. The email goes through the existing Resend mailer, one per invite.

## Out of scope (other tickets)

- Portal and phone screens: MUT-561..564.
- Share links: MUT-560.
- Export format: MUT-314.
- 3-client cap and plan: MUT-565.
- Resend invite (revoke and re-invite covers it), and an email to the owner on accept.

## Decision ledger (plan-eng-review, 2026-11-06)

- **D1 · Allowlist:** derive it from the `requireScope` tags in `buildRouteAccessIndex` (`middleware.ts:113`). No hand-written list. *approved*
- **D2 · Data-layer guard:** accountant requests get a read-only store guard on `STORE_ACCESS` (`store-guard.ts:37`). *approved*
- **D3 · Invite token:** sent in the POST body, as on `/v1/account-setup/check` (`account-setup.ts:90`). Never in a path. *approved*
- **D4 · Who can accept:**
  - Email invite: the exact address, or the same domain when that domain is in none of the free-webmail, disposable or relay lists (`email/domains/lists.ts`). *approved*
  - Share link: anyone with the link and PIN, capped at 3 distinct viewers. This is MUT-560 scope, recorded on that ticket.
- **D5 · Structure:** smaller arrangement, 2 new files. *approved*

Corrections made without a question (they follow the existing code):
- **C1:** `/v1/records-export` re-checks membership (`records-export.ts:56`), so an accountant would get 404. Download moves to MUT-314 and is denied by D1 because the route has no scope tag.
- **C2:** `SessionAuth.membershipRole` is non-null (`middleware.ts:43`). It becomes nullable, with an added `access` field. `ownsProfile(…, null)` already returns false (`personal-profile.ts:43`).

## Review notes

**Architecture**
- A separate grant table keeps every membership-based cross-profile read default-deny: `/v1/entries`, the verdict, `/v1/profiles/*`, owners, purge R18 and MCP.
- Access is added at exactly one point (`selectProfile`), with three independent refusal layers behind it.
- Failure modes and how the plan handles each:
  - Resend down: the mailer never throws and the grant stays PENDING. The owner sees "pending" and can revoke and re-invite.
  - Accept race: handled by a conditional update.
  - Owner reaches LOCKED: the accountant is gated as READ_ONLY.
  - Owner or accountant closes their account: the grants cascade.
- Design-twice comparison: a Membership role (rejected: about 8 membership readers would need to skip it, which is a leakage risk) versus a separate table (chosen: deeper, with one interface at `selectProfile`).
- Red flags: the hand-synced route list was removed by D1. None remain.

**Code quality**
- Reuses the existing route-access index, `STORE_ACCESS`, the setup-link token pattern, the domain lists, the mailer pattern from `passkey-notice.ts`, `ownsProfile`, and the throttling pattern from `sessions.touch`. Nothing new to extract.

**Tests**
- Test runner: vitest (`server/vitest.config.ts`).
- Every new branch maps to a planned test (1–10 above).
- The route matrix (1) and the store guard (10) are the regression net for every future route.
- [→E2E] invite → signup → read → revoke belongs to the portal stories MUT-561/562 (Playwright release-QA).

**Performance**
- One indexed lookup on a membership miss only.
- `lastViewedAt` is written at most once an hour per grant.
- `/v1/me.clients` is one indexed query.
- No N+1, and no new infrastructure.

**Not in scope:** MUT-560, MUT-314, MUT-561..565, resending invites, and emailing the owner on accept.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|---|---|---|---|---|---|
| Eng Review | /eng-ticket MUT-559 | plan before build | 1 | CLEAR | 5 decisions approved (D1–D5), 2 corrections (C1–C2), 0 critical gaps |
| Outside Voice | default-on | independent challenge | 0 | unavailable | codex not installed |

VERDICT: ENG CLEARED — ready to build (scope accepted as-is; structure reduced per D5).
OUTSIDE COVERAGE: none (codex unavailable).

NO UNRESOLVED DECISIONS

## As built (2026-11-06, ADR-245)

Where the build follows the code rather than the plan's letter:

- **Error shape.** ACCOUNTANT_READ_ONLY is `details.reason` on the existing 403 READ_ONLY_PROFILE (as NOT_OWNER is); ALREADY_INVITED, ACCOUNTANT_LIMIT, ALREADY_HAS_ACCESS (accept when the person already owns, belongs to or reads the profile) and ACCOUNT_EXISTS are 409 CONFLICT reasons; SELF_INVITE is a 422 VALIDATION_FAILED reason. Only INVITE_EMAIL_MISMATCH (403) is a new error code: no existing 403 fits it.
- **Unique keys.** `@@unique(organizationId, accountantUserId)` became a partial unique index on ACTIVE grants, so an accountant who left (or was revoked) can be invited and accept again; ended grants keep their accountant as history.
- **Signup returns no session.** Setup redemption issues none (ADR-088 §5: one way to mint a session); signup from an invite answers `{ email, status, client }` and the portal signs in through POST /v1/sessions. The body also takes `acceptedTermsVersion` (MUT-324: every account accepts the terms) and the signup Turnstile token; the personal profile takes the shared profile's currency and timezone unless the body names them. Review decision A (Basel, 2026-11-06): the new account gets **no** trial (`trialStartedAt` null: READ_ONLY, source NONE), and an invite to a disposable or relay address is refused (422 INVITE_ADDRESS_REFUSED).
- **Lapse gate classes.** Listing and revoking accountants, accepting and leaving are `open` in PERSON_LEVEL_GATE (who can read a profile is privacy, never a paid feature); inviting is `pathProfile` (a write on the profile in the path).
- **Expired invites.** A new invite to the same address replaces an expired PENDING one (it is ended in the invite's transaction); expired invites don't count toward the cap.
- **Expense categories.** GET /v1/expense-categories seeded the preset on a first read (a write); it now seeds only for members, so an accountant's read never writes.
- **Telemetry.** The API has no PostHog client (`observability/telemetry-gate.ts`: "The API sends nothing to PostHog"), so the server events are left to the client stories.
- **Allowlist (D1) today:** 33 GETs (`accountant-route-matrix.test.ts` pins them and reads each on a real record), including `/v1/summaries/activity`. Review decision B: `/v1/retainers/{id}/charges` also requires `agreements:read`, so it is refused.
- **Review fixes:** the purge deletes only PENDING invites to a purged address; the owner's list shows the accepting account's address on an active grant; `touchViewed` stamps ACTIVE grants only; the Prisma invite's unique-violation path re-reads the table instead of trusting the constraint name.

## QA scenarios

Server only: the user-visible flows (invite, accept, read, revoke, leave) are the portal and phone stories MUT-561..564, which carry their release-QA specs. The server's own proof is the vitest suites listed in TEST_PLAN.md (MUT-559).
