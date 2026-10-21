# MUT-360: Stripe webhook + nightly reconcile (mirror subscriptions, link the pilot's hand-made ones)

> **Ticket:** MUT-360 (epic MUT-322, `ga-gate`). Blocked by MUT-358, which is merged to local main 52a677f8. This ticket blocks MUT-362, MUT-363 and MUT-333.
> **Source design:** `docs/commercial/billing-spike.md` §4.5 and §5, ADR-160 decision 5, and ADR-162 decision 6.
> **Status:** draft plan from `/eng-ticket` (2026-10-21). The decisions in §7 wait for Basel.

## 1. Problem and acceptance criteria

Pilot users pay through Stripe subscriptions that the operator creates by hand (`pilot-offer.md` §5). The server never hears about them, so MUT-358's entitlements can't tell who paid. A webhook that's missed or arrives out of order must never leave a payer locked out.

From the ticket:

- **AC1:** a signature failure returns 400 and changes nothing. Replaying the same event a second time changes nothing.
- **AC2:** events that arrive out of order still end in Stripe's current state, because each one re-fetches. A test covers this.
- **AC3:** a hand-made test-mode subscription whose customer carries `mutaba3a_user_id` shows up in `/v1/me` `billing` with no operator step beyond that metadata.
- **AC4:** the reconcile job repairs a subscription whose webhook was dropped. A test covers this.
- **AC5:** secrets are never logged. The Terraform plan is reviewed and handed to Basel.

**Out of scope:** checkout and portal sessions (MUT-362), enforcement (MUT-361), cancelling (MUT-333), and `founderUntil` (MUT-363, see D3).

## 2. Design

```
Stripe ──POST raw body──▶ /v1/billing/stripe/webhook (public, own limiter, 256 KB cap)
                               │ verify Stripe-Signature (StripeGateway.verifyEvent)
                               ▼
                         billing/stripe/sync.ts ── handleEvent(event)
                               │ 1. stripeEvents.begin(id) → done? 200, stop
                               │ 2. re-fetch: gateway.subscription(id) / customer(id)
                               │ 3. linkCustomer() → billing.saveAccount (never unlinks)
                               │ 4. mirrorOf(sub, products) → billing.saveSubscription
                               │    (newer-wins, audit billing.subscription_changed on change)
                               │ 5. stripeEvents.finish(id, ok | error)
Cloud Scheduler ──X-Job-Token──▶ /jobs/v1/billing/stripe-reconcile ─┐
operator CLI ──X-Admin-Token──▶ /admin/v1/billing/stripe/reconcile ─┴▶ reconcile(): list every
                                                                       subscription, syncSubscription each
```

### 2.1 The Stripe port: `server/src/billing/stripe/gateway.ts`

`interface StripeGateway` has these methods:

- `verifyEvent(raw: string, signature: string, now: Date): StripeEventEnvelope`
  - It throws `InvalidSignature`.
  - The envelope is `{ id, type, livemode, created, object: { id, customer?, subscription?, client_reference_id?, … } }`. Only the ids are read from it.
- `subscription(id)`
  - Retrieves the subscription with `expand: ['items.data.price.product', 'customer']`.
- `customer(id)`
- `listSubscriptions(): AsyncIterable<StripeSubscription>`
  - Uses `status: 'all'` and auto-pagination at 100 per page.
  - A list can't expand `price.product`: that path is five levels deep, and Stripe stops at four. So products come from the next method.
- `listProducts(): Promise<Map<id, product>>`
  - Called once per reconcile run.

Two adapters implement it:

- **`StripeSdkGateway`** is the production adapter. It adds the `stripe` dependency, pinned to the 23.x SDK, and constructs the client with an **explicit `apiVersion`**, which is the version that SDK ships with. Other settings: `maxNetworkRetries: 2`, `timeout: 10_000`, and no telemetry.
- **`FakeStripeGateway`** lives in `src/billing/stripe/__tests__/fake.ts`. It holds objects in memory. It signs test payloads with the SDK's `webhooks.generateTestHeaderString`, so tests verify **real** signatures.

The pinned version matters because API version `2025-03-31.basil` moved `current_period_end` from the Subscription onto its items. So `mirrorOf` reads the item-level period: the maximum across items, falling back to the top-level field. A fixture test proves this.

### 2.2 Pure mapping: `server/src/billing/stripe/mirror.ts`

`mirrorOf(sub, productsById, fetchedAt): { ok: SaveBillingSubscriptionInput } | { error: MirrorError }`. It has no I/O and is unit-tested.

**Tier:**
- It comes from `product.metadata.tier` (`freelancer` or `firm`) and never from the amount.
- If there is no item with a tier product, or two items carry different tiers, the result is `UNKNOWN_TIER`. The subscription is **not written** and the error is recorded, never guessed.

**Other fields:**

| Field | Source |
|---|---|
| `priceLookupKey` | `price.lookup_key` |
| `organizationId` | `subscription.metadata.mutaba3a_organization_id` (UUID shape), else null |
| `status` | Stripe's string, as Stripe sends it |
| `cancelAtPeriodEnd` | `cancel_at_period_end` |
| `currentPeriodEnd` | the item-level period (see §2.1) |
| `founderUntil` | null (D3) |
| `stripeUpdatedAt` | **`fetchedAt`**, the time we read Stripe |

`stripeUpdatedAt` uses `fetchedAt` because a Subscription has no "updated" timestamp of its own. A re-fetched object is Stripe's state at the moment we read it. So "newer read wins" is the correct order guard, and it also covers two handlers racing each other.

**Currency:** the account's currency comes from `sub.currency` (uppercased). Anything other than `ILS` or `USD` is `UNSUPPORTED_CURRENCY`.

### 2.3 Sync service: `server/src/billing/stripe/sync.ts`

Its dependencies are `{ store, gateway, logger, now }`. It has three functions.

**`handleEvent(event)`**

Handled event types: `checkout.session.completed`, `customer.subscription.created|updated|deleted|paused|resumed`, `invoice.paid`, `invoice.payment_failed`, `customer.updated`. Any other type gets 200 and isn't stored.

An event whose `livemode` doesn't match the key's mode is logged and ignored with 200.

1. `store.stripeEvents.begin({ id, type, at })` returns `{ alreadyProcessed }`. If it's already processed, return.
   - A row that exists but has `processedAt` null is a failed earlier attempt, so it **is processed again**. Re-fetching makes that safe.
2. Work out the subscription id:
   - from the object for `customer.subscription.*`;
   - through `subscriptionIdOf(invoice)` for invoices, a helper that covers the pinned version's field path, with a fixture test;
   - from `session.subscription` for checkout.
