# MUT-734: change plan: up now with a pro-rata charge, down at the end of the paid cycle

Status: **planned, not built** (2026-11-27). Epic MUT-701. Builds on ADR-275 (`changeTimingOf`, `RANK`), ADR-284
(Starter, `starterChosenAt`, `activeBusinessIds`, the business-cap post-pass), ADR-288 (the provider port, per-plan
catalogs), ADR-240 (MUT-532 pause / cancel / stay, `billing_retention_events`), MUT-531 (the yearly switch: Stripe
proration preview + `always_invoice` with one `proration_date`).

```
Tracker: Jira · barmajiyat.atlassian.net · MUT · Backlog = not committed · finished → In Review
```

## 0. What exists

- `changeTimingOf(current, target)` → now | period_end | same. Called by nothing.
- `plan-gateway.ts`: `previewYearlySwitch` / `switchToYearly` (proration at a fixed `proration_date`, `always_invoice`, idempotency key per sub/price/date) — the exact pattern an upgrade needs, with a different target price.
- `cancelAtPeriodEnd`, `keepPlan` (undo), founder subscriptions run on a Stripe subscription schedule (`managedBySchedule`), which the cancel path already probes.
- `POST /v1/billing/starter` (Continue free on Starter), `PUT /v1/billing/active-businesses`, `business-cap.ts` with `ENFORCED_BUSINESS_CAPS = {starter}`.
- Checkout refuses `ALREADY_SUBSCRIBED` for a second profile plan: a subscriber has no way to change plan today.

## 1. Acceptance criteria

