# MUT-525 — Launch offer: 50% off the first year of a yearly plan

> **Amended 2026-11-02 (pricing program MUT-528, D3):** the list price is now ₪29 / $9 a month, ₪290 / $90 a year (MUT-529, live), so the offer is **50% off the first year: ₪145 / $45**, then ₪290 / $90. Every amount and percentage below was updated from the 70%-off-₪490 draft (original kept as `mut-525-launch-offer-plan.before-50pct.md` in session c5735ca4's scratchpad). **Basel approved the copy deck on 2026-11-02**, so T14 is done. Still owed by Basel, not blocking the build: the live coupon's end date (set at release, 3 months), and counsel's read on a terms line for promotional first-year prices and on the 30-day renewal notice.

Epic MUT-322 · Story · Jira Backlog · planned 2026-10-30. Basel's product calls are in the ticket and in the memory note on MUT-525: first year only, anyone without a subscription yet, applied automatically, pilot founders untouched.

## 0. Neighbourhood

- **Builds on:**
  - MUT-362 (Checkout, `planCheckout`, `/v1/billing`; In Review).
  - MUT-418 (trial step and banner, `trialPrompt.ts`; Done).
  - MUT-419 (trial mails; Done).
  - MUT-361 (lapse gate). Nothing here changes it.
- **No blocker links.** The prose dependency is the live `freelancer_list_yearly_*` prices (pilot-runbook 3b). That's an operator step before launch, not before the build.
- **Overlap to avoid:**
  - MUT-365 (prices on the landing page) owns any public-site copy. This ticket stays in the signed-in portal and the trial mails.
  - MUT-363 (Firm tier): the coupon is restricted to the Freelancer product, so a later Firm price never inherits it.

## 1. Design decisions (recommendations; open ones marked ▲)

**D1. Stripe holds the campaign. The code names one coupon id.**
- A Stripe coupon `mtb3a_launch_yearly_2026` is the single source of truth: `percent_off: 50`, `duration: once`, `applies_to.products = [Freelancer]`, `redeem_by` = the campaign end.
- The server's offer exists only while that coupon exists and is `valid`.
- **Start:** the operator creates the coupon after the release.
- **End:** `redeem_by`.
- **End early:** delete the coupon in the dashboard. No deploy. Existing subscriptions keep their discount (Stripe's rule).
- This follows MUT-362's "amounts live in Stripe, never here" (lookup keys in code, amounts in Stripe). It needs no new table, no new operator-console screen and no env var.
- *Rejected:*
  - Env vars: changing one is a new Cloud Run revision, which is a deploy.
  - A DB setting plus operator UI: more code for one campaign.

**D2. Who's eligible: someone with no subscription, ever.**
- "Ever" means no row in the mirror and none in Stripe's own list for the customer, in any status.
- Pilot founders, and anyone who subscribed and cancelled, are out automatically. Trialists are in.
- An unpaid trialing subscription that was then cancelled also counts as "had one". That keeps the rule simple, and it can't be gamed by cancel-and-resubscribe.
- The rule is decided twice:
  - GET `/v1/billing` uses the mirror, to show the offer.
  - POST `checkout-session` uses mirror + Stripe (the `inStripe` list it already fetches), to attach the coupon.
- If the two disagree (the mirror is late), Checkout charges the full price. The drawer said otherwise, but this is rare and errs in our favour.

**D3. Yearly only.** A monthly Checkout never gets the coupon. `applies_to` also limits it to the Freelancer product. Yearly-only is enforced in our code, because Stripe can't restrict a coupon to an interval.

**D4. The server computes the first-year amount, the way Stripe does.**
- `discount = round(unitAmount × percent / 100)` and `firstYear = unitAmount − discount`, in minor units.
- ₪290 → ₪145 (49000 → 14700); $90 → $45 (16000 → 4800).
- `/v1/billing` sends `firstYear` per currency, so the portal, a future phone screen and the mails never do the arithmetic (ADR-004: money keeps its currency).

**D5. A spike before any code: does a `once` coupon survive a trial?**
- With `subscription_data.trial_end`, Stripe issues a ₪0 trial invoice first. If a `once` coupon is spent on that ₪0 invoice, trialists would pay the full price. That would break AC3.
- **Step 0 of the build** proves it in the sandbox (acct_1T9i5jC8SzNwSezn, a test clock):
  - (a) Checkout with a trial plus the coupon: is the first paid invoice ₪145?
  - (b) Without a trial: is the first invoice ₪145, and is the renewal 12 months later ₪290?
- **Fallback** if (a) fails: `duration: repeating`, `duration_in_months: 12`. The trial is at most 14 days, so the first paid invoice falls inside the 12 months and the renewal falls outside. Prove the same two cases.
- The coupon's spec in the runbook follows whichever passes.

**D6. The checkout path reads the coupon fresh. The read paths use a 10-minute cache.**
- GET `/v1/billing` and the mail run use the gateway's cache, like the catalog (`CATALOG_TTL_MS`).
- Checkout retrieves the coupon uncached: one extra Stripe call per Checkout. A coupon deleted inside the cache window would otherwise make `sessions.create` fail with `resource_missing`, which `viaStripe` turns into BILLING_ACCOUNT_NEEDS_HELP.
- A coupon that's gone or invalid at that moment means **full price, no error**.

**D7. ▲ The drawer opens on Yearly while the offer applies.** Otherwise it stays Monthly, as today. Recommendation: Yearly. The offer is the reason the page exists right now.

**D8. Mails carry percent and end date only, no amounts.**
- `trial-ending-soon`, `trial-ended` and `trial-locking-soon` gain one optional line: "Subscribe yearly before {date} and pay 50% less for your first year." In Arabic and English.
- The run resolves the offer once (cached coupon read) and adds the line only for people with no subscription ever.
- The job then needs no price lookup. The trial-mail route gains the `CheckoutGateway`, and it already requires Stripe to be configured.

**D9. The banner reads the drawer's query.**
- `TrialBanner` on Home shows the offer line when the trial banner shows and `billing.offer?.eligible`.
- It uses the same react-query key as the drawer (`/v1/billing`), and it's enabled only while a trial banner is showing. So non-trialists never make the call.
- *Rejected:* putting the offer on `/v1/me`. That would put a Stripe read on the hottest route.

**D10. Analytics: two new portal events.** Contract 2.4.0 → 2.5.0.
- `billing_offer_shown {offer, surface: 'drawer'|'banner'}`, once per page per surface.
- `billing_checkout_started {interval, currency, offer: string|null}` (no checkout event exists today).
- The server audit `billing.checkout_started` gains `offer` in its metadata.
- Stripe counts redemptions on the coupon itself.

**D11. The phone isn't touched.** `offer` is an additive field on `/v1/billing`. Verify the Flutter `BillingOverview` parser ignores unknown keys (one test on its fixture) and note it in the PR.

## 2. API contract

`GET /v1/billing` gains one field:

```jsonc
"offer": null | {
  "id": "launch-2026",          // stable campaign name, for analytics
  "percentOff": 70,
  "endsAt": "2027-01-31T21:59:59Z", // coupon redeem_by
  "interval": "year",
  "eligible": true,             // this person, by the mirror (D2)
  "firstYear": { "ILS": 14700, "USD": 4800 }   // null per currency when that price isn't sellable
}
```

`offer` is null in each of these cases:
- no Stripe on the server;
- the coupon is missing, invalid, past `redeem_by`, or not shaped as D1 says;
- a Stripe failure (logged as a warning, like `catalogOrNothing`).

`POST /v1/billing/checkout-session`: no request change. The response is unchanged. The coupon is attached server-side (`discounts: [{ coupon }]`, plus `subscription_data.metadata.mutaba3a_offer`). The openapi minor bumps; `openapi:check` regenerates.

## 3. Where the code goes

**Server**

| File | Change |
|---|---|
| `server/src/billing/offer.ts` **(new, pure)** | `LAUNCH_OFFER = { id, couponId }`. `offerFromCoupon(fact, now)` returns `Offer \| null` (shape checks from D1). `offerEligible(offer, subscriptions, interval)`. `firstYearOf(catalog, percent)` (D4). `offerView(...)` for the GET. |
| `server/src/billing/stripe/checkout-gateway.ts` | `couponById(id, { fresh })` returns `CouponFact \| null` (404 → null, `valid: false` → null), cached on the catalog's TTL and failure TTL. Expands `applies_to`. The restricted key gains **Read on Coupons** (runbook). |
| `server/src/billing/checkout.ts` | `CheckoutInput.offer: Offer \| null`. `paramsOf` adds `discounts` and offer metadata when the offer applies. The rest is unchanged. |
| `server/src/routes/billing.ts` | GET: `offer` via the cached read, `eligible` from `summary.subscriptions.length === 0`. POST: a fresh read, eligibility over mirror + `inStripe`, the offer in the audit metadata. |
| `server/src/schemas.ts` | `BillingOfferSchema` on `BillingOverviewSchema`. |
| `server/src/billing/trial-mail.ts`, `server/src/routes/trial-mail.ts`, app wiring | `offer` in the run options. The line is added per person (D8). |
| `server/src/email/templates/copy.ts` (+ `ports.ts` vars) | An optional `offer: { percentOff, endsAt }` on the three trial templates, en + ar. |

**Portal**

| File | Change |
|---|---|
| `src/hosted/data/billingOffer.ts` **(new, pure)** | `offerFor(billing, currency, interval)` returns `{ list, firstYear, endsAt, percentOff } \| null`. The drawer, PlanLines and the banner all read this one function. |
| `src/hosted/components/BillingDrawer.tsx` | SubscribeBody: the yearly segment label becomes "Yearly · 50% off the first year" in place of "N months free". The summary shows `<s>₪290</s> ₪145 first year`, then a fine-print line "then ₪290/year · offer ends {date}". D7 sets the default interval. PlanLines: one offer line. |
| `src/hosted/components/TrialBanner*` | The offer line (D9). |
| `src/hosted/i18n` ar + en | `hosted.billing.offer.*` keys. Amounts through `<Amount>` and `<bdi>` (ADR-101). |
| `src/hosted/analytics` + `docs/analytics/events.json` | D10. |

**Docs and QA**
- ADR-234 (D1, D2, D5's result).
- `pilot-runbook.md`:
  - create the coupon (the exact fields from the D5 result);
  - add Read on Coupons to the key;
  - end the campaign early by deleting the coupon;
  - count redemptions in the dashboard.
- `before-release.md`: the live coupon and its end date (Basel sets it).
- CHANGELOG, TEST_PLAN, COMPONENT_REGISTRY (`billingOffer`).
- `qa/support/billing-live.mjs --catalog-only` also creates the sandbox coupon.

## 4. Tests first (TDD)

- **`offer.test.ts`:**
  - a valid coupon gives an offer;
  - each of these gives null: missing, `valid:false`, past `redeem_by`, `amount_off` instead of `percent_off`, wrong duration, not restricted to Freelancer;
  - eligibility: yearly with no subs → yes; monthly → no; a `canceled` sub → no; `trialing` → no;
  - `firstYearOf`: 49000 → 14700, 16000 → 4800, an odd amount (e.g. 4999) matches Stripe's half-up rounding, and a null currency stays null.
- **`checkout.test.ts`:**
  - an offer plus yearly adds `discounts` and the metadata, and keeps `trial_end`;
  - monthly or no offer gives byte-identical params to today.
- **Checkout gateway test:** `couponById` hits, 404s, the TTL, `fresh` bypassing the cache, and a cached failure.
- **Billing route tests:**
  - GET `offer`: null when not configured, when the coupon is gone, or on a Stripe failure;
  - `eligible:false` with a mirrored sub;
  - POST: no coupon when Stripe lists a sub the mirror lacks;
  - a coupon deleted between GET and POST means full price and a 200;
  - the audit carries `offer`.
- **Trial mail tests:**
  - the line appears for an eligible person with an active offer;
  - it's absent with no offer, or when the person had a sub;
  - template snapshots, en/ar.
- **Portal:**
  - `billingOffer.test.ts`;
  - BillingDrawer: struck-through list price, first-year amount, end date, Yearly by default (D7), Monthly with no offer copy, no offer leaves today's view;
  - TrialBanner with and without the offer;
  - RTL: amounts in `<bdi>`.
- **Release-QA**, `qa/features/portal-live/billing.yaml` with specs in `qa/specs/portal-live/billing.spec.ts`. Each is one tagged test with steps:
  - `launch-offer-yearly`: a trialist picks Yearly and sees ₪290 → ₪145; Stripe's page shows the discount; paying through the API gives a ₪145 first invoice.
  - `launch-offer-monthly`: Monthly shows no offer and Stripe shows the full price.
  - `launch-offer-ended`: the harness deletes the coupon; the drawer and banner show no offer; Checkout is at full price. The harness restores the coupon afterwards.
  - `launch-offer-trial-carry`: more than 48 h of trial left; the trial carries over and the first paid invoice is discounted (the D5 proof, recorded).
- **Commands**, through `~/Work/tools/heavy-gate/heavy`, under Node 22:
  - `npm run lint`, `typecheck`, `test:run`, `build`;
  - `npm --prefix server run typecheck|lint|openapi:check|test`;
  - `release-qa run --attach --only <id>` for each new feature;
  - `release-qa lint`.

## 5. Build order

0. **D5 spike** in the sandbox (a script under `qa/support/`, not shipped). Record the result in ADR-234 and pick `once` or `repeating`.
1. `offer.ts` and its tests.
2. Gateway `couponById`.
3. `checkout.ts` params.
4. Routes and schema, with `openapi:check`.
5. Trial mails and templates.
6. Portal view model, then the drawer, then the banner, then i18n.
7. Analytics contract.
8. Live QA specs.
9. Docs, runbook, ADR.

## 6. Quality bar

- **DRY:** one pure `offer.ts` on the server and one `billingOffer.ts` in the portal. The mails reuse the run's single offer read. No second price lookup anywhere.
- **Testable:** every decision is a pure function. Stripe stays behind `CheckoutGateway`, which tests fake.
- **Scale and cost:**
  - one coupon read per instance per 10 minutes;
  - one fresh read per Checkout;
  - the banner's `/v1/billing` call only for trialists;
  - no new table, migration or index.
- **Constraints:**
  - Arabic first with RTL, and `<bdi>` amounts;
  - money with its currency;
  - drawer-first (no new page);
  - DESIGN.md roles: offer copy in `--text` (medium at most), never mint (design DD9b);
  - "Prices exclude VAT" stays (the discount applies before VAT, as Stripe Tax computes it);
  - **terms:** Basel confirms the terms cover a first-period discount (MUT-324 text).

## 7. Open for Basel

- ▲ D7: default to Yearly while the offer applies?
- The campaign's end date, for the live coupon's `redeem_by` (set at launch).
- Whether the terms text needs a line on promotional first-period prices.

Business / product impact
- A trialist sees and pays ₪145 / $45 for year one without typing a code, which pulls yearly commitments forward while self-service signups start.
- Sits in MUT-322 after MUT-362/418/419. It needs no new infrastructure, only the live yearly prices and one Stripe coupon.
- Risk is bounded: first year only, Freelancer-yearly only, and ending it early takes one dashboard delete. The renewal jump (₪145 → ₪290) in about November 2027 is the retention risk to plan for later.

---

# Eng review (/plan-eng-review, 2026-10-30)

Target: `.claude/designs/mut-525-launch-offer-plan.md` (this file; §0–§7 above are the original plan, unchanged).

## Scope record

feature answers: none proposed (trial mails and banner are ticket ACs); structure: A Original arrangement (D1, answered 2026-10-30); accepted scope: the plan as written, `offer.ts` + `billingOffer.ts` as separate pure modules; pending remedies: R1–R4 (below).

Scope Challenge result: scope accepted as-is.

### Reality rows

| premise | claim | receipt | verdict |
|---|---|---|---|
| Checkout params are built in one pure function | `paramsOf` builds every Checkout param | server/src/billing/checkout.ts:188 | true |
| The route already lists Stripe's own subscriptions before paying | `const inStripe = await checkout.subscriptionsOf(customer)` | server/src/routes/billing.ts:166 | true |
| The catalog is cached 10 min per instance | `CATALOG_TTL_MS = 10 * 60 * 1000` | server/src/billing/stripe/checkout-gateway.ts:54 | true |
| The trial-mail routes have no Stripe gateway today | `billingConfigured: boolean` only | server/src/routes/trial-mail.ts:24 | true |
| No coupon/discount code exists yet | grep `coupon|discounts` in server/src/billing, routes/billing.ts, src/hosted: no hits | (grep, 2026-10-30) | true |
| A `once` coupon discounts the first *paid* invoice after a trial | Stripe docs say "first invoice"; trial interaction not documented | docs.stripe.com/billing/subscriptions/coupons | unverified |
| GA yearly list prices are ₪290 / $90 | sandbox lookup keys moved by MUT-418 | memory mut-418-trial-start-state | true in sandbox; live unverified |
| The drawer's interval starts at Monthly before billing loads | `useState<'month' | 'year'>('month')` in `useSubscribeForm(billing.data)`, called at drawer mount | src/hosted/components/BillingDrawer.tsx:484, :75 | true |

unverified=2

REALITY: premise-table finding 2 unverified premises (trial×once coupon, live prices) server/src/billing/checkout.ts:188
REALITY: already-done pass no coupon/discount code on main (git log + grep 2026-10-30) server/src/billing/checkout.ts:1
REALITY: surface-check pass GET /v1/billing and POST /v1/billing/checkout-session exist server/src/routes/billing.ts:84
REALITY: binding-decisions pass MUT-362 D2 "one widened restricted key": adding Read on Coupons widens the same key, consistent server/src/billing/stripe/checkout-gateway.ts:9
REALITY: numbers pass 49000×0.30=14700, 16000×0.30=4800 [measured: arithmetic]; list prices [re-measure before gate: live Stripe] .claude/designs/mut-525-launch-offer-plan.md:26
REALITY: deferred-asks pass every MUT-525 AC maps to plan §1–§4; phone copy and landing are out of scope in the ticket itself .claude/designs/mut-525-launch-offer-plan.md:9
REALITY: pr-count pass no .gstack/ship-policy.json: one branch, one merge .claude/designs/mut-525-launch-offer-plan.md:150

### Scope Challenge findings

1. [CRITICAL] (confidence: 8/10) server/src/billing/checkout.ts:209 `subscription_data: { metadata: …, ...trialCarriedOver(input) }`: the plan's D5 spike may show neither `once` nor `repeating` discounts the first paid invoice after a trial. The plan has no stop rule for that outcome → R2.
2. [CRITICAL] (confidence: 9/10) server/src/schemas.ts:429 `export const BillingOverviewSchema = z`: the plan's `BillingOfferSchema` must not be a registered component made `.nullable()`. That makes the shared component itself nullable (prior learning applied: zod-openapi-nullable-named-component, confidence 9/10, from 2026-10-27). **Factual correction, no behaviour change:** keep `BillingOfferSchema` un-registered, or register it and declare the field as `z.union([BillingOfferSchema, z.null()])`. Recorded; no question needed.

## Decision ledger

### R1: The offer's end for new Checkouts vs the 1-hour Checkout window
Finding: 3, CRITICAL, confidence 6/10, server/src/billing/checkout.ts:44 `export const CHECKOUT_SESSION_TTL_SECONDS = 60 * 60;` (Section 1, Architecture; native reviewer)
Plan baseline: original proposal: the offer ends at the coupon's `redeem_by`; a Checkout made before it carries the coupon (§1 D1, D6).
Runtime evidence: unknown whether Stripe re-checks `redeem_by` when a Checkout opened before it is paid after it (not documented; to be proven in the D5 spike).
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R1 last moment a Checkout gets the coupon | `redeem_by` | `redeem_by − 1 h` (the session TTL); `endsAt` shown = that moment | `redeem_by` unchanged |
| R2 spike stop rule | pending | pending | pending |
| R3 regression contract | pending | pending | pending |
| R4 D7 default Yearly | pending | pending | pending |
Question D2:
D2 — When does a new Checkout stop getting the discount?
Project/branch/task: MUT-525 launch offer plan, on main, planning only.
ELI10: A Stripe Checkout page stays payable for an hour (checkout.ts:44). If someone opens it at 23:30 on the last day, the coupon expires at midnight, and they pay at 00:10, Stripe may refuse the coupon on its own page. That breaks the last-minute buyers, who are the most motivated ones. Ending the offer one hour early for new Checkouts, and showing that earlier time as the end, means every discounted page can always be paid.
Stakes if we pick wrong: last-hour buyers see an error on Stripe's page (English only, no Arabic) and support gets the email.
Recommendation: A because it costs one comparison and removes a failure we can't test cheaply.
Completeness: A=10/10, B=7/10
Pros / cons:
A) Stop 1 h before redeem_by (recommended)
  ✅ Every Checkout made with the coupon can still be paid within its hour, whatever Stripe does at redeem_by
  ✅ The drawer, banner and mails all show the same end time, the one the server enforces
  ❌ The advertised end is one hour before the coupon's own redeem_by, so the runbook must say so
B) Keep redeem_by as the end
  ✅ The shown end equals the coupon's date in the Stripe dashboard exactly
  ✅ No extra rule to explain in the runbook
  ❌ Behaviour in the last hour depends on Stripe internals we haven't verified; possible errors on Stripe's English-only page
Net: one hour of offer traded for a last day with no possible Stripe-side failures.
Header: Offer end
Options:
A) Stop 1 h early (Recommended)
New Checkouts carry the coupon only while now + CHECKOUT_SESSION_TTL < redeem_by; /v1/billing `endsAt`, the drawer, banner and mails show redeem_by − 1 h. One test row in offer.test.ts. human: ~30 min / CC: ~5 min.
B) Keep redeem_by
The offer ends at redeem_by as planned. No extra code; the last hour's behaviour stays unverified.