3. `checkout.session.completed`: `linkCustomer(customerId, { userId: session.client_reference_id })`. A completed session's `client_reference_id` can't change, so reading it from the signed payload is safe.
4. `customer.updated`: `linkCustomer(customerId)`, which refreshes the country and the metadata link.
5. `syncSubscription(subId, { source: 'webhook', eventId })`.
6. `stripeEvents.finish(id, { processedAt })`. On a mapping error, finish with `{ error: code }` and still return 200, because Stripe retrying won't fix metadata. On a transient Stripe or DB error, record the error and return **500**, so Stripe retries for up to three days.

**`linkCustomer(customerId, hint?)`**

1. Re-fetch the customer.
2. Pick the candidate user: `hint.userId ?? customer.metadata.mutaba3a_user_id`.
3. Call `billing.saveAccount({ stripeCustomerId, userId: candidate, country: address.country, currency })`.
   - The candidate must exist. If it doesn't (a foreign-key failure), the account is stored unlinked, and the error is `UNKNOWN_USER`.

**`syncSubscription(subId, ctx)`**

1. Re-fetch the subscription.
2. `linkCustomer(sub.customer)`, using the customer object that came back expanded.
3. Run `mirrorOf`.
4. Call `billing.saveSubscription({ ...mirror, audit })`.
5. Return `changed | unchanged | error`.

**`reconcile(now)`**

1. Call `listProducts` once.
2. For every subscription from `listSubscriptions`, run `mirrorOf` and then `saveSubscription`. That is the same code path as the webhook, minus the per-subscription fetch.
3. Prune `stripe_events` rows older than 90 days.
4. Return `{ checked, changed, unlinked, errors: [{ subscriptionId, code }] }`.

Each run logs one summary line. Errors are logged at warn with ids only, so they reach Sentry (MUT-147).

### 2.4 Repository changes (no migration)

All of this goes in `ports.ts`, `prisma.ts`, `memory.ts`, `STORE_ACCESS` and the shared contract tests.

**`billing.saveAccount`: the semantics change. Today it unlinks.**

At the moment, a webhook passing `userId: null` would overwrite an operator's link. The new rule is that it **only ever fills an empty link**:

- If the input `userId` is null, the existing `userId` is kept.
- If the existing `userId` differs from the input, the existing link is kept, and the call returns `{ conflict: 'CUSTOMER_LINKED_ELSEWHERE' }`. It never throws.
- If the user already holds another customer, the account is stored unlinked, with `{ conflict: 'USER_HAS_ANOTHER_ACCOUNT' }`.
- When it does link, it writes `billing.account_linked` (actor SYSTEM, metadata `{ source: 'stripe' }`) on each owned profile, in the same transaction as the write.

**`billing.saveSubscription`: newer wins, plus audit.** It runs in one transaction:

1. `SELECT … FOR UPDATE` by `stripeSubscriptionId`.
2. If the stored `stripeUpdatedAt` is later than the input's, it's a no-op that returns `stale`.
3. Otherwise it writes the row. If any mirrored field changed, it also appends the caller's `audit[]` rows.

Each audit row is `billing.subscription_changed`, actor SYSTEM, entity `billing_subscription`. Its metadata is `{ stripeSubscriptionId, from: {status, tier, cancelAtPeriodEnd}, to: {…}, source, eventId }`, with dates as ISO strings. One row goes on each covered profile: the payer's owned profiles plus `organizationId`, de-duplicated. If no profile is reachable (an unlinked customer with no organization), it writes no audit and logs the id instead.

A unique violation when two first inserts race is retried once.

**New `stripeEvents` repository:**
- `begin({ id, type, at })` returns `{ alreadyProcessed }`. It uses insert … on conflict do nothing, then reads the row.
- `finish(id, { processedAt } | { error })`.
- `prune(before)`.
- All three are `operator` in `STORE_ACCESS`, because the webhook runs on the unguarded store (ADR-162 decision 6). The memory store implements them; `stripe_events` stays out of the snapshot, like the other billing tables.

### 2.5 Routes, all on API version `1.4x.0-mut360` (the number is agreed with MUT-373 and MUT-381 at build time)

**`POST /v1/billing/stripe/webhook`** (`routes/stripe-webhook.ts`, modelled on `publicFxRateRoutes`):
- `security: []`.
- Mounted in `createApp` **outside** `PORTAL_ROUTES`, because local mode must never serve it.
- Added to `PUBLIC_OPERATIONS` in `route-security.test.ts`.
- It declares no zod body, so the body isn't consumed. It reads `await c.req.text()`.
- `hono/body-limit` caps the body at 256 KB on this route only.
- Its own `SlidingWindowRateLimiter` is `STRIPE_WEBHOOK_POLICY = { ipPerMinute: 300 }`, with the key `stripe-webhook:<ip>`. It's pruned in `index.ts`.

| Situation | Response |
|---|---|
| Missing or bad signature | `400 INVALID_SIGNATURE`, with nothing stored |
| Not configured | `503 BILLING_NOT_CONFIGURED` |
| Success | `200 { received: true }` |
| Transient failure | `500` |

**`POST /admin/v1/billing/stripe/reconcile`** is admin-token, returns the summary, and has the CLI verb `npm run billing:reconcile`.

**`POST /jobs/v1/billing/stripe-reconcile`** is the same handler behind a new **job token**, compared timing-safe against `X-Job-Token`. This route is the only thing that token opens (D1). It runs through a new `jobAuth` middleware mounted at `/jobs/*`, which is the `adminAuth` shape with its own secret.

OpenAPI and `openapi:check` cover all three. `npm run hosted:types` is run even though the portal doesn't use these routes yet.

### 2.6 Config and logging (`config.ts`, `logger.ts`, `index.ts`)

**New config:**

| Variable | Rule |
|---|---|
| `STRIPE_SECRET_KEY` | optional, must match `^(rk|sk)_(test|live)_` |
| `STRIPE_WEBHOOK_SECRET` | optional, must match `^whsec_` |
| `MUTABA3A_JOB_TOKEN` | optional, at least 32 characters |

The two Stripe values come as **both or neither**, enforced by a post-parse check.

**When they're unset**, the gateway is `null`: the routes answer 503 and the server logs a boot warning, following the `ATTACHMENTS_BUCKET` pattern. Local development and every existing test stay Stripe-free.

**Logging:** `stripe-signature` is added to `SENSITIVE_KEYS`, and `logger.test.ts` gets a case for it. The SDK client is never logged, and errors are logged as `{ code, type, requestId }` only, never the raw Stripe error object (AC5).

### 2.7 Terraform (`server/infrastructure/terraform/`). Claude prepares it; Basel applies it.

- **Secrets:**
  - `google_secret_manager_secret` for `mutaba3a-api-stripe-secret-key` and `mutaba3a-api-stripe-webhook-secret`, with **no versions**. Basel adds the values with `gcloud secrets versions add`.
  - Accessor IAM for the API service account on both.
  - Both are mounted in Cloud Run only through a `dynamic "env"` behind `var.stripe_enabled` (default `false`), so applying before the values exist can't break a roll. This is the front-door-token pattern.
