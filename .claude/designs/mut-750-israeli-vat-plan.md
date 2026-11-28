# MUT-750: Israeli VAT on subscriptions, and an Israeli tax invoice-receipt for each Israeli payment

Status: **APPROVED with every default answer (Basel, 2026-11-27); not built.** Epic MUT-566. Blocked (for the tax-document half only) by MUT-749, MUT-355,
MUT-639's accountant answer and the production signing certificate (ADR-286 d4). Builds on ADR-286 and ADR-288.

```
Tracker: Jira · barmajiyat.atlassian.net · MUT · Backlog = not committed · finished → In Review
```

## 0. What MUT-702 Part B already did (merged, ADR-288)

| MUT-750 scope line | State on main | Where |
|---|---|---|
| 18% added only for an Israeli billing address | **Done** for plan Checkouts (Solo, Business, Firm, the Solo trial): an exclusive Stripe tax rate (`metadata.mtb3a_vat = IL`) on the line item, `automatic_tax` off for IL, on elsewhere | `billing/checkout.ts:59-67,391-405`, `scripts/stripe-plans.ts` |
| Rate from one config value, not a literal | **Done**: `billing-countries.json` `vatRates.IL = 18`, validated at load | `billing/checkout.ts:472-479` |
| How the address is taken | **Done**: our own address form before Checkout; `customer_update.address = never` | `BillingPlanPicker.tsx`, `SoloTrialStep.tsx` |
| Business customer's VAT number kept | **Done**: `businessTaxNumber` → Stripe customer tax id (`copyTaxNumber` on `checkout.session.completed`) | `billing/stripe/sync.ts` |
| Price shown before VAT, "+ VAT" for Israel, before paying | **Done in the plan row** ("+ VAT" once the country is Israel); the split (subtotal, VAT, total) is on Stripe's Checkout page | `hosted.billing.plan.plusVat` |
| Amount and currency as Stripe charged them (ADR-004) | **Done**: the mirror stores nothing of the amount; Stripe's invoice is the record | — |
| Landing / pricing copy "excluding VAT; VAT added for Israel" | **Nothing to do on the landing**: it names no price (ADR-283). `docs/commercial/pilot-offer.md` still says "VAT is added where the law requires it" | docs only |
| **An Israeli tax invoice-receipt from Barmajiyat per payment** | **Not started** | this plan, slice B |

So the checkout half is about 85% done. What is left is three small gaps (slice A) and the whole tax-document half (slice B).

## 1. Acceptance criteria (remaining)

Slice A (no blocker):
1. The Israeli VAT survives every change to an Israeli subscription that is not a new Checkout: the yearly switch (MUT-531), a plan change (MUT-734), a pause's end, and a renewal. Each such update sends the item's `tax_rates` explicitly.
2. A billing-address change after Checkout (Stripe Customer Portal) that moves a subscriber **into or out of** Israel updates the subscription's tax from the next invoice: into IL → the IL rate on the item and `automatic_tax` off; out of IL → no rate, `automatic_tax` on. (ADR-288 d4 says "the tax follows the new address"; with a fixed tax rate that is only true once this is built.)
3. The legacy Freelancer Checkout (`plan` absent while `PLAN_CHECKOUT` is off) treats an Israeli address the same way, or is refused for IL (Q2).
4. The portal's Subscribe step shows, for an Israeli address, the price, the VAT line and the total before Continue (one line each, data only). Phone: nothing (it never sells).
5. `pilot-offer.md` and `billing-spike.md` say "Prices exclude VAT. Israeli VAT is added for an Israeli address."

