# MUT-354: record the client release on each terms acceptance

> Ticket: MUT-354 (relates to MUT-348, MUT-324, MUT-344), pilot epic MUT-322. Branch `claude/mut-354-terms-client-release-0a93a6`.
> Decision behind it: MUT-348 comment 12222 (Basel, 2026-10-20). The evidence of what a person read is the frozen terms file (`textSha256`) plus the release that rendered it, so each acceptance records that release and it maps to a git tag.
> Out of scope: hashing the rendered text or keeping HTML snapshots (MUT-348 rejected both); the phone half (MUT-344); the ADR-102 addendum (the MUT-348 docs session writes it; this branch adds a pointer line only).

## Problem and acceptance criteria

`terms_acceptances` records `version, locale, textSha256, surface, acceptedAt`, but not which client release showed the terms. Today "the page code at that release" can only be inferred from deploy times.

- **AC1:** a new acceptance from the portal (setup redeem or the Updated-terms step) records the web release that rendered the page.
- **AC2:** `openapi:check` and the server tests pass. Old clients that don't send the field still succeed.

## Plan

| # | Where | What |
|---|---|---|
| 1 | `server/prisma/migrations/20261020120000_mut354_terms_client_release/` + `schema.prisma` | `ALTER TABLE terms_acceptances ADD COLUMN "clientRelease" VARCHAR(64)`, nullable and additive. Existing rows stay null. |
| 2 | `server/src/legal.ts` + `server/src/schemas.ts` | `ClientReleaseSchema`: optional, printable ASCII with no spaces, 1–64 characters (`CLIENT_RELEASE_MAX = 64`). Anything else gets the usual 422. It goes on `TermsAcceptanceRequest` and `SetupLinkRequest` (redeem). |
| 3 | `repositories/ports.ts`, `memory.ts`, `prisma.ts` | `TermsAcceptanceInput` / `Record` gain `clientRelease: string \| null`. `listLatestTermsVersions` rows gain `latestClientRelease` (the release on the latest accepted version). The idempotency is unchanged: a repeat accept keeps the first row, including its release. |
| 4 | `server/src/terms-acceptance.ts`, `routes/sessions.ts`, `routes/account-setup.ts` | `termsAcceptanceOf(terms, locale, kind, clientRelease)`. The `user.terms_accepted` audit metadata carries `clientRelease`. The value is stored exactly as sent and never read for anything else. |
| 5 | `routes/admin-users.ts`, `scripts/users.ts` | `TermsReport.users[].clientRelease` (nullable). `terms:report` prints it after the version, or `-` when there is none. |
| 6 | `app.ts`, openapi, `src/hosted/api/schema.d.ts` | API `1.39.0-mut354` (the three version pins in the tests move with it). Run `openapi:generate` and `hosted:types`. |
| 7 | `src/hosted/terms.ts` | `TERMS_CLIENT_RELEASE = web-v${APP_VERSION}`: the `web-v<x>` tag name the build already exposes through `__APP_VERSION__` (ADR-081). `SetupPage` and `TermsUpdatePage` send it as `clientRelease`. |
| 8 | Jira | A comment on MUT-344 says the field exists, and suggests the phone send `phone-<version>+<build>`. |

**Tests (written first):**
- `server/src/__tests__/terms.test.ts`:
  - POST with `clientRelease` stores it, and the admin report shows it.
  - POST without it returns 200 and stores null.
  - A 65-character value, or one with a space or a control character, gets 422 and writes no row.
  - A repeat accept with a different release keeps the first one.
  - The redeem works the same way, with and without the field.
  - The audit metadata carries the release.
- `store-contract-account-setup.ts`: the redeem stores `clientRelease`, on both memory and Prisma (`test:db`).
- Portal: `SetupPage.test.tsx` and `TermsUpdatePage.test.tsx` check that the request body carries `clientRelease: 'web-v0.0.0'` (tests define no `__APP_VERSION__`).
- Release-QA: the exact-body checks in `qa/specs/portal/setup.spec.ts` and `terms.spec.ts` add `clientRelease: web-v<package.json version>`. `qa/features/portal/terms.yaml` says in its `expect` that the release is recorded.

**Gates (Node 22):** `lint`, `typecheck`, `test:run`, `build`, plus the server's `typecheck`, `lint`, `openapi:check`, `test` and `test:db`. Then the `@portal.terms.*` and `@portal.setup.*` specs.

## Open question for Basel

**Q1 — which release actually rendered the text?** The terms text renders on the landing (Netlify, the `web-v<x>` deploy). The portal that sends the acceptance ships inside the API image (the `api-v<x>` deploy, ADR-081). The portal's `__APP_VERSION__` is the root `package.json` version at the commit where the server was built.
- Because web releases first (ADR-102 override), that version is normally the live landing's.
- But if web is released again without a server release, the field reports a version one behind the landing.
- The file hash still pins the exact words; only the page code could differ.

