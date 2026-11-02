# MUT-531 + MUT-532: switch to yearly, pause instead of cancel, stay offer

Epic MUT-528 (pricing program, D4–D6) · two Stories, Jira Backlog · planned 2026-11-02 · not built. Combined plan; built as two branches in this order: `feature/mut-531-yearly-switch`, then `feature/mut-532-pause-stay` on top of it.

**Status: APPROVED by Basel 2026-11-02 (this session): pause as planned (D6/D10/D11, monthly only), Cancel moves into MTB3A and off in Stripe's portal (D8), no founder switch in v1 (D5), copy deck §6 and the defaults D7/D9 approved. Building.**

## 0. Neighbourhood

- **Builds on (all merged to local main, not pushed):**
  - MUT-529 list price (ADR-235): `freelancer_list_{monthly|yearly}_{ils|usd}`, ₪29/₪290, $9/$90.
  - MUT-530 founder prices: `freelancer_founder_*`, on subscription schedules (ADR-160 D4).
  - MUT-525 launch offer (ADR-237): `offers.json`, `offer.ts`, coupon reads with a 10-minute cache, `BILLING_OFFER_COUPON_ID` per QA run.
  - MUT-362 Billing drawer and routes; MUT-360 webhook and mirror; MUT-361 lapse gate.
- **No blocker links.** Epic rule 1 (one discount per invoice), rule 2 (stay is once per person ever), rule 3 (founders get nothing extra) and rule 4 (monthly is discounted only by stay and come-back) all apply here.
- **Overlap to avoid:**
  - MUT-535 (monthly summary mail) is not built. MUT-531's mail line lands with it, reusing this ticket's `yearlySwitchOf` (▲D9).
  - MUT-534 (come-back offer) will reuse §2.4's `billing_retention_events` table and the `kind` field in `offers.json`. Nothing of it is built here.
  - MUT-533 (failed-card mail) is untouched. A failed charge on switch or resume goes through Stripe's normal dunning (past_due → GRACE).
  - The phone (Flutter) reads entitlements from `/v1/me`. It gets `paused` additively and keeps working. Phone copy for a paused plan is a follow-up (§8).

### What the code does today (checked)

- **`entitlement.ts`:** `LAPSED_STATUSES` contains `paused`. A subscription in Stripe status `paused` resolves to READ_ONLY · STRIPE, and that rule runs before the trial-lock rule, so it is never LOCKED and nothing is deleted. The gate (`gate.ts`) maps READ_ONLY to safe methods plus the export.
- **But Stripe status `paused` isn't what a customer pause gives us.** Stripe sets that status, and sends `customer.subscription.paused/resumed`, only when a trial ends without a card (`trial_settings.end_behavior.missing_payment_method = pause`), or through the newer `POST /subscriptions/:id/pause`, which pauses at once and never resumes on its own. A pause that resumes on a date is Stripe's `pause_collection`. With it the status stays `active`, so today's entitlement would read a paused person as **ACTIVE**. §2.3 fixes this.
- **`checkout.ts`:** status `paused` → `CONTACT_US`. `billingView.ts:95` shows it as `needsHelp`. Both stay for the trial case.
- **Customer Portal:** `createPortalSession` passes no `configuration` and no `flow_data`. Runbook 3a allows cancel at period end only, with no switching and no pausing.
- **Restricted key:** Write on Customers, Checkout Sessions and Customer portal only. **Changing a subscription needs Write on Subscriptions** (operator step, §7).

## 1. Design decisions (recommendations; ▲ = Basel decides)

**D1. Switch is an in-portal API call, not the Customer Portal.**
- Billing shows the line and a Switch button. A confirm step shows exactly what is charged today: Stripe's preview of the prorated invoice (`invoices.createPreview` with a `proration_date`).
- Confirming calls `subscriptions.update`:
  - `items: [{ id, price: <yearly list price of the same currency> }]`
  - `proration_behavior: 'always_invoice'`
  - the same `proration_date`
  - `payment_behavior: 'pending_if_incomplete'`
- ~~The interval change resets the billing anchor to today.~~ **Spike (2026-11-02):** Stripe keeps the billing day. Today's charge is the year to that day's next anniversary, less the unused part of the month, and the renewal date shown is Stripe's own, from the preview's yearly line (ADR-238 decision 7).
- A declined card changes nothing: Stripe keeps the pending update unapplied, and we answer 409 `PAYMENT_FAILED`.
- **R2 (eng review):** a card that needs 3-D Secure leaves the latest invoice's payment `requires_action`. We answer 409 `PAYMENT_NEEDS_ACTION` with the invoice's `hosted_invoice_url`, checked by `assertStripeUrl`. The drawer opens it, and the poll picks up the switch once the invoice is paid. Stripe drops an unpaid pending update after 23 h. Spike step (c) also runs `pm_card_authenticationRequired`.
- *Rejected:* turning on plan switching in the Customer Portal. It can't gate on "from the 2nd payment", it can't show our ₪58 line, and its page is English only.

