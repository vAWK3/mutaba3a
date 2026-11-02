# MUT-533 + MUT-534: our own failed-card mail, and the come-back offer

Epic MUT-528 (pricing program), build order step 5. Planned 2026-11-02 on `feature/mut-533-534-card-failed-comeback`
(worktree `.claude/worktrees/mut-533-534`, from local main cb083870). One plan, two stories, built and merged in order:
MUT-533 first, then MUT-534. **Status: APPROVED by Basel on 2026-11-02: the product decisions (marked "Basel") and the copy deck (§6) as
written. He declined card digits in mail.** The eng review (§10, R1–R15) is folded in.

## 0. Neighbourhood

- **Epic rules that bind these two:** one discount per invoice; launch, stay and come-back offers once per person ever;
  founders get nothing on top of the founder price; monthly is discounted only through stay and come-back; no promo codes.
- **Built and merged (local main, not pushed):** MUT-529 list price (ADR-235), MUT-530 founder prices, MUT-525 launch
  offer (ADR-237: `offers.json`, `offerOrNothing`, `expectedOffer` / 409 `OFFER_ENDED`, `offerId` on the mirror, the
  renewal-notice job), MUT-531 switch (ADR-238), MUT-532 pause, stay offer, own cancel flow (ADR-240:
  `billing_retention_events`, `kind` in `offers.json`, `plan-gateway.ts`).
- **Still to come:** MUT-535 monthly summary mail (needs the no-amounts override, separately), MUT-536 invite a friend.
- No blockers. Both tickets are Backlog under the epic, like their merged siblings were when started.

### What the code does today (checked)

- `invoice.payment_failed` is handled (`sync.ts` `dispatch`): it re-fetches the subscription and mirrors `past_due`.
  Nothing mails. `trial-mail.ts` says paid-lapse mail "is Stripe's dunning, out of scope".
- `past_due` → **GRACE** (`entitlement.ts`); `unpaid` / `canceled` → READ_ONLY for good (a payer is never LOCKED).
- The portal has a `grace` panel ("We couldn't take your last payment", action `manage` → Customer Portal) and a GRACE
  banner. GET `/v1/billing` is polled every 2 s for 30 s after a return from Stripe (`billingQueries.ts`).
- The mirror has no "ended at": `currentPeriodEnd` is the period's end, which after a failed renewal is a month (or 11
  months, yearly) after the subscription actually ended. Reconcile lists `status: 'all'`, so a new column backfills.
- **The mail send log is pruned after 30 days** (`index.ts` `MAIL_LOG_RETENTION_MS`): an idempotency key alone can't
  promise "once ever", nor "once per invoice" past 30 days.
