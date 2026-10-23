# MUT-362: Self-service subscribe and manage (Settings › Billing, Checkout, Customer Portal, the trial)

> **Ticket:** MUT-362 (epic MUT-322, `ga-gate`). Blocked by MUT-358 (merged 52a677f8), MUT-360 (merged 9c7a1ed0) and MUT-331 (Done). It blocks MUT-365.
> **Source design:** `docs/commercial/billing-spike.md` §2.4, §4.6 and §8 D2/D3; ADR-160 and ADR-165.
> **Status:** approved plan. `/eng-ticket` drafted it and `/plan-eng-review` reviewed it (2026-10-22); Basel answered D1–D9 (decision ledger below). Sections 1–8 include every accepted change.
> **Basel's framing (2026-10-22):** the GA list prices and the consumer country list are **config inputs filled in later**. The code ships with neither set and stays honest about it ("Subscriptions open soon"; every country needs a business tax ID).

## 1. Problem and acceptance criteria

GA's gate is "anyone can sign up, pay and leave with no help from the operator". After MUT-358/360 the server can mirror a subscription, but nobody can start one, change a card or cancel without the operator. Stripe's hosted pages have no Arabic (spike §2.4), so everything the person needs to understand is on our own page first.

From the ticket:

- [ ] AC1. In test mode, a new signup can subscribe in ILS (an IL billing address) and in USD, and comes back ACTIVE through the webhook.
- [ ] AC2. A consumer from a country not on the list can't reach the card form; a business with a tax ID can.
- [ ] AC3. Manage billing opens the Customer Portal; cancelling keeps access until the period ends, then READ_ONLY.
- [ ] AC4. Settings › Billing in ar/en, RTL at 375px; no Stripe page is shown before our own Arabic explanation.
- [ ] AC5. Release-QA: `billing.subscribe` and `billing.manage` features with passing specs (Stripe test mode).
- [ ] Ticket scope: OpenAPI + `openapi:check`; Customer Portal configured in the dashboard and recorded in the runbook.

**Read against what exists:**

- AC3's "then READ_ONLY" is the **reported** state (`/v1/me` `billing.state`). Refusing writes is MUT-361 (Backlog). This ticket proves the state flips; MUT-361 enforces it.
- The trial is **shown**, not started. `User.trialStartedAt` is set by MUT-366's signup (Backlog). Until then, only an account whose `trialStartedAt` is set by hand (tests, QA, `setTrialStart`) shows a trial. The view handles `TRIAL` sources fully, so nothing changes here when MUT-366 lands.
- "Settings › Billing": the portal has no Settings page. "Settings › Your data" is already an account-menu drawer (`?yourData=true`, MUT-325). Billing follows the same pattern: **an account-menu drawer, `?billing=true`** (drawer-first rule).

**Out of scope (ticket):** Firm tier purchase (MUT-363), prices on the landing page (MUT-365), the phone (MUT-364), the lapse gate (MUT-361), signup (MUT-366/368).

## 2. Design

```
Portal account menu ─▶ BillingDrawer (?billing=true)        all copy ours, Arabic first
   │ GET /v1/billing ─────────────▶ billing summary + catalog + country rules (one read)
   │ Subscribe: country + "as a person / as a business" + monthly|yearly
   │ POST /v1/billing/checkout-session ─▶ planCheckout (pure) ─▶ CheckoutGateway
   │      ◀── { url } ──────────────────   find-or-create customer, prices by lookup key,
   │ window.location = url (Stripe card form, English + our Arabic custom_text)
   │ … Stripe ─▶ checkout.session.completed ─▶ MUT-360 webhook (unchanged) ─▶ billing_subscriptions
   │ success_url = <portal>/<returnPath>?billing=true&checkout=success
   │ drawer polls /v1/me until the profile is STRIPE/ACTIVE (bounded), then "You're subscribed"
   │
   │ Manage billing: POST /v1/billing/portal-session ─▶ { url } ─▶ Stripe Customer Portal
   └ return_url = <portal>/<returnPath>?billing=true
```

### 2.1 Config: the two inputs Basel fills later

**Prices: the Stripe catalog itself, by lookup key.** No price lives in our code or config. The server asks Stripe for the four GA keys:

```
freelancer_list_monthly_ils   freelancer_list_yearly_ils
freelancer_list_monthly_usd   freelancer_list_yearly_usd
```

The key names are a code constant (`GA_PRICE_LOOKUP_KEYS`, `server/src/billing/checkout.ts`), the convention from spike §5.1. Basel creates the Prices in the dashboard when he sets the GA prices. Until a currency has both keys, that currency is **unavailable**: the drawer says "Subscriptions open soon" and checkout answers 503 `PRICES_NOT_SET`. The catalog is cached in-process for 10 minutes (one `prices.list` per instance per 10 min; a price change shows within 10 min, or at once on restart).

**Countries: `server/billing-countries.json`**, validated at boot (fail fast, like `config/hosts.json`):

```json
{
  "consumerCountries": [],
  "customTaxIdCountries": ["IL", "JO"]
}
```

