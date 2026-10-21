# MUT-360: Stripe webhook + nightly reconcile (mirror subscriptions, link the pilot's hand-made ones)

> **Ticket:** MUT-360 (epic MUT-322, `ga-gate`). Blocked by MUT-358, which is merged to local main 52a677f8. This ticket blocks MUT-362, MUT-363 and MUT-333.
> **Source design:** `docs/commercial/billing-spike.md` §4.5 and §5, ADR-160 decision 5, and ADR-162 decision 6.
> **Status:** approved plan. `/eng-ticket` drafted it and `/plan-eng-review` reviewed it, with a second opinion from a separate agent (2026-10-21). Basel answered D1–D9; §7 lists the answers, and the decision ledger below holds each question and its evidence. Sections 1–6 already include every accepted change.

## 1. Problem and acceptance criteria

Pilot users pay through Stripe subscriptions that the operator creates by hand (`pilot-offer.md` §5). The server never hears about them, so MUT-358's entitlements can't tell who paid. A webhook that's missed or arrives out of order must never leave a payer locked out.

From the ticket:

- **AC1:** a signature failure returns 400 and changes nothing. Replaying the same event a second time changes nothing.
- **AC2:** events that arrive out of order still end in Stripe's current state, because each one re-fetches. A test covers this.
- **AC3:** a hand-made test-mode subscription whose customer carries `mutaba3a_user_id` shows up in `/v1/me` `billing` with no operator step beyond that metadata.
- **AC4:** the reconcile job repairs a subscription whose webhook was dropped, including one whose account doesn't exist yet. A test covers this.
- **AC5:** secrets are never logged. The Terraform plan is reviewed and handed to Basel.

**Out of scope:**
- checkout and portal sessions (MUT-362);
- enforcement (MUT-361);
- cancelling (MUT-333);
- `founderUntil` (MUT-363, see D4).

**Ticket text superseded (D3):** the ticket says reconcile re-lists subscriptions "updated since its last run". Stripe can't filter subscriptions by update time, so reconcile lists every subscription instead.

## 2. Design

```
Stripe ──POST raw body──▶ POST /v1/billing/stripe/webhook  (public, own limiter, 256 KB cap)
                               │ gateway.verifyEvent(raw, Stripe-Signature) ── bad → 400, nothing stored
                               ▼
                         sync.handleEvent(event)
                               │ type ∉ HANDLED_EVENT_TYPES or livemode mismatch → 200, nothing stored
                               │ stripeEvents.begin(id) ── processed already → 200
                               │ subscription id? (sub event / invoice / checkout) ── none → 200 no-op
                               │ customer.updated → refresh an EXISTING account only
                               ▼
                         sync.syncSubscription(subOrId, { linkHint?, fetchedAt, source, eventId? })
                               │ re-fetch (webhook) or use the listed object (reconcile)
                               │ billing.saveAccount  (the only creator; fills an empty link, never unlinks)
                               │ mirrorOf(sub, products, fetchedAt)  (pure)
                               │ billing.saveSubscription  (FOR UPDATE, newer read wins, audit on change)
                               ▼
                         stripeEvents.finish(id, ok | error)  → 200 (mapping error) / 500 (transient)

Cloud Scheduler ──X-Job-Token──▶ POST /jobs/v1/billing/stripe-reconcile ─┐
operator CLI ──X-Admin-Token──▶ POST /admin/v1/billing/stripe/reconcile ─┴▶ sync.reconcile():
     listProducts once; listSubscriptions(expand data.customer) page by page;
     syncSubscription(listed sub, { fetchedAt: page request time }) each; prune stripe_events > 90 d
```

### 2.1 The Stripe port: `server/src/billing/stripe/gateway.ts`

`interface StripeGateway`:

- `verifyEvent(raw, signature, now): StripeEventEnvelope`
  - Throws `InvalidSignature`.
  - Uses the SDK's `webhooks.constructEvent`, with the default 300 s tolerance.
- `subscription(id): { sub, fetchedAt }`
  - Expands `items.data.price.product` and `customer`.
  - `fetchedAt` is the time the request was **sent**.
- `customer(id): { customer, fetchedAt }`
- `listSubscriptions(): AsyncIterable<{ sub, fetchedAt }>`
  - Uses `status: 'all'` and `limit: 100`, and expands `data.customer`, which is two levels deep.
  - Each page's `fetchedAt` is the time that page's request was sent.
  - A list can't expand `price.product`, which is five levels deep (Stripe's limit is four). Products therefore come from `listProducts`.
- `listProducts(): Promise<Map<id, product>>`, called once per reconcile run.

**`StripeSdkGateway`** is the production adapter.
- It uses the `stripe` dependency (23.x), with an **explicit `apiVersion`**: the version that SDK ships with.
- Telemetry is off.
- It is built twice from config (D7):
  - **webhook** instance: `timeout: 4_000`, `maxNetworkRetries: 0`;
  - **reconcile** instance: `timeout: 10_000`, `maxNetworkRetries: 2`.
