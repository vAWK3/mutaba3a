# MUT-533/534 spike result (2026-11-02)

`node qa/support/mut533-534-spike.mjs`, Stripe sandbox, API `2026-09-30.endive`, one test clock started 40 days back
with three customers, plus one coupon. Everything was deleted at the end. Plan §5 step 0.

| # | Question | Result |
|---|---|---|
| a | Smart Retries timeline (sandbox policy: 8 tries, then cancel) | The renewal invoice is created, then **finalized an hour later, and that is the first attempt** (`attempt_count` 1, `status_transitions.finalized_at`). Retries roughly every 2 days, `next_payment_attempt` always set while one is booked. Stripe **cancelled at the 8th failed attempt, about 13 days after the first**, inside the 14-day window, and `next_payment_attempt` went null then. The invoice stays `open` after the cancel. |
| b | Expand depth | `subscriptions.retrieve` with `latest_invoice.payments.data.payment.payment_intent` is **refused** ("cannot expand more than 4 levels"). `invoices.retrieve` with `payments.data.payment.payment_intent` works (R1). |
| c | Customer Portal card flow | A session with `flow_data.type = payment_method_update` and `after_completion.redirect.return_url` is **accepted**. Whether the new card pays the open invoice is checked in the `card-failed-mail` QA flow (the portal UI can't be driven by the API). |
| e | Come-back coupon: ₪20 off with a $6 USD option, `once`, Freelancer only | Read back with `expand[]=currency_options`: `{ ils: 2000, usd: 600 }`; `applies_to` needs its own expand. Previews: monthly ILS **₪9.00**, yearly ILS **₪270.00**, monthly USD **$3.00**, yearly USD **$84.00** (before tax). |
| f | 3-D Secure renewal (`pm_card_authenticationRequired`) | The subscription goes `past_due`; the invoice is `attempted` with **`attempt_count` 0** and `next_payment_attempt` null; the intent is `requires_action`. Stripe never retries it; it cancelled after about 15 days. So `needsAuthentication` (an intent in `requires_action`) skips our mail, and Stripe's confirm-payment mail must stay on. |
| g | `ended_at` | Cancel at period end: `ended_at` = the period end. Cancel after failed retries: `ended_at` = the last attempt (13 days in) while `current_period_end` is **17 days later**. So `currentPeriodEnd` can't stand in for the end: MUT-534 needs `endedAt`. |
| h | A cancelled ILS customer subscribing in USD | **Allowed**: the new subscription is `active`, `usd`. |

Consequences for the build: none of Basel's decisions change. `firstFailedAt` = `status_transitions.finalized_at`
(fallback `created`). The episode is the oldest open invoice with `attempted: true`; the 3-D Secure case is told apart
by the intent's status, not by the attempt count.