- `consumerCountries`: where a person (no tax ID) may check out (D2 of the spike). **Ships empty**: until Basel fills it from MUT-355's answers, every buyer needs a business tax ID and consumers see "contact us". That's the safe default: no B2C sale lands where Barmajiyat Ltd isn't registered. A before-release line records the fill-in (spike D2 starts with IL and GB).
- `customTaxIdCountries`: countries Stripe has no tax-ID type for, so a business enters its number in a Checkout custom field (spike §2.3 point 2).
- **Why not `config/billing-countries.json` at the root (the ticket's path):** the API image's build context is `server/` (`server/Dockerfile`); root `config/` never reaches it. The server owns the file and hands its contents to the portal in `GET /v1/billing`, so there's one source.

### 2.2 Server: Stripe write port, `server/src/billing/stripe/checkout-gateway.ts`

MUT-360's `StripeGateway` is documented and reviewed as **read-only**. Checkout needs writes, so they get their own narrow port instead of widening that contract:

```ts
interface CheckoutGateway {
  /** GA prices by lookup key, product expanded. Missing keys are simply absent. */
  pricesByLookupKey(keys: readonly string[]): Promise<Map<string, { id: string; currency: string; unitAmount: number; interval: 'month' | 'year'; tier: string | null }>>;
  /** A customer carrying metadata.mutaba3a_user_id = userId: an existing one (listed by email), else created with an idempotency key. */
  customerFor(person: { userId: string; email: string; name: string }): Promise<string>;
  createCheckoutSession(params: Stripe.Checkout.SessionCreateParams): Promise<{ url: string }>;
  createPortalSession(params: { customer: string; returnUrl: string }): Promise<{ url: string }>;
}
```

- Built from the same `STRIPE_SECRET_KEY` (Q1), with `CHECKOUT_BUDGET = { timeoutMs: 8_000, maxNetworkRetries: 1 }`: a person is waiting, and the SDK adds idempotency keys to retried POSTs, so one retry is safe.
- Imports `toGatewayError` and the pinned `STRIPE_API_VERSION` from `gateway.ts`, both already exported; `gateway.ts` itself is not changed (eng review D1, smaller arrangement).
- **The 10-minute price cache lives here too** (`pricesByLookupKey` keeps one `prices.list` result per instance for 10 minutes, injected `now`).
- **`customerFor` closes MUT-360's OV-7 gap (Q2):**
  1. The person has a `BillingAccount` → its `stripeCustomerId` (the Jira contract on MUT-362). No Stripe call.
  2. Else `customers.list({ email })` (strongly consistent, unlike Search) and take the one whose `metadata.mutaba3a_user_id` is this person.
  3. Else `customers.create({ email, name, metadata: { mutaba3a_user_id } }, { idempotencyKey: 'mut362-customer-' + userId })`.

  So two tabs, or a second Subscribe after an abandoned one, reuse one customer, and the customer carries the link even if `client_reference_id` were ever lost. No `billing_accounts` row is written here: MUT-360 D6 keeps `syncSubscription` the only creator.
- Tests: recorded-JSON fixtures through `Stripe.createFetchHttpClient(fakeFetch)`, as `stripe-gateway.test.ts` does (asserts paths, expand, idempotency header, metadata).

### 2.3 Server: the decision, pure, `server/src/billing/checkout.ts`

`planCheckout(input, facts, rules, catalog)` decides everything without Stripe, and returns either an error code or the exact `SessionCreateParams` minus the customer:

| Input | Outcome |
|---|---|
| The person has a live subscription (`active`, `trialing`, `past_due`, `incomplete`) | 409 `ALREADY_SUBSCRIBED` (the drawer shows Manage billing instead) |
| The person has an `unpaid` subscription (eng review D6) | 409 `RESUME_IN_PORTAL` (pay the open invoice in Manage billing; Stripe locks the customer's currency while it exists) |
| The person has a `paused` subscription (never made by our flow) | 409 `CONTACT_US` |
| The person owns no profile | 409 `NOTHING_TO_COVER` |
| Every owned profile is MALAFAT-covered | 409 `COVERED_BY_MALAFAT` (spike §4.4: never priced here) |
| Q5: every owned profile is covered by an operator grant with no expiry | 409 `COVERED_BY_GRANT` |
| `country` not `^[A-Z]{2}$` | 422 validation |
| `buyer = person` and `country ∉ consumerCountries` | 422 `COUNTRY_NEEDS_BUSINESS` (AC2) |
| currency has no complete price pair | 503 `PRICES_NOT_SET` |
| otherwise | the params below |

Currency: `country === 'IL'` → ILS, otherwise USD (spike §0).

The Checkout Session params:

- `mode: 'subscription'`, `line_items: [{ price, quantity: 1 }]` (the `freelancer_list_<interval>_<ccy>` price);
- `customer` (from `customerFor`), `customer_update: { address: 'auto', name: 'auto' }` (Stripe needs it for `automatic_tax` and tax IDs on an existing customer);
- `client_reference_id: userId`, `subscription_data.metadata.mutaba3a_user_id: userId`;
- `automatic_tax: { enabled: true }`, `billing_address_collection: 'required'`;
- tax IDs:
  - person in a consumer country: `tax_id_collection: { enabled: true }` (optional);
  - business, country with a Stripe type: `tax_id_collection: { enabled: true, required: 'if_supported' }`;
  - business, country in `customTaxIdCountries`: a required `custom_fields` text field `business_tax_number`, labelled in English and Arabic;
- `locale: 'auto'`;
- `custom_text.submit.message`: the key line in Arabic and English (the price excludes VAT; renews each period; cancel any time from Manage billing; if it stops, records stay readable and downloadable). A constant in `checkout.ts`, ≤ 1200 characters (Stripe's limit, SDK 23 `Sessions.d.ts`; a test), Basel reviews the wording;
- `expires_at`: now + 1 hour (the minimum is 30 minutes), so a forgotten tab can't be completed days later;
- `success_url` / `cancel_url`: `setupLinkOrigin(portalOrigin, requestUrl)` (reused from `auth/account-setup.ts`) + a validated `returnPath` + `?billing=true&checkout=success|cancelled`.

`returnPath` is validated against `^/(p/<uuid>(/[a-z0-9/-]*)?)?$`: never an absolute URL, so the route can't be an open redirect.

### 2.4 Server: routes, `server/src/routes/billing.ts`

Signed in only and outside `PORTAL_ROUTES` (the signed-out portal has no billing), mounted beside `recordsExportRoutes`; `security: SESSION_ONLY` as records-export. Not billing-gated (spike §4.3: `/v1/billing/*` works in every state, LOCKED included). **Person-level:** the file exports `BILLING_ORGANIZATION_INDEPENDENT_ROUTES`, added to the `organizationIndependent` set at `app.ts:219`, so none of the three needs `X-Mutaba3a-Profile` (eng review correction; without it the middleware selects a profile for them).

**`GET /v1/billing`** returns one read for the drawer:

```ts
{
  configured: boolean,                       // Stripe keys present on this server
  subscription: { tier, status, interval, currency, currentPeriodEnd, cancelAtPeriodEnd } | null,  // the person's live or latest
  canManage: boolean,                        // a linked BillingAccount exists
  trial: { startedAt, endsAt, lockAt } | null,
  catalog: { ILS: { month: amountMinor, year: amountMinor } | null, USD: … | null },
  countries: { consumer: string[], customTaxId: string[] },
}
```

`subscription` and `canManage` come from one new repository read (§2.5); `trial` from `user.trialStartedAt` and the resolver's `TRIAL_DAYS` / `TRIAL_LOCK_DAYS` constants; `catalog` from the cached prices (a Stripe failure here degrades to `null` currencies with a warn log, never a 5xx: the drawer must open for a person who only wants Manage billing).

**`POST /v1/billing/checkout-session`**: body `{ interval: 'month' | 'year', country, buyer: 'person' | 'business', returnPath }` → `{ url }`. Errors as in §2.3, plus 409 `BILLING_ACCOUNT_NEEDS_HELP` (the linked Stripe customer is gone, `resource_missing`; warn log with `stripeCustomerId` and `userId` only; eng review D7), 503 `BILLING_NOT_CONFIGURED`, 502 `STRIPE_UNAVAILABLE` (a gateway error; logged as `{ code, type, requestId }` only, as MUT-360 does), 429 (per-user limiter `BILLING_SESSION_POLICY = { perMinute: 10 }`, keyed `billing-session:<userId>`, pruned in `index.ts`, the receipt-upload pattern). Audited `billing.checkout_started` (USER actor, metadata `{ interval, currency, buyer, country }`; no Stripe ids in the profile audit).

**`POST /v1/billing/portal-session`**: body `{ returnPath }` → `{ url }`. 409 `NO_BILLING_ACCOUNT` when the person has no linked account; 409 `BILLING_ACCOUNT_NEEDS_HELP` as above; same 503/502/429. Audited `billing.portal_opened`.

OpenAPI for all three; `npm run hosted:types`; `openapi:check`; API version `1.51.0-mut362` (agree the number at build start; numbers raced before).

### 2.5 Repository (no migration)

One new read: **`billing.summaryOf(userId)`** → `{ account: BillingAccountRecord | null, subscriptions: BillingSubscriptionRecord[] }` (the person's linked account and its subscriptions, newest period first). `sessionOnly` in `STORE_ACCESS` (a person reads their own billing; the route passes `user.id` from the session, never a parameter). Prisma, memory store, and a case set in `store-contract-billing.ts`. `factsFor` is reused for the coverage checks in `planCheckout` (`entitlementsFor` over the person's owned profiles).

### 2.6 Webhook and sync: unchanged

MUT-360 already handles `checkout.session.completed` (`linkHint = client_reference_id`), `customer.subscription.updated` (`cancelAtPeriodEnd`) and `.deleted` (→ `canceled` → READ_ONLY). The only check added is a test: a Checkout-made subscription for a customer `customerFor` created (metadata set, no account row yet) is linked to the person and covers their profiles.

### 2.7 Portal

| File | What |
|---|---|
| `src/hosted/data/billingView.ts` (new, pure) | `billingViewOf({ me, billing, now })` → one panel: `trial`, `trialEnded` (read-only until lock), `locked`, `active`, `ending` (cancel at period end), `grace` (past_due), `unpaid` (pay the open invoice in Manage billing, D6), `lapsed`, `coveredByMalafat`, `coveredByGrant` (no-expiry grant, D5; a grant with an expiry shows "free until <date>" above Subscribe), `ownedByOthers`, `needsHelp` (contact us: `BILLING_ACCOUNT_NEEDS_HELP`, `CONTACT_US`), `unavailable` (not configured / prices not set). `checkoutRouteOf(country, buyer, countries)` → `card` / `card-tax-id` / `card-tax-number` / `contact-us`. `currencyOf(country)`. |
| `src/hosted/data/billingQueries.ts` (new) | `useBilling()` (TanStack Query), `useStartCheckout()`, `useOpenBillingPortal()`; on success `window.location.assign(url)`. |
| `src/hosted/data/countries.ts` (new) | ISO 3166-1 alpha-2 codes; names from `Intl.DisplayNames([locale], { type: 'region' })`, so Arabic names come free. Israel first, then the region, then A–Z. |
| `src/hosted/components/BillingDrawer.tsx` (new) | The drawer: plan + price (for the picked country's currency, `Intl.NumberFormat`), the VAT sentence, trial days left, what happens on lapse, then Subscribe (country, person/business, monthly/yearly) or Manage billing. "Contact us" = `mailto:SUPPORT_EMAIL` (as `TermsUpdatePage`) with a billing subject. On `?checkout=success` it polls `/v1/me` every 2 s for up to 30 s for this profile to turn STRIPE/ACTIVE, then says "You're subscribed"; past 30 s it says the payment went through and can take a minute to show (the nightly reconcile heals a lost webhook). `?checkout=cancelled` → "Nothing was charged." Lists each profile with its state. |
| `src/hosted/data/filters.ts` | `billing?: true`, `checkout?: 'success' \| 'cancelled'` in `ProfileDrawerSearch`; both in `SHELL_OVERLAY_KEYS`. |
| `src/hosted/shell/AccountDrawers.tsx` | `openBilling()`; renders `BillingDrawer` signed in only. |
| `src/hosted/shell/UserMenu.tsx` | "Billing" menu item, signed in only (not in local mode), beside Your data. |
| `src/hosted/i18n/{ar,en}.json` | `hosted.billing.*`. Arabic first; the VAT sentence verbatim from the offer ("Prices exclude VAT; VAT is added where the law requires it."). ICU plurals for days left (`useTp`). |
| `src/hosted/hosted.css` | Drawer pieces with logical properties only; amounts in `<bdi>` (MUT-109). |

AC4's "no Stripe page before our own Arabic explanation": Subscribe and Manage billing are only reachable from inside the drawer, after the explanation, and the redirect only happens on a button press there.

MUT-361 hand-off: its LOCKED and read-only screens link to this drawer (`?billing=true`); nothing here depends on MUT-361.

### 2.8 Billing drawer design (design review, 2026-10-22)

Wireframe: `.claude/designs/mut-362-billing-drawer-wireframe.html` (brand v2 tokens, ar/en, light/dark, 375 px). Decisions are numbered DR1… (the design review's own numbering).

- **DR1 Hierarchy, status first (Basel, D3 1A).** Every panel reads in one order: a status chip, a one-sentence headline (`Text`, display face, headline size) and one line of context; then the single action for that state; then the plan line (name, price a month, price a year), the VAT sentence and the cancel/lapse rule in label-size muted text. Wireframe §1 left.
- **DR2 Subscribe is a second step in the same drawer (Basel, D4 2A).** Subscribe swaps the drawer body to the three choices (billing country, for yourself / for a business, monthly / yearly) with a back link (‹ Back to Billing) and a pinned footer button, Continue to payment. URL `?billing=true&step=subscribe` (a new `ProfileDrawerSearch` key, in `SHELL_OVERLAY_KEYS`), so MUT-361's locked screen can open the step directly. Back and the URL step stay in sync (browser back returns to the status view). Wireframe §2.
- **DR3 The profiles list shows only when states differ (Basel, D5 3A).** "Covers your profiles" (name + state label) sits below the fine print only when the person's profiles in `/v1/me` don't all share one billing state and source (a Malafat-covered profile, a co-owned profile paid by someone else). `billingViewOf` returns it; a unit test covers both cases.

```
Billing drawer (?billing=true)                         Subscribe step (?billing=true&step=subscribe)
┌──────────────────────────────────────┐               ┌──────────────────────────────────────┐
│ Billing                            × │               │ Subscribe to Freelancer            × │
├──────────────────────────────────────┤               ├──────────────────────────────────────┤
│ [chip: state]                        │               │ ‹ Back to Billing                    │
│ Headline: where you stand (1 line)   │   Subscribe   │ Billing address country  [Select]    │
│ Context (1 line)                     │ ────────────▶ │ You're buying  (•) yourself ( ) biz  │
│ [ the one action for this state ]    │               │ Pay  [Monthly | Yearly]              │
│ ───────────────────────────────────  │ ◀──────────── │ You'll pay  ₪39 a month + VAT …      │
│ Freelancer       ₪39 a month         │     Back      │ Next: Stripe's page, in English      │
│ yearly price · VAT line · cancel rule│               ├──────────────────────────────────────┤
│ (profiles list, only if states differ)│              │              [Continue to payment]   │
└──────────────────────────────────────┘               └──────────────────────────────────────┘
        ▲  ?checkout=success|cancelled                              │ POST checkout-session → Stripe
        └────────────────────────────── return_url ◀────────────────┘
```

- **DR4 Every state is specified (Basel, D6 4A).** ar/en copy keys and a component test for each row:

  | Feature | Loading | Empty / not yet | Error | Success | Partial / waiting |
  |---|---|---|---|---|---|
  | Drawer (GET /v1/billing) | skeleton in the drawer's own layout (chip, headline, two lines, button), `aria-busy` | "Subscriptions open soon. We'll let you know before your trial ends." under the trial status when no price pair exists | rose banner "Couldn't load your billing. Check your connection and try again." + Try again | the state panel (DR1) | catalog `null` but account known: status and Manage billing shown, Subscribe replaced by "open soon" |
  | Continue to payment / Manage billing | the button shows busy (spinner + same label), disabled, until Stripe answers; double presses ignored | n/a | inline error under the button: "We couldn't reach the payment page. Try again in a moment." Choices are kept | browser goes to Stripe | n/a |
  | Contact-us outcomes (`COUNTRY_NEEDS_BUSINESS`, `CONTACT_US`, `BILLING_ACCOUNT_NEEDS_HELP`) | n/a | n/a | info or rose banner with the reason, Contact us (mailto `SUPPORT_EMAIL`, billing subject) | n/a | n/a |
  | Return `?checkout=success` | "Confirming your payment…" (butter chip, `aria-live=polite`) polling 2 s × 30 s (eng D4) | n/a | after 30 s: "Your payment went through. It can take a minute to show here; you can keep working." | mint banner "You're subscribed. Thank you." then the Active panel | n/a |
  | Return `?checkout=cancelled` | n/a | n/a | n/a | info banner "Nothing was charged." over the status panel | n/a |
- **DR5 The Billing item always shows when signed in (Basel, D7 5A).** Never in local mode. With `configured: false` the drawer shows the status panel and DR4's "Subscriptions open soon" in place of Subscribe; Manage billing is hidden. No `/v1/me` change and no fetch on shell mount.
- **DR6 Warn before the English hand-off (Basel, D8 6A).** Above Continue to payment: "Next you'll enter your card on Stripe's secure page. It's in English; you'll come back here when you're done." Under Manage billing: "Change your card, see invoices or cancel, on Stripe's page (in English)." ar/en keys; Stripe's `custom_text` stays as planned.

Journey storyboard (the approved flow):

| Step | User does | User feels | Plan specifies |
|---|---|---|---|
| 1 | Opens Billing from the account menu during the trial | "How long do I have, and what then?" | DR1 status first: days left, what happens after, price below |
| 2 | Presses Subscribe | Committing, a little wary | DR2 a short second step with a back link |
| 3 | Picks country, for themselves or a business, monthly or yearly | "Is this the right price for me?" | the summary line updates to their currency + VAT line |
| 4 | Reads the heads-up and presses Continue | Ready for the language switch | DR6 heads-up; DR4 busy button, no double submit |
| 5 | Pays on Stripe's English page | Brief uncertainty | Arabic `custom_text` on Stripe's page |
| 6 | Lands back in the drawer | "Did it work?" | DR4 "Confirming your payment…" then "You're subscribed. Thank you." |
| 7 | Months later, opens Billing to cancel | In control, not trapped | Active panel: renewal date, Manage billing, DR6 note |
| 8 | After cancelling | Reassured nothing is lost | Ending panel: access until the date, records stay readable and downloadable |

- **DR7 Interval is one segmented control with a computed saving (Basel, D9 7A).** `SegmentedControl` Monthly | Yearly, default Monthly; one summary line ("You'll pay ₪39 a month + VAT where it applies"). The Yearly label carries a note computed from the two Stripe prices: "2 months free" when yearly is exactly 10× monthly, otherwise "Save ₪X"; hidden when yearly isn't cheaper. Never hard-coded. Unit test for the three cases.
- **DR8 Chip colour means one thing (Basel, D10 8A).** `--m-mint`/`-ink` Active; `--m-butter`/`-ink` Free trial, Ending, Confirming, Grace (Grace's headline says the card retry is failing); `--m-rose`/`-ink` Payment failed, Read-only, Locked, Needs help; `--m-lavender`/`-ink` Covered, Malafat. Always a word in the chip, never colour alone. No new tokens.
- **DR9 A shared RadioCards (Basel, D11 9A).** New `src/hosted/components/RadioCards.tsx` (options: value, label, note, optional disabled reason), using the existing `hp-type-card` styles; `ProfileTypeCards` becomes a thin wrapper and its tests run unchanged; the Subscribe step uses it for "For yourself / For a business". COMPONENT_REGISTRY entry.
- **DR10 Phone and accessibility spec (Basel, D12 10A).**
  - Phone (< 760 px): the drawer is the full-width sheet (MUT-357's `.drawer` max-width 100%, already on main at `d515f942`; the question's "lands first" condition is met); the Subscribe step's Continue button is pinned in the footer and spans the width; radio cards stack; the interval control spans the width; every control is at least 44 px tall.
  - Keyboard and screen reader: native radios (arrow keys); the interval control is a radiogroup; the country `Select` has a visible label; switching between the status view and the Subscribe step moves focus to the new heading; returning from Stripe opens the drawer with focus on the status headline; "Confirming your payment…" is `aria-live="polite"`; errors are `role="alert"`; busy buttons carry `aria-busy`; amounts are `<bdi>` in IBM Plex Mono so ₪39 reads correctly inside Arabic.
  - Proof: the `rtl-375` release-QA feature and an axe check in the billing specs.
- **DR11 The billing country has no default (Basel, D13 11A).** The `Select` starts on "Choose a country"; the price summary and Continue to payment stay disabled until a country is chosen. Order: Israel, Palestine, Jordan, the Gulf states, then A–Z (names from `Intl.DisplayNames`, see DR13).
- **DR12 The status view shows both currencies (Basel, D14 12A).** Plan line "Freelancer · ₪39 or $10 a month"; fine print "or ₪390 / $100 a year". Amounts come from the catalog; a currency without a complete price pair is left out (both missing → DR4's open soon). Amounts in `<bdi>` IBM Plex Mono. The Subscribe step's summary then shows the one currency the chosen country sets.
- **DR13 Palestine is named فلسطين / Palestine (Basel, D15 13B).** `countries.ts` overrides only `PS` ("فلسطين" in Arabic, "Palestine" in English; "פלסטין" if Hebrew is ever added); every other name comes from `Intl.DisplayNames` (which says "الأراضي الفلسطينية" / "Palestinian Territories" for PS, checked with Node 22). Stripe still receives the ISO code; billing is unchanged. Unit test.

Time horizons: 5 s, the chip and headline say where they stand; 5 min, subscribing takes three choices and one card form; 5 years, cancelling and lapsing never threaten the records.

## 3. Reuse

- `setupLinkOrigin` (`auth/account-setup.ts`) for return URLs; `SESSION_ONLY` and the route shape of `records-export.ts`; `SlidingWindowRateLimiter` keyed per user (`receipts.ts`).
- `entitlementsFor` / `factsFor` (MUT-358) for coverage; `TRIAL_DAYS`, `TRIAL_LOCK_DAYS` from `entitlement.ts`; `toGatewayError`, `STRIPE_API_VERSION` from MUT-360.
- MUT-360's webhook and sync, untouched.
- Portal: `Drawer`, `Button`, `Select` (from `ui/Input`, never the barrel), `useMe`, `useTp`, `SUPPORT_EMAIL`, the `AccountDrawers` controller, `FakeApi` in QA.

## 4. Impact

- New writes to Stripe from the API (customers, Checkout and portal sessions). The key's permissions widen (Q1); the Terraform and secret names don't change.
- No migration, no change to `/v1/me`, no behaviour change for anyone who never opens the drawer.
- Existing users all hold `pre-billing` grants with no expiry (MUT-358 backfill), so under Q5 they see "covered", not Subscribe, until the operator revokes the grant.

## 5. i18n, cost, infra, security

- **i18n:** all portal copy in `hosted.billing.*` ar/en; RTL at 375 px; country names via `Intl.DisplayNames`; amounts via `Intl.NumberFormat` in `<bdi>`. The Checkout `custom_text` is a server constant (Stripe renders it as given), in Arabic then English.
- **Cost:** per Subscribe, 1–3 Stripe calls (account lookup is local; list + maybe create + session). The catalog is one call per instance per 10 min. No Stripe fee for sessions.
- **Infra (Q1):** the restricted key gains **Write** on Customers, Checkout Sessions and Customer portal; reads stay as they are. `server/DEPLOYMENT.md` §6e and `pilot-runbook.md` §1.7 get the new permission list; Basel edits the key in the dashboard (no new secret, no Terraform change). The Customer Portal configuration (update card, invoice history, cancel at period end, no plan switching, no pause) is set in the dashboard and written into the runbook.
- **Before-release (non-blocking, feature is inert without prices):** fill `consumerCountries` after MUT-355; create the four `freelancer_list_*` prices; widen the key; configure the Customer Portal.
- **Security:** session-only; `returnPath` relative-only (no open redirect); the person is always `sessionAuth(c).user`, never a body field; per-user limit; no card data touches us; Stripe errors logged without request bodies.

## 6. Tests (TDD), commands and QA

**Server unit (Vitest):**

- `checkout.test.ts` (pure `planCheckout`): every row of the §2.3 table (including `unpaid` → `RESUME_IN_PORTAL`, `paused` → `CONTACT_US`, a no-expiry grant → `COVERED_BY_GRANT` and an expiring grant → allowed); ILS for IL, USD otherwise; the three tax-ID variants; `custom_text` ≤ 1200 chars; `expires_at` = now + 1 h; `returnPath` rejects `https://evil`, `//evil`, `/p/not-a-uuid`.
- In `checkout-gateway.test.ts`: a complete pair → amounts; a missing key → that currency `null`; 10-min cache and its expiry (injected `now`).
- `billing-countries.test.ts`: the shipped file parses; bad codes and duplicates fail at boot.
- `checkout-gateway.test.ts` (recorded fixtures): `customerFor` order (account → list match → create with idempotency key and metadata); session/portal params on the wire.
- `billing-routes.test.ts` (memory store + fake gateway): 200 shapes; 401 signed out; 409/422/503/502/429 cases; `resource_missing` → 409 `BILLING_ACCOUNT_NEEDS_HELP` with a warn line carrying ids only; audit rows; the person always comes from the session; `GET /v1/billing` still answers 200 (catalog `null`) when Stripe fails.
- `store-contract-billing.ts`: `summaryOf` cases (none, linked with subscriptions, unlinked account not returned) on memory and Prisma (`test:db`).
- `sync.test.ts`: a Checkout-made subscription on a `customerFor` customer links and covers (AC1 at the unit level).
- `route-security.test.ts`: the three routes are session-only, not public.
- `billing-routes.test.ts` also: each route answers without `X-Mutaba3a-Profile` (person-level registration).

**Stripe test mode end to end (eng review D8, Basel chose B):** proven by the release-QA specs below, which run against a real dev API and Stripe's real hosted pages in test mode. No separate opt-in server test.

**Portal unit:** `billingView.test.ts` (every panel; trial day 0/13/14/29/30 boundaries; `checkoutRouteOf` matrix), `BillingDrawer.test.tsx` (ar + en render, contact-us path never calls checkout, success polling stops on ACTIVE and on timeout).

**Release-QA (Q4 → eng review D8 B): `qa/features/portal/billing.yaml` + `qa/specs/portal/billing.spec.ts`**, against a **real dev API** (`npm --prefix server run dev` behind `dev:hosted`'s `/v1` proxy, `MUTABA3A_API_ORIGIN`) with a Stripe **test** key and webhook secret read from the Keychain at run time (never committed), and `stripe listen --forward-to <api>/v1/billing/stripe/webhook`. A seeded test person with `trialStartedAt` set. The Stripe-facing specs fill the hosted card form (4242 4242 4242 4242, an IL address for ILS and a US address for USD) and use the Customer Portal's cancel; the period end for AC3 is reached with a Stripe test clock. The QA harness creates the test person's Stripe customer on that clock itself (with `metadata.mutaba3a_user_id`), and `customerFor` finds it by email (its step 2), so production code needs no test-clock parameter. Stripe's own docs warn its hosted pages resist automation (Failure modes).

| id | Steps (as the user says them) | Expect |
|---|---|---|
| `subscribe` (tier core) | Open Billing from the account menu during a trial; pick Israel, as a person, monthly; press Subscribe; pay with the test card and an IL address | The drawer explains plan, ₪ price, VAT line and lapse rule in Arabic before any button; Stripe's page charges in ILS; back in the portal "You're subscribed" once the webhook lands |
| `subscribe-return` | Subscribe in USD (another country, as a business with a test VAT ID); come back from checkout | "Confirming your payment" then "You're subscribed" in USD; Manage billing offered |
| `subscribe-business-only` | Pick a country not open to consumers, as a person | "Contact us" (mailto), no Subscribe; switch to as a business → Subscribe enabled |
| `manage` (tier core) | As a subscriber, open Billing, press Manage billing, cancel in Stripe's portal, return | The plan and renewal date; Stripe's portal opens; back in the drawer "Ends on <date>" (`cancelAtPeriodEnd`) |
| `manage-ending` | After cancelling, advance the test clock past the period end | `/v1/me` reports READ_ONLY; the drawer says "Your plan ended; your records stay readable and downloadable" and offers Subscribe |
| `open-soon` | Open Billing on a server with no GA prices | "Subscriptions open soon"; no Subscribe |
| `rtl-375` | Open Billing in Arabic at 375 px | No overflow, amounts read left-to-right in `<bdi>` |

Each spec ends on its `expect`, every action in `step(...)`, passing once via `release-qa run --attach --only <id>`; `release-qa lint` clean with the new files mapped.

**Commands (Node 22):** `npm run lint`, `npm run typecheck`, `npm run test:run`, `npm run build`; `npm --prefix server run typecheck|lint|openapi:check|test`; `test:db` for the contract cases.

## 7. Decisions for Basel

Numbered Q1–Q5 so they don't clash with the eng review's D-numbers. **Answered (2026-10-22):** Q1 → D2 A, Q2 → D3 A, Q3 → D4 A, Q4 → D8 **B** (drive Stripe's pages in Playwright), Q5 → D5 A.

| # | Question | Recommendation |
|---|---|---|
| Q1 | Checkout needs Stripe writes. Widen the one restricted key, or add a second key just for writes? | **Widen the one key** (Write on Customers, Checkout Sessions, Customer portal only). One secret to rotate, no Terraform change; it still can't change subscriptions or refund. |
| Q2 | Before Checkout, find-or-create the person's Stripe customer (with our metadata), or let Checkout create it? | **Find-or-create.** It closes MUT-360's OV-7 (two tabs → two customers → paid but unlinked) and carries the link on the customer itself. |
| Q3 | Back from Checkout: poll `/v1/me` until the webhook lands, or add a "confirm this session" endpoint that syncs at once? | **Poll** (2 s, up to 30 s). No second write path into billing; reconcile heals a lost webhook overnight. |
| Q4 | AC5 "passing specs (Stripe test mode)": portal specs stub the API (as all portal specs do) plus an opt-in server test against Stripe test mode and a recorded manual run — or drive Stripe's hosted page in Playwright? | **Stub + opt-in test + manual run.** Stripe's hosted pages block automated browsers; the portal QA app has no server. |
| Q5 | People covered by an operator grant with no expiry (every existing user's `pre-billing` grant): offer Subscribe, or show "covered" only? | **Covered only.** The operator decides when a pilot or legacy person starts paying (revoke the grant → Subscribe appears). Avoids a pilot user double-paying beside their hand-made subscription. |

## 8. Risks and follow-ups

- **Self-declared country (built here, eng review D9 C):** Stripe can't restrict a billing address's country, so a consumer could pick a listed country and enter another address. Stripe Tax then computes on the real address. `billing:status` and its admin route flag each linked account whose `country ∉ consumerCountries` and that carries no tax ID, so Basel can follow up.
- **Currency follows the picked country, not the address:** an IL pick with a foreign address pays ILS. Accepted (spike §0 is "Israeli customers pay ILS").
- **ADR/TD numbers:** built as ADR-170, TD-201 and TD-202 (MUT-392 holds ADR-169 and API 1.51.0, so this ships as 1.52.0-mut362); three sessions raced on numbers before (MUT-325).

## 9. Business / product impact

- Anyone can start paying and manage or cancel their plan without Basel in the loop: the "pay and leave with no help" half of the GA gate.
- Unblocks MUT-365 (prices on the site) and, with MUT-361 and MUT-366, open GA on hosted Mutaba3a (epic MUT-322).
- Ships inert and honest: nothing is sold until Basel creates the list prices and opens consumer countries, so no tax exposure lands before MUT-355's answers.

---

# Eng review (/plan-eng-review, 2026-10-22)

Target: `.claude/designs/mut-362-self-service-billing.md` (this file), the plan as drafted by `/eng-ticket` on 2026-10-22. The prior design doc found by gstack (`basel-main-design-20260524-100930.md`, recording-flow redesign) is unrelated to billing and was not used.

## Scope record

feature answers: none proposed (every feature traces to the ticket); structure: B, D1 "Smaller arrangement" (Basel, 2026-10-22); accepted scope: the plan's feature list unchanged, built in four new server files (`billing/stripe/checkout-gateway.ts` with the price cache, `billing/checkout.ts` with the decision, the Checkout copy and the countries loader, `server/billing-countries.json`, `routes/billing.ts`), `gateway.ts` unchanged; pending remedies: R1–R7.

Scope Challenge result: scope accepted as-is (the smaller arrangement keeps every feature).

Scope Challenge findings:
- SC-1 [P3] (confidence 9/10) plan §2.2 (draft) "extract the client factory into `stripe/client.ts`": unnecessary; `gateway.ts:12` `export const STRIPE_API_VERSION` and `gateway.ts:135` `export function toGatewayError` are already exported. Disposition: resolved by D1 (B).
- SC-2 [P2] (confidence 8/10) complexity: about 30 changed files and 3 new services in the draft. Disposition: D1 (B) reduces it to 4 new server files and 2 new services.

## Reality rows

Premise table:

| Premise | Claim | Receipt | Verdict |
|---|---|---|---|
| P1 | The webhook already links a Checkout's subscription through `client_reference_id` | `server/src/billing/stripe/sync.ts:33` "The person a checkout names (`client_reference_id`)"; `:194` `context.linkHint ?? customer.metadata?.['mutaba3a_user_id']` | TRUE |
| P2 | The production key is restricted and read-only | `server/DEPLOYMENT.md:1178` "restricted key with read access to Customers, Subscriptions, …"; `config.ts:163` live needs `rk_live_` | TRUE |
| P3 | Root `config/` never reaches the API image | `server/Dockerfile` `COPY src ./src` (context `server/`) | TRUE |
| P4 | Every existing user holds a grant with no expiry | `server/prisma/migrations/20261020200000_mut358_billing_core/migration.sql:120` inserts no `expiresAt` | TRUE |
| P5 | Portal QA specs stub `/v1` and run no server | `qa/qa.config.mjs:61-63` "Specs stub every /v1 call with page.route, so no API runs" | TRUE |
| P6 | `required: 'if_supported'`, `expires_at` 30 min–24 h, `custom_text` ≤ 1200 | `server/node_modules/stripe/esm/resources/Checkout/Sessions.d.ts:2072`, `:2251`, `:920` (SDK 23.0.0) | TRUE |
| P7 | `customers.list({ email })` is exact and case-sensitive | `server/node_modules/stripe/esm/resources/Customers.d.ts:763` | TRUE |
| P8 | List endpoints are read-after-write consistent (Search is not) | none read this session | unverified |
| P9 | Stripe locks a customer's currency while a non-cancelled subscription exists | support.stripe.com "Why are customers locked to a specific currency" | TRUE |
| P10 | Hosted Checkout resists browser automation | docs.stripe.com/automated-testing | TRUE |
| P11 | The restricted-key permission for Customer portal sessions has that name | docs.stripe.com/keys/permissions-reference (row not retrieved) | unverified |
| P12 | Person-level routes must be registered as organization-independent | `server/src/app.ts:219`; `auth/middleware.ts:200` | TRUE |

unverified=2

REALITY: premise-table finding 12 premises, unverified=2 (P8 list consistency, P11 portal permission name) .claude/designs/mut-362-self-service-billing.md:284
REALITY: already-done pass `git log origin/main --since=2026-10-20 --grep 362|checkout-session|portal-session` empty server/src/routes/stripe-billing.ts:1
REALITY: surface-check pass `npm run hosted:types` package.json:32, `openapi:check` server/package.json:29, `test:db` server/package.json:19, `stripe` CLI /opt/homebrew/bin/stripe; finding: person-level registration missing, folded into §2.4 server/src/app.ts:219
REALITY: binding-decisions pass ADR-165 D5/D6 (existing link wins; only syncSubscription creates accounts) kept; ADR-160 §4.4 Malafat never priced kept .claude/DECISIONS.md:4490
REALITY: numbers pass cache ten minutes, checkout budget, per-user limit, poll interval and checkout expiry are design bounds [estimated] .claude/designs/mut-362-self-service-billing.md:1; the 1200-character text limit [measured] server/node_modules/stripe/esm/resources/Checkout/Sessions.d.ts:920; the 30-minute expiry floor [measured] server/node_modules/stripe/esm/resources/Checkout/Sessions.d.ts:2251
REALITY: deferred-asks pass every ticket scope item and AC1–AC5 are covered; AC3 enforcement is MUT-361, the trial start is MUT-366 (stated in §1) .claude/designs/mut-362-self-service-billing.md:24
REALITY: pr-count pass one branch, one merge (no .gstack/ship-policy.json, so the default of one PR applies) .claude/designs/mut-362-self-service-billing.md:1
REALITY: prior-art n/a no vendored or patched dependency; Stripe SDK 23.0.0 used as published server/package.json
REALITY: contract-assumptions pass MUT-360 sync contract read from merged code server/src/billing/stripe/sync.ts:194
REALITY: dependency-fallback pass ships without MUT-361 (state reported, not enforced) and MUT-366 (trial shown only when set) .claude/designs/mut-362-self-service-billing.md:24
REALITY: obligation-tiers pass all accepted findings are must-ship in this ticket; follow-ups in §8 .claude/designs/mut-362-self-service-billing.md

## Decision ledger

### R1: How the server gets Stripe write access (plan §7 Q1)
Finding: A-1, P2, confidence 9/10, `server/DEPLOYMENT.md:1178` "create a **restricted key** with read access to Customers, Subscriptions, Products, Prices, Checkout Sessions, Invoices and Events, and nothing else"; plan §2.2 needs customer and session creation. Reviewer: Claude.
Plan baseline: original proposal, widen the one restricted key (plan §7 Q1). Not approved.
Runtime evidence: one key `STRIPE_SECRET_KEY`, read-only in production (P2); the permission name for Customer portal sessions is unverified (P11).
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R1 Stripe write access | read-only key, pending | widen the one restricted key: Write on Customers, Checkout Sessions, Customer portal | a second restricted key for writes only (`STRIPE_CHECKOUT_KEY`, new secret, Terraform, config pair rule) |
| R2–R7 | pending | pending | pending |
Question D2:
D2 — How should the API get permission to create Stripe customers and checkout sessions?
Project/branch/task: mini-crm main, MUT-362 plan §2.2 and §7 Q1.
ELI10: Today the server holds one Stripe key that can only read. Checkout needs it to create a customer and a payment page, and to open the "manage billing" page. We can give that one key three more permissions, or add a second key that only writes. A second key limits what a leaked key could do, but it means another secret, more Terraform, and a second key to rotate.
Stakes if we pick wrong: with one key, a leak lets someone create customers and checkout pages (not charge cards or refund); with two keys, more setup and one more thing to forget at rotation.
Recommendation: A because the extra power is small (it can't touch subscriptions, charges or refunds) and it keeps one secret.
Note: options differ in kind, not coverage — no completeness score.
Pros / cons:
A) Widen the one key (recommended)
  ✅ No new secret, no Terraform change; Basel edits the key's permissions in the dashboard once
  ✅ Rotation stays one step, already in DEPLOYMENT.md §6e
  ❌ The webhook and reconcile run with write rights they never use
B) Second key for writes
  ✅ The webhook's key stays strictly read-only, so a leak there can create nothing
  ✅ Write rights can be revoked on their own without stopping the mirror
  ❌ A new Secret Manager secret, Terraform mount, config pair rule and runbook steps (human: ~3h / CC: ~20 min)
Net: one secret and a slightly wider key, or least privilege per job at the cost of more ops.
Header: Stripe key
Options:
A) Widen the one key (recommended)
Add Write on Customers, Checkout Sessions and Customer portal to the existing restricted key. Docs: DEPLOYMENT.md §6e and pilot-runbook §1.7 list the new permissions. No Terraform or config change. Human ~30 min / CC ~5 min.
B) Second key for writes
New `STRIPE_CHECKOUT_KEY` (rk_ only, live rules as today), its secret and Terraform mount, a config rule that it needs STRIPE_SECRET_KEY, and runbook steps. CheckoutGateway uses it; the mirror keeps the read-only key. Human ~3h / CC ~20 min.

State: approved
Actual answer: A) Widen the one key (Basel, D2, 2026-10-22)
Accepted scope: the existing restricted key gains Write on Customers, Checkout Sessions and Customer portal (the exact permission name for portal sessions confirmed in the dashboard at build, P11); `server/DEPLOYMENT.md` §6e and `docs/operations/pilot-runbook.md` §1.7 list the new permissions; a non-blocking `docs/operations/before-release.md` line; no Terraform or config change; `CheckoutGateway` is built from `STRIPE_SECRET_KEY`.
History: none

### R2: Who creates the person's Stripe customer before Checkout (plan §7 Q2)
Finding: A-2, P1, confidence 8/10, `.claude/designs/mut-360-stripe-webhook.md:682` OV-7 "Checkout without an existing `customer` creates a second Customer → `USER_HAS_ANOTHER_ACCOUNT`, paid but uncovered"; Jira MUT-362 comment 12309. Reviewer: Claude.
Plan baseline: original proposal, find-or-create (plan §2.2 `customerFor`). Not approved. R1 approved (one key with Customers Write).
Runtime evidence: `sync.ts:194` links by `linkHint ?? customer.metadata.mutaba3a_user_id`; `customers.list({ email })` is an exact, case-sensitive filter (P7); list read-after-write consistency is unverified (P8), so the idempotency key carries the two-tab case on its own.
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R1 key | approved D2: one widened key | unchanged | unchanged |
| R2 customer before Checkout | pending | existing account's customer, else list by email + our metadata, else create with idempotency key `mut362-customer-<userId>` and `metadata.mutaba3a_user_id` | existing account's customer, else let Checkout create one (`customer_email` + `client_reference_id`) |
| R3–R7 | pending | pending | pending |
Question D3:
D3 — When someone without a linked Stripe customer presses Subscribe, should we create the customer first, or let Stripe's checkout page create it?
Project/branch/task: mini-crm main, MUT-362 plan §2.2 `customerFor`.
ELI10: If a person opens Subscribe in two tabs, or comes back after giving up once, letting Stripe create the customer can leave them with two Stripe customers. MUT-360's rule keeps the first link, so a payment on the second customer is real money that covers nothing until Basel fixes it by hand. Creating (or finding) the customer ourselves first, tagged with the person's id, means every checkout uses the same one.
Stakes if we pick wrong: B leaves a person who paid but is still read-only, visible only in `billing:unlinked`.
Recommendation: A because it closes MUT-360's known gap for 1–2 extra Stripe calls per Subscribe.
Completeness: A=10/10, B=7/10
Pros / cons:
A) Find or create first (recommended)
  ✅ Two tabs or a retry always reuse one customer, so a payment can't land on an unlinked one
  ✅ The person's id sits on the customer itself, so linking survives even without `client_reference_id`
  ❌ One or two more Stripe calls per Subscribe and a customer left behind when someone never pays (harmless, no row)
B) Let Checkout create it
  ✅ Fewer Stripe calls and no orphan customers from abandoned Subscribes
  ✅ Simpler code: one branch in `customerFor`, no list or create fixtures to keep
  ❌ The two-tab or retry case leaves a paid but uncovered person until the operator relinks
Net: a couple of API calls buys never having a paid-but-uncovered customer.
Header: Stripe customer
Options:
A) Find or create first (recommended)
`customerFor`: the linked account's customer; else `customers.list({ email })` filtered on `metadata.mutaba3a_user_id`; else `customers.create` with that metadata and idempotency key `mut362-customer-<userId>`. Recorded-fixture tests for each step. Human ~2h / CC ~15 min.
B) Let Checkout create it
Pass the linked account's customer when one exists; otherwise `customer_email` and `client_reference_id`, and Checkout creates the customer. MUT-360 links it by the hint. The two-tab case stays an operator fix. Human ~30 min / CC ~5 min.

State: approved
Actual answer: A) Find or create first (Basel, D3, 2026-10-22)
Accepted scope: `customerFor` as plan §2.2: the linked account's `stripeCustomerId`; else `customers.list({ email })` filtered on `metadata.mutaba3a_user_id === userId`; else `customers.create({ email, name, metadata: { mutaba3a_user_id } })` with idempotency key `mut362-customer-<userId>`. No `billing_accounts` row written (ADR-165 D6). Recorded-fixture tests for each step, the idempotency header and the metadata.
History: none

### R3: How the drawer learns the payment went through (plan §7 Q3)
Finding: A-3, P2, confidence 8/10, plan §2.7 BillingDrawer "On `?checkout=success` it polls `/v1/me` every 2 s for up to 30 s"; AC1 "comes back ACTIVE through the webhook". Reviewer: Claude.
Plan baseline: original proposal, poll `/v1/me` (2 s, up to 30 s). Not approved. R1, R2 approved.
Runtime evidence: the webhook path exists (`stripe-billing.ts` → `sync.handleEvent`, `checkout.session.completed` with `linkHint`); its latency in production is unknown; reconcile runs nightly at 03:30 (ADR-165).
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R1 key | approved D2 | unchanged | unchanged |
| R2 customer | approved D3 | unchanged | unchanged |
| R3 return from Checkout | pending | poll `/v1/me` every 2 s up to 30 s; after that "payment went through, can take a minute to show" | add `POST /v1/billing/checkout-session/{id}/confirm`: reads the session, checks `client_reference_id` is the caller, runs `syncSubscription` at once; the drawer calls it on return, then reads `/v1/me` |
| R4–R7 | pending | pending | pending |
Question D4:
D4 — After paying on Stripe's page, how should the drawer find out the subscription is active?
Project/branch/task: mini-crm main, MUT-362 plan §2.7 BillingDrawer.
ELI10: Stripe tells our server about a payment through the webhook, usually within seconds. When the person lands back in the portal, the drawer can keep asking "am I active yet?" for up to 30 seconds. Or we add a small endpoint that asks Stripe directly about this checkout and records it right away. The second is faster when a webhook is slow, but it's a second way of writing billing data that has to stay in step with the webhook.
Stakes if we pick wrong: A shows "can take a minute" if the webhook is slow; B adds a write path that a bug could make disagree with the webhook.
Recommendation: A because the webhook is the one writer by design (ADR-165) and the nightly reconcile backs it up.
Note: options differ in kind, not coverage — no completeness score.
Pros / cons:
A) Poll /v1/me (recommended)
  ✅ No new write path: the webhook and reconcile stay the only writers of billing rows
  ✅ No new route, OpenAPI entry or security test; the drawer only reads
  ❌ If a webhook is delayed past 30 s the person sees "can take a minute", not a confirmation
