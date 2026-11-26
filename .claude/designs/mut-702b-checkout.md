# MUT-702 Part B: buy Solo, Business or Firm (provider-neutral port, Stripe the one adapter)

Status: **approved and built** (2026-11-26: wireframes v3 approved; Q1, Q5, Q6 yes; the country is a typed field). ADR-288.
Built on `feat/mut-702b-checkout`; see "Build notes" at the end for what changed against this brief.
Tracker: Jira MUT-702 (In Progress). Epic MUT-701. Unlocks MUT-731's Solo trial and live prices.
Builds on: Part A (ADR-275, `server/src/billing/plans.ts`), MUT-731 (ADR-284/285), MUT-735 (ADR-281), MUT-736 (ADR-282).
Earlier full Part B draft (Stripe-only, 2026-11-22): `~/.gstack/projects/vAWK3-mutaba3a/mut-702-plan.md` §D–I. This brief
keeps its catalog and script design and its 12 review findings, with these changes:

1. **One seller, one provider (Basel, 2026-11-26):** Barmajiyat Ltd bills every subscription on Stripe, Israel included.
   Checkout goes through a provider-neutral port with one adapter, Stripe. The subscription mirror records provider and
   seller (always `stripe` / `barmajiyat` for now), so a later second provider or seller needs no rework.
2. **Tax (Basel):** Israeli residents pay the list price plus 18% VAT; outside Israel prices are shown before tax and
   Stripe Tax adds whatever is owed. Prices stay `tax_behavior: exclusive`.
3. **No country chooser (Basel):** the country is the billing address's country, asked only when paying (Subscribe and
   Try Solo), never at sign-up and never on Starter. It sets the currency (IL → ILS, else USD) and the tax.
4. **Moving between plans (ACs 3–4) is MUT-734.** Part B leaves seams only: `changeTimingOf` (Part A), the per-plan
   catalogs, the `planOf` read.
5. **The Solo trial** (MUT-731 Q1): 14 days, card up front, drops to Starter. Part B makes it buyable.
6. **The Subscribe step gets a plan row** (a slice of MUT-705; Q1), because the drawer can't say "Freelancer" while
   Checkout sells Solo (review finding 10). The full picker, cap prompts and usage stay in MUT-705.

---

## 1. Problem and acceptance criteria

Today only `freelancer_list_*` and `accountant_list_*` prices exist. Checkout, the mirror, the webhook and the offers
speak Stripe directly. Starter (MUT-731) cannot ship until Solo, Business and Firm can be bought.

**ACs (Part B):**
1. Checkout starts for Solo, Business or Firm, monthly or yearly; the subscription mirrors with the right tier
   (SOLO / BUSINESS / FIRM). (MUT-702 AC1)
2. `GET /v1/billing` lists the three plans with their live prices and marks the current one. (AC2)
3. Founder (`freelancer_founder_*`) and ₪29 (`freelancer_list_*`) subscriptions keep working, unchanged, as legacy
   Freelancer. (AC5)
4. Every Checkout goes through the `BillingProvider` port; its one adapter is Stripe. New subscription rows record
   `provider = 'stripe'`, `seller = 'barmajiyat'`.
5. The billing address is asked only on the pay path. Its country sets the currency (IL → ILS, else USD) and Stripe Tax
   computes the tax from it: 18% VAT on top for an Israeli address; before tax elsewhere with whatever is owed added.
   Sign-up, onboarding and Starter never ask for a country or an address.
6. The Solo trial: a new account's onboarding "Try Solo" asks the billing address, then opens Checkout for Solo
   monthly with 14 trial days and a card required. A cancel or failed card during the trial lands on Starter
   (ADR-284 already resolves that).
7. Prices on the Subscribe step and the trial step come from the live catalog. No amount is written in the portal or
   the API; the only place amounts are written is the catalog script's spec.
8. The sandbox has the three products and 12 list prices, made by `npm --prefix server run billing:plans -- --apply`
   with a test key, and Stripe Tax is on in the sandbox. The live run is Basel's (written instructions).