**D2. Who may switch.** All of these must hold:
- the shown subscription is `active`;
- on `freelancer_list_monthly_*`;
- not cancelling;
- no pause scheduled or running;
- no discount on the subscription;
- at least **2 paid invoices with `amount_paid > 0`**. The ₪0 trial invoice doesn't count.

The paid count is one Stripe call (`invoices.list({ subscription, status: 'paid', limit: 3 })`). **R1 (eng review):** GET `/v1/billing` is also read by `LapseGate` and `TrialBanner` on every page, and it is polled every 2 s for 30 s after a return. So the gateway caches the count per subscription:
- a count of 2 or more is cached for the instance's lifetime, because eligibility only grows;
- a lower count is cached for `CATALOG_TTL_MS`, and a failure for `CATALOG_FAILURE_TTL_MS`;
- a failure answers `yearlySwitch: null`, never a 5xx.

The POST reads the count fresh.

**D3. The saving is computed, never written down.** `savings = 12 × month.unitAmount − year.unitAmount` from the catalog, in the subscription's own currency: ₪58 (5800) or $18 (1800). It is null when it is ≤ 0 or the catalog is missing, and then the line isn't shown. The server sends it in minor units with its currency (ADR-004).

**D4. Switching never carries a discount.**
- The update sends no `discounts`, and the server refuses when the subscription has any.
- The launch coupon is only ever attached at Checkout, to someone with no subscription (ADR-237 D4), so a payer can't get it.
- Tests pin both rules.

**▲D5. Founders don't get the switch in v1.** A founder subscription runs on a schedule (12 months founder, then list), and `subscriptions.update` on an item conflicts with its phases. The operator can move a founder to `freelancer_founder_yearly_*` by hand on request. *Alternative:* build the schedule-aware founder switch (₪210/year, "save ₪42"). That means a schedule phase edit and its own spike.

**D6. Pause is Stripe's `pause_collection: { behavior: 'void', resumes_at }`. It starts when the paid month ends and resumes on its own.**
- Pressing Pause for N months (1–3) does three things:
  - sets `pause_collection.resumes_at` to the cycle boundary N months after the current period end, minus one hour, so the boundary's own invoice is collected;
  - writes `metadata.mutaba3a_pause_from` (the current period end) and `mutaba3a_pause_months`;
  - records a `PAUSE` event (§2.4).
- Until the period end nothing changes; the person paid for it.
- From then on, Stripe voids each invoice: ₪0, nothing charged. The records are READ_ONLY with the export.
- At `resumes_at`, Stripe charges the next cycle and the plan is open again. No job of ours is needed.
- Cycle boundaries follow Stripe's monthly rule: the anchor's day of the month, clamped to the month's last day. This is a pure function with Jan-31 and leap-year tests, confirmed in the spike (§5 step 0).
- *Rejected:* `POST /subscriptions/:id/pause`. It pauses at once (the rest of the paid month is lost or has to be credited), needs our own daily resume job, and its resume invoice can leave the subscription stuck in `paused`. It would match the "webhook already handles paused/resumed" wording in the ticket, but it is the worse product.

**D7. Resume now, and cancelling a pause.**
- **Before the pause starts:** "Don't pause" clears `pause_collection` and the metadata. ▲ It doesn't use up the once-a-year pause, since it never took effect.
- **During the pause:** "Resume now" clears `pause_collection` with `billing_cycle_anchor: 'now'` and `proration_behavior: 'none'`. That charges one full month today and renews monthly from today. The copy says so (§6). If the card fails, the subscription goes `past_due` → GRACE, the normal path.