B) Confirm endpoint
  ✅ The person sees ACTIVE right away even when Stripe's webhook is slow or lost
  ✅ Reuses `syncSubscription`, so the write itself is the same code the webhook runs
  ❌ A fourth route, a Stripe read per return, and a caller check that must stop confirming someone else's session (human: ~3h / CC: ~20 min)
Net: simplicity and one writer, or instant confirmation with one more door.
Header: Return path
Options:
A) Poll /v1/me (recommended)
On `?checkout=success` the drawer refetches `/v1/me` every 2 s for up to 30 s until this profile is STRIPE and ACTIVE, then "You're subscribed"; past 30 s, "Your payment went through; it can take a minute to show here." Component test for both endings. Human ~1h / CC ~10 min.
B) Confirm endpoint
`POST /v1/billing/checkout-session/{id}/confirm` (session-only, person-level, rate-limited): retrieve the session, 404 unless `client_reference_id` is the caller and it is complete, then `syncSubscription(session.subscription, { linkHint })`. Drawer calls it on return. Route, OpenAPI and security tests. Human ~3h / CC ~20 min.

State: approved
Actual answer: A) Poll /v1/me (Basel, D4, 2026-10-22)
Accepted scope: on `?checkout=success` the drawer refetches `/v1/me` every 2 s for up to 30 s until this profile is STRIPE and ACTIVE, then "You're subscribed"; past 30 s, "Your payment went through; it can take a minute to show here." No new route. Component test for both endings.
History: none

