# MUT-565 — Accountant plan: free for up to 3 client books, paid plan for more (plan)

> **Build notes (server slice, 2026-11-08, branch `feat/mut-565-accountant-plan` from MUT-575):** built to this plan,
> with these small differences, each the closest fit to the code:
> - The repository's refusal is `{kind: 'cap_reached', active}` (not `needs_plan`): the route maps it to 402
>   ACCOUNTANT_PLAN_REQUIRED, or to 409 CLIENT_BOOKS_CEILING when the plan covers and the ceiling is hit.
> - The lapse door runs in `finishSessionAuth` right after the accountant method gate (`assertClientReadable`), not
>   inside `selectProfile`, so an accountant's write stays 403 and never becomes 402 (MUT-559's rule).
> - Stripe's own subscription list (the "ask Stripe first" re-check) reads each product's `tier` metadata (cached),
>   the mirror's own rule (`tierOfItems`). Review fixes 1–8 are listed in ADR-251 item 8.
> - The come-back mail run skips ACCOUNTANT candidates (a leak the plan's reader list didn't name).
> - `GET /v1/billing.accountantPlan` costs one extra `factsFor` (the person's grants), only with ACCOUNTANT_ACCESS on.
> - Runbook: the Stripe steps are §1.12 (§1.7 step 1 names the `accountant` tier and points there).
> - Prices: none in code. ₪99 / $25 exist only in the runbook as the sandbox placeholder; the final price is open.

Epic MUT-558. Repos: mini-crm (`server/` + portal `src/hosted/`) and mutaba3a-flutter.
Tracker: Jira · barmajiyat · MUT via atlassian-barmajiyat · Backlog → Planned (transition 2) by /eng-ticket; /eng-build → In Progress; finished → In Review.

**Blocker gate.** Formal blocker MUT-559 is In Review and merged to mini-crm local `main` (69436d7d), so it's treated as resolved. Soft order (not blockers, same files): server slice after **MUT-575** (client rows shape, `DELETE /v1/clients` dismiss, `/v1/clients`); portal slice after **MUT-562** slices A–C (accept page, desk); phone slice after **MUT-564** (accept screen, Client books tab). MUT-562 D15 already hands its slice E (4th-client card + free counter) to this ticket; MUT-564's limit card (its D10) moves here too, so **one ticket owns every cap/plan surface**.

**Claims** (re-checked 2026-11-06: main ends at ADR-245 / `1.100.0-mut559`; MUT-557 and MUT-560 branches both hold ADR-246 + `1.101.0`; MUT-314 plans 247 / `1.102.0`; MUT-575 248 / `1.103.0`; MUT-562 moves to 249): **ADR-251**, **API `1.105.0-mut565`**, migrations **`20261108120000_mut565_accountant_tier`** + **`20261108120100_mut565_accountant_grant_check`**, events **2.8.0** (after MUT-575's 2.7.0). Whoever merges later takes the next free numbers.

Already decided (not reopened): the accountant pays, owners never; free up to 3 ACTIVE client books; share links never count; 4th accept → inline card with the price, the invite stays PENDING (within its 14 days) until they subscribe; placeholder ₪99 / $25 a month, final price before launch; VAT-exclusive (`tax_behavior: exclusive`); on lapse the 3 oldest stay readable, the rest faded with Subscribe and unopenable; phone respects the link-out switch; `/v1/me` exposes count, cap and plan.

## How it fits billing today

Billing (ADR-160, MUT-358/360/362) is "the person pays, the **profile** is entitled": `resolveEntitlement(profile, facts)` over `BillingSubscription` + `EntitlementGrant`, tier from the Stripe product's `metadata.tier` (mirror.ts `TIERS`). The Accountant plan is entitlement of a **person**, to a capacity (client books), not of a profile.

**Decision P1 — reuse the billing tables with a new tier, resolve it with its own pure function.**
- `BillingTier` gains `ACCOUNTANT` (Prisma enum + TS type). A Stripe product tagged `tier: accountant` mirrors as a `BillingSubscription` (organizationId always null). An operator comp is an `EntitlementGrant {userId, tier: ACCOUNTANT}` (MUT-462 console/API, userId target only).
- New pure `billing/accountant-plan.ts`: `resolveAccountantPlan(userId, facts, now) → {state: 'NONE'|'ACTIVE'|'GRACE'|'LAPSED', source: 'OPERATOR'|'STRIPE'|null, until, cancelAtPeriodEnd}`, same rule order as profiles: live ACCOUNTANT grant → ACTIVE/OPERATOR; covering sub (active/trialing; past_due → GRACE) within period + 7 days, not paused → STRIPE; any once-paid ACCOUNTANT sub → LAPSED; else NONE. Reuses `periodOver`, `pausedNow`, `COVERING_STATUSES`, `bestSubscription` (exported, not copied).
- **Landmine closed:** `subscriptionCovers`/`grantCovers` match by `userId === ownerUserId`, so an ACCOUNTANT row would entitle the accountant's own personal profile, flip `everPaid` and change `/v1/billing`'s shown plan. `resolveEntitlement` drops ACCOUNTANT facts at its first line (`profileFacts(facts)`), and one helper `profilePlanSubscriptions(subs)` filters every "the person's subscription" reader: `/v1/billing` (`currentSubscription`), `billing-plan.ts` (yearly switch, pause, cancel, stay offer), `comeback-read.ts`, launch-offer eligibility, and `checkoutRefusalOf` for the Freelancer plan. Tested as a regression net (T2).
- Rejected: a separate `AccountantSubscription` table/mirror (a second webhook path, second reconcile; red flag "two ways"), and per-client seats (decided against).

**`/v1/me` reads it free:** `billing.factsFor` already loads the person's subscriptions and grants as an owner; `buildMe` adds `user.id` to `ownerUserIds` (always the case through the personal profile) and resolves the plan from the same facts. Zero new queries.

## S — Server (mini-crm `server/`)

### S1 Config and the cap rule
- `config.ACCOUNTANT_PLAN` (default `false`; on in dev/QA): **off = no cap** (pilot accountants keep accepting; `clientBooks.cap` is null). Turned on in prod only after live prices exist (runbook step below). Reason: a cap with no way to pay would strand accountants.
- `ACCOUNTANT_FREE_CLIENTS` (default 3) and `ACCOUNTANT_PLAN_MAX_CLIENTS` (default 100, abuse ceiling; see Question 4).
- Pure `clientCapOf(plan, cfg) → number`: ACTIVE/GRACE → MAX, else FREE. `readableClientIds(activeGrants, cap)`: ACTIVE grants ordered `acceptedAt asc, id asc`, the first `cap`. "Oldest" = oldest accepted. A revoke or leave frees a slot and the next-oldest becomes readable by itself (derived, no state).

### S2 Accept: atomic cap, invite stays PENDING
- `POST /v1/accountant-invites/accept`: the route resolves the plan (one `factsFor`), passes `maxActive` to `accountantGrants.accept`.
- Repository (memory + Prisma) `accept({…, maxActive})` → `{kind: 'accepted', grant} | {kind: 'needs_plan', active} | null`. In the transaction, before `claimAccountantGrant`: `SELECT id FROM users WHERE id = $accountant FOR NO KEY UPDATE` (serialises one accountant's accepts, the `lockOrganization` pattern), then `count(ACTIVE where accountantUserId)`; at `maxActive` → `needs_plan`, **nothing written**, the grant stays PENDING with its token. Two parallel accepts at 2 of 3 → one wins, one `needs_plan` (T4).
- Answer: **402 `ACCOUNTANT_PLAN_REQUIRED`** (new code), `details: {freeLimit, active, inviteExpiresAt}`. Not 409 `ACCOUNTANT_LIMIT`: that reason already means "this profile has 5 accountants" (owner side, MUT-559). **MUT-562 and MUT-564 must handle 402 ACCOUNTANT_PLAN_REQUIRED, not 409 ACCOUNTANT_LIMIT, for the card.** 402 matches the existing lapse family (SUBSCRIPTION_LAPSED).
- Signup from an invite never caps (a new account holds 0). Pending invites never count; share links are another table and never count.
- `/check` is unchanged: the page decides to show the card up front from `/v1/me.clientBooks` (count ≥ cap and plan not ACTIVE/GRACE); the server still decides at accept.

### S3 Pending until subscribed: client-driven re-accept (no held state)
Decision P2: after Checkout succeeds, the **client re-calls accept**; the webhook does not auto-accept.
- Portal: the invite token is already kept in `sessionStorage` (MUT-562). Checkout's `returnPath` is `/accountant-invite`; on `?checkout=success` the page shows "Confirming your subscription…", polls `GET /v1/me` every 2 s up to 30 s until `clientBooks.plan.state` is ACTIVE, then calls accept itself. Timeout → "Your payment is being confirmed. Tap Accept in a minute." with Accept.
- Phone: the phone never opens Checkout itself (see M); after paying on the web, the accountant opens the invite again (or the portal page accepts it). Pull-to-refresh on the accept screen re-reads `/v1/me`.
- Rejected: webhook auto-accept. The server keeps only the token's digest and the email-match rule needs the signed-in person; holding "which invite this Checkout is for" means new state on the Checkout metadata, a webhook path that writes grants, and a race with the client. The client already has the token; re-accept is one call.

### S4 Lapse: derived allowlist, one door
- `selectProfile`'s accountant branch (`namedClient`, middleware.ts): after `findActive`, when `ACCOUNTANT_PLAN` is on, `accountantGrants.countActiveBefore(accountantUserId, grant)` (ACTIVE grants accepted earlier, on the `(accountantUserId, status)` index). Rank < FREE → allowed with **no billing read** (the common case). Else resolve the plan; not ACTIVE/GRACE → **402 `ACCOUNTANT_PLAN_REQUIRED`** `details: {profileId, freeLimit}`.
- Every accountant read (feed, summaries, receipts, MUT-575 `/v1/profile-entries`, MUT-314 downloads) passes this one door, so locked clients can't be read anywhere; no per-route checks.
- Rows: MUT-575's `clientRows` gains `needsPlan: boolean` (active rows; false on ended) from `readableClientIds`; `/v1/me.clients` and `/v1/clients` carry it; `/v1/clients` stats are null for `needsPlan` rows (no reads of a locked client).
- Rejected: suspending grants on lapse via the webhook (status writes, a cron for operator-grant expiry, restoring on re-subscribe, drift from Stripe). Derived costs one indexed count per accountant request.

### S5 `/v1/me.clientBooks` (present with `clients`, ACCOUNTANT_ACCESS on)
`{count: int /* ACTIVE grants */, freeLimit: 3, cap: int|null /* null while ACCOUNTANT_PLAN off */, readable: int, plan: {state: NONE|ACTIVE|GRACE|LAPSED, source: OPERATOR|STRIPE|null, until: datetime|null, cancelAtPeriodEnd: bool}}`. No price (no Stripe call on `/v1/me`; the phone caches it offline).

### S6 Checkout for the Accountant plan
- `POST /v1/billing/checkout-session` gains optional `plan: 'freelancer'|'accountant'` (default freelancer; additive). Accountant: `ACCOUNTANT_PRICE_LOOKUP_KEYS = {ILS: {month: 'accountant_list_monthly_ils'}, USD: {month: 'accountant_list_monthly_usd'}}`, month only (Question 2), `interval` must be `month` (else 422).
- `checkoutRefusalOf(plan)`: considers only that plan's subscriptions (ALREADY_SUBSCRIBED, RESUME_IN_PORTAL, CONTACT_US); NOTHING_TO_COVER / COVERED_BY_MALAFAT don't apply; COVERED_BY_GRANT when a no-expiry ACCOUNTANT grant is live; country rules unchanged. No trial carry (accountants have none), no launch or come-back offer (Question 3). Same `findOrCreateCustomer` (one customer per person, two subscriptions; MUT-360 note on reusing `stripeCustomerId`), same "ask Stripe first" re-check filtered to the plan, same `expireOpenCheckouts`.
- `checkout-gateway.ts` `sellableFactOf` takes the expected tier per lookup key (`freelancer` or `accountant`) and returns it; `catalogFrom` per plan. A key on the wrong product leaves that plan unsellable (`PRICES_NOT_SET`), never mischarges.
- `RETURN_PATH` admits `/accountant-invite` and `/client-books(/<uuid>)?`.
- Audit `billing.checkout_started` gains `plan`.
- `GET /v1/billing`: `subscription` stays the profile plan (filtered); new additive `accountantPlan: {state, source, until, cancelAtPeriodEnd, interval, currency, catalog: {ILS: {month}|null, USD: {month}|null}} | null` (null when ACCOUNTANT_ACCESS is off). The portal card's price comes from here (cached catalog, 10 min).
- Customer Portal (`portal-session`) unchanged: one customer, both subscriptions, cancel at period end.

### S7 Webhook mirror and operator grants
- `mirror.ts` `TIERS` += `accountant`; an ACCOUNTANT sub's `organizationId` is forced null (note `ACCOUNTANT_ORG_IGNORED` if metadata named one). Reconcile and sync otherwise unchanged.
- Operator: `billingGrants` action, `/v1/operator/accounts/:userId/billing-grants`, admin API and `scripts/users.ts` accept tier ACCOUNTANT, userId target only (organizationId + ACCOUNTANT → 422). The audit lands on the person's owned profiles as today. `billing:status` lists the plan.
- Migrations: (1) `ALTER TYPE "BillingTier" ADD VALUE 'ACCOUNTANT'`; (2) separate file (Postgres refuses a new enum value in the same transaction): `CHECK (tier <> 'ACCOUNTANT' OR "userId" IS NOT NULL)` on `entitlement_grants`.
- Mails: card-failed and renewal mails are per subscription; check their copy names no Freelancer plan for an ACCOUNTANT sub (renewal mail is yearly-only, so n/a; card-failed tested T10). Account closure (MUT-333) cancels the customer's subscriptions: both, as wanted (test).

### Server files
- **New:** `src/billing/accountant-plan.ts`, 2 migrations, `.claude/designs/MUT-565-accountant-plan.md` + `-tests.md` (build branch).
- **Changed:** `prisma/schema.prisma`; `src/billing/{entitlement,coverage,checkout}.ts`; `src/billing/stripe/{mirror,checkout-gateway}.ts`; `src/billing/comeback-read.ts`; `src/routes/{billing,billing-plan,accountants,me,operator,admin-billing}.ts`; `src/operator/actions/billingGrants.ts`; `src/scripts/users.ts`; `src/auth/middleware.ts` (`namedClient`); `src/accountants/grants.ts` (`clientRows.needsPlan`, `clientBooksSummary`); `src/repositories/{ports,memory,prisma}.ts` (`accept` union + lock, `countActiveBefore`); `src/auth/store-guard.ts` (STORE_ACCESS rows); `src/errors.ts` (`ACCOUNTANT_PLAN_REQUIRED` 402); `src/config.ts`; `src/schemas.ts`; `src/app.ts` (API_VERSION); OpenAPI + `npm run hosted:types`; `docs/analytics/events.json` + pinned sha; `docs/operations/pilot-runbook.md` §1.7 (Stripe steps); `.claude/DECISIONS.md` ADR-251.

## P — Portal (mini-crm `src/hosted/`, after MUT-562 A–C)
- **Accept page, 4th client (SL6):** shown up front from `/v1/me.clientBooks`, or on 402 from accept. Upsell scene (Claude Design brief, light/dark/RTL, comment 13227), text "You already read 3 client books for free. Subscribe to the Accountant plan to add more ({price}/month)" with the price from `/v1/billing.accountantPlan.catalog` (currency by BillingDrawer's DR12 rule; both until a country is known; no price → "Subscriptions open soon", no button), **Subscribe** → the drawer's country/buyer step with `plan: 'accountant'` → Checkout; **Not now (the invite stays open until {date})**. Return flow per S3.
- **Desk (MUT-562 C1):** "{readable} of {freeLimit} free client books" while `cap` is set and plan not ACTIVE/GRACE; `needsPlan` rows faded with "Subscribe to open" (opens the same Checkout); opening one, or a 402 mid-browse → a needs-plan panel (no data shown). Ended rows unchanged.
- **Billing drawer:** an "Accountant plan" section when `accountantPlan` is non-null and state ≠ NONE: status, renews/ends on, Manage (Customer Portal). Freelancer section unchanged.
- **Operator console** (`OperatorBillingSection.tsx`): tier option "Accountant" (person grants only).
- i18n `hosted.clientBooks.plan.*`, `hosted.accountantInvite.fourth.*`, `hosted.billing.accountant.*` (en/ar, `dir="auto"`, bidi-isolated amounts).
- QA (Playwright on Stripe sandbox, release-qa catalog `portal.client-books.*`): `portal.client-books.fourth-client` (card → Checkout test card → back → auto-accept), `portal.client-books.lapsed` (operator grant revoked → 4th faded, open → needs-plan), `portal.billing.accountant-plan` (drawer section + Manage).

## M — Phone (mutaba3a-flutter, after MUT-564)
- Models: `Me.clientBooks` (`ClientBooks`), `AccountantClient.needsPlan`; `BillingTier.accountant` (tryParse already tolerates unknown, so older builds are safe).
- **Accept screen:** 402 `ACCOUNTANT_PLAN_REQUIRED` (or `clientBooks` says full) → the limit card. **No price in the app** (Env rule "never a price or a plan", MUT-364 D1). Link-out on → "Subscribe on the web" (opens the portal invite page in Safari, `externalApplication`); off → no button (Question 1). The invite stays pending; leaving the screen keeps nothing.
- **Client books list:** `needsPlan` rows faded, a lock line "Needs the Accountant plan"; tap → a needs-plan sheet (same switch rule). A 402 mid-browse → that sheet, nothing on screen behind it (as MUT-564's B5).
- **Account › Billing:** an "Accountant plan" row from `/v1/me.clientBooks.plan` (+ `/v1/billing.accountantPlan` for dates); payers always get **Manage on the web** (Basel 2026-11-05: payers keep it with the switch off).
- Events through the telemetry gate (release builds only).
- l10n en/ar arb keys; RTL; text-scale cap.
- QA (CLAUDE.md): add scenarios to MUT-564's `qa/features/ios/clients.yaml` feature and `billing.yaml`: `clients_fourth_card_scenario.dart` (QA server at 3 clients, link-out off build → card without price or button; pending invite still listed on the owner side), `clients_lapsed_locked_scenario.dart` (operator ACCOUNTANT grant revoked via the QA seed script → 4th faded, tap → sheet), `billing_accountant_plan_scenario.dart` (grant on → Account › Billing row + Manage on the web). Plan state is seeded with operator grants, not Stripe, so flows run offline of Stripe. Each passes once on "QA iPhone" (`release-qa release --only …`); `release-qa lint` clean.

## Events (`docs/analytics/events.json` 2.7.0 → 2.8.0)
| Event | Emitters | Properties | When |
|---|---|---|---|
| `accountant_plan_offer_shown` | portal, ios, android | `place`: invite\|client_books\|billing | the card or a locked row's prompt shown, once per view per place |
| `billing_checkout_started` (extended) | portal | + `plan`: freelancer\|accountant (absent = freelancer) | as today |
No amounts, no ids, no email.

## Stripe sandbox setup (operator steps, Basel)
1. Product **"MTB3A Accountant plan"**, metadata `tier = accountant`, the same tax code as the Freelancer product.
2. Prices on it: monthly ILS **9900** (₪99) lookup key `accountant_list_monthly_ils`; monthly USD **2500** ($25) `accountant_list_monthly_usd`; recurring month, interval count 1, **`tax_behavior: exclusive`**, active.
3. Customer Portal configuration: cancel at period end allowed; if "switch plans" is enabled, the Accountant product is **not** offered as a switch from Freelancer (or vice versa).
4. Restricted key and webhook endpoint: no change (prices read, Checkout write and the existing events already cover it).
5. dev/QA `.env`: `ACCOUNTANT_PLAN=true`; prod stays off.
6. Before launch: the final price (Question 5), the same steps in live mode, then `ACCOUNTANT_PLAN=true` in prod (runbook §1.7 new step; `make metadata-check` unaffected).

## Tests (TDD; `npm --prefix server test`, `test:db`, portal vitest + Playwright, `flutter test`; heavy ones through the queue)
1. **`resolveAccountantPlan` (pure):** grant (live, expired, revoked); sub active/trialing/past_due (GRACE)/unpaid/canceled/paused/period+7 over; grant beats sub; NONE vs LAPSED.
2. **Profile entitlement regression:** an ACCOUNTANT sub or grant never covers the accountant's personal profile, never flips `everPaid`, never becomes `/v1/billing.subscription`, yearly-switch/pause/cancel/comeback ignore it; a Freelancer payer who also buys Accountant is not ALREADY_SUBSCRIBED, and vice versa.
3. **Cap rule (pure):** `readableClientIds` order by acceptedAt then id; revoke of #2 promotes #4; cap null when flag off.
4. **Accept:** 3 ACTIVE + no plan → 402, grant still PENDING with its token, accept works after a grant/sub appears; plan ACTIVE/GRACE → accepted; LAPSED → 402; pending invites and share links don't count; signup never capped; two parallel accepts at 2 → one 200, one 402 (test:db, real locks); at the paid ceiling → 409 CONFLICT `reason: CLIENT_BOOKS_CEILING` (Q4); flag off → no cap.
5. **Door:** 4 clients, lapsed → the 3 oldest read 200, the 4th gets 402 on every allowlisted GET (route-matrix extension), `/v1/profile-entries`, receipts download, MUT-314 mint; plan restored → 200; rank < 3 does no billing read (query counter).
6. **Rows/me:** `needsPlan` on the 4th only; ended rows false; `/v1/clients` stats null on locked rows; `clientBooks` shape, flag off → `cap: null`; `/v1/me` adds no query (counter).
7. **Checkout:** `plan: accountant` picks accountant keys; year → 422; refusal matrix per plan; no trial carry, no offers; wrong-product key → PRICES_NOT_SET; return paths `/accountant-invite`, `/client-books/<uuid>` ok, others 422; audit carries plan.
8. **Mirror:** `tier: accountant` product → ACCOUNTANT row, org forced null; mixed-tier subscription → UNKNOWN_TIER (unchanged).
9. **Operator:** ACCOUNTANT grant on a person 201; on an organization 422; DB CHECK refuses a raw insert (test:db); console select.
10. **Mails/closure:** card-failed mail for an ACCOUNTANT invoice names no Freelancer plan; closure cancels both subs.
11. **Events:** taxonomy rules, 2.8.0 pin.
12. **Portal/phone:** widget/component tests per state (card with/without price, switch on/off, faded row, needs-plan panel/sheet, billing row) in en/ar RTL; the QA flows above.

## Scale and cost
- Accept: +1 row lock, +1 count, +1 billing read. `/v1/me`: no new query. Accountant requests: +1 indexed count; a billing read only beyond the free 3. No cron, no new infrastructure, no Stripe call outside Checkout and `/v1/billing` (cached catalog).

## Decisions (auto, with reason)
- **P1** ACCOUNTANT tier on the existing billing tables + own pure resolver; ACCOUNTANT facts filtered out of profile entitlement in one place. One mirror, one grant path, no profile leakage.
- **P2** Pending-until-subscribed = client re-accepts (portal auto after Checkout, polling `/v1/me` ≤30 s); no webhook auto-accept. No new held state.
- **P3** Cap enforced inside the accept transaction under a per-accountant row lock; refusal writes nothing.
- **P4** Lapse = derived "3 oldest by acceptedAt" at `selectProfile`; no grant status changes; restores itself.
- **P5** New 402 `ACCOUNTANT_PLAN_REQUIRED` for accept and the door; 409 `ACCOUNTANT_LIMIT` keeps its owner-side meaning.
- **P6** `ACCOUNTANT_PLAN` flag, off = no cap; prod on only once live prices exist.
- **P7** Checkout reuses the endpoint with `plan`; one customer, two subscriptions; monthly only, no offers.
- **P8** Price only from Stripe (`/v1/billing`), never on `/v1/me` and never in the phone.
- **P9** Operator comps = person-level ACCOUNTANT grants (MUT-462 console).
- **P10** This ticket owns all cap/plan UI on both clients (MUT-562 slice E, MUT-564 D10 move here).

## Review notes (plan-eng-review, auto-decided)
**Scope challenge:** ~25 files across 3 codebases, 2 tiny migrations; past the 8-file gate, but each slice reuses an existing module (entitlement, checkout, mirror, selectProfile, drawer). Splitting the server would leave a cap with no payment path. Accepted, built in slice order S → P → M.

**Architecture.** Design-twice ×3 above (tier vs new table; derived lapse vs grant suspension; client re-accept vs webhook auto-accept). Red flags: (2) leakage — closed by `profileFacts` + `profilePlanSubscriptions` (T2); (5) split ownership — plan state is Stripe's mirror + grants only; (6) two ways — one Checkout route, one door; (8) hand-synced — cap and readable set from one pure module used by rows and the door (parity test T5/T6).
**Failure modes:** webhook late after paying → client polls 30 s, then manual Accept; webhook lost → nightly reconcile fixes, accept works next day (accepted); invite expires while paying → plan kept, owner re-invites (copy on the card shows the date); Stripe down → Checkout 503 as today, reads unaffected; currency mismatch on an existing customer (Stripe locks one currency) → Stripe refuses, surfaced as today's checkout error (logged; rare: currency follows country); Freelancer cancel → accountant plan untouched (T2); flag flipped off → caps vanish (fail-open by design, never fail-closed on data access the owner granted).
**Security:** no new public surface; 402 details carry no other client's data; the door check runs before any read; checkout return paths stay on the portal.
**Tests:** every branch maps to T1–T12; T2, T4, T5 are the regression net. **Performance:** see Scale. **Outside voice:** unavailable (codex not installed).

VERDICT: ENG CLEARED (auto-decided) — S ready for /eng-build after MUT-575 merges; P after MUT-562 A–C; M after MUT-564.

## Questions for Basel (what users see or pay)
1. **Phone, link-out switch off:** the 4th-client card and locked rows show no price and no button ("…To add more, you need the Accountant plan."). With the switch on: "Subscribe on the web", still no price. Rec: yes (store rules; the app never shows a price).
2. **Monthly only** at launch (no yearly Accountant price). Rec: yes.
3. **No launch or come-back offer** on the Accountant plan. Rec: yes.
4. **Paid plan limit:** no visible limit; a server ceiling of 100 client books answers "Contact us to add more". Rec: yes.
5. **Final price** before launch (placeholder ₪99 / $25 monthly, VAT-exclusive). Needed before step 6.
6. **Does the Accountant plan also unlock the accountant's own books** (their personal profile, which starts read-only with no trial)? Rec: no, it covers client books only; own books are the Freelancer plan.
7. **Owners see nothing** about their accountant's plan (a locked client still shows the accountant as active on the owner's Sharing page). Rec: yes.

## Business / product impact
- Turns accountant access (MUT-558) into the epic's second paying customer: free to try with 3 clients, paid for the accountants who bring the most clients, and owners never pay for sharing.
- Last story of the epic; closes MUT-562's slice E and MUT-564's limit card, and ships dark (`ACCOUNTANT_PLAN` off) until live prices exist.
- Low risk: no new access path (one door at `selectProfile`), no state to drift (derived cap and lapse), and the existing Stripe mirror, Checkout and operator grants are reused.