State: approved
Actual answer: A) Stop 1 h early (Recommended), D2 answered 2026-10-30
Accepted scope: offer.ts treats the offer as active for new Checkouts only while now + CHECKOUT_SESSION_TTL_SECONDS < redeem_by; `endsAt` on /v1/billing, the drawer, banner and mails = redeem_by − 1 h; one offer.test.ts row at the boundary; the runbook states the one-hour rule.
History: none

### R2: Stop rule if the D5 spike fails
Finding: 1, CRITICAL, confidence 8/10, server/src/billing/checkout.ts:209 `subscription_data: { metadata: { mutaba3a_user_id: input.userId }, ...trialCarriedOver(input) }` (Scope Challenge; native reviewer; web search found no Stripe doc on trial × `once` coupon)
Plan baseline: original proposal: spike `once`, else `repeating` 12 months; no rule if both fail (§1 D5).
Runtime evidence: unknown; Stripe docs only say a `once` coupon "applies to the first invoice" (docs.stripe.com/billing/subscriptions/coupons).
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R1 offer end | approved: redeem_by − 1 h (D2) | redeem_by − 1 h | redeem_by − 1 h |
| R2 if both coupon shapes fail with a trial | unspecified | build stops after the spike; Basel picks a remedy with the spike's evidence | pre-approved: an offer Checkout drops the trial carry-over, so the discounted charge happens at Checkout |
| R3 regression contract | pending | pending | pending |
| R4 D7 default Yearly | pending | pending | pending |
Question D3:
D3 — What happens if Stripe spends the discount on the free-trial invoice?
Project/branch/task: MUT-525 launch offer plan, on main, planning only.
ELI10: When someone subscribes during their free trial, Stripe first makes a zero-amount invoice for the rest of the trial. If the one-time coupon is used up on that zero invoice, trialists would pay full price, the exact people the offer is for. Step 0 of the build tests this in the Stripe sandbox with two coupon shapes. This question is what to do if both fail.
Stakes if we pick wrong: we ship an offer that silently charges trialists ₪290 instead of ₪145.
Recommendation: A because the fix depends on what the spike actually shows, and a pre-chosen fallback changes the trial promise Basel made (MUT-362 R-D2).
Note: options differ in kind, not coverage — no completeness score.
Pros / cons:
A) Stop and decide with evidence (recommended)
  ✅ Nothing is built on a coupon shape that is proven wrong; the spike's invoices are the evidence for the next call
  ✅ Keeps MUT-362 R-D2 (the trial carries into the subscription) unless Basel chooses to change it
  ❌ The build may pause for a day while Basel decides between the remedies the spike leaves open