### R4: Offer Subscribe to people under a no-expiry operator grant (plan §7 Q5)
Finding: A-4, P2, confidence 9/10, `server/prisma/migrations/20261020200000_mut358_billing_core/migration.sql:120` `SELECT gen_random_uuid(), "id", 'FREELANCER', 'pre-billing', 'migration:mut358' FROM "users"` (no expiry), and `entitlement.ts` rule 2 (OPERATOR before STRIPE). Reviewer: Claude.
Plan baseline: original proposal, "covered only" (plan §2.3 row `COVERED_BY_GRANT`, §7 Q5). Not approved. R1–R3 approved.
Runtime evidence: every user at migration time holds a no-expiry FREELANCER grant (P4); pilot users also have hand-made subscriptions; the operator revokes the pre-billing grant per pilot-runbook §1.5 once Stripe covers.
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R1–R3 | approved D2–D4 | unchanged | unchanged |
| R4 no-expiry grant | pending | drawer says "covered by Mutaba3a", no Subscribe; checkout 409 `COVERED_BY_GRANT`; a grant with an expiry still offers Subscribe | Subscribe offered to everyone without a live subscription, grant or not |
| R5–R7 | pending | pending | pending |
Question D5:
D5 — Should people whose access is a free operator grant with no end date see Subscribe?
Project/branch/task: mini-crm main, MUT-362 plan §2.3 and §7 Q5.
ELI10: When billing was added, every existing account got a free "pre-billing" grant with no end date, so nobody lost access. Pilot users also pay through subscriptions Basel made by hand. Checkout already refuses a second subscription once a pilot's hand-made one is linked, but until Basel links it, a pilot user who sees Subscribe could buy a second one; and everyone else sees a price for something they get free today. Hiding Subscribe while a no-end-date grant exists leaves the "when do you start paying" call with Basel: revoke the grant and Subscribe appears.
Stakes if we pick wrong: B risks double charges for pilot users; A means a legacy user can't pay on their own until Basel revokes their grant.
Recommendation: A because a double charge is worse than one operator step, and pilot billing is already hand-run.
Note: options differ in kind, not coverage — no completeness score.
Pros / cons:
A) Covered only (recommended)
  ✅ A pilot user with a hand-made subscription and the old grant can't buy a second subscription
  ✅ Legacy free users never see a price until Basel decides they should
  ❌ Someone on a no-end-date grant who wants to pay must ask Basel to revoke the grant first