9. Everything ships dark: `PLAN_CHECKOUT` (server) off, `SOLO_TRIAL_CHECKOUT` (portal) off.
10. Server typecheck, lint, `openapi:check` and tests pass; OpenAPI and portal types regenerated; release-QA features
    and passing specs for the new flows.

**Out:** up/down moves (MUT-734); offers across plans (MUT-703, which ships together with B, review finding 3); limits
(MUT-704/733); the full portal picker and usage (MUT-705); phone (MUT-706, nothing in B); moving ₪29 payers (MUT-707);
any second provider or seller.

## 2. What exists, and what B extends (no duplication)

| Piece | File | B does |
|---|---|---|
| Plan names, rank, timing, limits | `billing/plans.ts` | adds `listLookupKey`, `tierOfLookupKey`, `ALL_LIST_LOOKUP_KEYS`; no provider names |
| Checkout decision (pure) | `billing/checkout.ts` `planCheckout`, `checkoutRefusalOf`, `catalogFrom`, `currencyOf` | `catalogFrom(prices, plan)`; `PlanCatalogs`; `CheckoutInput.plan`, `.trial`, `.address`; new refusals |
| Stripe gateways | `billing/stripe/checkout-gateway.ts`, `plan-gateway.ts`, `account-gateway.ts`, `gateway.ts`, `sync.ts`, `mirror.ts` | wrapped by the Stripe adapter; `pricesByLookupKey` split into ≤10-key calls; `setCustomerAddress`; mirror `TIERS` + solo/business |
| Checkout route | `routes/billing.ts` `POST /v1/billing/checkout-session` | goes through the port; body `country` → `address`; gains `plan`, `trial` |
| Webhook | `routes/stripe-billing.ts` `POST /v1/billing/stripe/webhook` | unchanged path; the adapter owns it |
| Buyer rules | `billing-countries.json`, `isConsumerCountry`, `COUNTRY_NEEDS_BUSINESS`, the business tax number | unchanged; they read the address's country |
| Product-tier check | `scripts/stripe-product-tiers.ts` | `KNOWN_TIERS` + solo, business |
| QA sandbox | `qa/support/billing-live.mjs` (Keychain `barmajiyat/MUTABA3A_STRIPE_SANDBOX_KEY`, `stripe listen`) | seeds the catalog by running the plan script, not its own price list (finding 9) |
| Solo trial step | `src/hosted/pages/onboarding/SoloTrialStep.tsx` (`SOLO_TRIAL_CHECKOUT=false`, TODO(MUT-702 Part B)) | Try Solo → the address step → Checkout; the price line from the catalog |
| Billing drawer | `src/hosted/components/BillingDrawer.tsx` (Subscribe step: country Select, buyer, interval) | the country Select becomes the billing address; a plan row on top |

## 3. The provider port

```ts
// server/src/billing/provider.ts (new)
export type ProviderId = 'stripe';          // widened when a second provider exists
export type Seller = 'barmajiyat';          // widened when a second seller exists

export interface BillingProvider {
  id: ProviderId;
  seller: Seller;
  /** Sellable list prices for every plan, by plan, interval and currency (cached by the adapter). */
  catalogs(): Promise<PlanCatalogs>;
  /** Saves the billing address on the provider's customer, then a hosted payment page for one plan in the address's
   *  currency; `trialDays` with a card required. Idempotent per (user, plan, interval). */
  startCheckout(input: ProviderCheckoutInput): Promise<{ url: string }>;
  /** The provider's own page to change the card or the address and see receipts. */
  manageUrl(input: { userId: string; returnUrl: string; flow?: 'card' }): Promise<{ url: string }>;
  /** Verify and normalise a provider callback into mirror writes (each provider keeps its own route and signature). */
  handleCallback(raw: RawCallback): Promise<MirrorChange[]>;
}
/** The one configured provider. A second one adds a choice here, nothing else. */
export function billingProvider(deps: ProviderDeps): BillingProvider;
```