B) Pre-approve: no trial carry for offer takers
  ✅ The build never pauses; the discounted first charge happens at Checkout, which a once coupon handles
  ✅ Simple to explain: take the offer, pay ₪145 today
  ❌ Trialists who take the offer lose their remaining free days, which reverses R-D2 for them and may read as a penalty
Net: a possible one-day pause versus pre-deciding to take free days away from the people we most want to convert.
Header: Spike fails
Options:
A) Stop and decide (Recommended)
If neither `once` nor `repeating` discounts the first paid invoice after a trial in the sandbox, the build stops after step 0 and the spike's invoices go to Basel with the remaining options. No product code is written first. human: 0 / CC: 0 unless it fails.
B) Drop trial carry for offers
Pre-approved fallback: when the offer is attached, Checkout omits trial_end, so the discounted charge is taken at Checkout. Trialists taking the offer lose their remaining free days. human: ~1 h / CC: ~10 min.

State: approved
Actual answer: A) Stop and decide (Recommended), D3 answered 2026-10-30
Accepted scope: Build step 0 is a gate. If neither `once` nor `repeating` (12 months) discounts the first paid invoice after a carried trial in the sandbox, /eng-build stops before product code and brings the spike's invoices to Basel. MUT-362 R-D2 (trial carry-over) is unchanged.
History: none

### R4: The drawer's default interval while the offer applies (plan D7)
Finding: 4, INFORMATIONAL, confidence 9/10, src/hosted/components/BillingDrawer.tsx:484 `const [interval, setBillingInterval] = useState<'month' | 'year'>('month');`. `useSubscribeForm(billing.data)` runs at drawer mount (:75), before billing loads, so a "default Yearly" can't be an initial state. Resetting it in an effect trips react-hooks v7 set-state-in-effect (memory: feedback-react-hooks-v7-set-state-in-effect). (Section 2, Code quality; native reviewer)
Plan baseline: original proposal, open ▲: D7 "the drawer opens on Yearly while the offer applies".
Runtime evidence: the interval starts at 'month' and only the person's tap changes it (BillingDrawer.tsx:484, :616).
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R1 offer end | approved (D2) | unchanged | unchanged |
| R2 spike stop rule | approved (D3) | unchanged | unchanged |
| R4 default interval | Monthly | Yearly while `offer.eligible`, else Monthly; derived as `chosen ?? (eligible ? 'year' : 'month')`, no effect; Continue sends the derived value | Monthly always; the offer shows on the Yearly option's label |
| R3 regression contract | pending | pending | pending |
Question D4:
D4 — Should the Subscribe step open on Yearly while the launch offer applies?
Project/branch/task: MUT-525 launch offer plan, on main, planning only.
ELI10: Today the Subscribe step opens on Monthly. While the 50% offer runs, the plan suggests opening on Yearly, so people see ₪145 for the year first. The code can't simply start at Yearly because the prices load after the drawer opens; it has to work out "Yearly unless you picked otherwise" each time it draws. The person can always switch.
Stakes if we pick wrong: on Monthly, many people never notice the offer they signed up for; on Yearly, someone who wanted Monthly has to tap once.
Recommendation: A because the offer is the reason this screen matters for the next three months, and one tap undoes it.
Note: options differ in kind, not coverage — no completeness score.
Pros / cons:
A) Open on Yearly while eligible (recommended)
  ✅ The first price a trialist sees is the discounted year, the conversion the campaign exists for
  ✅ Derived from the offer, so it goes back to Monthly by itself when the offer ends, with no cleanup release
  ❌ Someone who wants Monthly taps once more, and the release-QA monthly flow must switch explicitly
B) Keep Monthly as the default
  ✅ The Subscribe step behaves exactly as today for everyone
  ✅ No derived-state code, and no change to the existing QA flows
  ❌ The offer is visible only as the Yearly option's label, so fewer people see ₪290 → ₪145
Net: one extra tap for monthly buyers against putting the offer in front of every eligible person.
Header: Default plan
Options:
A) Yearly while eligible (Recommended)
The interval is `chosen ?? (billing.offer?.eligible ? 'year' : 'month')`, computed while drawing (no effect), and Continue sends that value. Tests: opens on Yearly with an eligible offer, Monthly without, and a person's pick sticks. human: ~1 h / CC: ~10 min.
B) Monthly as today
No default change. The offer shows on the Yearly option and in the summary once Yearly is picked.

State: approved
Actual answer: A) Yearly while eligible (Recommended), D4 answered 2026-10-30 (closes plan D7 ▲)
Accepted scope: `useSubscribeForm` keeps `chosen: 'month' | 'year' | null` (null until the person taps) and derives `interval = chosen ?? (billing?.offer?.eligible ? 'year' : 'month')` while rendering, with no effect; submit sends the derived value. BillingDrawer tests: Yearly with an eligible offer, Monthly without, the person's pick sticks across a billing refetch.
History: superseded in mechanism by design DD5 (D7, 2026-10-30): the default is decided once on first data, not on every render; the outcome (Yearly while eligible) is unchanged.

### R5: Where the portal's offer view model lives (reopens part of D1)
Finding: 5, INFORMATIONAL, confidence 9/10, src/hosted/data/billingView.ts:154 `export function yearlySavingOf(pair: { month: number; year: number }): YearlySaving | null {`. The portal already has a pure billing view-model module holding `yearlySavingOf`, `firstChargeOf`, `isSellable` and `billingViewOf`, with tests in `src/hosted/data/__tests__/billingView.test.ts`. The plan's new `src/hosted/data/billingOffer.ts` would sit beside it with the same kind of function. (Section 2, Code quality, reuse ladder rung 1; native reviewer)
Plan baseline: D1 answered A (Original arrangement, 2026-10-30): server `offer.ts` new, portal `billingOffer.ts` new.
Runtime evidence: billingView.ts is 158 lines; the drawer imports `yearlySavingOf` from it (BillingDrawer.tsx:22).
Reason for reopening: new evidence (an existing module is the natural home), found after D1. The server half of D1 (`offer.ts`) is not reopened.
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| D1 server `offer.ts` | approved (D1) | unchanged | unchanged |
| R5 portal offer view model | new `billingOffer.ts` (D1) | `offerFor()` added to `billingView.ts`, tests added to `billingView.test.ts` | new `billingOffer.ts` + its own test file (as D1) |
| R1, R2, R4 | approved | unchanged | unchanged |
| R3 regression contract | pending | pending | pending |
Question D5:
D5 — Should the portal's offer helper go in the existing billingView.ts instead of a new file?
Project/branch/task: MUT-525 launch offer plan, on main, planning only.
ELI10: After you picked the original arrangement, I found that the portal already has one file for "how billing looks" maths: `billingView.ts`. The "2 months free" label already comes from it. The offer helper (list price, first-year price, end date) is the same kind of thing. Putting it there means one place to look and one test file. The server's new `offer.ts` stays as you approved.
Stakes if we pick wrong: a second view-model file splits the billing display rules in two, and the next person changes one and misses the other.
Recommendation: A because the existing module already owns the yearly label this helper replaces during the offer.
Note: options differ in kind, not coverage — no completeness score.
Pros / cons:
A) Add to billingView.ts (recommended)
  ✅ The yearly-label rule (savings vs offer) lives in one function, in the file the drawer already imports
  ✅ One fewer new file; the tests join billingView.test.ts's existing fixtures
  ❌ billingView.ts grows from 158 to about 190 lines
B) Keep a new billingOffer.ts
  ✅ The offer code can be deleted as one file when the campaign machinery is retired
  ✅ Matches the arrangement as first approved in D1
  ❌ Two portal files decide what the Yearly option says; easy to update one and not the other
Net: one fewer file and one home for billing display rules, against easy deletion later.
Header: Portal helper
Options:
A) Add to billingView.ts (Recommended)
`offerFor(billing, currency)` goes into src/hosted/data/billingView.ts beside `yearlySavingOf`, tested in billingView.test.ts. The drawer, PlanLines and TrialBanner import it from there. Same effort as the plan.
B) New billingOffer.ts
Keep D1 as answered: a new src/hosted/data/billingOffer.ts with its own test file. Same effort.

State: approved
Actual answer: A) Add to billingView.ts (Recommended), D5 answered 2026-10-30
Accepted scope: no new portal file; `offerFor(billing, currency)` lives in src/hosted/data/billingView.ts and is tested in src/hosted/data/__tests__/billingView.test.ts; the Yearly label picks the offer over `yearlySavingOf` while the offer applies. The server `offer.ts` (D1) is unchanged.
History: D1 approved "Original arrangement" including billingOffer.ts (2026-10-30); reopened for the portal half only, for the evidence above.

### R3: Regression contract for existing billing behaviour
Finding: 6, CRITICAL, confidence 9/10, qa/specs/portal-live/billing.spec.ts:71 `await drawer.getByRole('radio', { name: 'Yearly · 2 months free' }).click();` and :80 `await payCheckoutByApi(page, person, 'freelancer_list_yearly_usd');`. Once the sandbox holds the launch coupon, every new test person is eligible: this label changes, the payment is discounted, and `trial-start` (:207) opens on Yearly (D4). Existing unit coverage of Checkout params (server/src/billing/__tests__/checkout.test.ts), GET /v1/billing (server/src/__tests__/billing-routes.test.ts), the trial mails (server/src/billing/__tests__/trial-mail.test.ts) and the drawer (src/hosted/components/__tests__/BillingDrawer.test.tsx) asserts today's shapes; the plan doesn't say which must stay identical when there is no offer. (Section 3, Test review, iron rule; native reviewer)
Plan baseline: original proposal: "monthly or no offer gives byte-identical params to today" (§4); nothing for the GET, mails, drawer or the live suite.
Runtime evidence: the 17 live billing flows pass on main today without any coupon (memory mut-418-trial-start-state).
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R1, R2, R4, R5 | approved | unchanged | unchanged |
| R3 Checkout params with no offer | plan: byte-identical | byte-identical (checkout.test.ts) | byte-identical (checkout.test.ts) |
| R3 GET /v1/billing with no offer | unspecified | every existing field unchanged, `offer: null` (billing-routes.test.ts) | not asserted |
| R3 trial mails with no offer | unspecified | the three templates render exactly as today, en + ar (trial-mail/templates tests) | not asserted |
| R3 drawer with no offer | unspecified | opens on Monthly, "2 months free" label, today's summary (BillingDrawer.test.tsx) | not asserted |
| R3 live suite | unspecified | the harness keeps the sandbox coupon absent by default; only the offer specs create it (and delete it after), so the 17 existing flows run unchanged | not addressed |
Question D6:
D6 — Which of today's billing behaviours must provably stay the same when there's no offer?
Project/branch/task: MUT-525 launch offer plan, on main, planning only.
ELI10: The offer touches Checkout, the billing read, the trial mails and the drawer. Outside the campaign (before launch, after it ends, or for people who already paid), all four must behave exactly as today. The plan only promised that for Checkout. Also, the live Stripe tests would start seeing the coupon and fail on a changed label, unless the test harness keeps the coupon away from them.
Stakes if we pick wrong: the day the campaign ends, a broken mail or drawer state ships unnoticed, or the 17 live billing flows go red for a reason unrelated to a bug.
Recommendation: A because each assertion is one extra test row on an existing test, and the live-suite rule keeps the recorded flows meaningful.
Completeness: A=10/10, B=6/10
Pros / cons:
A) Full no-offer contract (recommended)
  ✅ Four surfaces are pinned to today's output when there is no offer, so the campaign's end is a tested state
  ✅ The existing live flows keep passing untouched, and the offer specs own the coupon's lifecycle
  ❌ The offer specs must run serially (the coupon is shared sandbox state), adding a minute to a live run
B) Checkout params only (as planned)
  ✅ Smallest test diff; Stripe charges are the most expensive thing to get wrong
  ✅ Nothing changes in the live harness
  ❌ The GET, mails and drawer could change for non-eligible people unnoticed; the live suite breaks once the sandbox coupon exists
