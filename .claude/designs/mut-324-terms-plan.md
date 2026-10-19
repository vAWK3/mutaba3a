# MUT-324 — Terms of service, a hosted-accounts privacy section, accepted at setup

> Ticket: MUT-324, under epic MUT-322 (pilot gate). Branch `feature/mut-324-terms`, in worktree `.claude/worktrees/mut-322-pilot-readiness`.
>
> Decisions Basel has already made (2026-10-19), recorded in the MUT-324 comment:
> - **Contracting party:** Barmajiyat Ltd (UK).
> - **Governing law:** England & Wales.
> - **Review:** Basel reviews the text himself.
> - **Account closing:** 30 days' grace, then a hard delete; backups age out 14 days later.
> - **Lapsed payment:** read-only + export.
> - **Support:** email, reply within 2 working days.


## 0. Approved plan (after the eng review, 2026-10-19). This section wins over §2–§4 wherever they differ

**Decisions and answers (D1–D12 + TODO):**

| # | Decided | Basel's answer |
|---|---|---|
| R7 | **Keep the "Updated terms" step at sign-in.** Existing accounts already have passwords, so they accept there, and every later version bump goes the same way. | D1 = A |
| R10 | **Each person accepts for themselves, and as owner for the profiles they own.** The audit row `user.terms_accepted` goes only on the profiles they own, never on firms they're merely a member of. | D2 = A |
| R9 | **Acceptance records are deleted with the account** (MUT-333). `TermsAcceptance.userId` cascades on delete. This is the schema's first cascade, and it's deliberate. The privacy section says acceptance records go with the account. | D3 = B |
| R11 | **Record the locale** (`en`/`ar`) on each acceptance. The governing-law section says: "If the English and Arabic texts differ, the English text prevails." | D4 = A |
| R8 | **Frozen, versioned texts.** Each version's text is a content file that is never edited after release: `src/content/legal/terms/<version>.{en,ar}.json`. It's served at `/terms/<version>`, and `/terms` shows the latest. `server/src/legal.ts` holds `CURRENT_TERMS_VERSION` plus the sha256 of the EN and AR files. Each acceptance row stores the hash of the text in the language read. The portal links open `/terms/<the version being accepted>`. | D5 = A |
| R12 | **A way out of the update step.** It offers "I agree", "Sign out", and a line with the support email and how to close the account. "Download my records" is added when MUT-325 ships (TODO(MUT-325)). | D6 = A |
| R3 | **Only the portal enforces acceptance.** The setup redeem requires it, and AuthGate shows the update step. The server doesn't refuse writes. Logged as TD: older phone builds can save without accepting. | D7 = A |
| R4 | **The phone part becomes a new Flutter ticket:** a Settings → Terms link and the update step, driven by `/v1/me.terms`. MUT-324's Jira acceptance criteria drop the phone link. | D8 = A |
| S1 | **Smaller arrangement.** One new table, reached through methods on the existing users repository: `store.users.latestTermsAcceptance(userId)` and `store.users.acceptTerms({...})`, in Prisma and memory. No new repository port. `LegalPage` is shared by /privacy and /terms. | D9 = A |
| R13 | **"Accepted" means the latest accepted version is the current one or newer.** Versions are ISO dates, compared as strings. A rollback doesn't ask people again. | D10 = A |
| R2 | **A deploy guard.** Netlify answers every path with the app shell, so the guard can't fetch `/terms/<v>` to check it. Instead, the landing build emits `legal/terms-versions.json` (`{ versions: [{ version, sha256: { en, ar } }] }`), the same way `__forms.html` is emitted. `server/scripts/deploy.sh` refuses to release when the public site's file lacks `CURRENT_TERMS_VERSION` with matching hashes. Runbook rule: web first. | D11 = A |
| R5 | **The setup-page regression contract is preserved**, with tests: the password policy and its message; a lost answer (TD-149) still signs in; sign-in after redeem; every refusal state (expired, used, superseded, invalid); and a RESET link still works after acceptance. Intentional changes: the required tick, and the new "terms changed" state. | D12 = A |
| T1 | **Build it now:** `npm run users -- terms` lists every active user and their latest accepted version, flagging anyone behind the current one. The admin users list gains `terms`. | TODO = C |

