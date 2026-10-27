# MUT-458 — Operator console in the portal (epic plan: MUT-459, 460, 461, 462)

Tracker: Jira · barmajiyat · MUT via atlassian-barmajiyat · Backlog = default (planning allowed) · Planned (2) → In Progress (21) → In Review (3, set by qa-reconcile) · Done is Basel's.

Status on 2026-10-27:
- The epic and all 4 stories are in Backlog.
- 460, 461 and 462 are blocked by 459. That blocker sits inside this epic, and building in order clears it.

Related:
- MUT-367 (signup review queue, D15 `admin-token`)
- MUT-358 (billing grants)
- MUT-433 (feature flags, ADR-196)
- MUT-300 (firm switch)
- MUT-115/370 (passkeys)
- MUT-423/426 (portal shell)
- Stopgap: `live-admin.sh` (130bb3e7)

Revision 2 (2026-10-27) was rewritten after the eng review and the outside voice, using Basel's answers D1–D9 (see the review appendix).

## 1. What exists (verified)

### Server (Hono + zod-openapi, Prisma)

**Admin routes**
- `/admin/*` is guarded by `adminAuth` (`x-admin-token`, 401).
- Routers:
  - `routes/admin.ts`: firm requests, org firm PATCH/DELETE, org GET with members.
  - `admin-users.ts`: lookup, disable/enable, sessions revoke, setup-link incl. `lock`, features PUT/DELETE.
  - `admin-signup-reviews.ts`: list/approve/decline + mails.
  - `admin-billing.ts`: grants POST/DELETE/GET, status.
- There is no service layer. Helpers are closures inside the route factories.
- The actor is hardcoded: `actorType:'ADMIN', actorId:null`, `grantedBy:'admin'`, `REVIEW_DECIDED_BY='admin-token'`.
- The repository methods `setFirm`/`declineFirmRequest` write audit inside their own transaction with `{actorId:null}`.

**Session auth**
- `auth/middleware.ts` `authenticate()` covers `/v1/*`:
  - cookie or device bearer;
  - same-origin check on writes;
  - principals come from the OpenAPI `security`;
  - person-level routes are listed in the organization-independent set.
- The lapse gate supports an `'open'` rule (`auth/billing-gate.ts:27-29` `PERSON_LEVEL_GATE`).
- The portal client signs the person out on a remote 401 (`src/hosted/api/client.ts:437-440`).

**Step-up today**
- `stepUp()` (`routes/passkeys.ts:88`) passes when `credentialsVerifiedAt` is within `STEP_UP_WINDOW_MS` (10 min), or else when the request carries `currentPassword`.
- `credentialsVerifiedAt` doesn't record the sign-in method.
- `Session.passkeyId` records a passkey sign-in.
- `credentialsVerifiedAt` is load-bearing for the `passwordChangedAt` revocation (`middleware.ts:333-349`, the MUT-238 race).

**WebAuthn**
- `WebauthnChallengePurpose { creation authentication }`.
- `WebauthnChallenge.userId` is nullable.
- `verifyAssertion` is in `auth/webauthn.ts:150`.

**Other server facts**
- Audit: `audit_events` needs an `organizationId` (one row per profile). Malafat API keys read it via `/v1/audit`.
- Flags: `FEATURES=['agent_access']`; `/v1/me` returns `user.features`.
- Digest: `email/review-digest.ts` mails the CLI command only, with no link.
- Deploy: one image carries the API and the portal (`deploy.sh`), so there's no API/web ordering.
- Dev: `vite.config.ts:617-622` proxies `/v1`, so `/v1/operator` works with no change.

### Portal (`src/hosted`)
- Router and shell: the TanStack Router factory (`router.tsx`, `authedRoute`), `HostedShell`, and You rows gated by `useHasFeature`.
- Data: `api` in `api/client.ts` (generated `schema.d.ts`), with query hooks in `data/*Queries.ts`.
- UI patterns: the in-row confirm (`ConnectClaudeDrawer`, `PasskeysDrawer`) and `usePasskeySignIn.ts`.
- `RedirectToSignIn` keeps `next` (`AuthGate.tsx:88-89`).
- Strings: ar + en only, **by design: the portal never gets Hebrew** (Basel, D6).

### QA
- The live-API app is `portal-selfservice`. It has admin-token helpers, the outbox, and a virtual authenticator (`qa/support/passkeys.ts`).

### Next numbers
- ADR-212, TD-265, API `1.79.0-mut459` (now `1.77.0-mut453`).

## 2. Epic decisions (approved by Basel 2026-10-27; D-refs in the appendix)

**E1 (D3): marking an operator**
- Add a nullable `User.operatorAt` column.
- Grant and revoke only through `PUT/DELETE /admin/v1/users/{id}/operator` + `users.ts operator-grant|operator-revoke <email>`.
- **The grant refuses an account that isn't ACTIVE or has no passkey** (D7).
- It is not a `FEATURES` entry.

**E2 (D8): prefix**
- **`/v1/operator/*`**, behind the normal `/v1` `authenticate()`.
- Each route declares `security:[{session:[]}]` (cookie only, no device bearer) and is organization-independent.
- `operatorGate` runs after `authenticate()`: a non-operator identity gets **404 `NOT_FOUND`**.
- Signed-out callers get the usual 401 (the same on every `/v1` path), so the portal sends them to sign in and back via `next`.
- The lapse gate (D2) gets `PERSON_LEVEL_GATE` `'open'` for these routes.

**E3: what needs step-up**
- Every operator write, except `POST /v1/operator/step-up/options` and `POST /v1/operator/step-up`. These are the only exemptions, pinned in `route-security.test.ts`.
- Reads don't need step-up.

**E4 (D4 → D7): step-up is passkey-only**
- A write passes only if either is within 10 min:
  - the session was opened by a passkey (`session.passkeyId != null` and `createdAt`), or
  - `session.stepUpAt` was set by a passkey step-up.