- **Job token:** `random_password` plus a secret, a version and IAM for `mutaba3a-api-job-token`, mounted always.
- **Scheduler:**
  - `cloudscheduler.googleapis.com` is added to `google_project_service.apis`.
  - `google_cloud_scheduler_job.stripe_reconcile` runs at `"30 3 * * *"`, `Asia/Jerusalem`, with an HTTP POST to `${service_uri}/jobs/v1/billing/stripe-reconcile`, the header `X-Job-Token`, and retries ×3. It's counted on `var.stripe_enabled`.
- **Tests and docs:**
  - `tests/stripe.tftest.hcl`: with the flag off there are no Stripe env vars and no job; with it on, both exist.
  - `server/DEPLOYMENT.md` gets an "Apply (Basel, once)" section.
  - `docs/operations/before-release.md` `## server` gets a line that is **not** blocking: the feature stays off until the flag is set.

### 2.8 Runbook and docs

**`docs/operations/pilot-runbook.md` §1.5, rewritten** as these steps:

1. Create the Products with `metadata.tier`.
2. Create the Prices with the lookup keys `freelancer_founder_{monthly|yearly}_{ils|usd}` and `firm_…`.
3. Set `mutaba3a_user_id` on the Customer before creating the subscription.
4. Set `mutaba3a_organization_id` on a firm's subscription.
5. Register the webhook endpoint with these 10 event types and copy `whsec_` into Secret Manager.
6. Create a **restricted key** with read access to Customers, Subscriptions, Products, Prices, Checkout Sessions, Invoices and Events.
7. After `/v1/me` shows source STRIPE, revoke the pre-billing grant.
8. Use `billing:unlinked` and `billing:reconcile`.

**Operator test-mode checks** go in the runbook as Basel's steps, not code: whether a UK account can charge in ILS, whether ILS can settle as ILS, and adding a USD bank account.

**Also updated:**
- `pilot-offer.md` §5: one line that the webhook is live.
- `.claude`:
  - an ADR for "the webhook and job token, newer read wins, never unlink";
  - TD entries for the full-list reconcile at scale and the job token versus OIDC;
  - the CHANGELOG;
  - INFRA (the Stripe row, Scheduler);
  - PATTERNS (the raw-body public webhook, the job token);
  - COMPONENT_REGISTRY (`billing/stripe/*`);
  - SYSTEM_OVERVIEW.

## 3. Reuse

| Need | Reuse |
|---|---|
| Unauthenticated route, per-IP limiter, null-dependency 503 | `publicFxRateRoutes`, `PUBLIC_FX_POLICY`, `requestClientIp`, the `ATTACHMENTS_BUCKET` 503 |
| Port plus injectable adapter, test fakes | `FxRateSource` / `FrankfurterSource`, `MemoryAttachmentStorage` |
| Audit fan-out per owned profile | `ownedProfilesOf` and admin-billing's `auditOn` shape |
| Billing writes and the unlinked listing | `billing.saveAccount`, `saveSubscription`, `listAccounts({ linked: false })`, `billing:unlinked` |
| Timing-safe token middleware | `adminAuth` (`routes/admin.ts`) |
| Secret plus Cloud Run mount | `session_pepper` (generated), front-door token (operator-supplied, conditional) |

## 4. Impact

- **API contract:** additive. There's a minor version bump, plus a new `/jobs/*` prefix, which is excluded from the SPA fallback the way `/admin/` is.
- **Data:** no migration. The tables come from MUT-358.
- **`saveAccount` behaviour:** it changes. Its only callers today are the contract tests, and they're updated.
- **Pilot grants and the entitlement order:**
  - After this lands, the `pre-billing` OPERATOR grants still win over STRIPE in `resolveEntitlement`, because OPERATOR is checked first.
  - So a linked pilot payer reads source OPERATOR until the runbook step revokes the grant.
  - That's intended, but AC3's test uses a user with no grant.
- **Co-owners (TD-193):** coverage still follows `profileOwnerOf`. MUT-373's change doesn't touch this ticket.

## 5. i18n, cost and infra

- **i18n:** there's no UI. The audit and error codes aren't translated.
- **Cost:**
  - Webhook: about 2 Stripe API calls per event (the subscription with the customer expanded).
  - Reconcile: ⌈subscriptions/100⌉ + 1 calls per night.
  - Cloud Scheduler: one job, inside the free tier of 3. Secret Manager: 3 secrets, cents a month.
  - Stripe API reads are free.
- **Infra:** the Terraform in §2.7. Basel applies it, and nothing changes until `stripe_enabled = true`.

## 6. Tests (TDD) and commands

The test plan file is `.claude/designs/mut-360-stripe-webhook-tests.md`. It's written first, at `/eng-build`.

**Pure (`billing/stripe/__tests__/mirror.test.ts`):**
- tier comes from metadata, and the same amount with a different metadata gives a different tier;
- `UNKNOWN_TIER` and mixed tiers;
- the item-level `current_period_end` versus the top-level fallback;
- the lookup key;
- the organization metadata;
- `UNSUPPORTED_CURRENCY`;
- `subscriptionIdOf(invoice)` against fixtures.

**Sync (`sync.test.ts`, with the fake gateway and the memory store):**
- **AC2:** deliver `updated` (canceled) and then an older `created`. The re-fetch ends canceled. A stale `fetchedAt` doesn't overwrite.
- **AC3:** customer metadata `mutaba3a_user_id` plus a subscription event gives a linked account, and `/v1/me` `billing` reads `{ ACTIVE, STRIPE }` for a user with no grant.
- **Unlinked:** the account is stored with userId null, shows in `GET /admin/v1/billing/accounts?linked=false`, and a later `billing link` makes it cover the user's profiles.
- **Conflicts:** a metadata user that differs from the operator's link keeps the operator's link and records `CUSTOMER_LINKED_ELSEWHERE`. An unknown user stays unlinked.
- **AC4:** a subscription changed in the fake with no event is repaired by `reconcile()`, which reports `changed: 1`. A second run reports `changed: 0` and writes no audit.
- `billing.subscription_changed` is written once per covered profile, and only when something changed.

**Route (`__tests__/stripe-webhook.test.ts`):**
- **AC1:** a bad, missing or expired signature gives 400 and no `stripe_events` row. The same signed event twice gives a single change and a single audit.
- an unconfigured route gives 503;
- a body over 256 KB gives 413;
- the rate limit gives 429;
- an unhandled type gives 200 with nothing stored;
- a mismatched livemode is ignored;
- a transient gateway error gives 500 and a row with an error; the retry then succeeds.
- The job route: the wrong token gives 401, and the admin token doesn't open `/jobs/*`.

