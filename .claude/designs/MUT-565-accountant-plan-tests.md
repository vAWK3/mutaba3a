# MUT-565 — Accountant plan, server: test plan

TDD, server only (portal and phone are later rounds). `npm --prefix server test`; the Prisma store contract and the
migration under `test:db`; the events contract from the root (`npx vitest run scripts/__tests__/analytics-taxonomy.test.ts`).
Plan state is seeded with operator grants and the Stripe mirror (the repo's fakes); no Stripe account is called.

| # | Test | Where |
|---|---|---|
| 1 | `resolveAccountantPlan`: grant live / expired / revoked / longest; sub active, trialing, past_due → GRACE, unpaid/canceled/paused, a running pause, period + 7 over → LAPSED; incomplete never paid → NONE; grant beats sub; another person's facts and organization grants never | `billing/__tests__/accountant-plan.test.ts` |
| 2 | Profile filter: an ACCOUNTANT sub or grant never changes the personal profile's entitlement, never flips everPaid (a lapsed one still LOCKs a trial past day 30), Freelancer beside it still covers; `profileFacts`/`profilePlanSubscriptions`. Routes: `/v1/me` billing unchanged, `/v1/billing.subscription` null; a Freelancer payer may buy the Accountant plan and the reverse; come-back mail skips an ended Accountant plan | `accountant-plan.test.ts`; `__tests__/routes-accountant-plan.test.ts` "2"; `billing/__tests__/comeback-mail.test.ts` |
| 3 | Cap rule: off → null; free 3 / ceiling 100; readable by acceptedAt then id; a revoke promotes; `clientBooksSummaryOf` | `accountant-plan.test.ts` |
| 4 | Accept: 3 ACTIVE no plan → 402 {freeLimit, active, inviteExpiresAt}, invite still PENDING, accepts after a grant; ACTIVE/GRACE accepted, LAPSED 402; pending invites never count; a leave frees a place; signup never capped; ceiling → 409 CLIENT_BOOKS_CEILING; flag off → no cap, no billing read. Store: `cap_reached` writes nothing; two parallel accepts at 2 of 3 → one each (real row lock on Postgres) | routes "4"; `repositories/__tests__/store-contract-accountant-grants.ts` (memory + Prisma) |
| 5 | Door: lapsed → the 3 oldest 200, the 4th 402 {profileId, freeLimit} on `/v1/expenses`, `/v1/profile-entries` and every allowlisted GET (derived from the contract); writes still 403; a revoke promotes the 4th; plan restored → 200; rank < 3 does no billing read (spy) | routes "5" |
| 6 | Rows and `/v1/me`: `needsPlan` on the 4th only; `/v1/clients` stats null on it; `clientBooks` shape (cap 100 with the plan, 3 without, null off); `/v1/me` makes one billing read | routes "6"; `accountants/__tests__/client-rows.test.ts` |
| 7 | Checkout `plan: accountant`: accountant lookup key per currency, no trial, no discount, return paths `/accountant-invite` and `/client-books/<uuid>` (others 422), audit `plan`; year → 422; unpriced → 503 PRICES_NOT_SET; no-expiry grant → COVERED_BY_GRANT; access off → 404; GET `/v1/billing.accountantPlan` with its catalog; `sellableFactOf` per tier; Stripe's own list tags `accountant_*` | routes "7"; `billing/stripe/__tests__/checkout-gateway.test.ts` |
| 8 | Mirror: `tier: accountant` → ACCOUNTANT, organization forced null (`ACCOUNTANT_ORG_IGNORED`); mixed tiers → UNKNOWN_TIER | `billing/stripe/__tests__/mirror.test.ts` |
| 9 | Operator: ACCOUNTANT grant on a person 201, on an organization 422 ACCOUNTANT_PERSON_ONLY; DB CHECK refuses a raw insert | routes "9"; `repositories/__tests__/migration-mut565.test.ts` (`test:db`) |
| 10 | Card-failed mails name no Freelancer plan; closure ends both subscriptions on one customer | `billing/__tests__/card-failed-mail.test.ts`; `__tests__/routes-account-closure.test.ts` |
| 11 | Events 2.8.0: rules, emitters, `accountant_plan_offer_shown {place}`, `billing_checkout_started.plan`, pinned sha | `scripts/__tests__/analytics-taxonomy.test.ts` |
| 12 | Portal and phone: their own rounds (P, M in the brief) | — |

Also updated: API 1.105.0-mut565 literals; MUT-575's row assertions gain `needsPlan: false`; `billing-routes.test.ts`
(`accountantPlan: null`, audit `plan: freelancer`).
