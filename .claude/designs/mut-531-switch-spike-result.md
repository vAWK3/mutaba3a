# MUT-531 switch spike: result (2026-11-02, Stripe sandbox, API 2026-09-30.endive)

Script: `qa/support/mut531-switch-spike.mjs` (`node qa/support/mut531-switch-spike.mjs [pm_card_authenticationRequired]`).
Setup: a test clock started 31 days and 3 hours back, a monthly ₪29 subscription on `pm_card_visa`, and the clock
advanced to 2 minutes before now.

- **A test clock may start in the past.** By now two invoices are paid: 2900 and 2900.
- **The preview carries no proration date** in this API version (`subscription_proration_date` is undefined). The
  switch reads the subscription's own time instead: the expanded `test_clock.frozen_time`, or the server's clock
  when there is no test clock (`plan-gateway.ts` `clockNow`).
- **A card that pays:**
  - The preview at the clock's time gives `amount_due` 23639: ₪290 less the unused part of the month.
  - The update (`always_invoice`, same `proration_date`, `pending_if_incomplete`) applied at once: `pending_update`
    is null, the price is `freelancer_list_yearly_ils`, `discounts` is `[]`, and the period ends a year later.
  - The latest invoice is paid with `amount_paid` 23639, equal to the preview (AC1, AC3).
- **A card that needs 3-D Secure** (`pm_card_authenticationRequired`):
  - `pending_update` is set (expires after about 23 h), and the subscription stays on the monthly price.
  - The latest invoice is open with a `hosted_invoice_url`, and its payment intent is `requires_action`. That is the
    R2 path: `PAYMENT_NEEDS_ACTION` with Stripe's page.
- **Stripe keeps the billing day.** The yearly period runs from the old anchor (Oct 2) to its anniversary (Oct 2 2027).
  The ₪236.39 is the year to Oct 2 2027 (26527) less the unused month (−2888). The preview's yearly line carries that end
  date, which is what the step shows. `billing_cycle_anchor[type]=now` is refused together with a `proration_date`
  ("You cannot specify proration_date when billing_cycle_anchor=now"), and `timestamp` isn't offered on a preview. A
  full year from today could therefore never be previewed exactly, so we keep Stripe's default.
- **Not checked here:** whether the live *restricted* key needs Write on Invoices for `createPreview`. The sandbox key
  isn't restricted. That check is the operator step in `docs/operations/before-release.md`.