- Otherwise it answers 403 `RECENT_SIGN_IN_REQUIRED {method:'passkey'}`.
- Step-up flow:
  - `options` creates a user-bound `step_up` challenge with `allowCredentials` set to their passkeys.
  - `step-up` verifies it, refuses another user's credential, and sets `stepUpAt`.
- **`credentialsVerifiedAt` is never written** (outside finding O2).
- There is no password path, so a password-only attacker gets nothing.

**E5: actor**
- Operator actions record `actorType:'ADMIN', actorId:<operator userId>`. The token keeps `actorId:null`.
- `decidedBy`/`grantedBy` = `operator:<userId>`. Token values are unchanged.
- The actor is passed into repository methods that audit inside their own transaction (ports + memory + Prisma + contract tests).
- The operator id is visible to Malafat API keys through `/v1/audit` on firm events. This is accepted: Malafat is our own product, and the id isn't personal data by itself.

**E6 (D1 + D9): shared action modules, extracted per ticket**
- Modules live in `server/src/operator/actions/*.ts` and take `{store, mailer, now, actor}`.
- Admin and operator routes are thin adapters over them.
- Each ticket extracts only what its UI uses.

**E7 (D5): search**
- Exact normalized email.

**E8 (D6): languages**
- ar + en.

**E9: QA location**
- `qa/features/portal-selfservice/operator.yaml`, tag `@portal-selfservice.operator.<id>`.

**E10: self-protection**
- An operator can't disable themself or revoke their own sessions from the console.
- No one changes the operator bit from the console.

**E11: `/v1/me`**
- `user.operator: true` appears only when it is set.

## 3. Per-ticket plans (in order, one at a time)

### MUT-459: server foundation (operator identity, gate, passkey step-up, signup reviews)

**Schema and store**
- `prisma/schema.prisma` + `prisma/migrations/2026102712xxxx_mut459_operator/`:
  - `User.operatorAt DateTime?`
  - `Session.stepUpAt DateTime?`
  - `WebauthnChallengePurpose += step_up`
- Store methods, each in memory + Prisma + contract test:
  - `users.setOperator`
  - `sessions.markStepUp`
  - challenge create/consume with purpose `step_up`

**New server modules**
- `src/operator/actor.ts`: `OperatorActor = {kind:'token'} | {kind:'operator', userId}`, `auditActorOf`, `byLabelOf`.
- `src/operator/actions/signupReviews.ts`: list/approve/decline + the mail `send()` + `serializeReview`, moved from `admin-signup-reviews.ts`. That file becomes an adapter whose behavior is unchanged byte for byte.
- `src/auth/operator-gate.ts`: `requireOperator` (404) and `requireOperatorStepUp` (403 passkey).
- `src/auth/step-up.ts`: the window check, `stepUpOptions`, and `verifyStepUp` (reuses `verifyAssertion`).

**Routes**
- `src/routes/admin-users.ts`: `PUT/DELETE /admin/v1/users/{userId}/operator`.
  - Refuses PENDING_REVIEW, DISABLED, or no passkey (409 `OPERATOR_NEEDS_PASSKEY`).
  - Audited.
- `src/routes/operator.ts`:
  - GET `/v1/operator/signup-reviews` (state, limit, cursor)
  - POST `…/{userId}/approve|decline`, which answers with the mail status
  - POST `/v1/operator/step-up/options`
  - POST `/v1/operator/step-up`

**Wiring**
- `src/app.ts`:
  - mount the router;
  - add the routes to the organization-independent set;
  - `PERSON_LEVEL_GATE` 'open';
  - `API_VERSION='1.79.0-mut459'`, plus the 5 version asserts.
- `src/routes/me.ts`, `schemas.ts`: `user.operator?: true`.
- `src/scripts/users.ts`: `operator-grant`, `operator-revoke`.
- Regenerate `openapi/openapi.yaml` and `src/hosted/api/schema.d.ts`.

**Tests first**
- `routes-operator.test.ts`:
  - non-operator gets 404 on every `/v1/operator` route (generated from the route inventory);
  - revoked operator gets 404 on the next request;
  - signed-out caller gets 401;
  - device bearer is refused;
  - lapsed operator gets 200 (D2);
  - cross-site write gets 403.
- `step-up.test.ts`:
  - stale passkey session gets 403 `{method:'passkey'}`;
  - fresh **password** sign-in by an operator gets 403;
  - fresh passkey sign-in passes;
  - passkey step-up sets `stepUpAt` and leaves `credentialsVerifiedAt` untouched;
  - a session revoked by a password change stays revoked after a step-up;
  - another user's challenge, a sign-in challenge, an expired challenge and a reused challenge are each refused.
- Parity:
  - approve/decline through the admin and operator surfaces give the same row state and mail;
  - the audit and `decidedBy` read `operator:<id>`;
  - a second decision gets 409 `ALREADY_DECIDED`;
  - a mail failure answers `mail:'failed'`.
- Operator grant: refused for no passkey, pending, or disabled; audited. `users.ts` grant/revoke.
- `routes-signup-review.test.ts` stays **unchanged** as the regression proof.

**Docs**
- ADR-212 (operator identity, gate, passkey step-up), CHANGELOG, SYSTEM_OVERVIEW, TEST_PLAN.
- `docs/operations/before-release.md`: add a passkey to Basel's account, then `live-admin.sh operator-grant`.

**QA**
- This ticket is server-only (qa-reconcile says so); 460's specs cover it.

### MUT-460: portal signup review page + digest link

**Routing and pages**
- `src/hosted/router.tsx`:
  - `operatorRoute` `/operator` redirects to `/operator/signups`;
  - `operatorSignupsRoute` sits under `authedRoute`, inside `HostedShell profile={null}`;
  - a non-operator gets the normal not-found page.