Slice B (blocked by MUT-749 / MUT-639 / signing certificate):
6. Every paid Stripe invoice whose customer address is Israeli produces one Israeli **invoice-receipt (320)** issued by Barmajiyat Ltd's own MTB3A business profile: number, date = payment date, the customer's name, address and VAT number (business buyer), the plan line before VAT, VAT at the rate Stripe charged, total = Stripe's `amount_paid` in ILS minor units. Exactly once per Stripe invoice.
7. Above the allocation threshold with a business customer's VAT number, it carries an allocation number through Barmajiyat's own Tax Authority connection (today no plan price reaches the threshold; the path must still work).
8. The subscriber gets the signed PDF by mail (ar or en, the account's language), and can download it from Billing.
9. A Stripe refund of an Israeli payment produces a credit note (330) against that invoice-receipt (MUT-643 rules).
10. A failure to issue (issuer not set up, Tax Authority down) never fails the webhook: it is retried by the nightly reconcile and listed for the operator.

## 2. Where the code goes

### Slice A
- `billing/stripe/plan-gateway.ts`: every `subscriptions.update` that sets `items[].price` (yearly switch, MUT-734's change) passes `tax_rates` from a new pure helper `taxRatesFor(country, israelVatRateId)` in `billing/checkout.ts` (the one rule already used at Checkout). Pause end and renewals keep the item's rates (Stripe carries them); a test pins it.
- `billing/stripe/sync.ts` `refreshCustomer` (already handles `customer.updated`): when the customer's address country crosses IL, call a new `planGateway.retax(subscriptionId, { taxRates, automaticTax })` with `proration_behavior: 'none'`. Idempotency key `mut750-retax-<sub>-<country>`.
- `billing/checkout.ts`: the legacy branch reads `plan !== null` today; per Q2 either apply the same rate or refuse `ADDRESS_NOT_SOLD` for IL.
- Portal `components/BillingPlanPicker.tsx` / `data/billingPlans.ts`: with IL chosen, three lines (price, VAT 18%, total) computed from the catalog amount and `GET /v1/billing.vatRate` (new additive field: the IL rate from config, so no rate is written in the portal). Rounding: Stripe rounds per line half-up in minor units; the portal uses the same (`Math.round(amount * rate / 100)`), tested against 3900 → 702.

### Slice B: subscription tax documents
- `billing/subscription-tax-document.ts` (new, pure): `taxDocumentOf(stripeInvoice, customer, issuer, rules)` → an `IssueRequest` for a 320, or a reason to skip (`not-israeli`, `zero-amount`, `not-paid`). The VAT on the document is **Stripe's `total_tax_amounts`**, not recomputed; the document's `pricesIncludeVat: false`.
- `issuing/issue-service.ts` (new): extract the body of `routes/issuing.ts` `issueOne` (today a route closure on the Hono context, 293–420) into a service that takes `{ store, organization, actor, body, requestKey, now, deps }`. The route calls it; so does the billing job. No behaviour change (DRY; the route tests stay green unchanged). This is the largest piece of refactoring.
- `billing/subscription-tax-documents-job.ts` (new): `issueFor(stripeInvoiceId)`: reads the invoice and customer through the provider port (new `BillingProvider.paidInvoice(id)`), composes, calls the issue service with `requestKey = stripe-invoice:<id>` (the existing `(organizationId, requestKey)` unique gives exactly-once; no new table), actor `SYSTEM` (audit `billing.tax_document_issued`), then mails the copy through the existing copy path (`issuing/copies.ts`, counted as the first copy).
- `billing/stripe/sync.ts` `invoice.paid`: after the mirror sync, `void taxDocuments.issueFor(id)` behind `SUBSCRIPTION_TAX_DOCUMENTS`; errors logged with code `TAX_DOCUMENT_PENDING`. `charge.refunded` (added to `HANDLED`) → credit note against the stored document (found by `requestKey`).
- Nightly reconcile: a sweep over the last 35 days of paid IL invoices with no document → `issueFor`. `billing:tax-documents` operator script lists the pending ones (dry run by default).
- Config: `SUBSCRIPTION_TAX_DOCUMENTS` (`true|false`, default false), `SUBSCRIPTION_ISSUER_ORGANIZATION_ID` (Barmajiyat's profile in production; validated at boot to exist, be a business profile with issuer details, country IL). Terraform `subscription_tax_documents`, `subscription_issuer_organization_id`. ADR-286 d7: configuration, not code.
- `GET /v1/billing` gains `taxDocuments: [{ id, number, date, total, currency }]` (latest 12) and the portal's Billing drawer lists them under the receipts link (download = the existing copy endpoint, scoped to the subscriber, new read `GET /v1/billing/tax-documents/{id}/pdf`).
- Mail: new template `subscription-tax-document` (ar + en): subject "Tax invoice-receipt {number}", the PDF attached. No body text beyond the number, date and total.

## 3. API contracts

- `GET /v1/billing` (additive): `vatRate: { country: 'IL', percent: 18 } | null`; `taxDocuments: SubscriptionTaxDocument[]` (empty with the flag off).
- `GET /v1/billing/tax-documents/{id}/pdf` → `application/pdf`; 404 when the document isn't the caller's.
- No change to `POST /v1/billing/checkout-session`.

## 4. Error states

| Case | Behaviour |
|---|---|
| Issuer profile missing or not set up | Boot refuses with the flag on; at runtime `TAX_DOCUMENT_PENDING`, retried nightly, operator list |
| Tax Authority refuses or is down (allocation needed) | The issuing core's held-number path; the document waits; the operator sees it |
| Invoice not in ILS (an IL address on a USD subscription after moving) | Issued in USD with the Bank of Israel rate the issuing core already uses for foreign currency (MUT-667) — or skipped and listed until MUT-667 lands (Q5) |
| Stripe invoice partly refunded | Credit note for the refunded amount |
| Duplicate webhook | `requestKey` unique: the replay returns the existing document |

## 5. Migrations

**None expected.** Exactly-once rides `issued_documents (organizationId, requestKey)`. If the review prefers an explicit link table (`subscription_tax_documents(stripeInvoiceId unique, issuedDocumentId)`), it is one additive migration and must be timestamped **after the accountant-channel migrations** (MUT-763 holds `20261127150000_mut763_accountant_provisioning`; MUT-764+ may add more): re-stamp at merge time.

## 6. Tests (written first)

1. `checkout.test.ts`: `taxRatesFor` IL / non-IL / no rate configured.
2. `plan-gateway.test.ts`: yearly switch sends `tax_rates` for an IL subscription; `retax` payload both directions.
3. `sync.test.ts`: `customer.updated` IL→JO and JO→IL call `retax` once; same country does nothing.
4. `subscription-tax-document.test.ts`: compose from fixture invoices (monthly Solo ILS 3900 + 702; yearly Firm; business buyer with VAT id; non-IL skipped; zero-amount trial invoice skipped; Stripe's tax amount used verbatim).
5. `issue-service.test.ts`: the extracted service, plus all existing issuing route tests unchanged.
6. Job: exactly once on a replayed webhook; failure → pending, nightly sweep issues it; refund → credit note.
7. Portal: the three VAT lines for IL, none elsewhere; amounts from the catalog.
8. `test:db`: the requestKey replay on Postgres.

## 7. QA scenarios (release-QA)

| id | Steps | Outcome |
|---|---|---|
| `portal.billing.vat-lines-israel` | Billing › See plans › Solo › country Israel | Price, VAT and total lines before Continue |
| `portal.billing.no-vat-abroad` | the same with Jordan | Price only |
| `portal-live.billing.buy-solo-israel` (TD-347 sandbox) | Buy Solo with an IL address | Stripe total 3900 + 702; Billing lists invoice-receipt 1 |
| `portal-live.billing.tax-document-pdf` | Billing › the invoice-receipt › Download | PDF names Barmajiyat Ltd, VAT 702, total 4602 |
| `portal-live.billing.address-moves-out` | Customer Portal: change country to Jordan; next invoice (test clock) | No VAT on the next invoice |

## 8. Dependencies and order

- Slice A: none; can be built now (touches `plan-gateway.ts`, so build it before or with MUT-734 to avoid two edits of the same update call).
- Slice B: MUT-749 (Barmajiyat's VAT file number and issuer details), MUT-639 (accountant: may Barmajiyat issue with not-yet-registered software), MUT-567 software registration and the production signing certificate (Narabnd, ADR-286 d4). Build can proceed dark; release cannot.
- MUT-766 (accountant channel) extracts `startCheckout(payer)` in `checkout.ts`: rebase slice A onto it if it lands first.
- MUT-761 (pilot panel final prices) waits on this ticket.

## 9. Knowledge updates on build

ADR-288 amendment (the tax follows a country change via `retax`; tax rates on every item update); new ADR for subscription tax documents (Barmajiyat issues through its own profile, Stripe's tax amount is authoritative, exactly-once by request key). CHANGELOG, TEST_PLAN, before-release (Barmajiyat profile id, flag order: MUT-749 done → certificate → flag on), `pilot-offer.md`.

## 10. Questions only Basel (or the accountant) can answer

1. **Consumer prices** (MUT-355): may prices to Israeli individuals be advertised excluding VAT? If not, IL consumer prices must show VAT-inclusive in the portal (the catalog stays exclusive; the portal shows the total first).
2. **Today's Israeli ₪29 / founder payers** (legacy Freelancer, no VAT today): add 18% from their next renewal, absorb it (price becomes VAT-inclusive for them), or leave until MUT-707 moves them? [Default: leave until MUT-707, which re-prices them anyway.]
3. **What makes an address "Israeli"**: billing address country only (built), or also card country / an Israeli tax id? [Default: billing address only.]
4. **Stripe's own receipt mail** for Israeli customers: keep it alongside our invoice-receipt, or turn Stripe receipts off for IL so there's one document? [Default: keep Stripe's payment receipt; ours is the tax document.]
5. **An Israeli address on a USD subscription** (someone who moved): issue in USD with the Bank of Israel rate, or move them to ILS at renewal? [Default: list for the operator until MUT-667.]
6. **Barmajiyat's profile on a paid plan**: the issuer profile needs the Tax Authority connection (paid-plan feature); grant it Firm by operator grant? [Default: yes.]
7. May slice B be split into its own ticket (it is blocked by three outside tracks while slice A is not)? [Recommended: yes, "MUT-750b subscription tax documents".]

## Build decisions (slice A, server half, 2026-11-27, built alone with the approved defaults)

1. **ADR-290**, API **1.156.0-mut750**. Slice B is MUT-776, not built here.
2. **AC3 (legacy Freelancer Checkout): unchanged, Stripe Tax as today.** Q2's default leaves today's Israeli payers until MUT-707, and the legacy door only runs while `PLAN_CHECKOUT` is off (production today); refusing IL there would stop Israeli sales, and adding 18% would re-price production. Freelancer subscriptions are never re-taxed either.
3. **The switch sends the item's own rates** (`LivePlan.taxRateIds`, read from Stripe), not a recomputed rate: what Checkout put there stays. Nothing is sent for an item with none, so non-Israeli switches are byte-for-byte as before.
4. **Re-tax runs before the new country is saved**, so a failure is seen again: transient Stripe errors answer 500 (Stripe redelivers), a refusal is recorded `STRIPE_RETAX_FAILED`, a missing VAT rate `STRIPE_ISRAEL_VAT_RATE_MISSING` (operator resends after the fix). An item already right is left alone.
5. **Idempotency key** `mut750-retax-<sub>-<country>-<minute>` (the plan said `<sub>-<country>`; the minute lets IL→JO→IL within 24 h apply).
6. **`vatRate`** is published whenever billing-countries.json sets one (not tied to `PLAN_CHECKOUT`); the portal decides when to show it.
7. **Left for the UI half:** the price / VAT / total lines in `BillingPlanPicker` (AC4) and the QA flows.

## Build decisions (slice A, UI half, 2026-11-27)

1. **Wireframe mut-750a variant A**: a card under the address with Price, "VAT 18%" and "Total a month" for an Israeli address, one "Price a month" line elsewhere; it replaces the step's old "You'll pay" summary only on the plan step (the legacy Freelancer step and the launch-offer summary are unchanged).
2. **The rate is the server's** (`GET /v1/billing.vatRate`, `vatRateOf`), never a literal; with none from the server, the price alone. `priceLinesOf` rounds half-up in minor units as Stripe does (3900 → 702).
3. The plan row keeps its "+ VAT" (MUT-702 Part B) and the fine line "Prices exclude VAT" stays: the card is data, the row a label.
4. QA: `portal.plans.vat-lines-israel`, `portal.plans.no-vat-abroad` (FakeApi sends `vatRate` with plans on sale).