Net: a handful of table rows and one harness rule, against an untested campaign end and a red live suite.
Header: No-offer tests
Options:
A) Full no-offer contract (Recommended)
With no offer: Checkout params byte-identical (checkout.test.ts); GET /v1/billing existing fields unchanged plus `offer: null` (billing-routes.test.ts); the three trial mails render as today in en and ar (trial-mail tests); the drawer opens Monthly with "2 months free" (BillingDrawer.test.tsx). billing-live.mjs leaves the coupon absent by default; the offer specs create it and delete it, serially. human: ~3 h / CC: ~20 min.
B) Checkout params only
Keep the plan's single regression assertion (Checkout params byte-identical without an offer). Nothing else is pinned and the live harness is unchanged. human: ~30 min / CC: ~5 min.

State: approved
Actual answer: A) Full no-offer contract (Recommended), D6 answered 2026-10-30
Accepted scope: with no offer, (1) Checkout params byte-identical (checkout.test.ts); (2) GET /v1/billing keeps every existing field and adds `offer: null` (billing-routes.test.ts); (3) the three trial mails render exactly as today in en and ar (trial-mail tests); (4) the drawer opens on Monthly with "2 months free" and today's summary (BillingDrawer.test.tsx). qa/support/billing-live.mjs keeps the sandbox coupon absent by default; the launch-offer specs create it before and delete it after, and run serially.
History: none

## Outside voice (Claude Plan subagent, native fallback; Codex CLI not installed)

Completed in 241 s, inside the five-minute timer. These are the reviewer's findings, checked against the code by the parent reviewer:

- OV-1 Critical: the coupon cache is shared across one QA API process (qa/support/billing-live.mjs:25 `export const API_PORT = 8790;`) and the coupon is shared sandbox state, so R3's live rule can't hold as written → R6.
- OV-2 High: a non-404 coupon-read error (`StripePermissionError` before the key is widened) inside `viaStripe` becomes 409 BILLING_ACCOUNT_NEEDS_HELP for every Checkout (server/src/routes/billing.ts `PERMANENT_STRIPE_ERRORS`) → R7.
- OV-3 High: Arabic buyers never see "then ₪290/year" on Stripe's page (server/src/billing/checkout.ts:45 `export const CHECKOUT_SUBMIT_MESSAGE = [`); the renewal notice may be a legal duty → R8 and TODO-1.
- OV-4 Medium: the POST builds `plan.params` before `inStripe` is known, and `PriceFact` carries no product id for the "restricted to Freelancer" check → **factual correction, recorded below**.
- OV-5 Medium: an unlinked pilot customer would look eligible → R9 (small fixes).
- OV-6 Medium: a coupon without `redeem_by` must give `offer: null` → **factual correction** (the approved contract has a non-null `endsAt`).
- OV-7 Low: §4 says the harness "restores the coupon afterwards", which contradicts R3; the D5 spike must use its own coupon id → **factual correction**.
- OV-8 Low: `skipReason` (server/src/billing/trial-mail.ts:148) already skips STRIPE payers, so the per-person "no subscription ever" read in the mail run adds little → R9.
- OV-9 Low: trialists who added a card before launch (`trialing`) are refused by D2, and support will hear about it → R9.
- OV-10 Low: no retirement of the campaign code; the POST makes a fresh coupon read even for Monthly → R9.

### Factual corrections (no behaviour change; necessary work for approved contracts)
- **OV-4:** in the POST, `planCheckout` moves inside the `viaStripe` callback after `subscriptionsOf`. Otherwise the offer is decided first and the discount added afterwards; either way, eligibility uses mirror + `inStripe` (plan D2). `PriceFact` gains `productId` from the already-expanded `price.product`. The Freelancer product id for the coupon's `applies_to` check comes from the catalog.
- **OV-6:** `offerFromCoupon` returns null when `redeem_by` is missing. Add a row to offer.test.ts. The runbook notes that `max_redemptions` reached → `valid:false` → no offer.
- **OV-7:** §4's `launch-offer-ended` reads "the harness deletes the coupon; nothing restores it (absent is the default, R3)". The D5 spike script uses its own throwaway coupon id and deletes it.

Cross-model tension: the native review and the outside voice agree on the D5 trial risk and the regression risk. The outside voice found OV-1, OV-2 and OV-3, which the native sections missed.

### R6: QA isolation for the coupon (OV-1)
Finding: OV-1, CRITICAL, confidence 9/10, qa/support/billing-live.mjs:25 `export const API_PORT = 8790;` (one API for the whole live run) and the plan's "cached on the catalog's TTL" (§3) (outside voice, verified by parent)
Plan baseline: R3 approved (D6): the coupon is absent by default; the offer specs create and delete it, serially.
Runtime evidence: one API process per live run (billing-live.mjs:14, :191); other sessions' dev APIs use the same sandbox (:17).
Comparison grid:
| Choice | Current | A | B | C | D |
|---|---|---|---|---|---|
| R6 coupon cache in QA | 10 min (plan) | TTL injectable via `CheckoutGatewayOptions`; the harness sets 0 | 10 min | investigate first | deferred, unresolved |
| R6 coupon id in QA | fixed `mtb3a_launch_yearly_2026` | non-production override `BILLING_OFFER_COUPON_ID` (refused at boot when `API_KEY_ENVIRONMENT=live`); each run makes its own id | fixed | — | — |
| R1–R5 | approved | unchanged | unchanged | unchanged | unchanged |
Question D7:
D7 — How do the live Stripe tests stop the shared coupon from leaking between tests and sessions?
Project/branch/task: MUT-525 launch offer plan, on main, planning only.
ELI10: The live tests run one API for the whole run, and the plan caches the coupon for 10 minutes. So when a test creates or deletes the coupon, the API keeps answering the old way for up to 10 minutes, and the next test sees the wrong thing. The Stripe sandbox is also shared with other sessions, so one run's coupon shows up in another's. Making the cache time configurable (zero in tests) and letting non-production servers use a different coupon name per run fixes both. Production keeps the fixed name and the 10-minute cache.
Stakes if we pick wrong: R3's promise (existing flows unchanged) fails at random, and runs in other sessions flip between offer and no offer.
Recommendation: A because both knobs are test-only, production behaviour is identical, and without them the approved R3 contract can't hold.
Completeness: A=10/10, B=4/10, C=5/10, D=3/10
Pros / cons:
A) Apply: injectable TTL + test coupon id (recommended)
  ✅ Each live run owns its coupon, so other sessions and earlier tests can't see it, and creating or deleting it shows at once
  ✅ Production is untouched: the fixed id and the 10-minute cache stay, and a live server refuses the override at boot
  ❌ One more config field (non-production only) and one more gateway option to test
B) Keep the plan as is
  ✅ No new configuration surface at all
  ✅ Simplest code
  ❌ The live offer specs and the existing flows go red at random; sessions sharing the sandbox interfere
C) Investigate before choosing
  ✅ Could find a harness-only trick, such as restarting the API between specs
  ✅ No code decided yet
  ❌ R3 stays unenforceable until it's answered, and the likely answer is A anyway
D) Defer this proposed change only
  ✅ The build can start on the other steps
  ✅ Nothing changes now
  ❌ The live QA step (build step 8) is blocked later on the same question
Net: two test-only knobs make an approved promise actually hold.
Header: QA isolation
Options:
A) Apply (Recommended)
`couponById` cache TTL comes from `CheckoutGatewayOptions` (production 10 min; the harness passes 0). Non-production servers may set `BILLING_OFFER_COUPON_ID` (config.ts refuses it when `API_KEY_ENVIRONMENT=live`); billing-live.mjs creates a per-run coupon id and deletes it at exit. Tests: gateway TTL option, config refusal. human: ~2 h / CC: ~15 min.
B) Keep current value
A fixed coupon id and a 10-minute cache everywhere, as planned. The live offer specs will be flaky and leak into other sessions' runs.
C) Investigate first
Up to 30 min on whether restarting the harness API between specs is enough; implementation stays pending until a second answer.
D) Defer this change
Leave R6 unresolved; build steps 0–7 proceed, and build step 8 (live QA) waits for this answer.

State: approved
Actual answer: A) Apply (Recommended), D7 answered 2026-10-30
Accepted scope: the `couponById` cache TTL is a `CheckoutGatewayOptions` field (production 10 min, the harness 0); non-production servers may set `BILLING_OFFER_COUPON_ID` and config.ts refuses it when `API_KEY_ENVIRONMENT=live`; billing-live.mjs creates a per-run coupon id and deletes it at exit; tests for the gateway TTL option and the config refusal.
History: none

### R7: A coupon-read failure must never break Checkout (OV-2)
Finding: OV-2, HIGH→CRITICAL (blocks every Checkout if hit), confidence 8/10, server/src/routes/billing.ts `const PERMANENT_STRIPE_ERRORS: ReadonlySet<string> = new Set(['StripeInvalidRequestError', 'StripePermissionError', …])` → `refusalError('BILLING_ACCOUNT_NEEDS_HELP')` (outside voice, verified by parent)
Plan baseline: D6 (plan §1): "a coupon that's gone or invalid at that moment means full price, no error". Other errors are unspecified.
Runtime evidence: inside `viaStripe`, any `StripePermissionError` answers 409 BILLING_ACCOUNT_NEEDS_HELP (routes/billing.ts, `viaStripe`).
Comparison grid:
| Choice | Current | A | B | C | D |
|---|---|---|---|---|---|
| R7 coupon read fails on POST (any error) | unspecified; inside viaStripe → 409 | no offer, `logger.error` with the Stripe ids, Checkout continues at full price; GET does the same (like `catalogOrNothing`) | unspecified | investigate | deferred |
| R7 release order | runbook only | before-release.md: widen the key (Read on Coupons) **before** the API deploy; after the coupon exists, check production GET /v1/billing shows a non-null `offer` | runbook only | — | — |
| R1–R6 | approved | unchanged | unchanged | unchanged | unchanged |
Question D8:
D8 — What happens when Stripe won't let the server read the coupon?
Project/branch/task: MUT-525 launch offer plan, on main, planning only.
ELI10: The server asks Stripe for the coupon on every Checkout. If the API key isn't allowed to read coupons yet (say the release ships before the key is widened), Stripe says "permission denied". Today's error handling would turn that into "we couldn't open billing, contact us" for everyone, monthly buyers included, before the campaign even starts. The fix is to treat any failure to read the coupon as "no offer right now", log it loudly, and carry on. The release steps also say to widen the key first and to check the offer shows once the coupon exists.
Stakes if we pick wrong: a missing key permission turns off all subscriptions in production until someone notices.
Recommendation: A because a promotion must never be able to stop people paying, and the check costs one test row.
Completeness: A=10/10, B=3/10, C=5/10, D=2/10
Pros / cons:
A) Apply: fail open to full price + release order (recommended)
  ✅ No coupon problem can block a Checkout, monthly or yearly; the operator sees an error line instead of customers seeing "contact us"
  ✅ before-release.md puts the key change first and a launch check last, so a silently missing offer is caught on day one
  ❌ If the read keeps failing, eligible people pay full price until the error is noticed (the error log line is the alarm)
B) Keep the current value
  ✅ No extra branch in the route
  ✅ Fewer release steps to write
  ❌ A missing permission turns every Checkout into a 409 for all buyers
C) Investigate first
  ✅ Could check whether Stripe's Checkout `discounts` needs the coupon read at all
  ✅ No code decided yet
  ❌ Leaves a production-wide failure path open while it's being looked into
D) Defer this change only
  ✅ Nothing to build now
  ✅ Other steps proceed
  ❌ The build would ship a Checkout path with an undefined failure mode
Net: a promotion that fails open, against one that can take payments down.
Header: Coupon errors
Options:
A) Apply (Recommended)
Any coupon-read failure (not only 404 or invalid) gives no offer: the POST logs `logger.error` with the Stripe ids and continues at full price, and the GET returns `offer: null` like `catalogOrNothing`. before-release.md: widen the restricted key with Read on Coupons before the API deploy, and after creating the live coupon, check that GET /v1/billing shows `offer`. Tests: permission error on GET and on POST gives full price and a 200. human: ~1 h / CC: ~10 min.
B) Keep current value
Only gone or invalid coupons are handled; other Stripe errors follow viaStripe (409 for permission and invalid-request errors). The runbook mentions the key change.
C) Investigate first
Up to 30 min on whether Checkout with `discounts` needs the coupon read; implementation stays pending until a second answer.
D) Defer this change
R7 stays unresolved, and the POST's failure mode is left undefined in the plan.