- `session/features.ts`: `useIsOperator()`.
- `pages/operator/OperatorLayout.tsx`: title + `SectionTabs`.
- `pages/operator/OperatorSignupsPage.tsx`:
  - waiting signups, oldest first, with email, domain, class, reasons, and how long each has waited;
  - an in-row confirm that says what will be mailed;
  - "already decided" (with a refresh) and "decided, mail not sent" states;
  - an `Empty` state.

**Step-up**
- `src/hosted/operator/useOperatorStepUp.ts` + `OperatorStepUpSheet.tsx`.
- On a 403 `RECENT_SIGN_IN_REQUIRED`, they run a passkey assertion and retry once, handling cancel and a second 403.
- 461/462 reuse them.

**Data, links and strings**
- `api/client.ts` operator functions and `data/operatorQueries.ts`.
- `pages/you/YouAccount.tsx`: an "Operator" `RowNavLink` gated by `useIsOperator()`.
- `i18n/en.json` + `ar.json`: `hosted.operator.*`.

**Server (digest link)**
- `email/review-digest.ts` + `templates/copy.ts` + `index.ts` add `action:{label, href:<PORTAL_ORIGIN>/operator/signups}`, with the origin taken from config.
- The CLI line stays as a fallback.

**Tests**
- RTL: page states, the step-up hook, the non-operator not-found page, the hidden You row.
- The digest test asserts the link.

**QA**
- `portal-selfservice/operator.yaml`: `signups-approve`, `signups-decline`, `step-up-passkey` (virtual authenticator), `hidden-for-non-operator`.
- `qa/support/selfService.ts`: `grantOperator(userId)`, which adds a passkey first.
- `portal-selfservice.watch` in `qa.config` gains these paths, each `!`-excluded from `portal`:
  - `src/hosted/pages/operator/**`, `src/hosted/operator/**`
  - `server/src/operator/**`, `server/src/routes/operator.ts`
  - `server/src/auth/operator-gate.ts`, `server/src/auth/step-up.ts`
  - `server/src/email/review-digest.ts`

**Docs**
- ADR-209 (operator console in the portal: route, layout, step-up UI).

### MUT-461: accounts, find an account and act on it (server + portal)

**Server**
- `src/operator/actions/accounts.ts`, extracted from `admin-users.ts`: lookup, `auditEvents`, `revokeAgentGrants`, `issueSetupLink`, disable/enable, revoke sessions. `admin-users.ts` becomes an adapter.
- GET `/v1/operator/accounts?email=`.
- GET `/v1/operator/accounts/{userId}`, the account view:
  - status;
  - trial/billing state (status builder extracted from `admin-billing.ts` `/status`);
  - profiles + firm membership;
  - `lastSignInAt` (new `sessions.lastCreatedAt`, uses `@@index([userId])`);
  - `hasPasskey`;
  - features.
- POST `…/{userId}/disable|enable|sessions/revoke|setup-link` (`{lock?, validHours?}`).
- E10 self-protection.
- API `1.79.0-mut461`.

**Portal**
- `OperatorAccountsPage` (`?email=`) and `OperatorAccountPage` (`/operator/accounts/$userId`).
- Every action uses the in-row confirm.
- The setup link lives in mutation state only: shown once, never stored in a query.
- A new tab in `OperatorLayout`, plus strings.

**Tests**
- Admin/operator parity per action; `routes-users.test.ts` stays unchanged.
- Self-protection.
- The setup link isn't kept after navigation.

**QA**
- `account-find`, `account-disable-enable`, `account-revoke-sessions`, `account-setup-link` (redeem via the outbox, like `rotate`).

**Docs**
- CHANGELOG, TEST_PLAN, and an ADR amendment if needed.

### MUT-462: billing grants, feature flags, firm requests (server + portal)

**Server**
- Action modules `billingGrants.ts`, `features.ts`, `firms.ts`, extracted from `admin-billing.ts`, `admin-users.ts` and `admin.ts`.
- The actor is threaded into `setFirm`/`declineFirmRequest` (ports + memory + Prisma + contract).
- Billing grants: POST/DELETE `/v1/operator/accounts/{userId}/billing-grants[/{grantId}]`.
- Feature flags: PUT/DELETE `…/features/{feature}` (`FEATURES` only).
- Firm requests:
  - GET `/v1/operator/firm-requests`;
  - **GET `/v1/operator/firm-requests/{orgId}`**, which returns the org's members for the owner picker (outside finding O7);
  - POST `…/{orgId}/enable` (`ownerUserIds`);
  - POST `…/{orgId}/decline`.
- API `1.80.0-mut462`.

**Portal**
- `BillingGrantsSection`: tier, reason, expiry; revoke.
- `FeatureFlagsSection`: the list comes from the server response.
- `OperatorFirmRequestsPage`: enable with an owner picker; decline.
- A new tab, plus strings.

**Tests**
- Parity per action; `billing-routes`, `user-features` and `routes-admin-firm` stay unchanged.
- Contract tests for the actor-threaded repository methods.

**QA**
- `billing-grant-revoke`, `feature-grant-revoke`, `firm-request-enable`, `firm-request-decline`.

## 3b. Operator console design spec (design review 2026-10-27, Basel's answers 1–19)

Mode: **Operate** (DESIGN.md "Surface"). Reuse the house recipes. No cards, and no new components beyond what is listed here. Arabic is the default and the layout is RTL. Strings are ar/en only.

### Structure and navigation (6A)
```
/operator/*  (HostedShell profile={null}: You island only, no pill/Reports)
┌───────────────────────────────────────────┐
│ Operator                    (--text-title) │
│ [Signups · 3] [Accounts] [Firms · 1]       │  SectionTabs underline, short ar/en labels, fit 375px
├───────────────────────────────────────────┤
│ tab content                                │
└───────────────────────────────────────────┘
Way out: the You island → your profile. Way in: You › Account › "Operator" RowNavLink (operators only).
```