**Store contract (`store-contract-billing.ts`, run on memory and Prisma):**
- `saveAccount` never unlinks, and reports conflicts instead;
- `saveSubscription` newer-wins and audits only on change;
- `stripeEvents` begin, finish and prune;
- the `STORE_ACCESS` entries.

**Config and log:**
- the both-or-neither rule and the key prefixes;
- `stripe-signature` is redacted.

**Terraform:** `tests/stripe.tftest.hcl`, plus `terraform fmt -check` and `validate`.

**Commands** (Node 22):
- `npm --prefix server run typecheck`
- `npm --prefix server run lint`
- `npm --prefix server test`
- `npm --prefix server run test:db`
- `npm --prefix server run openapi:check`
- the root `npm run hosted:types && npm run typecheck`

**Release-QA:** there's no UI. The suite above covers the behaviour, and AC3 gets one walkthrough in Stripe test mode. It's a `manual: true` catalog entry, because it needs Basel's Stripe account plus `stripe listen` forwarding to `:8787`. The steps are written in the runbook.

## 7. Decisions for Basel

- **D1, the reconcile trigger.** The plan uses Cloud Scheduler calling an HTTP route that only a new job token opens (`/jobs/*`). That needs no new image or Cloud Run job and keeps the admin token out of Scheduler.
  - Alternative: a Cloud Run job running a script, which is more infrastructure.
  - Alternative: putting the admin token in Scheduler, which widens a god token.
- **D2, how much reconcile scans.** Stripe can't list subscriptions by when they last changed. It filters only by `created` and the period fields. So the nightly run **lists every subscription** (`status=all`) instead of "updated since last run". That's ⌈n/100⌉ calls, which is trivial for the pilot. A TD revisits it past about 10k subscriptions.
- **D3, `founderUntil` stays null here.** Filling it needs the subscription schedule, and only MUT-363 uses it.
- **D4, a metadata link never overrides the operator's link.** A mismatch is kept, recorded and logged, not guessed.

---

# Eng review (/plan-eng-review, 2026-10-21)

Target: `.claude/designs/mut-360-stripe-webhook.md` (this file, §1–§7 above, unchanged as drafted).

## Scope record

feature answers: none proposed (every feature is in the ticket); structure: B, D1 "Smaller arrangement" (Basel, 2026-10-21); accepted scope: the plan's feature list unchanged, with the three HTTP entry points (webhook, `/jobs` reconcile, `/admin` reconcile) in one `server/src/routes/stripe-billing.ts`; pending remedies: R1–R4 (Scope Challenge), section findings to follow.

## Decision ledger

### R1: How the nightly reconcile is triggered (plan §7 D1)
Finding: SC-1, P2, confidence 9/10, plan §2.5 and §2.7, reviewer: Claude (plan-eng-review). `server/infrastructure/terraform/main.tf` has no scheduler or Cloud Run job, and Cloud Run is `allUsers` invoker (main.tf comment at L477-478: requests are authenticated by the service itself).
Plan baseline: original proposal, Cloud Scheduler HTTP POST to `/jobs/v1/billing/stripe-reconcile` with a dedicated `X-Job-Token` (TF-generated secret) that opens only that route.
Runtime evidence: `adminAuth` (routes/admin.ts:43-52) is the only token middleware; no OIDC verification exists in the server; Google recommends OIDC for Scheduler → Cloud Run, verified by IAM or by the receiver.
Comparison grid:
| Choice | Current | A | B | C |
|---|---|---|---|---|
| R1 trigger | proposal: job token | Scheduler + dedicated job token on `/jobs/*` | Scheduler + OIDC token verified in-app (google-auth-library) | Scheduler sends the admin token to the admin route |
| R2–R4 | pending | pending | pending | pending |
| Structure | B approved (D1) | unchanged | unchanged | unchanged |
Question D2:
D2 — How should Cloud Scheduler call the nightly reconcile?
Project/branch/task: mini-crm feature/mut-360-stripe-webhook, plan §2.5/§2.7.
ELI10: Every night a Google timer must poke the server to re-check Stripe. The server is open to the internet and checks credentials itself, so the timer needs a credential. A dedicated job token only opens the reconcile route; Google's own signed identity token is the textbook answer but needs a new library and verification code; reusing the admin token is simplest but parks the master key in the scheduler's config.
Stakes if we pick wrong: a leaked admin token can create users and grants; a leaked job token can only trigger a harmless re-sync.
Recommendation: A because it gives least privilege with the patterns the server already has.
Note: options differ in kind, not coverage — no completeness score.
Header: Reconcile auth
Options:
A) Dedicated job token (recommended)
New `MUTABA3A_JOB_TOKEN` (Terraform random_password in Secret Manager), timing-safe `jobAuth` on `/jobs/*`, opens only the reconcile route. Reuses the adminAuth shape. Leak blast radius: repeated reconciles. (human: ~2h / CC: ~15min)
B) Google OIDC token
Scheduler signs an ID token as a service account; the server verifies issuer, audience and email with google-auth-library (new dependency, new verification code and tests). Best practice, no shared secret, more moving parts. (human: ~1 day / CC: ~45min)
C) Reuse the admin token
Scheduler sends X-Admin-Token to `/admin/v1/billing/stripe/reconcile`. No new token or route prefix, but the master operator token sits in Scheduler config and Terraform state for one more consumer. (human: ~1h / CC: ~10min)

State: approved
Actual answer: A) Dedicated job token (Basel, D2, 2026-10-21)
Accepted scope: `MUTABA3A_JOB_TOKEN` (Terraform random_password + Secret Manager secret, version, IAM, Cloud Run mount); timing-safe `jobAuth` middleware on `/jobs/*` (adminAuth shape); it opens only `POST /jobs/v1/billing/stripe-reconcile`; Cloud Scheduler sends it as `X-Job-Token`; tests: wrong/missing token → 401, admin token does not open `/jobs/*`, job token does not open `/admin/*`.
History: none