State: approved
Actual answer: A) Apply (Recommended), D8 answered 2026-10-30
Accepted scope: any coupon-read failure gives no offer: the POST logs `logger.error` (Stripe ids only) and continues at full price, and the GET returns `offer: null` like `catalogOrNothing`. The coupon read sits outside `viaStripe`'s refusal mapping. before-release.md: widen the restricted key with Read on Coupons before the API deploy; after the live coupon exists, check that production GET /v1/billing shows a non-null `offer`. Tests: permission error on GET and on POST gives full price and a 200.
History: none

### R8: Arabic disclosure of the renewal price at payment (OV-3)
Finding: OV-3, HIGH, confidence 8/10, server/src/billing/checkout.ts:45 `export const CHECKOUT_SUBMIT_MESSAGE = [`: a fixed Arabic/English note, and the only Arabic text on Stripe's page (Stripe has no Arabic). The plan leaves it unchanged, so an offer buyer is never told in Arabic, at the moment of paying, that year two costs ₪290. (outside voice, verified by parent)
Plan baseline: the portal drawer shows "then ₪290/year" (§3); Stripe's page shows its own English line items.
Runtime evidence: `custom_text: { submit: { message: CHECKOUT_SUBMIT_MESSAGE } }` in `paramsOf` (checkout.ts).
Comparison grid:
| Choice | Current | A | B | C | D |
|---|---|---|---|---|---|
| R8 submit note on an offer Checkout | the fixed note | the fixed note plus one offer line, ar then en: "50% off your first year; it renews at ₪290 a year from <date>" (amount and date from the catalog and the trial/now), within Stripe's 1200 characters | the fixed note | investigate | deferred |
| R1–R7 | approved | unchanged | unchanged | unchanged | unchanged |
Question D9:
D9 — Should Stripe's payment page say, in Arabic, what the plan costs from year two?
Project/branch/task: MUT-525 launch offer plan, on main, planning only.
ELI10: Stripe's payment page has no Arabic. Our only Arabic text there is a short note above the Pay button about VAT and cancelling. With the offer, someone paying ₪145 should read, in their own language and right where they pay, that it renews at ₪290 a year and from which date. The drawer already says it, but the drawer isn't where they press Pay.
Stakes if we pick wrong: an Arabic-reading buyer is surprised by ₪290 a year later; that's a refund request, a complaint, and possibly a consumer-law problem.
Recommendation: A because it's one more line in a note we already send, and it closes the honesty gap at the moment of payment.
Completeness: A=10/10, B=6/10, C=5/10, D=4/10
Pros / cons:
A) Apply: offer line in the submit note (recommended)
  ✅ The renewal price and date sit above the Pay button in Arabic and English, where the money is committed
  ✅ Uses the existing `custom_text.submit` channel, so no new Stripe feature is needed
  ❌ The note grows to about 3 short paragraphs; Basel approves the Arabic wording
B) Keep the current note
  ✅ No change to Stripe's page
  ✅ Nothing new to translate
  ❌ The renewal price appears only in our drawer and in English on Stripe's line items
C) Investigate first
  ✅ Could check what Stripe's own page already shows for a once coupon
  ✅ No wording decided yet
  ❌ Stripe's page is English-only, so the Arabic gap stays whatever it shows
D) Defer this change only
  ✅ Nothing to build now
  ✅ Can be added after launch
  ❌ The first campaign buyers pay without the Arabic disclosure
Net: one translated line, against Arabic buyers committing without seeing year two's price.
Header: Pay-page note
Options:
A) Apply (Recommended)
When the offer is attached, `paramsOf` appends one ar + en line to `CHECKOUT_SUBMIT_MESSAGE`: the first-year price, the renewal price per year and the renewal date (the trial end or today, + 1 year), staying under 1200 characters. Tests: the offer note's text and length; the no-offer note unchanged (R3). human: ~1 h / CC: ~10 min.
B) Keep current value
The fixed note stays; the renewal price shows in the portal drawer and in Stripe's English line items only.
C) Investigate first
Look at what a sandbox Checkout with the coupon already shows (during the D5 spike), then decide; implementation stays pending.
D) Defer this change
R8 stays unresolved; the campaign can launch with the current note.

State: approved
Actual answer: A) Apply (Recommended), D9 answered 2026-10-30
Accepted scope: when the offer is attached, `paramsOf` appends one ar + en line to `CHECKOUT_SUBMIT_MESSAGE` with the first-year price, the yearly renewal price and the renewal date (trial end or today, + 1 year), under 1200 characters; Basel approves the Arabic wording; tests cover the offer note's text and length and the unchanged no-offer note.
History: none

### R9: Four small independent fixes (OV-5, OV-8, OV-9, OV-10); each is selected on its own
Finding: OV-5 MEDIUM 8/10 (server/src/scripts/users.ts:85 `'  billing-unlinked   (Stripe customers not yet matched to a person)',`); OV-8 LOW 8/10 (server/src/billing/trial-mail.ts:148 `async function skipReason(`, which already skips STRIPE payers); OV-9 LOW 7/10 (plan D2 refuses `trialing` subscribers); OV-10 LOW 7/10 (plan D6: a fresh coupon read on every POST). (outside voice, verified by parent)
Plan baseline: none of the four is in the plan.
Runtime evidence: as quoted.
Comparison grid:
| Choice | Current | Selected | Not selected |
|---|---|---|---|
| R9a unlinked pilot check | none | before-release.md: `npm run billing:unlinked` must be empty before the live coupon is created | no check |
| R9b mail eligibility read | per person "no subscription ever" read | the offer line goes to everyone the run mails (skipReason already drops payers); one offer read per run | per-person read as planned |
| R9c card-before-launch trialists | refused, no answer ready | runbook: a support reply (en + ar) and the operator path (attach the coupon to their subscription by hand in the dashboard) | nothing |
| R9d coupon read on Monthly | fresh read on every POST | the POST reads the coupon only for a Yearly Checkout | read on every POST |
| R1–R8 | approved | unchanged | unchanged |
Question D10:
D10 — Which of these four small fixes from the outside review should go into the plan? (pick any)
Project/branch/task: MUT-525 launch offer plan, on main, planning only.
ELI10: Four small things, each independent. (a) A pilot founder whose Stripe customer was never linked to their account would look brand new and get the offer, so check that list is empty before launch. (b) The trial mails already skip anyone paying, so the extra "ever subscribed?" lookup per person is wasted work. (c) People who added a card during their trial before launch are already "subscribed" and won't get the offer, so have a support answer ready. (d) Monthly Checkouts don't need to ask Stripe about the coupon at all.
Stakes if we pick wrong: (a) a founder pays twice; (c) support improvises; (b) and (d) only cost a few extra calls.
Recommendation: all four because each is under an hour and none changes the approved behaviour.
Completeness: all four=10/10; any subset leaves its own row open
Pros / cons:
a) Unlinked pilot check (recommended)
  ✅ Stops a founder getting a second, discounted subscription because of a missing link
  ✅ One command in before-release.md, run once
  ❌ The operator must link any customer it finds before launch
b) Drop the per-person mail read (recommended)
  ✅ One offer read per run instead of extra store reads per person; simpler code
  ✅ skipReason already excludes STRIPE payers, so the mailed group is the eligible group
  ❌ A rare person who subscribed, cancelled, and is back on a trial could get the line and then be refused at Checkout
c) Support answer for card-before-launch trialists (recommended)
  ✅ Support has a ready reply in both languages, and an operator path if Basel wants to honour it
  ✅ No code
  ❌ The by-hand path is a manual step per request
d) No coupon read for Monthly (recommended)
  ✅ Monthly Checkouts make no extra Stripe call, so they can't be affected by any coupon problem
  ✅ One condition in the route
  ❌ One more branch to test
Net: four cheap fixes that close edges the main review missed.
Header: Small fixes
Options (multi-select):
a) Unlinked pilot check (Recommended)
before-release.md: run `npm run billing:unlinked`; it must list nothing before the live coupon is created. human: ~10 min / CC: ~2 min.
b) Drop per-person mail read (Recommended)
The trial-mail run adds the offer line for everyone it mails while the offer runs (skipReason already drops payers); one cached offer read per run. human: ~0 / CC: removes work.
c) Support answer (Recommended)
pilot-runbook: an en + ar support reply for trialists who added a card before launch, plus the by-hand operator path (apply the coupon to their subscription in the dashboard). human: ~30 min / CC: ~5 min.
d) No coupon read on Monthly (Recommended)
The POST fetches the coupon only when `interval === 'year'`; tests assert no coupon call on Monthly. human: ~20 min / CC: ~3 min.

State: approved
Actual answer: a, b, c, d all selected (each Recommended), D10 answered 2026-10-30
Accepted scope: (a) before-release.md: `npm run billing:unlinked` lists nothing before the live coupon is created; (b) the trial-mail run adds the offer line for everyone it mails while the offer runs, with one cached offer read per run and no per-person read; (c) pilot-runbook: an en + ar support reply for trialists who added a card before launch, plus the by-hand operator path; (d) the POST reads the coupon only for a Yearly Checkout, and a test asserts no coupon call on Monthly.
History: none

### TODO-1: Pre-renewal notice for the campaign cohort (OV-3, second half)
What: before a campaign subscription's first renewal (₪145 → ₪290), send an ar + en notice: about 30 days ahead, with the new price, the date, and how to cancel. Add a legal check of whether Israeli consumer-protection law requires it.
Why: Stripe's own renewal reminder is English-only and generic. A jump of more than 3× is the churn and complaint moment. It may also be a legal duty for fixed-term benefits in ongoing deals (unverified).
Pros: honest, may be required, and it is the natural retention touchpoint (a renewal offer could ride on it later).
Cons: a new mail and a scheduled job; nothing is due before about November 2027.
Context: MUT-525's coupon is first-year only. Renewals start one year after the first campaign Checkout. The MUT-419 trial-mail run shows the job shape; billing-spike D4 already promised a 30-day notice when the founder lock ends.
Depends on / blocked by: MUT-525 shipped; Basel's legal read.
Question D11:
D11 — Track the pre-renewal notice for campaign buyers as a follow-up?
Project/branch/task: MUT-525 launch offer plan, on main, planning only.
ELI10: Campaign buyers pay ₪145 now and ₪290 a year later. Someone should tell them, in Arabic and English, about a month before that happens, and possibly the law requires it. Nothing is due until about November 2027, so it doesn't belong in this build, but it must not be forgotten.
Stakes if we pick wrong: a year from now, hundreds of people get a 3× charge with only Stripe's English email as warning.
Recommendation: A because it's real work with a fixed deadline, and a ticket is how this project remembers things.
Note: options differ in kind, not coverage — no completeness score.
Pros / cons:
A) Add as a follow-up (recommended)
  ✅ TODOS.md entry plus a MUT ticket under MUT-322, with the deadline and the legal question written down
  ✅ Keeps this build small
  ❌ One more open ticket in the backlog for a year
B) Skip
  ✅ Nothing to track
  ✅ Stripe sends its own reminders
  ❌ The renewal jump arrives with an English-only generic email, and any legal duty is missed
C) Build it now in this PR
  ✅ Done while the context is fresh
  ✅ No ticket to remember
  ❌ Adds a mail and a job to a time-boxed campaign build, for something due in a year
Net: a tracked deadline against a forgotten one.
Header: Renewal notice
Options:
A) Add as follow-up (Recommended)
Add TODO-1 to TODOS.md and propose a MUT ticket (through /pm-intake, under MUT-322) with the deadline of about Oct 2027 and the legal check.
B) Skip
Not tracked; rely on Stripe's renewal reminders.
C) Build it now
Add the pre-renewal mail and its scheduled run to MUT-525's scope. human: ~2 days / CC: ~1.5 h.

