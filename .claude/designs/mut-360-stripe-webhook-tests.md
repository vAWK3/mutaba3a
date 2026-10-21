# MUT-360 test plan: Stripe webhook + nightly reconcile

> **Plan:** `.claude/designs/mut-360-stripe-webhook.md` (§6, plus the eng-review Test review).
> **Status:** built test-first, unit by unit, on `feature/mut-360-stripe-webhook`. Every row below is a test that exists and passes.
> **Commands** (Node 22): `npm --prefix server test` (2740 passed); `MUTABA3A_TEST_DATABASE_URL=… npm --prefix server test` on a freshly migrated database (3028 passed, none skipped); `npm --prefix server run typecheck`, `lint`, `openapi:check`; root `npm run typecheck`; `terraform test` (34 passed).

## Acceptance criteria → tests

| AC | Proof | File |
|---|---|---|
| AC1: a signature failure is 400 and changes nothing; a replay changes nothing | missing / foreign / tampered / expired signature → 400 `INVALID_SIGNATURE`, no Stripe call, no account, and the same event properly signed is still new; the same signed event twice → `processed` then `duplicate`, one audit row | `server/src/__tests__/stripe-billing.test.ts` |
| AC2: out of order ends in Stripe's current state | `updated` then an older `created` both re-fetch the current state; a listed read stamped earlier than the stored one is `stale` and writes nothing | `server/src/billing/stripe/__tests__/sync.test.ts`; store contract `saveSubscription … keeps the newer read` |
| AC3: a hand-made subscription with `mutaba3a_user_id` shows on `/v1/me` | full app: customer metadata + `customer.subscription.created` → `GET /v1/me` reads `ACTIVE / STRIPE / FREELANCER` for a user with no grant | `stripe-billing.test.ts`; `sync.test.ts` (entitlementsFor) |
| AC4: reconcile repairs a dropped webhook | reconcile mirrors subscriptions with **no account yet** (creates it), repairs a status change with no event, reports `changed: 0` and writes no audit on a rerun | `sync.test.ts`; route + CLI `billing-reconcile` |
| AC5: secrets never logged | a real `StripeSdkGateway` failing through the route logs neither the key nor Stripe's body; `stripe-signature` and `x-job-token` redacted at every depth | `stripe-billing.test.ts`; `server/src/__tests__/logger.test.ts`; `stripe-gateway.test.ts` (error carries no key) |
| AC5: Terraform reviewed | flag off: no Stripe env, no job; flag on: one job on `/jobs/v1/billing/stripe-reconcile` with the job token; suffix on every secret id | `server/infrastructure/terraform/tests/stripe.tftest.hcl` |

## Decisions → tests

| Decision | Proof |
|---|---|
| D2 job token | wrong/missing token 401; admin token doesn't open `/jobs`; job token doesn't open `/admin`; unset token → 503 `JOBS_NOT_CONFIGURED`, never an empty compare |
| D3 list everything | gateway: `status=all`, `limit=100`, `expand[]=data.customer`, two-page walk; products listed separately, archived included |
| D5 never unlink | contract: null keeps the link, a different person → `CUSTOMER_LINKED_ELSEWHERE`, second customer → `USER_HAS_ANOTHER_ACCOUNT`, unknown or non-UUID → `UNKNOWN_USER`; sync: metadata naming someone else is recorded, the operator's link stays |
| D6 one creator | checkout for a new customer creates the account in the subscription's currency; `customer.updated` for an unknown customer stores nothing |
| D7 budgets | webhook gateway makes 1 request on a retryable 503, reconcile makes 3; a timeout answers 500, leaves the event unprocessed, and the redelivery is handled once |
| D8/D9 firm rule at read time | entitlement rows: stranger's tie doesn't cover an owned profile; unlinked tie covers an operator firm only; the same tie covers once the payer is linked (no re-sync); a lapsed stranger's tie isn't "ever paid" |
| R8 adapter | expand paths, API version header (and `STRIPE_API_VERSION === Stripe.API_VERSION`), signature verify/refuse/expire, live vs test key, error reduction; two mutations (wrong expand, retries on webhook) each caught |

## Edge cases

- `invoice.paid` without a subscription, payment-mode checkout, a deleted customer → 200 `noop`.
- unhandled event type, a livemode mismatch → 200 `ignored`, nothing stored.
- `UNKNOWN_TIER` → 200, recorded, and handled again on redelivery after the product is fixed.
- organization id that names no profile → mirrored with `organizationId: null`, noted `UNKNOWN_ORG`; malformed → `UNKNOWN_ORG`; a firm with none → `FIRM_WITHOUT_ORG`.
- invoice in either API-version shape; period from the items (latest) or the pre-basil top-level field; ILS/USD only.
- reconcile: a second concurrent run → `ReconcileRunning` (409 on the routes); a listing failure → 200 summary with `LIST_FAILED`; events older than 90 days pruned.
- 413 past 256 KB; 429 past the per-address budget with `Retry-After`; 503 when Stripe isn't configured.
- config: both Stripe values or neither; key prefixes; a live key only with `API_KEY_ENVIRONMENT=live`; job token ≥ 32 characters.

## Not automated

- The test-mode walkthrough against Basel's Stripe account (pilot runbook §1.7): it needs his keys and `stripe listen --forward-to localhost:8787/v1/billing/stripe/webhook`. The fixtures in `server/src/billing/stripe/__tests__/fixtures/` are written by hand to the pinned version's types, not captured from an account.
- release-qa has no server app (`qa/qa.config.mjs` watches `src/**` for web and portal only), and nothing in the portal shows billing until MUT-362, so there is no catalog feature for this ticket.