### R2: How much the nightly reconcile scans (plan §7 D2)
Finding: SC-2, P2, confidence 8/10, plan §2.3 `reconcile`, reviewer: Claude. Ticket text says "re-lists subscriptions updated since its last run"; Stripe's list endpoint filters by `created`, `current_period_*`, customer, price and status, with no updated-time filter (Stripe API reference, subscriptions/list).
Plan baseline: original proposal, list every subscription (`status=all`) each night, ⌈n/100⌉ page calls.
Runtime evidence: no Stripe code exists yet; `stripe_events` has no cursor column (schema.prisma:1265-1274).
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R2 scan | proposal: full list | full list every night, TD past ~10k subs | walk `events.list` since a stored cursor (30-day retention), re-sync the subscriptions they name |
| R1 trigger | A approved (D2) | unchanged | unchanged |
| R3–R4 | pending | pending | pending |
Question D3:
D3 — Should the nightly reconcile re-check every subscription, or only ones Stripe's event log says changed?
Project/branch/task: mini-crm feature/mut-360-stripe-webhook, plan §2.3.
ELI10: The ticket asks to re-check "subscriptions updated since the last run", but Stripe can't list subscriptions by when they changed. Option A just re-reads all of them each night, which is a few calls for the pilot and catches everything. Option B reads Stripe's event log since last night and re-checks only those, which scales better but misses anything the log does not mention and needs a stored cursor.
Stakes if we pick wrong: B can leave a dropped change unrepaired (the whole point of reconcile); A costs more Stripe calls once there are many thousands of subscriptions.
Recommendation: A because it repairs every kind of drift and costs ⌈n/100⌉ free API calls, trivial for the pilot.
Completeness: A=10/10, B=7/10
Header: Reconcile scope
Options:
A) List every subscription (recommended)
`subscriptions.list({ status: 'all' })` auto-paginated each night, plus `products.list` once; a TD revisits past ~10k subscriptions. Simple, catches all drift. (human: ~2h / CC: ~10min)
B) Event log since a cursor
`events.list` of the 10 handled types since a stored cursor, re-sync each named subscription. Needs a cursor (new column or table and a migration), misses drift with no event, and breaks if the gap exceeds Stripe's 30-day event retention. (human: ~1 day / CC: ~40min)

State: approved
Actual answer: A) List every subscription (Basel, D3, 2026-10-21)
Accepted scope: nightly `subscriptions.list({ status: 'all' })` auto-paginated at 100, `products.list` once per run; no cursor, no migration; a TD records the revisit point (~10k subscriptions); the ticket's "updated since its last run" wording is noted back on Jira as superseded.
History: none

### R3: `founderUntil` in this ticket (plan §7 D3)
Finding: SC-3, P3, confidence 8/10, plan §2.2 table, reviewer: Claude. `founderUntil DateTime?` exists (schema.prisma:1232-1233, "The end of a founder-price lock (12 months, D4)"); `resolveEntitlement` does not read it (entitlement.ts SubscriptionFact has no founderUntil); MUT-363 owns the founder→list move.
Plan baseline: original proposal, write null in MUT-360.
Runtime evidence: no reader of `founderUntil` in server/src (entitlement.ts:42-51 SubscriptionFact fields).
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R3 founderUntil | proposal: null | null now, MUT-363 fills it | fill from the subscription schedule's founder-phase end_date (extra schedule fetch per sync) |
| R1, R2 | approved (D2, D3) | unchanged | unchanged |
| R4 | pending | pending | pending |
Question D4:
D4 — Should MUT-360 fill in when a founder price ends, or leave that to MUT-363?
Project/branch/task: mini-crm feature/mut-360-stripe-webhook, plan §2.2.
ELI10: Each mirrored subscription has a slot for "founder price ends on". Filling it means also reading the subscription's schedule from Stripe on every sync. Nothing reads the slot yet; MUT-363 (the firm founder-price move) is the first user.
Stakes if we pick wrong: leaving it null means MUT-363 adds the schedule read later; filling it now adds a Stripe call per sync with no reader.
Recommendation: A because nothing uses it until MUT-363, and the schedule read belongs with the code that acts on it.
Completeness: A=8/10, B=10/10
Header: founderUntil
Options:
A) Leave null, MUT-363 fills (recommended)
Write null; note on MUT-363 that it must read the schedule (founder-phase end_date) and backfill via reconcile. No extra Stripe call now. (human: ~0 / CC: ~0)
B) Fill it now
Fetch `subscription.schedule` when present and store the founder-phase end_date; one extra Stripe call per sync with a schedule, plus fixture tests. (human: ~3h / CC: ~20min)

State: approved
Actual answer: A) Leave null, MUT-363 fills (Basel, D4, 2026-10-21)
Accepted scope: `mirrorOf` writes `founderUntil: null`; a Jira note on MUT-363 says it must read the subscription schedule's founder-phase end_date and backfill through reconcile.
History: none

### R4: When Stripe metadata names a different person than the operator's link (plan §7 D4)
Finding: SC-4, P2, confidence 9/10, plan §2.4, reviewer: Claude. Today `saveAccount` overwrites the link: prisma.ts:1626 `update: { userId: input.userId, country: input.country, currency: input.currency }`, so a webhook passing a different (or null) userId would silently move or drop an operator's `billing link`.
Plan baseline: original proposal, fill an empty link only; a mismatch keeps the existing link and is recorded as `CUSTOMER_LINKED_ELSEWHERE`.
Runtime evidence: admin `billing link` (admin-billing.ts:136-170) refuses `CUSTOMER_LINKED_ELSEWHERE` with 409; no webhook writer exists yet.
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R4 precedence | proposal: existing link wins | existing link always wins; mismatch recorded + logged; operator fixes by hand | Stripe metadata wins; the webhook relinks and audits `billing.account_linked` |
| R1–R3 | approved (D2–D4) | unchanged | unchanged |
Question D5:
D5 — If Stripe's metadata names a different person than the operator linked, who wins?
Project/branch/task: mini-crm feature/mut-360-stripe-webhook, plan §2.4.
ELI10: A Stripe customer can be tied to a Mutaba3a person two ways: the operator runs `billing link`, or the customer carries `mutaba3a_user_id` metadata. If they disagree, one must win. Keeping the existing link means a typo in Stripe can never move someone's paid coverage to another person; letting Stripe win means fixing it in the Stripe dashboard is enough.
Stakes if we pick wrong: A leaves a stale link until the operator acts; B lets one bad metadata edit silently strip coverage from a paying user and hand it to someone else.
Recommendation: A because a payer's access should never move without a human looking, and the conflict is logged for the operator.
Note: options differ in kind, not coverage — no completeness score.
Header: Link precedence
Options:
A) Existing link wins (recommended)
`saveAccount` only fills an empty link; a mismatch keeps it, records `CUSTOMER_LINKED_ELSEWHERE` on the event and logs at warn (Sentry). The operator relinks with the admin route. (human: ~1h / CC: ~10min)
B) Stripe metadata wins
The webhook relinks the customer to the metadata user and audits `billing.account_linked` (SYSTEM) on both people's profiles. Self-healing from the dashboard, but a typo moves coverage silently. (human: ~2h / CC: ~15min)

State: approved
Actual answer: A) Existing link wins (Basel, D5, 2026-10-21)
Accepted scope: `billing.saveAccount` only fills an empty `userId`; a null input keeps the existing link; a different input keeps the existing link and returns `{ account, conflict: 'CUSTOMER_LINKED_ELSEWHERE' }` (a user who already holds another customer returns `USER_HAS_ANOTHER_ACCOUNT` and stays unlinked); the sync records the code on the `stripe_events` row and logs it at warn; contract tests on both stores.
History: none

