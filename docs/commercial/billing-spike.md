# Billing for the Freelancer and Firm tiers: spike

> **Status:** spike for **MUT-332** (epic MUT-322, GA gate). Research and design only; no feature code. Internal document.
> **Researched:** 2026-10-20. Every price, fee and coverage claim below was read on that date from the page cited next to it. Fees change: re-check §2 before any build story that depends on a number.
> **Decided by Basel, 2026-10-20 (§8):** Stripe Billing + Stripe Tax; consumer checkout opens country by country; a 14-day trial with no card, then 14 days read-only, then a lockout; the founder price moves to the list price after its 12 months.

## 0. What was already decided (not re-opened here)

From MUT-322, MUT-323 and MUT-332 (Basel, 2026-10-19/20):

- **The seller is Barmajiyat Ltd (UK).** One Stripe Organization holds two accounts, **Mutaba3a** and **Malafat**. Each has its own branding, statement descriptor, keys and webhooks. Mutaba3a's billing code never sees Malafat's keys or events.
- **Pilot users are billed from day one with Stripe subscriptions made by hand in the dashboard.** Two Products, Freelancer and Firm, each priced monthly and yearly, in ILS and USD. So nothing has to migrate when the code lands (`pilot-offer.md` §5).
- **Currency:** Israeli customers pay ILS; everyone else pays USD.
- **VAT:** prices exclude it, and VAT "is added where the law requires it". The rate for each country is with the accountant (**MUT-355**).
- **Founder prices:** Freelancer ₪39 / $10 and Firm ₪299 / $80 a month; a year costs 10× the monthly price; the price is locked for 12 months. Pilot firms pay the Freelancer price until firm books v1 ships, then move to the Firm founder price, locked for 12 months from that day.
- **Malafat-fed firms pay through Malafat** as an add-on (MAL-870, billed on Malafat's own Stripe account, MAL-30). Mutaba3a must never ask them to pay a second time.
- **A lapsed account goes read-only and keeps export.** Nothing is ever deleted for non-payment.
- **GA has open signup with email verification** (MUT-331).

## 1. The answer in one page

| Question (MUT-332) | Answer |
|---|---|
| **1. Provider** | **Stripe Billing + Stripe Tax** on the Mutaba3a Stripe account. It costs the least (§3), keeps the pilot's hand-made subscriptions as they are, and shares one Organization with Malafat. The price of that choice is that Barmajiyat Ltd is the seller of record everywhere, so it owns tax registration and filing (§2.3). Also, Stripe shows no hosted page in Arabic (§2.4). Paddle is the serious alternative (§2.5). Stripe Managed Payments and Lemon Squeezy don't fit. |
| **2. Malafat tenants** | They pay through Malafat. On the Mutaba3a side, a profile with a **CONNECTED** Malafat integration is *covered by Malafat*: Mutaba3a never shows it a price. When the add-on lapses, Malafat revokes the grant and disconnects, and the profile falls back to the normal rules (§4.4). |
| **3. Entitlements** | **The person pays; the profile is what's entitled.** The Stripe Customer is the person (`User`). A **Freelancer** subscription covers every profile that person owns. A **Firm** subscription is tied to one organization, the one with `firmEnabledAt` set (MUT-300), and also covers the owner's own profiles. The server works out an **entitlement for each profile** and enforces it in the existing write gate (`store-guard.ts`). A lapsed subscription leaves the profile **read-only**: writes are refused with `SUBSCRIPTION_LAPSED`, while reads and `GET /v1/records-export` keep working. A trial that ends unpaid goes read-only for 14 days, then **locked**, which leaves Subscribe and export only (§4). |
| **4. Pilot carry-over** | Nothing moves. The operator links each hand-made subscription to its person by setting `metadata.mutaba3a_user_id` on the Stripe Customer, and the webhook picks it up. The founder price is its own Stripe Price (`lookup_key` `…_founder_…`). The 12-month lock is a **subscription schedule** with two phases, and the pilot firms' move to the Firm founder price is a schedule phase as well (§5). |
| **5. Prices on the site** | Only once **all** of these are true: checkout, entitlements and the lapse gate are live; the GA list prices are set; MUT-355's tax answers are in the Stripe settings; and the terms (MUT-324) cover billing, renewal and cancellation. The MUT-171/185 honesty tests change in that same release, not before (§6). |

Costs per month, from the model in §3:

| Paying users | Revenue / month | Stripe Billing + Tax | Paddle (MoR) | Stripe Managed Payments (MoR) |
|---|---|---|---|---|
| **10** | $205 | **$14** (6.9%) + tax compliance | $15 (7.4%) | $20 (9.9%) + Gulf/JO compliance |
| **100** | $2,050 | **$141** (6.9%) + tax compliance | $153 (7.4%) | $202 (9.9%) + Gulf/JO compliance |
| **1000** | $20,500 | **$1,408** (6.9%) + tax compliance | $1,525 (7.4%) | $2,023 (9.9%) + Gulf/JO compliance |

The percentages are close. **What actually separates the options is who registers and files tax in each country**, and whether the customer sees Arabic. §2.3 and §2.4 cover both.

## 2. The providers, side by side

### 2.1 Fees (official pages, read 2026-10-20)

| | Stripe (UK account) | Stripe Managed Payments | Paddle | Lemon Squeezy |
|---|---|---|---|---|
| Card fee | 1.5% + 20p UK; 2.5% + 20p EEA; **3.15% + 20p international** (IL, JO and the Gulf are international) | the Stripe card fees | 5% + 50¢ all in | 5% + 50¢ |
| Subscription / billing | **Billing 0.7%** of billing volume | Billing 0.7% (*not confirmed that it applies*) | included | **+0.5%** subscriptions |
| Tax | **Stripe Tax 0.5%** a transaction (no-code) or £0.40 (API), **only where you're registered** | waived on MP transactions | included | included |
| Merchant of record | — | **+3.5%** | included | included |
| International / FX | **+2%** when a currency is converted | +2% | conversion spread *not published* | **+1.5%** international; 1% payout fee outside the US |

Sources: [stripe.com/gb/pricing](https://stripe.com/gb/pricing); [paddle.com/pricing](https://www.paddle.com/pricing) ("bespoke pricing" for products under $10); [Lemon Squeezy fees](https://docs.lemonsqueezy.com/help/getting-started/fees).

### 2.2 Currencies and payouts

- **Stripe:**
  - USD charges can settle in a **USD bank account** with no conversion. Multi-currency settlement is available to UK accounts ([payouts](https://docs.stripe.com/payouts), [multi-currency settlement](https://docs.stripe.com/payouts/multi-currency-settlement)). Barmajiyat Ltd should add a USD account.
  - ILS charges almost certainly convert to GBP at +2%. Whether ILS can settle as ILS for a UK account **isn't confirmed**: the per-country table didn't render. Check it in the dashboard (an MUT-360 acceptance criterion).
  - **ILS** is a Stripe charge currency (minimum ₪0.50, [currencies](https://docs.stripe.com/currencies)). That it's offered to a **UK** account is very likely but **not confirmed**. Check it in test mode before the first pilot invoice.
  - **JOD** is a three-decimal currency Stripe supports, but isn't confirmed for UK accounts. **Not needed:** non-Israeli customers pay USD.
- **Paddle:**
  - 33 checkout currencies, ILS included. **No JOD, AED, SAR, QAR, KWD, BHD or OMR**; that's fine, since those customers pay USD.
  - Payouts go to a UK company in GBP or USD, monthly, with a $100 minimum ([supported currencies](https://developer.paddle.com/concepts/sell/supported-currencies), [payout fees](https://www.paddle.com/help/manage/get-paid/is-there-a-fee-taken-for-payouts)).
- **Lemon Squeezy:** it can *show* prices in ILS, but **every charge is processed in USD** ([currencies](https://docs.lemonsqueezy.com/help/payments/currencies)). That breaks the "Israelis pay ILS" decision.

### 2.3 Tax: the deciding factor

With Stripe Billing, **Barmajiyat Ltd is the seller of record**: it registers, collects, files and pays. Stripe Tax only *calculates* the tax, and only in countries it supports and where you've uploaded a registration. A merchant of record (Paddle, Managed Payments) does all of this itself in the countries it covers.

**What a UK company selling SaaS to consumers (B2C) owes.** Business buyers (B2B) are reverse charge almost everywhere, so the buyer accounts for the tax.

| Market | Rate | Registration for a non-resident B2C seller | Stripe Tax calculates? | MP covers? | Source |
|---|---|---|---|---|---|
| **Israel** | 18% | **Unclear.** Sources conflict on whether B2C VAT on foreign digital services is in force. A question for MUT-355. | **No**: IL isn't supported | **Yes** | [PwC IL (29 Jun 2026)](https://taxsummaries.pwc.com/israel/corporate/other-taxes); [Avalara](https://www.avalara.com/us/en/vatlive/global-vat-gst-on-e-services.html) |
| **Jordan** | 16% GST | **In force**: a platform for non-resident e-service providers opened in Jan 2024. Whether there's a JOD 30,000 threshold or none is disputed. | **No** | **No** | [Orbitax (29 Feb 2024)](https://orbitax.com/news/country/article/Jordan-Launches-Registration-P-55066); [Quaderno](https://quaderno.io/guides/jordan-gst-guide/) |
| **UAE** | 5% | **From the first sale**, no threshold | Yes | **No** | [Stripe: UAE](https://docs.stripe.com/tax/supported-countries/asia-pacific.md?tax-jurisdiction-asia-pacific=united-arab-emirates); [PwC AE](https://taxsummaries.pwc.com/united-arab-emirates/corporate/other-taxes) |
| **Saudi Arabia** | 15% | From the first sale | Yes | Yes | [Stripe: SA](https://docs.stripe.com/tax/supported-countries/asia-pacific.md?tax-jurisdiction-asia-pacific=saudi-arabia) |
| **Bahrain** | 10% | From the first supply | Yes | **No** | [Stripe: BH](https://docs.stripe.com/tax/supported-countries/asia-pacific.md?tax-jurisdiction-asia-pacific=bahrain); [PwC BH](https://taxsummaries.pwc.com/bahrain/corporate/other-taxes) |
| **Oman** | 5% | No threshold, since 2021; needs a local representative | Yes | **No** | [Stripe: OM](https://docs.stripe.com/tax/supported-countries/asia-pacific.md?tax-jurisdiction-asia-pacific=oman) |
| **Qatar, Kuwait** | no VAT | — | n/a | n/a | [PwC QA](https://taxsummaries.pwc.com/qatar/corporate/other-taxes); [PwC KW](https://taxsummaries.pwc.com/kuwait/corporate/other-taxes) |
| **EU** | the member state's rate | Non-Union OSS **from the first euro** (the €10,000 threshold is for EU sellers only) | Yes; Stripe files non-Union OSS registered in Ireland | Yes | [EC OSS](https://vat-one-stop-shop.ec.europa.eu/one-stop-shop/register-oss_en); [Stripe filing](https://docs.stripe.com/tax/filing) |
| **UK** | 20% | Above £90,000 of taxable turnover; whether Barmajiyat Ltd is already registered is a question for MUT-355 | Yes | Yes | [gov.uk threshold](https://www.gov.uk/government/publications/vat-increasing-the-registration-and-deregistration-thresholds) |

What this means:

1. **Stripe Tax can't calculate Israel or Jordan** ([supported countries](https://docs.stripe.com/tax/supported-countries)). If MUT-355 says Israeli B2C VAT is due, we add a **manual Tax Rate** (Stripe Billing supports fixed tax rates) for IL customers who don't give a VAT number.
2. **Business buyers make most of this go away.** Checkout collects tax IDs (`ae_trn`, `sa_vat`, `bh_vat`, `om_vat`, `eu_vat`, `gb_vat`), and Stripe Tax then applies reverse charge whenever the ID's format is valid ([tax IDs](https://docs.stripe.com/tax/checkout/tax-ids)). Israel and Jordan have no Stripe tax-ID type, so we collect those numbers as a custom field. Our firm buyers (lawyers, accountants) are almost all businesses. Many freelancers are too, but not all.
3. **The real exposure is Gulf consumers.** One UAE, Bahrain or Oman consumer creates a registration duty from the first sale. That duty exists whichever provider we pick, because even Managed Payments leaves AE, BH and OM to us. Only Paddle takes it on fully.
4. **Stripe Tax registration monitoring** only starts notifying after $10k a year of revenue, and never watches the UK ([monitoring](https://docs.stripe.com/tax/monitoring)). It's no substitute for MUT-355's answer.

### 2.4 Arabic: a gap no Stripe option fills

| Surface | Stripe | Paddle | Lemon Squeezy |
|---|---|---|---|
| Hosted checkout | **No Arabic or Hebrew.** The `locale` enum has 41 values, `ar` isn't one ([API, 2026-10-20](https://docs.stripe.com/api/checkout/sessions/create)) | **Arabic, yes** (one of 18 languages); RTL quality not stated ([Paddle help](https://www.paddle.com/help/start/intro-to-paddle/do-you-offer-localised-checkouts)) | No ([customization](https://docs.lemonsqueezy.com/help/online-store/customization)) |
| Customer portal (card, cancel) | No Arabic: 40 languages ([customer management](https://docs.stripe.com/customer-management)) | Arabic (same set) | No |
| Invoice and receipt emails and PDFs | No Arabic: 41 languages ([invoicing](https://docs.stripe.com/invoicing/customize)) | Arabic (same set) | No |

**What we do about it on Stripe:**

- The plan choice, the price, the VAT sentence and "what happens if I stop paying" are all on **our own page** (portal › Settings › Billing), in Arabic first.
- Stripe's page is then only for the card form, in English, with `custom_text` repeating the key line in Arabic.
- The pilot already lives with English invoices from the dashboard.

Every option except Paddle has this gap.

### 2.5 The alternatives, and why they come second

- **Paddle (MoR).**
  - **For:** it registers and files everywhere we sell, Gulf B2C included; its checkout, portal and invoices are in Arabic; and IL, JO and the whole Gulf can buy ([Paddle countries](https://www.paddle.com/help/legal/sanctions/which-countries-are-supported-by-paddle)).
  - **Against:**
    - It splits Barmajiyat's billing across two providers (Malafat stays on Stripe, MAL-30).
    - The pilot subscriptions would have to migrate. Paddle runs migrations: card data goes through their PCI vault and takes a median of 12 days ([Paddle migration](https://paddle.com/seller-guides/subscription-migration)).
    - Pricing for products under $10 is "bespoke" (our Freelancer price is exactly $10).
    - The ILS→USD/GBP payout conversion spread isn't published.
  - **When to switch:** if Gulf or Jordanian *consumer* demand turns real and registering in 3–4 Gulf states costs more than about 0.5% of revenue.
- **Stripe Managed Payments (Stripe as MoR).**
  - It costs +3.5% (preview since Feb 2026, in the April release API, [changelog](https://docs.stripe.com/changelog/dahlia/2026-04-22/managed-payments)). UK sellers are eligible ([eligibility](https://docs.stripe.com/payments/managed-payments/eligibility)).
  - It doesn't fit, for three reasons:
    - **Existing subscriptions can't join** ([update checkout](https://docs.stripe.com/payments/managed-payments/update-checkout)). The pilot subscriptions would stay outside it for good.
    - It **leaves AE, BH, OM and JO to us anyway** ([tax compliance](https://docs.stripe.com/payments/managed-payments/tax-compliance)).
    - Customers see "Sold through Link" and a `LINK.COM*` statement line, not Mutaba3a ([how it works](https://docs.stripe.com/payments/managed-payments/how-it-works)).
  - **One thing worth noting:** it *does* cover Israel. If MUT-355 finds that Israeli B2C VAT applies and registering there is costly, look at it again.
- **Lemon Squeezy:** out.
  - It charges every customer in USD, has no Arabic, and is the most expensive of the four.
  - Its own team is building Managed Payments as its successor ([LS 2026 update](https://www.lemonsqueezy.com/blog/2026-update)).

## 3. The cost model

**Assumptions** (change them and the shape holds):

- Paying users are **85% Freelancer, 15% Firm**, all monthly. That's **$20.50 average revenue per user a month** (₪39 ≈ $10.5 is treated as $10).
- **60% pay in ILS**, converted to GBP at +2%. **40% pay in USD**, settled to a USD account with no conversion.
- Every card is "international" for a UK account: 3.15% + 20p ≈ $0.27 at about $1.34 to the pound.
- Stripe Tax 0.5% on every charge. That's an upper bound: it's only charged where we're registered.

| Option | Fee per user per month | 10 users | 100 users | 1000 users |
|---|---|---|---|---|
| **Stripe Billing + Tax**: 3.15 + 0.7 + 0.5 + 1.2 (FX) = 5.55% + $0.27 | $1.41 | **$14** | **$141** | **$1,408** |
| **Paddle**: 5% + 50¢ a charge | $1.53 | $15 | $153 | $1,525 |
| **Managed Payments**: 3.15 + 0.7 + 3.5 + 1.2 = 8.55% + $0.27 | $2.02 | $20 | $202 | $2,023 |
| **Lemon Squeezy**: 7% + 50¢ + 1% payout | ~$2.12 | $21 | $212 | $2,120 |

**Not in the table:**

- **Tax compliance on Stripe:** registrations, filing and any Gulf representative. That's a fixed cost no matter how many users there are. MUT-355 prices it. At 10 users it's likely bigger than every fee above combined. At 1000 users it's small next to Paddle's ~$117 a month premium plus the cost of Paddle doing the work.
- **Yearly plans** cut the fixed 20p (and Paddle's 50¢) to one charge a year. Every yearly payer narrows Paddle's gap on the $10 plan.
- **Disputes:** Stripe charges £20 a dispute. A MoR absorbs disputes into its fee.
- **Build cost:** the same for both Stripe options (§7). Paddle needs the same entitlement work, its own webhook mapping, and the pilot migration.

## 4. Entitlements design

### 4.1 Who pays, what is entitled

- **The paying unit is a person.** One `User` ↔ one Stripe Customer (`BillingAccount`).
  - The profile cap (6 owned profiles, MUT-182) is already per person.
  - The Freelancer tier is "personal + business profiles", which is a person's set of owned profiles.
- **What's entitled is a profile.** Write gating already works per profile (`writability.ts`, `store-guard.ts`), and the Firm tier is per organization (`firmEnabledAt`, MUT-300 D4: enabled in place on an owned Business profile).

| Profile | Covered by |
|---|---|
| A person's own profile (personal, or an owned Business), not a firm | the owner's **Freelancer** *or* **Firm** subscription (Firm includes Freelancer) |
| An owned Business profile with `firmEnabledAt` set | a **Firm** subscription whose `organizationId` is that profile |
| A profile with a CONNECTED Malafat integration | **Malafat** (never priced here) |
| Any profile, by operator decision (pilot comp, internal, a dispute) | an **operator grant**, with a reason and an expiry |
| A new account in its first days | the **trial** (§8 D3) |

**Firm staff** (MUT-305/306, after the pilot) reach a firm through the firm's own subscription. No seats are charged: the price is per firm. Whether a staff member's *own* personal profile is covered is a firm-v3 question. Until invites exist it can't come up.

### 4.2 Data model (server, Prisma)

```text
BillingAccount        id, userId (unique), stripeCustomerId (unique), country, currency ILS|USD, createdAt
BillingSubscription   id, billingAccountId, stripeSubscriptionId (unique), tier FREELANCER|FIRM,
                      organizationId? (required when FIRM), status (Stripe's), currentPeriodEnd,
                      cancelAtPeriodEnd, priceLookupKey, founderUntil?, stripeUpdatedAt, updatedAt
EntitlementGrant      id, userId? | organizationId?, tier, reason, expiresAt?, grantedBy, revokedAt?
StripeEvent           id (evt_…), type, receivedAt, processedAt?, error?   -- idempotency + replay
```

- The **tier comes from the Stripe Product**: `metadata.tier = freelancer|firm`. It never comes from the amount, so founder prices and list prices resolve the same way.
- **Stripe's Entitlements API isn't used.** Two tiers and a per-profile rule fit in a column. Its webhook summary holds at most 10 entitlements anyway ([entitlements](https://docs.stripe.com/billing/entitlements)).

### 4.3 The resolver and the gate

`entitlementOf(profile)` returns `{ state, source, tier, until }`:

- `source` ∈ `MALAFAT | OPERATOR | STRIPE | TRIAL | NONE`. The checks run in that order, and the first one that covers the profile wins.
- `state` ∈ `ACTIVE | GRACE | READ_ONLY | LOCKED`. Stripe statuses map like this:
  - `active` and `trialing` → ACTIVE.
  - `past_due` → **GRACE**: Smart Retries are still trying, by default 8 tries in 2 weeks ([smart retries](https://docs.stripe.com/billing/revenue-recovery/smart-retries)). The person keeps full access and sees a banner.
  - `unpaid`, `canceled` or `incomplete_expired` → **READ_ONLY**, for good: a person who once paid is never locked out (MUT-322 decision).
  - `cancel_at_period_end` stays ACTIVE until the period ends.
- **The trial** (§8 D3) has no Stripe object. It's worked out from the person's verification time:
  - days 0–14: **ACTIVE** (`source = TRIAL`);
  - days 14–30: **READ_ONLY**;
  - day 30 onward: **LOCKED**.

  LOCKED only ever applies to a person who never had a subscription.

**The gate is one new rule in `store-guard.ts`, next to READ_ONLY_PROFILE, plus one check in `authenticate()`:**

- A **session** write on a READ_ONLY or LOCKED profile throws `ApiError('SUBSCRIPTION_LAPSED', …, { profileId, state, since })`.
- On a **LOCKED** profile, session *reads* are refused too, except the routes in the list below. The portal and the phone then show only a "Subscribe or download your records" screen. A lockout never deletes anything: the records stay until the person subscribes or closes the account.
- These keep working in every state:
  - every read;
  - `GET /v1/records-export` and its receipts (already GET);
  - the `identity` row (`/v1/me*`, sign-out, password);
  - the new `/v1/billing/*` routes.
- **API-key writes (Malafat) are never billing-gated.** Their coverage is Malafat's business.
- **Nothing is deleted, ever.** Lapsing doesn't start account closing. The 30-day close-and-delete only starts when the person asks.

`GET /v1/me` gains `billing: { state, source, tier, until }` for each profile. The portal and the phone use it to show a banner and grey out "Add". A refused write still explains itself through the error code.

### 4.4 Malafat-covered firms (MAL-870)

- **v1:** a CONNECTED `Integration(provider=MALAFAT)` means `source = MALAFAT`. That's already true of every Malafat-fed profile.
- **When the add-on lapses,** Malafat revokes the OAuth grant (MAL-870 recommends a revocation reason separate from FIRM_DISABLED) and disconnects. The profile then has no source: it becomes LAPSED and read-only with export, exactly like any other lapse.
- A bound firm never reaches checkout, because the portal hides Billing on profiles where `source = MALAFAT`.
- **No billing data crosses between the two Stripe accounts.**

### 4.5 Webhooks and reconciliation

- **Endpoint:** `POST /v1/billing/stripe/webhook`.
  - Takes the raw body and verifies `Stripe-Signature` against `STRIPE_WEBHOOK_SECRET`.
  - Secrets live in Secret Manager. Claude writes the Terraform; Basel applies it.
  - It isn't behind session auth and is rate-limited separately.
- **Events:**
  - `checkout.session.completed`;
  - `customer.subscription.created|updated|deleted`;
  - `customer.subscription.paused|resumed`;
  - `invoice.paid`;
  - `invoice.payment_failed`;
  - `customer.updated` (tax IDs, country).
- **Handling:**
  1. Insert into `StripeEvent`. A duplicate `id` returns 200 and stops there.
  2. **Re-fetch the subscription from Stripe** instead of trusting the payload, since events can arrive out of order.
  3. Upsert by `stripeSubscriptionId`, then write an audit event (`billing.subscription_changed`).
- **Linking a customer to a person:**
  - Checkout sessions carry `client_reference_id = userId`.
  - Hand-made pilot customers carry `metadata.mutaba3a_user_id`, and Firm subscriptions also carry `metadata.mutaba3a_organization_id`.
  - An event for an unlinked customer is stored and listed for the operator, never guessed.
- **Nightly reconcile job:** lists every subscription updated since the last run and repairs any drift. Missed webhooks heal within a day.

### 4.6 Signup, trial and checkout (the contract with MUT-331)

1. MUT-331's signup: email → verify → set password → first profile. **No tier picker:** every new account starts as **Freelancer**. Firm stays "request firm features" (MUT-300), decided by the operator for now.
2. The trial starts at verification (§8 D3). No card is asked for, and no Stripe object exists yet.
3. Portal › Settings › Billing, in Arabic first, shows the plan, the price for the person's country, the VAT sentence and the lapse rule. **Subscribe** calls `POST /v1/billing/checkout-session` (server-made Checkout, `mode=subscription`):
   - `automatic_tax` on;
   - `tax_id_collection` on;
   - the currency comes from the person's country: ILS for IL, otherwise USD;
   - `locale: 'auto'`.
4. **Manage billing** calls `POST /v1/billing/portal-session` (Stripe Customer Portal: card, invoices, cancel at period end).
5. When the trial ends without a subscription, the account goes **READ_ONLY** for 14 days (export and Subscribe available), then **LOCKED** on day 30 (Subscribe and export only). Subscribing at any point makes it ACTIVE again at once. The webhook's `checkout.session.completed` is enough; nothing has to be migrated.
6. **Which countries can check out as consumers** (§8 D2) comes from a config list, `config/billing-countries.json`, the same pattern as `config/hosts.json`. A person whose billing country isn't on the list sees checkout with **business tax ID required** (`tax_id_collection.required = 'if_supported'`, plus a required custom field for IL and JO numbers). A consumer in such a country sees "contact us" instead. Opening a country is one config line, added once Barmajiyat Ltd is registered there.

**Payment Links aren't needed.** Pilot users already have subscriptions, and GA uses server-made Checkout so `client_reference_id` is always set.

## 5. Pilot carry-over

The pilot is billed in Stripe from day one, so carry-over is only linking and scheduling:

1. **Catalog** (done by hand now, checked by a script later). Product `Freelancer` (`metadata.tier=freelancer`) and Product `Firm` (`metadata.tier=firm`). Their Prices have lookup keys:
   - `freelancer_founder_{monthly|yearly}_{ils|usd}`
   - `firm_founder_{monthly|yearly}_{ils|usd}`
   - later the GA list prices: `freelancer_list_…` and `firm_list_…`

   Prices are immutable, so founder and list prices sit side by side for good.
2. **Linking:** when the operator creates a pilot subscription, they also set `metadata.mutaba3a_user_id` on the Customer. Add it to the runbook step in `pilot-offer.md` §5 now. After that, MUT-360's webhook and nightly reconcile pick the subscription up with no code path specific to the pilot.
3. **The 12-month lock** is a subscription schedule: phase 1 is the founder price for 12 months, then phase 2 is the **GA list price** (§8 D4). Schedules are editable in the dashboard ([schedules](https://docs.stripe.com/billing/subscriptions/subscription-schedules)). Before a lock ends:
   - Stripe's upcoming-renewal email goes out;
   - the operator sends our own note in EN + AR, 30 days ahead.

   The list prices must exist before the first pilot lock ends (about 12 months after the first pilot signup). Until then, phase 2 holds the founder price and the runbook carries a reminder to swap it in.
4. **Pilot firms** start on a `freelancer_founder_*` price with `metadata.mutaba3a_organization_id` set. When firm books v1 ships, the operator tells the firm first, then adds a schedule phase that swaps in `firm_founder_*` with a new 12-month lock (`pilot-offer.md` §2).
5. **Existing invoices** stay in Stripe. Nothing is re-issued.

## 6. When prices can go on the landing page

The MUT-171/185 rule ("no price without a billing system") lifts in the release where **all** of these hold:

1. MUT-358, MUT-360, MUT-361 and MUT-362 are live and their release-QA specs pass: anyone can subscribe, lapse and export without the operator.
2. Basel has set the **GA list prices**. The founder prices are the pilot's, so they're never what the site shows.
3. MUT-355's answers are in Stripe's tax settings, and the site's VAT line says the same as the offer: "Prices exclude VAT; VAT is added where the law requires it."
4. The terms (MUT-324) cover renewal, cancellation at period end, lapse = read-only, and refunds.
5. The landing and /hosted honesty tests flip **in the same change**: they stop forbidding price words and start checking that the shown prices match the Stripe catalog's `*_list_*` lookup keys. That's MUT-365.

Until then, the pilot price goes out by hand, as it does now.

## 7. Build stories (filed under MUT-322, label `ga-gate`)

| Key | Story | Blocked by |
|---|---|---|
| **MUT-358** | Billing core: tables, `entitlementOf`, `billing` on `/v1/me`, operator grant/link CLI, Malafat = covered | — |
| **MUT-360** | Stripe webhook + nightly reconcile; Secret Manager Terraform; pilot linking runbook | MUT-358 |
| **MUT-361** | Lapse gate: read-only (with export) and locked, on the server and in the portal (ar/en, RTL) | MUT-358 |
| **MUT-362** | Self-service subscribe and manage: Settings › Billing, Checkout, Customer Portal, the trial, the country list | MUT-358, MUT-360, MUT-331 |
| **MUT-363** | Firm tier billing: firm features ↔ Firm subscription; the pilot firms' price move | MUT-358, MUT-360, MUT-300 |
| **MUT-364** | Phone: billing state, read-only and locked screens (Flutter) | MUT-358, MUT-361 |
| **MUT-365** | Prices on the landing page and /hosted; the honesty tests check the catalog | MUT-362, MUT-355, MUT-324 |

MUT-359 isn't one of these: another session took that number.

## 8. Decisions (Basel)

Asked in the MUT-332 session, one decision at a time, on 2026-10-20.

- **D1. Provider: Stripe Billing + Stripe Tax** on the Mutaba3a Stripe account. This confirms the 2026-10-19 choice.
  - Barmajiyat Ltd is the seller of record and owns registration and filing (MUT-355).
  - Arabic is handled by our own Billing page ahead of Stripe's English card form (§2.4).
  - **Revisit Paddle** if consumer sales in the Gulf or Jordan become real (§2.5).
- **D2. Consumer checkout opens country by country** (`config/billing-countries.json`).
  - It starts with Israel, the UK, and wherever MUT-355 says we're already covered.
  - Everywhere else, checkout needs a business tax ID (reverse charge) until Barmajiyat Ltd registers there. Consumers in those countries see "contact us".
- **D3. Trial: 14 days, no card.**
  - Then **14 days read-only** (with export and Subscribe).
  - Then, **from day 30, lockout** if no card was added: the only thing left is a screen with Subscribe and Download my records. Nothing is deleted.
  - This is only for people who never paid. A paying subscriber who lapses stays read-only with export indefinitely (MUT-322).
  - *Interpretation, flagged for Basel:* "complete lockout" keeps **Download my records**, so the "your data is yours" promise still holds.
- **D4. When the founder lock ends, the subscription moves to the GA list price** through its subscription schedule, with a 30-day notice. The offer's "locked for 12 months" wording stays as it is.

**Still open, owned elsewhere:**

- **The VAT answers by country:** MUT-355. They block the first invoice and MUT-365.
- **The GA list prices:** Basel, before MUT-365, and at the latest before the first founder lock ends.
- **Whether a firm member's own profile is covered:** firm v3 (MUT-305/306).
- **Signup abuse controls** (rate limits, Turnstile, disposable-email policy): MUT-331. Billing needs nothing extra.
