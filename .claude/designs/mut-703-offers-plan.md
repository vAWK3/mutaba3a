# MUT-703: offers on Solo, Business and Firm (launch, stay, come-back, switch to yearly)

Status: **APPROVED with all 12 default answers in §13 (Basel, 2026-11-27). Server half BUILT (API 1.210.0-mut703, ADR-340; see "Build decisions" at the end); UI half with the billing lane (§11).** Epic MUT-701. Blocked by MUT-702 (Part B merged).
Basel (2026-11-27): the offers must be live before Switch rollout stage 1 (`STARTER_PLAN` + `PLAN_CHECKOUT`).

```
Tracker: Jira · barmajiyat.atlassian.net · MUT · Backlog = not committed · finished → In Review
```

Builds on ADR-237 (launch), ADR-238 (yearly switch), ADR-240 (pause, stay, cancel flow), ADR-243 (come-back),
ADR-275 (plans), ADR-284 (Starter), ADR-288 (plan Checkout, the catalog script), ADR-290 (Israeli VAT on the item),
ADR-291 (plan change; its decision 6 is about coupons), ADR-293 (paid caps), ADR-300 d2 (accountant activation: no offer).

**No number in this plan is decided.** Every percent, month count and date is a placeholder in `<ANGLE_CAPS>` until
Basel answers §13. The ticket's own proposals are quoted only as the recommended defaults in §13.

---

## 1. Problem

Every offer is wired to the legacy Freelancer price. With `PLAN_CHECKOUT` on, Solo, Business and Firm are sold with no
offer at all, and three of the four offers silently refuse those subscriptions. Exactly where:

| Offer | Where it is Freelancer-only today | What happens to a Solo/Business/Firm person |
|---|---|---|
| **Launch** (ADR-237) | `offers.json` `tier: "freelancer"`; `offer.ts:20,83` parser accepts only `freelancer`; `offer.ts:117-119` `offersFor` hard-codes it; `offer.ts:133-136` `productIdsOf(catalog)` is the legacy catalog's products, and `offerFromCoupon` (`:142-153`) needs the coupon's `applies_to` inside it; `offer-read.ts:13-36,44` reads `ALL_GA_LOOKUP_KEYS` (`freelancer_list_*`); `routes/billing.ts:813-850` `startPlanCheckout` never asks for an offer (audit `offer: null`); the route doc says "No offers apply until MUT-703" | A yearly Solo/Business/Firm Checkout is full price. GET `/v1/billing` `offer.firstYear` is the ₪29 plan's |
| **Stay** (ADR-240 d7) | `retention.ts:33-38` `listMonthlyCurrencyOf` knows only `GA_PRICE_LOOKUP_KEYS[*].month`; `retention.ts:171-193` `stayOfferOf`/`isStayCoupon` check the legacy products; `routes/billing-plan.ts:251-266` `stayOf` reads `catalogOf(checkout)` (legacy) | `NOT_MONTHLY_LIST`: no stay step. **Pause is refused too** (`planRefusal`, `retention.ts:197-203`, same helper) |
| **Come-back** (ADR-243) | `comeback.ts:52-77` `comebackOfferOf` checks Freelancer products and is amount-off per currency, tuned to ₪29; `comeback.ts:97` refuses a lapsed `FIRM` tier (written for the old ₪149 Firm); `comeback-read.ts:41,52` reads one entry and the legacy catalog; `routes/billing.ts:911` portal and the plan Checkout never apply it | Come-back mail never goes to a Firm lapser; nobody coming back gets it on Solo/Business/Firm |
| **Switch to yearly** (ADR-238) | `retention.ts:36-60` `listMonthlyCurrencyOf`/`yearlySwitchOf`; `yearly-switch-line.ts:16-18,36-58` legacy catalog; `routes/billing-plan.ts:130-151` `switchOf` reads `catalogOf(checkout)`; `monthly-summary-mail.ts:223` | `NOT_MONTHLY_LIST`: no switch line, no switch, no summary-mail line |
| **Renewal notice** (ADR-237 d8) | `renewal-mail.ts:126` skips anything not in `ALL_GA_LOOKUP_KEYS` (`not-list-price`) | A launch-offer Solo/Business/Firm subscription renews at full price with **no 30-day notice** (breaks ADR-237's honesty rule and the ticket's AC1) |
| **Billing view** | `routes/billing.ts:654` `renewsAtListPrice` only for `freelancer_list_*` | The drawer never names the renewal price for a plan subscription |
| **Trial mails' offer line** | `offer-read.ts:40-52` reads the legacy catalog for the coupon check | A new plan coupon would be refused, so the line disappears |

Two interplays that are new with three plans:

- **Plan change (MUT-734, ADR-291 d6)** assumed "a launch coupon is dropped on upgrade (Stripe's item change)". That
  holds only while the coupon is restricted to the old product. A coupon covering all three products is **not** dropped
  by an item change: a running stay discount would follow the person onto Business. And `scheduleDowngrade`
  (`plan-gateway.ts:298-316`) rewrites the schedule's phases with no `discounts`, which may **drop** a running stay
  discount at the moment of scheduling (to be confirmed, spike S2).
- **Proration after a launch year:** a `once` coupon is spent on the first yearly invoice. If Stripe credits unused
  time at the list price, an upgrade mid-launch-year credits more than the person paid (spike S1).