Scope Challenge result: scope accepted as-is (structure B is a smaller arrangement, not a reduction).

## Section 1 — Architecture review

Factual corrections (no behaviour change, recorded without a question):
- FC-1 (confidence 8/10): plan §2.2 "`fetchedAt`, the time we read Stripe" means, for reconcile, the response time of the **list page** that carried the subscription, never the moment it is processed. Otherwise a webhook that wrote a newer state mid-run would be overwritten by an older page (`stripeUpdatedAt` guard, schema.prisma:1234 "so an older event never overwrites a newer state").
- FC-2 (confidence 9/10): `/jobs/` must join `PORTAL_EXCLUDED_PREFIXES` (app.ts:95 `const PORTAL_EXCLUDED_PREFIXES = ['/v1/', '/admin/'];`), or `/jobs/*` misses fall through to the SPA's index.html. Plan §4 already says so.

### R5: Where a billing account's currency comes from
Finding: A-1, P1, confidence 9/10, plan §2.3 `linkCustomer` ("`billing.saveAccount({ stripeCustomerId, userId: candidate, country: address.country, currency })`" with no currency source), reviewer: Claude. `BillingAccount.currency` is NOT NULL (schema.prisma:1199-1215, `currency String @db.VarChar(3)`), and a Stripe customer has no currency until its first subscription, so `checkout.session.completed` / `customer.updated` for a new customer cannot create the row.
Plan baseline: original proposal, `linkCustomer` creates or updates the account from any of the three event paths.
Runtime evidence: `saveAccount` create path is `create: input` (prisma.ts:1624), which would fail the NOT NULL constraint with a null currency.
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R5 account creation | proposal: any event path, currency unspecified | only `syncSubscription` creates an account (currency = `sub.currency`); checkout links through `session.subscription`; `customer.updated` only updates an existing account and is a no-op otherwise | any path creates it, currency = `customer.currency ?? sub.currency`, skip with `NO_CURRENCY` when both are null |
| R1–R4 | approved (D2–D5) | unchanged | unchanged |
Question D6:
D6 — Which event is allowed to create a customer's billing account row?
Project/branch/task: mini-crm feature/mut-360-stripe-webhook, plan §2.3.
ELI10: Every billing account must record ILS or USD. A brand-new Stripe customer only gets a currency once it has a subscription. The plan lets three different events create the account, but two of them can arrive before any currency exists, and the insert would fail. Letting only the subscription sync create accounts removes the problem; the alternative tries the customer's currency first and gives up when there is none.
Stakes if we pick wrong: the webhook 500s on the first event of every new customer, Stripe retries for days, and the payer shows as unpaid until a later event or reconcile.
Recommendation: A because one creation path is simpler and every real account has a subscription anyway.
Completeness: A=10/10, B=8/10
Header: Account creation
Options:
A) Only subscription sync creates (recommended)
`syncSubscription` is the one creator (currency from the subscription); checkout passes `client_reference_id` into it as the link hint; `customer.updated` refreshes country/link only on an existing row. Test: checkout before any account → account created with the subscription's currency. (human: ~1h / CC: ~10min)
B) Any path, customer currency first
Each path may create the row with `customer.currency ?? sub.currency`; when both are null it records `NO_CURRENCY` and waits for the next event or reconcile. Three creation paths to test. (human: ~2h / CC: ~15min)

State: approved
Actual answer: A) Only subscription sync creates (Basel, D6, 2026-10-21)
Accepted scope: `syncSubscription` is the only creator of a `billing_accounts` row (currency = `sub.currency` uppercased, ILS|USD); `checkout.session.completed` calls `syncSubscription(session.subscription, { linkHint: session.client_reference_id })`; `customer.updated` updates country/link on an existing row and is a no-op when none exists; test: checkout for a new customer creates the account with the subscription's currency; test: `customer.updated` for an unknown customer stores nothing and returns 200.
History: none

### R6: How long the webhook may wait on Stripe before answering
Finding: A-3, P2, confidence 6/10 (medium confidence, verify: Stripe does not publish its webhook timeout; third-party guides say "a few seconds"), plan §2.1 (`maxNetworkRetries: 2`, `timeout: 10_000`) and §2.3 (synchronous re-fetch before the 200), reviewer: Claude. Worst case per event: 2 calls × (1 try + 2 retries) × 10 s ≈ 60 s before Stripe gets an answer.
Plan baseline: original proposal, one gateway config for webhook and reconcile (10 s timeout, 2 retries).
Runtime evidence: Cloud Run throttles CPU outside a request unless CPU is always allocated, so "acknowledge first, work after" is unsafe here (main.tf has no `cpu_idle = false`; Layer 3 reasoning, not measured). Re-processing is safe: `stripe_events.processedAt` null rows are retried and the newer-read guard makes duplicates harmless.
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R6 webhook time budget | proposal: 10 s timeout, 2 retries (≈60 s worst case) | webhook gateway: 4 s timeout, 0 retries (≈8 s worst case), Stripe's own retry is the retry; reconcile keeps 10 s / 2 | keep one config (10 s / 2) for both |
| R1–R5 | approved (D2–D6) | unchanged | unchanged |
Question D7:
D7 — How long should the webhook wait on Stripe's API before it answers Stripe?
Project/branch/task: mini-crm feature/mut-360-stripe-webhook, plan §2.1 and §2.3.
ELI10: When Stripe sends us an event, we call Stripe back to read the latest subscription before we reply. If Stripe's API is slow, the plan's settings could keep the reply waiting up to about a minute, longer than Stripe will wait; Stripe then counts it as failed and resends. Tighter limits on the webhook path answer within seconds and let Stripe's own retry schedule do the retrying, while the nightly reconcile keeps the patient settings.
Stakes if we pick wrong: with the long budget, a slow Stripe API turns every event into timeouts and retry storms; with the short budget, a slow call fails fast and is retried by Stripe later (no data lost either way).
Recommendation: A because the retry already exists on Stripe's side and fast answers keep the endpoint healthy in Stripe's dashboard.
Completeness: A=9/10, B=7/10
Header: Webhook budget
Options:
A) Tight webhook budget (recommended)
Two gateway configs: webhook 4 s timeout and 0 SDK retries; reconcile 10 s and 2 retries. A slow call returns 500 and Stripe retries the event later. Test: a gateway timeout → 500, row kept unprocessed, redelivery succeeds. (human: ~1h / CC: ~10min)
B) One config for both
Keep 10 s / 2 retries everywhere. Simpler, but a slow Stripe API can hold each webhook reply for up to about a minute. (human: ~0 / CC: ~0)