### Signups tab (7A, 8A, 11A, 13A, 18A, 9A)
```
[.hp-banner-*]  (only when needed)
row (.hp-passkey-row recipe), oldest first:
  name: email (dir=ltr, wraps)
  meta (--text-label): waiting 3 h · domain      [Webmail] [No mail server] [waiting 1 day+]  ← Badge chips
  actions (wrap under meta, 44px):  Approve (.hp-link-button)   Decline (.hp-link-button .hp-danger)
```

**Chips (13A)**
- Every classification and reason code maps to ar/en words and a tone: `.badge-warning` for risk, `.badge-neutral` otherwise.
- An unknown code shows the raw code, `dir=ltr`.
- The build lists the codes from `server/src/email/domains/classify.ts` and `screen.ts`.

**Waiting time (18A)**
- Shown with `Intl.RelativeTimeFormat`, Western digits.
- Over 24 h it gets a `.badge-warning` chip, "waiting 1 day+".
- The list refetches on window focus.

**Confirms (11A, in-row `.hp-passkey-confirm`, Cancel focused, Escape cancels)**
- Approve (primary `Button`): "‹email› can sign in. We'll email them now."
- Decline (danger `Button`): "‹email›'s account will be deleted. We'll email them; they can sign up again."

**After a decision (8A)**
- The row leaves the list.
- Toast (`tone:'info'`): "‹email› approved · email sent".
- Focus moves to the next row, or to the heading when none are left.
- The empty state (`Empty`) reads "No one is waiting", plus one line: "The digest emails you when someone signs up."

**Mail failure (9A)**
- The row stays as a `.hp-banner-warning`: "Approved. The email didn't send."
- It offers "Send again" (new route `POST /v1/operator/signup-reviews/{userId}/resend`, approve only, idempotency key per attempt, step-up applies) and a `CopyField` with the address.
- A failed decline mail shows the warning and the `CopyField` with no resend, because the account is gone.

**Already decided (409)**
- A `.hp-banner-info` in the row reads "Already decided", and the list refreshes.

### Step-up, everywhere (1A, 10A, 2A)

**Freshness**
- The operator list GETs return `stepUpFreshUntil`, and so does `/v1/me.user.operatorStepUpUntil`.
- While it's fresh, a confirm's action acts directly.
- When it's stale, the confirm button reads "Approve with passkey" / "Decline with passkey" (and so on). One tap runs `navigator.credentials.get` → `/v1/operator/step-up` → the action.
- The passkey prompt is never started from a 403. A 403 fallback shows a "Confirm with passkey" button in the same confirm row.

**Failures (10A, `.hp-banner-error` inside the confirm row)**
- Cancel: back to the confirm, with no message.
- Refused or a second 403: "Your passkey wasn't accepted. Try again."
- No passkey: "Operator actions need a passkey", with a link to You › Account › Passkeys.
- A note says a passkey on another device works through the browser's QR option.

**Sign-in (2A)**
- When `?next` starts with `/operator`, SignInPage makes "Sign in with a passkey" the primary button and the password the secondary one.
- A passkey sign-in opens the 10-min window, so the digest flow needs one Face ID.

### Accounts tab (17A, 3A)

**Search**
- The field has a visible label, `type=email dir=ltr autocapitalize=none autocomplete=off`, and a Search button (Enter submits).
- `?email=` stays in the URL.
- A match shows one row that opens the account. No match returns 200 `{account:null}`, and the page shows "No account with this address" with the address `dir=ltr`.

**Not found (3A)**
- `accounts/{userId}` for a deleted or missing account returns `ACCOUNT_NOT_FOUND`, with its own `notFound` node. `QueryView` keeps its profile-404 meaning.
- A gate 404 (operator revoked) re-renders the normal not-found page after `/v1/me` refetches.

### Account page `/operator/accounts/$userId` (5A, 4A, 12A, 14A, 15A)
```
1 header: email (ltr) · status Badge · last signed in ‹relative› · passkey yes/no
2 status banner when not ACTIVE: DISABLED → "Disabled ‹date›" (Enable replaces Disable); PENDING_REVIEW → link to its signup row
3 Access (RowGroup, 4A):
   Sign out everywhere      "N devices · the password still works"
   Disable account          "signs out N devices, removes Claude access, blocks sign-in"   (tone=danger)
   Send reset link          switch "lock the current password" (on by default)
4 Billing (462): grants list; "Grant coverage" → Drawer ?grant=new
5 Features (462): RowSwitch per FEATURES entry
6 Profiles and firm
Own account: Access rows protected by E10 render inert with the reason.
```

**Access (4A)**
- Every confirm carries counts. The account view therefore adds `activeSessionCount` and `agentGrantCount`.
- The result toast uses the counts the response returns.

**Reset link (12A)**
- Shown in a `CopyField` with a Share button (`navigator.share` when available) and "works for 24 h".
- A `.hp-banner-info` says "Shown once. Leaving this page discards it."
- The link stays in mutation state only: never in a toast, the URL or a query.

**Grant drawer (14A)**
- A `Drawer` opened by `?grant=new`.
- Fields: tier (`RadioCards`), reason (required), and expiry (native date input with 30 d / 90 d / none presets).
- Footer: Cancel + Grant.
- Revoke a grant with the in-row danger confirm.

**Flags (15A)**
- A `RowSwitch` per flag, with an ar/en label and a one-line description.
- On: acts directly, is busy while saving, and reverts with an in-row banner on failure.
- Off: in-row confirm ("‹email› loses Claude access").

