# MUT-532 pause spike: result (2026-11-02, Stripe sandbox, API 2026-09-30.endive)

Script: `qa/support/mut532-pause-spike.mjs` (`node qa/support/mut532-pause-spike.mjs`). Setup: one test clock started
31 days and 3 hours back, three monthly ₪29 subscriptions on `pm_card_visa`, the clock advanced to 2 minutes before
now (two paid invoices each). A test clock holds at most 3 customers.

## (a) Pause: PASS
- Set mid-period: `pause_collection[behavior]=void`, `resumes_at` = the cycle boundary 2 months after the current
  period end, minus 1 h; `metadata.mutaba3a_pause_from` (ISO) and `mutaba3a_pause_months`.
- The status stays **`active`** throughout. Nothing happens to the paid period.
- At the period end (Dec 2) and the next boundary (Jan 2) Stripe makes the invoice and voids it (`void`, 0 paid).
- At `resumes_at` Stripe clears `pause_collection` itself and the Feb 2 invoice is paid (2900).
- The metadata **stays** after Stripe resumes. The mirror reads it only while `pause_collection` is set.
- The boundary rule (the anchor's day of the month, clamped, at the anchor's time) gave exactly Stripe's period ends.

## (b) Resume now: the plan's mechanism FAILS; a working one replaces it
- **Plan D7 as written** (clear `pause_collection` with `billing_cycle_anchor: now` and `proration_behavior: none`)
  makes **no invoice at all**: the cycle restarts today and the new month is free. That holds in one call or two, and
  for `create_prorations` too. `always_invoice` charges only the new month less a credit for the voided period
  (₪4.68 five days in), because Stripe treats the voided period as paid. `billing_cycle_anchor` takes `[type]=now`
  in this API version; a bare `now` is refused.
- **What works** (same product behaviour as D7 and the approved copy, "You pay {month} today, and your plan renews
  monthly from today"):
  1. `subscriptions.update`: `pause_collection: ''`, `billing_cycle_anchor[type]=now`, `proration_behavior: none`;
  2. `invoiceitems.create` on the subscription: `price_data` copied from the subscription's own price (currency,
     product, `unit_amount`, `tax_behavior`), its period = the new period. A recurring `price` is refused on an
     invoice item;
  3. `invoices.create` with `subscription`, `auto_advance: true`, automatic tax; then `finalize` and `pay`.
- A good card: the invoice is paid (2900, `billing_reason: manual`), it becomes the subscription's `latest_invoice`,
  and the next cycle bills on the new day (2900).
- A declined card (`pm_card_chargeCustomerFail`): the invoice stays open, the subscription goes **`past_due`** and
  Stripe retries it. That is the normal GRACE path D7 promised, so no new copy.

## (c) Switch: MUT-531's spike (`mut-531-switch-spike-result.md`)

## (d) Stay coupon: PASS
- A coupon with `percent_off 50`, `duration repeating`, `duration_in_months 2`, `applies_to` the Freelancer product,
  applied mid-period with `discounts[0][coupon]`: the next invoices are 1450, 1450, then 2900. After that
  `discounts` is `[]` again.

## (e) Key scopes
The sandbox key isn't restricted. Resume now also writes invoice items and invoices, so the live restricted key needs
**Write on Invoices** (and Invoice items, where Stripe lists it apart) beside Write on Subscriptions. That is operator
step 1 in `docs/operations/before-release.md`.