**Corrections C1–C8 (no question needed: they're required for the plan's own contract to work).** These are in the review section below:
- **C1:** the redeem's acceptance is upsert-or-skip.
- **C2:** `/check` returns `termsVersion`.
- **C3:** new error codes, plus the `redeemFailure` mapping.
- **C4:** order: link state → version → hash.
- **C5:** `ORGANIZATION_INDEPENDENT_ROUTES`.
- **C6:** local mode returns `terms: null`.
- **C7:** surface = `portal|phone` from `Session.kind`.
- **C8:** the Jira AC update.

**What changes in §3 because of these answers:**
- **Schema:** `TermsAcceptance { id, userId → User onDelete: Cascade, version VarChar(10), locale VarChar(5), textSha256 Char(64), surface TermsSurface(portal|phone), acceptedAt; @@unique([userId, version]); @@index([userId, version]) }`.
- **Me:** `terms: { version, accepted, textUrl } | null`. It's null in local mode. `accepted` = latest ≥ current.
- **Check response:** `POST /v1/account-setup/check` returns `termsVersion`.
- **Redeem:** requires `acceptedTermsVersion` + `locale`. The order is link state → version (409 `TERMS_VERSION_STALE` / 422 → `TERMS_VERSION_REQUIRED`) → hash → redeem. The redeem does an upsert-or-skip of the acceptance in its own transaction.
- **Accept route:** `POST /v1/me/terms-acceptance { version, locale }`, on a portal or device session, listed in `ORGANIZATION_INDEPENDENT_ROUTES`, idempotent. The audit goes on owned profiles only.
- **Landing:**
  - `TermsPage` reads `/terms/:version?`.
  - Content is lazily imported from `src/content/legal/terms/<version>.<lang>.json`. An unknown version shows "This version doesn't exist" with a link to the latest.
  - The privacy section stays in the i18n keys. Only the terms are versioned.
- **Release-QA:** scenario 4 seeds an older-version acceptance through the test API helper. The spec arranges it; nothing production-side is added for it.
- **Out:** the phone (new Flutter ticket); enforcing acceptance on writes (TD).

## 1. Context

**Related tickets:**
- **MUT-236 / MUT-235:** setup links. This ticket extends the redeem step.
- **MUT-153:** the privacy wording rules.
- **MUT-150:** Sentry's privacy paragraph. Same page, a different section.
- **MUT-323:** the pilot offer that /terms refers to.
- **MUT-325:** export (the terms promise it).
- **MUT-333:** account closing (the terms promise it).
- **MUT-326:** the domain. Until it lands, the terms link is a build-time origin define.
- **Phone:** has **no** privacy or terms link today (`grep -ri privacy mutaba3a-flutter/mutaba3a/lib` finds nothing).

**Blockers:** none. MUT-323's prices are drafted on `feature/mut-323-pilot-offer`, and /terms only refers to "the price in your offer", so it doesn't depend on them.

**Landmines:**
- **The portal's signed-out mode runs the real server routes over `MemoryLedgerStore`** (ADR-097/100). A new store method needs a memory implementation. A new snapshot map would change the local format, which MUT-287 D4 fingerprints and which is shipped (api-v0.3.14). So acceptances live in a **map that is not part of the snapshot**, and the local mode never asks for acceptance.
- **The text and the version ship separately.** The terms text ships with the landing page (Netlify, web build). The current version ships with the API image. They must not drift (D3).
- **`no-self-registration.test.ts`** pins the public routes. The new acceptance route sits behind a session, so the pinned public list doesn't change.

## 2. Decisions

