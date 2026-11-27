# MUT-706: the phone knows every plan and the whole subscription lifecycle (names, caps, usage, gift, scheduled change)

Status: **planned, not built** (2026-11-27). Epic MUT-701. Work is in the Flutter repo
(`~/Work/Barmajiyat/Mutaba3a/mutaba3a-flutter/mutaba3a`), on its own branch there; this brief lives in mini-crm with
its siblings because every item reads a mini-crm API contract. Basel's scope comment 13535 (2026-11-25) widens the
ticket from "names and notices" to all plans and the whole lifecycle.

```
Tracker: Jira · barmajiyat.atlassian.net · MUT · Backlog = not committed · finished → In Review
```

## 0. What the phone already has (Flutter main `df9a9369`, MUT-731 phone half)

| Comment 13535 item | State |
|---|---|
| Starter caps and the upgrade offer | **Done**: `BillingPlan` (starter, solo, business, firm, freelancer), `PLAN_LIMIT` 409 parsed (`errors.dart:128-171`, `api_client.dart:740`), `plan_limit_gate.dart`, limit sheet "Plans are managed in your MTB3A account on the web" (no link, no price), captures kept at a cap |
| This month's usage | **Done for Starter only**: `UsageMeter` with `level`, `StarterBillingSection` shown only for `StarterPanel` (`billing_screen.dart:316`) |
| Read-only businesses | **Done for Starter**: `pick_active_business_screen.dart` (pick one) |
| First run | **Done**: plain Starter step (`welcome_screen.dart`); the Solo trial is web-only (MUT-731 Q7) |
| Tax Authority on paid plans only | **Done** (MUT-736 server; the phone reads `suspended` / manual allocation line) |
| **Subscription tier names** | **Not done**: `BillingTier` (a subscription's tier, `billing.dart:144`) knows only FREELANCER and FIRM; SOLO, BUSINESS, ACCOUNTANT parse to null, so `ActivePanel` falls to "active, no plan name" (`billing_screen.dart:60-70`) |
| **Usage for paid plans, 80% / 90%** | Not done (Starter-only section) |
| **Over-cap gift** (MUT-733) | Not done: `TODO(MUT-733)` at `plan_usage.dart:17`, reads `meters[].graceUntil` (server not sending yet) |
| **Scheduled downgrade / upgrade** (MUT-734) | Not done |
| **Pick active businesses on a paid plan** (cap 3 / 6) | Not done (pick-one only) |
| Profile limit copy naming the plan | Partly: Starter's sheet; `profileErrorLimit` (old 6-cap `CONFLICT PROFILE_LIMIT`) still generic |
| First-run analytics (MUT-737) | Not done |

## 1. Acceptance criteria

1. Billing names the plan for every state: Starter, Solo, Business, Firm, legacy Freelancer («الخطة السابقة»), Accountant, in ar and en, with the portal's Arabic names (ADR-275: مستقل / تجاري / مؤسسة; Starter «البداية»).
2. A refused new business on any plan shows the limit, the plan and "Plans are managed in your MTB3A account on the web" (no link, no price).
3. Usage lines for every plan with limits: from 80% one quiet line in Billing and at the point of use (issue screen footer, Scan bar); from 90% the same line in the attention ink; at the cap the limit sheet. No new screens.
4. The over-cap gift (MUT-733): a refusal with `gift: available` shows the gift sheet (the message, Continue only); Continue calls `POST /v1/billing/over-cap-gift` and retries the held action (issue, capture upload from the outbox). `graceUntil` shows "No limit until <date>" on that meter.
5. A scheduled change (MUT-734) shows in Billing as one line: "<plan> from <date>". No change actions on the phone (Q4 on MUT-734).
6. Read-only businesses on a paid plan explain themselves and open the pick screen, which picks up to the plan's cap (multi-select for Business / Firm).
7. First-run Starter step sends `onboarding_plan_shown` / `onboarding_plan_chosen { choice: 'starter', surface: 'phone' }` (MUT-737), consented analytics only.
8. Unit and widget tests updated (`billing_overview_test`, `billing_view_test`, `billing_screen_test`, plan_usage tests); `qa/features/ios/billing.yaml` updated; changed flows re-recorded on the shared "QA iPhone" only.

## 2. Where (Flutter)

- `lib/domain/models/billing.dart`: `BillingTier` gains `solo('SOLO')`, `business('BUSINESS')`, `accountant('ACCOUNTANT')`; `UsageMeter.graceUntil` (DateTime?); `UsageView.giftAvailable`; `BillingOverview.scheduledChange` (`{ plan: BillingPlan, at }`). All parse leniently (unknown → null).
- `lib/presentation/screens/billing/billing_screen.dart`: the `ActivePanel` headline switch covers every tier via one `planName(l10n, tier)` helper shared with `plan_usage.dart` (no second switch); scheduled-change line under the headline.
- `plan_usage.dart`: `StarterBillingSection` generalised to `PlanUsageSection` (any plan whose meters have a `limit`); levels drive ink; gift sheet `OverCapGiftSheet` (replaces the TODO).
- `plan_limit_gate.dart`: on `PlanLimit.gift == available` show the gift sheet instead of the limit sheet; on Continue, call the endpoint, then re-run the held callback (the gate already holds the action for the limit sheet).
- `lib/data/repositories/billing_repository.dart` (or the existing billing API client): `acceptOverCapGift(meter)`.
- Outbox: a capture refused with `gift: available` stays queued (already kept at a cap); after acceptance the outbox is nudged.
- `pick_active_business_screen.dart`: `cap` from `/v1/me` `plan.businesses`; multi-select when cap > 1; Continue enabled at exactly `cap` (server rule `PUT /v1/billing/active-businesses`).
- `core/errors.dart`: `GIFT_USED`, `GIFT_NOT_AVAILABLE` (treated as "retry the action": the server answers the real state).
- ARB (`lib/presentation/l10n/app_{en,ar}.arb`): `billingPlanSolo`, `billingPlanBusiness`, `billingPlanAccountant`, `billingPlanLegacy`, `billingScheduledChange`, `usageGraceUntil`, `overCapGift*`; `profileErrorLimit` reworded to name the plan.
- Analytics: the two onboarding events in the analytics service's closed list (mirrors `docs/analytics/events.json`).

## 3. API contracts read (all additive on mini-crm)

`/v1/me` `plan { current, businesses }` (exists), `GET /v1/billing` `usage.meters[].graceUntil`, `usage.gift.available` (MUT-733), `scheduledChange` (MUT-734), `subscription.tier` with SOLO/BUSINESS/ACCOUNTANT (exists since ADR-275), 409 `PLAN_LIMIT.details.gift` (MUT-733), `POST /v1/billing/over-cap-gift` (MUT-733).

## 4. Error states

| Case | Behaviour |
|---|---|
| Server without MUT-733/734 | Fields absent → nothing shown (lenient parse) |
| Gift accept fails offline | The sheet stays; Continue retries; the capture stays in the outbox |
| `GIFT_USED` (the portal took it first) | Retry the held action: it succeeds (gift active) or shows the hard-cap sheet |
| Unknown future tier | "Active" headline without a name (today's fallback) |

## 5. Migrations

None (Flutter). No mini-crm migration from this ticket.

## 6. Tests

Model parse tests for every tier and the new fields; widget tests: headline per tier ar/en, usage lines at 79/80/90/100%, gift sheet → endpoint → retry, scheduled line, multi-pick at cap 3; outbox retry after gift.

## 7. QA scenarios (`qa/features/ios/billing.yaml`, recorded on "QA iPhone")

| id | Steps | Outcome |
|---|---|---|
| `ios.billing.plan-names` | Sign in as a Business subscriber (seeded grant), open Billing; repeat in Arabic | "Business" / «تجاري» |
| `ios.billing.paid-usage` | Seeded 45 of 50 invoices on Solo | Usage line in attention ink |
| `ios.billing.gift` | Seeded 50 of 50 on Solo, gift unused; issue | Gift sheet, Continue, the document issues |
| `ios.billing.scheduled-change` | Seeded scheduled downgrade | "Solo from 1 January" |
| `ios.billing.pick-three` | Business → Solo boundary passed with 3 businesses (seeded) | Pick screen, one active |

Re-record only these and any existing billing flow whose screen changed (`ios.billing.starter` only if the generalised section changes its look; else one line saying why it's skipped).

## 8. Dependencies and order

Server halves first: MUT-733 (gift fields, endpoint), MUT-734 (`scheduledChange`). The tier names, paid usage lines and analytics can ship before them. The phone build with the gift sheet must be live **before** `PAID_HARD_CAPS` goes on (older builds would show a hard cap where a gift was due). Overlaps MUT-756 (pilot: phone usage lines): build the usage section once, here.

## 9. Questions only Basel can answer

1. **Accountant plan on the phone:** name it in Billing («المحاسب»?) and show its client-book cap, or leave the accountant desk web-only? [Default: name only.]
2. **Legacy Freelancer name on the phone:** «الخطة السابقة» / "Previous plan" as on the portal (ADR-275)? [Default: yes.]
3. **Gift message** length (same as MUT-733 Q5).
4. Should the 90% line on the phone carry any action (there is no upgrade on the phone)? [Default: no action, the line only.]
