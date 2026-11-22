# MUT-702 (+ MUT-708 part 1): Solo, Business and Firm on the server, and the Stripe catalog script

Tracker: Jira · barmajiyat.atlassian.net · MUT via atlassian-barmajiyat · Backlog → Planned after plan approval → In Progress at /eng-build → In Review after /qa-reconcile.

## ★ Split after MUT-700 and the eng review (2026-11-22): this section overrides the rest

Two things changed after the first draft below.
- **The seller is open** ([MUT-700](https://barmajiyat.atlassian.net/browse/MUT-700)). Narabnd Studio Ltd owns Mutaba3a. Who sells (Narabnd with an Israeli payment provider, or Barmajiyat on Stripe) and whether prices include VAT both wait for Narabnd's accountant. MUT-701 comment 13467 records the rule: no new Stripe or "Barmajiyat sells" assumptions, and plan logic stays apart from the provider.
- **An independent eng review** found 12 issues, almost all in the Stripe part.

So MUT-702 is built in two parts.

### Part A: build now (provider-neutral)
1. **`server/src/billing/plans.ts`**, pure:
   - `PlanName` (solo | business | firm) and legacy `freelancer`;
   - `TIER_OF`;
   - `RANK` (Solo = Freelancer < Business < Firm);
   - `changeTimingOf` (up now; same or lower rank at period end);
   - `nextPlanAbove`;
   - `PLAN_LIMITS`: businesses 1 / 3 / 6, partners 0 / 2 / 2, documents 50 / 250 / 1,000, scans 100 / 500 / 2,000.
   - These are the numbers MUT-704 enforces. They live here, so there's one source.
   - No lookup keys and no provider names.
2. **Prisma** `enum BillingTier` + SOLO, BUSINESS: one `ADD VALUE`-only migration, as the `20261108120000_mut565_accountant_tier` precedent does. Warn the orchestrator before merging.
3. **`entitlement.ts`**:
   - `RANK` replaces `tierRank`;
   - a trial resolves to BUSINESS. The review confirmed nothing reads the entitlement tier today, so this has no effect until MUT-704 uses it.
4. **Schemas:**
   - `BillingTierSchema` + a shared `ProfilePlanTierSchema`, replacing the inline enums at `schemas.ts:374, 409, 601, 1119`;
   - OpenAPI and portal types regenerated;
   - the API minor version bumped.
   - Flutter is safe: `BillingTier.tryParse` gives null for an unknown tier, and `ProfileBilling` never reads `tier`.
5. **Operator grants of Solo and Business:**
   - server: `admin-billing.ts:95,248`, `operator.ts:421`, `scripts/users.ts:84`;
   - console: `OperatorBillingSection.tsx:28`, `hosted.operator.billing.tier.*` in ar + en.
   - This lets plans be given and tested with no payment provider at all.
6. **`GET /v1/billing`** gains `currentPlan` ('solo'|'business'|'firm'|'freelancer'|null), read from the resolved entitlement (grant, subscription or trial). It's additive; nothing is removed.
7. **Recorded for MUT-704:** the `mut358_billing_core` migration gave every pre-billing user a no-expiry FREELANCER grant (`migration.sql:120`). Those people rank as Solo, so MUT-704 must decide whether legacy Freelancer keeps today's limits until MUT-707 moves it. Suggested default: legacy Freelancer keeps 6 businesses and 3 owners until it moves.

Part A tests:
- `plans.test.ts`: rank, timing for every pair, `nextPlanAbove`, the limits table.
- `entitlement.test.ts`: a trial is BUSINESS; grant and subscription ranking Firm > Business > Solo = Freelancer; ACCOUNTANT still excluded.
- Operator route tests: grant and revoke SOLO and BUSINESS.
- The billing route: `currentPlan` for a trial, each grant, a legacy subscription, and none.
- The `test:db` enum round trip.
- Release-QA: an "operator grants Business" flow in `qa/features/portal-selfservice/operator.yaml` and its spec.

Part A meets ACs 6, 7 (with the existing coverage rule), 8 and 9. It is the base for MUT-704, which is also provider-neutral and can follow straight away.

### Part B: held until MUT-700 decision 1 (who sells, through which provider)
Sections D–I below are Part B, written for Stripe. If the seller ends up on another provider, B is rewritten against that provider's adapter. The pure pieces (`changeTimingOf`, `planChangeOf`'s refusals, the per-plan catalog shape) carry over.

**Review findings folded into Part B:**

| # | Finding | Where it lands in B |
|---|---|---|
| 1 CRITICAL | Founders already run on Stripe subscription schedules (`plan-gateway.ts:100,188`; ADR-238) | Founders can't change plan in B (`FOUNDER_PLAN` refusal, matching ADR-238) until their schedule ends. `cancelRefusal` tells our schedule from a founder's by a local record. `tierOfLookupKey` covers `firm_founder_*` too. |
| 2 HIGH | `retention.ts:33-38,196-201` hard-codes the Freelancer keys: pause, stay and yearly switch would refuse every new plan | `listMonthlyCurrencyOf` returns `{plan, currency}` through `plans.ts`. `switchOf`, the stay offer and the monthly summary mail pass the subscription's own plan catalog. Tests per plan. |
| 3 HIGH | Offers read the Freelancer catalog (`comeback-read.ts:52`, `offer-read.ts:44`, `yearly-switch-line.ts:17`) | An offer applies only when the plan sold is in the coupon's products. B releases only together with MUT-703 (a hard gate). The come-back mail's windows are checked before release. |
| 4 HIGH | An upgrade has no `expectedAmountDue` | Same guard as the yearly switch: re-preview, then 409 `AMOUNT_CHANGED`. |
| 5 HIGH | A down-move schedule takes two calls with no compensation | Idempotency keys on both calls. Release the schedule if step 2 fails. Phases spelled out (phase 1 ends at `current_period_end`; phase 2 the new price; `end_behavior: release`; `proration_behavior: none`; discounts not carried). Our schedule known from a local record. Or ship upgrades first and down-moves as a follow-up. |
| 6 MED | No `CANCELLING` refusal; the launch-year proration is undefined | Add `CANCELLING`. A discounted first year moving up: preview shows the real proration; the coupon isn't carried over. |
| 7 MED | `pendingPlanChange` from an uncached `planOf` | Stored locally (a retention-event row like a pause), cleared on take-back and when the mirror sees the new tier. |
| 8 MED | Key scopes for schedules and products | An operator step in `before-release.md` (Write Subscription schedules; the script's own key: Write Products/Prices). |
| 9 MED | QA harness: >10 lookup keys in one call; Solo prices on a Freelancer-tagged product | The harness seeds the sandbox by running the plan script (`billing:plans --apply`), not its own price list. |
| 10 MED | The live portal still says "Freelancer" while Checkout sells Solo | B's Checkout switch ships with MUT-705's drawer. The audit row records the real plan. |
| 11 MED | `transfer_lookup_key` nulls the old Firm price's key in the mirror | The script prints displaced price ids. The mirror takes the interval from `price.recurring`. MUT-707 matches by price id as well as key. |
| 12 LOW | `'freelancer'` alias, the `interval?` contradiction | Accept `'freelancer'` as an alias of solo. Drop `interval` from the plan-change body (monthly↔yearly stays the switch's job). |

---

## 0. Neighbourhood
- **Epic MUT-701** (decided by Basel on 2026-11-22). Siblings:
  - MUT-703 offers;
  - MUT-704 limits and soft caps;
  - MUT-705 portal;
  - MUT-706 phone;
  - MUT-707 moving the ₪29 payers;
  - MUT-708 docs, QA and the script. Part 1 is folded in here.
- **No blockers.**
- **Overlaps:**
  - MUT-363 (Firm tier billing): its shape is superseded, and comment 13463 says so.
  - MUT-305/306 (staff) come after the core.
  - MUT-565 (Accountant plan) stays untouched.
  - MUT-566 (invoicing): no signups arrive until it ships.
- **Locked decisions** (epic and memory):
  - Prices: ₪39 / ₪89 / ₪249, with yearly at 10×.
  - USD defaults: $12 / $27 / $75, to be confirmed.
  - A trial gets Business limits.
  - Founders keep ₪21.
  - ₪29 payers move at renewal (MUT-707).
  - Firm covers all the owner's profiles.
  - Live Stripe writes are run by Basel.

## 1. Scope

**In:**
- the plan tiers in the data model and the mirror;
- a Stripe catalog for each plan;
- Checkout for a chosen plan;
- changing plan (up now, down at period end);
- `GET /v1/billing` exposing every plan;
- operator grants of the new tiers;
- mail copy naming the plan;
- the idempotent catalog script.

**Out (sibling tickets):**
- limits and meters (MUT-704);
- offers across plans and the new launch coupon (MUT-703);
- the portal plan picker (MUT-705), apart from the one-line operator-console tier list;
- phone (MUT-706);
- migrating payers (MUT-707).

## 2. Design

### A. One source of truth for plans: `server/src/billing/plans.ts` (new, pure)
```
PlanName = 'solo' | 'business' | 'firm'                      // sellable
LEGACY = 'freelancer'                                        // ₪29 + ₪21 founders, not sold
TIER_OF: solo→SOLO, business→BUSINESS, firm→FIRM, freelancer→FREELANCER
RANK: SOLO 1 = FREELANCER 1 < BUSINESS 2 < FIRM 3           // ACCOUNTANT is not a profile plan
listLookupKey(plan, interval, currency) = `${plan}_list_${monthly|yearly}_${ils|usd}`
tierOfLookupKey(key) → 'solo'|'business'|'firm'|'freelancer'|'accountant'|null   // freelancer_founder_* → freelancer
changeTimingOf(currentTier, targetPlan) → 'now' (higher rank) | 'period_end' (same or lower) | 'same'
```
- `entitlement.ts` uses `RANK` in place of its local `tierRank`. Today `tierRank` ranks FIRM 1 and everything else 0.
- `checkout.ts`, `mirror.ts`, `checkout-gateway.ts` and the script import from here. No other file spells a plan or a lookup key.

### B. Data model
- **Prisma.** `enum BillingTier` gains `SOLO` and `BUSINESS`. The migration is `20261123xxxxxx_mut702_plan_tiers`, `ALTER TYPE ... ADD VALUE` only, so no data changes.
- **Repository types.** `BillingTierRecord` (`repositories/ports.ts:2319`) and the memory and Prisma repositories follow the enum.
- **Schemas.** `BillingTierSchema` gains the new tiers. The inline `z.enum(['FREELANCER','FIRM'])` at `schemas.ts:374, 601, 1119` becomes one shared `ProfilePlanTierSchema`.
- **Before merging:** warn the orchestrator, because a migration restarts the shared dev API (memory: warn before merging a migration).

### C. Entitlement and mirror
- **Trial.** `entitlement.ts:147,160-161`: the trial resolves to `tier: 'BUSINESS'`.
- **Tier ranking.** `bestGrant` and `bestSubscription` rank by `RANK`.
- **Coverage stays as it is.** `subscriptionCovers` already covers every profile the payer owns. The plan-count read-only rule is MUT-704's.
- **Mirror** (`stripe/mirror.ts:40`): `TIERS` gains `solo` and `business`.
  - Drop the `FIRM_WITHOUT_ORG` note: Firm is no longer one organization.
  - Keep honouring `mutaba3a_organization_id` for operator-made firm subscriptions.
- **Product tier check.** `scripts/stripe-product-tiers.ts:17` `KNOWN_TIERS` gains `solo` and `business`.

### D. Catalog
- **`PlanCatalogs`.** `checkout.ts` replaces `GA_PRICE_LOOKUP_KEYS` / `Catalog` with `PlanCatalogs = Record<PlanName | 'freelancer', Catalog>`. Freelancer is read but never sold; MUT-703's yearly switch and MUT-707 need it.
  - `catalogFrom(prices, plan)` checks each price's product tier through `tierOfLookupKey`.
  - `sellableFactOf(price, expectedTier)` accepts every tier.
- **Price lookups** (`checkout-gateway.ts:134-160`). Stripe takes at most 10 `lookup_keys` per list call, and there are now 16 keys plus 2 for the Accountant plan.
  - `pricesByLookupKey` makes one call per plan (4 keys each), cached as today (`CATALOG_TTL_MS`).
  - That is 4 calls per 10 minutes per instance.
- **`ALL_GA_LOOKUP_KEYS`** becomes `ALL_LIST_LOOKUP_KEYS`: every plan's keys plus the legacy freelancer ones. It is used by `renewsAtListPrice` and `renewal-mail.ts:126`.

### E. Checkout
- **Request.** `CheckoutSessionRequest.plan`: `'solo' | 'business' | 'firm' | 'accountant'`. **Absent means `solo`**, so a portal still on the old drawer buys Solo, the new entry plan.
- **Building it.** `planCheckout(input, person, countries, catalogs[plan])`.
  - Session metadata `mutaba3a_plan = <plan>`.
  - `expireOpenCheckouts(customer, 'profile')` expires any open profile-plan Checkout, whatever its plan, so two tabs can't buy two plans.
  - `CheckoutPlanName` gets a `'profile'` family beside `'accountant'`.
- **Refusals.** `checkoutRefusalOf` is unchanged: one profile-plan subscription per person, so `ALREADY_SUBSCRIBED` still applies. A subscriber changes plan through F, never a second Checkout.
- **Trial carry-over** and **offers** are unchanged here. The offer still reads the Solo catalog until MUT-703; see risks.

### F. Changing plan (new)
**Routes** in `routes/billing-plan.ts`, next to the yearly switch:
- `POST /v1/billing/plan/preview { plan, interval? }` returns:
  - `{ timing: 'now'|'period_end', amountDueNow, currency, newPrice, renewsOn, lostDiscount }`.
- `POST /v1/billing/plan { plan, interval?, prorationDate }` returns:
  - `{ outcome: 'changed'|'scheduled'|'payment-failed'|'payment-needs-action', ... }`.
- `DELETE /v1/billing/plan/scheduled` takes back a change scheduled for the period end.
- An absent `interval` keeps the current one. Moving between monthly and yearly stays the yearly switch's job.

**Pure decision:** `planChangeOf(subscription, livePlan, target, catalogs, now)`. It refuses with:
- `NOT_SUBSCRIBED`;
- `NO_CHANGE` (same plan and interval);
- `PAUSED` / `PAST_DUE` / `UNPAID` (CONTACT_US-style, as MUT-532 does);
- `SCHEDULE_NOT_OURS` (a Stripe schedule we didn't make);
- `PRICES_NOT_SET`.

Otherwise it decides the timing:

| Move | When | How |
|---|---|---|
| Up (higher rank) | now | `PlanGateway.changePriceNow`: the price swap with `always_invoice` + `pending_if_incomplete` + a proration date + an idempotency key |
| Same rank or down (Firm → Business, Freelancer → Solo) | at period end | a subscription schedule: phase 1 = the current price until `current_period_end`, phase 2 = the new price; `metadata.mutaba3a_plan_change = <plan>` |

- **Reuse.** `switchToYearly` becomes a thin caller of `changePriceNow` (DRY; its tests stay green).
- **Gateway** (`stripe/plan-gateway.ts`): `previewPlanChange`, `changePriceNow`, `schedulePlanChange`, `cancelScheduledPlanChange` (release the schedule), and `planOf` exposing the schedule's next phase.
- **The mirror** picks up the new tier from the product on `customer.subscription.updated`, as now. `GET /v1/billing` shows a `pendingPlanChange` read from `planOf`, cached like the yearly-switch line.
- **Audit:** `billing.plan_changed` / `billing.plan_change_scheduled` / `billing.plan_change_cancelled` on each owned profile, the same pattern as `billing.checkout_started`.
- **Coupons.** A product-scoped coupon that doesn't cover the new product stops applying. The old Freelancer launch coupon is the case here. The preview's `lostDiscount: true` tells the person before they confirm.
- **Founders** (`freelancer_founder_*`) may move up. The preview shows that the founder price ends.

### G. `GET /v1/billing` (additive; nothing removed)
- `plans: [{ plan, catalog: { ILS, USD }, current }]` for solo, business and firm.
- `currentPlan: 'solo'|'business'|'firm'|'freelancer'|null`.
- `pendingPlanChange: { plan, interval, on } | null`.
- `catalog` stays, filled with Solo, so the live portal and phone keep working until MUT-705/706.
- `subscriptionView` (`routes/billing.ts:461-476`): the interval comes from `tierOfLookupKey` and the key's `monthly|yearly` part. `renewsAtListPrice` checks `ALL_LIST_LOOKUP_KEYS`.
- `yearlySwitch` uses the subscription's own plan catalog: the legacy freelancer catalog for ₪29 payers, or the plan's own otherwise. This is one argument, so it stays inside 702 rather than leaving a wrong saving on screen until MUT-703.

### H. Operator and copy
- **Operator.** `routes/admin-billing.ts:95,248`, `routes/operator.ts:421` and `scripts/users.ts:84` accept SOLO and BUSINESS.
- **Operator console.** `src/hosted/pages/operator/OperatorBillingSection.tsx:28` gains the two tiers, plus `hosted.operator.billing.tier.*` keys in ar and en.
- **Mail copy.** `email/templates/copy.ts:507,525` takes the plan name from the subscription's tier.
- **Plan names.** Arabic proposal سولو / أعمال / مكتب, to confirm. English: Solo / Business / Firm; Freelancer stays for legacy.
- **Versioning.** Regenerate OpenAPI and portal types. Bump the API minor version: `1.1xx.0-mut702`.

### I. The catalog script (MUT-708 part 1): `server/src/scripts/stripe-plans.ts` (`npm --prefix server run billing:plans`)
It follows `stripe-product-tiers.ts`:
- `STRIPE_SECRET_KEY=<rk_test_…|rk_live_…>`;
- **dry run by default**, `--apply` to write;
- exit codes 0 / 1 / 2.

The spec is inside the script, the one place amounts are written:

| Product | Tier | ILS month / year | USD month / year |
|---|---|---|---|
| `mtb3a_solo` | solo | 3900 / 39000 | 1200 / 12000 |
| `mtb3a_business` | business | 8900 / 89000 | 2700 / 27000 |
| `mtb3a_firm` (exists live) | firm | 24900 / 249000 | 7500 / 75000 |

- Every price is `tax_behavior: exclusive`, with the lookup key `{plan}_list_{monthly|yearly}_{ils|usd}`.
- **Pure core:** `planActions(stripeState, spec)` returns a list of `create-product | tag-product | create-price | transfer-key`.
  - A key already on the right amount, currency, interval and product does nothing.
  - A key on another amount gets a new price with `transfer_lookup_key: true`. That is how today's ₪149 `firm_list_*` keys move to ₪249. The old price stays active for any subscription on it, and is never archived.
  - It never touches `freelancer_*` or `accountant_*` keys.
- **Coupons.** The script has a coupons section for MUT-703 to fill. This ticket ships it empty.
- **Running it:**
  - The sandbox run is Claude's: a test key, `--apply`.
  - The live run is Basel's, documented in `docs/operations/before-release.md`.
- **QA harness.** `qa/support/billing-live.mjs` gains the Solo prices, so the existing live billing specs keep passing now that Checkout defaults to Solo. Retargeting all the fixtures is MUT-708 part 2.

## 3. Tests (written first)
Server, Vitest, against the memory store and fake gateways:

1. **`plans.test.ts`:**
   - lookup key round trip;
   - `tierOfLookupKey` for every family (founder → freelancer, unknown → null);
   - `RANK`;
   - `changeTimingOf` for each pair (Solo→Business now, Firm→Business period end, Freelancer→Solo period end, same → same).
2. **`entitlement.test.ts`:**
   - a trial resolves to BUSINESS;
   - `bestSubscription` / `bestGrant` prefer Firm > Business > Solo = Freelancer;
   - a legacy FREELANCER subscription still covers its owner's profiles.
3. **`checkout.test.ts`:**
   - `catalogFrom` per plan;
   - a key on the wrong product leaves that plan unsellable;
   - `planCheckout` for each plan;
   - an absent plan means Solo;
   - the session metadata names the plan.
4. **`mirror.test.ts`:**
   - solo and business products mirror to SOLO and BUSINESS;
   - a firm subscription with no organization has no note;
   - an untagged product is still `UNKNOWN_TIER`.
5. **`checkout-gateway.test.ts`:** price lookups are split into ≤10-key calls and cached; a failure is cached for the failure TTL.
6. **`plan-change.test.ts`** (pure): every refusal; the timing; `lostDiscount` when a coupon's products don't cover the target.
7. **`routes/billing-plan` tests:**
   - preview and change, up and down;
   - scheduling, then cancelling;
   - audit rows on each owned profile;
   - idempotent double press;
   - refusal codes;
   - the founder upgrade.
8. **`routes/billing` tests:**
   - `plans`, `currentPlan` and `pendingPlanChange`;
   - `catalog` still Solo;
   - `subscriptionView` interval on every key family;
   - `renewsAtListPrice` true for solo/business/firm/freelancer list keys, false for a founder key.
9. **`checkout-session` route:** `plan` business and firm reach Checkout with the right price; an absent plan → Solo; `ALREADY_SUBSCRIBED` unchanged.
10. **`admin-billing` / operator:** granting SOLO and BUSINESS works.
11. **`stripe-plans.test.ts`** (`planActions`):
    - an empty account gives the full list;
    - a complete account gives nothing (idempotent);
    - a Firm key on ₪149 gives a transfer;
    - a wrong product tag gives a tag action;
    - freelancer and accountant keys are never touched.
12. **`prisma` contract (`test:db`, CI):** the enum accepts SOLO and BUSINESS round trip.

Commands, through the heavy queue, one at a time:
- `heavy --light -l "MUT-702 server tsc" -- npm --prefix server run typecheck`
- `npm --prefix server run lint`
- `npm --prefix server run openapi:check`
- `heavy -l "MUT-702 server tests" -- npm --prefix server test -- --maxWorkers=3`
- `npm run typecheck`, `npm run lint`, plus the affected portal tests for the operator file and the regenerated types.

**Release-QA.**
- MUT-702 has no new user-facing surface except the operator tier list. Add `qa/features/portal-selfservice/operator.yaml`: "grant Business", with its spec.
- The plan picker flows arrive with MUT-705.
- The existing billing specs must still pass with the Solo default, against sandbox prices from section I.

## 4. Quality bar
- **DRY:**
  - `plans.ts` is the one place for plan names, keys and rank.
  - The price swap is one gateway call used by both the yearly switch and the plan change.
  - The script reuses the product-tier reading.
- **Testable:** every decision is pure (`plans.ts`, `planChangeOf`, `catalogFrom`, `planActions`). Stripe sits behind the existing gateway ports with fakes.
- **Scalable and cheap:**
  - 4 cached `prices.list` calls per 10 minutes.
  - A plan change is 1–3 Stripe calls, only when a person asks.
  - No schema change beyond two enum values. No new tables.
- **Constraints:**
  - money keeps its currency (minor units from Stripe, never hard-coded in the API);
  - ar and en for every new string;
  - the portal may not import server code (`plans.ts` stays under `server/`, and the portal reads plan names from the API);
  - live Stripe writes are Basel's;
  - telemetry is unchanged.

## 5. Risks and how they're handled
1. **The launch offer disappears between 702 and 703.**
   - The live coupon is Freelancer-only.
   - Once the catalog is Solo, `offerFromCoupon` (applies_to ⊆ catalog products) returns null.
   - **Release MUT-702 and MUT-703 together.** No signups arrive before invoicing anyway.
2. **The enum migration.** `ADD VALUE` can't be used in the same transaction. The migration only adds the values; the code uses them after deploy. Warn the orchestrator before merging.
3. **Firm lookup-key transfer.** Any live subscription on a ₪149 Firm price keeps its price; only the key moves. MUT-707 lists those subscriptions for Basel.
4. **Subscription schedules** lock a subscription against some edits, such as pause and the yearly switch. While a down-move is scheduled:
   - pause and the yearly switch answer `SCHEDULED_CHANGE` with "Take back the change first";
   - cancel releases the schedule and then cancels.
5. **The old portal** still sends no `plan`, and buys Solo at ₪39. Correct under "switch now".
6. **Founders moving up** lose ₪21. The preview says so; a founder who doesn't move is never affected.

## 6. Open items for Basel (none block building; defaults in brackets)
- USD prices [$12 / $27 / $75].
- Arabic plan names [سولو / أعمال / مكتب].
- A founder moving up loses the founder price [yes, shown in the preview].

## 7. Acceptance criteria → proof
| AC | Proof |
|---|---|
| 1 Checkout per plan, interval and currency, mirrored with the right tier | tests 3, 4, 9; sandbox Checkout once per plan through the live spec harness |
| 2 `GET /v1/billing` lists the three plans and marks the current one | test 8 |
| 3 Move up now, prorated, new limits at once | tests 6, 7 (limits read the tier; enforcement is MUT-704) |
| 4 Move down at period end | tests 6, 7 |
| 5 Founder and ₪29 subscriptions unchanged | tests 2, 4, 8 |
| 6 Trial = Business | test 2 |
| 7 Firm covers all owned profiles | test 2 (a Firm with no org still covers the owner's profiles) |
| 8 Operator grants Solo / Business / Firm | test 10 + the operator QA flow |
| 9 OpenAPI and types regenerated; checks pass | the command list above |

## Business / product impact
- MTB3A sells three plans sized to the business instead of one ₪29 plan. The average revenue per payer moves from ₪29 to about ₪54 on the expected mix, with no add-ons.
- This is the base of epic MUT-701. It unblocks MUT-703 (offers), MUT-704 (limits), MUT-705 (portal), MUT-706 (phone) and MUT-707 (moving payers), all needed before invoicing (MUT-566) opens signups.
- The risk is contained: the change is additive in the API, the ₪29 and founder subscriptions keep working, and live Stripe changes go through a dry-run script Basel runs.