| # | Decision | Recommended | Alternatives |
|---|---|---|---|
| D1 | **Where acceptance is enforced** | **The setup redeem enforces it on the server; the portal gates already-signed-in users.** `POST /v1/account-setup` requires `acceptedTermsVersion` to equal the current version. `/v1/me` reports whether the current version is accepted, and the portal blocks the shell with an "Updated terms" step until it is. Writes are *not* refused on the server: old phone builds keep working. | (b) The server refuses every write with 409 `TERMS_NOT_ACCEPTED` until accepted. This is the strongest guarantee, but every installed phone build breaks until it learns the new error (MUT-293 could force an update). |
| D2 | **Storage** | **A new `terms_acceptances` table:** `(id, userId, version, acceptedAt, surface: portal\|ios\|android)`, unique on `(userId, version)`. That keeps a full history, which is the evidence a dispute needs. No IP is stored. | Two columns on `User`. Simpler, but each new acceptance overwrites the proof of the last. |
| D3 | **One version, two deploys** | **The server constant `CURRENT_TERMS_VERSION` (`server/src/legal.ts`, e.g. `'2026-11-01'`) is the source.** Landing i18n carries `landing.terms.version` with the same string. A root test (`scripts/__tests__/legal-version.test.ts`, the same pattern as analytics-taxonomy's currency pin) fails when they differ. **Release order:** web first, then server. The runbook says so. | The server serves the text too. That moves legal copy into the API image, and the landing would need a fetch. |
| D4 | **Phone** | **Split it into a Flutter ticket:** a Settings link to /terms, plus the same "Updated terms" step, driven by `/v1/me.terms`. MUT-324 ships the API field and the accept route. The device session can call it. | Do it in MUT-324. That's two repos and one release order in one ticket, against how MUT-279/280 were split. |
| D5 | **Link target** | **A new build define, `__TERMS_URL__`**, built from `MUTABA3A_PUBLIC_ORIGIN ?? DEFAULT_PUBLIC_ORIGIN` + `/terms`, the same shape as `__HOSTED_OFFER_URL__` (ADR-076). MUT-326 later folds every origin into one config. | Hardcode the URL. That breaks the moment the domain moves. |
| D6 | **The text** | **Claude drafts the EN and AR terms and the privacy section. Basel approves the wording before merge (AC1).** Each section is an i18n key list, rendered like the privacy page's `SECTION_KEYS`. | — |

## 3. Implementation

### 3.1 Server (`server/`)

- **`prisma/schema.prisma` + migration `2026xxxx_mut324_terms_acceptances`:**
  - `model TermsAcceptance { id, userId → User (cascade), version VarChar(20), surface enum, acceptedAt; @@unique([userId, version]) }`.
  - Append-only migration.
- **`src/legal.ts`:** `CURRENT_TERMS_VERSION`, plus `TermsSurface`.
- **`src/repositories/ports.ts`:**
  - A `TermsAcceptanceRepository` with `isAccepted(userId, version)` and `accept({ userId, version, surface, at, audit })`, where `accept` is an idempotent upsert-or-skip and writes audit in the same transaction.
  - `RedeemSetupLinkInput` gains `termsVersion`, so the redeem records acceptance in its own transaction.
- **`src/repositories/prisma.ts`:** implements the above; the redeem transaction inserts the acceptance row.
- **`src/repositories/memory.ts`:** implements the above with an in-memory map, **kept out of `snapshot()`/`restore()`**, plus a comment saying why.
- **`src/schemas.ts`:**
  - `SetupLinkRedeemRequestSchema` gains `acceptedTermsVersion` (required).
  - `MeSchema` gains `terms: { version, accepted: boolean }`.
  - New `TermsAcceptanceRequestSchema { version }`.
  - Error `TERMS_VERSION_STALE` (409, `details.current`).
- **`src/routes/account-setup.ts`:** redeem refuses a missing or stale version *before* hashing (cheap), then passes the version to `redeem`.
- **`src/routes/me.ts`:** includes `terms`. This is one indexed lookup per `/v1/me`; no extra round trips elsewhere.
- **`src/routes/sessions.ts`:**
  - New `POST /v1/me/terms-acceptance` next to `PATCH /v1/me/malafat-suggestions`.
  - Accepts a portal session or a device session. The surface comes from the principal (portal / ios / android), never from the body.
  - The version must equal current, else 409.
  - Audit `user.terms_accepted`, one row per membership, like `user.password_set`.
- **`API_VERSION`:** `1.38.0-mut324`. Regenerate `openapi.json`, then `src/hosted/api/schema.d.ts`.

### 3.2 Landing (web build)

- **`src/pages/landing/TermsPage.tsx` + CSS:** reuses `PrivacyPolicyPage`'s layout and classes. **Don't copy it:** extract a small `LegalPage` (title, updated, intro, sections from a key list) that both pages render.
- **`src/main.tsx`:** a `/terms` branch, lazy like `/privacy`. `marketingPath` needs no change.
- **i18n `landing.json` (en + ar):**
  - `landing.terms.*`: `version`, `updated`, `intro`, and these sections: service, account, fees, data ownership, export, closing + deletion, lapsed payment, acceptable use, not an accountant, availability, liability, changes, governing law, contact.
  - `landing.privacyPolicy.hostedAccounts.*`: region `me-west1`, backups for 14 days, sub-processors (Google Cloud, Netlify, Sentry EU scrubbed, PostHog EU opt-in), operator access, retention after closing.
  - The privacy page inserts `hostedAccounts` after `mobile`.
- **`LandingFooter`:** a Terms link. **`HostedOfferPage`:** a Terms link beside the privacy link in the form notice.

### 3.3 Portal (`src/hosted/`)

- **`vite.config.ts` + `src/vite-env.d.ts`:** `__TERMS_URL__`, plus the `vite-config.test.ts` snapshot update.
- **`pages/auth/SetupPage.tsx`:**
  - A required "I agree to the terms" checkbox with a link.
  - Submit is disabled until it's ticked; the error reads "Tick to agree to the terms".
  - It sends `acceptedTermsVersion`.
  - A 409 stale answer shows "The terms changed while this page was open. Read them again", with the new version.
- **`session/AuthGate.tsx`:** when `me.terms.accepted === false` and not in local mode, render `pages/auth/TermsUpdatePage.tsx` instead of the outlet. It's a full-screen card with "Read the terms" (new tab), "I agree" and "Sign out". On success it invalidates `meQuery`.
- **`shell/UserMenu.tsx`:** a Terms item, in both modes. **`SignInPage`:** a Terms link under the card.
- **`src/hosted/i18n` (en + ar):** `hosted.terms.*`.

### 3.4 Knowledge and QA

- **ADR-102:** terms acceptance (D1–D5). Re-check the number at merge.
- **TD (next free):** "acceptance isn't enforced on writes" (D1 trade-off).
- CHANGELOG, SYSTEM_OVERVIEW, COMPONENT_REGISTRY (`LegalPage`), TEST_PLAN, INFRA (the release order for the version).
- **Release-QA:**
  - `qa/features/web/legal.yaml`: `web.legal.terms-page` (en + ar, 375), `web.legal.footer-links`.
  - `qa/features/portal/terms.yaml`: `portal.terms.setup-requires-accept`, `portal.terms.updated-terms-step`, `portal.terms.menu-link`.
  - Specs go in `qa/specs/{web,portal}/`.

## 4. Tests (TDD: written first)

**Server, unit and route (`npm --prefix server test`):**
- A redeem without `acceptedTermsVersion` → 422.
- A redeem with a stale version → 409 `TERMS_VERSION_STALE`. No password is set and nothing is hashed (hasher spy).
- A valid redeem records exactly one acceptance (surface portal) plus a `user.terms_accepted` audit per membership.
- `/v1/me` reports `terms.accepted` false before acceptance and true after. A version bump flips it back to false.
- `POST /v1/me/terms-acceptance`:
  - accepting twice is idempotent: one row, one audit;
  - a stale version → 409;
  - a device session records surface ios or android;
  - signed out → 401.
- Memory store: an acceptance is never in `snapshot()`, so the format fingerprint is unchanged (the fingerprint test stays green with no edit).

**Server, Postgres (`test:db`):** the unique constraint holds under two concurrent accepts; the redeem and the acceptance roll back together.

**App (`npm run test:run`):**
- `TermsPage` renders every section key in en and ar.
- The key-parity test (en ↔ ar, like `hostedOfferKeys.test.ts`).
- The footer and /hosted links.
- `LegalPage` is shared by both pages.
- `SetupPage`: can't submit unticked; sends the version; the stale-409 copy.
- `AuthGate`: the update step shows when not accepted; it's never shown in local mode; "I agree" invalidates `/v1/me`.
- `UserMenu` shows the Terms item.
- `legal-version.test.ts`: the landing version equals the server constant.

**Gate (Node 22):** lint, typecheck, `test:run`, build, `test:bundles`. Server: typecheck, lint, `openapi:check`, test. Then `release-qa lint`, and the new specs on preview builds.

## 5. Scale and cost

- `/v1/me` adds one primary-key-indexed lookup, so a session costs nothing extra.
- Rows: one per user per version.
- No new service and no new dependency.

## 6. QA scenarios (release-QA)

1. **Read the terms:** open /terms in Arabic and in English → every section shows, with the version date. At 375px nothing scrolls sideways.
2. **The footer** on /, /privacy and /hosted links to /terms.
3. **Accept at setup:** open a setup link → Save is blocked until "I agree" is ticked → after ticking, the password is set, the user is signed in, and they don't see the update step.
4. **Updated terms:** a signed-in user whose acceptance is for an older version sees the "Updated terms" step → I agree → lands on their Overview → reloading doesn't show the step again.
5. **The account menu** has Terms, signed in and signed out.

## 7. Out of scope

- The phone's link and update step (the new Flutter ticket, D4).
- A DPA template.
- Cookie banners.
- Enforcing acceptance on writes (the TD).
- Prices in the terms: they refer to the offer.

---

# Eng review (/plan-eng-review, 2026-10-19)

**Target:** this plan, `.claude/designs/mut-324-terms-plan.md`, on branch `feature/mut-324-terms`. This file is the report file.

## Scope Challenge

**Complexity:** about 31 files are touched, and the plan adds 6 new units: the TermsAcceptance repository port plus its Prisma and memory implementations, LegalPage, TermsPage and TermsUpdatePage. That is over the 8-file / 2-class gate, so the review asks a structure question. No features are proposed for cutting: every link and screen maps to an acceptance criterion.

**Already done:** nothing. `git log origin/main main --grep terms|TermsAccept|MUT-324` has no hits, and no branch matches.

**Reality rows:**
```
REALITY: premise-table finding 7 premises, unverified=0; one false: the "surface ios|android from principal" premise. Session.kind is only cookie|device. server/prisma/schema.prisma:340-343
REALITY: already-done pass no terms work on origin/main or local main. git log --grep (2026-10-19)
REALITY: surface-check finding POST /v1/me/terms-acceptance must join the route list beside 'PATCH /v1/me/malafat-suggestions'. server/src/routes/sessions.ts:33
REALITY: binding-decisions pass none recorded on the branch; Basel's MUT-324 comment decisions (UK law, self-review, 30+14 days) are honoured. Jira MUT-324 comment 12130
REALITY: numbers pass "one indexed lookup per /v1/me" [estimated]; 31 files [estimated]. plan §3, §5
REALITY: deferred-asks finding the ticket's "phone Settings" link moves to a Flutter ticket (D4). Jira MUT-324 scope (in)
REALITY: pr-count pass one PR (no .gstack/ship-policy.json)
REALITY: transaction-semantics pass the acceptance insert joins the existing redeem $transaction. server/src/repositories/prisma.ts:356-374
```

**Premises checked:**

| Premise | Receipt | Verdict |
|---|---|---|
| The redeem is one transaction we can add to | `prisma.ts:356` `this.prisma.$transaction(async (tx) => {` | true |
| `snapshot()` lists maps explicitly | `memory.ts:1802-1832` | true: a new map stays out of the format |
| `buildMe` serves /v1/me, sign-in and device sign-in | `me.ts:44`, `sessions.ts:83`, `device-sessions.ts:66` | true |
| The me-write route accepts a portal or a device session | `sessions.ts:115` `security: [{ session: [] }, { deviceSession: [] }]` | true |
| A session knows ios vs android | `schema.prisma:340` `enum SessionKind { cookie device }` | **false** |
| The phone tolerates new Me fields | `auth.dart`: freezed, with no `disallowUnrecognizedKeys` | true |
| Audit goes per membership, like password_set | `account-setup.ts` `passwordSetAudit` | true |

## Findings (ranked)

- **[P2] (confidence: 9/10) plan §3.1 / D2:** "the surface comes from the principal (portal / ios / android)". The principal only has `kind cookie|device` (`schema.prisma:340`). → decision **R1**.
- **[P2] (confidence: 8/10) plan D3:** the code-level pin catches a version mismatch in the source, not a **deploy-time** one. If `make release server` runs before Netlify has the new text, every signed-in user is asked to accept a version /terms doesn't show yet. → decision **R2**.
- **[P2] (confidence: 8/10) plan D1:** existing users who only use the phone are never asked until the Flutter ticket ships, and the API never enforces acceptance. This is a deliberate trade-off. → decisions **R3** (D1) and **R4** (D4).
- **[P2] (confidence: 9/10) `SetupPage.tsx:186-216` regression risk:** the new required tick changes the one way a pilot user gets in. The existing behaviours to keep are the password policy, the lost-answer handling (TD-149) and sign-in after redeem. They need a regression contract (IRON RULE). → decision **R5**.
- **[P3] (confidence: 8/10) `sessions.ts:33`:** the new route has to be listed beside `PATCH /v1/me/malafat-suggestions`. If the portal's local mode routes through that list, it also needs the memory implementation. This is a correction folded into the plan, not a decision.
- **[P3] (confidence: 7/10) plan §3.2:** extracting `LegalPage` has exactly two callers: `PrivacyPolicyPage` today and `TermsPage` proposed. That is enough to justify a shared component, but it still needs approval. → decision **R6**.

**Performance:** no issues. `/v1/me` adds one lookup on a unique `(userId, version)` index, and nothing runs in a loop.


## Outside voice (Claude Plan subagent, native fallback)

Codex isn't installed, so a Plan subagent reviewed instead. It finished inside the 5-minute limit. **This doesn't count as outside coverage.** It made 17 findings. I verified three of them against the code:
- `ORGANIZATION_INDEPENDENT_ROUTES` at `sessions.ts:32`;
- `schema.prisma` has **no** `Cascade` at all;
- `setupLink.ts:62` maps every 422 to `policy`.

**Corrections folded into the plan without a question.** Each one is required for the plan's own contract to work:
- **C1 (O6):** the redeem's acceptance write is the same upsert-or-skip as `accept`. A RESET link after acceptance must still work, and a regression test covers it.
- **C2 (O7):** the version comes from the server. `POST /v1/account-setup/check` returns `termsVersion` and the page echoes it back, so there is no third copy of the constant.
- **C3 (O8):** a new code, `TERMS_VERSION_REQUIRED` or `TERMS_VERSION_STALE` (409, `details.current`). `setupLink.ts` `redeemFailure` maps it to a "terms changed" state, never to `policy` or `unreachable`. Tests go in `setupLink.test.ts`.
- **C4 (O9):** order on redeem: link state → version check → hash.
- **C5 (O12, plus my sessions.ts:33 finding):** `POST /v1/me/terms-acceptance` joins `ORGANIZATION_INDEPENDENT_ROUTES`. It's tested with zero profiles and no profile header.
- **C6 (O14):** `buildMe` takes `{ termsRequired }`, and the local app passes false, so `terms: null`. AuthGate gates on `terms?.accepted === false`, with no mode check.
- **C7 (R1):** surface = `portal | phone`, derived from `Session.kind`.
- **C8 (O16):** update MUT-324's acceptance criteria in Jira once R4 is answered.

## Decision ledger

Each answer was given through AskUserQuestion on 2026-10-19 in this session. Everything is **approved**, with the accepted scope as in §0.

- **R7** (D1 = A): keep the update step at sign-in.
- **R10** (D2 = A): the person accepts, plus profiles they own; audit on owned profiles.
- **R9** (D3 = B): records are deleted with the account (cascade).
- **R11** (D4 = A): English prevails; the locale is recorded.
- **R8** (D5 = A): frozen versioned texts plus sha256; the portal links to the version.
- **R12** (D6 = A): the support email and how to close the account; export once MUT-325 ships.
- **R3** (D7 = A): only the portal enforces acceptance, plus a TD.
- **R4** (D8 = A): a Flutter ticket; the MUT-324 AC are updated.
- **S1** (D9 = A): the smaller arrangement, with methods on users.
- **R13** (D10 = A): latest ≥ current.
- **R2** (D11 = A): `legal/terms-versions.json`, plus a deploy.sh guard.
- **R5** (D12 = A): the regression contract as listed.
- **T1** (TODO = C): `users terms`, built now.
- **R1:** folded into C7, as a factual correction (the platform isn't recorded).

**Approval readiness: PASS.** IDs R1–R13, S1 and T1 were checked against the answers to D1–D12 and the TODO. C1–C8 are required implementation of the approved contract.

## Test coverage (planned)

```
CODE PATHS (server)                                       USER FLOWS
[+] POST /v1/account-setup/check                          [+] New account (setup link)
  └── returns termsVersion ............ [GAP→test]          ├── [GAP→E2E] untick blocks Save, tick → signed in, no step
[+] POST /v1/account-setup (redeem)                         ├── [GAP] page open across a deploy → "terms changed"
  ├── link invalid/used/expired → 410 . [★★★ existing]      └── [GAP] RESET link after acceptance still works
  ├── version missing → 422 REQUIRED .. [GAP→test]        [+] Existing account
  ├── version stale → 409 STALE ....... [GAP→test]          ├── [GAP→E2E] older acceptance → update step → agree → Overview
  ├── order: 410 wins over stale ...... [GAP→test]          ├── [GAP] decline → support email + sign out visible
  ├── acceptance upsert-or-skip ....... [GAP→test]          └── [GAP] reload after agree → no step
  └── tx rollback keeps both unwritten  [GAP→test:db]     [+] Reading
[+] buildMe terms                                           ├── [GAP→E2E] /terms en + ar, 375px, no sideways scroll
  ├── latest ≥ current → accepted ..... [GAP→test]          ├── [GAP] /terms/<old> shows that frozen text
  ├── none / older → not accepted ..... [GAP→test]          └── [GAP] /terms/<unknown> → "doesn't exist" + latest link
  └── local mode → null ............... [GAP→test]        [+] Links: footer, /hosted, sign-in, menu .. [GAP]
[+] POST /v1/me/terms-acceptance
  ├── idempotent, one row, audit owned only [GAP→test]    RELEASE
  ├── stale → 409; signed out → 401 .. [GAP→test]          [+] deploy.sh guard: missing version/hash → refuse [GAP→test]
  ├── zero profiles, no header → 200 . [GAP→test]          [+] legal-version.test: content sha256 == legal.ts [GAP→test]
  └── device session → surface phone . [GAP→test]          [+] users terms: lists behind-current users [GAP→test]
[+] memory store: acceptances not in snapshot; fingerprint unchanged [★★★ existing fingerprint test]
```

`COVERAGE`: 2/30 paths are covered by existing tests; 28 gaps, all in §4 plus this diagram (4 E2E).

**Value cards** (Critical Paths): see the test-plan artifact. **Tests to retire:** none. **Regression (CRITICAL, R5):** the existing `SetupPage.test.tsx` and `setupLink.test.ts` cases stay, edited only where the tick is now required.

## Failure modes

| New path | Realistic failure | Covered by | What the user sees |
|---|---|---|---|
| Redeem + acceptance | A RESET after acceptance hits the unique constraint | C1 upsert + test | Reset works |
| Setup page across a deploy | The version changed while the tab was open | C3 + test | "The terms changed; read them again" |
| Server released before the landing | `/terms/<v>` doesn't exist yet | R2 guard refuses the deploy | Nothing; the release stops |
| A rollback to an older version | Users are asked again | R13 ≥ comparison + test | No step |
| Accept with no profiles | The profile header would be required | C5 + test | Accept works |
| Local mode | A false "not accepted" | C6 `terms: null` + test | No step |

**Critical gaps (untested, unhandled and silent): 0.**

## NOT in scope
- **The phone's Terms link and update step:** a new Flutter ticket (R4).
- **Server-side enforcement on writes:** a TD (R3).
- **"Download my records" on the update step:** waits for MUT-325.
- **A DPA template and cookie banners:** not needed for the pilot.

## What already exists
- `PrivacyPolicyPage` layout. `LegalPage` is extracted from it: callers are `PrivacyPolicyPage.tsx` (existing) and `TermsPage` (proposed).
- `buildMe` (`me.ts:44`), already shared by three routes.
- The `PATCH /v1/me/malafat-suggestions` route shape (`sessions.ts:115`).
- `passwordSetAudit` (`account-setup.ts`).
- The `__HOSTED_OFFER_URL__` define (ADR-076).
- The `__forms.html` Vite emit pattern (MUT-186).
- The analytics-taxonomy pin pattern, for `legal-version.test.ts`.

## Worktree parallelization
Sequential implementation; there's no parallelization opportunity. The server contract (schema, then Me, then the routes) comes before the portal, and the landing content files feed the hash the server pins.

## Implementation Tasks
- [ ] **T1 (P1, human: ~3h / CC: ~25min):** server, schema and repository. `TermsAcceptance` and its migration, `legal.ts`, `users.latestTermsAcceptance` / `acceptTerms` (Prisma + memory, kept out of the snapshot). *Surfaced by:* S1 and R9. *Verify:* `npm --prefix server test`, `test:db`.
- [ ] **T2 (P1, ~3h / ~25min):** server, routes. `/check` `termsVersion`; the redeem order and its errors; `buildMe` terms (≥, null when local); `POST /v1/me/terms-acceptance` in `ORGANIZATION_INDEPENDENT_ROUTES`, auditing owned profiles only; the `openapi` regen. *Surfaced by:* C1–C7, R10 and R13. *Verify:* the server gate.
- [ ] **T3 (P1, ~4h / ~30min):** landing. Content files `terms/2026-11-01.{en,ar}.json` (Claude drafts, Basel approves); `LegalPage`; `TermsPage` at `/terms/:version?`; the privacy `hostedAccounts` section; footer and /hosted links; the `terms-versions.json` emit. *Surfaced by:* R8, R11 and R2. *Verify:* `test:run`, build.
- [ ] **T4 (P1, ~3h / ~25min):** portal. `__TERMS_URL__`; SetupPage tick and states, with `redeemFailure`; `TermsUpdatePage` with the decline line; the AuthGate branch; menu and sign-in links; i18n. *Surfaced by:* R5, R7 and R12. *Verify:* `test:run`, typecheck.
- [ ] **T5 (P1, ~1h / ~10min):** release. The deploy.sh guard plus its test; `legal-version.test.ts`; the INFRA/runbook "web first" rule. *Surfaced by:* R2. *Verify:* `test:run`.
- [ ] **T6 (P2, ~1h / ~10min):** operator. `users terms` plus the admin list `terms`. *Surfaced by:* T1. *Verify:* `npm --prefix server test`.
- [ ] **T7 (P2, ~2h / ~20min):** release-QA. `qa/features/{web/legal,portal/terms}.yaml` plus specs; `release-qa lint`. *Surfaced by:* §6. *Verify:* specs on preview builds.
- [ ] **T8 (P2, ~30min / ~5min):** knowledge and Jira. ADR-102, the TD for R3, CHANGELOG/registry/TEST_PLAN; MUT-324 AC; the new Flutter ticket. *Surfaced by:* R3, R4 and C8.

## Completion summary
- **Step 0 (Scope Challenge):** scope accepted as-is, in a smaller arrangement (S1).
- **Reality rows:** 8/8 rows emitted; 0 unverified premises; 1 false premise (fixed as C7).
- **Architecture review:** 3 issues (R1/C7, R2, R3/R4).
- **Code quality review:** 2 issues (R6 LegalPage, the route registry in C5).
- **Test review:** diagram produced, 28 gaps identified (all planned), 1 regression contract (R5).
- **Performance review:** 0 issues.
- **NOT in scope:** written. **What already exists:** written.
- **TODOS.md updates:** 1 proposed; built now (T1/T6).
- **Failure modes:** 0 critical gaps flagged.
- **Unresolved decisions:** 0.
- **Outside voice:** Codex wasn't installed. A native Claude Plan subagent completed and made 17 findings. That counts as in-host coverage, not outside coverage.
- **Parallelization:** 1 lane, sequential.
- **Lake Score:** 11/11. Every answer scored for completeness picked the most complete option, except D3, which you decided on privacy grounds rather than coverage.

## Build notes (/eng-build, 2026-10-19)

Deviations from §0, each needed to make the approved behaviour work:
- **One error code.** Both a missing and a stale version answer 409 `TERMS_VERSION_STALE` (`details.current`); there's no separate `TERMS_VERSION_REQUIRED`. The page shows the same "terms changed" state either way, and a page opened before the terms existed is exactly that case.
- **`Me.terms` is `{ version, accepted }` with no `textUrl`.** The server doesn't know the landing origin. The portal builds the URL from `__TERMS_URL__` + version; the phone (MUT-344) uses its own config.
- **The current terms are injected.** `createApp({ terms })` defaults to `CURRENT_TERMS`, so tests can act out a version bump. `PortalRouteDependencies.terms` (null in local mode) replaces the planned `buildMe` option.
- **The operator report** is `npm --prefix server run terms:report`, backed by a new admin route `GET /admin/v1/terms-acceptance` and an operator-only `users.listLatestTermsVersions`. No "list users" route existed.
- **The first terms version is `2026-10-19`.** The plan's example was `2026-11-01`. If Basel edits the text before release, the hashes in `legal.ts` change with it (the pin test says so). Once released, a change means a new version.
- **The terms contact address is `info@malafat.app`**, the same as the privacy policy. Change both together if the support inbox changes.
- **The deploy guard** is a separate script (`server/src/scripts/check-terms-live.ts`) called by `deploy.sh`, with `SKIP_TERMS_CHECK=1` for emergencies.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Outside Review | native Plan subagent (codex not installed) | Independent 2nd opinion | 1 | unavailable (in-host fallback completed) | 17 findings: 8 folded as corrections, 9 resolved by D1–D12 |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | issues_open (all resolved into tasks) | 6 issues, 0 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | — |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **OUTSIDE COVERAGE:** Codex plan review unavailable (CLI not installed). A native Claude Plan subagent completed within its 5-minute limit; that is in-host coverage, not outside coverage.
- **VERDICT:** Eng review complete, with all decisions answered. Status issues_open means the findings were mapped into the tasks. Ready to implement with `/eng-build MUT-324`. A design review is optional for TermsUpdatePage and the setup tick.

NO UNRESOLVED DECISIONS