- **Stripe adapter** (`billing/stripe/provider.ts`): a thin wrapper over the existing gateways. No Stripe logic is moved
  or rewritten. In B only Checkout, the catalog and the manage link go through the port; pause, yearly switch, stay and
  come-back keep calling the gateways directly (they are Stripe-only by design until a second provider exists).
- **Mirror:** `billing_subscriptions` gains `provider VARCHAR(16) NOT NULL DEFAULT 'stripe'` and
  `seller VARCHAR(16) NOT NULL DEFAULT 'barmajiyat'`. `stripeSubscriptionId` keeps its name (it holds the provider's
  id); the unique key becomes `(provider, stripeSubscriptionId)`. Additive; every row today is Stripe and Barmajiyat.

## 4. Billing address: our own short form before Checkout (recommended)

**Recommendation: ask the address in MTB3A's own Subscribe step, then send the person to Checkout with it set.**

Why:
- **The currency must be known before Checkout opens.** A Stripe Checkout session is created in one currency; the
  address typed inside Checkout changes the tax, never the currency. Letting Checkout collect it would mean either
  guessing the currency from the IP (Stripe's adaptive pricing, which can disagree with the address) or a second
  session after the address is known.
- **Our price lines show the right currency and say "+ VAT" for an Israeli address** before the person leaves MTB3A,
  so the Stripe page never shows a total they didn't expect.
- **The buyer rules already run on the country** (`isConsumerCountry`, `COUNTRY_NEEDS_BUSINESS`, the tax number), and
  they keep running before Checkout as today.

How:
- The form: country (first), address line, city, postal code, all **free text** (Basel, 2026-11-26). The country is
  typed and matched against our country list in Arabic and English (case, hamza, short vowels and a leading «ال»
  ignored), with suggestions as you type; no match says "No match" and Continue stays off. Prefilled from the Stripe
  customer's address when one exists (a returning payer).
- On Continue the adapter writes it to the Stripe customer (`customers.update { address }`), then creates the session
  with `currency` from the country, `automatic_tax.enabled = true`, `customer_update.address = 'never'` (the Stripe
  page shows it and cannot change it), and `billing_address_collection = 'auto'`.
- Changing the address later (Stripe's Customer Portal, or MTB3A's form on a new Checkout) updates the tax from the next
  invoice; the subscription's currency never changes (Stripe doesn't allow it). A person who moves country keeps the
  currency they subscribed in.

## 5. Catalog and the plan script (from the 2026-11-22 draft §D, §I; unchanged unless noted)

- Lookup keys `{plan}_list_{monthly|yearly}_{ils|usd}`; `PlanCatalogs = Record<PlanName | 'freelancer', Catalog>`.
  Freelancer is read and never sold.
- `pricesByLookupKey` makes one call per plan (≤10 keys each), cached 10 min.
- `server/src/scripts/stripe-plans.ts`, `npm --prefix server run billing:plans`: dry run by default, `--apply` writes,
  exit codes 0 / 1 / 2. Pure core `planActions(state, spec)`: create-product | tag-product | create-price |
  transfer-key. It never touches `freelancer_*` or `accountant_*`. Every price `tax_behavior: exclusive`, products
  carry the SaaS tax code (`txcd_10103001`).
- **The spec (the one place amounts are written), before tax:**

| Product | ILS month / year | USD month / year |
|---|---|---|
| `mtb3a_solo` (tier solo) | 3900 / 39000 | 1200 / 12000 |
| `mtb3a_business` (tier business) | 8900 / 89000 | 2700 / 27000 |
| `mtb3a_firm` (tier firm; exists live at ₪149) | 24900 / 249000 | 7500 / 75000 |

## 6. Checkout

`POST /v1/billing/checkout-session` body:

