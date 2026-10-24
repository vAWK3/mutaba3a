# MUT-367: Business-email check at signup and the operator review queue

**Ticket:** MUT-367 (epic MUT-322, label `ga-gate`). **Builds:** ADR-159 decision 2, `.claude/designs/mut-331-self-service-signup.md` §3, §6 and §7a, on the seams MUT-366 left (ADR-175 §6).
**Blocked by:** MUT-366, merged to local main as `77985482`. **Blocks:** MUT-368 (the portal's signup, recover and under-review pages).
**Status:** planned 2026-10-23 in Basel's unattended self-service run. D1–D22 below are **pending Basel's confirmation**. Basel reconfirmed the rule on 2026-10-23: webmail and unverified domains wait for review, and disposable domains are refused.
**ADR:** ADR-178. **API:** `1.57.0-mut367`.

## 1. Problem and acceptance criteria

ADR-159 lets a stranger sign up. Basel wants business users automatically, hand-approved webmail, and no throwaway addresses. MUT-366 shipped the signup and recovery routes with every signup ACTIVE. This ticket adds the screen and the queue.

| # | Acceptance criterion (from the ticket) | Proved by |
|---|---|---|
| A1 | A disposable or no-mail domain is refused, and no mail is sent. A fixture business domain is ACTIVE at redeem. `gmail.com` is PENDING_REVIEW. A 12-day-old domain is PENDING_REVIEW with reason `rdap-age-12d`. | `routes-signup-review.test.ts` S1–S5, `email-domains.test.ts` |
| A2 | PENDING_REVIEW with the right password gets 403 `ACCOUNT_UNDER_REVIEW`. With a wrong password it gets the same 401 as an unknown account (timing test). | S6–S8 (cookie and device; one hash verify on each path) |
| A3 | Approve lets the person sign in and mails them. Decline removes the account and its profile, mails them, and the address can sign up again. | S9–S13, the store contract (memory and Postgres) |
| A4 | The digest mail goes out at most once an hour while reviews are pending. | `review-digest.test.ts` |
| A5 | The lists' update script is reproducible. A test pins that the lists parse and contain no duplicates. | `email-domains-lists.test.ts`, `email-domains-update.test.ts` |
| A6 | Server gate: typecheck, lint, `openapi:check`, tests, `test:db`. | §9 |

## 2. What exists (reuse)

- `POST /v1/signups` (`routes/self-service.ts`) has a marked seam after Turnstile and the address budgets, before anything is issued.
- `signupAccountOutcome` (`auth/self-service.ts`) currently returns ACTIVE with the trial starting at once. `recoveryPurposeOf` and `setupLinkState` accept ACTIVE only.
- `accountSetup.issueSignup` / `redeemSignup` (memory and Prisma) take a status and a trial start. The SIGNUP token row is `account_setup_tokens`.
- Mail templates already exist (MUT-359): `account-under-review`, `account-ready`, `account-declined` and `review-digest`. `OPERATOR_ALERT_EMAIL` exists in config but has no reader yet.
- The operator surface pattern: `/admin/v1/firm-requests` with cursor pages, plus `scripts/users.ts` verbs (`firm-requests`, `firm-enable` …) and their npm aliases.
- `signIn()` (`auth/sign-in.ts`) is the one credential check behind cookie and device sign-in.
- `email:check` (`scripts/email-check.ts`) has a `DnsLookup` seam over `node:dns`.

## 3. Design

### 3.1 The domain screen (`server/src/email/domains/`)

```
classify.ts       classifyEmailDomain(domain, deps) → Refusal | Classification   (pure order of checks)
lists.ts          loads disposable.txt / free-webmail.txt once; parseDomainList(); matchesList(domain, set) (domain or any parent)
checker.ts        DomainChecker port { check(domain): Promise<DomainFacts> }
                  CachedDomainChecker (24 h for decisive facts, 10 min for transient, max 10 000 domains)
dns-checker.ts    createDnsDomainChecker({ resolver, rdap, budgetMs: 2000 }): MX, null MX, A/AAAA apex+www, RDAP age
rdap.ts           IANA bootstrap (data.iana.org/rdap/dns.json, cached 24 h) → `${base}domain/<name>`; redirect: 'error'
fixture-checker.ts FIXTURE_DOMAINS table (tests, QA, development)
disposable.txt, free-webmail.txt, relay.txt   vendored, header: source, commit, date, licence
scripts/email-domains-update.ts    `npm --prefix server run email-domains:update [-- --commit <sha>]`
```

The order of checks, the same for every address:
1. **Disposable** (list, the domain or any parent): refuse with `disposable`.
2. **Webmail** (list, the domain or any parent): `webmail`, reasons `['webmail']`. **Relay** (`relay.txt`): business-unverified, `['relay']` (D23). Neither does a DNS lookup.
3. **The checker's facts** (2 s total budget):
   - **No-mail:** a null MX (RFC 7505), or no MX and no A/AAAA on the domain, refuses with `no-mail`. A timeout never refuses.
   - **Business** needs an MX record, the apex or `www.` resolving, and an RDAP registration date at least 90 days old.
   - Anything else is **business-unverified**, with reasons from `no-mx`, `no-web`, `rdap-age-<n>d`, `rdap-not-found`, `rdap-unsupported-tld`, `rdap-no-date`, `rdap-error`, `timeout`.
4. The checker throwing is **business-unverified** with `check-error` (D20). The screen never blocks a signup on its own failure.

The server never fetches the domain's website. DNS goes to the system resolver. RDAP goes only to the registry the IANA bootstrap names for the TLD, and gets only the domain name (D4). RDAP asks about the exact domain only (D6).

`POST /v1/signups` runs the screen at the seam: after Turnstile and the address budgets, before the branch, for every address alike. A refusal is 400 `EMAIL_NOT_ACCEPTED` with `details.reason` `disposable` | `no-mail`. It depends only on the input, so it reveals nothing. The 2 s budget fits inside the 3 s floor. Recovery never screens (ADR-159 §7).

### 3.2 Where the result lives

- **On the SIGNUP token:** `account_setup_tokens.domainClass` (`EmailDomainClass` = BUSINESS | BUSINESS_UNVERIFIED | WEBMAIL, nullable) and `domainReasons text[]`. A CHECK allows them only on SIGNUP rows. `issueSignup` takes `{ domainClass, domainReasons }`.
- **`signupAccountOutcome(link, at)`** returns `{ status: 'ACTIVE', trialStartsAt: at }` for BUSINESS. Anything else, including a link with no class (issued before this migration; none in production, since signup is off; D19), returns `{ status: 'PENDING_REVIEW', trialStartsAt: null }`.
- **`UserStatus` gains `PENDING_REVIEW`.**
- **`signup_reviews`:** `id`, `userId` (unique, FK `ON DELETE SET NULL`), `domain`, `classification`, `reasons text[]`, `createdAt`, `notifiedAt`, `decidedAt`, `decision` (APPROVED | DECLINED), `decidedBy`. CHECK: `decision` and `decidedAt` are both null or both set. There is a partial index on `createdAt` for open rows. `redeemSignup` writes the row in its transaction when the outcome is PENDING_REVIEW.

### 3.3 What PENDING_REVIEW changes

| Surface | Behaviour |
|---|---|
| Sign-in, cookie and device (`signIn()`) | The usual single hash verify. Unknown, locked, wrong password, or DISABLED: the same 401 path as today. **Right password on a PENDING_REVIEW account:** 403 `ACCOUNT_UNDER_REVIEW`, no session, no failure recorded, throttle untouched (D10). |
| Session check (`middleware.ts`) | Already refuses any non-ACTIVE status. Unchanged. |
| SIGNUP redeem | Answers `{ email, status }` (D22), so the portal can show the waiting screen without a sign-in round trip. Mails `account-under-review` to the person (D14) and kicks the digest. |
| Signup for an address held by a pending account | Gets `account-exists`, as ACTIVE does (D8). DISABLED still gets nothing. |
| Recovery | `recoveryPurposeOf`: PENDING_REVIEW gets RESET (they have a password; D9). `setupLinkState` and the stores' `issue` / `redeem` accept PENDING_REVIEW persons. Redeeming sets the password; signing in still answers 403 until approval. |
| Operator `enable` / `disable` | Refused with 409 `CONFLICT`, reason `USER_PENDING_REVIEW`. Approve and decline are the only exits (D11). |
| `/v1/me` | `user.status` is added (always ACTIVE behind a session; billing reads the same field; D16). `UserSummary.status` and the terms report accept PENDING_REVIEW. |
| Billing | A pending account has `trialStartedAt = null`, no session, and so no checkout. Approval starts the trial. |

### 3.4 The operator surface

- `GET /admin/v1/signup-reviews?state=pending|decided&limit&cursor`: oldest first. Each row: `userId`, `email`, `displayName`, `locale`, `domain`, `classification`, `reasons`, `createdAt`, `notifiedAt`, `decidedAt`, `decision`. Decided rows have `email: null` once declined.
- `POST /admin/v1/signup-reviews/{userId}/approve`, in one transaction (D1):
  - status ACTIVE;
  - `trialStartedAt = now` (the column `billing.setTrialStart` writes);
  - review APPROVED;
  - audit `user.signup_approved` (ADMIN) on the personal profile.
  - After the commit it mails `account-ready` with the sign-in link.
  - Errors: 404 if there is no such review, 409 `CONFLICT` with reason `ALREADY_DECIDED`.
- `POST /admin/v1/signup-reviews/{userId}/decline`, in one transaction (D12):
  - deletes the user's open setup links, sessions, memberships, terms acceptances (cascade), the personal profile's audit rows, the personal profile and the user;
  - review DECLINED, with `userId` set null by the FK.
  - If the person holds anything else (another membership, a profile they own besides the personal one, any record), it refuses with 409 `CONFLICT`, reason `NOT_EMPTY`, and nothing changes.
  - After the commit it mails `account-declined` with the support address (`MAIL_REPLY_TO`) and logs `user.signup_declined` with the review id and domain, never the address.
  - The address can sign up again.
- The CLI (`scripts/users.ts` verb `signup-reviews`, npm `signups:review`):
  - `npm --prefix server run signups:review` lists the pending reviews;
  - `-- --approve <email>` and `-- --decline <email>` decide one (D17).

### 3.5 The operator digest (`email/review-digest.ts`)

`createReviewDigest({ store, mailer, logger, to, now, command })` has one method, `announce()`:
1. Count the open reviews not yet announced (`notifiedAt IS NULL`). If there are none, stop.
2. Send `review-digest` to `OPERATOR_ALERT_EMAIL` with `pending` = every open review and idempotency key `review-digest:<UTC hour>`.
3. Only on `sent`, stamp `notifiedAt` on the reviews it counted.

`announce()` runs after each pending redeem, and from the hourly timer in `index.ts`. So every review is announced within about an hour, at most one digest goes out per clock hour, and a quiet queue sends nothing (D13). `review-digest` joins `RECIPIENT_CAP_EXEMPT`, because the recipient is us. If `OPERATOR_ALERT_EMAIL` is unset, there is no digest and boot warns.

### 3.6 Config

| Variable | Rule |
|---|---|
| `EMAIL_DOMAIN_CHECKER` | `dns` \| `fixture`. Default `dns` in production and `fixture` elsewhere. Production refuses `fixture`. |
| `OPERATOR_ALERT_EMAIL` | Existing. Now read by the digest. |

`AppDependencies.selfService.domainScreen` is injectable. Tests and QA use the fixture, so no real DNS runs in any test.

**Fixture table (D3):**

| Domain | Result |
|---|---|
| `business.example`, `studio.example` | business |
| `young.example` | business-unverified, `rdap-age-12d` |
| `nomail.example` | no-mail |
| `unverified.example` | business-unverified, `timeout` |
| anything unlisted | business-unverified, `fixture-unlisted` |

Webmail (`gmail.com` …) and disposable (`mailinator.com` …) come from the real lists in every mode.

## 4. Decisions (all pending Basel's confirmation)

- **D1:** Approval starts the trial inside the approve transaction, writing the column `billing.setTrialStart` writes. It doesn't call `setTrialStart` after the commit, because a failure between the two would leave an ACTIVE account with no trial. This is the same drift as MUT-366 D1.
- **D2:** The vendored lists are hand-made seed lists (well-known disposable services; webmail as in ADR-159 §7a plus regional providers). Downloading the full CC0 list needs Basel's say-so. `email-domains:update` fetches it at a pinned commit and writes a sorted, de-duplicated, webmail-disjoint file. **Operator step:** run it and commit the result before GA.
- **D3:** The fixture table in §3.6, used in tests, QA and development.
- **D4:** RDAP goes through IANA's bootstrap file straight to the registry, not the rdap.org redirector. Redirects aren't followed (`rdap-error`).
- **D5:** The cache keeps decisive facts 24 h and timeouts or errors 10 min, for at most 10 000 domains.
- **D6 (changed by eng review):** A list matches the domain or any parent. RDAP asks about the exact domain only and never walks up, so `me.eu.org` and `mail.firm.co.uk` both land in review (`rdap-not-found`), not on their parent's age. That is conservative, and it needs no Public Suffix List.
- **D7:** The screen runs after Turnstile and the address budgets (the MUT-366 seam), so a refused address has still spent its budget.
- **D8:** A signup for an address held by a PENDING_REVIEW account gets `account-exists`.
- **D9:** Recovery for PENDING_REVIEW mails RESET, and redeem accepts it. An operator setup link for a pending account works too.
- **D10:** 403 `ACCOUNT_UNDER_REVIEW` comes only after the right password on an account that isn't locked. It records no failure and issues no session. It applies to cookie and device sign-in alike.
- **D11:** Operator enable and disable refuse a PENDING_REVIEW account (409 `USER_PENDING_REVIEW`).
- **D12:** Decline hard-deletes the empty account and personal profile. The review row survives with no user and no address. It refuses with `NOT_EMPTY` if anything else exists.
- **D13:** The digest is announce-new-reviews-only, at most one per UTC hour, sent on redeem and by the hourly timer, and exempt from the per-recipient cap.
- **D14:** The person gets `account-under-review` right after a pending redeem.
- **D15:** `decidedBy` is `admin-token`, because the admin token carries no identity.
- **D16:** `/v1/me` `user.status` is additive.
- **D17:** One CLI verb, `signup-reviews`, with `--approve` / `--decline`, aliased `signups:review`.
- **D18:** The admin routes key on `userId`. 404 means no review; 409 `ALREADY_DECIDED`.
- **D19:** A SIGNUP link with no class opens a PENDING_REVIEW account with reason `unclassified`.
- **D20:** A checker that throws gives business-unverified `check-error`.
- **D21:** `signup_reviews.userId` is unique and nullable, FK `SET NULL`.
- **D22:** The SIGNUP redeem answers `status` as well as `email`, additively.
- **D23 (eng review):** A third vendored list, `relay.txt`, holds forwarding and alias services (duck.com, privaterelay.appleid.com, mozmail.com, simplelogin, addy.io …). It classifies as business-unverified with reason `relay`, so the address waits for review. Not refused: a real person may use one.
- **D24 (eng review):** Only ENOTFOUND and ENODATA count as "no record". Every other DNS error (SERVFAIL, REFUSED, timeout) is transient: it never refuses, and it is cached for 10 minutes only.
- **D25 (eng review):** The `/v1/signups` floor starts after the screen. The screen's time depends only on the domain, so it reveals nothing about accounts, and the branch work still sits under a full floor.
- **D26 (eng review):** `account-ready` and `account-declined` are exempt from the per-recipient cap, because only the operator triggers them. The admin answer reports the mail outcome.
- **D27 (eng review):** The hourly digest sweep runs a few minutes after each UTC hour, so a review is announced within about an hour.
- **D28 (eng review):** Approve and decline lock the user row (`FOR UPDATE`) and decide only `WHERE decision IS NULL`. Decline deletes **every** setup link of the user, plus the address's SIGNUP rows (so no copy of the address survives). `NOT_EMPTY` also counts grants and a billing account. After a decline, the route answers 404 for that userId (its review no longer names it).
- **D29 (eng review):** The operator setup-link route accepts a PENDING_REVIEW person (recovery parity). The co-owner grant keeps refusing a non-ACTIVE person. `UserStatus` + `PENDING_REVIEW` goes in its own migration, before anything uses the value.

## 5. Impact

- **Schema:** one migration:
  - `UserStatus` + `PENDING_REVIEW`;
  - `EmailDomainClass` and `SignupReviewDecision` enums;
  - two token columns and a CHECK;
  - the `signup_reviews` table.
- **Contract:** the API becomes `1.57.0-mut367`, all additive:
  - `POST /v1/signups` 400 `EMAIL_NOT_ACCEPTED`;
  - sign-in 403 `ACCOUNT_UNDER_REVIEW`;
  - redeem `status`;
  - `Me.user.status`;
  - the PENDING_REVIEW enum values;
  - three admin routes.
  - The portal's `schema.d.ts` is regenerated.
- **Production:** nothing changes until `self_signup_enabled = true` and the mailer is on.
- **Cost:** one DNS round of 3–5 queries and one or two RDAP GETs per uncached domain, at signup only.
- **i18n:** the mail copy is already in en and ar. The portal copy is MUT-368's.
- **Infra:** none (no Terraform). `EMAIL_DOMAIN_CHECKER` stays at its default in production.
- **Local mode:** `signupReviews` is a new MemoryLedgerStore map. It is not in the local snapshot, because local mode has no signups. If the fingerprint test says otherwise, it gets a format 5 migration.

## 6. QA scenarios (release-qa)

This ticket ships server and operator code only. No portal file changes, so no `portal` watch path is touched, and `release-qa lint` has nothing new to map. The user-visible flows are MUT-368's to automate, on these server behaviours (ids from mut-331 §11):

| Feature id (MUT-368) | Steps | Promised outcome (server side, built here) |
|---|---|---|
| `signup.disposable` | Sign up with `x@mailinator.com` | 400 `EMAIL_NOT_ACCEPTED`, reason `disposable`; no mail |
| `signup.no-mail-domain` | Sign up with `x@nomail.example` | 400 `EMAIL_NOT_ACCEPTED`, reason `no-mail`; no mail |
| `signup.business-instant` | Sign up with `x@business.example`, finish /setup, sign in | redeem `status: ACTIVE`; sign-in 201 |
| `signup.review-webmail` (core) | Sign up with `x@gmail.com`, finish /setup; operator approves; sign in | redeem `status: PENDING_REVIEW`; under-review mail; sign-in 403 `ACCOUNT_UNDER_REVIEW`; after approve, an account-ready mail and sign-in 201 |
| `signup.review-declined` | Same; the operator declines | a declined mail; sign-in 401 like an unknown account; the address can sign up again |

The server side of each is a vitest scenario (§1). MUT-368 drives them through the dev outbox and the admin routes.

## 7. Business / product impact

- GA signup can open without letting anonymous throwaway accounts into a paid product. Basel keeps the hand-approval he asked for, and business domains get in instantly.
- This unblocks MUT-368 (the portal pages), and through it MUT-418/361 (trial start and paywall).
- Risk: at GA most freelancers land in the queue (about 5 a day). The digest and a one-line CLI keep the 2-working-day promise cheap.

## 8. Engineering review (2026-10-23, unattended; plan-eng-review + an independent subagent pass)

**Scope Challenge:** scope accepted as-is. The plan touches about 25 files and adds 4 small units (the screen, the checkers, the digest, the review routes), which is over the complexity gate. In this unattended run the original arrangement is kept: each unit maps to one acceptance criterion, and a smaller arrangement would merge unrelated concerns. Search: unavailable (no Aside or WebSearch in this run), so in-distribution knowledge only.

**Findings and dispositions** (all accepted into the plan as D23–D29, pending Basel):

- `[P1] (9/10)` `prisma/schema.prisma` AccountSetupToken `onDelete: Restrict`: decline must delete every token of the user, not only open ones. **Accepted** (D28).
- `[P1] (8/10)` §3.1 RDAP walk-up would rate `x@me.eu.org` (a free subdomain) as BUSINESS on its parent's age. **Accepted:** no walk-up (D6).
- `[P1] (7/10)` Relay and alias providers pass every check. **Accepted:** `relay.txt` sends them to review (D23).
- `[P2] (8/10)` SIGNUP token rows keep a declined address forever (`pruneSignupLinks` keeps used rows). **Accepted** (D28).
- `[P2] (7/10)` Approve and decline races. **Accepted:** row lock plus `decision IS NULL` (D28), and a parallel contract test.
- `[P2] (7/10)` `ports.ts:34` `RECIPIENT_CAP_EXEMPT` would let strangers cap the approval mail. **Accepted** (D26).
- `[P2] (6/10)` DNS SERVFAIL read as no-mail would refuse a real person. **Accepted** (D24).
- `[P2] (5/10)` `self-service.ts:157` starts the floor before Turnstile, so the screen could push the branch past the floor. **Accepted** (D25).
- `[P3] (6/10)` Digest latency up to about 2 h with a boot-relative timer. **Accepted** (D27).
- `[P3] (7/10)` D18 after a decline: the route answers 404. **Accepted** and documented (D28).
- `[P3] (6/10)` `admin-users.ts:409` refuses non-ACTIVE setup links, and the enum ADD VALUE needs its own migration. **Accepted** (D29).
- `[P3] (5/10)` A business domain gives unlimited instant trials (`+tags`). **Deferred** to TD-213, a per-domain instant-signup budget.

**Failure modes** (one per new path; none silent): the screen times out (unverified, review); RDAP bootstrap is unreachable (`rdap-error`, review); the mailer is off (decision still commits, admin answer says `disabled`); a digest send fails (`notifiedAt` stays null, the next sweep retries); decline meets data (409 `NOT_EMPTY`, nothing deleted). Critical gaps: 0.

**Test diagram** (each row is a vitest case; DB rows also run under `test:db`):

```
signup → screen ─┬─ disposable / no-mail → 400, no mail, no token          [routes-signup-review S1,S2]
                 ├─ business → token BUSINESS → redeem ACTIVE + trial        [S3]
                 ├─ webmail / young / relay / unlisted → PENDING_REVIEW      [S4,S5] + review row + 2 mails
pending ─ sign-in right pw → 403 | wrong pw → 401 = unknown | locked → 401  [S6–S8, cookie + device]
pending ─ recovery → RESET → redeem OK → still 403                         [S9]
approve → ACTIVE + trial + mail + audit → sign-in 201 | twice → 409         [S10,S11; contract]
decline → user/profile/tokens gone, mail, review kept → re-signup works     [S12,S13; contract test:db]
digest → once per UTC hour, only new reviews, stamps on sent only           [review-digest.test]
lists → parse, sorted, no dups, disjoint; update script deterministic       [email-domains-lists/update]
dns checker → MX/null MX/A/AAAA/RDAP age/errno/timeout via fake resolver    [dns-checker.test]
```

## 9. Code review (before merge, 2026-10-23; as built)

Ten findings from a high-effort review of the diff. Eight were fixed:

- **RDAP bootstrap fetch:** one IANA bootstrap fetch is shared by every lookup, on its own 10 s timeout. A check that reaches its budget stops waiting but no longer cancels the fetch for the others. After a failure with nothing cached, IANA isn't asked again for 10 minutes. Two new tests.
- **D25, as built:** the `/v1/signups` floor now runs from *before* the screen and covers the screen's budget too (`floors.screenMs`, 2 s in production). So a cached domain answers no sooner than a fresh one, and the branch still gets a full floor.
- **Cache:** concurrent checks of one domain share one lookup.
- **Lists:** they are read when the screen is built (boot), so a missing or bad list fails the deploy.
- **Digest:** the redeem no longer waits for it (`void`). The person's own under-review mail is still sent inside the request.
- **Granting access:** the operator can't grant access to a pending signup (409 `USER_PENDING_REVIEW`), which would also have blocked its decline.
- **Review domain:** the review row's domain uses `domainOf` (punycode, lower case).
- **Memory decline:** it also counts org-scoped idempotency records, as Postgres' RESTRICT does.

Two were kept, as decided:

- **Subdomain addresses** (`a@eng.acme.com`) go to review. This is D6: a walk-up would need the Public Suffix List, and without it free subdomain services would pass as business.
- **No release-QA flow** for the operator surface. The server and CLI are not a release-qa app here. MUT-368's portal flows drive these routes (§6).

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | not run | — |
| Outside Review | native Claude subagent (codex not installed) | Independent 2nd opinion | 1 | complete | 12 findings, 11 accepted, 1 deferred |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | issues_open (all mapped into the plan) | 11 issues, 0 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | n/a (no UI) | — |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | not run | — |

- **OUTSIDE COVERAGE:** a native Claude subagent, plan phase, complete, 12 findings. Codex was unavailable (not installed). A native fallback is not external coverage.
- **VERDICT:** Eng review complete, with every finding folded into D23–D29 (pending Basel's confirmation). Ready to implement.

NO UNRESOLVED DECISIONS