State: approved
Actual answer: A) Tight webhook budget (Basel, D7, 2026-10-21)
Accepted scope: two `StripeSdkGateway` instances from config: webhook (`timeout: 4_000`, `maxNetworkRetries: 0`) and reconcile (`timeout: 10_000`, `maxNetworkRetries: 2`); a gateway timeout on the webhook path records the error on the `stripe_events` row and answers 500; test: timeout → 500 and `processedAt` null, redelivery of the same event → processed once.
History: none

### R7: Trusting `mutaba3a_organization_id` on a subscription
Finding: A-4, P2, confidence 6/10 (medium confidence, verify against how pilot firms are owned), plan §2.2 ("`organizationId` | `subscription.metadata.mutaba3a_organization_id` (UUID shape), else null"), reviewer: Claude. `subscriptionCovers` (entitlement.ts:121-125) returns true whenever `subscription.organizationId === profile.organizationId`, even for an unlinked payer, so a typo'd organization id in the dashboard silently makes another firm ACTIVE.
Plan baseline: original proposal, accept any UUID-shaped id (the FK rejects a non-existent one).
Runtime evidence: `billing_subscriptions.organizationId` FK to organizations with SetNull (schema.prisma:1217-1242); operator firms are owner-less (`ownerUserId IS NULL AND personalOwnerUserId IS NULL`, MUT-358 backfill); owned firms resolve their owner via `profileOwnerOf`.
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R7 org metadata | proposal: any existing org | the org must exist, and if it has an owner (`profileOwnerOf`) that owner must be the linked payer; otherwise store `organizationId: null`, record `ORG_NOT_PAYERS` and log at warn; owner-less operator firms are accepted | accept any existing org (FK check only) |
| R1–R6 | approved (D2–D7) | unchanged | unchanged |
Question D8:
D8 — Should a subscription only cover an organization its payer actually owns?
Project/branch/task: mini-crm feature/mut-360-stripe-webhook, plan §2.2.
ELI10: A firm's subscription carries the firm's id in Stripe metadata, typed by hand in the dashboard. Whatever id is there gets full paid coverage. Checking that the payer owns that firm (when the firm has an owner at all) stops a copy-paste mistake from giving a stranger's firm free access, at the cost of one ownership lookup per sync.
Stakes if we pick wrong: without the check, one wrong id quietly makes another customer's firm paid while the real firm looks unpaid.
Recommendation: A because the metadata is typed by hand and the lookup is one cheap query.
Completeness: A=9/10, B=6/10
Header: Org coverage
Options:
A) Payer must own the org (recommended)
Org must exist; if `profileOwnerOf(org)` is set it must equal the payer, otherwise `organizationId` is stored null with `ORG_NOT_PAYERS` recorded and logged. Owner-less operator firms pass. Tests for match, mismatch and owner-less. (human: ~2h / CC: ~15min)
B) Any existing org
Trust the metadata; the FK only rejects ids that do not exist. No extra query, no protection against a wrong but real id. (human: ~0 / CC: ~0)

State: approved
Actual answer: A) Payer must own the org (Basel, 2026-10-21: "take your recommendations and finish it", given after the D8 brief and a recap naming A as recommended)
Accepted scope: `mirrorOf` keeps `mutaba3a_organization_id` only when the organization exists and either has no owner (`profileOwnerOf` null, an operator firm) or its owner is the linked payer; otherwise `organizationId: null`, `ORG_NOT_PAYERS` recorded on the event or reconcile summary, warn log; tests: owner matches, owner differs, owner-less firm, unlinked payer with an owned org (→ null, recorded).
History: D8 first answer (2026-10-21) asked for a recap instead of choosing; recap given, then the instruction above.

### R8: Tests for the real Stripe adapter
Finding: T-1, P1, confidence 8/10, plan §2.1 (`StripeSdkGateway` is the production adapter) and §6 (every sync/route test uses `FakeStripeGateway`), reviewer: Claude. Nothing exercises the SDK call shapes: `expand: ['items.data.price.product', 'customer']`, `status: 'all'`, `limit: 100`, the pinned `apiVersion`, or how auto-pagination ends. A wrong expand path makes every production subscription `UNKNOWN_TIER` while every test stays green.
Plan baseline: original proposal, adapter untested except by the manual Stripe test-mode walkthrough (§6 Release-QA).
Runtime evidence: `FrankfurterSource` is tested through an injected `fetch` (`__tests__/fx-rates.test.ts`); stripe-node accepts `httpClient: Stripe.createFetchHttpClient(fetch)`, so the same seam exists without a new production export.
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R8 adapter proof | proposal: manual walkthrough only | `stripe-gateway.test.ts` with `Stripe.createFetchHttpClient(fakeFetch)` + recorded JSON fixtures: asserts request paths, `expand[]`, `status=all`, `limit=100`, `Stripe-Version` header, 2-page pagination, timeout config per instance | manual walkthrough only |
| R1–R7 | approved (D2–D8) | unchanged | unchanged |
Question (not sent; covered by the instruction below):
D9 — Test the real Stripe adapter against recorded responses? Recommendation: A because a wrong expand path or API version would break production silently. Completeness: A=10/10, B=6/10.
Header: Adapter tests
Options:
A) Recorded-response adapter tests (recommended)
`stripe-gateway.test.ts`, fake fetch through `Stripe.createFetchHttpClient`, fixtures captured once with `stripe` CLI in test mode. (human: ~3h / CC: ~20min)
B) Manual walkthrough only
Rely on the AC3 test-mode run. (human: ~0 / CC: ~0)

State: approved
Actual answer: A) Recorded-response adapter tests (Basel, 2026-10-21: "take your recommendations and finish it")
Accepted scope: `server/src/billing/stripe/__tests__/stripe-gateway.test.ts` as described in column A; fixtures under `server/src/billing/stripe/__tests__/fixtures/` with ids and emails scrubbed.
History: none

## Outside voice (Claude Plan subagent, native fallback: Codex not installed; completed in 247 s within the 300 s timer)