## 2. Acceptance criteria

1. A yearly Checkout for Solo, Business or Firm, started inside the launch window by someone the launch rule lets in,
   carries the launch coupon: the first year is `<LAUNCH_PERCENT>` off; Stripe's page states the first-year price, the
   price it renews at and from when. Renewal is at that plan's list price; the renewal notice goes out about 30 days
   before, naming the plan and its price.
2. The stay offer appears in the cancel flow of an active monthly Solo, Business or Firm subscription, in both
   currencies, at `<STAY_PERCENT>` for `<STAY_MONTHS>` months of that plan's own price. Pause works on the same plans.
3. The come-back mail reaches a person whose paid Solo, Business, Firm or legacy Freelancer plan lapsed (per §13 Q5),
   and the Checkout they come back through carries the come-back coupon on the plan they choose, in both currencies.
4. The switch-to-yearly line and the switch itself work on monthly Solo, Business and Firm, with the saving of the
   person's own plan (12 × its monthly less its yearly, from the catalog).
5. Legacy Freelancer subscriptions keep their offers: the legacy stay coupon on ₪29 monthly payers, the legacy switch,
   the legacy launch and come-back coupons on the legacy Checkout path while it exists.
6. Every coupon on a plan product is made by `npm --prefix server run billing:plans`, never by hand; a second dry run
   prints "nothing to do". No percent, month count or date is written anywhere else in code.
7. Offers never stop a payment (ADR-237 d5): a missing, misshaped or unreadable coupon is full price, warned.
8. A plan change never leaves a discount where the person doesn't expect it: the preview names what happens to a
   running offer, and the confirm does exactly that (§13 Q7).
9. Tests cover each offer on each plan and both currencies (§9); release-QA features and passing specs for the
   user-visible flows (§10).

**Out:** the portal picker and change pane themselves (MUT-705, MUT-734 UI half: this plan names the hooks they leave,
§11); moving ₪29 payers (MUT-707); invite-a-friend (MUT-536); phone selling (store rules; MUT-706 has nothing to add, §6).

## 3. Design

### 3.1 One idea: an offer entry names the plans it covers

`offers.json` entries stop saying `tier: "freelancer"` and say which plans they cover:

```jsonc
[
  // legacy, unchanged ids and coupons (AC5); "tier": "freelancer" stays accepted as an alias of plans: ["freelancer"]
  { "id": "launch-2026",   "couponId": "mtb3a_launch_yearly_2026", "interval": "year",  "plans": ["freelancer"] },
  { "id": "stay-2026",     "kind": "stay", "couponId": "mtb3a_stay_monthly_50", "interval": "month", "plans": ["freelancer"] },
  { "id": "comeback-2026", "kind": "comeback", "couponIds": { "ILS": "mtb3a_comeback_first_month_ils", "USD": "mtb3a_comeback_first_month_usd" }, "plans": ["freelancer"] },
  // MUT-703: one coupon per kind across the three plans (§4)
  { "id": "<LAUNCH_OFFER_ID>",   "couponId": "<LAUNCH_COUPON_ID>",   "interval": "year",  "plans": ["solo", "business", "firm"] },
  { "id": "<STAY_OFFER_ID>",     "kind": "stay",     "couponId": "<STAY_COUPON_ID>",     "interval": "month", "plans": ["solo", "business", "firm"] },
  { "id": "<COMEBACK_OFFER_ID>", "kind": "comeback", "couponId": "<COMEBACK_COUPON_ID>", "interval": "<COMEBACK_INTERVAL>", "plans": ["solo", "business", "firm"] }
]
```

- `plans: (PlanName | 'freelancer')[]`, non-empty, no duplicates. An entry's plans are all on sale or all legacy, never
  mixed (a coupon's products are fixed at creation, §4).
- A come-back entry is either the legacy shape (`couponIds` per currency, amount off) or the new shape (`couponId`,
  percent off, so one coupon serves both currencies and every plan; §13 Q1). An optional `interval` limits it
  (§13 Q4); absent = both, as today.
- **Lookup is by (kind, plan, interval):** `entryFor(entries, kind, plan, interval)` = the first entry of that kind
  whose `plans` include the plan (and whose interval matches, where it has one). Legacy and new entries never compete.
- **Once-ever rules are per person across entries:** come-back "already had" reads every come-back entry's id (old and
  new), so someone who used the legacy come-back can't take the new one; launch eligibility is "never subscribed", which
  doesn't read ids; the stay offer's once-ever is the existing partial unique index on `billing_retention_events`.

### 3.2 Catalog: the products a coupon may cover