```
{ plan?: 'solo'|'business'|'firm'|'accountant',   // absent = solo (an old portal buys the entry plan)
  trial?: boolean,                                  // Solo only
  address: { country, line1, city, postalCode },    // replaces `country`; `country` alone stays accepted one release
  interval, buyer, businessTaxNumber?, returnPath }
```

Refusals (409 with `code`), the existing ones plus:
- `TRIAL_NOT_OFFERED`: `trial: true` without a live offer (`paidTrialOfferedAt` set, `paidTrialUsedAt` null, account
  created after `SOLO_TRIAL_OFFER_SINCE`, plan Starter), or `plan` isn't solo.
- `PLAN_CHECKOUT_OFF`: `PLAN_CHECKOUT` is off and `plan` isn't solo or absent (the dark switch).
- `ADDRESS_INVALID` (422): country not ISO-3166 alpha-2, or a required line empty.
- `ALREADY_SUBSCRIBED` unchanged: changing plan is MUT-734, never a second Checkout.

Behaviour:
- Currency from the address's country (`currencyOf`, unchanged: IL → ILS, else USD).
- Session metadata `mutaba3a_plan`, `mutaba3a_seller`; `expireOpenCheckouts(customer, 'profile')` expires any open
  profile-plan Checkout whatever its plan (two tabs can't buy two plans).
- Trial: `subscription_data.trial_period_days = 14`, `payment_method_collection: 'always'`,
  `trial_settings.end_behavior.missing_payment_method = 'cancel'`. `paidTrialUsedAt` is set by the mirror when the
  trialing subscription first appears (an abandoned Checkout keeps the offer).
- Offers: until MUT-703, `offerFromCoupon` checks the coupon's products against the plan sold; the Freelancer launch
  coupon applies to nothing. B and 703 release together (finding 3).

`GET /v1/billing` (additive): `plans: [{ plan, catalog: { ILS, USD } }]`, `billingAddress: { country, … } | null` (the
customer's saved address, for prefill). `catalog` stays (now Solo's) for older portals and the phone. `yearlySwitch`
reads the subscription's own plan catalog.

## 7. Data and migration

`20261127xxxxxx_mut702b_provider`: `billing_subscriptions.provider`, `.seller` (defaults as above), unique
`(provider, stripeSubscriptionId)`. Additive only. The address is not stored by MTB3A (Stripe's customer holds it).
**Warn the orchestrator before merging** (it restarts the shared dev API), and migrate the shared QA DB after the merge.

## 8. Flags (dark by default)

| Flag | Where | Off means |
|---|---|---|
| `PLAN_CHECKOUT` | `server/src/config.ts` | Checkout sells Freelancer as today; `plans` is empty in `GET /v1/billing` |
| `SOLO_TRIAL_CHECKOUT` | portal constant (exists) | the onboarding trial step stays hidden |

Release order: Stripe Tax registrations live (Basel) → catalog script live (Basel) → `PLAN_CHECKOUT` on with MUT-703 →
`STARTER_PLAN` on → `SOLO_TRIAL_CHECKOUT` on.

## 9. UI (wireframes: scratchpad `mut702b-wireframes.html`)

1. **Subscribe step:** a plan row on top (Solo · Business · Firm, the current plan not listed), then the billing
   address, buyer and interval. Before the address has a country each plan shows both currencies; after, the one
   currency, with "+ VAT" when the country is Israel. Starter's See plans opens it.
2. **Onboarding Solo trial step:** unchanged apart from the price line (both currencies, from the catalog) and Try Solo
   opening the address step, then Checkout. No country on the step itself.
3. **Trial address step:** the same address form, titled for the trial, with the first-charge line in the address's
   currency.
4. **Phone:** no new screen. The phone never sells (store rules); its Starter notices already open Billing on the web.

Copy: ar first, en; nothing explains how billing works; prices and VAT are data.

## 10. i18n

New keys under `hosted.billing.subscribe.plan.*`, `hosted.billing.address.*` (country, line1, city, postalCode,
title), `hosted.billing.plan.plusVat`; plan names exist (`hosted.plan.name.*`: مستقل / تجاري / مؤسسة). Server mail copy
`email/templates/copy.ts:507,525` names the subscription's own plan.

## 11. Stripe sandbox setup (Claude does this, test mode only)

The key never touches argv, disk or the repo: it comes from Keychain service `release-kit`, account
`barmajiyat/MUTABA3A_STRIPE_SANDBOX_KEY`, into `STRIPE_API_KEY` for the CLI and `STRIPE_SECRET_KEY` for the script.

```bash
export STRIPE_API_KEY="$(security find-generic-password -s release-kit -a barmajiyat/MUTABA3A_STRIPE_SANDBOX_KEY -w)"
case "$STRIPE_API_KEY" in sk_test_*|rk_test_*) ;; *) echo "not a test key"; exit 1;; esac

# 1. what exists
stripe products list --limit 100
stripe tax settings retrieve
stripe tax registrations list

# 2. Stripe Tax in the sandbox: head office (UK), an Israel VAT registration, SaaS default tax code
stripe tax settings update -d "head_office[address][country]=GB" -d "defaults[tax_code]=txcd_10103001" -d "defaults[tax_behavior]=exclusive"
stripe tax registrations create -d country=IL -d "country_options[il][type]=standard" -d active_from=now

# 3. the catalog, through the script (dry run, apply, then a second dry run must print "nothing to do")
STRIPE_SECRET_KEY="$STRIPE_API_KEY" npm --prefix server run billing:plans
STRIPE_SECRET_KEY="$STRIPE_API_KEY" npm --prefix server run billing:plans -- --apply
STRIPE_SECRET_KEY="$STRIPE_API_KEY" npm --prefix server run billing:plans

# 4. the product-tier check the release runs
STRIPE_SECRET_KEY="$STRIPE_API_KEY" npx --prefix server tsx server/src/scripts/stripe-product-tiers.ts

# 5. webhooks to a local API (the QA env does this itself)
stripe listen --forward-to 127.0.0.1:8790/v1/billing/stripe/webhook \
  --events checkout.session.completed,customer.subscription.created,customer.subscription.updated,customer.subscription.deleted,invoice.paid,invoice.payment_failed

# 6. a trial end without waiting 14 days: the QA spec makes the customer on a test clock and advances it 15 days
stripe test_helpers test_clocks create --frozen-time "$(date +%s)" --name mut702b-trial
unset STRIPE_API_KEY
```

The exact `tax registrations` options are checked against Stripe's API reference at build time. Nothing here is live.
The live steps (Stripe Tax head office and the Israel registration, the script with `rk_live_…`, key scopes for
Products/Prices/Tax, the Customer Portal letting people edit their address, the webhook's events) go into
`docs/operations/before-release.md` for Basel.

## 12. QA scenarios (release-QA, `portal-live` app against the sandbox)

| id | Steps | Outcome |
|---|---|---|
| `billing.buy-solo-israel` | Starter › See plans › Solo › address in Israel › person › Monthly › Continue › test card | Billing shows Solo; the invoice is ₪39 + ₪7.02 VAT |
| `billing.buy-business-yearly-abroad` | Business, address in Jordan, Yearly | Business, $270 a year, tax as Stripe computes |
| `billing.buy-firm-business-buyer` | Firm, a business buyer with a tax number | Firm; the tax number on the invoice |
| `billing.address-prefilled` | a returning payer opens Subscribe | the address is filled from the last one |
| `onboarding.solo-trial-card` | new account › Try Solo › address › test card | Solo, trial ends in 14 days, Starter limits gone |
| `onboarding.solo-trial-ends` | test clock + 15 days | charged in the address's currency; still Solo |
| `onboarding.solo-trial-cancel` | cancel during the trial; clock + 15 days | Starter, active (not read-only) |
| `billing.legacy-freelancer` | a ₪29 sandbox subscription | Billing unchanged, names the legacy plan |

## 13. Test plan (written first; Vitest, memory store, fake gateways)

1. `plans.test.ts`: lookup key round trip; `tierOfLookupKey` for every family (founder → freelancer, unknown → null).
2. `provider.test.ts`: the configured provider is Stripe/Barmajiyat; `startCheckout` writes the address before the
   session; the session has the address's currency, `automatic_tax`, `customer_update.address = 'never'`.
3. `checkout.test.ts`: `catalogFrom` per plan; a key on the wrong product leaves that plan unsellable; `planCheckout`
   per plan; absent plan → solo; trial params; `ADDRESS_INVALID`; the buyer rules read the address's country.
4. `checkout-gateway.test.ts`: ≤10-key calls, cached, failure TTL; `setCustomerAddress`.
5. `mirror.test.ts`: solo/business products → SOLO/BUSINESS; provider/seller written; trialing sets
   `paidTrialUsedAt`.
6. Route `checkout-session`: each plan reaches the adapter with the right price; `TRIAL_NOT_OFFERED`;
   `PLAN_CHECKOUT_OFF`; `ALREADY_SUBSCRIBED` unchanged; the old `country`-only body still works.
7. Route `GET /v1/billing`: `plans`, `billingAddress`, `catalog` still Solo; legacy subscription view unchanged.
8. `stripe-plans.test.ts` (`planActions`): empty → full list; complete → nothing; Firm ₪149 → transfer; wrong tag →
   tag; freelancer/accountant never touched; tax code and `exclusive` on every price.
9. `test:db`: the migration's defaults and the new unique key.
10. Portal: the plan row (catalog prices, current plan hidden, one currency and "+ VAT" once the country is Israel);
    the address form (prefill, required fields); `SoloTrialStep` → address step → `startCheckout({ plan: 'solo',
    trial: true, address, … })`.

Commands through the heavy queue, one at a time (light lane for typechecks and affected tests; full suites at the end,
when Basel says so).

## 14. Risks

1. **The launch offer** disappears between B and 703: release them together.
2. **Israeli VAT through a UK seller** needs Barmajiyat registered for Israeli VAT before Stripe Tax can charge it live
   (new question for Basel and the accountant). The sandbox registration is only a test.
3. **Firm key transfer:** live subscriptions on ₪149 keep their price; only the key moves. MUT-707 lists them.
4. **Currency is fixed per subscription:** someone who moves country keeps their currency; only the tax follows the
   new address.

## 15. Cost

4 cached `prices.list` calls per 10 minutes per instance; one `customers.update` per Checkout; Stripe Tax's per-
transaction fee on every paid invoice. One additive migration; no new tables, jobs or services.

## Build notes (2026-11-26)

- **Israeli VAT is a Stripe tax rate, not Stripe Tax.** The sandbox refused `tax registrations create … country_options[il]`
  (unknown parameter): Stripe Tax has no Israel registration. So `billing:plans` also makes an exclusive tax rate
  (`metadata.mtb3a_vat = IL`) at `billing-countries.json` `vatRates.IL` (18; ADR-286 decision 2: one configuration
  value), and an Israeli address's Checkout puts it on the line item with `automatic_tax` off. Other countries keep
  Stripe Tax. No rate in Stripe = Israel not sold (PRICES_NOT_SET). Sandbox check: a Jerusalem Solo Checkout totals
  3900 + 702 ILS; a Jordanian one 1200 USD with no tax (no registration there).
- **Sandbox state:** head office GB set; the three products, twelve prices and the 18% rate made by the script; a second
  dry run says nothing to do; `billing:product-tiers` OK. The sandbox account also holds Malafat's products (`planKey`
  metadata); the script never touches them.
- **Not built as written:** the unique key stays `stripeSubscriptionId` (TD-348); the QA sandbox seeding
  (`billing-live.mjs`) and the portal-live flows of §12 wait (TD-347).
- **Q1/Q5/Q6 (Basel: yes):** the plan row is in this ticket; each plan shows one limits line; USD $12/$27/$75 a month,
  a year = 10 months.