- `subscriptionsOf` (Checkout's Stripe re-check) returns only status and period end, no metadata.
- `offers.json` + `parseOffers` know `launch` (percent, `once`, `redeem_by`) and `stay` (percent, `repeating`).
  `CouponFact` has `amountOff`, no currency options.
- Mail rule (ADR-159 §5): no amount, currency or date; ADR-237 D7 logged the first override. Jobs follow
  `renewal-mail.ts`: candidates from the mirror, Stripe decides, the send log keeps each key once, a 200 s budget, a
  dry run, a job door and an admin door.

## 1. Design decisions (Basel answered the product ones on 2026-11-02, marked "Basel")

### MUT-533: failed-card mail

- **D1 An hourly job, not a send inside the webhook.** `POST /jobs/v1/billing/card-failed-mail`, Cloud Scheduler at
  `7 * * * *` (Jerusalem): the first mail goes out within the hour of the mirror turning `past_due`. *Why not the
  webhook:* it must answer Stripe within 4 s; a slow or failed send would delay the 200 or be lost, and the reminder
  needs a job anyway. If a webhook is missed, the nightly reconcile mirrors `past_due` and the next run catches up.
- **D2 One dunning episode per subscription, keyed on its oldest failed invoice** (R4). The job lists the
  subscription's `open` invoices and takes the oldest with `attempt_count ≥ 1`: that is the one whose last retry
  ends the plan. A renewal invoice arriving while it is still open joins the same episode (no second pair of mails),
  and a Resume-now invoice (ADR-240 §6) counts like any other. Keys: `card-failed:<invoiceId>:first` and
  `…:reminder`. Only the current stage is sent, so never more than 2 mails per failed invoice.
  - `first`: the subscription is `past_due` in Stripe, the episode's invoice is `open`, and its first failure was
    **within the last 72 hours** (R2: a key pruned from the send log can never make `first` current again).
  - `reminder`: as above with a retry still booked (`next_payment_attempt` set), sent from the **window's midpoint**:
    first failure + max(3 days, window / 2) (R3). Smart Retries may book its last try before the window ends, so the
    reminder can't wait for "3 days before the end".
  - Nothing for a paid, voided or uncollectible invoice, a subscription no longer `past_due`, or a payment that
    **needs the customer to authenticate** (3-D Secure, `requires_action`, R9): Stripe's own "confirm your payment"
    mail handles that and stays on (Basel).
- **D3 The retry window is config, matching Stripe's dashboard:** `BILLING_RETRY_WINDOW_DAYS`, one of 7, 14, 21 or
  28 (default 14 = Stripe's default "8 tries within 2 weeks"); 28 is the cap so every key outlives it in the send log
  (R2, R13). A Terraform variable; the operator step confirms dashboard and variable agree.
- **D4 What the mail says (Basel: no card digits):** what failed (the plan's payment), that
  the account stays fully open while Stripe retries, and one button to update the card. The reminder says the plan
  ends "within N days" at most (N = days to the window's end, an upper bound) and what follows: read-only while the
  lapse gate is on, just "your plan ends" while it is off. No amount, no date, no card details at all:
  Basel declined the last-4-digits exception, so ADR-159 §5 holds for these two mails unchanged.
- **D5 (Basel: yes) The button opens Billing; Billing's past-due panel goes straight to Stripe's card form.** A Customer Portal
  URL expires in minutes, so the mail links to `/?billing=true`. The `grace` panel's action becomes **Update card**:
  a portal session with `flow_data: { type: 'payment_method_update', after_completion: redirect to
  ?billing=true&portal=returned }` (R10), so the existing return poll runs. The spike checks that the new card
  becomes the *subscription's* default (Checkout sets it there) and that Stripe retries the open invoice on it; if
  not, the return does `invoices.pay` on the episode's invoice, once (idempotency key on the invoice).
- **D6 Who:** the mirror's `past_due` subscriptions with a linked ACTIVE payer who isn't closing their account (any
  tier: the payer is the person). Stripe's own invoices then decide (D2). Suppressed addresses are skipped. The lapse
  gate doesn't change who is mailed, only the reminder's wording.
- **D7 Stripe's own failed-payment email goes off only after the API release** and the first hourly run (§7); its
  "confirm payment" (3-D Secure) email stays on.

### MUT-534: the come-back offer

- **D8 The coupon is an amount off, held by Stripe:** `mtb3a_comeback_first_month`, **₪20 off, with a USD
  currency option of $6**, `duration: once`, Freelancer product only, no end date. First month back = monthly list
  less that: **₪9 / $3**; a yearly comeback gets the same amount off its first invoice: **₪270 / $84**. No amount in
  the code: the server reads the coupon (with `applies_to` and `currency_options` expanded) and the catalog. A coupon
  of any other shape (not `once`, no amount in a sold currency, an amount not below that currency's monthly price,
  other products) is no offer, logged (ADR-237 D5). Checkout's currency follows the country chosen, so the amounts are
  the Checkout currency's, whatever the old subscription's was.
- **D9 `offers.json` gains `kind: "comeback"`** (one entry `"comeback-2026"`, no `interval`: it applies to both),
  with `BILLING_COMEBACK_COUPON_ID` as the QA override (refused on a live key, like R6). `offersFor` takes an options
  object. `resolveOffer` stays launch-only. No second offer machinery.
- **D10 A lapse is Stripe ending a Freelancer subscription that took money:** status `canceled`, `ended_at` set,
  at least one invoice with money (a trial that ended unpaid is not a lapse). The mirror gains
  `billing_subscriptions.endedAt` from `ended_at` (also in `keepStatus` and the change audit, R7). The operator step
  confirms that, when retries run out, Stripe **cancels** (its default). **A lapsed Firm payer gets no come-back
  offer** (Basel; R8: it would sell them Freelancer at ₪9); Firm isn't sold yet.
- **D11 (Basel: day 30 and day 90) Two mails, each in a two-week window:** `day-30` while 30–44 days have passed since the end, `day-90` while
  90–104 days have. Only the current stage is sent. Daily at 10:30 Jerusalem.
- **D12 (Basel: the offer opens with our mail) "Offered" is a durable row, written by the job** (R2, R5): before sending a stage the job claims a
  `billing_retention_events` row of new kind `COMEBACK_OFFERED` (`reason` = the stage; unique per person and stage, a
  partial index, ADR-240's claim-then-act with release on a definite failure). That row is the once-ever record of
  the mail (the send log forgets after 30 days), and it **opens the offer**: Billing and Checkout offer the come-back
  price only to someone with such a row. The job is where the Stripe facts are checked (took money, not covered), so
  GET `/v1/billing` stays cheap.
- **D13 Who (one rule, `comebackEligibility`, used by the job, GET and Checkout):**
  - nothing running: `checkoutRefusalOf` passes first (R6: `unpaid`, `paused` refuse Checkout, so they never see it);
  - their latest money-taking Freelancer subscription ended 30 or more days ago;
  - no subscription of theirs ever carried the come-back offer (`offerId`, ignoring `incomplete` /
    `incomplete_expired` ones that never paid, R7); Checkout's Stripe re-check reads `metadata.mutaba3a_offer` too;
  - no `STAY_OFFER` row created in the last 12 months;
  - none of their profiles is covered by Malafat or an operator grant (job and Checkout; GET trusts the job's row);
  - not closing their account.

  Once open, the offer has no end date: it stays until used. It can't stack with the launch offer (that one needs
  someone who never subscribed). **Lapsed founders are eligible** (Basel): Checkout sells only list prices, so they come
  back at ₪9 then ₪29, not on top of a founder price.
- **D14 (Basel: yes) Billing shows it and Checkout checks what was shown** (the MUT-525 pattern): GET `/v1/billing` gains
  `comeback: { id, firstMonth: {ILS, USD}, firstYear: {ILS, USD} } | null` (eligible people only); the Subscribe step
  shows the welcome-back line for the chosen interval; Checkout sends `expectedOffer: "comeback-2026"` and the server
  decides again on mirror + Stripe with a fresh coupon read. A stale one answers 409 with the existing reason
  `OFFER_ENDED` plus `details.offer` (R11; the message becomes offer-neutral), never a silent full price. The pay page
  gets an ar + en line above Pay (a monthly or yearly wording; `offerSubmitMessage` stops assuming a year).
- **D15 Mail may name the come-back price** (Basel approved; ADR-159 §5 override log): the first month, the monthly list price
  after it, the first year and the yearly list price, in the currency of the person's last subscription. No money
  records, no dates.

## 2. Server

### 2.1 MUT-533

- **`server/src/billing/card-failed-mail.ts` (new):** `cardFailedStageOf(episode, now, windowDays)` (pure, D2) and
  `runCardFailedMail(options)` shaped like `runRenewalMail` (skips `gone`, `not-past-due`, `settled`,
  `needs-authentication`, `no-stage`, `suppressed`; `failed` per row on a throw; summary; dry run; 200 s budget).
- **`plan-gateway.ts`:** `failedPaymentOf(subscriptionId)` = `subscriptions.retrieve` (status)
  then `invoices.list({ subscription, status: 'open' })`, then `invoices.retrieve(oldest, { expand:
  ['payments.data.payment.payment_intent'] })` (4 levels; a 5-level expand from the subscription is refused, R1).
  Returns `{ status, invoiceId, attemptCount, nextPaymentAttempt, firstFailedAt, needsAuthentication }`.
  `firstFailedAt` per the spike (`status_transitions.finalized_at` or the first payment's `created`).
  `createPortalSession` (checkout-gateway) takes an optional card flow with its return URL.
- **Store:** `billing.pastDueCandidates()` (ports, memory, Prisma): `status = 'past_due'`, linked ACTIVE payer not
  closing (the `offerRenewalCandidates` filter), oldest first.
- **Mail:** `card-failed` (`{ updateLink }`) and `card-failed-reminder` (`{ daysLeft, readOnlyAfter, updateLink }`)
  in `email/ports.ts` (+ `RECIPIENT_CAP_EXEMPT`) and `templates/copy.ts`.
- **Routes:** `routes/card-failed-mail.ts` (job door with `X-Job-Token`, counts only; admin door with rows), mounted in
  `app.ts`; `npm run billing:card-failed-mail [-- --dry-run]`. `routes/billing.ts`: `PortalSessionRequestSchema`
  gains `flow?: 'card'`; the return path does the D5 fallback only if the spike needs it.
- **Config** `BILLING_RETRY_WINDOW_DAYS` (7 | 14 | 21 | 28). **Terraform:** job `mutaba3a-card-failed-mail` (where
  `mailer = "resend"` and `stripe_enabled`), 280 s deadline, 3 retries; variable `billing_retry_window_days`.
  Contract **1.98.0-mut533**.

### 2.2 MUT-534

- **`server/src/billing/comeback.ts` (new):** `comebackOfferOf(entry, coupon, catalog)` (D8), `comebackEligibility`
  (D13, refusals `PAYING`, `NO_PAID_LAPSE`, `TOO_SOON`, `FIRM`, `ALREADY_HAD`, `STAY_OFFER_RECENT`, `COVERED`,
  `NOT_OFFERED`), `comebackStageOf(endedAt, now)` (D11), `runComebackMail` (claims the D12 row, then sends).
- **`offer.ts`:** `OfferKind` adds `comeback`; `interval` absent for it; `comebackEntryOf`; `offersFor({ launch, stay,
  comeback })`. **`CouponFact`** gains `amountOffIn: { ILS, USD }` (`readCoupon` expands `applies_to` and
  `currency_options`).
- **`SubscriptionState`** gains `offerId` and `endedAt`; `subscriptionsOf` fills them from Stripe (R7).
- **Mirror:** `mirror.ts` / `sync.ts` store `endedAt`. **Migration `20261104120000_mut534_comeback`:** nullable
  `billing_subscriptions.endedAt` + index `(status, endedAt)`; enum value `COMEBACK_OFFERED`; partial unique index
  `(userId, reason) WHERE kind = 'COMEBACK_OFFERED'`. Additive. **Warn the orchestrator before merging (it restarts
  :8787).**
- **Store:** `billing.comebackCandidates({ endedAfter, endedUpTo })` (latest money-taking Freelancer subscription
  `canceled` with `endedAt` in the window, linked ACTIVE payer not closing); `claimRetentionEvent` accepts the new kind.
- **`routes/billing.ts`:** GET adds `comeback` (from rows already loaded plus the cached coupon); Checkout applies the
  coupon to either interval when eligible, with the `expectedOffer` handshake; `appliedOffer` gains the amount-off case.
- **Mail:** `comeback-offer` (`{ stage, firstMonth, listMonth, firstYear, listYear, currency, subscribeLink }`),
  cap-exempt. `routes/comeback-mail.ts`, `npm run billing:comeback-mail [-- --dry-run]`. **Terraform:** job
  `mutaba3a-comeback-mail` at `30 10 * * *`, behind `comeback_mail_enabled` (default false) so the first run is a
  reviewed dry run (R12). Contract **1.99.0-mut534**.

## 3. Portal (`src/hosted/**`)

- **MUT-533:** `billingView.ts` `grace` → action `updateCard`; `BillingDrawer.tsx` renders **Update card** and calls
  `useOpenBillingPortal` with the card flow; i18n `billing.action.updateCard`. Schema regen.
- **MUT-534:** the Subscribe step reads `billing.comeback` and shows the line under the chosen interval (the
  launch-offer line's place and component); Checkout sends `expectedOffer`; a 409 `OFFER_ENDED` for it shows
  `billing.comeback.ended` and refreshes. Amounts in minor units with their currency (ADR-004), isolated in Arabic
  (ADR-101).
- The phone's decoder: check it tolerates the new `comeback` field and the portal-session `flow` (both additive).

## 4. Release-QA (`qa/features/portal-live/billing.yaml`, `qa/specs/portal-live/billing.spec.ts`)

Live sandbox, memory mailer, outbox via `GET /admin/v1/dev-outbox`. A test clock can start in the past (MUT-531
spike), so each flow starts its clock far enough back that "today" is the day under test: no time override.

- `card-failed-mail` (core): a monthly subscriber's renewal declines (`4000 0000 0000 0341`); run the job; one Arabic
  mail, with no amount and no card details; its button opens Billing on the past-due panel; **Update card** opens Stripe's
  card form; a good card pays the open invoice and Billing is Active.
- `card-failed-reminder`: the first failure was 8 days ago (window 14); run the job twice; exactly one reminder; a
  third run sends nothing (2 mails for the invoice, no more).
- `card-failed-3ds`: a renewal needing authentication (`4000 0027 6000 3184`): no MTB3A mail.
- `comeback-offer` (core): a monthly subscriber paid once and the plan ended 31 days ago; run the job; the mail says
  ₪9.00 then ₪29.00; its button opens Subscribe with "Welcome back"; Checkout charges ₪9.00; the next invoice ₪29.00.
- `comeback-yearly`: Yearly, Checkout charges ₪270.00. `comeback-usd`: an ILS lapser checking out from a USD country
  sees and pays $3.00.
- `comeback-once`: someone who already came back on it, or took the stay offer this year: no mail, no line, list price.
- Stubbed: `comeback-rtl-375`.

## 5. Build order and tests (TDD: each test red first)

**Step 0, the spike (sandbox, test clocks; needs Basel's screen awake for the Keychain):** (a) the Smart Retries
timeline: attempt times, `next_payment_attempt`, cancel at the last attempt or the window's end, and which timestamp
is the first failure; (b) the 4-level expand; (c) the portal's card flow on a Checkout-made
past_due subscription: does it set the subscription's default and pay the open invoice; (d) a declined Resume-now
invoice: past_due, Smart Retries, cancel when they run out; (e) the coupon: ₪20 with a $6 option, `once`, Freelancer,
automatic tax: $3 + tax monthly, $84 yearly, and whether the dashboard can make the currency option; (f) 3-D Secure
renewal with failed-payment mails off: what Stripe still sends; (g) `ended_at` after cancel-at-period-end and after
retries run out, and metadata on `incomplete_expired`; (h) a cancelled ILS customer re-subscribing in USD.
Results go to `.claude/designs/mut-533-534-spike-result.md`; a surprise that changes one of Basel's decisions goes back to him.

**MUT-533**
1. `card-failed-mail.test.ts`: the stage table (first only within 72 h; reminder at the midpoint and not a minute
   before; never with `next_payment_attempt` null; settled, not past_due, 3-D Secure → none; only the current stage;
   the oldest open invoice is the episode; a second open invoice adds nothing); the run (≤ 2 mails per invoice over
   many runs, suppressed, dry run, budget, one Stripe failure costs one row); a test that every Stripe expand has at
   most 4 levels.
2. `templates.test.ts`: both templates ar + en, no amount, currency or card digits, "within N days"
   plurals, gate-off wording. Config test (7/14/21/28 only).
3. Store tests (memory and `test:db`) for `pastDueCandidates`; route tests (job token, admin rows, `flow` →
   `flow_data` with the return URL).
4. Portal: `billingView` grace → `updateCard`; `BillingDrawer` Update card calls the portal with the flow.
5. QA flows; runbook; knowledge files; ADR. Merge (Basel's yes), Jira In Review.

**MUT-534**
6. `comeback.test.ts`: coupon shapes and amounts (₪9/$3, ₪270/$84 from ₪20/$6); every refusal; the 30-day, 12-month
   and Firm edges; a trial that never paid; an abandoned `incomplete_expired` Checkout doesn't use it up; stages at
   29/30/44/45/89/90/104/105 days; the claim (second stage claim per person refused; released on a definite send failure).
7. `offer.test.ts`: `kind: "comeback"` parses without an interval; launch resolution unchanged; override object.
8. Mirror/sync tests for `endedAt` (with `keepStatus` and the audit); migration; store tests for
   `comebackCandidates` and the new event kind.
9. Route tests: GET `comeback` only with an offered row and eligibility (and **GET-eligible ⇒ Checkout applies it**,
   R6); Checkout monthly and yearly carry the coupon and metadata, in ILS and USD; 409 on a stale `expectedOffer`; a
   coupon read failure is full price, logged.
10. Templates, portal Subscribe line, QA flows, runbook, knowledge files, ADR. Merge (Basel's yes, orchestrator
    warned about the migration), Jira In Review.

Verification per story (Node 22, through `heavy`): `npm run lint`, `npm run typecheck`, `npm run test:run`,
`npm run build`; the server's `typecheck`, `lint`, `openapi:check`, `test`, `test:db`; `release-qa lint`.

## 6. Copy deck (ar first, then en): **approved by Basel 2026-11-02**

**`card-failed` (MUT-533, first mail)**
| Part | ar | en |
|---|---|---|
| subject | لم تنجح عملية الدفع ببطاقتك | Your card didn't go through |
| preheader | يبقى حسابك في متابعة مفتوحًا بالكامل بينما نحاول مجددًا. | Your MTB3A account stays fully open while we try again. |
| headline | لم نتمكن من تحصيل دفعتك | We couldn't take your payment |
| intro 1 | رفض البنك دفعة اشتراكك في متابعة. | Your bank declined the payment for your MTB3A plan. |
| intro 2 | لن يتوقف شيء: يبقى حسابك مفتوحًا بالكامل بينما يحاول Stripe خصم البطاقة مجددًا خلال الأيام القادمة. | Nothing stops: your account stays fully open while Stripe tries the card again over the next few days. |
| action | حدّث البطاقة | Update card |
| outro | حدّثتها بالفعل؟ فلا حاجة لأي إجراء، وستنجح المحاولة القادمة. ردّ على هذه الرسالة إن احتجت إلى مساعدة. | Already updated it? Then there's nothing to do, and the next try will go through. Reply to this email if you need help. |

**`card-failed-reminder` (MUT-533)**
| Part | ar | en |
|---|---|---|
| subject | ما زالت عملية الدفع ببطاقتك لا تنجح | Your card still isn't going through |
| preheader | حدّث البطاقة ليبقى حسابك مفتوحًا. | Update it to keep your account open. |
| headline | لم تُحصَّل دفعتك بعد | Your payment still hasn't gone through |
| intro 1 | حاولنا مجددًا، وما زال البنك يرفض الدفعة. | We tried again, and your bank still declines the payment. |
| intro 2 (gate on) | إن لم تُحدَّث، ينتهي اشتراكك خلال {N أيام} على الأكثر ويصبح حسابك للقراءة فقط. تبقى سجلاتك، ويمكنك تنزيلها في أي وقت. | If it isn't updated, your plan ends within {N days} at most, and your account becomes read-only. Your records stay, and you can download them any time. |
| intro 2 (gate off) | إن لم تُحدَّث، ينتهي اشتراكك خلال {N أيام} على الأكثر. تبقى سجلاتك، ويمكنك تنزيلها في أي وقت. | If it isn't updated, your plan ends within {N days} at most. Your records stay, and you can download them any time. |
| action | حدّث البطاقة | Update card |
| outro | ردّ على هذه الرسالة إن احتجت إلى مساعدة. | Reply to this email if you need help. |

{N أيام} / {N days} use the trial mails' plural forms (يوم واحد، يومين، 3 أيام … / 1 day, 2 days …).

**Portal (MUT-533)**
| Key | ar | en |
|---|---|---|
| billing.action.updateCard | حدّث البطاقة | Update card |

**`comeback-offer` (MUT-534)**: amounts in the person's last currency, e.g. ₪9.00 / ₪29.00 / ₪270.00 / ₪290.00
| Part | ar | en |
|---|---|---|
| subject (day 30) | سجلاتك في متابعة ما زالت هنا | Your MTB3A records are still here |
| subject (day 90) | عُد إلى متابعة بـ {firstMonth} لشهرك الأول | Come back to MTB3A for {firstMonth} your first month |
| preheader | شهرك الأول عند العودة بـ {firstMonth}، ثم {listMonth} شهريًا. | Your first month back is {firstMonth}, then {listMonth} a month. |
| headline | سجلاتك ما زالت هنا | Your records are still here |
| intro 1 | كل ما حفظته في متابعة ما زال في حسابك، ويمكنك قراءته وتنزيله في أي وقت. | Everything you kept in MTB3A is still in your account, and you can read and download it any time. |
| intro 2 | عُد بـ {firstMonth} لشهرك الأول، ثم {listMonth} شهريًا. تفضّل الاشتراك السنوي؟ سنتك الأولى بـ {firstYear}، ثم {listYear}. | Come back for {firstMonth} for your first month, then {listMonth} a month. Prefer a year? Your first year is {firstYear}, then {listYear}. |
| details | الشهر الأول عند العودة: {firstMonth} · بعد ذلك: {listMonth} شهريًا، وتُضاف ضريبة القيمة المضافة حيث تنطبق | First month back: {firstMonth} · Then: {listMonth} a month, plus VAT where it applies |
| action | عُد إلى متابعة | Come back to MTB3A |
| outro | يُطبَّق السعر تلقائيًا عند الاشتراك، دون أي رمز. هذا العرض مرة واحدة فقط. | The price applies on its own when you subscribe; there's no code to enter. This offer is one time only. |

**Portal and pay page (MUT-534)**
| Key | ar | en |
|---|---|---|
| billing.comeback.monthly | أهلًا بعودتك: شهرك الأول بـ {first}، ثم {list} شهريًا. | Welcome back: your first month is {first}, then {list} a month. |
| billing.comeback.yearly | أهلًا بعودتك: سنتك الأولى بـ {first}، ثم {list} سنويًا. | Welcome back: your first year is {first}, then {list} a year. |
| billing.comeback.ended | لم يعد سعر العودة متاحًا. راجع السعر مرة أخرى. | The welcome-back price no longer applies. Please check the price again. |
| pay page (above Pay) | عرض العودة: {first} لشهرك الأول، ثم {list} شهريًا. / {first} لسنتك الأولى، ثم {list} سنويًا. | Welcome-back offer: {first} for your first month, then {list} a month. / {first} for your first year, then {list} a year. |
| OFFER_ENDED message (API, en only) | | The offer you saw no longer applies; nothing was charged |

## 7. Operator steps (live Stripe; into `docs/operations/before-release.md` and pilot runbook §1.7 / §1.8)

1. **MUT-533, before the API deploy:** Settings › Billing › Revenue recovery: confirm the Smart Retries policy and set
   `billing_retry_window_days` to its length (7, 14, 21 or 28 days; default 14 = "8 tries within 2 weeks"); confirm
   "If all retries for a payment fail" = **Cancel the subscription**. Confirm the Customer Portal allows updating the
   payment method (it does today).
2. **MUT-533, after the API deploy and the first hourly run:** turn **off** Stripe's customer email for failed card
   payments; **keep on** the email asking customers to confirm a payment (3-D Secure). Check: a sandbox decline sends
   one MTB3A mail and nothing from Stripe.
3. **MUT-534, before the API deploy:** create the coupon `mtb3a_comeback_first_month`, name `Welcome back · عرض
   العودة`, **Amount off ₪20.00** with a **USD amount of $6.00**, Duration **Once**, Freelancer product only, no date
   range or usage limit (the server enforces once per person). Read on Coupons is already on the key (MUT-525).
4. **MUT-534, after the API deploy:** run `npm run billing:comeback-mail -- --dry-run`, read the rows (no internal or
   test accounts, the counts make sense), then set `comeback_mail_enabled = true` and apply. The nightly reconcile
   fills `endedAt`; if its summary says `TIME_BUDGET`, run `billing:reconcile` again before the dry run.
5. Release order: API (additive migration) → web.

## 8. Not in scope / follow-ups

- The phone: an Update-card button and a welcome-back line on the phone are follow-ups (its Checkout is the web's).
- A failed first payment at Checkout (`incomplete`) is Stripe's Checkout error, not this mail.
- No mail after the retries end (the ticket: "then none"); MUT-534's day-30 mail is the next contact.
- People whose lapse is already past both windows at release get no mail and no offer.

## 9. Cost and scale

- Card-failed job: 24 runs a day; one indexed query, then 3 Stripe reads per `past_due` subscription (a handful).
- Come-back job: one indexed query a day; per candidate one paid-invoice count, the coupon cached per run.
- GET `/v1/billing`: no new Stripe call beyond the cached coupon; eligibility reads the person's retention events (one
  indexed query, as MUT-532's switch line already does) and the subscriptions already loaded.
- Two Cloud Scheduler jobs (cents a month). One nullable column, one enum value, two indexes.

## 10. Eng review (2026-11-02, condensed `/plan-eng-review`, an independent reviewer over the code)

| # | Sev | Finding | Folded into |
|---|---|---|---|
| R1 | HIGH | A 5-level expand from the subscription is refused by Stripe (4 max) | §2.1 three calls; 4-level test |
| R2 | HIGH | The send log is pruned after 30 days: keys can't promise once-ever or once-per-invoice past that | D2 72 h first; D3 cap 28; D12 durable row |
| R3 | HIGH | Smart Retries may end before the window; "3 days before the end" can miss | D2 midpoint reminder, "at most" wording |
| R4 | HIGH | `latest_invoice` keying misses the oldest failed invoice, doubles mails, misreads pauses | D2 episode = oldest open failed invoice |
| R5 | HIGH | GET can't afford Stripe/coverage reads per poll | D12 job writes the row; GET trusts it |
| R6 | MED | `unpaid` / `paused` refuse Checkout; GET would show an offer Checkout refuses | D13 `checkoutRefusalOf` first; GET⇒Checkout test |
| R7 | MED | `offerId` on never-paid subscriptions; Stripe re-check can't see metadata; `endedAt` audit | D13; `SubscriptionState` gains fields |
| R8 | MED | Firm lapsers, founders, currency mismatch | D10 no Firm; D13 founders (Basel: eligible); D8 Checkout currency; QA `comeback-usd` |
| R9 | MED | 3-D Secure failures aren't "declined" and get no retry | D2 skip; §7 keep Stripe's confirm mail |
| R10 | MED | Portal flow returns to the portal home; subscription default card | D5 redirect + spike + fallback |
| R11 | MED | `OFFER_ENDED` message is launch-specific; yearly-only submit line; positional args | D14; D9 options object |
| R12 | LOW | First run after the backfill mails every past lapser in a window | §7 step 4, job behind a flag |
| R13 | LOW | Window range 3–60 contradicts the stage rules | D3 7/14/21/28 |
| R14 | LOW | 12 months from `createdAt`; expand `currency_options`; duplicate last4 row | D13, D8, §6 |
| R15 | LOW | Scope otherwise right-sized; cut the duplicate row and one constant | §6, D2 |

## Business / product impact

- Failed cards are a large share of subscription churn; an Arabic mail with a one-tap card fix keeps payers Stripe's
  English mail would lose, and replaces it so nobody gets two.
- The come-back offer gives every lapsed payer, who keeps read-only access forever, a concrete reason to return at
  ₪9 / $3; once per person and opened only by our own mail, so it can't be gamed by cancelling and rejoining.
- Step 5 of MUT-528's build order; after it, MUT-535 (summary mail) and MUT-365 (prices on the site).