### Firms tab (16A)
- Requests are listed oldest first, in the `.hp-profile-row` recipe.
- Enable opens a multi-select member list with emails `dir=ltr`. The requester is preselected. Disabled and pending members are inert with the reason.
- The confirm names the firm and the owners.
- Decline: "‹firm› stays a regular profile; we tell the requester."

### Every page (restated from DESIGN.md, no new decisions)
- Loading uses the `QueryView` `Skeleton`. A busy action uses `Button isLoading` and keeps its label, and the button stays in place.
- Type: the title is `--text-title`, sections are `--text-headline`, meta is `--text-label`.
- Every tap target is at least 44 px. Pressable controls get `press`.
- Use logical properties only. Emails and codes are `dir=ltr`, names are `dir=auto`, and dates go through `Intl`.
- 375 px: no horizontal scroll, and row actions wrap under the meta line.
- Motion has reduced-motion forms. Toasts are polite (info) or alert (error).
- Focus returns to the opener after Cancel. Escape cancels a confirm.

### Server additions from the design review (folded into §3)
- **459:**
  - `stepUpFreshUntil` on the operator GETs and `me.user.operatorStepUpUntil` (1A)
  - `POST …/signup-reviews/{userId}/resend` (9A)
  - SignInPage passkey-first for `/operator` (2A; portal, lands with 460)
- **461:**
  - email search returns 200 `{account:null}`
  - `ACCOUNT_NOT_FOUND`
  - `activeSessionCount` and `agentGrantCount` on the account view (3A, 4A)


## 4. How the epic runs (build → reconcile → merge loop)

**Setup**
- One worktree for the epic (`.claude/worktrees/mut-458-operator-console`), one branch per ticket.
- Strictly in order: 459 → 460 → 461 → 462.
- Before each ticket, check that disk free is 20 GB or more.
- Run heavy commands through `~/Work/tools/heavy-gate/heavy`, with `--maxWorkers=3` and Node 22.

**Per ticket**
1. Move Jira to In Progress.
2. `/eng-build MUT-xxx` (TDD).
3. Run the gates:
   - root `lint`/`typecheck`/`test:run`/`build`;
   - server `typecheck`/`lint`/`openapi:check`/`test`;
   - `test:db` for migrations;
   - `hosted:types:check`.
4. `/qa-reconcile MUT-xxx`. Portal tickets need passing recorded `portal-selfservice` specs.
5. Merge to local main under `/tmp/mutaba3a-locks/mini-crm-main`, after checking :8787 is free.
6. Move Jira to In Review.
7. Branch the next ticket from the new main.

**Release**
- Nothing is pushed or deployed during the epic.
- When Basel ships, it's one deploy (the API image carries the portal).
- Then, if his account has no passkey, he adds one, and runs `live-admin.sh operator-grant <his email>`.

## 5. Risks
- **Passkey step-up is new security code.** Tests pin each part: the challenge is user-bound, single-use and lives 5 minutes; the counter check is shared with sign-in; `credentialsVerifiedAt` is never touched.
- **Extraction refactors touch production admin routes**, one router per ticket. The existing suites stay unchanged, as the gate.
- **An operator who deletes their last passkey can't act until they add one.** This is intended; the step-up sheet says so.
- **The OpenAPI spec lists the `/v1/operator` paths publicly**, as it already does `/admin/v1`. Accepted and noted in ADR-212.

## 6. Jira amendments to make (ticket text vs this plan)

**MUT-458 guardrails**
- "ar/he/en" becomes "ar/en": the portal is never Hebrew.
- "operator routes 404 for everyone else" becomes "404 for signed-in non-operators; 401 when signed out, as on every /v1 path".
- The QA file is `qa/features/portal-selfservice/operator.yaml`.

**MUT-459**
- The prefix is `/v1/operator/*`.
- Step-up is passkey-only, and operator status needs a registered passkey.
- The scope narrows to the foundation + signup reviews (D9).

**MUT-461**
- Gains its server half: account actions + the account view.

**MUT-462**
- Gains its server half, including the org-members read.

## Business / product impact
- Basel can approve a waiting signup from the digest mail on his phone in under a minute, instead of the person waiting until he's at a laptop with gcloud. That protects self-service conversion now that signup is open.
- This is the last operator gap of the self-service run (MUT-322/367). Every routine operator task moves off the CLI, which stays as the fallback.
- The risk is contained:
  - one privileged role, which needs a passkey;
  - 404 for non-operators;
  - passkey step-up on every write;
  - every action audited with a real person;
  - each server refactor ships with the page that uses it.

---
# Eng review (plan-eng-review, 2026-10-27) — target: this file

## Scope record
- Feature answers: no cuts proposed.
- Structure: A) Original arrangement (D1).
- Accepted scope: shared action modules with admin and operator adapters, extracted per ticket per D9 (an approved sequencing change).
- Pending remedies: none.
- Scope Challenge result: scope accepted as-is (D9 resequences work; it removes nothing).

## Findings (native review, Claude)

**F1 [P1] (8/10)** `server/src/auth/middleware.ts` `else if (endpoint && gated) { await gatePersonLevel(...) }`
- A lapsed operator would be refused on the console.
- **Accepted, D2:** `PERSON_LEVEL_GATE` 'open'.

**F2 [P1] (9/10)** `server/prisma/schema.prisma:583` `enum WebauthnChallengePurpose { creation authentication }`
- Step-up needs a user-bound purpose.
- **Correction applied:** `step_up` goes into the 459 migration.

**F3 [P2] (9/10)** The `/operator/v1` 404-remapping layer.
- **Superseded by D8** (`/v1/operator`, normal 401/403/404 semantics).

**F4 [P2] (10/10)** Prior learning applied: lockout-audit-actor-differs (confidence 10/10, from 2026-10-23).
- **Moot after D7:** there is no password step-up path.