- Every SDK error is wrapped as `StripeGatewayError { code, type, requestId, transient }`, so nothing raw reaches a logger. Transient means a network error, a timeout, 429 or 5xx.
- Tests (D9's R8): `stripe-gateway.test.ts` uses `Stripe.createFetchHttpClient(fakeFetch)` with recorded JSON fixtures. It asserts:
  - the request paths;
  - `expand[]`, `status=all` and `limit=100`;
  - the `Stripe-Version` header;
  - two-page pagination;
  - each instance's timeout and retry settings;
  - that the error wrapping happens.

**`FakeStripeGateway`** (`src/billing/stripe/__tests__/fake.ts`) holds objects in memory. It signs payloads with `webhooks.generateTestHeaderString`, so route tests verify real signatures.

**The period end:** API version `2025-03-31.basil` moved `current_period_end` from the Subscription to its items. `mirrorOf` therefore reads the maximum item-level period, falling back to the top-level field, and a fixture test covers both shapes.

### 2.2 Pure mapping: `server/src/billing/stripe/mirror.ts`

`mirrorOf(sub, productsById, fetchedAt): { ok: SaveBillingSubscriptionInput, notes: Code[] } | { error: MirrorError }`. It does no I/O.

**Tier** comes from `product.metadata.tier` (`freelancer` | `firm`), never from the amount. If no item has a tier, or the items have mixed tiers, the result is `UNKNOWN_TIER`. Nothing is written, and the error is recorded.

| Field | Source |
|---|---|
| `priceLookupKey` | `price.lookup_key` |
| `organizationId` | `metadata.mutaba3a_organization_id` when it's UUID-shaped, else null. A FIRM-tier subscription without one is still mirrored, with the note `FIRM_WITHOUT_ORG`. |
| `status` | Stripe's own string |
| `cancelAtPeriodEnd` | `cancel_at_period_end` |
| `currentPeriodEnd` | the item-level period (§2.1) |
| `founderUntil` | null (D4; MUT-363 fills it) |
| `stripeUpdatedAt` | `fetchedAt`, the time the request was sent |

**`stripeUpdatedAt`:** a Subscription has no updated timestamp of its own. A re-read is Stripe's state as of the moment the request was sent, so "newer read wins" is the right order guard, for out-of-order events and for racing handlers alike.

**Currency:** `sub.currency`, uppercased. Anything other than ILS or USD gives `UNSUPPORTED_CURRENCY`.

### 2.2b Coverage rule for firms: `server/src/billing/entitlement.ts` (D8 + D9)

`subscriptionCovers` changes. When a subscription is tied to the profile's organization, it covers the profile only if:
- `profile.ownerUserId === null`, meaning an owner-less operator firm; or
- `profile.ownerUserId === subscription.userId`, meaning the payer owns it.

A payer's own profiles stay covered as they are today.

The check runs at read time, so it stays pure and always current. A `billing link` or a change of ownership takes effect on the next `/v1/me`, with no re-sync.

`entitlement.test.ts` gains rule rows for:
- the owner matches;
- the owner differs;
- an owner-less firm;
- an unlinked payer on an owned firm (not covered);
- the same subscription after `billing link` (covered).

### 2.3 Sync service: `server/src/billing/stripe/sync.ts`

Dependencies: `{ store, webhookGateway, reconcileGateway, logger, now }`.

`HANDLED_EVENT_TYPES` is exported, and the runbook text is generated from it:
- `checkout.session.completed`
- `customer.subscription.created`, `.updated`, `.deleted`, `.paused` and `.resumed`
- `invoice.paid`
- `invoice.payment_failed`
- `customer.updated`

That's 9 types.

**`handleEvent(event)`**

1. If the type isn't handled, or `livemode` doesn't match the key's mode, return 200 and store nothing. A livemode mismatch is also logged.
2. `stripeEvents.begin({ id, type, at })`. If the event was already processed, return 200. A row whose `processedAt` is null is processed again; that is safe because the subscription is re-fetched.
3. Find the subscription id:
   - `customer.subscription.*`: the object's own id.
   - Invoices: `subscriptionIdOf(invoice)`, which reads `invoice.subscription` **or** `invoice.parent.subscription_details.subscription`, so either endpoint API version works. A fixture test covers each.
   - `checkout.session.completed`: `session.subscription`, with `linkHint = session.client_reference_id`. A completed session's value can't change.
   - No subscription (`invoice.paid` without one, or a checkout in payment mode) → no-op, 200.
4. `customer.updated` → `refreshCustomer(customerId)`. It updates country and link **only on an existing account**; otherwise it's a no-op (D6).
5. Otherwise → `syncSubscription(subId, { linkHint, source: 'webhook', eventId })`.
6. `stripeEvents.finish`:
   - success: `{ processedAt }`;
   - mapping error (`UNKNOWN_TIER`, `UNSUPPORTED_CURRENCY`, `UNKNOWN_USER`, `UNKNOWN_ORG`): `{ error: code }` and **200**, because a retry won't fix metadata;
   - transient `StripeGatewayError` or DB error: `{ error }` and **500**, so Stripe retries (D7).

**`syncSubscription(subOrId, ctx)`** is the one path that creates accounts (D6), shared by the webhook and reconcile.

1. Get the subscription and `fetchedAt`. The webhook calls `webhookGateway.subscription(id)`; reconcile passes the listed object and its page's request time.
2. If the expanded customer is `{ deleted: true }`, skip with the note `CUSTOMER_DELETED`.
3. `billing.saveAccount`:
   - `stripeCustomerId`;
   - `userId` = `ctx.linkHint ?? customer.metadata.mutaba3a_user_id ?? null`;
   - `country` = `customer.address?.country`;
   - `currency` = the subscription's currency.

   An unknown user is stored unlinked and noted `UNKNOWN_USER`. A conflict (D5) is noted and logged at warn.
4. `mirrorOf`. On error, record it and stop.
5. `billing.saveSubscription({ ...mirror, auditContext })`. The `auditContext` carries:
   - `profileIds`: the payer's owned profiles (`ownedProfilesOf`) plus `organizationId`, de-duplicated, computed only when the account is linked or an organization is set;
   - `source`;
   - `eventId`.
6. Return `changed | unchanged | stale | error`, plus notes.

**`reconcile()`**

1. An in-process guard refuses an overlapping run with `409 RECONCILE_RUNNING`.
2. `listProducts` once.
3. Each listed subscription goes through `syncSubscription` with its page's `fetchedAt`.
4. Prune `stripe_events` older than 90 days.
5. Return `{ checked, changed, unlinked, errors: [{ subscriptionId, code }] }`, always with **200**, so Scheduler retries never repeat a scan that completed.
6. Log one summary line. Each error goes to warn with ids only. (Review correction: the server has no Sentry client; log-based alerts in `monitoring.tf` watch these lines.)

### 2.4 Repository changes (no migration)

These touch `ports.ts`, `prisma.ts`, `memory.ts`, `STORE_ACCESS` and the shared contract tests.

**`billing.saveAccount`** (D5) **fills an empty link and never unlinks.**
- A null input `userId` keeps the existing one.
- A different input keeps the existing one and returns `{ account, conflict: 'CUSTOMER_LINKED_ELSEWHERE' }`.
- A user who already holds another customer stays unlinked, with `USER_HAS_ANOTHER_ACCOUNT`. The account then appears in the existing `billing:unlinked` / `GET /admin/v1/billing/accounts?linked=false`.
- A new link writes `billing.account_linked` (SYSTEM, `{ source: 'stripe' }`) on each owned profile, in the same transaction.
- It never throws for conflicts.

**`billing.saveSubscription({ ...fields, auditContext })`** runs in one transaction:
1. `SELECT … FOR UPDATE` by `stripeSubscriptionId`.
2. If the stored `stripeUpdatedAt` is later than the input's, return `stale` and write nothing.
3. Otherwise write the row.
4. If any mirrored field changed, the repository itself builds one `billing.subscription_changed` row per `auditContext.profileIds` entry:
   - actor SYSTEM, entity `billing_subscription`;
   - metadata `{ stripeSubscriptionId, from: {status, tier, cancelAtPeriodEnd, organizationId}, to: {…}, source, eventId }`, with ISO dates.
   - With no profile ids, no audit is written and the id is logged.
5. A unique violation on two racing first inserts is retried once.

**New `stripeEvents` repository:**
- `begin({ id, type, at })` returns `{ alreadyProcessed }`, using insert on conflict do nothing, then a read;
- `finish(id, { processedAt } | { error })`;
- `prune(before)`.

All of these are `operator` in `STORE_ACCESS`, because the webhook and jobs run on the unguarded store (ADR-162 decision 6). The memory store implements them. `stripe_events` is kept out of the snapshot, like the other billing tables.

### 2.5 Routes: one file, `server/src/routes/stripe-billing.ts` (D1)

All of these are on API version `1.4x.0-mut360`. The number is agreed with MUT-373 and MUT-381 when the build starts; both currently claim ADR-163 and TD-194.

**`POST /v1/billing/stripe/webhook`** follows the shape of `publicFxRateRoutes`.
- It sets `security: []`.
- It is mounted outside `PORTAL_ROUTES`, and added to `PUBLIC_OPERATIONS` in `route-security.test.ts`.
- There is no zod body. It reads `await c.req.text()`.
- `hono/body-limit` caps the body at 256 KB.
- `STRIPE_WEBHOOK_POLICY = { ipPerMinute: 300 }`, keyed `stripe-webhook:<ip>` and pruned in `index.ts`.
- Responses:
  - 400 `INVALID_SIGNATURE`, with nothing stored;
  - 503 `BILLING_NOT_CONFIGURED`;
  - 413 when the body is over the cap;
  - 429 when rate-limited;
  - 200 `{ received: true }`;
  - 500 on a transient error.

**`POST /admin/v1/billing/stripe/reconcile`** is behind the admin token and has the CLI verb `npm run billing:reconcile`.

**`POST /jobs/v1/billing/stripe-reconcile`** runs the same handler.
- It sits behind the new `jobAuth` on `/jobs/*`, which compares `X-Job-Token` timing-safe (D2).
- **When `MUTABA3A_JOB_TOKEN` is unset, `/jobs/*` answers 503 and never compares.** That avoids the empty-buffer match.
- The job token opens nothing else. The admin token doesn't open `/jobs/*`, and the job token doesn't open `/admin/*`.

`/jobs/` joins `PORTAL_EXCLUDED_PREFIXES` (app.ts:95). OpenAPI and `openapi:check` cover all three routes, and `npm run hosted:types` is run.

### 2.6 Config and logging (`config.ts`, `logger.ts`, `index.ts`)

| Variable | Rule |
|---|---|
| `STRIPE_SECRET_KEY` | optional; `^(rk|sk)_(test|live)_` |
| `STRIPE_WEBHOOK_SECRET` | optional; `^whsec_` |
| `MUTABA3A_JOB_TOKEN` | optional; at least 32 characters |

Checks after parsing:
- The two Stripe values must be set together or not at all.
- A `*_live_*` key is refused unless `API_KEY_ENVIRONMENT` is `live` (config.ts:25).

When the Stripe values are unset, the gateways are `null`: routes answer 503 and the server logs a boot warning (the `ATTACHMENTS_BUCKET` pattern).

For logging, `stripe-signature` is added to `SENSITIVE_KEYS`, with a case in `logger.test.ts`. Gateway errors are logged as `{ code, type, requestId }` only. A route test throws a raw SDK error and asserts that the log line from app-shell.ts:54 carries no key and no body (AC5).

### 2.7 Terraform (`server/infrastructure/terraform/`): Claude prepares, Basel applies

- **Stripe secrets:** `mutaba3a-api-stripe-secret-key${local.suffix}` and `mutaba3a-api-stripe-webhook-secret${local.suffix}`.
  - The secrets are created **without versions**; Basel runs `gcloud secrets versions add`.
  - The API service account gets accessor IAM.
  - They are mounted through `dynamic "env"` behind `var.stripe_enabled` (default `false`), following the front-door-token pattern.
- **Job token:** `mutaba3a-api-job-token${local.suffix}`.
  - A `random_password`, a secret, a version and IAM.
  - Always mounted.
- **Scheduler:**
  - `cloudscheduler.googleapis.com` is added to `google_project_service.apis`.
  - `google_cloud_scheduler_job.stripe_reconcile`:
    - runs at `"30 3 * * *"` in `Asia/Jerusalem`;
    - POSTs to `${service_uri}/jobs/v1/billing/stripe-reconcile` with the `X-Job-Token` header;
    - `attempt_deadline = "280s"` (review: under Cloud Run's 300 s; the run stops itself at 200 s), retries ×3;
    - is counted on `var.stripe_enabled`.
  - Cloud Run runs with `cpu_idle = true` (main.tf:326), so the work happens inside the request. That is why there is no acknowledge-then-work path.
- **Tests:** `tests/stripe.tftest.hcl`.
  - With the flag off: no Stripe env vars and no job.
  - With it on: both exist, and the names carry the suffix.
- **Docs:**
  - `server/DEPLOYMENT.md` gets an "Apply (Basel, once)" section.
  - `docs/operations/before-release.md` `## server` gets a line that does **not** block release, because the feature stays off until the flag is set.

### 2.8 Runbook and docs

**`docs/operations/pilot-runbook.md` §1.5 is rewritten as an ordered checklist**, with each step checked before the next:

1. **Catalog:**
   - Each Product has `metadata.tier`, and existing Products are backfilled.
   - Prices use the lookup keys `freelancer_founder_{monthly|yearly}_{ils|usd}` and `firm_…`.
2. **Existing pilot customers:**
   - Set `metadata.mutaba3a_user_id` on each Customer.
   - Set `metadata.mutaba3a_organization_id` on each firm's subscription.
3. **Restricted key:** read access to Customers, Subscriptions, Products, Prices, Checkout Sessions, Invoices and Events. Add it with `gcloud secrets versions add`.
4. **Webhook endpoint:**
   - The 9 event types listed by `HANDLED_EVENT_TYPES`.
   - **Its API version set to the SDK's pinned version.**
   - Copy `whsec_` into Secret Manager.
5. **Turn it on:**
   - Set `stripe_enabled = true` and apply.
   - Run `npm run billing:reconcile` once and read the summary. Errors must be empty, or each must be explained.
6. **Verify:**
   - Every pilot user's `GET /v1/me` shows the expected profiles ACTIVE.
   - `billing:unlinked` is empty.
7. **Grants:** only then revoke the `pre-billing` grants, one person at a time, rechecking `/v1/me` after each.
8. **Afterwards:** use `billing:unlinked` and `billing:reconcile` as the daily operator tools. A new subscription gets its metadata **before** it is created.

**Basel's test-mode checks** go into the runbook, not code:
- whether the UK account can charge ILS;
- whether ILS can settle as ILS;
- adding a USD bank account.

**Also updated:**
- `pilot-offer.md` §5: a line saying the webhook is live.
- `.claude`:
  - an ADR: webhook and job token, newer read wins, never unlink, firm coverage checked at read time;
  - TD entries: the full-list reconcile at scale (~10k), and the job token versus OIDC;
  - CHANGELOG;
  - INFRA: the Stripe row and Scheduler;
  - PATTERNS: the raw-body public webhook, the job token, gateway error wrapping;
  - COMPONENT_REGISTRY: `billing/stripe/*`;
  - SYSTEM_OVERVIEW.

**Jira notes on other tickets:**
- MUT-363 must fill `founderUntil` from the subscription schedule (D4).
- MUT-362's checkout must pass the existing `stripeCustomerId`, or a returning payer gets a second customer that stays unlinked (OV-7).

## 3. Reuse

| Need | Reuse |
|---|---|
| Unauthenticated route, per-IP limiter, null-dependency 503 | `publicFxRateRoutes`, `PUBLIC_FX_POLICY`, `requestClientIp`, the `ATTACHMENTS_BUCKET` 503 |
| Port with an injectable adapter, plus test fakes | `FxRateSource` / `FrankfurterSource` (injected fetch), `MemoryAttachmentStorage` |
| Audit fan-out per owned profile | `ownedProfilesOf` (personal-profile.ts:32), admin-billing's `auditOn` shape |
| Billing writes and the unlinked listing | `billing.saveAccount`, `saveSubscription`, `listAccounts({ linked: false })`, `billing:unlinked` |
| Timing-safe token middleware | `adminAuth` (routes/admin.ts:43-52), plus the unset-token 503 |
| Secret plus Cloud Run mount | `session_pepper` (generated), front-door token (operator-supplied, conditional) |

## 4. Impact

- **API contract:** additive, with a minor version bump. New prefix `/jobs/*`, excluded from the SPA fallback.
- **Data:** no migration. MUT-358 created the tables.
- **`saveAccount` behaviour changes:** it now fills an empty link and never unlinks. Today only the contract tests call it.
- **`subscriptionCovers` is narrowed (D9).** An org-tied subscription no longer covers an owned profile whose owner isn't the payer. No production subscriptions exist yet, so no live coverage changes.
- **Pilot grants:** `pre-billing` OPERATOR grants still win over STRIPE until the runbook's step 7. AC3's test uses a user with no grant.
- **Co-owners (TD-193):** coverage still follows `profileOwnerOf`, the creator. MUT-373 doesn't change this ticket.

## 5. i18n, cost and infra

- **i18n:** none. No UI.
- **Stripe calls (all free API reads):**
  - webhook: 1 per event (the subscription, with the customer expanded);
  - reconcile: ⌈subscriptions/100⌉ + 1 calls per night.
- **GCP cost:** one Cloud Scheduler job (inside the free tier of 3), and 3 secrets (cents a month).
- **Infra:** §2.7. Nothing changes until `stripe_enabled = true`.

## 6. Tests (TDD) and commands

The test plan file `.claude/designs/mut-360-stripe-webhook-tests.md` is written first, at `/eng-build`. The review's coverage diagram and value cards are in the Test review section below.

**Pure (`mirror.test.ts`):**
- tier from metadata (the same amount with different metadata gives different tiers);
- `UNKNOWN_TIER` and mixed tiers;
- item-level vs top-level period;
- lookup key;
- org id stored as-is;
- `FIRM_WITHOUT_ORG`;
- `UNSUPPORTED_CURRENCY`;
- `subscriptionIdOf` on both invoice shapes.

**Resolver (`entitlement.test.ts`):** the §2.2b rows.

**Adapter (`stripe-gateway.test.ts`):** §2.1.

**Sync (`sync.test.ts`, fake gateway + memory store):**
- **AC2:** an older event delivered after a newer one still ends in Stripe's current state; a stale `fetchedAt` doesn't overwrite.
- **AC3:** metadata `mutaba3a_user_id` plus a subscription event → linked account, and `/v1/me` reads `{ ACTIVE, STRIPE }` for a user with no grant.
- **AC4:** reconcile repairs a subscription changed with no event, including one whose **account doesn't exist yet**. A second run reports `changed: 0` and writes no audit.
- **Checkout:** for a new customer, the account is created with the subscription's currency (D6).
- **`customer.updated`** for an unknown customer: 200, nothing stored.
- **Unlinked:** the account is stored; `billing link` later makes it cover.
- **Conflicts:** `CUSTOMER_LINKED_ELSEWHERE` and `USER_HAS_ANOTHER_ACCOUNT` keep or skip the link, and the account is listed as unlinked.
- **No-ops:** invoice without a subscription, payment-mode checkout, deleted customer.
- **Webhook timeout:** a timeout gives 500 with `processedAt` null; redelivery is processed once.
- **Reconcile overlap:** a second concurrent run gives 409; per-subscription errors still give 200 with the list.
- **Audit:** `billing.subscription_changed` once per covered profile, only on change.

**Route (`stripe-billing.test.ts`):**
- **AC1:** bad, missing or expired signature → 400 and no row. The same signed event twice → one change and one audit.
- 503 when not configured; 413; 429; unhandled type → 200 with nothing stored; livemode mismatch ignored.
- `/jobs`:
  - token unset → 503;
  - wrong token → 401;
  - the admin token doesn't open `/jobs/*`;
  - the job token doesn't open `/admin/*`.
- A raw SDK error → its log line carries no key or body.

**Store contract (`store-contract-billing.ts`, memory and Prisma):**
- `saveAccount` fills and never unlinks;
- `saveSubscription` newer-wins, with audit built inside the transaction only on change;
- `stripeEvents` begin, finish and prune;
- the `STORE_ACCESS` entries.

**Config and log:** both-or-neither; prefixes; a live key refused in test; `stripe-signature` redacted.

**Terraform:** `tests/stripe.tftest.hcl`, `terraform fmt -check`, `validate`.

**Commands** (Node 22):

```bash
npm --prefix server run typecheck
npm --prefix server run lint
npm --prefix server test
npm --prefix server run test:db
npm --prefix server run openapi:check
npm run hosted:types && npm run typecheck   # from the repo root
```

**Release-QA:** there's no UI. AC3 gets one walkthrough in Stripe test mode: a `manual: true` catalog entry, because it needs Basel's Stripe account plus `stripe listen --forward-to localhost:8787/v1/billing/stripe/webhook`. The runbook carries the steps.

## 7. Decisions (Basel, 2026-10-21)

| # | Decision |
|---|---|
| D1 | All three HTTP entry points go in one `routes/stripe-billing.ts`. |
| D2 | A dedicated job token, which opens only the reconcile route. Not OIDC, and not the admin token. |
| D3 | Reconcile lists every subscription each night. A TD records the revisit point, around 10k. |
| D4 | `founderUntil` stays null; MUT-363 fills it. |
| D5 | The existing link wins; a metadata mismatch is recorded and logged. |
| D6 | Only `syncSubscription` creates billing accounts, using the subscription's currency. |
| D7 | Webhook gateway: 4 s timeout, 0 retries. Reconcile: 10 s timeout, 2 retries. |
| D8 | A firm subscription covers a firm only if its payer owns it. Owner-less operator firms are covered. |
| D9 | That rule (D8) is checked at read time in `subscriptionCovers`, not at sync. |
| R8 | Adapter tests run against recorded Stripe responses. |

---

# Eng review (/plan-eng-review, 2026-10-21)

Target: `.claude/designs/mut-360-stripe-webhook.md`. The original draft of §1–§7 is in commit history (the first MUT-360 plan commit); §1–§7 above are the revised plan with every approved answer folded in.

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

## Section 2: Code quality review

- [P3] (confidence 7/10) plan §2.4 / prisma.ts:1621-1628: `saveAccount` will return `{ account, conflict }` while `linkAccount` throws `StateConflict` (memory.ts:2142) for the same codes. Two conventions for one condition. Disposition: accepted as the necessary shape of D5, which says the account row must still be written (country, currency) when the link conflicts, and a throw would roll that back. The ADR names the difference.
- No other issues found. Module layout (`billing/stripe/{gateway,mirror,sync}.ts`, one routes file) follows the `fx-rates.ts` port/adapter shape and the `billing/` folder MUT-358 started. Diagram in §2 updated to the approved flow.

Dispositions: C-1 accepted (D5 implementation, no question).

## Section 3: Test review

Framework: Vitest (`server/vitest.config.ts`); store contracts run on memory + Prisma (`test:db`); Terraform `tftest`.

```
CODE PATHS (proposed)                                   USER / OPERATOR FLOWS
[+] routes/stripe-billing.ts                            [+] Pilot cutover (runbook §1.5)
  ├── webhook: bad/missing/expired sig  [★★★ PLANNED]     ├── [★★ PLANNED] reconcile once → /v1/me ACTIVE   [→E2E manual]
  ├── 413 / 429 / 503                   [★★★ PLANNED]     └── [★★ PLANNED] grant revoke after verify          [manual]
  ├── replay same event                 [★★★ PLANNED]   [+] Hand-made test-mode subscription (AC3)
  ├── /jobs unset/wrong/cross tokens    [★★★ PLANNED]     └── [★★ PLANNED] sync.test + manual Stripe walk     [→E2E manual]
  └── raw SDK error → clean log         [★★★ PLANNED]   [+] Operator link after sync
[+] billing/stripe/sync.ts                                └── [★★★ PLANNED] entitlement rows: covered w/o re-sync
  ├── handleEvent: unhandled/livemode/no-sub no-ops [★★★]
  ├── checkout new customer → account (D6)          [★★★]
  ├── customer.updated unknown → no-op              [★★★]
  ├── out-of-order / stale fetchedAt (AC2)          [★★★]
  ├── webhook timeout → 500, redelivery (D7)        [★★★]
  ├── reconcile repair + no-account case (AC4)      [★★★]
  └── reconcile overlap 409, errors still 200       [★★★]
[+] billing/stripe/mirror.ts (pure)                     [★★★ PLANNED] tier, period shapes, org, currency, invoice id shapes
[+] billing/stripe/gateway.ts (SDK adapter)             [★★★ PLANNED] recorded responses (R8)
[+] billing/entitlement.ts subscriptionCovers (D9)      [★★★ PLANNED] owner match/differ/owner-less/unlinked
[+] repositories saveAccount/saveSubscription/stripeEvents [★★★ PLANNED] contract on memory + Prisma
[+] terraform stripe flag + suffix                      [★★ PLANNED] tftest off/on

COVERAGE (planned): every new path has a planned ★★ or ★★★ test; 2 flows are manual-only (live Stripe test mode)
GAPS: 0 automated gaps after R8; manual: AC3 walkthrough, cutover
Legend: ★★★ behavior + edge + error | ★★ happy path | [→E2E] integration needed
```

Regression risk: `saveAccount` semantics and `subscriptionCovers` change existing behaviour. Their contracts are the approved D5 and D9 answers. The proof is the existing `store-contract-billing.ts` cases (updated: "relink overwrites" becomes "relink keeps") plus the new rule rows, which run alongside every existing `entitlement.test.ts` row unchanged.

Test Plan Artifact: `~/.gstack/projects/vAWK3-mutaba3a/basel-feature-mut-360-stripe-webhook-eng-review-test-plan-20261021-144954.md`.

Dispositions: T-1 (adapter untested) accepted as R8 (Basel, 2026-10-21).

## Section 4: Performance review

- [P2] (confidence 8/10) plan §2.3 reconcile: without `expand: ['data.customer']`, linking each listed subscription would cost one customer fetch per subscription (N+1 against Stripe). Disposition: correction under D3/D6, folded into §2.1 (`listSubscriptions` expands `data.customer`).
- [P3] (confidence 7/10) plan §2.4: computing `ownedProfilesOf` for every listed subscription costs 2 queries each even when nothing changed. Disposition: correction folded into §2.3 (profile ids are computed only for a linked account or a set org; audit rows are built only on change). At pilot scale (tens of subscriptions) this is noise; at ~10k it is the TD's revisit point.
- Reconcile does one short transaction per subscription (`FOR UPDATE` on a unique key). Scale: n rows per night, n unknown beyond the pilot (≈10 today) [estimated].

Dispositions: both accepted as corrections (no behaviour change).

## NOT in scope

- Checkout and Customer Portal sessions: MUT-362, which must reuse the existing `stripeCustomerId` (OV-7 note).
- Enforcement of lapsed states: MUT-361.
- Cancelling a subscription on account close: MUT-333 (needs a write-capable key then).
- `founderUntil` from subscription schedules: MUT-363 (D4).
- Per-seat or per-member billing: not the model (ADR-160: the person pays, profiles are entitled; Firm is per firm).
- OIDC for Scheduler: TD (D2 chose the job token).
- ~~An alert when a whole reconcile run fails: TODOS.md #17.~~ Done in the review (log-based alerts in `monitoring.tf`).

## What already exists

- Tables `billing_accounts`, `billing_subscriptions`, `stripe_events` (MUT-358 migration `20261020200000_mut358_billing_core`). Reused, no migration.
- `billing.saveAccount` / `saveSubscription` (prisma.ts:1621-1636): reused but their semantics are rebuilt (D5, newer-wins, audit).
- `resolveEntitlement` / `subscriptionCovers` (entitlement.ts): reused, with the coverage rule narrowed (D9).
- `listAccounts({ linked: false })` + `billing:unlinked`: reused as the operator's view of unlinked and conflicting customers.
- `publicFxRateRoutes`, `adminAuth`, `FrankfurterSource`, front-door-token Terraform: patterns copied, not shared code (no extraction proposed).

## Failure modes

| Path | Realistic failure | Covered by | User/operator sees |
|---|---|---|---|
| Webhook | Stripe API slow | D7 budget → 500, Stripe retries; test | Nothing; Stripe dashboard shows retries |
| Webhook | Wrong `whsec_` after rotation | 400 on every event; Stripe emails on endpoint failures; reconcile heals nightly | Stripe's failure email |
| Webhook | Product missing `metadata.tier` | `UNKNOWN_TIER` recorded + warn log; cutover checklist step 1 | A log line only (no Sentry on the server; review correction), `/v1/me` unchanged |
| Sync | Returning payer gets a second customer | account unlinked, listed by `billing:unlinked`; MUT-362 note | Operator list |
| Reconcile | Job token rotated or Stripe unset | 401/503, and 502 RECONCILE_FAILED when Stripe can't be listed | Alerted (review: Scheduler-failure log alert) |
| Coverage | Org metadata names a firm the payer doesn't own | read-time rule (D9); test | Firm stays uncovered; mismatch visible via `/v1/me` |

Critical gaps (no test, no handling, silent): 0.

## Worktree parallelization strategy

| Step | Modules touched | Depends on |
|---|---|---|
| S1 Repository contract (saveAccount, saveSubscription, stripeEvents) | server/src/repositories, auth/store-guard | — |
| S2 Coverage rule (D9) | server/src/billing/entitlement | — |
| S3 Gateway + recorded fixtures | server/src/billing/stripe (gateway) | — |
| S4 Terraform | server/infrastructure/terraform | — |
| S5 Mirror + sync | server/src/billing/stripe (mirror, sync) | S1, S3 |
| S6 Routes, config, logger, app wiring, OpenAPI | server/src/routes, config, logger, app, index, openapi | S5 |
| S7 Runbook, ADR/TD/CHANGELOG/INFRA/PATTERNS/registry | docs/, .claude/ | S6 |

Lane A: S1 → S5 → S6 → S7. Lane B: S2. Lane C: S3. Lane D: S4. Launch A+B+C+D; S5 waits for S1 and S3; merge order A last. Conflict flags: S5 and S3 share `billing/stripe/`, so S3 lands before S5 starts. One branch is simpler for a single builder; the lanes matter only if the build is split.

## Implementation Tasks
Synthesized from this review's findings. Each task derives from a specific finding above. Run with Claude Code or Codex; checkbox as you ship.

- [ ] **T1 (P1, human: ~4h / CC: ~25min)**: repositories: `saveAccount` fills-never-unlinks, `saveSubscription` newer-wins with in-transaction audit, `stripeEvents` begin/finish/prune
  - Surfaced by: R4/D5, OV-6, plan §2.4
  - Files: server/src/repositories/{ports,prisma,memory}.ts, server/src/auth/store-guard.ts, repositories/__tests__/store-contract-billing.ts
  - Verify: `npm --prefix server test` + `npm --prefix server run test:db`
- [ ] **T2 (P1, human: ~1h / CC: ~10min)**: entitlement: firm coverage only for an owner-less firm or the payer's own (read time)
  - Surfaced by: R9/D9 (OV-2)
  - Files: server/src/billing/entitlement.ts, billing/__tests__/entitlement.test.ts
  - Verify: `npm --prefix server test -- entitlement`
- [ ] **T3 (P1, human: ~3h / CC: ~20min)**: gateway: `StripeSdkGateway` (pinned apiVersion, two budgets, error wrapping) + recorded-response tests + fake gateway
  - Surfaced by: R8, R6/D7, OV-12, Section 4 P-1
  - Files: server/src/billing/stripe/gateway.ts, billing/stripe/__tests__/{fake.ts,stripe-gateway.test.ts,fixtures/}, server/package.json
  - Verify: `npm --prefix server test -- stripe-gateway`
- [ ] **T4 (P1, human: ~4h / CC: ~30min)**: mirror + sync: one `syncSubscription` for webhook and reconcile, account creation only there, no-ops, overlap guard
  - Surfaced by: OV-1, R5/D6, OV-5, OV-10, OV-11, FC-1/OV-9
  - Files: server/src/billing/stripe/{mirror,sync}.ts, billing/stripe/__tests__/{mirror,sync}.test.ts
  - Verify: `npm --prefix server test -- billing/stripe`
- [ ] **T5 (P1, human: ~3h / CC: ~20min)**: routes + config + logger: `routes/stripe-billing.ts`, `jobAuth` (503 when unset), live-key guard, `/jobs/` excluded from SPA, OpenAPI + version bump
  - Surfaced by: D1, R1/D2, OV-4, OV-8, FC-2, AC5
  - Files: server/src/routes/stripe-billing.ts, app.ts, index.ts, config.ts, logger.ts, __tests__/{stripe-billing,route-security,logger,config}.test.ts, openapi/openapi.yaml
  - Verify: `npm --prefix server run typecheck && npm --prefix server run lint && npm --prefix server test && npm --prefix server run openapi:check`
- [ ] **T6 (P1, human: ~2h / CC: ~15min)**: Terraform: Stripe secrets with suffix, job token, Scheduler with `attempt_deadline`, flag-gated mounts, tftest
  - Surfaced by: R1/D2, OV-8, OV-11, plan §2.7
  - Files: server/infrastructure/terraform/{main.tf,variables.tf,tests/stripe.tftest.hcl}, server/DEPLOYMENT.md, docs/operations/before-release.md
  - Verify: `terraform fmt -check && terraform validate && terraform test` (offline, mocked providers)
- [ ] **T7 (P1, human: ~2h / CC: ~15min)**: runbook cutover checklist + docs + Jira notes (MUT-362 customer reuse, MUT-363 founderUntil)
  - Surfaced by: OV-3, OV-5 (endpoint API version), OV-7, R3/D4
  - Files: docs/operations/pilot-runbook.md, docs/commercial/pilot-offer.md, .claude/{DECISIONS,TECH_DEBT,CHANGELOG,INFRA,PATTERNS,COMPONENT_REGISTRY,SYSTEM_OVERVIEW}.md, qa catalog entry (manual AC3)
  - Verify: `release-qa lint`; walk the checklist in Stripe test mode
- [x] **T8 (P3, human: ~1h / CC: ~10min)**: alert on a failed reconcile run (TODOS.md #17), done in the review
  - Surfaced by: Failure modes, reconcile row
  - Files: server/infrastructure/terraform/monitoring.tf
  - Verify: tftest

## Unresolved decisions

None. D1–D9 and R8 are answered; R7's mechanism is superseded by R9. Outside-voice disagreement: OV-11's suggestion of one SDK retry on the webhook path was not applied, because it conflicts with D7.

Approval readiness: PASS (R1 D2, R2 D3, R3 D4, R4 D5, R5 D6, R6 D7, R7 D8 superseded by R9 D9, R8 "take your recommendations and finish it", all Basel 2026-10-21; corrections FC-1/FC-2/OV-1/3/4/5/6/7/8/9/10/11/12 and Section 4 fall under those answers or the ticket's own scope).

## Completion summary

- Step 0: Scope Challenge: scope accepted as-is (structure B, a smaller arrangement)
- Reality rows: 7/7 tier-1 rows emitted (premise-table: every premise carries a file:line receipt, 0 unverified; already-done: only the MUT-332 spike mentions MUT-360; surface-check: Stripe list filters checked against the API reference; binding-decisions: none recorded for the branch; numbers: [estimated] call counts; deferred-asks: ticket's "updated since last run" replaced by D3; pr-count: one branch)
- Architecture Review: 5 issues found (3 decided: D6, D7, D8→D9; 2 corrections)
- Code Quality Review: 1 issue found
- Test Review: diagram produced, 1 gap identified (adapter, closed by R8)
- Performance Review: 2 issues found
- NOT in scope: written
- What already exists: written
- TODOS.md updates: 1 item proposed (#17, added on Basel's "take your recommendations")
- Failure modes: 0 critical gaps flagged
- Unresolved decisions: 0 in this review
- Outside voice: Codex not installed; native Claude Plan subagent completed (12 findings, 1 Critical, 2 High); OUTSIDE_STATUS unavailable for Codex
- Parallelization: 4 lanes, 4 parallel / 3 sequential
- Lake Score: 4/7 answers picked a 10/10 option

Suppressed findings (appendix): none below confidence 5.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Outside Review | native Claude Plan subagent (Codex not installed) | Independent 2nd opinion | 1 | unavailable (codex); in-host completed | 12 findings: 1 Critical, 2 High, 5 Medium, 4 Low; all dispositioned |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | issues_open | 9 issues, 0 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | — |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **OUTSIDE COVERAGE:** Codex plan review: unavailable (not installed). Native fallback: Claude Plan subagent, plan-review phase, completed within the 300 s timer; its findings are folded in (OV-1..OV-12).
- **VERDICT:** Eng review complete with every issue mapped to an approved decision or correction ("issues_open" = mapped work, not open questions). No UI, so no design review needed. Ready for `/eng-build MUT-360`.

NO UNRESOLVED DECISIONS