This plan ships the ticket's choice (`web-v<x>`) and logs the skew as a TD. The full fix would have the portal read the landing's release, for example from `legal/terms-versions.json`. That adds a cross-origin fetch, so it needs Basel's call.

## QA scenarios

- **setup-records-release:** open a valid setup link, type a password, tick the terms and save. The redeem carries the terms version, the locale and `clientRelease = web-v<x>`.
- **updated-terms-records-release:** sign in behind on the terms and press I agree. The acceptance carries `clientRelease = web-v<x>`.

Both extend the existing `@portal.setup.*` / `@portal.terms.*` specs instead of adding new ones.

## Business / product impact
- Each pilot acceptance names the git tag of the release that rendered it. "What did they agree to" can then be answered from the record, not rebuilt from deploy logs. That matters for a paid pilot under English law.
- Pilot gate (MUT-322). It closes MUT-348's code follow-up and gives MUT-344 a field to fill.
- The cost is low: one nullable column, an optional field, and no change for old clients.

## Eng review (plan-eng-review, 2026-10-20)

**Scope Challenge.** About 18 changed files, but no new classes or services. Every file is one hop on a path that already exists: two write routes, one shared helper, two stores and one report. No smaller arrangement keeps the contract. The session was started by another session and asked not to be questioned, so the structure selector was not put to anyone; I recorded the original arrangement as confirmed. Result: **scope accepted as-is.**
- What already exists: `termsAcceptanceOf` is already shared by both write paths. `APP_VERSION` (`src/lib/appVersion.ts`) is already the portal's version source; the PostHog init uses it too. The terms contract block is at `store-contract-account-setup.ts:300`, and the CLI test at `users-cli.test.ts:169`.
- Not in scope: storing the API release on the server side (the server could know `API_VERSION` for itself, but nobody asked for it); the portal fetching the landing's release (Q1); the phone (MUT-344); the ADR-102 addendum text (MUT-348 docs session).

**1. Architecture**
- [P2] (confidence: 9/10) `server/src/schemas.ts:413`, `TermsAcceptanceRequestSchema = z.object({ version, locale }).strict()`. A client that sends `clientRelease` to a server from before MUT-354 gets a 422 and **cannot accept the terms**.
  - The portal ships inside the same image as the server, so it is safe.
  - The phone (MUT-344) must not send the field until a server with MUT-354 is live.
  - → Accepted: the MUT-344 comment states this ordering, and the CHANGELOG release note repeats it. The redeem schema is not `.strict()`, so it has no such problem.
- [P2] (confidence: 8/10) Q1 above: the reported web version can lag the live landing by one web release. → Pending, Basel's call. It ships as `web-v<x>` per the ticket and goes in as a TD.
- Security: the value comes from the client and is echoed into the operator's terminal by `terms:report`. Only printable ASCII is allowed, so it can't carry terminal escapes. The value is never trusted.

**2. Code quality**
- [P3] (confidence: 7/10) `listLatestTermsVersions` (`ports.ts:1235`) will now return a release too. I'm keeping the name to avoid churn across store-guard and the route-security tables; the comment says what it returns. → Accepted.
- Edge cases: an empty string fails `min(1)` and gets 422; a repeat accept keeps the first release (row idempotency, `memory.ts:1828`).

**3. Tests.** Covered as planned, plus two more:
- The contract checks that the report shows the release of the *latest* version when a person accepted two versions.
- `users-cli.test.ts` prints the release and `-`.

Every path:

```
POST /v1/me/terms-acceptance ─┐
POST /v1/account-setup ───────┼─ ClientReleaseSchema (422) ─ termsAcceptanceOf ─ store.{users.acceptTerms | accountSetup.redeem}
                              │                                                     └─ memory + prisma (contract, test:db)
GET /admin/v1/terms-acceptance ─ listLatestTermsVersions.latestClientRelease ─ users.ts terms (CLI test)
Portal SetupPage / TermsUpdatePage ─ TERMS_CLIENT_RELEASE (unit + @portal.setup/@portal.terms specs)
```

**4. Performance.** One extra column on a select that already exists, with no new queries. No issues found.

**Outside Voice:** skipped for this small ticket, at the caller's request.
**Failure modes:** 0 critical gaps flagged. The one real production failure, a phone sending the field to an old server, is covered by the release-order note.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Outside Review | — | Independent 2nd opinion | 0 | skipped | — |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | ISSUES OPEN | 3 issues, 0 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | — |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **OUTSIDE COVERAGE:** skipped (small ticket, caller asked for a short review).
- **VERDICT:** Eng review run. Two findings are accepted into the plan. Q1 is open but doesn't block the build: it ships as specified in the ticket, with a TD.

**UNRESOLVED DECISIONS:**
- Q1: should `clientRelease` name the landing's live release rather than the web version built into the portal? Basel decides. It ships as `web-v<x>` meanwhile.