**F5 [P3] (9/10)** `admin-signup-reviews.ts:129-135` `send()` returns 'failed'.
- **Correction applied:** the response carries the mail status, and the UI shows "decided, mail not sent".

**F6 [P3] (9/10)** `admin-signup-reviews.ts:141` `ALREADY_DECIDED` 409.
- **Required proof added:** a server test plus a UI refresh.

**Other notes**
- Verified non-issue: the `next` return path after a signed-out digest click (`AuthGate.tsx:88-89`).
- Correction: the setup link is held in mutation state only.

## Outside voice (Claude Plan subagent, native fallback; Codex not installed)
The full report was shown to Basel in the session. Findings and how each was resolved:

**O1 High:** a fresh password sign-in passes the step-up window (`passkeys.ts:88-95`, `ports.ts:1528-1533`).
- **D7: passkey-only operators** (reopened D4 for a concrete new risk).

**O2 Medium:** stamping `credentialsVerifiedAt` could revive a session revoked by a password change (`middleware.ts:333-349`).
- **Accepted inside D7:** a separate `Session.stepUpAt`, plus a regression test.

**O3 Medium:** the vite proxy has no `/operator/v1`. **Resolved by D8.**

**O4 Medium:** use `/v1/operator` instead of `/operator/v1`. **D8 accepted.**

**O5 Medium:** an expired session would show 404 instead of sending the operator to sign in. **Resolved by D8.**

**O6 Medium:** CROSS_SITE 404-vs-403 conflict. **Resolved by D8.**

**O7 Medium:** no org-members read for the owner picker.
- **Accepted:** `GET /v1/operator/firm-requests/{orgId}` in 462.

**O8 Medium:** big-bang extraction. **D9: split per ticket.**

**O9 Low:** the QA watch misses the server operator files. **Correction applied** (460 watch list).

**O10 Low:** "api before web" is moot because it's one image. **Correction applied** (§4).

**O11 Low:** the step-up endpoints must be exempt from step-up. **Correction applied** (E3, pinned in `route-security.test.ts`).

**O12 Low:** `actorId` is visible to Malafat via `/v1/audit`, and the actor plumbing has to reach the repositories.
- **Correction applied** (E5); the exposure is accepted.

**Cross-model:** both reviewers flagged the 404/auth plumbing (F3 and O4–O6). The native pass missed O1, O2, O7 and O8.

## Decision ledger
- **R1 (F1) D2:** approved. A) Exempt (Basel). Scope: `PERSON_LEVEL_GATE` 'open' for the operator routes. Test: a lapsed operator gets 200; a lapsed non-operator gets 404.
- **R2 (E1) D3:** approved. A) Own field (operatorAt). Scope: E1 (D7 adds the passkey requirement to the grant).
- **R3 (E4) D4 → reopened D7:** approved. D7 A) Passkey-only operators. Scope: E4 as revised.
  - History: D4 A) "Passkey in place, password when no passkey" was approved, then reopened by O1 because it allowed the password bypass.
- **R4 (E7) D5:** approved. A) Exact email.
- **R5 (E8) D6:** approved. "ar + en, portal shouldn't be in hebrew". Scope: ar/en only, no Hebrew follow-up.
- **R6 (O4) D8:** approved. A) `/v1/operator/*`. Scope: E2 as revised; MUT-459's AC wording to be amended.
- **R7 (O8) D9:** approved. A) Split per ticket. Scope: §3 as revised; Jira scopes of 459/461/462 to be amended.
- **Structure D1:** approved. A) Original arrangement.

**Approval readiness: PASS.** R1–R7 and D1 were checked against Basel's actual answers D1–D9 (2026-10-27).

## Section results

### 1. Architecture
3 issues (F1, F2, F3), all resolved.

Diagram: an operator write.
```
portal action ──► POST /v1/operator/... (cookie)
                   │
          authenticate() ── no session ──► 401 ─► portal: sign in ─► back via ?next
                   │ cross-site ──► 403
          requireOperator ── operatorAt null ──► 404
                   │
          requireOperatorStepUp ── passkeyId&&createdAt≤10m || stepUpAt≤10m ? ── no ──► 403 RECENT_SIGN_IN_REQUIRED{passkey}
                   │ yes                                   portal sheet ─► /step-up/options ─► navigator.credentials.get ─► /step-up (stepUpAt=now) ─► retry once
          action(store, mailer, now, {operator,userId}) ──► audit actorId=operator, decidedBy operator:<id>
                   │
          200 {result, mail:'sent'|'failed'} / 409 ALREADY_DECIDED
```

### 2. Code quality
2 issues (F5, F6).
- Shared code (D1): extracted actions remove the duplicated logic between the two surfaces, and the admin files shrink to adapters.
- Size estimate: about 1,500 lines moved, about +150 net for adapters and actor plumbing.

### 3. Tests
Diagram below. 9 gaps found, all now required in §3.
```
CODE PATHS                                         USER FLOWS
[+] requireOperator                                [+] Digest → approve on phone
  ├─ [GAP→req] non-operator 404 (inventory)         ├─ [GAP→req][→E2E] signed out → sign in → back → approve
  ├─ [GAP→req] revoked next request 404             ├─ [GAP→req][→E2E] decline (account deleted, mail)
  └─ [GAP→req] lapsed operator 200                  └─ [GAP→req] empty queue
[+] requireOperatorStepUp / step-up                [+] Stale session
  ├─ [GAP→req] fresh password session → 403          └─ [GAP→req][→E2E] passkey sheet → retry once; cancel
  ├─ [GAP→req] passkey session / stepUpAt pass     [+] Errors
  ├─ [GAP→req] foreign/expired/reused challenge      ├─ [GAP→req] already decided (two tabs / CLI race)
  └─ [GAP→req] stepUpAt never revives revoked       └─ [GAP→req] mail failed shown
[+] signup review action (shared)
  ├─ [★★★ TESTED] admin approve/decline — routes-signup-review.test.ts (must stay unchanged)
  └─ [GAP→req] operator parity + decidedBy operator:<id>
COVERAGE today: 1/16 paths; after plan: 16/16 required
```
The test plan artifact is saved in the gstack project dir (eng-review-test-plan).