`productIdsOf(catalog)` becomes `productsOf(plans, catalogs)`: the product ids of exactly the entry's plans, from
`PlanCatalogs` (the provider's `catalogs()`, `billing/stripe/provider.ts:11`) plus the legacy catalog for `freelancer`.
A coupon is an offer only if its `applies_to.products` is **non-empty, inside the entry's products, and includes the
product of the plan being sold or held** (else Stripe would silently not discount the line and our price line would be
wrong). The existing shape checks stay per kind:

| Kind | Stripe shape required (else no offer, warned) |
|---|---|
| launch | valid, `percent_off` in (0, 100], `duration: once`, `redeem_by` set; ends for new Checkouts an hour before `redeem_by` (R1) |
| stay | valid, `percent_off`, `duration: repeating`, `duration_in_months ≥ 1` |
| come-back (new) | valid, `percent_off`, `duration: once` (or `repeating` if §13 Q3 says more than one month) |
| come-back (legacy) | unchanged: amount off per currency, `once`, below the monthly price |

### 3.3 Per-subscription plan and catalog

One helper replaces `listMonthlyCurrencyOf`: `listPriceOf(lookupKey) → { plan: PlanName | 'freelancer', interval,
currency } | null`, true for `freelancer_list_*` and `{solo|business|firm}_list_*` (`plans.ts` `planOfLookupKey`), null
for founder keys, Accountant and anything else (founders still never switch, pause or take the stay offer). Every
consumer reads the catalog of that plan:

- `yearlySwitchOf`, `pauseOptionsOf`, `stayOfferOf` (`retention.ts`) take `{ plan, catalog }` of the subscription.
- `yearlySwitchLine`, `switchOf` (`routes/billing-plan.ts`), `stayOf`, the monthly summary mail: `catalogOfKey(key)`,
  one cached read through the provider's `catalogs()` (already cached 10 min) or the legacy `catalogOf`.
- `renewal-mail.ts` `skipReason`: a list price is `listPriceOf(key) !== null` (any plan); the mail gains the plan name.
- `subscriptionView.renewsAtListPrice` the same.

### 3.4 Launch at a plan Checkout

`startPlanCheckout` (`routes/billing.ts:803-850`) gains the legacy path's offer step, inside the Stripe call after
`stillRefused`, unchanged in spirit (ADR-237 d4–d6):

1. Yearly only (§13 Q2): `offerOrNothing(provider, offers, 'launch', plan, 'year', fresh: true)`.
2. Eligible per `offerEligible` on the mirror plus Stripe's own list (§13 Q6 may widen "never subscribed").
3. Else the come-back step (3.6).
4. `expectedOffer` honoured: an offer the drawer showed that no longer applies → 409 `OFFER_ENDED`, no Checkout.
5. `planCheckout(..., offer: applied)` re-run; `paramsOf` already adds `discounts` and the offer metadata
   (`mutaba3a_offer`); `offerSubmitMessage` gets the plan's amounts. For an Israeli address the line says the amounts
   are before VAT (the existing note already does; check the copy names "+ VAT").
6. Not for the Solo trial (monthly) and **not for an accountant's activation** (`who.actor.id !== who.payer.id`,
   ADR-300 d2) unless §13 Q10 says otherwise.
7. Audit `billing.checkout_started` `offer: applied?.id ?? null` (today hard-coded null).

GET `/v1/billing`'s `offer` reads the plans' launch entry while `PLAN_CHECKOUT` is on (the legacy entry while off).

### 3.5 Stay offer and pause per plan