B) Offer Subscribe to all
  ✅ Anyone can start paying on their own, with no operator step
  ✅ One rule for everyone: no live subscription means Subscribe is shown
  ❌ A pilot user whose hand-made subscription isn't linked yet can double-subscribe, and Basel refunds by hand
Net: operator control and no double charges, or full self-service with a double-charge risk during the pilot.
Header: Grant holders
Options:
A) Covered only (recommended)
Drawer panel `coveredByGrant` ("Your account is covered by Mutaba3a") when every owned profile is under a live operator grant with no expiry; checkout answers 409 `COVERED_BY_GRANT`. A grant with an expiry still offers Subscribe with "free until <date>". Unit tests for both. Human ~1h / CC ~10 min.
B) Offer Subscribe to all
No grant check; Subscribe shows whenever there's no live subscription. The drawer still says "covered until <date>" or "covered by Mutaba3a" above it. Human ~30 min / CC ~5 min.

State: approved
Actual answer: A) Covered only (Basel, D5, 2026-10-22)
Accepted scope: drawer panel `coveredByGrant` ("Your account is covered by Mutaba3a") when every owned profile is under a live operator grant with no expiry; checkout answers 409 `COVERED_BY_GRANT`; a grant with an expiry still offers Subscribe with "free until <date>". Unit tests for both.
History: none

### R5: Subscribe after a subscription went unpaid (new finding)
Finding: A-5, P1, confidence 8/10, `server/src/billing/entitlement.ts:81` `const LAPSED_STATUSES: ReadonlySet<string> = new Set(['unpaid', 'canceled', 'paused']);` with plan §2.3 row "The person has a live subscription (`active`, `trialing`, `past_due`, `incomplete`) → 409": an `unpaid` or `paused` subscription is not "live", so the plan lets the person start a second Checkout. Stripe keeps an unpaid subscription and locks the customer's currency while any non-cancelled subscription exists (support.stripe.com, P9). Reviewer: Claude.
Plan baseline: original proposal allows a new Checkout for `unpaid`/`paused` (plan §2.3). Not approved. R1–R4 approved.
Runtime evidence: Stripe moves a subscription to `unpaid` after retries fail (spike §4.3, Smart Retries); the open invoice stays payable; a second subscription in the other currency would be refused by Stripe, and in the same currency would bill twice once the old invoice is paid.
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R1–R4 | approved D2–D5 | unchanged | unchanged |
| R5 unpaid/paused then Subscribe | plan: allowed, pending | `unpaid` → 409 `RESUME_IN_PORTAL`, the drawer shows "Pay the open invoice in Manage billing to restore access" with Manage billing; `paused` (never made by our flow) → 409 `CONTACT_US`, mailto | allowed: a new Checkout next to the unpaid subscription (currency forced to the account's, so Stripe accepts it) |
| R6–R7 | pending | pending | pending |
Question D6:
D6 — When someone's subscription went unpaid and they press Subscribe again, what should happen?
Project/branch/task: mini-crm main, MUT-362 plan §2.3 `planCheckout`.
ELI10: When card retries fail, Stripe marks the subscription "unpaid" but keeps it, with an open invoice. Our plan treats that like no subscription and would open a new checkout. Stripe then either refuses (if the currency differs) or the person ends up with two subscriptions and pays twice once the old invoice is settled. Sending them to Manage billing to pay the open invoice brings the same subscription back.
Stakes if we pick wrong: B can bill a returning person twice or fail at Stripe's page with an error we don't explain.
Recommendation: A because it restores the existing subscription instead of stacking a second one.
Completeness: A=10/10, B=6/10
Pros / cons:
A) Resume in Manage billing (recommended)
  ✅ One subscription per person stays true; paying the open invoice turns it active again through the webhook
  ✅ No currency clash with Stripe's one-currency-per-customer lock
  ❌ The person can't switch monthly to yearly at that moment; they pay the old plan first
B) Allow a new checkout
  ✅ The person picks a fresh plan straight away
  ✅ Fewer special cases in `planCheckout` and the drawer
  ❌ Two subscriptions on one customer, a double charge once the old invoice is paid, and a forced currency
Net: a short detour through Manage billing, or a real double-billing risk.
Header: Unpaid plan
Options:
A) Resume in Manage billing (recommended)
`planCheckout`: an `unpaid` subscription → 409 `RESUME_IN_PORTAL`; `paused` → 409 `CONTACT_US`. Drawer panel `unpaid` with copy and Manage billing; `paused` shows contact us. Unit rows for both, a drawer test, ar/en copy. The manual test-mode run checks the portal can pay the open invoice; if it can't, the drawer links the invoice's hosted page instead. Human ~1h / CC ~10 min.
B) Allow a new checkout
Keep the plan: no check for `unpaid`/`paused`; Checkout's currency is forced to the account's currency to avoid Stripe's lock. A unit row for the forced currency. Human ~20 min / CC ~5 min.

State: approved
Actual answer: A) Resume in Manage billing (Basel, D6, 2026-10-22)
Accepted scope: `planCheckout`: an `unpaid` subscription → 409 `RESUME_IN_PORTAL`; `paused` → 409 `CONTACT_US`. Drawer panel `unpaid` (copy + Manage billing); `paused` shows contact us. Unit rows for both, a drawer test, ar/en copy. The manual test-mode run checks the Customer Portal can pay the open invoice; if it can't, the drawer links the invoice's hosted page instead.
History: none