### 4. Performance
No issues found.
- The signup and firm lists are paginated.
- Search uses the unique email index.
- The account view is about 6 indexed reads, once per page view.
- The operator check reads the user row that session validation already loaded, so it adds no query.

## NOT in scope
- Phone-app operator surface, multiple operator roles, and removing the CLI (all out of scope in the epic).
- Prefix or domain account search (D5).
- Portal Hebrew (D6).
- Granting operator status from the console (E10).

## What already exists (reused)
- Admin route logic: extracted, not rewritten.
- `verifyAssertion` and the WebAuthn challenge store.
- `PERSON_LEVEL_GATE` 'open'.
- `next` on `RedirectToSignIn`.
- `HostedShell`, `SectionTabs`, the in-row confirm pattern, `QueryView`/`Empty`, `RowNavLink`.
- The `portal-selfservice` QA app, with its virtual authenticator and outbox helpers.

## Failure modes

**Mail provider down on approve**
- Handling: the response carries `mail:'failed'`, and the UI says so.
- Tests: required.
- Silent? No.

**Operator's passkey removed**
- Handling: the step-up sheet explains why.
- Tests: required.
- Silent? No.

**Session revoked mid-action**
- Handling: 401, then a sign-in.
- Tests: existing client behavior.
- Silent? No.

**Concurrent decision (CLI + portal)**
- Handling: 409 `ALREADY_DECIDED`, then the list refreshes.
- Tests: required.
- Silent? No.

Critical gaps: 0.

## Worktree parallelization
Sequential implementation, no parallelization opportunity.
- Each ticket depends on the previous ticket's server foundation and shared files (`operator.ts`, `OperatorLayout`, `operatorQueries`).
- Memory says one worktree per repo per epic.

## Implementation Tasks

- [ ] **T1 (P1, human ~3d / CC ~2h)** — server — `operatorAt`, `stepUpAt`, `step_up` migration + store + contract tests
  - Surfaced by: E1/E4, F2, O2
  - Files: `server/prisma/**`, `server/src/repositories/**`
  - Verify: server test, test:db
- [ ] **T2 (P1, human ~2d / CC ~1h)** — server — `requireOperator`, passkey-only step-up, operator signup-review routes, lapse 'open'
  - Surfaced by: F1, F3/D8, O1/D7, O11
  - Files: `server/src/auth/{operator-gate,step-up}.ts`, `server/src/routes/operator.ts`, `server/src/app.ts`
  - Verify: `routes-operator.test.ts`, `step-up.test.ts`, `route-security.test.ts`
- [ ] **T3 (P1, human ~1d / CC ~45m)** — server — extract signup-review actions; operator parity, mail status, 409
  - Surfaced by: D1, F5, F6
  - Files: `server/src/operator/**`, `server/src/routes/admin-signup-reviews.ts`
  - Verify: `routes-signup-review.test.ts` unchanged and green
- [ ] **T4 (P2, human ~1d / CC ~45m)** — portal — signup page, passkey step-up sheet, You link, digest link, QA specs
  - Surfaced by: MUT-460, O9
  - Files: `src/hosted/pages/operator/**`, `src/hosted/operator/**`, `qa/**`, `server/src/email/**`
  - Verify: `release-qa run --attach --only signups-approve`
- [ ] **T5 (P2, human ~2d / CC ~1.5h)** — accounts — server extraction + portal
  - Surfaced by: D9, MUT-461
  - Verify: parity tests, QA `account-*`
- [ ] **T6 (P2, human ~2d / CC ~1.5h)** — billing/flags/firms — server extraction + repository actor plumbing + org-members read + portal
  - Surfaced by: D9, O7, O12, MUT-462
  - Verify: parity + contract tests, QA `firm-*`/`billing-*`/`feature-*`

## Unresolved decisions
None.

## Completion summary
- Step 0: Scope Challenge — scope accepted as-is.
- Reality rows: 7/7 tier-1 rows worked.
  - premise: 0 unverified; the key premises were checked by code reads.
  - already-done: no hits since 2026-10-26.
  - surface-check: routes and CLI checked against `admin*.ts`/`users.ts`.
  - binding: no conflicting branch decisions.
  - numbers: effort figures are estimated.
  - deferred-asks: all ticket ACs kept; AC wording changes are listed in §6.
  - pr-count: one local merge per ticket (4).
- Architecture Review: 3 issues found.
- Code Quality Review: 2 issues found.
- Test Review: diagram produced, 9 gaps identified.
- Performance Review: 0 issues found.
- NOT in scope: written.
- What already exists: written.
- TODOS.md updates: 0 items proposed.
- Failure modes: 0 critical gaps flagged.
- Unresolved decisions: 0 in this review.
- Outside voice: Codex not installed. The native Claude Plan subagent completed in time, with 12 findings, all resolved. It is not counted as outside coverage.
- Parallelization: 1 lane, 0 parallel / 4 sequential.
- Lake Score: 2/3. Scored answers D5 (picked 8/10) and D7 (picked 10/10) count; D4 (10/10) was later reopened as D7.

---
# Design review (plan-design-review, 2026-10-27) — target: this file, MUT-460/461/462

**Audit:** DESIGN.md is present (MUT-417), and the UI scope is 4 operator pages + step-up + the You row + the digest link. The designer is unavailable (no OpenAI key), so there are no mockups. An outside voice ran: a Claude subagent (Codex is not installed) found 3 critical, 9 high and 7 medium issues. C2 and C3 were verified in the code: `SignInPage.tsx:260` and `QueryView.tsx:38-47`.