State: approved
Actual answer: C) Build it now, D11 answered 2026-10-30 (Basel chose this over the recommended follow-up)
Accepted scope: added to MUT-525. A new ar + en mail `offer-renewing-soon`, sent once, about 30 days before the first renewal of a subscription whose Checkout carried the campaign (`subscription_data.metadata.mutaba3a_offer`). It states the new yearly price, the renewal date and how to cancel (Manage billing). It is sent by a daily run shaped like MUT-419's trial mail: a job door `/jobs/v1/billing/renewal-mail` and an operator door with `--dry-run`, idempotency key `renewal:<subscriptionId>:<periodEnd>`, and suppression respected. The run finds subscriptions from Stripe (metadata + `current_period_end` window), so no migration is needed. A Cloud Scheduler job goes in the existing Terraform, next to trial-mail's. Basel's legal check of the wording stays outside the code. Build step 9b (see Implementation Tasks).
History: none

### TODO-2: What happens to the campaign machinery after the campaign (OV-10, second half)
What: when the launch campaign ends, decide whether to keep `offer.ts` and its plumbing for the next campaign (make the coupon id a list in config) or remove it.
Why: once the campaign is over, the GET keeps a cached coupon read and `offer: null` forever; code without a purpose rots.
Pros: a dated decision instead of dead code; the next campaign may be a config change.
Cons: one more ticket; the decision can't be made well until the campaign's results are in.
Context: the campaign ends about 3 months after launch (about Feb 2027). `LAUNCH_OFFER` in offer.ts names one coupon id.
Depends on / blocked by: MUT-525 shipped and the campaign ended.
Question D12:
D12 — Track a "keep or remove the campaign code" decision for when the campaign ends?
Project/branch/task: MUT-525 launch offer plan, on main, planning only.
ELI10: After three months the coupon expires, but the code that reads it stays. Either it becomes the base for the next campaign (a small change), or it should be removed. That choice is easiest once we know how the campaign did, so it's a follow-up, not part of this build.
Stakes if we pick wrong: the offer code lingers with no owner, and a future campaign rebuilds it instead of reusing it.
Recommendation: A because it's a dated decision with a natural trigger (the campaign's end) and costs one ticket.
Note: options differ in kind, not coverage — no completeness score.
Pros / cons:
A) Add as a follow-up (recommended)
  ✅ A TODOS.md entry and a MUT ticket dated to the campaign end, decided with the campaign's numbers in hand
  ✅ Nothing extra in this build
  ❌ Another backlog ticket
B) Skip
  ✅ Nothing to track
  ✅ The code is harmless while the coupon doesn't exist (`offer: null`)
  ❌ Nobody decides; the code stays forever by default
C) Build it now (make it a config list of campaigns)
  ✅ The next campaign needs no code change
  ✅ Done while fresh
  ❌ Generalising before one campaign has run is guessing (YAGNI)
Net: a scheduled decision against either dead code or premature generality.
Header: Campaign code
Options:
A) Add as follow-up (Recommended)
Add TODO-2 to TODOS.md and propose a MUT ticket dated to the campaign's end: keep (coupon ids as a config list) or remove the offer machinery.
B) Skip
Not tracked; the code stays and answers `offer: null` once the coupon is gone.
C) Build it now
Make the campaign list configurable in this build (several coupon ids, each with its own id and interval). human: ~1 day / CC: ~45 min.

State: approved
Actual answer: C) Build it now, D12 answered 2026-10-30 (Basel chose this over the recommended follow-up)
Accepted scope: the offers are a list in `server/src/billing/offers.json` beside `billing-countries.json`, parsed at boot (malformed fails fast), each entry `{ id, couponId, interval: 'year' | 'month', tier: 'freelancer' }`. The list ships with one entry, `{ id: 'launch-2026', couponId: 'mtb3a_launch_yearly_2026', interval: 'year' }`. For an interval, the active offer is the first entry whose coupon is valid. A new campaign is a JSON edit plus a dashboard coupon. R6's non-production `BILLING_OFFER_COUPON_ID` stays as approved: when set, it replaces the list with one yearly entry using that coupon id. D1 (Stripe holds amounts and dates; the code names the coupon ids) is unchanged.
History: none

Approval readiness: PASS. Checked: R1 (D2), R2 (D3), R4 (D4), R5 (D5), R3 (D6), R6 (D7), R7 (D8), R8 (D9), R9 a–d (D10), TODO-1 (D11, C), TODO-2 (D12, C); factual corrections OV-4, OV-6, OV-7 and finding 2 (schema) carry no new behaviour.

## Amended plan (what /eng-build follows; §0–§7 plus these changes)

1. **Offer list, not one id (TODO-2/D12):** `server/src/billing/offers.json` + parser in `offer.ts` (fails fast at boot); ships `launch-2026` → `mtb3a_launch_yearly_2026`, yearly. A non-production `BILLING_OFFER_COUPON_ID` replaces the list with one yearly QA entry (R6).
2. **Offer window (R1):** active for new Checkouts while `now + CHECKOUT_SESSION_TTL_SECONDS < redeem_by`; `endsAt` = redeem_by − 1 h everywhere. Missing `redeem_by` → no offer (OV-6).
3. **Coupon reads (R6, R7, R9d):** the cache TTL is a gateway option (10 min in production, 0 in QA). The POST reads fresh, Yearly only. Any read failure → no offer + `logger.error`, never a refusal.
4. **POST order (OV-4):** decide the offer after `subscriptionsOf` (mirror + Stripe); `PriceFact.productId` feeds the Freelancer check.
5. **Schema (finding 2):** `BillingOfferSchema` is not a nullable registered component; the field is `z.union([BillingOfferSchema, z.null()])` or the schema stays unregistered.
6. **Pay-page note (R8):** an offer Checkout appends an ar + en line (first-year price, renewal price, renewal date) to the submit message.
7. **Portal (R4, R5):** `offerFor()` in `billingView.ts`; the interval is derived as `chosen ?? (eligible ? 'year' : 'month')`.
8. **Trial mails (R9b):** one offer read per run; the line goes to everyone the run mails while the offer runs.
9. **Renewal notice (TODO-1/D11):** `offer-renewing-soon` mail (ar + en), a daily run with job and operator doors, Stripe metadata + period window, idempotency `renewal:<sub>:<periodEnd>`, plus a Cloud Scheduler job in Terraform.
10. **Release (R7, R9a):** before-release.md, in order: widen the key (Read on Coupons) → deploy the API → `billing:unlinked` must be empty → create the live coupon (Basel sets redeem_by) → check that GET /v1/billing shows `offer`. pilot-runbook: the coupon spec from the D5 result, the one-hour rule, early end = delete, the support reply (R9c).
11. **Tests (R3, R6):** the no-offer regression contract on four surfaces; the live harness keeps the coupon absent by default, per-run coupon ids, serial offer specs; §4's `launch-offer-ended` no longer restores the coupon (OV-7); the D5 spike uses a throwaway coupon id.
12. **Gate (R2):** if the D5 spike shows no coupon shape discounts the first paid invoice after a trial, stop and bring the invoices to Basel.

## Test review: coverage diagram (proposed tests; nothing is built yet)

```
CODE PATHS                                              USER FLOWS
[+] server/src/billing/offer.ts (new)                   [+] Trialist subscribes yearly during campaign
  ├── parseOffers(offers.json)                            ├── [GAP→planned] opens on Yearly, ₪290→₪145 [→E2E launch-offer-yearly]
  │   ├── [planned ★★★] valid list / malformed → throw    ├── [GAP→planned] switch to Monthly, no offer [→E2E launch-offer-monthly]
  ├── offerFromCoupon(fact, now)                          └── [GAP→planned] trial carried, first paid ₪145 [→E2E trial-carry, D5 gate]
  │   ├── [planned ★★★] valid → offer                   [+] Campaign ends or is ended early
  │   ├── [planned ★★★] 404 / valid:false / no redeem_by  ├── [GAP→planned] coupon deleted → no offer anywhere [→E2E launch-offer-ended]
  │   │                  / amount_off / wrong duration    └── [GAP→planned] last hour → no discounted Checkout (unit)
  │   │                  / not Freelancer → null        [+] Error states
  │   └── [planned ★★★] now+TTL ≥ redeem_by → null (R1)   ├── [GAP→planned] Stripe permission error → full price, 200 (R7)
  ├── offerEligible(subs, interval)                       └── [GAP→planned] stale mirror, Stripe has a sub → no coupon
  │   └── [planned ★★★] yearly∅ / monthly / canceled /  [+] Renewal notice (TODO-1)
  │                      trialing                         ├── [GAP→planned] sent once ~30 d before, ar/en
  └── firstYearOf(catalog, pct)                           └── [GAP→planned] suppressed address / dry run
      └── [planned ★★★] 49000→14700, 16000→4800, odd, null
[+] checkout-gateway.couponById      [planned ★★★] hit / 404 / TTL option / fresh / cached failure
[+] checkout.ts paramsOf             [planned ★★★] discounts + metadata + note; no offer = byte-identical (R3)
[+] routes/billing.ts GET/POST       [planned ★★★] offer null cases, eligible false, Yearly-only read, audit offer
[+] trial-mail.ts                    [planned ★★] offer line on / off; no-offer mails byte-identical (R3)
[+] renewal-mail (new)               [planned ★★★] window, metadata filter, idempotency, suppression, dry run
[+] billingView.offerFor             [planned ★★★] eligible / ineligible / null currency
[+] BillingDrawer                    [planned ★★★] Yearly default, pick sticks, no-offer view unchanged (R3), RTL bdi
[+] TrialBanner                      [planned ★★] line with offer / none; query only while banner shows

COVERAGE (planned): 100% of the new paths have a proposed ★★/★★★ test; existing billing tests extended, none retired.
QUALITY: E2E 4 live specs (Stripe sandbox) + 1 spike script | unit ~45 rows
```

Test plan artifact: `~/.gstack/projects/vAWK3-mutaba3a/basel-main-eng-review-test-plan-20261030-205733.md`.

## NOT in scope
- Prices or a campaign banner on mtb3a.com: MUT-365 owns the public site, and it's still blocked.
- Offer copy in the Flutter app: the phone hands off to web Checkout, so the discount still applies; the `offer` field is additive.
- A Firm-tier offer: MUT-363 isn't built; the coupon is restricted to the Freelancer product.
- A retention coupon in the Customer Portal: discussed with Basel, and deferred until there's cancellation-reason data.

## What already exists
- `planCheckout` / `paramsOf` (server/src/billing/checkout.ts) are extended, not rebuilt.
- The Stripe-own subscription check `inStripe` (routes/billing.ts:166) is reused for eligibility.
- The catalog cache pattern (checkout-gateway.ts:54) is reused for coupons, with the TTL made injectable.
- `catalogOrNothing` (routes/billing.ts) is the model for the coupon read failing open.
- `billingView.ts` (`yearlySavingOf`) gets `offerFor` (R5).
- The MUT-419 trial-mail run, its job and operator doors, and the mailer templates: the renewal-notice run copies its shape.
- `billing-countries.json` and its fail-fast parser: the model for `offers.json`.
- The billing-live.mjs harness and `payCheckoutByApi`: reused by the offer specs.

## Failure modes
| Path | Realistic failure | Test / handling | What the user sees |
|---|---|---|---|
| Coupon read on GET | Stripe outage or permission error | R7: offer null + warn/error log | no offer, no error |
| Coupon read on POST | same | R7: full price, error log | Checkout works at full price |
| Last hour of campaign | coupon expires mid-Checkout | R1: no discounted session within 1 h | the offer has ended (shown end time) |
| Trial + once coupon | discount spent on ₪0 invoice | R2 spike gate before code | prevented before build |
| Stale mirror | a past sub not mirrored yet | Stripe's own list decides | full price (drawer may have shown offer) |
| Unlinked pilot customer | founder looks new | R9a before-release check | prevented operationally |
| Renewal run | double send or wrong window | idempotency key + window tests | at most one mail |
| Cache in QA | stale offer state between specs | R6 TTL 0 + per-run coupon | n/a (tests) |

Critical gaps (no test, no handling, silent): **0**.