### R6: A linked Stripe customer that no longer exists (Section 2, error handling)
Finding: Q-1, P2, confidence 7/10, plan §2.4 "502 `STRIPE_UNAVAILABLE` (a gateway error …)" and §2.2 `customerFor` step 1 (the linked account's `stripeCustomerId`, no Stripe call); `gateway.ts:135-145` `toGatewayError` keeps `code` (e.g. `resource_missing`) and marks a 404 not transient. Reviewer: Claude.
Plan baseline: original proposal, every gateway error → 502 `STRIPE_UNAVAILABLE`. Not approved. R1–R5 approved; R2 (D3) keeps the linked customer first and ADR-165 D5 never relinks.
Runtime evidence: a customer deleted in the dashboard leaves `billing_accounts.stripeCustomerId` pointing at nothing; Checkout and portal sessions then fail with `resource_missing`, every time.
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R1–R5 | approved D2–D6 | unchanged | unchanged |
| R6 missing linked customer | 502 `STRIPE_UNAVAILABLE` ("try again"), pending | `resource_missing` on the customer → 409 `BILLING_ACCOUNT_NEEDS_HELP`; drawer shows contact us (mailto with the account reference); warn log `{ stripeCustomerId, userId }` for the operator | unchanged 502 "try again later" |
| R7 | pending | pending | pending |
Question D7:
D7 — If someone's linked Stripe customer has been deleted on Stripe's side, what should Subscribe and Manage billing do?
Project/branch/task: mini-crm main, MUT-362 plan §2.4 error mapping.
ELI10: Our database remembers which Stripe customer belongs to each person, and MUT-360's rule never swaps that link on its own. If someone deletes that customer in the Stripe dashboard, every Subscribe or Manage billing press fails. The plan shows "Stripe is unavailable, try again", which is wrong and never gets better. Telling the person to contact us, and logging it for Basel, gets it fixed.
Stakes if we pick wrong: B leaves the person retrying forever with no way to pay and nothing in the logs that names the cause.
Recommendation: A because it's the only answer that leads to a fix, and it costs one error mapping.
Completeness: A=9/10, B=5/10
Pros / cons:
A) Contact us + operator log (recommended)
  ✅ The person sees a true message with a way out instead of an endless "try again"
  ✅ Basel gets a warn line naming the customer and person, so `billing link` can fix it
  ❌ One more error code in the API, OpenAPI and drawer copy to maintain
B) Keep the generic 502
  ✅ No extra code path; every Stripe failure looks the same
  ✅ The case is rare: it needs someone to delete a customer by hand
  ❌ The person is stuck with a misleading message, and the cause is invisible in logs
Net: one mapped error code buys a recoverable state instead of a silent dead end.
Header: Missing customer
Options:
A) Contact us + operator log (recommended)
Map `resource_missing` on the customer (Checkout or portal session) to 409 `BILLING_ACCOUNT_NEEDS_HELP`; drawer copy with mailto; warn log with ids only. Route test with a fake gateway throwing that code; OpenAPI response. Human ~45 min / CC ~5 min.
B) Keep the generic 502
No change: every gateway error is 502 `STRIPE_UNAVAILABLE` with "try again later". Human 0 / CC 0.

State: approved
Actual answer: A) Contact us + operator log (Basel, D7, 2026-10-22)
Accepted scope: `resource_missing` on the customer (Checkout or portal session) → 409 `BILLING_ACCOUNT_NEEDS_HELP`; drawer copy with mailto; warn log with ids only (`stripeCustomerId`, `userId`); route test with a fake gateway throwing that code; OpenAPI response.
History: none

### R7: How AC5's "passing specs (Stripe test mode)" is proven (plan §7 Q4)
Finding: T-1, P1, confidence 9/10, `qa/qa.config.mjs:61-63` "Specs stub every /v1 call with page.route, so no API runs"; docs.stripe.com/automated-testing: hosted Checkout "ha[s] security measures in place that prevent automated testing" (P10); ticket AC5. Reviewer: Claude.
Plan baseline: original proposal, stubbed portal specs + an opt-in server test against Stripe test mode + a recorded manual run (plan §6, §7 Q4). Not approved. R1–R6 approved.
Runtime evidence: the portal QA app has no server; Stripe CLI is installed at `/opt/homebrew/bin/stripe` for `stripe listen`; no Stripe test key is in the repo (keys live in Keychain/`~/Work/_keys`).
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R1–R6 | approved D2–D7 | unchanged | unchanged |
| R7 AC5 proof | pending | portal specs stub `/v1/billing*` and stop at the redirect (7 features); `billing-stripe-testmode.test.ts` runs against real Stripe test mode only when `STRIPE_TEST_SECRET_KEY` is set (never CI); the manual AC1/AC3 run with `stripe listen` is recorded in TEST_PLAN | Playwright drives Stripe's hosted Checkout and portal in test mode against a real dev API with `stripe listen` |
Question D8:
D8 — How should we prove AC5's "passing specs (Stripe test mode)"?
Project/branch/task: mini-crm main, MUT-362 plan §6 QA.
ELI10: Every portal QA spec today fakes the API, and Stripe's own docs say their payment page blocks automated browsers. So the specs can check everything on our side up to the jump to Stripe, and the Stripe side is proven by a separate server test that talks to Stripe's test mode when a test key is present, plus one hands-on run of a real payment. Driving Stripe's page with Playwright looks more complete but fights Stripe's bot checks and would need a real server inside QA.
Stakes if we pick wrong: B gives flaky specs that fail on Stripe's captcha and a QA setup no other portal spec uses.
Recommendation: A because it tests our code at every boundary and leaves Stripe's page to the one manual run Stripe recommends.
Completeness: A=9/10, B=8/10
Pros / cons:
A) Stub + opt-in test + manual run (recommended)
  ✅ Specs are stable and match every other portal spec; `release-qa run` needs no Stripe key or server
  ✅ The opt-in test checks real Stripe accepts our Checkout and portal params, in ILS and USD
  ❌ The full pay-and-return loop is proven by a person once, not by a recorded spec on every run
B) Drive Stripe's page in Playwright
  ✅ A recorded video of the whole loop, card form included
  ✅ Catches a change on Stripe's page that breaks the redirect back
  ❌ Stripe's bot checks make it flaky, and QA needs a real API, a test key and `stripe listen` (human: ~2 days / CC: ~2h in total)
Net: stable specs plus targeted real-Stripe checks, or a full recorded loop that fights Stripe's protections.
Header: AC5 proof
Options:
A) Stub + opt-in test + manual run (recommended)
`qa/features/portal/billing.yaml` + `qa/specs/portal/billing.spec.ts` with the 7 features in plan §6, `/v1` stubbed by `FakeApi`; `server/src/__tests__/billing-stripe-testmode.test.ts` skipped unless `STRIPE_TEST_SECRET_KEY`; the manual AC1/AC3 run recorded in `.claude/TEST_PLAN.md`. Human ~1 day / CC ~1h.
B) Drive Stripe's page in Playwright
QA gets a real dev API with a Stripe test key and `stripe listen`; specs fill Stripe's card form (4242…) and the portal's cancel. Same 7 features. Human ~2 days / CC ~2h.

State: approved
Actual answer: B) Drive Stripe's page in Playwright (Basel, D8, 2026-10-22; not the recommendation)
Accepted scope: release-QA for billing runs the portal against a real dev API (`npm --prefix server run dev`, reached through `dev:hosted`'s `/v1` proxy, `MUTABA3A_API_ORIGIN`) holding a Stripe **test** key and webhook secret from the Keychain (never the repo), with `stripe listen --forward-to <api>/v1/billing/stripe/webhook`; the specs fill Stripe's hosted card form (4242…) and use the Customer Portal's cancel; the same 7 features as plan §6. The opt-in `billing-stripe-testmode.test.ts` and the separate manual run are replaced by these specs. Known risk carried to Failure modes: Stripe's bot checks can make the hosted-page steps flaky.
History: none

### R8: TODO, flag subscriptions whose billing country doesn't match the consumer rules (plan §8)
Finding: TODO-1, P3, confidence 7/10, plan §8 "Self-declared country (TD)": Stripe can't restrict a billing address's country, so a person can pick a listed country in our drawer and enter another address; `BillingAccount.country` (schema.prisma "ISO 3166-1 alpha-2, from Stripe's customer address") is already mirrored by MUT-360. Reviewer: Claude.
Plan baseline: original proposal, a follow-up TD, not built here. Not approved. R1–R7 approved.
Runtime evidence: the country is mirrored into `billing_accounts.country` by `customer.updated` and sync; nothing compares it to `consumerCountries`; `billing:status` exists (ADR-165).
Comparison grid:
| Choice | Current | A | B | C |
|---|---|---|---|---|
| R1–R7 | approved D2–D8 | unchanged | unchanged | unchanged |
| R8 country-mismatch flag | §8 says TD, pending | add a TODOS.md item (P3): `billing:status` lists linked accounts whose `country ∉ consumerCountries` and that carry no tax ID | skip: not tracked | build it in MUT-362 |
Question D9:
D9 — Should we track a follow-up to flag people who paid as consumers from a country we don't sell to consumers in?
Project/branch/task: mini-crm main, MUT-362 plan §8.
ELI10: Our drawer asks where you're billed, but Stripe's card page can't stop someone from typing a different country. A consumer could pick Israel on our page and pay with a Jordanian address. Stripe Tax then works from the real address, which may be a country where Barmajiyat Ltd isn't registered. A small operator report could list those accounts so Basel can follow up. It doesn't need to block this ticket.
Stakes if we pick wrong: skipping it leaves a possible tax exposure nobody sees; building it now grows a ticket that's already large.
Recommendation: A because it's a real but rare risk, cheap to note, and belongs with the operator tooling after MUT-355 sets the country list.
Note: options differ in kind, not coverage — no completeness score.
Pros / cons:
A) Add to TODOS.md (recommended)
  ✅ The risk stays visible with a clear starting point (`billing:status`, `billing_accounts.country`)
  ✅ Keeps MUT-362 to the ticket's scope
  ❌ Until it's built, a mismatch is only found by reading Stripe by hand
B) Skip
  ✅ Nothing more to track while the consumer list is still empty
  ✅ No operator tooling to keep up
  ❌ Once countries open, the exposure is invisible
C) Build it now
  ✅ The report exists the day consumer countries open
  ✅ Small: one query and one CLI column (human: ~2h / CC: ~15 min)
  ❌ Grows MUT-362 beyond its acceptance criteria
Net: note it now and build it with the operator tools, or carry it inside this ticket.
Header: Country flag TODO
Options:
A) Add to TODOS.md (recommended)
New TODOS.md item, P3: `billing:status` flags linked accounts with `country ∉ consumerCountries` and no tax ID; depends on MUT-355 filling the list. No code in MUT-362.
B) Skip
Not tracked; §8's risk line stays in this brief only.
C) Build it now
Add the flag to `billing:status` and its admin route in MUT-362, with a unit test. Human ~2h / CC ~15 min.

State: approved
Actual answer: C) Build it now (Basel, D9, 2026-10-22; not the recommendation)
Accepted scope: in MUT-362, `billing:status` (`server/src/scripts/users.ts billing-status`) and its admin route flag each linked account whose `country` is not in `consumerCountries` and that carries no tax ID, with a unit test. Built on the mirrored `billing_accounts.country`; the tax-ID fact comes from Stripe's customer (expanded `tax_ids`) at status time, or from a stored flag if the build finds the sync already has one (to be settled at build, no new migration assumed).
History: none

Approval readiness: PASS — R1 (D2 A), R2 (D3 A), R3 (D4 A), R4 (D5 A), R5 (D6 A), R6 (D7 A), R7 (D8 B), R8 (D9 C); structure D1 (B). Person-level registration is a folded correction, not a remedy.

## Section 1 — Architecture review

- [P1] (confidence 8/10) `server/src/billing/entitlement.ts:81` `LAPSED_STATUSES = new Set(['unpaid', 'canceled', 'paused'])` vs plan §2.3 "live subscription": an unpaid subscription would allow a second Checkout. R5.
- [P1] (confidence 8/10) `.claude/designs/mut-360-stripe-webhook.md:682` OV-7: Checkout-created customers can duplicate. R2.
- [P2] (confidence 9/10) `server/DEPLOYMENT.md:1178` the key is read-only; Checkout needs writes. R1.
- [P2] (confidence 9/10) `server/src/app.ts:219` person-level routes must join `organizationIndependent`; the draft didn't. Correction folded into §2.4 (mechanics of the stated person-level contract; no behaviour choice).
- [P2] (confidence 8/10) plan §2.7 polling vs a confirm endpoint. R3.
- [P2] (confidence 9/10) migration.sql:120 no-expiry grants for every existing user. R4.