OUTSIDE VOICE (Claude subagent) findings, as reported, with the parent's verification:
- OV-1 Critical: reconcile never calls `linkCustomer`, so it cannot create accounts; pre-existing pilot subscriptions (no events until they change) never mirror, and a dropped `customer.updated` is never repaired. Verified: plan §2.3 `reconcile` ("mirrorOf and then saveSubscription … minus the per-subscription fetch") + prisma.ts:1631-1632 `if (!account) throw new ForeignKeyViolation(...)`. Disposition: correction under approved R2/R5 (R5 makes `syncSubscription` the one creator; R2 requires repairing every drift): reconcile sends each listed subscription (with `expand: ['data.customer']`) through the same `syncSubscription` used by the webhook; AC4 gains a no-account case.
- OV-2 High: R7's sync-time ownership check goes stale (nothing re-syncs after `billing link`; ownership can change) and makes `mirrorOf` do I/O; enforce at read time in `subscriptionCovers` instead. Verified: entitlement.ts:121-125 `if (subscription.organizationId === profile.organizationId) return true;` and `ProfileFacts.ownerUserId` is already passed in. Disposition: reopens R7 → R9 below.
- OV-3 High: no cutover sequence for existing pilot Products/Customers/Subscriptions; an untagged Product is `UNKNOWN_TIER`; revoking pre-billing grants before verification can drop a payer. Disposition: accepted as required runbook content (the runbook is in the ticket's scope).
- OV-4 Medium: `jobAuth` copied from `adminAuth` with an unset optional token accepts an empty header (`timingSafeEqual` on two zero-length buffers is true). Verified: routes/admin.ts:44-48. Disposition: correction under R1: unset token → `/jobs/*` answers 503 and never compares; test.
- OV-5 Medium: invoice payloads render at the webhook endpoint's API version, not the SDK's. Disposition: correction: `subscriptionIdOf` handles both `invoice.subscription` and `invoice.parent.subscription_details.subscription`; the runbook sets the endpoint's API version to the SDK's pinned version; one exported `HANDLED_EVENT_TYPES` list (9 types) feeds both the handler and the runbook text (the "10 event types" line was wrong).
- OV-6 Medium: audit `from`/`changed` are only known inside the `FOR UPDATE` transaction. Disposition: implementation detail of approved behaviour: `saveSubscription` takes `{ auditContext: { profileIds, source, eventId } }` and builds the `billing.subscription_changed` rows itself after the compare.
- OV-7 Medium: Checkout without an existing `customer` creates a second Customer → `USER_HAS_ANOTHER_ACCOUNT`, paid but uncovered. Disposition: the account stays unlinked and is listed by the existing `billing:unlinked` / `GET /admin/v1/billing/accounts?linked=false` (operator-visible, not only a log); a Jira note on MUT-362 that checkout must pass the existing `stripeCustomerId`; a FIRM-tier subscription without an organization records `FIRM_WITHOUT_ORG` (mirrored, covers the payer's own profiles only).
- OV-8 Medium: live keys outside the live environment; secret ids without `${local.suffix}`. Disposition: correction: post-parse check refuses `*_live_*` keys unless `API_KEY_ENVIRONMENT` is live; secret ids use `${local.suffix}` like every other secret.
- OV-9 Low: `fetchedAt` should be the request-sent time, not the response time (a slow earlier read could outrank a fast newer one). Disposition: correction supersedes FC-1's wording: `fetchedAt` = the time the request (page or retrieve) was sent.
- OV-10 Low: undefined no-ops (`invoice.paid` without a subscription, `checkout.session.completed` in payment mode, a deleted expanded customer). Disposition: each is a 200 no-op with a test.
- OV-11 Low: reconcile response under Scheduler retries; one SDK retry on the webhook. Disposition: reconcile always answers 200 with the error list in the body, sets `attempt_deadline = "320s"`, and an in-process guard refuses an overlapping run (409 `RECONCILE_RUNNING`). The retry suggestion conflicts with approved R6 (0 retries, Basel D7) and is not applied; recorded as a disagreement.
- OV-12 Low: app-shell.ts:54 logs `{ requestId, err }` for uncaught errors, so a raw Stripe error could be logged. Disposition: correction under AC5: the gateway wraps every SDK error into `StripeGatewayError { code, type, requestId, transient }`; a route test throws a raw SDK error and asserts the log line carries no message body or key.

Recommendation (outside voice): revise the plan before /eng-build, because the reconcile path as written cannot mirror the pilot's existing subscriptions.

### R9: Where firm coverage is checked (reopens R7)
Finding: OV-2, High, confidence 8/10, entitlement.ts:121-125, reviewer: outside voice (Claude Plan subagent), verified by parent. Reason for reopening: concrete new risk. With R7 as approved, a firm subscription synced before `billing link` (or before an ownership change) stores `organizationId: null` and stays uncovered until the next event or the nightly run.
Plan baseline: R7 approved A (Basel, 2026-10-21): check at sync time in `mirrorOf`, store null on mismatch.
Runtime evidence: `resolveEntitlement` receives `ProfileFacts { organizationId, ownerUserId, malafatConnected }` (entitlement.ts:35-40) and `SubscriptionFact.userId` (the payer); `admin-billing.ts` `billing link` does not re-sync subscriptions.
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R9 where the ownership rule lives | R7 A: sync time, stored null | read time: store the metadata org id as-is (FK-checked); `subscriptionCovers` covers an org-tied profile only when `profile.ownerUserId` is null (operator firm) or equals `subscription.userId`; `entitlement.test.ts` gains the rows; `mirrorOf` stays pure | keep R7 A as approved |
| Protection against a wrong org id | R7 A | same protection, always current after links and ownership changes | same protection, stale until next sync |
| R1–R6, R8 | approved | unchanged | unchanged |
Question D9:
D9 — Check firm ownership when reading coverage instead of when syncing?
Project/branch/task: mini-crm feature/mut-360-stripe-webhook, reopens D8 (R7).
ELI10: You chose that a firm's subscription only counts for a firm its payer owns. The second opinion found that checking it at sync time goes stale: if the operator links the payer after the subscription arrived, the firm stays unpaid until something re-syncs. Checking the same rule at the moment we compute coverage gives the identical protection, is always current, and keeps the mapping code simple.
Stakes if we pick wrong: with sync-time checking, a newly linked paying firm can look unpaid for up to a day.
Recommendation: A because it keeps your D8 rule exactly and removes the staleness.
Completeness: A=10/10, B=7/10
Header: Firm check
Options:
A) Check at read time (recommended)
Same rule as D8, enforced in `subscriptionCovers` (entitlement.ts), pure and always current; the subscription stores the metadata org id. Small change to MUT-358's resolver plus its rule-table tests. (human: ~1h / CC: ~10min)
B) Keep sync-time check
Leave R7 as approved: `mirrorOf` nulls the org on mismatch; a later link waits for the next event or the nightly run. (human: ~0 / CC: ~0)

State: approved
Actual answer: A) Check at read time (Basel, D9, 2026-10-21)
Accepted scope: supersedes R7's mechanism, keeps its rule. `mirrorOf` stores `metadata.mutaba3a_organization_id` as-is when UUID-shaped (FK rejects unknown ids → recorded `UNKNOWN_ORG`, stored null); `subscriptionCovers` (entitlement.ts) covers an org-tied profile only when `profile.ownerUserId === null` (operator firm) or `profile.ownerUserId === subscription.userId`; the payer's own profiles stay covered as today; `entitlement.test.ts` rule rows: owner matches, owner differs, owner-less firm, unlinked payer + owned org (not covered), then covered after `billing link` with no re-sync.
History: R7 approved A (sync-time check) earlier on 2026-10-21; reopened for OV-2; R7's sync-time mechanism is superseded by this answer.