**Litmus (subagent):** Operate mode, no hard rejections. It flagged scan/one-job/cards as not specified before this review; after §3b, rows and RowGroups replace cards and each tab has one job.

## Design decisions (Basel, 2026-10-27; asked one issue per question, up to 4 per call)
1A tap starts passkey · 2A passkey-first sign-in for /operator · 3A distinct not-found · 4A ordered Access group · 5A fixed account-page order · 6A tabs + counts · 7A row recipe · 8A toast + caught up · 9A resend + copy · 10A in-row step-up messages · 11A two confirm recipes · 12A CopyField + Share · 13A mapped code strings · 14A grant drawer · 15A RowSwitch rules · 16A checkbox owners · 17A submit-to-search · 18A relative wait + flag + refetch on focus · 19B plain list link (deep link not in scope).

## NOT in scope (design)
- `?review=<id>` deep-link highlight (19B): the queue is small and the list is oldest first.
- A phone-app operator surface (epic out of scope).
- Hebrew (D6).

## What already exists (design reuse)
- `.hp-passkey-row` / `.hp-passkey-confirm` / `.hp-confirm` (PasskeysDrawer)
- `RowGroup` / `RowSwitch` / `RowNavLink` (YouRows)
- `SectionTabs` (YouPage)
- `CopyField` (ConnectClaudeDrawer)
- `Drawer` + footer recipe
- `Badge` tones
- `Toast` info/error
- `QueryView` `Skeleton` / `Empty`
- banner slot classes
- `RadioCards`
- `usePasskeySignIn`
- the Glance profile-less route

## Design Implementation Tasks
- [ ] **DT1 (P1, human ~1d / CC ~45m)** — step-up UX: freshness field, passkey-from-tap confirm buttons, in-row failures, passkey-first sign-in for /operator.
  - Surfaced by: 1A, 2A, 10A
  - Files: `server/src/routes/operator.ts`, `server/src/routes/me.ts`, `src/hosted/operator/**`, `src/hosted/pages/auth/SignInPage.tsx`
  - Verify: QA `step-up-passkey` + a digest→sign-in→approve spec with one passkey prompt
- [ ] **DT2 (P1, human ~1d / CC ~45m)** — signups tab: rows, chips, confirms, toast/focus/empty, mail-failed resend, 409.
  - Surfaced by: 7A, 8A, 9A, 11A, 13A, 18A
  - Files: `src/hosted/pages/operator/OperatorSignupsPage.tsx`, i18n, server resend route
  - Verify: RTL tests + QA `signups-approve` / `signups-decline` at 375 px
- [ ] **DT3 (P2, human ~1d / CC ~45m)** — accounts: search, not-found semantics, page order, Access group with counts, reset link.
  - Surfaced by: 3A, 4A, 5A, 12A, 17A
  - Verify: QA `account-*`
- [ ] **DT4 (P2, human ~1d / CC ~45m)** — grants drawer, flag switches, firm owner picker.
  - Surfaced by: 14A, 15A, 16A
  - Verify: QA `billing-*` / `feature-*` / `firm-*`
- [ ] **DT5 (P2, human ~2h / CC ~10m)** — the operator layout with tabs + counts, and the You row.
  - Surfaced by: 6A
  - Verify: QA `hidden-for-non-operator` + a tab-switch step

## Design Review Completion Summary
```
  +====================================================================+
  |         DESIGN PLAN REVIEW — COMPLETION SUMMARY                    |
  +====================================================================+
  | System Audit         | DESIGN.md present; 4 operator pages + step-up|
  | Step 0               | 4/10; all 7 passes                          |
  | Pass 1  (Info Arch)  | 3/10 → 9/10 after fixes (4A,5A,6A,7A)       |
  | Pass 2  (States)     | 4/10 → 9/10 after fixes (3A,8A,9A,10A,18A)  |
  | Pass 3  (Journey)    | 4/10 → 9/10 after fixes (1A,2A,4A)          |
  | Pass 4  (AI Slop)    | 6/10 → 9/10 (Operate, recipes named, no cards)|
  | Pass 5  (Design Sys) | 5/10 → 9/10 after fixes (11A–16A)           |
  | Pass 6  (Responsive) | 3/10 → 8/10 (7A,17A + DESIGN.md restated)   |
  | Pass 7  (Decisions)  | 1 resolved (19B), 0 deferred                 |
  +--------------------------------------------------------------------+
  | NOT in scope         | written (3 items)                           |
  | What already exists  | written                                     |
  | TODOS.md updates     | 0 items proposed                            |
  | Approved Mockups     | 0 generated (designer has no OpenAI key)    |
  | Decisions made       | 19 added to plan                            |
  | Decisions deferred   | 0                                           |
  | Overall design score | 3/10 → 8/10                                 |
  +====================================================================+
```
Pass 6 stays at 8 rather than 9 because it hasn't been checked at 375 px on a real device. That check happens in qa-reconcile.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Outside Review | native fallback (Claude subagents; Codex not installed) | Independent 2nd opinion | 2 | unavailable (in-host completed: eng 12 findings, design 19) | all resolved |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | issues_open (all mapped to plan work) | 14 issues, 0 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 1 | clean | score: 3/10 → 8/10, 19 decisions |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **OUTSIDE COVERAGE:** No external provider ran in either phase (Codex is not installed). The in-host Claude subagents completed: eng plan review (12 findings) and design (19 findings). All are resolved by Basel's answers.
- **CROSS-MODEL:** Not applicable; no completed external review.
- **VERDICT:** DESIGN CLEARED (8/10, 0 unresolved). The eng review is issues_open, with every issue mapped to planned work and approved (D1–D9); eng review required. The design review added the server items in §3b, so re-run /plan-eng-review only if a builder questions them.

NO UNRESOLVED DECISIONS