## Worktree parallelization strategy
| Step | Modules touched | Depends on |
|---|---|---|
| S0 D5 spike | qa/support | — |
| S1 offer core + gateway + Checkout + routes/schema | server/src/billing, server/src/routes, server/src/schemas | S0 |
| S2 portal | src/hosted | S1 (API contract) |
| S3 trial mails + renewal notice + Terraform | server/src/billing, server/src/email, server/src/routes, infra | S1 |
| S4 live QA + docs | qa/, docs/, .claude/ | S2, S3 |

Lane A: S0 → S1 → S3 (server/src/billing is shared, so sequential). Lane B: S2 after S1 (src/hosted only). Launch A; start B once S1 is merged into the branch; then S4. Conflict flag: S1 and S3 both touch server/src/billing and server/src/routes, so keep them in one lane. Basel's rule is one worktree per repo per epic, so both lanes run in the same worktree unless he says otherwise.

## Implementation Tasks
Synthesized from this review's findings. Each task derives from a specific finding above. Run with Claude Code or Codex; checkbox as you ship.

- [ ] **T0 (P1, human: ~3h / CC: ~20min)**: spike: prove `once` vs `repeating` with a carried trial and a test clock; stop if both fail
  - Surfaced by: Scope finding 1 / R2 (D3)
  - Files: qa/support/mut525-coupon-spike.mjs (not shipped), ADR-234
  - Verify: sandbox invoices: first paid ₪145, renewal ₪290
- [ ] **T1 (P1, human: ~1d / CC: ~45min)**: server: offers.json + offer.ts (window R1, shapes OV-6, eligibility, firstYearOf)
  - Surfaced by: D12, R1, OV-6
  - Files: server/src/billing/offers.json, server/src/billing/offer.ts, server/src/billing/__tests__/offer.test.ts
  - Verify: `heavy -l "MUT-525 offer" -- npm --prefix server test -- offer`
- [ ] **T2 (P1, human: ~3h / CC: ~20min)**: gateway: `couponById` with injectable TTL, fresh read, `PriceFact.productId`; config `BILLING_OFFER_COUPON_ID` refused on live
  - Surfaced by: R6, OV-4
  - Files: server/src/billing/stripe/checkout-gateway.ts, server/src/config.ts, tests
  - Verify: checkout-gateway.test.ts, config tests
- [ ] **T3 (P1, human: ~4h / CC: ~30min)**: Checkout + routes: offer after `subscriptionsOf`, Yearly-only read, fail open, discounts + metadata + ar/en note, audit `offer`, schema union
  - Surfaced by: R7, R8, R9d, OV-4, finding 2
  - Files: server/src/billing/checkout.ts, server/src/routes/billing.ts, server/src/schemas.ts, openapi
  - Verify: billing-routes.test.ts, checkout.test.ts, `npm --prefix server run openapi:check`
- [ ] **T4 (P1, human: ~2h / CC: ~15min)**: no-offer regression contract on Checkout, GET, mails and drawer
  - Surfaced by: R3 (D6)
  - Files: the four existing test files
  - Verify: the same suites green with no coupon
- [ ] **T5 (P1, human: ~1d / CC: ~45min)**: portal: `offerFor` in billingView.ts, the derived interval, drawer, PlanLines, TrialBanner, i18n ar/en, analytics 2.5.0
  - Surfaced by: R4, R5
  - Files: src/hosted/data/billingView.ts, src/hosted/components/BillingDrawer.tsx, src/hosted/components/TrialBanner.tsx, src/hosted/i18n, docs/analytics/events.json
  - Verify: `heavy -l "MUT-525 portal" -- npx vitest run src/hosted --maxWorkers=3`
- [ ] **T6 (P2, human: ~2h / CC: ~15min)**: trial mails: one offer read per run, offer line in 3 templates ar/en
  - Surfaced by: R9b
  - Files: server/src/billing/trial-mail.ts, server/src/routes/trial-mail.ts, server/src/email/templates/copy.ts
  - Verify: trial-mail tests, template snapshots
- [ ] **T7 (P1, human: ~2d / CC: ~1.5h)**: renewal notice: `offer-renewing-soon` ar/en, daily run + doors, Stripe metadata window, idempotency, Terraform scheduler
  - Surfaced by: TODO-1 (D11, C)
  - Files: server/src/billing/renewal-mail.ts (new), server/src/routes/renewal-mail.ts (new), email templates, src/infrastructure/terraform
  - Verify: unit tests; `terraform plan` reviewed by Basel (never applied by Claude)
- [ ] **T8 (P1, human: ~1d / CC: ~1h)**: live QA: harness per-run coupon + TTL 0; 4 serial offer specs; existing 17 flows unchanged
  - Surfaced by: R3, R6, OV-7
  - Files: qa/support/billing-live.mjs, qa/features/portal-live/billing.yaml, qa/specs/portal-live/billing.spec.ts
  - Verify: `release-qa run --attach --only <each id>`, `release-qa lint`