`stayOf` picks `entryFor('stay', plan, 'month')`: the legacy coupon for ₪29 payers (AC5), the new one for the plans.
Amounts from the subscription's own plan catalog (`monthlyAmount = list − Stripe's rounding`). New refusal
`SCHEDULED` (stay and pause and switch): a subscription with a scheduled MUT-734 downgrade is on a Stripe schedule, and
`subscriptions.update` would fight the schedule's phases. The person undoes the scheduled change first.

### 3.6 Come-back per plan

- Who: `comebackSubscriptionRefusalOf` drops the `FIRM` refusal for the plans (§13 Q5); the rest of the rule (30 days
  after a paid lapse, not covered, owns a profile, the mail opens it, no stay offer in the last `<STAY_BLOCKS_MONTHS>`
  months per §13 Q8) is unchanged.
- The mail (`comeback-mail.ts`, template `comeback-offer`) names **the plan the person lapsed from** (a legacy
  Freelancer lapser: Solo, the plan that replaced it, unless §13 Q5 says otherwise) and its first-month price after the
  percent; vars gain `plan` and `percentOff`; amounts per ADR-243 d6 (the mail already names amounts).
- The Checkout: the plan they pick, the interval §13 Q4 allows. A percent coupon serves both currencies, so the
  "no-price" skip only fires when the plan isn't sold in the person's currency.

### 3.7 Plan change and running discounts (MUT-734 interplay)

Depends on spikes S1 and S2 (§7) and §13 Q7. The recommended default, matching ADR-291 d6 and Basel's MUT-734 Q5:

- **Upgrade:** the running discount (a stay offer mid-way, a repeating come-back) is removed in the same
  `subscriptions.update` (`discounts: ''` beside the item change, `plan-gateway.ts:282-296`). The preview says so.
  The `once` launch coupon is already spent after the first invoice, so there is nothing to remove; S1 decides whether
  the unused-time credit needs a cap.
- **Downgrade:** `scheduleDowngrade` copies the subscription's discounts into phase 1 (and, if the discount outlives the
  boundary and §13 Q7 says keep it, phase 2), so scheduling never drops a running stay discount.
- **Yearly switch:** unchanged (refused while discounted, ADR-238 d4).

### 3.8 Phone

Nothing. The phone never sells (store rules, MUT-364 D1) and its billing model reads none of `offer`, `comeback`,
`yearlySwitch` or `plans` (checked: no reference in `mutaba3a-flutter/mutaba3a/lib`). Every API change here is additive.

## 4. Stripe coupons (made by the catalog script only)

`server/src/scripts/stripe-plans.ts` gains the coupons section the MUT-702 plan left empty (`mut-702-three-plans-plan.md`
"Coupons"). **The only place offer amounts and dates are written**, exactly as `PLAN_SPEC` is for prices (an amendment
to ADR-237 d1 "no amount or date in the code": they stay out of the server and the clients, which still read Stripe).

```ts
export interface CouponSpecRow {
  id: string;                      // the Stripe coupon id, also named in offers.json
  name: string;                    // shown on Stripe's invoice: "Launch offer · عرض الإطلاق", "Stay offer · عرض البقاء", "Welcome back · عرض العودة"
  plans: readonly PlanName[];      // applies_to = these plans' products, resolved by productOf (never Freelancer or Accountant)
  percentOff: number;              // <LAUNCH_PERCENT> | <STAY_PERCENT> | <COMEBACK_PERCENT>
  duration: 'once' | 'repeating';
  durationInMonths?: number;       // stay: <STAY_MONTHS>; come-back: <COMEBACK_MONTHS> if more than one
  redeemBy?: string;               // launch: <LAUNCH_REDEEM_BY> (ISO, Asia/Jerusalem day end + 1 h, as the live legacy coupon)
  metadata: { mtb3a_offer: 'launch' | 'stay' | 'comeback' };
}
export const COUPON_SPEC: readonly CouponSpecRow[] = [/* three rows, values from §13 */];
```

| Coupon (placeholder id) | Plans | Shape |
|---|---|---|
| `<LAUNCH_COUPON_ID>` (e.g. `mtb3a_launch_yearly_plans_<YEAR>`) | solo, business, firm | `<LAUNCH_PERCENT>`% · once · `redeem_by` `<LAUNCH_REDEEM_BY>` |
| `<STAY_COUPON_ID>` | solo, business, firm | `<STAY_PERCENT>`% · repeating `<STAY_MONTHS>` |
| `<COMEBACK_COUPON_ID>` | solo, business, firm | `<COMEBACK_PERCENT>`% · once (or repeating `<COMEBACK_MONTHS>`) |

Script behaviour (pure core `couponActions(state, spec, products)`, like `planActions`):

- **create-coupon** when the id is missing: `coupons.create({ id, name, percent_off, duration, duration_in_months,
  redeem_by, applies_to: { products }, metadata })`. Idempotency key per id.
- **A coupon that exists with another shape is never "fixed"**: Stripe can't edit percent, duration, products or
  `redeem_by`. The dry run prints `coupon <id> differs (<field>): give the spec a new id and name it in offers.json`
  and exits 2; `--apply` refuses. Name-only drift is updated (`coupons.update { name }`).
- **Retiring:** `RETIRED_COUPON_IDS` in the spec; `--apply` deletes them (ending a campaign early is a spec change and a
  run, not a dashboard click). Legacy Freelancer coupons are never touched unless listed there.
- **Promotion codes: none.** ADR-237 and MUT-528 chose automatic offers only (no codes); the script makes none unless
  §13 Q9 changes that.
- `readState` adds `coupons.list` (`expand: data.applies_to`).
- **A test ties the two files:** every non-legacy `couponId` in `offers.json` has a `COUPON_SPEC` row with the same
  plans, and every spec row is named by an entry (no orphan coupons).
- Key scope: the live restricted key needs **Write on Coupons** (today Read only, ADR-237). Sandbox: Claude runs it with
  the Keychain test key (`mut-702b-checkout.md` §11); live: Basel.

**Alternative kept in reserve (if §13 Q1 picks different amounts per plan):** one coupon per (kind, plan), each
restricted to one product, `offers.json` entries with one plan each. Lookup is unchanged (by plan). Amount-off coupons
would need one per (kind, plan, currency): six per kind, because Checkout refuses an amount-off coupon in another
currency (ADR-243 d1).

## 5. API contracts (all additive; next minor, e.g. `1.16x.0-mut703`)

**GET `/v1/billing`**
- `plans[]` items gain `launch: { id, firstYear: { ILS, USD } } | null` (that plan's first year after the coupon,
  Stripe's half-up rounding, server-computed, ADR-004) and `comeback: { id, firstMonth: {ILS,USD}, listMonth: {ILS,USD},
  firstYear: {ILS,USD} | null, listYear: {ILS,USD} | null } | null` (only while the come-back is open to this person;
  the yearly pair null if §13 Q4 says monthly only).
- `offer` (unchanged fields) describes the plans' launch entry while `PLAN_CHECKOUT` is on; `offer.firstYear` is Solo's,
  for older portals.
- `comeback` gains `percentOff` and `plan` (the plan the mail named); its amounts are that plan's.
- `yearlySwitch` gains `plan`; its `savings` is the person's own plan's.
- `subscription.renewsAtListPrice` true on any plan list price.

**POST `/v1/billing/checkout-session`** with `plan`: carries the launch or come-back coupon as §3.4; `expectedOffer`
honoured; 409 `OFFER_ENDED` as today. The route description drops "No offers apply until MUT-703".

**GET `/v1/billing/retention`, POST `/v1/billing/stay-offer`, `/v1/billing/pause`**: shapes unchanged; open on the
plans; `details.why` gains `SCHEDULED`.

**GET/POST `/v1/billing/yearly-switch`**: shapes unchanged; open on the plans; `details.why` gains `SCHEDULED`.

**POST `/v1/billing/plan-change/preview`** gains `offerEnds: { id, kind: 'stay' | 'comeback' | 'launch' } | null`
(the running discount the change removes; §3.7). The confirm does what the preview said.

**Jobs:** `renewal-mail` (template `offer-renewing-soon` gains `plan`), `comeback-mail` (template `comeback-offer`
gains `plan`, `percentOff`), trial mails (unchanged copy; the coupon check reads the plan catalogs), monthly summary
(switch line per plan).

## 6. Error states

| Case | Answer |
|---|---|
| Coupon missing, invalid, wrong shape, or not covering the plan sold | No offer; GET warns, Checkout logs an error and charges the list price (ADR-237 d5) |
| The drawer showed an offer that no longer applies at Continue | 409 `OFFER_ENDED`, no Checkout |
| Stripe can't be asked for the coupon or the catalogs | GET: `offer`/`plans[].launch` null; retention: no stay step; switch: line hidden. Never blocks a read, a cancel or a payment |
| Stay/pause/switch on a subscription with a scheduled downgrade | 409 `…_NOT_AVAILABLE`, `why: SCHEDULED` |
| Come-back person's plan not sold in their currency | Mail skipped `no-price` (as today) |
| `offers.json` mixes legacy and on-sale plans in one entry, or names an unknown plan | Boot fails (`parseOffers`), like today's malformed file |
| Script: a live coupon's shape differs from the spec | Exit 2, nothing written, "new id" message |

## 7. Spikes (sandbox, test clocks; before the build, half a day)

- **S1: proration after a spent `once` coupon.** Solo yearly at `<LAUNCH_PERCENT>` off; upgrade to Business on day 30.
  Does Stripe's unused-time credit use the discounted amount paid or the list price? If the list price, the person is
  credited more than they paid: the options are a capped credit (`proration_behavior: none` plus our own one-off
  invoice item), refusing upgrades in the launch year, or accepting it (§13 Q7).
- **S2: schedules and discounts.** A stay discount running on Business monthly; `scheduleDowngrade` to Solo. Does the
  phases update drop the discount? Does phase 2 carry it when the coupon covers Solo's product?
- **S3: a percent come-back coupon on a yearly Checkout** (if §13 Q4 allows yearly) and on an Israeli-VAT line item
  (`tax_rates`, automatic tax off): the discount applies before VAT, and the pay-page line matches the invoice.

Results go in `.claude/designs/mut-703-spike-result.md`.

## 8. Migrations

**None expected.** The once-ever rules read existing data (subscriptions' `offerId`, `billing_retention_events` with its
partial unique index, the `COMEBACK_OFFERED` record). If §13 Q8 makes an offer once per plan rather than once per
person, a migration would widen the stay index to `(userId, kind, plan)`; it goes after main's newest,
`20261127210000_mut752_pilot_grants`, re-stamped at merge, with the orchestrator warned (it restarts the shared dev API).

## 9. Tests (written first; Vitest, memory store, fake gateways)

1. `offer.test.ts`: `parseOffers` accepts `plans`, maps `tier: "freelancer"`, refuses mixed and unknown plans; the new
   come-back shape; `entryFor` by (kind, plan, interval) for every plan and the legacy plan; `offerFromCoupon` refuses a
   coupon outside the entry's products and one not covering the plan sold; `offersFor` QA overrides build plan entries.
2. `offer-read.test.ts`: the launch per plan from `PlanCatalogs`; `firstYearOf` per plan and currency; Stripe failure is
   no offer.
3. `retention.test.ts`: `listPriceOf` for every key family (plan, legacy, founder, Accountant, unknown);
   `yearlySwitchOf` savings per plan and currency; `pauseOptionsOf` and `stayOfferOf` on each plan; legacy coupon for
   ₪29 payers; `SCHEDULED`.
4. `comeback.test.ts`: percent come-back amounts per plan and currency; Firm no longer refused (per Q5); already-had
   across old and new entry ids; the interval limit (Q4); stay-recent (Q8).
5. `renewal-mail.test.ts`: a plan launch subscription is due (not `not-list-price`); copy names the plan.
6. `comeback-mail.test.ts`: vars name the lapsed plan (legacy → Solo) and the percent.
7. Routes `billing.test.ts`: GET `plans[].launch` and `.comeback`, `offer` under `PLAN_CHECKOUT`, `yearlySwitch.plan`,
   `renewsAtListPrice`; plan Checkout yearly carries the coupon (`discounts`, metadata, pay-page line), monthly doesn't;
   come-back on a plan Checkout; `OFFER_ENDED`; accountant activation carries none; audit `offer`.
8. Routes `billing-plan.test.ts`: retention, stay, pause, switch on each plan; `SCHEDULED`.
9. `plan-change` (gateway + route): upgrade removes a running discount and the preview names it; downgrade keeps it in
   phase 1 (per S1/S2/Q7).
10. `stripe-plans.test.ts` (`couponActions`): empty → three creates with the plans' products; complete → nothing;
    differing shape → refused with the new-id message; name drift → update; retired → delete; Freelancer and Accountant
    coupons never touched; the offers.json ↔ spec tie.
11. Portal (Vitest): `billingView`/`billingPlans` helpers per plan (§11 hooks); the drawer opens on Yearly with the
    launch when the chosen plan has one; come-back line per plan; the change pane's `offerEnds` line.
12. Golden: `startPlanCheckout`'s Stripe params with an offer, for the payer's own Checkout (MUT-766's golden test).

Commands through the heavy queue, one at a time (light lane for typechecks and affected tests; full suites at the end).

## 10. QA scenarios (release-QA)

FakeApi (`qa/features/portal/billing.yaml`, `qa/specs/portal/billing.spec.ts`):

| id | Steps | Outcome |
|---|---|---|
| `portal.billing.plan-launch-yearly` | Starter › See plans › Business › address › Yearly | The Business row shows the first-year price and the list price after it; Continue sends `expectedOffer` |
| `portal.billing.plan-launch-monthly-none` | Same, Monthly | No launch line (per Q2) |
| `portal.billing.plan-offer-ended` | Continue answered 409 `OFFER_ENDED` | The banner with the list price; nothing charged |
| `portal.billing.stay-offer-plan` | Business monthly › Cancel plan › reason | The stay step names Business's discounted months |
| `portal.billing.switch-yearly-plan` | Solo monthly, 2 paid invoices › Switch to yearly | The saving is Solo's |
| `portal.billing.comeback-plan` | Lapsed Firm, come-back open › Subscribe › Firm | The come-back line with Firm's first month |
| `portal.billing.change-plan-offer-ends` | Solo with the stay offer running › Change plan › Business | The preview says the offer ends; confirm |

Live (`portal-live`, Stripe sandbox, test clocks; waits on TD-347's sandbox seeding, which must now run `billing:plans`
for the coupons too): `billing.launch-business-yearly-israel` (₪ first year + VAT; renewal notice at clock + 11 months),
`billing.stay-firm-monthly`, `billing.comeback-solo-usd` (mail at day 30, Checkout with the coupon),
`billing.switch-business-yearly`, `billing.legacy-freelancer-stay` (AC5).

Each feature's `paths` cover `server/src/billing/offer*.ts`, `retention.ts`, `comeback*.ts`, `renewal-mail.ts`,
`scripts/stripe-plans.ts` and the portal hooks below. `release-qa lint` clean.

## 11. UI touch points (hooks for the portal billing lane, building MUT-705's picker and MUT-734's change pane now)

Please leave these seams so MUT-703's UI half is a few lines, not a rework:

1. **`data/billingPlans.ts`**: keep `BillingPlan` the generated type (it will gain `launch` and `comeback`), and route
   every plan price line through one function (`monthlyPriceOf` / `usePlanPrice`). MUT-703 adds a sibling
   `useOfferLine(plan, interval, country) → string | null` next to them.
2. **`BillingPlanPicker.tsx` `PlanRow`**: take an optional `offerNote?: (plan: BillingPlan) => string | null` (or build
   each option's `note` from a function the drawer passes), so a first-year line can sit under the limits line without
   touching `RadioCards`.
3. **`BillingDrawer.tsx` interval opening (≈ line 890)**: today `plansOnOffer(billing).length > 0 ? null :
   eligibleOfferOf(billing)`. Keep the opening decision in one place that takes the chosen plan
   (`openingIntervalOf(billing, plan)`), so MUT-703 makes it Yearly when that plan has an eligible launch.
4. **`BillingDrawer.tsx` ≈ lines 900–912**: `eligible = !plan ? eligibleOfferOf(billing) : null` and
   `offeredBack = plan ? null : comebackOfferOf(billing)`. Keep these two as the only offer reads and leave them
   plan-blind for now (one line each to change); don't add a third.
5. **The Checkout call** keeps sending `expectedOffer` whatever the plan, and the `OFFER_ENDED` banner path stays shared
   between the legacy and plan Subscribe steps.
6. **The change-plan pane (MUT-734 UI half)**: one optional line slot under the preview's amount, fed by the
   preview's `offerEnds` (null today).
7. **`OfferTopLine`** stays one line above the plan row; it shows when the launch is eligible on any plan.
8. **Cancel flow and switch step** (`useCancelFlow`, `useSwitchStep`): no change needed; their copy must not name
   "Freelancer" or a fixed plan.
9. i18n keys MUT-703 will add: `hosted.billing.plans.firstYear`, `hosted.billing.change.offerEnds.{stay,comeback}`.
   Copy minimal, ar first (`hosted.plan.name.*` already exist).

Phone: none (§3.8).

## 12. Rollout (for `docs/operations/before-release.md`, Switch rollout stage 1)

Add under "Stage 1 · Live first", replacing the MUT-703 bullet once built:

- **MUT-703 (API `1.16x.0-mut703`, ADR-<next>): offers on Solo, Business and Firm.** No migration (unless §8 applies).
  No new env. Before `plan_checkout = true` (Basel):
  1. The live restricted key adds **Write on Coupons** (it has Read).
  2. `STRIPE_SECRET_KEY=<rk_live_…> npm --prefix server run billing:plans` (dry run: the three new coupons), then
     `-- --apply --live`, then the dry run again must say nothing to do. The legacy coupons stay as they are.
  3. Release the API with `offers.json` naming the new coupon ids. Until step 2 is done the plans simply have no offer
     (warned), so the order of 2 and 3 doesn't matter, but both come before `plan_checkout`.
  4. Release the web with the picker's offer lines (MUT-705 + MUT-703 UI half).
  5. Check: `GET /v1/billing` for a never-subscribed account lists `plans[].launch` with the first-year amounts; a yearly
     Business Checkout in the sandbox-tested path reaches Stripe's page with the launch line; the renewal-mail dry run
     (`npm --prefix server run billing:renewal-mail`) counts plan subscriptions.
  6. Before the launch window ends (`<LAUNCH_REDEEM_BY>`): nothing to do; the coupon stops on its own. To end it early,
     list it in `RETIRED_COUPON_IDS` and run the script.

## 13. Questions only Basel can answer

Each with the recommended default. The ticket's proposals are the defaults where it made one.

1. **Offer amounts per plan and currency.** One percent for all three plans and both currencies (one coupon per kind),
   or different per plan? [Default: one percent per kind for all plans. Launch `<LAUNCH_PERCENT>` = 50% (ticket: Solo
   ₪195/$60, Business ₪445/$135, Firm ₪1,245/$375 first year); stay 50%; come-back about 2/3 off (ticket), so 67%,
   which on Solo is ₪39 → ₪12.87 and on Firm ₪249 → ₪82.17. Alternative: come-back as an amount, then six coupons.]
2. **Launch: yearly only, or monthly too?** [Default: yearly only, as ADR-237 and MUT-528's rule "monthly is
   discounted only through stay and come-back".]
3. **How long each offer lasts.** Launch window end (`redeem_by`), stay months, come-back months. [Default: launch ends
   with the live legacy coupon, last day 21 Feb 2027 (`redeem_by` 2027-02-22 00:59 Jerusalem); the launch discounts the
   first year only (`once`); stay 2 months; come-back the first month only (`once`).]
4. **Come-back on a yearly Checkout?** A percent coupon can't tell month from year (both prices share the product); the
   server decides. [Default: monthly only. 2/3 off a first year is far more than the ₪20 off a year the legacy coupon
   gave.]
5. **Who counts as "come-back".** Lapsed legacy Freelancer, Solo, Business, Firm? People who moved to Starter on
   purpose (MUT-734's "Move to Starter")? A Solo trial cancelled before paying? [Default: anyone whose paid plan (any of
   the four, Firm included, dropping today's `FIRM` refusal) ended after taking money, including a move to Starter,
   30+ days ago; never a trial that never paid. A legacy Freelancer lapser is offered Solo in the mail.]
6. **Launch eligibility.** Today: never had a subscription in any status. With the card-up-front Solo trial, someone who
   started the trial and cancelled before paying can't get the launch later. [Default: "never had a subscription that
   took money", so an unpaid trial doesn't use it up; a running Solo trial still can't switch into the launch (the
   yearly switch carries no discount).]
7. **Running discounts on a plan change.** Upgrade during a stay offer or a come-back month: drop it (ADR-291 d6) or
   refuse the change until it ends? Downgrade: keep it? And if spike S1 shows an over-credit after a launch year: cap it,
   refuse upgrades in the launch year, or accept it? [Default: drop on upgrade and say so in the preview; keep on a
   downgrade until its own end; if S1 over-credits, accept it for now (few people, and they pay more after) and log it
   as tech debt.]
8. **Do stay and come-back stack?** Today a stay offer in the last 12 months blocks the come-back; each is once per
   person ever. Keep, and across plans (one stay ever, whichever plan)? [Default: keep both rules as they are, per
   person, not per plan.]
9. **Promotion codes.** MUT-528 said automatic only, no codes. Still true now there are three plans (e.g. a code for an
   accountant's clients)? [Default: no codes.]
10. **Accountant-activated customers and pilot users.** ADR-300 d2 says an accountant's activation carries no offer.
    Should a pilot user (MUT-752 grant) or an accountant's customer buying for themselves later get the launch?
    [Default: activation no offer (as decided); pilot users and later self-purchases yes, by the normal rule.]
11. **Pause on the three plans** (same rule as today: monthly, once a year, 1–3 months)? [Default: yes; it comes with
    the same helper.]
12. **Legacy Freelancer launch and come-back coupons** after `PLAN_CHECKOUT` is on: the legacy Checkout path is only
    reachable from old portals. Leave them until the launch window ends, or retire them now? [Default: leave them; they
    expire or go unused, and the legacy stay coupon stays for ₪29 payers until MUT-707 moves them.]

## 14. Knowledge updates on build

ADR "Offers per plan" (amends ADR-237 d1/d3/d4, ADR-238 d2, ADR-240 d5/d7, ADR-243 d1/d8, ADR-291 d6; the catalog
script is the one place offer amounts and dates are written). CHANGELOG, SYSTEM_OVERVIEW §8 (billing), TEST_PLAN,
COMPONENT_REGISTRY (the picker's offer note), TECH_DEBT (S1 outcome if accepted), before-release stage 1 (§12),
`docs/operations` billing runbook (support reply for "why didn't I get the launch").

## Build decisions (server half, 2026-11-27)

API `1.210.0-mut703`, ADR-340. No migration. The §13 defaults as approved, with these specifics:

**Spikes (Stripe sandbox, test clocks, API `2026-09-30.endive`; own `spike_mut703_*` products, prices and coupons on ₪39/₪89 monthly, ₪390/₪890 yearly; the script `billing:plans` was not run):**

- **S1, proration after a spent `once` launch coupon:** Solo yearly at 50% off (first invoice ₪195), upgraded to Business yearly on day 30. The once coupon is already gone from the subscription (`discounts: []`). Stripe's credit line is "Unused time on Solo (with 50.0% off)": **−₪178.98**, i.e. 335/365 of the **₪195 actually paid**, not of the ₪390 list (which would be −₪357.95). Business's remaining time is charged at list (₪816.85), due ₪637.87. **No over-credit, so nothing to cap and no tech debt** (the §13 Q7 fallback "accept and log" isn't needed).
- **S1b, an upgrade during the stay offer:** Solo monthly with the plans' 50% stay coupon, upgraded to Business monthly on day 10. Without `discounts`, the coupon (it covers Business's product too) **follows** the person: Business's remaining time at 50% off, due ₪3.66. With `discounts: ''` on the preview (`invoices.createPreview`) and on `subscriptions.update`, the discount is gone, the preview and the invoice agree (₪33.33), no pending update. → **Upgrade: drop it in the same update, preview without it, `offerEnds` names it** (Q7 default).
- **S2, a scheduled downgrade and a running stay discount:** Business monthly with the stay coupon applied, then `scheduleDowngrade` as built for MUT-734 (`from_subscription`, then phases with no `discounts`). `from_subscription`'s phase 0 shows the coupon, but **the phases update drops it from the subscription at once** (`discounts: []`; the next invoice, Solo, ₪39 full). Carrying the subscription's own discount id (`{ discount: 'di_…' }`, not the coupon, which would start a fresh 2 months) into **both** phases keeps it: the next invoice is Solo at ₪19.50, and it ends on its own schedule (the following invoice ₪39, schedule released). → **Downgrade: carry the discount ids into both phases** (Q7 default "keep until its own end").
- S3 (percent come-back on a yearly Checkout / VAT line) not run: §13 Q4 makes the plans' come-back monthly only, and the launch's percent-on-a-VAT-line path is MUT-702's tested Checkout with `discounts` added (the pay-page note already says prices exclude VAT).

**Coupons (`COUPON_SPEC`):** `mtb3a_launch_yearly_plans_2026` "Launch offer · عرض الإطلاق" 50% once, `redeem_by` 2027-02-21T22:59:00Z (= 2027-02-22 00:59 Jerusalem); `mtb3a_stay_monthly_plans_50` "Stay offer · عرض البقاء" 50% repeating 2; `mtb3a_comeback_first_month_plans_67` "Welcome back · عرض العودة" 67% once. All `applies_to` = the three plans' products, `metadata.mtb3a_offer` = the kind. Offer ids `launch-plans-2026`, `stay-plans-2026`, `comeback-plans-2026` (the come-back `interval: "month"`). `RETIRED_COUPON_IDS` empty.

**Rules as built:**

1. Eligibility (Q6): a subscription "took money" unless `incomplete`/`incomplete_expired` or `canceled` with `ended_at ≤ trial_end`; a running trial counts. Stripe's own list now returns `trialEnd`/`endedAt` for this. Applies to the legacy launch too (one rule).
2. GET `/v1/billing` while `PLAN_CHECKOUT` is on: `offer` = the plans' launch priced on Solo; `plans[].launch` = `{ id, firstYear }` whenever the coupon makes an offer on that plan (eligibility stays person-level in `offer.eligible`); `plans[].comeback` only while the come-back is open to the person (its yearly pair null, monthly only); `comeback` = the lapsed plan's (legacy Freelancer → Solo), with `plan` and `percentOff`. Off: the legacy `offer` and `comeback` exactly as before.
3. Plan Checkout: launch on a yearly Checkout, else the come-back (monthly only, so a yearly Checkout of a come-back person is full price); none with `trial: true` or when actor ≠ payer (accountant activation; no coupon is even read). "Already had" any come-back id in Stripe's list → none.
4. `SCHEDULED` = the live subscription is on a Stripe schedule (`managedBySchedule`) while on a list price; the GET switch line also hides while the mirror holds a SCHEDULED plan change.
5. `offerEnds` names the first running coupon that is one of offers.json's; a discount that is none of ours is still dropped on an upgrade (logged), with `offerEnds: null`.
6. Come-back mail with `PLAN_CHECKOUT` on: one offer read per lapsed plan per run; the copy names the plan and leaves out the yearly sentence when there is no first year. `skipped.firm` stays in the summary at 0 (TD-372).
7. QA overrides (`BILLING_OFFER_COUPON_ID`, `BILLING_STAY_COUPON_ID`) now replace the coupon of every entry of their kind, keeping ids and plans; the come-back pair replaces only the legacy coupons (TD-372).

**For the portal lane (§11):** `plans[].launch.firstYear` for the first-year line (Yearly opens when the chosen plan has a launch and `offer.eligible`); `plans[].comeback.firstMonth`/`listMonth` for the come-back line on the chosen plan; keep sending `expectedOffer` (the plan offer's id: `launch-plans-2026` or `comeback-plans-2026`) and the shared OFFER_ENDED banner; the change pane's line from the preview's `offerEnds` (`kind` stay or comeback); `SCHEDULED` in the cancel and switch steps' refusal copy. Types are in `src/hosted/api/schema.d.ts` (`BillingPlanLaunch`, `BillingPlanComeback`).