**D8. The cancel flow moves into MTB3A.**
- Billing gets **Cancel plan**, which opens steps inside the drawer body (DESIGN.md: one drawer, its body swapped):
  1. **Why?** The 8 Stripe `cancellation_details.feedback` reasons, ar + en, plus an optional comment (≤ 500 characters, Stripe's own limit).
  2. **Pause instead?** Only when pause is allowed (D10).
  3. **Stay offer.** Only when allowed (D11).
  4. **Confirm cancel.** Only when neither offer was shown. Declining the stay offer *is* the confirm.
- Cancelling sets `cancel_at_period_end: true` and `cancellation_details: { feedback, comment }`.
- "Keep my plan" (an undo, shown on the existing `ending` panel) clears it. Without it, nobody could undo once the Customer Portal can't cancel.
- **▲ Operator step:** turn **off** Cancel in the live Customer Portal (runbook 3a, §7). Otherwise anyone can skip the pause and the stay offer. Card and invoices stay in Stripe's portal; `manageNote` loses "or cancel".
- *Rejected:* Stripe's portal cancel deep link (`flow_data.subscription_cancel` with a retention `coupon_offer`). It is English only, has no pause step, and can't apply our once-per-person rule.

**D9. ▲ AC "the monthly summary mail shows the line" lands with MUT-535.** That mail doesn't exist yet. This ticket ships `yearlySwitchOf()` (pure, in `retention.ts`) and the `yearlySwitch` field, so MUT-535 adds one line. I'll note this on both tickets.

**▲D10. Who may pause.**
- The shown subscription is `active`, on `freelancer_list_monthly_*`, and not already pausing or paused.
- It has at least 1 paid invoice with `amount_paid > 0`. A trialist cancels straight away: there's nothing to pause.
- No `PAUSE` event for this person started in the last 12 months.
- **Monthly only.** On a yearly plan, `void` would cancel a whole year's invoice and the next one would come a year later, a free year. Yearly payers get Why? → Confirm cancel.
- **R6 (eng review):** two tabs pausing at once. The `PAUSE` claim is written in one transaction that re-checks the 12-month rule under a row lock on the person's `billing_accounts` row, and only then is the Stripe call made. The loser gets `PAUSE_NOT_AVAILABLE`. A failed Stripe call releases the claim with R3's rule.

**▲D11. The stay offer.**
- A Stripe coupon named in `offers.json` as `{ "id": "stay-2026", "couponId": "mtb3a_stay_monthly_50", "kind": "stay", "interval": "month", "tier": "freelancer" }`. `kind` defaults to `launch` for the existing entry.
- What counts as a stay coupon: valid, `percent_off`, `duration: repeating` with `duration_in_months`, restricted to the Freelancer products. No `redeem_by` is needed.
- The copy reads the percent and the month count from the coupon. The halved price comes from the server with the same rounding as `firstYearOf`: ₪14.50 (1450) or $4.50 (450).
- Who gets it:
  - a list-monthly `active` subscription with no discount;
  - no `STAY_OFFER` event ever for this person (rule 2);
  - not a founder (rule 3, by lookup key);
  - monthly only, for D10's reason: a 2-month repeating coupon would halve a yearly renewal that falls in the window.
- Accepting applies `discounts: [{ coupon }]` and leaves the plan on. The next 2 invoices are 50% off.
- **Claim first:** the event row is inserted under a unique index (one `STAY_OFFER` per user) before the Stripe call. So a double click or a retry can never give the offer twice.
- **R3 (eng review):** the claim is released only when Stripe definitely didn't apply the coupon:
  - Stripe refused the call (an invalid request), or
  - after a timeout, a fresh `planOf` shows no such discount.
  - If the re-read also fails, the claim is kept and logged. The person sees "try again", and the operator's reconcile settles it.
  - Raw SQL partial unique index; precedent: `20261020200000_mut358_billing_core`.
- A coupon that's missing or invalid means no stay step, logged as a warning (ADR-237 D5: a promotion never blocks the person).

**D12. Malafat and grants.** Billing already shows "Covered by Malafat" or "covered by MTB3A" with no Stripe subscription, so neither sees Cancel, pause or offers. A paused payer whose profile is Malafat-connected stays ACTIVE there: rule 1 of `resolveEntitlement` runs first, and a test pins it. Founders are excluded by lookup key (D5, D10, D11).

**D13. Switching while the stay offer runs isn't offered.** Rule 1: the remaining discount would otherwise land on the yearly invoice or be silently lost. The line comes back when the offer ends.

## 2. Server

### 2.1 Pure rules: `server/src/billing/retention.ts` (new)
- `isListMonthly(sub)` and `isFounder(sub)`, by lookup key.
- `yearlySwitchOf(sub, paidCount, catalog, now) → { eligible, savings: { amount, currency } | null, refusal }`
- `cycleBoundaryAfter(anchor: Date, from: Date, months: number): Date`, Stripe's monthly clamp.
- `pauseWindowOf(sub, months, anchor) → { from, until }`, and `pauseOptionsOf(sub, events, now) → { allowed, options: [{ months, from, until }] }`
- `stayOfferOf(sub, events, coupon, catalog) → { percentOff, months, monthlyAmount, listAmount } | null`
- `CANCELLATION_REASONS`: Stripe's 8 feedback values, as a const tuple shared with the schema.

### 2.2 Stripe: `server/src/billing/stripe/plan-gateway.ts` (new)
- A new write port, built from the same restricted key and `CHECKOUT_BUDGET`, apart from `CheckoutGateway` so that port's reviewed contract stays as it is.
- Methods:
  - `planOf(subId)`: items, price, discounts, `pause_collection`, `billing_cycle_anchor`, cancel state.
  - `paidInvoiceCount(subId)`
  - `previewYearlySwitch(subId, yearlyPriceId, prorationDate)` → `{ amountDue, currency, periodEnd }`
  - `switchToYearly(...)`
  - `schedulePause(subId, resumesAt, from, months)`
  - `endPause(subId, { now })`
  - `cancelAtPeriodEnd(subId, feedback, comment)`
  - `keepPlan(subId)`
  - `applyCoupon(subId, couponId)`
- Every write carries an idempotency key `mtb3a:<action>:<subId>:<minute>`.
- Stripe errors go through `viaStripe`, plus `card_declined` → `PAYMENT_FAILED`.
- `CouponFact` gains `durationInMonths`. `couponById` (already cached) serves the stay coupon too.

### 2.3 Mirror and entitlement
- **Migration** `20261103120000_mut532_pause_retention`:
  - `billing_subscriptions`: two nullable columns, `pausedFrom` and `pauseResumesAt`;
  - the table in §2.4.
  - MUT-531 needs no migration.
- **`mirror.ts`:** `pauseResumesAt` from `pause_collection.resumes_at`, and `pausedFrom` from `metadata.mutaba3a_pause_from` (ISO). Both are null when `pause_collection` is null. `keepStatus` passes them through.
  - **R4 (eng review):** a pause someone set in the Stripe dashboard has no metadata, or bad metadata (not ISO, or not before `resumes_at`). It reads as paused from the start (`pausedFrom` = epoch 0), or indefinitely when `resumes_at` is null, with a new `MirrorNote` `PAUSE_NOT_OURS` for the operator. A `void` pause is never silently ACTIVE.
- **R5, one owner per state (eng review red flag 5):**
  - Stripe, through the mirror, is the only source for whether a pause is running. The entitlement reads only the mirror.
  - `billing_retention_events` records that a pause, offer or cancel happened, for the once-a-year and once-ever rules and for history. Nothing reads its dates for access.
- **`entitlement.ts`:** `SubscriptionFact` gains `pausedFrom` and `pauseResumesAt`. `pausedNow(s, now) = pausedFrom ≤ now < pauseResumesAt`:
  - A paused-now subscription never covers.
  - It resolves to READ_ONLY · STRIPE with `until = pauseResumesAt` and `paused: true`. The same branch as a lapse, so it runs before the trial lock and is never LOCKED.
  - `Entitlement` gains `paused: boolean`, false everywhere else, and it is added to `BillingEntitlementSchema`.
  - The legacy Stripe status `paused` stays READ_ONLY, and `paused` stays false there (the trial case).
- **`gate.ts`:** the new routes are `'open'` in `PERSON_LEVEL_GATE`, since paying, pausing and cancelling are how a lapse is handled. The existing walk test fails on any route left out. `lapsedError` gets a paused message variant.
- **Webhook:** no new event types. `customer.subscription.updated` carries every change here: switch, pause set or cleared, cancel, coupon. Voided invoices during a pause just roll the period.

### 2.4 Table `billing_retention_events`
- Columns:
  - `id`
  - `userId` (FK users, cascade with the MUT-333 hard delete)
  - `stripeSubscriptionId`
  - `kind` enum `PAUSE | STAY_OFFER | CANCEL | YEARLY_SWITCH`
  - `reason` (the feedback value, nullable)
  - `months` (nullable)
  - `startsAt` and `endsAt` (nullable)
  - `endedEarlyAt` (nullable)
  - `createdAt`
- Indexes: `(userId, kind, startsAt)`, plus a partial unique `(userId) WHERE kind = 'STAY_OFFER'`.
- Port methods: `billing.retentionEventsOf(userId)`, `billing.claimRetentionEvent(input)` (which throws `StateConflict('TAKEN')` on the unique index), `billing.releaseRetentionEvent(id)` and `billing.endRetentionEventEarly(id, at)`. They go in memory and Prisma, and the store guard lists them as session-reachable.
- Audit on each owned profile follows `auditOn`: `billing.yearly_switched`, `billing.pause_scheduled`, `billing.pause_ended`, `billing.cancel_scheduled`, `billing.cancel_undone` and `billing.stay_offer_applied`.

### 2.5 Routes: `server/src/routes/billing-plan.ts` (new, mounted beside `billingRoutes`)

All routes are person-level and session-only, rate-limited with `BILLING_SESSION_POLICY`, and refuse with `CONFLICT` plus `details.reason` (the house rule).

| Route | Body → answer | Refusal reasons |
|---|---|---|
| `GET /v1/billing/yearly-switch` | → `{ amountDue, currency, yearlyAmount, renewsOn, prorationDate }` | `SWITCH_NOT_AVAILABLE` |
| `POST /v1/billing/yearly-switch` | `{ prorationDate, expectedAmountDue }` → `BillingOverview.subscription` | `SWITCH_NOT_AVAILABLE`, `AMOUNT_CHANGED` (a fresh preview differs; nothing is charged), `PAYMENT_FAILED` |
| `POST /v1/billing/pause` | `{ months: 1\|2\|3, reason }` → `{ from, until }` | `PAUSE_NOT_AVAILABLE` |
| `DELETE /v1/billing/pause` | → `{ resumed: 'cancelled' \| 'now' }` | `NOT_PAUSED` |
| `POST /v1/billing/cancellation` | `{ reason, comment? }` → `{ endsOn }` | `NOTHING_TO_CANCEL` |
| `DELETE /v1/billing/cancellation` | → `{}` | `NOT_CANCELLING` |
| `POST /v1/billing/stay-offer` | `{ reason }` → `{ monthlyAmount, months }` | `STAY_OFFER_NOT_AVAILABLE` (also when already claimed) |

GET `/v1/billing` gains three things, all additive:
- `subscription.pause: { from, until } | null`
- `subscription.discounted: boolean`
- `yearlySwitch: { savings: { amount, currency } } | null`

The cancel step gets its offers from a separate read, `GET /v1/billing/retention` → `{ pause: { options } | null, stayOffer | null }`, which runs when the person presses Cancel. That way the Billing drawer doesn't read the coupon on every open.

The contract goes to `1.95.0-mut531`, then `1.96.0-mut532`. Each step regenerates `openapi.yaml` and `src/hosted/api/schema.d.ts`.

## 3. Portal (`src/hosted/**`)
- **`data/billingView.ts`:**
  - new panels `pauseScheduled` and `paused`, with actions `dontPause` and `resumeNow`;
  - `ending` gains `keepPlan`;
  - `switchLineOf(overview)`;
  - `paused` from the entitlement for the lapse banner.
- **`data/billingQueries.ts`:** mutations for switch, pause, resume, cancel, keep and stay. On success each invalidates `['billing']` and `/v1/me`, then polls the mirror (`usePollBilling`) until the webhook has landed.
- **Components:**
  - `BillingSwitchBody.tsx` (new): the switch confirm, with today's amount, the yearly price and the renewal date.
  - `BillingCancelFlow.tsx` (new): Why? → Pause → Stay → Confirm. `RadioCards` is used for the reasons and the months, `InPlaceConfirm` for the final step and Resume now.
  - Both swap into `BillingDrawer`'s body through a `step` URL key (`step=switch|cancel`, like `subscribe`), so the drawer stays one drawer and a reload keeps the step.
  - `BillingDrawer.tsx` only adds the switch line, Cancel plan, and the new panels and actions.
- **`LapseGate.tsx`:** a paused profile's banner says "paused until {date}" with Resume now, instead of "your subscription has ended". The Subscribe and offer lines are hidden for it.
- **i18n:** `hosted.billing.switch.*`, `hosted.billing.cancel.*`, `hosted.billing.pause.*`, `hosted.billing.stay.*`, plus new `chip`, `headline`, `context` and `gate` keys, in ar and en, with ICU plurals for months. Amounts use the existing `formatMinor` and `<bdi>`, and dates the existing billing day format.

## 4. Release-QA
- **`qa/support/billing-live.mjs`:**
  - creates a per-run stay coupon (`qa_stay_*`, passed as `BILLING_STAY_COUPON_ID`, refused on a live key like R6) and deletes it on stop;
  - sets the **sandbox** Customer Portal's default configuration to cancel off (mirroring live after §7);
  - the watch list gains the new files.
- **`qa/features/portal-live/billing.yaml`** (the specs are in `billing.spec.ts`, test clocks via `customerOnClock` and `advanceClock`):
  - `yearly-switch`: 2 paid months → the line "save ₪58 a year" → confirm shows today's amount → done shows "renews on <+1 year>" and ₪290. Stripe has the yearly price, no discount, and the invoice amount equals the preview.
  - `yearly-switch-early`: after 1 paid invoice there is no line.
  - `pause`: Cancel → reason → pause 2 months → "pauses on <period end>". The clock passes the period end → "Paused until", the read-only banner, adding refused, the export works. The clock passes `resumes_at` → active, charged ₪29.
  - `pause-resume-now`: during the pause → Resume now → charged today, writable again.
  - `pause-once-a-year`: a second Cancel within 12 months shows no pause step.
  - `stay-offer`: Cancel → reason → decline pause → accept stay → the next invoice is ₪14.50 → a second Cancel shows no stay step.
  - `cancel-reason`: Cancel → reason → decline both → "Your plan ends on" → Stripe has `feedback`. Then Keep my plan → active again.
  - `manage` is rewritten: Stripe's portal shows no cancel. Card and invoices only.
- **`qa/features/portal/billing.yaml`** (stubbed): `paused-banner` and `cancel-rtl-375` (Arabic, 375 px, every step).
- `release-qa lint` must be clean, and each spec must pass once (`release-qa run --attach --only <id>`).

## 5. Build order and tests (TDD: each test red first)
- **Step 0, a spike before any code** (sandbox, test clocks; script `qa/support/mut532-pause-spike.mjs`, result in `.claude/designs/mut-532-pause-spike-result.md`). Five checks:
  - (a) `pause_collection void` set mid-period with `resumes_at` = boundary + 2 months − 1 h: the current period is untouched, 2 invoices are voided, and the 3rd is charged.
  - (b) Resume now with `billing_cycle_anchor: now`: a full month is charged today.
  - (c) The switch preview's `amount_due` equals the charged invoice, and a declined card (`pm_card_chargeCustomerFail`) leaves it monthly.
  - (d) A repeating 2-month 50% coupon on monthly gives 1450, 1450, then 2900.
  - (e) Which restricted-key scopes the preview and the update need.

  If (a) fails, stop and bring it back to Basel before building pause.
- **MUT-531:**
  - `retention.test.ts` for the switch: paid count 0/1/2 (the ₪0 trial invoice excluded), founder, yearly, cancelling, discounted, and the saving in ILS/USD, ≤0 and with no catalog.
  - The gateway with a fake HTTP client.
  - The route tests: preview, switch, `AMOUNT_CHANGED`, `PAYMENT_FAILED`, rate limit, audit, gate walk, and that no `discounts` param is sent.
  - The mirror keeps FREELANCER and reads interval year.
  - Portal: billingView, then the drawer.
  - QA, then the knowledge files.
- **MUT-532:**
  - Migration and ports, then entitlement: pause scheduled → ACTIVE; running → READ_ONLY, paused, until; after → ACTIVE; Malafat wins; an ended trial plus a pause is never LOCKED.
  - `cycleBoundaryAfter` (Jan 31 → Feb 28/29 → Mar 31), pause eligibility (12 months, monthly only, trialist), stay eligibility (once ever, claim race, coupon shape).
  - Routes, portal, QA, knowledge files.
- **Checks under Node 22, through `heavy`, one at a time:**
  - lint, typecheck, `test:run --maxWorkers=3`, build;
  - the server's typecheck, lint, `openapi:check` and `test`;
  - `test:db` for the migration.

## 6. Copy deck (ar first, then en): **Basel approves before the build**

**Switch (MUT-531)**
| Key | ar | en |
|---|---|---|
| switch.line | انتقل إلى الدفع السنوي ووفّر {amount} في السنة | Switch to yearly and save {amount} a year |
| switch.action | انتقل إلى السنوي | Switch to yearly |
| switch.title | الانتقال إلى الدفع السنوي | Switch to yearly |
| switch.body | ستدفع {yearly} في السنة، ويتجدد اشتراكك في {date}. نخصم من دفعة اليوم ما تبقّى من شهرك الحالي. | You'll pay {yearly} a year, renewing on {date}. What's left of this month comes off today's charge. |
| switch.dueToday | تدفع اليوم {due}، شاملًا الضريبة حيث تنطبق | You pay {due} today, including VAT where it applies |
| switch.confirm | ادفع {due} وانتقل | Pay {due} and switch |
| switch.notNow | ليس الآن | Not now |
| switch.done | أصبحت على الخطة السنوية. تتجدد في {date} بسعر {yearly}. | You're on the yearly plan. It renews on {date} at {yearly}. |
| switch.declined | رُفضت البطاقة فلم يتغيّر شيء، وما زلت على الخطة الشهرية. | Your card was declined, so nothing changed. You're still on the monthly plan. |
| switch.amountChanged | تغيّر المبلغ منذ فتحت هذه الصفحة. راجعه مرة أخرى. | The amount changed since you opened this. Please check it again. |

**Cancel, pause, stay (MUT-532)**
| Key | ar | en |
|---|---|---|
| cancel.action | إلغاء الاشتراك | Cancel plan |
| cancel.whyTitle | لماذا تريد الإلغاء؟ | Why are you cancelling? |
| cancel.whyHint | إجابتك تساعدنا على تحسين متابعة. | Your answer helps us make MTB3A better. |
| cancel.reason.too_expensive | السعر مرتفع | It costs too much |
| cancel.reason.unused | لا أستخدمه بما يكفي | I don't use it enough |
| cancel.reason.missing_features | ينقصه شيء أحتاجه | It's missing something I need |
| cancel.reason.switched_service | سأنتقل إلى أداة أخرى | I'm moving to another tool |
| cancel.reason.too_complex | استخدامه صعب | It's hard to use |
| cancel.reason.low_quality | لا يعمل كما يجب | It doesn't work well |
| cancel.reason.customer_service | لم أحصل على المساعدة التي احتجتها | I didn't get the help I needed |
| cancel.reason.other | سبب آخر | Something else |
| cancel.comment | هل تودّ إخبارنا بالمزيد؟ (اختياري) | Anything else you'd like to tell us? (optional) |
| cancel.continue | متابعة | Continue |
| pause.title | ما رأيك بإيقاف مؤقت بدل الإلغاء؟ | Pause instead of cancelling? |
| pause.body | توقّف من شهر إلى ثلاثة أشهر دون أي دفع. يبقى كل شيء متاحًا للقراءة والتنزيل، ويعود اشتراكك وحده في الموعد الذي تختاره. | Take 1 to 3 months off and pay nothing. Everything stays readable and downloadable, and your plan restarts on its own on the date you pick. |
| pause.option | {months, plural, one {شهر واحد} two {شهران} few {# أشهر} other {# شهرًا}}، يعود في {date} | {months, plural, one {1 month} other {# months}}, restarts on {date} |
| pause.startsNote | يبدأ الإيقاف في {date}، حين تنتهي الفترة التي دفعتها. | The pause starts on {date}, when the month you paid for ends. |
| pause.onceNote | يمكنك الإيقاف المؤقت مرة واحدة في السنة. | You can pause once a year. |
| pause.confirm | أوقف اشتراكي مؤقتًا | Pause my plan |
| pause.decline | لا، أكمل الإلغاء | No, keep cancelling |
| stay.title | ابقَ معنا بخصم {percent}% لمدة {months, plural, one {شهر} two {شهرين} few {# أشهر} other {# شهرًا}} | Stay with {percent}% off for {months, plural, one {1 month} other {# months}} |
| stay.body | تدفع {price} شهريًا بدل {list}، ثم يعود السعر إلى {list} شهريًا. يمكنك الإلغاء متى شئت. | You pay {price} a month instead of {list}, then {list} a month again. You can still cancel any time. |
| stay.onceNote | عرض لمرة واحدة. إن ألغيت، ينتهي اشتراكك في {date}. | A one-time offer. If you cancel, your plan ends on {date}. |
| stay.accept | أبقِ اشتراكي بسعر {price} | Keep my plan at {price} |
| stay.decline | لا، ألغِ اشتراكي | No, cancel my plan |
| stay.done | تم. ستدفع {price} عن كل شهر من الشهرين القادمين. | Done. Your next 2 months are {price} each. |
| cancel.confirmTitle | إلغاء اشتراكك؟ | Cancel your plan? |
| cancel.confirmBody | يبقى اشتراكك فعّالًا حتى {date}. بعدها تبقى سجلاتك متاحة للقراءة والتنزيل، ولا يُحذف شيء. | Your plan stays on until {date}. After that your records stay readable and downloadable. Nothing is deleted. |
| cancel.confirm | ألغِ الاشتراك | Cancel plan |
| cancel.keep | أبقِ اشتراكي | Keep my plan |
| chip.paused | متوقف مؤقتًا | Paused |
| chip.pausing | إيقاف مجدول | Pause booked |
| headline.pauseScheduled | يتوقف اشتراكك مؤقتًا في {date} | Your plan pauses on {date} |
| context.pauseScheduled | يعود الدفع وحده في {until}. | Billing restarts on its own on {until}. |
| action.dontPause | تراجع عن الإيقاف | Don't pause |
| headline.paused | متوقف مؤقتًا حتى {date} | Paused until {date} |
| context.paused | سجلاتك للقراءة فقط حتى ذلك الحين: ترى كل شيء ويمكنك تنزيله. يعود الدفع وحده في {date}. | Your records are read-only until then: you can see and download everything. Billing restarts on its own on {date}. |
| action.resumeNow | استأنف الآن | Resume now |
| pause.resumeConfirm | تدفع اليوم {month}، ويتجدد اشتراكك شهريًا من اليوم. | You pay {month} today, and your plan renews monthly from today. |
| gate.readOnlyPaused | اشتراكك متوقف مؤقتًا حتى {date}. ترى كل شيء ويمكنك تنزيله، وتعود الإضافة والتعديل حين يُستأنف. | Your plan is paused until {date}. You can see and download everything; adding and changing come back when it restarts. |
| manageNote (changed) | غيّر بطاقتك أو اطّلع على الفواتير، في صفحة Stripe (بالإنجليزية). | Change your card or see invoices, on Stripe's page (in English). |

Stripe's own pages and mails stay English. Nothing new goes into our mails in these tickets.

## 7. Operator steps (live Stripe; written into `docs/operations/pilot-runbook.md` 3a/3c and `docs/operations/before-release.md`)
In order. Claude can't write to live Stripe.
1. **Before the API deploy:** add **Write on Subscriptions** to the restricted key, plus whatever the spike's (e) shows is needed for the invoice preview.
2. **Before the web release:** create the coupon `mtb3a_stay_monthly_50` with `percent_off 50`, `duration repeating`, `duration_in_months 2`, `applies_to` = the Freelancer product, and the name "Stay offer · عرض البقاء". No `redeem_by`. Until it exists there is no stay step, nothing breaks.
3. **After the web release:** in the Customer Portal settings, turn **off** "Cancel subscriptions". Keep the payment method, the invoices, and the business name and tax ID. Still no plan switching and no pausing. Do this before the release and nobody can cancel until it ships.
4. Runbook 3a's wording changes to match. A support reply explains where Cancel is now.

## 8. Not in scope / follow-ups
- MUT-535's mail line (D9).
- Founder switching (▲D5).
- Phone: Flutter's read-only text for `paused: true` ("paused until", Resume opens the web Billing). It needs its own MUT ticket in the Flutter repo.
- PostHog events for the cancel reasons (Stripe's dashboard has them). It can be added later if Basel wants a funnel.

## 9. Cost and scale
- GET `/v1/billing` makes one extra Stripe call (the paid count) only for list-monthly active payers.
- The retention read happens once per Cancel press, with the coupon cached for 10 minutes.
- The switch is two calls (preview and update), the pause one, the stay offer one.
- No new jobs, no Scheduler entries. There's one migration (two columns and one small table). Merging it restarts :8787, so warn the orchestrator first.

**Business / product impact**
- Monthly payers get a reason to go yearly (₪58 saved). People who'd cancel can take a seasonal break or half price for 2 months instead, the two main retention levers in MUT-528, built before the first 100 payers.
- These are step 4 of the epic's build order. MUT-534's come-back offer and MUT-535's mail line build on them.
- Risk stays in Stripe: nothing is free beyond what the person chose, a failed card changes nothing, and nobody is ever LOCKED by a pause.

## 10. Eng review (2026-11-02, condensed `/plan-eng-review`)

Run in one pass, with the findings folded into the plan above. The product calls are left as ▲ items for Basel, who approves the plan as a whole. No per-finding question ledger was kept, and the outside voice was not run: Codex isn't installed on this machine.

- **Scope challenge:** about 28 files and 3 new modules: `retention.ts`, `plan-gateway.ts` and `routes/billing-plan.ts`. Nothing smaller covers the ACs. Switching and pausing need subscription writes the Customer Portal can't gate, and the cancel steps need our own UI for Arabic. A separate gateway keeps MUT-362's reviewed `CheckoutGateway` port unchanged. Scope accepted as-is; the follow-ups in §8 are the deferrals.
- **Second shape considered:** send everything through Stripe's Customer Portal: plan switching on, a `flow_data.subscription_cancel` deep link with a retention coupon, and pause through `POST /subscriptions/:id/pause` plus our own resume job. That puts less code behind each operation, but it is English only, has no 2nd-payment gate, has no once-a-year pause, no Arabic reason step, and needs a job of ours anyway. Rejected (D1, D6, D8).
- **Findings folded in:**
  - **R1** [INFORMATIONAL, 9/10] `LapseGate.tsx:31` and `TrialBanner.tsx:35` read `billingQuery`, and `BillingDrawer.tsx:137` polls it every 2 s. An uncached paid-invoice count would make a Stripe call on every page view. Fix: cache the count, monotonic once it reaches 2 (D2).
  - **R2** [CRITICAL, 7/10] `pending_if_incomplete` plus a 3-D Secure card would show "declined" for a card that only needed approval. Fix: `PAYMENT_NEEDS_ACTION` with the hosted invoice link (D1).
  - **R3** [CRITICAL, 8/10] Releasing the stay claim on any Stripe failure, a timeout included, could give the offer twice. Fix: release only when Stripe definitely didn't apply it (D11).
  - **R4** [INFORMATIONAL, 7/10] A dashboard `pause_collection` without our metadata would read as ACTIVE. Fix: paused from epoch 0, plus `PAUSE_NOT_OURS` (§2.3).
  - **R5** [INFORMATIONAL, 8/10] The pause state would have two owners, the mirror and the event table. Fix: the mirror alone decides access; the events table is history and the once-rules (§2.3).
  - **R6** [INFORMATIONAL, 6/10, medium confidence] Two concurrent pauses. Fix: the claim and the re-check run under a row lock (D10).
- **Tests:** §5 lists the red-first tests per rule. Boundary cases that must exist:
  - `cycleBoundaryAfter` for a Jan 31 anchor and a leap year;
  - the pause starting exactly at `pausedFrom`, and ending at `pauseResumesAt` minus and plus 1 ms;
  - an ended trial plus a pause, which must never be LOCKED;
  - Malafat-connected plus paused, which must be ACTIVE;
  - the ₪0 trial invoice excluded from the paid count;
  - the switch request carries no `discounts`;
  - a stay-claim race (two concurrent POSTs → one coupon);
  - the gate walk covering the 7 new routes.

  The test-clock flows in §4 cover the money paths end to end.
- **Performance:** with R1, the extra Stripe calls are made only on a press (preview, switch, pause, stay, the retention read). No new queries in loops: retention events are one indexed read per Cancel press.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|---|---|---|---|---|---|
| Eng review | eng-ticket step 4 | combined plan MUT-531 + MUT-532 | 1 | done (condensed, single pass) | R1–R6 folded in; 2 critical, 4 informational |
| Outside voice | default-on | cross-model check | 0 | skipped: Codex not installed | none |

VERDICT: ready for Basel's product approval. The build starts with spike step 0 (§5).

OUTSIDE COVERAGE / CROSS-MODEL: none (Codex CLI absent).

All ▲ decisions and the copy deck were approved by Basel on 2026-11-02 (D5, D6/D10/D11, D7, D8, D9, §6).

NO UNRESOLVED DECISIONS