Flow (as approved):

```
BillingDrawer ──GET /v1/billing──▶ routes/billing.ts ─┬─ billing.summaryOf(user.id)        (store, sessionOnly)
                                                      ├─ checkoutGateway.pricesByLookupKey (10-min cache; Stripe failure → catalog null)
                                                      └─ billing-countries.json             (boot-validated)
Subscribe ──POST checkout-session──▶ planCheckout(pure) ── error? → 409/422/503
                                         │ ok
                                         ▼
                              customerFor: account → list(email)+metadata → create(idempotency)
                                         ▼
                              createCheckoutSession ── resource_missing → 409 NEEDS_HELP ── other → 502
                                         ▼  { url } → Stripe hosted page → webhook (MUT-360) → billing_subscriptions
Manage billing ──POST portal-session──▶ account? no → 409 NO_BILLING_ACCOUNT ─ yes → createPortalSession → { url }
Return (?checkout=success) → poll /v1/me 2 s × 30 s → "You're subscribed" | "can take a minute"
```

Dispositions: R1 approved D2 (A), R2 approved D3 (A), R3 approved D4 (A), R4 approved D5 (A), R5 approved D6 (A), person-level registration folded in.

## Section 2 — Code quality review

- [P2] (confidence 7/10) plan §2.4 maps every gateway error to 502; a deleted linked customer (`resource_missing`, not transient per `gateway.ts:135-145`) would read "try again" forever. R6.
- [P3] (confidence 6/10, medium: verify) plan §2.3 counts `incomplete` as live, which blocks a new Checkout for up to 23 h after a 3-D Secure abandonment on a subscription Checkout created. Checkout normally creates the subscription only on success, so this should be rare. No change proposed; listed under Failure modes.
- Shared code: no extraction proposed. `STRIPE_API_VERSION`, `toGatewayError`, `setupLinkOrigin`, `entitlementsFor`, `SlidingWindowRateLimiter` are reused as they are (rubric: no second caller needs a new helper).

Dispositions: R6 approved D7 (A); `incomplete` kept as planned (no remedy proposed).

## Section 3 — Test review

Framework: Vitest (unit and Dexie/server integration), Playwright through release-qa; commands from CLAUDE.md Phase 4 (Node 22).

```
CODE PATHS                                               USER FLOWS
[+] billing/checkout.ts planCheckout (pure)              [+] Subscribe (trial → paid)
  ├── [PLANNED ★★★] live sub → ALREADY_SUBSCRIBED          ├── [PLANNED →E2E] IL person ILS, real hosted page (D8)
  ├── [PLANNED ★★★] unpaid → RESUME_IN_PORTAL (D6)         ├── [PLANNED →E2E] business USD with tax ID (D8)
  ├── [PLANNED ★★★] paused → CONTACT_US                    ├── [PLANNED ★★] return: poll ends ACTIVE / 30 s timeout
  ├── [PLANNED ★★★] no owned profile / Malafat / grant     └── [PLANNED ★★] consumer, non-listed country → contact us
  ├── [PLANNED ★★★] person ∉ consumerCountries → 422     [+] Manage
  ├── [PLANNED ★★★] prices missing → 503                   ├── [PLANNED →E2E] portal cancel → "Ends on" (D8)
  ├── [PLANNED ★★★] ILS/USD, 3 tax-ID variants             └── [PLANNED →E2E] test clock past period → READ_ONLY
  └── [PLANNED ★★★] returnPath rejects absolute/protocol [+] Error states
[+] stripe/checkout-gateway.ts                             ├── [PLANNED ★★] Stripe down → 502 message, drawer stays
  ├── [PLANNED ★★★] customerFor: account / list / create   ├── [PLANNED ★★] deleted customer → contact us (D7)
  ├── [PLANNED ★★★] price cache hit / expiry               ├── [PLANNED ★★] open soon (no prices)
  └── [PLANNED ★★] session + portal params on the wire     └── [PLANNED ★★] RTL 375 px
[+] routes/billing.ts
  ├── [PLANNED ★★★] 401, 409×6, 422, 429, 502, 503
  ├── [PLANNED ★★★] no X-Mutaba3a-Profile needed
  ├── [PLANNED ★★] audit rows; GET survives Stripe failure
  └── [PLANNED ★★] route-security: session-only
[+] store billing.summaryOf (memory + Prisma contract)
  └── [PLANNED ★★★] none / linked+subs / unlinked hidden
[+] MUT-360 sync (unchanged)
  └── [PLANNED ★★] customerFor-made customer links and covers

COVERAGE (planned): 30/30 paths have a planned test | QUALITY: ★★★ 17, ★★ 13 | GAPS: 0 (6 E2E against Stripe test mode)
```

Regression: MUT-360's sync is not changed; its existing `sync.test.ts` and `store-contract-billing.ts` cases keep running unchanged. No existing behaviour is at risk, so no regression contract question.

Tests made obsolete: none.

Dispositions: R7 approved D8 (B, against the recommendation). Test plan artifact written (see below).

## Section 4 — Performance review

- No issues found. `GET /v1/billing`: one store read (`summaryOf`) plus a cached catalog (one `prices.list` per instance per 10 min). `planCheckout`: `entitlementsFor` over the person's owned profiles, at most 6 (MUT-182 cap), one `factsFor` (three queries). Subscribe: 1–3 Stripe calls with an 8 s budget. Polling: at most 15 `/v1/me` reads per return. Scale: per person, not per row; no unbounded query.

## Outside voice

Codex is not installed; the native fallback (a Claude Plan subagent) produced no complete report within the five-minute limit and was stopped. **Outside coverage: unavailable.** No cross-model comparison. Logged as `codex-plan-review` `unavailable`.

## TODOS.md updates

One proposal (R8, the country-mismatch flag); Basel chose to build it in this ticket (D9 C), so nothing goes to TODOS.md.

## NOT in scope

- Firm tier purchase and the pilot firms' price move: MUT-363.
- Prices on the landing page and /hosted: MUT-365 (needs these routes and MUT-355).
- Refusing writes on READ_ONLY / LOCKED profiles and the locked screen: MUT-361; this ticket only reports the state.
- Starting the trial at email verification: MUT-366 (signup); the drawer shows a trial only where `trialStartedAt` is set.
- The phone's billing screens: MUT-364.
- A "confirm this checkout" endpoint: rejected (D4 A, polling).
- A second, write-only Stripe key: rejected (D2 A).

## What already exists

- MUT-360's webhook and reconcile (`stripe-billing.ts`, `sync.ts`) link a Checkout through `client_reference_id` and mirror `cancelAtPeriodEnd` and cancellation: reused unchanged.
- `STRIPE_API_VERSION` and `toGatewayError` (`gateway.ts:12`, `:135`): imported, not extracted (D1 B).
- MUT-358's `entitlementsFor` / `factsFor`, `TRIAL_DAYS`, `TRIAL_LOCK_DAYS`: reused for coverage and the trial view.
- `setupLinkOrigin` (`auth/account-setup.ts:48`), `SESSION_ONLY` and the `records-export.ts` route shape, `SlidingWindowRateLimiter` per user (`receipts.ts:110`).
- Portal: `AccountDrawers` + `ProfileDrawerSearch` URL keys, `Drawer`, `Select` from `ui/Input`, `useMe`, `useTp`, `SUPPORT_EMAIL` (`terms.ts:26`), QA `FakeApi` for the non-Stripe specs.
- `billing:status` (`users.ts billing-status`, ADR-165 review): extended with the country flag (D9 C).

## Failure modes

| Path | Realistic failure | Handling | Test | User sees |
|---|---|---|---|---|
| GET /v1/billing | Stripe down while loading prices | catalog `null`, warn log | route test | drawer opens; "Subscriptions open soon" style message, Manage billing still works |
| Checkout session | Stripe timeout / 5xx | 502 `STRIPE_UNAVAILABLE` | route test | "Couldn't reach the payment provider, try again" |
| Checkout session | linked customer deleted | 409 `BILLING_ACCOUNT_NEEDS_HELP`, warn log (D7) | route test | contact us |
| Checkout session | unpaid subscription | 409 `RESUME_IN_PORTAL` (D6) | unit + drawer test | pay the open invoice in Manage billing |
| Return from Checkout | webhook slow or lost | poll 30 s, then "can take a minute"; reconcile heals overnight (D4) | component test | honest wait message, never an error |
| Two tabs Subscribe | two customers | `customerFor` idempotency + metadata (D3) | fixture test | one customer, one link |
| Self-declared country | consumer address outside the list | `billing:status` flag (D9) | unit test | nothing (operator follow-up) |
| `incomplete` subscription | blocks a new Checkout up to 23 h | treated as live (kept) | unit row | "already subscribed"; Manage billing |
| Release-QA hosted pages | Stripe's bot checks block or slow the card form | none in code (D8 B accepted the risk) | the specs themselves | flaky QA runs, not a user-facing failure |

Critical gaps: 0 (no path is untested, unhandled and silent).

## Worktree parallelization strategy

| Step | Modules touched | Depends on |
|---|---|---|
| S1 server: config + store read | `server/billing-countries.json`, `server/src/repositories/` | — |
| S2 server: gateway + decision | `server/src/billing/` | S1 |
| S3 server: routes + OpenAPI + status flag | `server/src/routes/`, `server/src/app.ts`, `server/openapi/`, `server/src/scripts/` | S2 |
| S4 portal: pure view + countries | `src/hosted/data/` | — |
| S5 portal: drawer, menu, i18n, types | `src/hosted/components/`, `src/hosted/shell/`, `src/hosted/i18n/`, `src/hosted/api/` | S3 (types), S4 |
| S6 QA + docs | `qa/`, `docs/operations/`, `server/DEPLOYMENT.md`, `.claude/` | S5 |

Lane A: S1 → S2 → S3 (server). Lane B: S4 (portal pure code), in parallel with lane A. Then S5, then S6. Conflict flags: S3 and S5 meet at `server/openapi/openapi.yaml` → `src/hosted/api/schema.d.ts` (`npm run hosted:types`); run it once after S3. Per the one-worktree-per-epic rule, both lanes can live in one worktree run sequentially; the parallel win is small.

## Implementation Tasks
Synthesized from this review's findings. Each task derives from a specific finding above. Run with Claude Code or Codex; checkbox as you ship.

- [ ] **T1 (P1, human: ~1h / CC: ~10min)** — server routes — Register the three billing routes as organization-independent
  - Surfaced by: Section 1 — `app.ts:219` person-level registration missing
  - Files: `server/src/routes/billing.ts`, `server/src/app.ts`
  - Verify: `billing-routes.test.ts` calls each route without `X-Mutaba3a-Profile`
- [ ] **T2 (P1, human: ~2h / CC: ~15min)** — checkout gateway — `customerFor` find-or-create with metadata and idempotency key (D3)
  - Surfaced by: Section 1 — OV-7 duplicate customers (R2)
  - Files: `server/src/billing/stripe/checkout-gateway.ts`, its test and fixtures
  - Verify: `npm --prefix server test -- checkout-gateway`
- [ ] **T3 (P1, human: ~1h / CC: ~10min)** — checkout decision — `unpaid` → `RESUME_IN_PORTAL`, `paused` → `CONTACT_US`, drawer `unpaid` panel (D6)
  - Surfaced by: Section 1 — `entitlement.ts:81` LAPSED_STATUSES (R5)
  - Files: `server/src/billing/checkout.ts`, `src/hosted/data/billingView.ts`, `BillingDrawer.tsx`, i18n
  - Verify: `checkout.test.ts`, `billingView.test.ts`
- [ ] **T4 (P2, human: ~45min / CC: ~5min)** — routes — map `resource_missing` to 409 `BILLING_ACCOUNT_NEEDS_HELP` with an ids-only warn log (D7)
  - Surfaced by: Section 2 — R6
  - Files: `server/src/routes/billing.ts`, OpenAPI, drawer copy
  - Verify: route test with a fake gateway throwing `resource_missing`