1. `POST /v1/billing/plan-change/preview` and `POST /v1/billing/plan-change` (confirm). Upgrade preview: the amount charged now (Stripe's proration, tax included, in the subscription's currency) and the new limits. Downgrade preview: the effective date (`currentPeriodEnd`) and, when the target's business cap is below what the person owns, the businesses that will become read-only unless chosen.
2. **Upgrade** (higher `RANK`): charges at once (`always_invoice`, `payment_behavior: pending_if_incomplete`); the tier changes when Stripe confirms. Sync answer: `200 { state: 'applied' }`, or `202 { state: 'pending' }` (3-D Secure / async) with the hosted invoice URL; the portal shows pending until the mirror updates. A failed card leaves the old plan untouched.
3. **Downgrade to a lower paid plan**: no refund; stored as scheduled on the provider (a Stripe subscription schedule: phase 1 = current price to `currentPeriodEnd`, phase 2 = the lower plan's price in the same currency and interval). The mirror keeps the current tier until the boundary and exposes `scheduledChange`. At the boundary Stripe switches the price itself; the mirror follows on the webhook; the nightly reconcile catches a missed one.
4. **Downgrade to Starter**: `cancel_at_period_end` **and** `starterChosenAt = now` (ADR-284 row 7's exception), so at the end the account is ACTIVE on Starter with no read-only gap.
5. Going below a business count: at scheduling the person picks which businesses stay active (stored in `activeBusinessIds`); the rest become READ_ONLY with `planLimit` at the boundary. No pick = the request is refused `422 ACTIVE_BUSINESSES_REQUIRED` (Basel's MUT-731 Q5: they must pick; no default).
6. A scheduled downgrade can be undone until the boundary: `DELETE /v1/billing/plan-change` (releases the schedule / clears `cancel_at_period_end` and `starterChosenAt`).
7. Interval stays as is (monthly stays monthly); the yearly switch remains its own action (Q1).
8. Cancel stays MUT-532's flow (read-only at the end); its confirm step offers "Move to Starter instead" (= AC4).
9. Portal: Billing's plan picker (MUT-705) offers Change plan for a subscriber: preview, confirm; scheduled change shown in Billing ("Solo from 1 January" + Undo). ar + en.
10. Phone: shows the current and the scheduled plan (MUT-706); no change on the phone (store rules, MUT-364 D1) (Q4).
11. Mails (ar + en): "Your plan changes to <plan> on <date>" at scheduling; Stripe's receipt for the upgrade charge (and, for IL, the tax invoice-receipt from MUT-750 slice B).
12. Operator console: plan history per person (upgrades, scheduled, undone, applied).
13. Paid plans' business caps are enforced (needed for AC5): `ENFORCED_BUSINESS_CAPS` gains solo/business/firm, and `POST /v1/profiles` refuses past the paid plan's count with `PLAN_LIMIT businesses` (this is MUT-704's AC1/AC6; see Q2).
14. QA flows: Solo→Business mid-cycle; Business→Solo (Business until the cycle ends, then Solo); paid→Starter; undo a scheduled downgrade.

## 2. Design

### 2.1 Pure core (`billing/plan-change.ts`, new)

```ts
planChangeOf({ current: { tier, interval, currency, periodEnd, managedBySchedule, pausedFrom, status },
               target: PlanName | 'starter', ownedBusinesses, chosenActive }) →
  | { kind: 'upgrade' }
  | { kind: 'downgrade', effectiveAt, readOnly: orgId[] }
  | { kind: 'to_starter', effectiveAt, readOnly: orgId[] }
  | { refused: 'SAME_PLAN' | 'NOT_SUBSCRIBED' | 'PAUSED' | 'PAST_DUE' | 'SCHEDULE_PENDING' | 'LEGACY_PLAN' | 'ACTIVE_BUSINESSES_REQUIRED' }
```
- Uses `changeTimingOf`; Starter target is always period end.
- Refusals: no covering profile-plan subscription (Starter → Checkout); a running pause (MUT-532) or `past_due` (fix the card first); a change already scheduled (undo first); legacy Freelancer/founder (MUT-707 moves them; Q3).

### 2.2 Provider port (`billing/provider.ts` + Stripe adapter)

`BillingProvider` gains (Stripe adapter wraps `plan-gateway.ts`; no Stripe in the core):
- `previewUpgrade({ subscriptionId, targetPriceId, at })` → `{ amountDue, currency, tax }` (Stripe `invoices.createPreview` with `subscription_details.items` + `proration_date`, as MUT-531).
- `upgrade({ …, at })` → `{ outcome: 'applied' | 'pending', hostedInvoiceUrl? }`. Item update with `proration_behavior: 'always_invoice'`, `payment_behavior: 'pending_if_incomplete'`, `tax_rates` from MUT-750's `taxRatesFor` (so the Israeli VAT stays), metadata `mutaba3a_plan`. Idempotency key `mut734-up-<sub>-<price>-<at>`.
- `scheduleDowngrade({ subscriptionId, targetPriceId })`: `subscriptionSchedules.create({ from_subscription })` then `update` to two phases. A founder subscription already on a schedule is refused (`LEGACY_PLAN`, Q3).
- `undoScheduledChange({ subscriptionId })`: `subscriptionSchedules.release` (keeps the current phase) or clears `cancel_at_period_end` for the Starter case (reuses MUT-532's `keepPlan`).
- Target prices come from the per-plan catalogs (`catalogs()`), same currency and interval as the subscription; a missing price → `PRICES_NOT_SET`.

### 2.3 Mirror

`stripe/mirror.ts` reads the subscription's schedule (expanded on sync): when a next phase with a different price exists, mirror `scheduledTier`, `scheduledPriceLookupKey`, `scheduledAt` (phase 2 start). The tier stays the current phase's. On the boundary event the price changes and the scheduled fields clear. `cancelAtPeriodEnd` + `starterChosenAt` already describe the Starter case.

### 2.4 Routes (`routes/billing-plan.ts`, next to the yearly switch)

| Route | Gate | What |
|---|---|---|
| `POST /v1/billing/plan-change/preview` `{ plan }` | open | the preview (AC1) |
| `POST /v1/billing/plan-change` `{ plan, activeBusinessIds?, prorationAt }` | open | confirm; `prorationAt` echoes the preview's so the charged amount equals the shown one (MUT-531 D1) |
| `DELETE /v1/billing/plan-change` | open | undo a scheduled change |
| `GET /v1/billing` | — | gains `scheduledChange: { plan, at } | null`, `planChange: { canUpgradeTo: PlanName[], canDowngradeTo: (PlanName|'starter')[] }` |

All in `PERSON_LEVEL_GATE`. Idempotency middleware on POST/DELETE. Every action writes a `billing_plan_changes` row (below) and an audit entry.

### 2.5 Business count at the boundary

- `ENFORCED_BUSINESS_CAPS` gains the paid plans (behind `PAID_BUSINESS_CAPS`, default off, so live Solo/Business/Firm subscribers aren't affected until Basel turns it on with the pricing release; legacy Freelancer has no limits row and stays unlimited).
- `business-cap.ts` already reads `activeBusinessIds`; it is now set at scheduling time. Before the boundary the person is still on the higher plan, so nothing is read-only yet.
- `POST /v1/profiles` past the paid plan's count → `PLAN_LIMIT businesses` (Starter's path generalised).

### 2.6 Portal

- `BillingDrawer.tsx` plan step (MUT-705's picker; until MUT-705 ships, a minimal "Change plan" pane listing the plans with their prices from `plans`): pick → preview pane ("Charged now: ₪31.40" or "Solo from 1 January" + the businesses to keep, using the existing pick list from `PickActiveBusinessDialog` as a pane) → Confirm.
- Billing shows a scheduled change in one line with Undo.
- `BillingCancelFlow.tsx`: the confirm step's second button "Move to Starter instead".
- Pending upgrade: "Waiting for the payment" with Stripe's hosted invoice link (3-D Secure).
- i18n `hosted.billing.change.*`. Analytics `plan_change_previewed { from, to }`, `plan_change_confirmed { from, to, kind }`, `plan_change_undone`.

### 2.7 Mails

`email/templates`: `plan-change-scheduled` (plan, date; ar + en). Upgrades rely on Stripe's receipt (+ MUT-750's IL document). Sent by the confirm route through the mail log with key `plan-change:<changeId>`.

### 2.8 Operator console

`OperatorBillingSection.tsx`: a "Plan history" list from `billing_plan_changes` (date, from → to, kind, state). Read via the existing operator account endpoint (additive field).

## 3. Migration (one, additive)

`<ts>_mut734_plan_changes` — **timestamp after the accountant-channel migrations** (MUT-763 has `20261127150000`; MUT-764+ may add more; re-stamp at merge and warn the orchestrator: it restarts the shared dev API):
- `billing_subscriptions`: `scheduledTier "BillingTier" null`, `scheduledPriceLookupKey varchar(100) null`, `scheduledAt timestamptz null`.
- New `billing_plan_changes`: `id uuid pk`, `userId uuid fk users on delete cascade`, `stripeSubscriptionId text`, `fromTier`, `toTier` (varchar(16), STARTER allowed: it is never a stored subscription tier), `kind varchar(16)` (UPGRADE | DOWNGRADE | TO_STARTER), `state varchar(16)` (APPLIED | PENDING | SCHEDULED | UNDONE | FAILED), `effectiveAt timestamptz`, `amountMinor int null`, `currency char(3) null`, `createdAt`, index `(userId, createdAt)`. Closure deletes with the user.

## 4. Error states

| Case | Answer |
|---|---|
| Not subscribed / on Starter | 409 `NOT_SUBSCRIBED` (use Checkout) |
| Same plan | 409 `SAME_PLAN` |
| Pause running / past due | 409 `PAUSED` / `PAST_DUE` |
| Change already scheduled | 409 `SCHEDULE_PENDING` |
| Founder / legacy | 409 `LEGACY_PLAN` (Q3) |
| Preview stale (`prorationAt` older than 15 min) | 409 `PREVIEW_EXPIRED`: preview again |
| Card declined on upgrade | 402 `PAYMENT_FAILED` with the hosted invoice URL; nothing changed (`pending_if_incomplete`) |
| Businesses not picked on a reducing downgrade | 422 `ACTIVE_BUSINESSES_REQUIRED` with `cap` and the owned list |
| Provider down | 503 `BILLING_UNAVAILABLE`; nothing recorded |

## 5. Tests (written first)

1. `plan-change.test.ts`: every row of the decision (each tier pair incl. Starter and legacy, pause, past due, schedule pending, business counts at cap−1/cap/cap+1).
2. Stripe adapter: upgrade payload (`always_invoice`, `pending_if_incomplete`, `tax_rates` for IL, idempotency key); schedule two phases in the subscription's currency and interval; undo releases.
3. Mirror: schedule phases → scheduled fields; boundary event → tier changes, fields clear.
4. Routes: preview/confirm/undo; `prorationAt` round trip; 402 path leaves the plan; history rows.
5. `business-cap.test.ts`: paid plans with the flag; picks persisted at scheduling, applied at the boundary.
6. `test:db`: migration, cascade on closure.
7. Portal: change pane, preview amounts, scheduled line + Undo, cancel flow's Starter button.

## 6. QA scenarios (release-QA; the live parts on `portal-live` against the Stripe sandbox with a test clock, TD-347)

| id | Steps | Outcome |
|---|---|---|
| `portal-live.billing.upgrade-solo-business` | On Solo mid-cycle › Change plan › Business › Confirm | Charged the shown amount; Billing says Business; 3 businesses allowed |
| `portal-live.billing.downgrade-business-solo` | On Business with 2 businesses › Change plan › Solo › keep one › Confirm; clock past period end | Business until the end; then Solo, the other business read-only |
| `portal-live.billing.to-starter` | Cancel flow › Move to Starter instead; clock past end | Starter, active, no read-only gap |
| `portal-live.billing.undo-downgrade` | Schedule Solo › Undo | Business renews |
| `portal.billing.change-plan-pane` (FakeApi) | Open Change plan | Plans, preview line, confirm |

## 7. Dependencies

- MUT-702 Part B (merged) for per-plan prices; `PLAN_CHECKOUT` must be on for anything to change.
- MUT-705 (portal picker): this ticket builds a minimal Change-plan pane if MUT-705 isn't done; MUT-705 then replaces the list, not the flow.
- MUT-750 slice A's `taxRatesFor` (build it first or together: both edit the item-update call).
- MUT-766 (accountant channel) extracts `startCheckout(payer)` in `checkout.ts`: no overlap with plan change, but the same files; rebase whichever lands second.
- MUT-733's paid hard caps need this live (a subscriber at the cap must be able to upgrade).

## 8. Knowledge updates

New ADR "Plan changes: up now with Stripe proration, down by a provider schedule at period end, to Starter by cancel + starterChosenAt" (fills ADR-275 d2's `changeTimingOf` consumer; amends ADR-284 row 7 note). COMPONENT_REGISTRY (change pane), CHANGELOG, TEST_PLAN, before-release (`PAID_BUSINESS_CAPS`), SYSTEM_OVERVIEW §8.

## 9. Questions only Basel can answer

1. **Interval with a plan change:** may someone go Solo monthly → Business yearly in one step, or is the interval kept and the yearly switch separate? [Default: kept; separate.]
2. **Paid plans' business caps (MUT-704 AC1/AC6):** turn them on with this ticket (needed for "which businesses stay active" on a downgrade)? Existing subscribers over the count on day one? [Default: yes, behind `PAID_BUSINESS_CAPS`; nobody on Solo/Business/Firm exists yet in production.]
3. **Legacy Freelancer ₪29 and founder ₪21 payers:** can they change plan here, or only through MUT-707? An upgrade would end the founder price. [Default: refused (`LEGACY_PLAN`) until MUT-707.]
4. **Phone:** read-only (shows current and scheduled plan), or link out to the web where store rules allow? [Default: read-only, as Q4 on MUT-731.]
5. **A launch-offer coupon** (MUT-525/703) on the old plan: carried to the new plan on upgrade, or dropped? [Default: dropped on upgrade; kept on a downgrade until its own end.]
6. **Upgrade on a yearly subscription** charges a large pro-rata at once: fine, or ask for a confirmation line naming the amount? [Default: the preview already names the amount; no extra step.]
