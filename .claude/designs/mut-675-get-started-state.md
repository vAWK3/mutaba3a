# MUT-675 Server: the Get started state (steps done, dismissed)

Engineering plan, 2026-11-28. Planning only: no code written. Epic MUT-672. Blocks MUT-676 (portal card and hub) and MUT-677 (phone card and hub); relates MUT-611 (a prompt never repeats a step this shows).

Tracker: Jira barmajiyat, MUT-675 is in Backlog and has no `is blocked by` links, so the blocker gate passes. Its facts come from stories that are Done: MUT-646 (invoicing setup), MUT-571 (Tax Authority connection), MUT-434 (Connect Claude), MUT-558 (accountant sharing).

## 1. What exists and what does not

| Need | Exists | Gap |
|---|---|---|
| A person-level, session-only route | `GET/PATCH /v1/me/monthly-summary-mail` (`server/src/routes/monthly-summary-mail.ts`): its own file, an `…ORGANIZATION_INDEPENDENT_ROUTES` set merged into `SESSION_ORGANIZATION_INDEPENDENT_ROUTES` in `app.ts`, listed in `route-security.test.ts` | the Get started route |
| A small per-person stored answer | nullable columns on `User` (`monthlySummaryMail`, `offerMail`, `passkeyPrompt` …), each with a port setter implemented in `prisma.ts` and `memory.ts` and a store-contract test | one column and setter |
| Per-person features | `FEATURES = ['agent_access', 'accountant_access', 'invoicing']`, `hasFeature`, `withInvoicingForAll` (`routes/me.ts`) | none |
| Invoicing setup per profile | `store.issuing.getIssuer/getSetup`, `setupMissing(issuer, setup)` (`routes/issuing.ts:173`); `setupOf` is inline in the route | reuse `setupMissing`; do not copy `setupOf` |
| Tax Authority connection per profile | `store.issuing.getTaxConnection`, `pack.clearance.statusOf(...)`, `taxAuthorityPlanOf(store, org, now)` (plan allows it: Solo and above) | reuse |
| Claude connected | `store.oauth.listLiveGrants(userId, now)` | reuse |
| First scan | `store.usage.firstEventsOf([userSubjectKey(userId)], ['SCAN'])` (the pilot's `firstScanAt`) | reuse |
| Accountant invited | `store.accountantGrants.listByOrganization(orgId)`; `listActiveByAccountant(userId)` says who is an accountant with a grant | reuse |
| Owned profiles | `ownedProfilesOf(store, userId)` (`personal-profile.ts`) | reuse |

## 2. Decisions

**D1. Two routes, one file** `server/src/routes/get-started.ts`, `tags: ['Me']`, `security` session or device session (the phone uses a device session), no scope for agents or Malafat (default deny; `delegatedMe` already hides the person's own standing):
- `GET /v1/me/get-started` → `{ steps: [{ id, done }], dismissed: boolean }`.
- `POST /v1/me/get-started/dismiss` → the same body, idempotent (`dismissed: true`). There is no undo: MUT-676 says dismissal removes the card for good, and the hub lists every step whether or not it was dismissed.
Both are org-independent: the person's steps look across every profile they own.

**D2. Derived, never clicked.** A pure `steps(facts)` in `server/src/get-started/steps.ts` returns the ordered list; a small gatherer `facts.ts` reads the ports in parallel. Order and rules:
1. `invoicing` (the business details and numbering are in): applies with the `invoicing` feature and at least one owned profile that issues (the issuing routes' own eligibility rule: a business profile that is not Malafat-managed, in a live jurisdiction; extract that check if it is inline). Done when `setupMissing` is empty on one such profile.
2. `tax_authority`: applies when `invoicing` applies, the server has the connection configured, and one such profile's plan allows it (Solo and above; ADR-282: Starter is offered the upgrade, so no step). Done while that profile's connection reads `connected`, so it **un-completes when the 90 days end**.
3. `scan`: applies to everyone. Done once a scan has ever been counted (the usage event).
4. `accountant`: applies with the `accountant_access` feature and an owned profile. Done while a PENDING or ACTIVE grant exists on an owned profile, so stopping the last one un-completes it.
5. `claude`: applies with the `agent_access` feature. Done while the person holds a live OAuth grant.
**An accountant with a grant gets no steps** (`listActiveByAccountant` non-empty): `steps: []`, whatever else they own, as the ticket says.

**D3. Dismissal is one nullable column**, `users.get_started_dismissed_at timestamptz NULL` (Prisma `getStartedDismissedAt`), a constant default (null), no backfill (the ADR-260 pattern for tables that grow). Port `setGetStartedDismissedAt(id, at | null, now)` returning the user or null, implemented in `prisma.ts` and `memory.ts`, `UserRecord` gains the field. It is per person, so it shows on every device and survives sign-out. The first dismissal wins (`updateMany … where null`), so a second tap keeps the time.

**D4. Privacy and logging.** No audit row and no log line carrying the person or the card's state; nothing beyond the generic request log. If a count is wanted it is the analytics' (MUT-611), not this route's.

**D5. Cost.** One read of the features, one of the owned profiles, then per owned profile an issuer, a setup and a connection read, plus one usage query, one grants query and one accountant-grant read per owned profile (only when the feature is on); all in `Promise.all`, bounded by the plan's business cap. The clients call it on Home and the hub, not on every screen.

**D6. Client types.** `docs/` OpenAPI is regenerated (`npm --prefix server run openapi:generate`; `openapi:check` is the guard) and the portal's `src/hosted/api/schema.d.ts` with it. The phone's copy of the contract and the card itself are MUT-677.

## 3. Files

Add: `server/src/routes/get-started.ts`, `server/src/get-started/{steps,facts}.ts`, `server/prisma/migrations/<timestamp>_mut675_get_started_dismissed/migration.sql`, tests `server/src/get-started/__tests__/steps.test.ts`, `server/src/__tests__/routes-get-started.test.ts`.
Touch: `server/prisma/schema.prisma`, `server/src/repositories/{ports,prisma,memory}.ts`, `server/src/repositories/__tests__/store-contract-*.ts` (the column), `server/src/schemas.ts` (`GetStartedSchema`), `server/src/app.ts` (register, merge the org-independent set), `server/src/__tests__/route-security.test.ts` (the identity lists, and the matrix tests the route index drives), the generated OpenAPI file and `src/hosted/api/schema.d.ts`, `.claude/` knowledge files, `docs/operations/before-release.md` (the migration), `server` README if it lists routes.

## 4. Tests (TDD, red first)

Run under Node 22 through the heavy queue: `npm --prefix server run typecheck`, `lint`, `openapi:check`, `npm --prefix server test` (affected files first, `--maxWorkers=3`), and `test:db` against Postgres for the migration and the Prisma setter; then the root `npm run typecheck` because `schema.d.ts` changed (and the root suite once, since `src/hosted/local` imports server code).
1. `steps.test.ts` (pure): steps appear only with their feature (no `invoicing` → none of the invoicing steps; no `agent_access` → no Claude); no Tax Authority step on Starter or without the connection configured; completion follows the facts and **un-completes** when the connection ends or the last grant is stopped; order is fixed; an accountant with a grant gets `[]`.
2. Store contract: the setter stores the time, keeps the first, resets to null, returns null for an unknown user (memory and Prisma).
3. Routes: `GET` returns the shape and derives each step from seeded facts; `POST dismiss` persists, is idempotent, is per person (a second user is unaffected) and shows on a second session of the same person; an accountant with a grant gets no steps; 401 without a session; refused to an agent token and to a Malafat delegate; the response and the logs carry nothing beyond the steps and the flag.
4. `route-security.test.ts` and the accountant matrix: both routes are listed as identity operations and the matrix passes.
5. Release-QA: this is a server story with no screen of its own, so there is no web flow to add; MUT-676 and MUT-677 carry the flows that show the card. `release-qa lint` stays clean.

## 5. Review of the plan (my own; gstack's `/plan-eng-review` is not installed)

- **A migration** (one nullable column on `users`): applying it restarts the main dev server, so the orchestrator is warned before the merge, and it ships with the server release (`before-release.md`).
- **"Invoicing set up" across several profiles** is the one definition that could surprise: done when any issuing profile can issue, not all. A person with two businesses, one set up, sees it done. Alternative is all; any is the simpler card and matches "is this person using invoicing".
- **The check for "issues"** may be inline in the issuing routes; extracting it is a small refactor that the existing issuing tests guard.
- **An owner who is also an accountant** (a firm that keeps its own books) sees nothing, per the ticket's wording. If that is wrong in practice it is a one-line change.
- **`scan`** counts receipts read on the web too, if the usage event is recorded there (check at build); the clients word the step.

## 6. Scope check against the ticket

Steps appear only when their feature is on: D2, test 1. Completion follows the facts and un-completes: D2, tests 1 and 3. Dismissal is per person and shows on every device: D3, test 3. An accountant with a grant gets no steps: D2, tests 1 and 3. OpenAPI updated, access-matrix tests cover the route, nothing about the card is logged beyond a count: D6, test 4, D4. Out of scope kept out: the tip engine and its caps (MUT-611), any notification, the portal card (MUT-676), the phone card (MUT-677).

Revealed by the plan, to note on the ticket: (a) "invoicing set up" is defined as any issuing profile (D2), and (b) the Tax Authority step is left out on Starter and where the connection is not configured; (c) this route needs both session kinds because the phone's device session reads it; (d) it ships with a migration, so the server release carries a step.

## 7. Open for Basel (product, with a default for each)

- **Q1.** "Invoicing set up" is done when **any** owned issuing profile can issue (not every one). Recommended: any.
- **Q2.** "Accountant invited" is done while a pending or active invite exists, and un-completes if the last is stopped. Alternative: ever invited. Recommended: pending or active.
- **Q3.** The scan step applies to everyone, including people who only use the web. Recommended: yes; the cards word it.

## Business / product impact

- Gives the portal and the phone one shared answer to "what is left to set up", remembered across devices, so a person is never shown a step they finished or a card they dismissed.
- Roadmap: the second story of epic MUT-672; it unblocks the Get started card and hub on both surfaces (MUT-676, MUT-677's second half) and gives MUT-611 the "never repeat a step the card shows" rule.
- Risk is low and contained: one nullable column, read-only derivation, no notifications, nothing stored about the facts themselves.