- [ ] **T5 (P2, human: ~1h / CC: ~10min)** — checkout decision + drawer — `COVERED_BY_GRANT` for no-expiry grants, "free until" for expiring ones (D5)
  - Surfaced by: Section 1 — migration.sql:120 (R4)
  - Files: `server/src/billing/checkout.ts`, `billingView.ts`
  - Verify: unit rows for both grant kinds
- [ ] **T6 (P2, human: ~30min / CC: ~5min)** — docs — widen the restricted key: Customers, Checkout Sessions, Customer portal Write (D2)
  - Surfaced by: Section 1 — R1
  - Files: `server/DEPLOYMENT.md` §6e, `docs/operations/pilot-runbook.md` §1.7, `docs/operations/before-release.md`
  - Verify: Basel edits the key in the dashboard; the release-QA run against test mode passes
- [ ] **T7 (P1, human: ~2 days / CC: ~2h)** — release-QA — billing specs against a real dev API and Stripe's hosted pages in test mode (D8 B)
  - Surfaced by: Section 3 — R7
  - Files: `qa/features/portal/billing.yaml`, `qa/specs/portal/billing.spec.ts`, `qa/qa.config.mjs` (a live-API start for billing), QA harness for the test clock customer
  - Verify: `release-qa run --attach --only <id>` passes for each of the 7 features; `release-qa lint` clean
- [ ] **T8 (P2, human: ~2h / CC: ~15min)** — operator — `billing:status` country-mismatch flag (D9 C)
  - Surfaced by: TODO review — R8
  - Files: `server/src/scripts/users.ts`, `server/src/routes/admin-billing.ts` (or the status route), its test
  - Verify: unit test with a linked account outside `consumerCountries` and no tax ID

## Unresolved decisions

None.

## Completion summary

- Step 0: Scope Challenge — scope accepted as-is (smaller arrangement, D1 B)
- Reality rows: 11/11 applicable rows emitted (`PLAN_REALITY` below), 2 unverified premises (P8, P11)
- Architecture Review: 6 issues found
- Code Quality Review: 2 issues found
- Test Review: diagram produced, 1 gap identified (AC5 proof, resolved D8)
- Performance Review: 0 issues found
- NOT in scope: written
- What already exists: written
- TODOS.md updates: 1 item proposed to user (built now, D9 C)
- Failure modes: 0 critical gaps flagged
- Unresolved decisions: 0 in this review
- Outside voice: codex, unavailable (not installed; native Plan fallback gave no complete report in 5 minutes)
- Parallelization: 2 lanes, 1 parallel pair (S1–S3 with S4) / 2 sequential (S5, S6)
- Lake Score: 2/4 (D3 and D6 chose the 10/10 option; D7 chose 9/10, D8 chose 8/10)

### Suppressed findings (appendix)

- (confidence 4/10) `customers.list({ email })` may miss a customer whose email the person changed in Stripe's portal; the idempotency key still covers 24 h and an orphan customer has no subscription. Not reported.

PLAN_REALITY: phase=eng rows=7/7 missing=none unverified=2 verdict=complete

---

# Design review (/plan-design-review, 2026-10-22)

Target: this plan's Billing drawer (§2.7–§2.8). No DESIGN.md in the repo; calibrated against the brand v2 kit (`docs/brand/README.md`), the Your data drawer (`HostedYourDataDrawer.tsx`) and the portal wireframes in `.claude/designs/`. Focus: all 7 passes (D1 A). Outside design voices: skipped (D2 B; Codex not installed). Visuals: an HTML wireframe from the real tokens instead of generated PNGs (Basel's standing preference), `.claude/designs/mut-362-billing-drawer-wireframe.html`.

## Design passes

- **Pass 1 Information architecture: 4/10 → 9/10.** The plan listed contents without an order. DR1 (status first), DR2 (Subscribe as a second step), DR3 (profiles list only when states differ) and the structure diagram in §2.8 fix it.
- **Pass 2 Interaction states: 3/10 → 9/10.** No loading, error, busy or unconfigured states. DR4 (state table) and DR5 (open soon when unconfigured).
- **Pass 3 Journey: 5/10 → 9/10.** The English hand-off was unannounced. DR6 heads-up; storyboard and time horizons in §2.8.
- **Pass 4 AI slop: 7/10 → 9/10.** Classifier: OPERATE (app UI). Hard rejections: none. Risk found: a two-price-card interval picker (pricing-page look); DR7 replaced it with a segmented control and a computed saving. Litmus: brand unmistakable in first screen, YES (portal shell, display face headline); one visual anchor, YES (status chip + headline); scannable by headlines, YES; one job per section, YES; cards necessary, YES only for the buyer radio cards (the card is the control); motion, n/a (Drawer's existing spring only); premium without shadows, YES.
- **Pass 5 Design system: 5/10 → 8/10.** Chip colours undefined (DR8); radio cards would have been duplicated (DR9). Remaining gap: no DESIGN.md (the brand kit stands in); not a blocker for this ticket.
- **Pass 6 Responsive and accessibility: 3/10 → 9/10.** DR10 phone layout and a11y spec; MUT-357's drawer width fix is already on main (`d515f942`).
- **Pass 7 Unresolved decisions:** 3 found and resolved (DR11 no default country, DR12 both currencies in the status view, DR13 Palestine label), 0 deferred.

## Design NOT in scope

- Prices on the landing page and /hosted: MUT-365.
- The locked screen itself: MUT-361 (it links to `?billing=true&step=subscribe`).
- Stripe's hosted pages' look: Stripe-controlled; only `custom_text` is ours.
- A DESIGN.md for the whole product: not this ticket; the brand kit is the reference.

## Design: what already exists

- `Drawer` / `DrawerFrame` (springs, focus, phone width from MUT-357), the Your data drawer's banner and button patterns, `hp-type-card` radio cards (MUT-183 design review Issue 7), `SegmentedControl`, `Select` from `ui/Input`, `useTp` plurals, `SUPPORT_EMAIL` mailto, brand v2 mint/butter/rose/lavender AAA pairs, IBM Plex Mono figures in `<bdi>` (MUT-109).

## Design TODOS.md updates

None: every finding was decided and lands in this ticket.

## Design implementation tasks

Synthesized from this review's findings. Each task derives from a specific finding above.

- [ ] **DT1 (P1, human: ~1 day / CC: ~1h)**: portal billing: status-first panels, chip colours, both-currency plan line, every state
  - Surfaced by: Passes 1, 2, 5, 7: DR1, DR4, DR8, DR12
  - Files: `src/hosted/components/BillingDrawer.tsx`, `src/hosted/data/billingView.ts`, `src/hosted/i18n/{ar,en}.json`, `src/hosted/hosted.css`
  - Verify: `billingView.test.ts`, `BillingDrawer.test.tsx`, release-QA billing features
- [ ] **DT2 (P1, human: ~4h / CC: ~30min)**: Subscribe step: no-default country, RadioCards buyer, segmented interval with computed saving, English heads-up
  - Surfaced by: Passes 1, 3, 4, 7: DR2, DR6, DR7, DR11, DR13
  - Files: `BillingDrawer.tsx`, `src/hosted/data/countries.ts`, `src/hosted/data/filters.ts`
  - Verify: unit tests for the saving note and the PS override; `subscribe` QA feature
- [ ] **DT3 (P2, human: ~1h / CC: ~10min)**: extract `RadioCards`; `ProfileTypeCards` wraps it
  - Surfaced by: Pass 5: DR9
  - Files: `src/hosted/components/RadioCards.tsx`, `ProfileTypeCards.tsx`, `.claude/COMPONENT_REGISTRY.md`
  - Verify: existing ProfileTypeCards tests unchanged
- [ ] **DT4 (P1, human: ~3h / CC: ~20min)**: phone layout and accessibility
  - Surfaced by: Pass 6: DR10
  - Files: `BillingDrawer.tsx`, `qa/specs/portal/billing.spec.ts`
  - Verify: `rtl-375` QA feature, axe in the billing specs
- [ ] **DT5 (P2, human: ~1h / CC: ~10min)**: profiles list only when billing states differ
  - Surfaced by: Pass 1: DR3
  - Files: `billingView.ts`
  - Verify: unit test for both cases
- [ ] **DT6 (P2, human: ~30min / CC: ~5min)**: Billing menu item always shown signed in; open soon when unconfigured
  - Surfaced by: Pass 2: DR5
  - Files: `src/hosted/shell/UserMenu.tsx`, `AccountDrawers.tsx`
  - Verify: component test with `configured: false`

## Approved Mockups

| Screen/Section | Mockup Path | Direction | Notes |
|----------------|-------------|-----------|-------|
| Billing drawer: status panels, Subscribe step, return, phone | /Users/basel/Work/Barmajiyat/Mutaba3a/mini-crm/.claude/designs/mut-362-billing-drawer-wireframe.html | HTML wireframe from brand v2 tokens, ar/en, light/dark | Prices are examples; every section tagged with its approving DR |

## Design Review Completion Summary

```
  +====================================================================+
  |         DESIGN PLAN REVIEW — COMPLETION SUMMARY                    |
  +====================================================================+
  | System Audit         | no DESIGN.md (brand v2 kit used); UI scope: |
  |                      | one drawer, 2 steps, ~12 states             |
  | Step 0               | 4/10, all 7 passes + wireframe              |
  | Pass 1  (Info Arch)  | 4/10 → 9/10 after fixes                     |
  | Pass 2  (States)     | 3/10 → 9/10 after fixes                     |
  | Pass 3  (Journey)    | 5/10 → 9/10 after fixes                     |
  | Pass 4  (AI Slop)    | 7/10 → 9/10 after fixes                     |
  | Pass 5  (Design Sys) | 5/10 → 8/10 after fixes                     |
  | Pass 6  (Responsive) | 3/10 → 9/10 after fixes                     |
  | Pass 7  (Decisions)  | 3 resolved, 0 deferred                      |
  +--------------------------------------------------------------------+
  | NOT in scope         | written (4 items)                           |
  | What already exists  | written                                     |
  | TODOS.md updates     | 0 items proposed                            |
  | Approved Mockups     | 1 HTML wireframe, approved by decisions     |
  | Decisions made       | 13 added to plan (DR1–DR13)                 |
  | Decisions deferred   | 0                                           |
  | Overall design score | 3/10 → 8/10                                 |
  +====================================================================+
```

Plan is design-complete. Run /design-review after implementation for visual QA.

Unresolved design decisions: none.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 (this plan) | — | not run |
| Outside Review | codex (not installed) → native Plan fallback, eng plan-review; design voices skipped | Independent 2nd opinion | 1 eng (unavailable), 1 design (skipped) | unavailable / skipped | no outside findings |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 (this plan) | ISSUES OPEN (all resolved) | 9 issues, 0 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 1 (this plan) | CLEAR | score: 3/10 → 8/10, 13 decisions |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 (this plan) | — | not run |

- **OUTSIDE COVERAGE:** codex, eng plan-review phase, unavailable (CLI not installed; the native fallback gave no complete report in five minutes). Design phase: skipped by choice (D2 B). No outside findings.
- **VERDICT:** DESIGN CLEARED. Eng review logged `issues_open` with all 9 findings answered (D1–D9); eng review required by the dashboard rule, its decisions are complete.

NO UNRESOLVED DECISIONS

## /qa-reconcile review (2026-10-23)

Eight reviewers (testing, maintainability, security, performance, API contract, design, simplification, red team) plus an adversarial pass found two money bugs (a second Checkout could be paid; a cancelled row could hide the live one and strand a payer) and a set of smaller ones. Basel's answers:

| # | Question | Answer |
|---|---|---|
| R-D1 | Apply the review's fix set before review? | **All fixes**, design polish and test gaps included |
| R-D2 | A person who subscribes during the trial: first charge when? | **Keep the trial**: `trial_end` = their trial end when ≥ 48 h away; the step says when |
| R-D3 | The IL/JO business tax number typed on Checkout | **Onto the customer + invoices** (the webhook copies it); D9 counts it |
| R-D4 | A co-owner opening Billing | **Follow the server**: `coveredProfileIds` (profiles they created); a note for shared profiles |

Recorded in ADR-170's amendment; what stays open is TD-203 (an early `cancel_at` date), TD-204 (interval from the lookup key) and TD-205 (`client_reference_id` trust).