- [ ] **T9 (P2, human: ~2h / CC: ~15min)**: docs: ADR-234, pilot-runbook (coupon spec, one-hour rule, early end, support reply), before-release.md order, CHANGELOG, TEST_PLAN, COMPONENT_REGISTRY
  - Surfaced by: R7, R9a, R9c
  - Files: .claude/*.md, docs/operations/*.md
  - Verify: read-through

## Unresolved decisions
None in this review. Basel still owes three product inputs, outside the code: the live coupon's end date, the Arabic wording of the pay-page note and the renewal mail, and the legal read on the renewal notice.

## Completion summary
- Step 0: Scope Challenge: scope accepted as-is
- Reality rows: 7/7 applicable rows emitted (PLAN_REALITY below), 2 unverified premises
- Architecture Review: 1 issue found (R1)
- Code Quality Review: 2 issues found (R4, R5)
- Test Review: diagram produced, 1 gap identified (R3)
- Performance Review: 0 issues found
- NOT in scope: written
- What already exists: written
- TODOS.md updates: 2 items proposed to user (both chosen "build it now")
- Failure modes: 0 critical gaps flagged
- Unresolved decisions: 0 in this review
- Outside voice: Claude Plan subagent (native fallback; Codex CLI not installed), completed in 241 s, 10 findings
- Parallelization: 2 lanes, 1 parallel / 1 sequential
- Lake Score: 8/8 (every answer scored for completeness picked the 10/10 option)

---

# Design review (/plan-design-review, 2026-10-30)

Target: this file. Initial design completeness: 4/10. All 7 passes (D1). Outside design voice: Claude subagent (D2). Mockups: the gstack designer makes PNGs only; skipped because Basel's standing preference is interactive HTML screens and Claude Design for visuals (memory: feedback-design-desktop-and-phone, feedback-claude-design-for-visuals).

## Design decisions (approved)

- **DD1 Home trial line (D3, answered A):** while eligible, the quiet line reads "N days left in your free trial · 50% off a yearly plan until <date> · Hide" (ar mirrored, the same `.hp-trial-line`, no box or icon). The offer link replaces "Add a card" and opens Subscribe on Yearly. With no offer, the line is unchanged (R3). The link fires `trial_card_prompt_accepted` {prompt: 'banner'}; the line fires `billing_offer_shown` {surface: 'banner'} once per page.
- **DD2 Subscribe step (D4, answered A):** the Yearly segment label stays short: "Yearly · −50%" (i18n, ar mirrored). The summary row is the one price anchor: `<s>₪290</s> ₪145` + "first year" (amounts in `<bdi>`, `--font-mono`), then one `--text-label` `--muted` line: "then ₪290 a year · offer ends <date>". With Monthly selected or no offer, the summary is today's (R3).
- **DD3 Billing status after paying (D5, answered A):** when the shown subscription's `priceLookupKey` is a `freelancer_list_*` key, the status line reads "Renews at ₪290 on <date>" (amount from the catalog by interval and currency, `<bdi>` mono). Founder prices keep today's copy. Cancel-at-period-end keeps today's "ends on" copy. The server adds `priceLookupKey`'s list-ness as `renewsAtListPrice: boolean` on the subscription view, so the portal never parses keys. This applies to every list-price subscriber, not only campaign buyers.
- **DD4 Offer ended mid-session (D6, answered A):** the portal's yearly Checkout request carries the offer id it showed (`expectedOffer`). If the server can't apply it, the server answers 409 CONFLICT, `details.reason: OFFER_ENDED`, and creates **no** Checkout (house rule: an existing code with a reason). The drawer stays open and refetches /v1/billing. It shows `.hp-banner-info` at the top of the drawer body: "The launch offer has ended. The yearly price is ₪290." (ar mirrored, amount from the refreshed catalog). Pressing Continue again goes ahead at full price. Tests: route (409, no session) and drawer (banner, no redirect, second Continue redirects).
- **DD5 The default sticks (D7, answered A; supersedes eng R4's mechanism, keeps its outcome):** `chosen` starts null. On the first render with billing data it is set once (a render-time adjustment, no effect) to Yearly if eligible, else Monthly. Refetches never change it. If the offer disappears while the drawer is open, the interval stays, the offer copy goes, and `role="status"` "The launch offer has ended." shows in the drawer's banner slot. Tests: a refetch keeps the choice; the ended line appears.
- **DD6 Offer first (D8, answered A):** while eligible, one `<p>` under Back in `--text` at `--text-body`, with no box, icon or colour: "Launch offer: 50% off your first year on Yearly, until <date>." (ar mirrored). It shows before a country is picked and goes with the offer. The step order is unchanged.
- **DD7 Mail rule amended (D9, answered A):** ADR-234 records an override of ADR-159 §5 (why: a renewal notice must state its price; what replaces it: billing mails may show a subscription's own price and its offer-end or renewal day; date: 2026-10-30). Money records never appear. Days use `mailDay`, as an Asia/Jerusalem calendar day. The copy.ts header and its guard test get an allow-list limited to the offer and renewal templates.
- **DD8 Renewal mail (D10, answered A):** built like `account-closing`.
  - Headline: "Your first year ends on <day>".
  - `details` rows: Plan; Renews on; New price "₪290 a year, plus VAT where it applies". The amount is the subscription's own price and currency, not the current catalog's.
  - Action: "Manage billing" → `/?billing=true`.
  - One line on how to cancel.
  - Sent only to subscriptions that aren't `cancel_at_period_end` and are still on the offer's list price.
  - Runbook: turn off Stripe's "upcoming renewal" emails in the dashboard.
  - The ar + en copy goes in the copy deck for Basel.
- **DD9 Accessibility and colour (D11, all four selected):**
  - (a) Visually `<bdi>₪145</bdi>` (`--text`, mono, medium) comes before `<s><bdi>₪290</bdi></s>` (`--muted`), and the struck pair is `aria-hidden`. Screen readers get an sr-only "₪145 for the first year instead of ₪290" (ar mirrored). This updates DD2's visual order.
  - (b) Offer copy is `--text` at `--weight-medium` at most, never mint or `--success`. This replaces §6's "offer copy in the success/positive role".
  - (c) The summary price has `aria-live="polite"`.
  - (d) When eligible with Monthly selected, one `--text-label` `--muted` line sits under the switch: "Yearly is 50% off the first year until <date>."
- **DD10 States and copy (D12, all four selected):**
  - (a) When an offer applies, one sentence replaces the loose fine lines.
    - With a carried trial: "Your free trial continues. On <firstCharge> you pay ₪145 for your first year, then ₪290 a year from <renewsOn>."
    - Without one: "You pay ₪145 today for your first year, then ₪290 a year from <renewsOn>."
    - `offerFor()` returns `renewsOn` using the server's 48 h trial-carry rule, so it matches the pay-page note (R8).
  - (b) `/v1/billing`'s subscription carries `offer: { id } | null` from `metadata.mutaba3a_offer`, mirrored by the webhook sync into a new nullable `offerId` column. That's a Prisma migration: warn the orchestrator before merging (memory: feedback-migration-merge-warn-orchestrator). The done banner reads "You're subscribed. Launch offer applied." when it's present.
  - (c) The trial and read-only status panels put one offer line in the context, above Subscribe. PlanLines' "A year" line shows ₪145 / $45 first year with the struck list prices (DD9a).
  - (d) Copy says "until <date>", which includes the day. On the last calendar day the drawer says "Ends today". Runbook: set `redeem_by` so `endsAt` = 23:59 Asia/Jerusalem on the last day (`redeem_by` 00:59 the next day).
- **DD11 Deliberately silent (factual restatement of eng D2, no new decision):** people who aren't eligible see no offer and no explanation anywhere in the portal. That covers people who already took it, payers, and trialists who added a card before launch. R9c's support reply is their answer.
- **DD12 Copy and the Stripe page (D13, all four selected):**
  - (a) The submit note is [ar offer line, ar note] then [en offer line, en note]. Amounts and dates are wrapped in U+2068/U+2069. Dates use `Intl` 'ar' with Western digits. The string is snapshot-tested and screenshotted during the D5 spike.
  - (b) The coupon spec (runbook, harness, D1) gains `name: "Launch offer · عرض الإطلاق"`.
  - (c) The copy deck below; Basel approves it once before /eng-build.
  - (d) In the trial mails, while the offer runs, the offer is the last intro paragraph, right above the action. The action becomes "Get 50% off a year" and links to Subscribe. The subject and preheader don't change.

- **DD13 Read-only and locked notices (D14, answered A):** LapseGate (read-only) and the locked page show the copy deck's top line above their Subscribe button while the person is eligible, in plain `--text` with no box. Tests: shown when eligible, absent otherwise, ar at 375 px.

## Copy deck (draft for Basel's approval; Western digits; {price} = first-year amount, {list} = list yearly amount, both via the money formatter)

| Key (proposed) | English | Arabic |
|---|---|---|
| `hosted.billing.offer.segment` | Yearly · −50% | سنويًا · خصم 50% |
| `hosted.billing.offer.topLine` (DD6, DD10c) | Launch offer: 50% off your first year on Yearly, until {date}. | عرض الإطلاق: خصم 50% على سنتك الأولى في الاشتراك السنوي، حتى {date}. |
| `hosted.billing.offer.firstYear` | first year | للسنة الأولى |
| `hosted.billing.offer.srPrice` (DD9a) | {price} for the first year instead of {list} | {price} للسنة الأولى بدلًا من {list} |
| `hosted.billing.offer.thenUntil` | Then {list} a year. Offer available until {date}. | ثم {list} سنويًا. العرض متاح حتى {date}. |
| `hosted.billing.offer.firstChargeTrial` (DD10a) | Your free trial continues. On {firstCharge} you pay {price} for your first year, then {list} a year from {renewsOn}. | تستمر تجربتك المجانية. في {firstCharge} تدفع {price} عن سنتك الأولى، ثم {list} سنويًا ابتداءً من {renewsOn}. |
| `hosted.billing.offer.firstChargeNow` | You pay {price} today for your first year, then {list} a year from {renewsOn}. | تدفع اليوم {price} عن سنتك الأولى، ثم {list} سنويًا ابتداءً من {renewsOn}. |
| `hosted.billing.offer.monthlyHint` (DD9d) | Yearly is 50% off the first year until {date}. | الاشتراك السنوي بخصم 50% على السنة الأولى حتى {date}. |
| `hosted.billing.offer.endsToday` (DD10d) | Ends today | ينتهي اليوم |
| `hosted.billing.offer.ended` (DD5) | The launch offer has ended. | انتهى عرض الإطلاق. |
| `hosted.billing.offer.endedPrice` (DD4) | The launch offer has ended. The yearly price is {list}. | انتهى عرض الإطلاق. سعر الاشتراك السنوي {list}. |
| `hosted.billing.trialBanner.offer` (DD1) | 50% off a yearly plan until {date} | خصم 50% على الاشتراك السنوي حتى {date} |
| `hosted.billing.context.renewsAt` (DD3) | Renews at {list} on {date}. | يتجدد بسعر {list} في {date}. |
| `hosted.billing.done.offerApplied` (DD10b) | You're subscribed. Launch offer applied. | تم الاشتراك. طُبّق عرض الإطلاق. |
| mail trial line (DD12d) | Launch offer: 50% off your first year on a yearly plan, until {day}. | عرض الإطلاق: خصم 50% على سنتك الأولى في الاشتراك السنوي، حتى {day}. |
| mail trial button (DD12d) | Get 50% off a year | احصل على خصم 50% |
| renewal subject (DD8) | Your MTB3A first year ends on {day} | تنتهي سنتك الأولى في متابعة يوم {day} |
| renewal preheader | Your plan renews at {list} a year. | يتجدد اشتراكك بسعر {list} سنويًا. |
| renewal headline | Your first year ends on {day} | تنتهي سنتك الأولى يوم {day} |
| renewal intro | Your launch-offer year ends soon. Your plan then renews at the regular yearly price. | تنتهي قريبًا سنة عرض الإطلاق، ثم يتجدد اشتراكك بالسعر السنوي المعتاد. |
| renewal details | Plan: Freelancer, yearly · Renews on: {day} · New price: {list} a year, plus VAT where it applies | الخطة: المستقل، سنويًا · يتجدد في: {day} · السعر الجديد: {list} سنويًا، وتُضاف ضريبة القيمة المضافة حيث تنطبق |
| renewal action | Manage billing | إدارة الدفع |
| renewal cancel line | Don't want to renew? Cancel any time before {day} from Manage billing. You keep the year you paid for. | لا تريد التجديد؟ ألغِ في أي وقت قبل {day} من «إدارة الدفع»، وتبقى سنتك المدفوعة كاملة. |
| pay-page offer line (R8, DD12a) | Launch offer: {price} for your first year. It then renews at {list} a year from {renewsOn}. | عرض الإطلاق: {price} عن سنتك الأولى، ثم يتجدد بسعر {list} سنويًا ابتداءً من {renewsOn}. |
| Stripe coupon name (DD12b) | Launch offer · عرض الإطلاق | (same, bilingual) |


## Design passes: scores

| Pass | Before | After | What moved it |
|---|---|---|---|
| 1 Information architecture | 4 | 9 | DD1 one action on the Home line; DD2 one price anchor; DD6 the offer read first |
| 2 Interaction states | 3 | 9 | DD4 ended mid-session; DD5 the default sticks; DD10 first charge, confirmation, last day; DD13 read-only and locked |
| 3 Journey and emotional arc | 4 | 9 | DD3 the renewal price always visible; DD8 a calm renewal mail; DD10b "offer applied" |
| 4 AI-slop risk | 7 | 9 | Operate surface; no boxes, icons or promo colour (DD9b); one copy deck (DD12c) |
| 5 Design-system alignment | 5 | 9 | DD9b mint keeps its meaning; DD7 ADR-159 §5 override logged |
| 6 Responsive and accessibility | 4 | 9 | DD2 short segment label at 375 px; DD9a sr-only price; DD9c live price; DD12a bidi isolates |
| 7 Unresolved decisions | 9 found | 0 open | all answered (D3–D14) |

Overall: 4/10 → 9/10. The remaining point is Basel's sign-off on the copy deck, and an HTML mock-up if he wants one.

### Journey storyboard (accepted)

| Step | User does | User feels | Plan specifies |
|---|---|---|---|
| 1 | Sees the Home trial line | curious | DD1: "50% off a yearly plan until <date>" |
| 2 | Opens Subscribe | oriented | DD6 top line; DD5 Yearly preselected |
| 3 | Reads the price | sure | DD2 + DD9a: ₪145, ₪290 struck, one sr sentence; DD10a first charge and renewal |
| 4 | Continue → Stripe | trusting | DD4 no silent full price; DD12a Arabic offer line first on the pay page |
| 5 | Returns | reassured | DD10b "Launch offer applied" |
| 6 | Checks Billing later | informed | DD3 "Renews at ₪290 on <date>" |
| 7 | ~30 days before renewal | respected | DD8 a calm mail with the cancel path; no Stripe duplicate |

### Interaction states

| Feature | Loading | Empty / not eligible | Error | Success | Partial |
|---|---|---|---|---|---|
| Home line | nothing until /v1/billing settles | today's line (R3, DD11) | today's line | offer link opens Subscribe | snoozed: hidden with the line |
| Subscribe step | drawer waits for billing (as today) | today's step (R3) | DD4 banner on OFFER_ENDED; R7 fail-open | redirect to Stripe | DD5 offer ended while open: status line |
| Billing status | as today | as today | as today | DD10b offer applied; DD3 renews at | founder price: no amount |
| Read-only / locked | as today | as today | as today | offer line above Subscribe (DD13) | — |
| Mails | n/a | today's copy (R3) | run continues per person | offer line + button (DD12d) | offer ends mid-run: next run drops it |

## NOT in scope (design)
- Phone (Flutter) offer screens: the phone hands off to web Checkout. Basel's rule (desktop + phone designs together) would apply if the phone gets offer copy later.
- Visual mock-ups: no PNGs, per Basel's preference. An interactive HTML mock-up of the drawer at desktop and 375 px ar can be made on request.
- The public site banner: MUT-365.

## What already exists (design)
- `.hp-trial-line` (TrialBanner) already reads `billingQuery`, so plan D9 needed no new query.
- `.hp-banner-info` in the drawer's banner slot (DD4, DD5).
- `SegmentedControl`, `Amount`/`<bdi>`, `--text-label`/`--muted` fine lines.
- The `account-closing` mail structure with `details` rows (DD8).
- `mailDay` for mail dates (DD7).
- `CHECKOUT_SUBMIT_MESSAGE` (DD12a).

## Design TODOs
None. Every gap was decided in scope.

## Design completion summary
- Mode: all 7 passes (D1). Outside design voice: Claude subagent, completed (Codex not installed).
- Decisions made: 12 asked (D3–D14), each answered with the recommended option. They're recorded as DD1–DD13, where DD11 is a factual restatement.
- Unresolved decisions: 0. Owed by Basel: approval of the copy deck.
- Overall design score: 4/10 → 9/10.

## Design implementation tasks (add to the build)
- [ ] **T10 (P1, human: ~1d / CC: ~45min)**: portal. DD1 Home line, DD2/DD6/DD9 the Subscribe step, DD5 the sticky default, DD4 the ended banner, DD10a–d, DD13 LapseGate and the locked page. Files: TrialBanner.tsx, BillingDrawer.tsx, LapseGate.tsx, the locked page, billingView.ts, i18n. Verify: vitest + live specs at 375 px ar.
- [ ] **T11 (P1, human: ~4h / CC: ~30min)**: server. The `expectedOffer` → 409 OFFER_ENDED with no session (DD4); `renewsAtListPrice` (DD3); `subscription.offer` + `offerId` migration (DD10b; warn the orchestrator before merge); FSI/PDI note order (DD12a). Verify: billing-routes tests, snapshot.
- [ ] **T12 (P1, human: ~3h / CC: ~20min)**: mails. DD12d trial-mail line and button; DD8 renewal template; DD7 ADR-234 override + copy.ts guard allow-list. Verify: template tests en/ar.
- [ ] **T13 (P2, human: ~30min / CC: ~5min)**: runbook. Coupon `name` (DD12b); `redeem_by` at 00:59 Jerusalem (DD10d); Stripe upcoming-renewal emails off (DD8).
- [x] **T14 (P1, Basel)**: approve the copy deck before /eng-build. Approved 2026-11-02, at 50%.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | not run for MUT-525 |
| Outside Review | native Claude Plan subagents (Codex CLI not installed) | Independent 2nd opinion | 2 | unavailable (codex); in-host completed (eng + design) | eng: 10 findings; design: 21 findings (4 already decided, the rest folded into D7–D14) |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | issues_open (all resolved into accepted scope) | 4 issues, 0 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 1 | issues_open (all resolved into accepted scope) | score: 4/10 → 9/10, 12 decisions |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | not applicable |

- **OUTSIDE COVERAGE:** Codex (external) unavailable, CLI not installed. Native Claude subagents completed for eng and design (in-host; they don't count as external coverage).
- **CROSS-MODEL:** not applicable (no completed external reviewer).
- **VERDICT:** no review CLEAR. Eng and Design have no open decisions; every finding became accepted scope. Before /eng-build, Basel approves the copy deck (T14).

NO UNRESOLVED DECISIONS
