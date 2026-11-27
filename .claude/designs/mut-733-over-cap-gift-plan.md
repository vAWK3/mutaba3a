# MUT-733: paid plans' monthly caps: notices at 80% and 90%, a one-time gift, then upgrade or a hard cap

Status: **APPROVED with every default answer (Basel, 2026-11-27); not built.** Epic MUT-701. Builds on MUT-735 (ADR-281: counter, levels, the gift
marker columns), MUT-731 (ADR-284/285: `PLAN_LIMIT`, `HARD_CAP_PLANS`, `PlanLimitNotice`, usage reads). Replaces the
soft-cap and "two months over → move up at renewal" rules of MUT-704.

```
Tracker: Jira · barmajiyat.atlassian.net · MUT · Backlog = not committed · finished → In Review
```

## 0. Basel's decisions (MUT-733 comment 13548, 2026-11-25), authoritative

| Topic | Decision |
|---|---|
| Gift frequency | Once per account, ever |
| Gift scope | One gift in total, for whichever limit (documents or scans) is hit first; after it, no gift for the other |
| Starter | No gift: always a hard cap with an upgrade offer (built, ADR-284) |
| Notices | Heads-up at 80%; from 90% an upgrade nudge, in-app and on the usage line |
| Storage | One per-account marker (`users.overCapGiftUsedAt`, `overCapGiftMeter`, `overCapGiftMonth`), already in the schema since `20261125230000_mut735_usage_metering`, written by nothing yet |

What already exists: the race-free conditional counter (`recordUsageTx`), `levelOf` (ok/near/nudge/at_cap), `GET /v1/billing.usage` with `meters[].graceUntil` reserved, `PLAN_LIMIT` with released idempotency keys, the portal's `PlanLimitNotice` and `UsageNotice`, the phone's limit sheet with a `TODO(MUT-733)` for the gift (`plan_usage.dart:17`). So this ticket is mostly a rule change plus one endpoint and the gift message on both clients.

## 1. Acceptance criteria

1. With `PAID_HARD_CAPS` on, Solo, Business and Firm monthly meters refuse at their cap (`PLAN_LIMIT`), except: a receipt for a payment on an already-issued document (never refused, as on Starter), Malafat's writes (no plan), legacy Freelancer (no limits row), an owner-less operator firm (`org:` subject: no person to gift; Q4).
2. The **first** refusal for an account whose gift is unused carries `details.gift: 'available'`. The client shows the gift message **before** anything goes through; the person confirms; `POST /v1/billing/over-cap-gift` records it; the same request is retried and succeeds.
3. While the gift runs (until the 1st of next Jerusalem month), the gifted meter has no cap. `GET /v1/billing.usage.meters[].graceUntil` is that date for the gifted meter.
4. Any later refusal (another month, or the other meter) is a hard cap: `PLAN_LIMIT` with `nextPlan` and `canUpgrade`, no `gift`.
5. Notices: from 80% one quiet usage line ("41 of 50 invoices this month"); from 90% the same line plus Upgrade to <next plan> (hidden on Firm). In Billing and at the point of use (Issue drawer footer, Scan), portal and phone, ar + en. (Portal's Business-plan usage lines are MUT-754: built here or there, not twice; see §8.)
6. An upgrade lifts the cap at once (the payer's plan is read per action; nothing cached).
7. Analytics (portal and phone, opt-in, anonymous): `plan_gift_shown { limit }`, `plan_gift_accepted { limit }`; `plan_cap_reached` gains `plan`.
8. An ADR records that MUT-704's soft caps and move-up-at-renewal are replaced.
9. QA flows: first time over (message, gift, then several more allowed); next month the cap is hard; an upgrade lifts it.

## 2. Design

### 2.1 Rule (server, pure)

- `billing/plans.ts`: `PAID_HARD_CAP_PLANS = {solo, business, firm}`; `HARD_CAP_PLANS` becomes a function `hardCapPlans({ paidHardCaps })` (Starter always; paid with the flag). The flag comes from config through the store like `starterPlan` (ADR-284 d3), so every reader agrees.
- `usage/gift.ts` (new, pure):
  ```ts
  type GiftState = { usedAt: Date | null; meter: UsageMeter | null; month: string | null };
  giftCovers(state, meter, month): boolean        // usedAt set, month === this month, meter === state.meter (Q1)
  giftAvailable(state, plan): boolean             // usedAt null and plan is paid
  ```
- `usage/caps.ts` `hardCapOf(plan, meter, { gift, month, paidHardCaps })`: null when the gift covers this meter this month; else the plan's cap where the plan is hard-capped.
- `billing/plan-limit.ts`: `PlanLimitDetails.gift?: 'available'` (only on monthly meters, only paid plans, only when unused).

### 2.2 Doors (no new doors; each passes the gift state)

- `routes/issuing.ts` → `issueTx`: `payerPlanOf` already runs on capped actions; it gains the payer's gift state from the same user read (`users` row is already loaded for the plan; no extra query).
- Issue all (`routes/documents-due.ts`): already stops at the first `PLAN_LIMIT` and returns `limit`; it gains `gift`.
- Scans (`expenses/receipts-compose.ts`): the start pre-check and the complete both pass it.

### 2.3 The gift endpoint

`POST /v1/billing/over-cap-gift` `{ meter: 'documents' | 'scans' }` → `200 { meter, until }`.
- One conditional `UPDATE users SET overCapGiftUsedAt = now, overCapGiftMeter, overCapGiftMonth WHERE id = payer AND overCapGiftUsedAt IS NULL`; 0 rows → `409 GIFT_USED`.
- Refused `409 GIFT_NOT_AVAILABLE` unless the payer's plan is paid, the flag is on and the meter is at its cap this month (so it can't be taken early).
- The payer is the profile owner (`profileOwnerOf`), like the meters: a partner who hits the owner's cap can accept it (Q3). Audit `billing.over_cap_gift` with the actor. Gate class `open`, in `PERSON_LEVEL_GATE`; profile id in the body is not needed (the payer is the caller, or `organizationId` optional for a partner: then the owner).
- Idempotent for the same meter and month (a retry after a lost response returns 200).

### 2.4 `GET /v1/billing.usage` (additive)

- `meters[].graceUntil` sent (first day of next month, Jerusalem) for the gifted meter in its month.
- `gift: { available: boolean }` at the usage level.
- `level` unchanged; on a gifted meter `limit` is still the plan's cap, `level` stays `at_cap` past it (the client shows "unlimited until <date>" from `graceUntil`).

### 2.5 Portal (`src/hosted`)

- `components/PlanLimitNotice.tsx`: a `gift` variant. Same butter `hp-banner`; the message (copy in §5); one button, Continue, which calls the endpoint and re-submits the held request (Issue drawer, Issue all, receipt upload). No second button: Cancel is the drawer's own close.
- Before the person types (ADR-285 d2): with `usage` at cap and `gift.available`, the Issue drawer opens with the gift notice in place of the refusal; Continue records it, then the drawer is usable.
- `components/UsageNotice.tsx` / Billing meters: from 80% the line; from 90% Upgrade to <next plan> (not on Firm); `graceUntil` → "No limit until 1 January".
- Upgrade opens the plan picker (MUT-705) / the plan change (MUT-734) for a subscriber; Checkout's Subscribe step only for Starter.
- i18n `hosted.planLimit.gift.*`, `hosted.billing.usage.graceUntil`.

### 2.6 Phone (Flutter): see MUT-706's plan; this ticket's server half ships first, the phone build that reads `gift` before `PAID_HARD_CAPS` goes on.

## 3. API contracts

```jsonc
// 409 on a paid plan, first time
{ "code": "PLAN_LIMIT", "details": { "limit": "documents", "plan": "solo", "used": 50, "cap": 50,
  "resetsOn": "2027-01-01", "nextPlan": "business", "canUpgrade": true, "gift": "available" } }
// POST /v1/billing/over-cap-gift
{ "meter": "documents" }  →  200 { "meter": "documents", "until": "2027-01-01" }
// 409 GIFT_USED | GIFT_NOT_AVAILABLE
```
OpenAPI, `errors.ts` `ERROR_CODES`, portal `serverErrorCodes.ts`, phone `errors.dart`. API minor bump, additive.

## 4. Error states

| Case | Behaviour |
|---|---|
| Two tabs accept at once | Conditional update: one 200, the other 409 GIFT_USED → the client simply retries the held request (the gift is active either way when meters match) |
| Accept, then the retry races into the next month | The retry is refused with a hard cap (gift month passed) and no gift: correct by the rule |
| Old client (no `gift` support) | Sees a plain `PLAN_LIMIT` (hard cap). Acceptable only because `PAID_HARD_CAPS` turns on after the phone build ships (§7) |
| Phone outbox capture at the cap | MUT-731 keeps the capture; the gift sheet then retries it |
| Firm at its cap after the gift | Hard cap with no upgrade (Q2) |

## 5. Copy (minimal, ar first; reviewed with /slopmonster)

Basel's ticket asks for a warm message (understanding, congratulations, good luck, gift, next month). The newer rule
(2026-11-26, all projects) is "only what the person needs to proceed". Proposed, as a compromise to confirm (Q5):

- en: **"Congratulations: 50 invoices this month."** / "This month, issue as many as you need. From 1 January the limit is 50; past it, you'll need a bigger plan." / [Continue]
- ar: **«مبروك: 50 فاتورة هذا الشهر.»** / «هذا الشهر أصدر ما تحتاج. من 1 كانون الثاني يعود الحد إلى 50، وبعده تحتاج خطة أكبر.» / [متابعة]
- Hard cap: the existing `PlanLimitNotice` line + date + Upgrade to <plan>.

## 6. Migrations

**None.** The three gift columns exist (`20261125230000_mut735_usage_metering`). If Q1 is answered "the gift lifts both meters", `overCapGiftMeter` simply stops being read (no schema change).

## 7. Config and release

`PAID_HARD_CAPS` (default false; Terraform `paid_hard_caps`). Turn on only after: the paid plans are sellable (`PLAN_CHECKOUT`), MUT-734's plan change is live (otherwise a subscriber at the cap can't upgrade; Checkout refuses `ALREADY_SUBSCRIBED`), and the phone build with the gift sheet is live.

## 8. Dependencies

- Needs MUT-734 live before the flag goes on (the upgrade path for a subscriber). Build can go first.
- MUT-754 (portal usage lines for Business, attention tone from 90%) overlaps AC5: build the shared meter rows once. Recommend MUT-754 is folded into this ticket's portal slice, or built first and reused.
- MUT-706 (phone) carries the phone half.
- MUT-704: close its soft-cap / move-up parts as superseded; keep its business-count and partner caps for paid plans (MUT-734 needs the business count, see that plan).

## 9. Tests (written first)

1. `gift.test.ts`: covers / available across month boundaries, meters, plans (starter never, freelancer never).
2. `caps.test.ts`: `hardCapOf` per plan with and without the flag and the gift; boundary cap−1, cap, cap+1.
3. Route `issuing`: paid at cap → 409 with `gift: available`; after the gift → 201 ×N; next month → 409 without gift; receipt on an existing doc never refused; upgrade (scripted plan) lifts.
4. Route `over-cap-gift`: early (not at cap) → GIFT_NOT_AVAILABLE; twice → GIFT_USED; idempotent same meter/month; partner acting → owner's marker; Starter → GIFT_NOT_AVAILABLE.
5. Scans start/complete with gift; `documents-due` Issue all returns `gift`.
6. `test:db`: concurrent accept (×5) leaves one marker.
7. Portal: `PlanLimitNotice` gift variant, retry of the held request, Issue drawer pre-open state, usage lines 80/90/graceUntil.

## 10. QA scenarios (release-QA, `qa/features/portal/billing.yaml`, `portal/issuing.yaml`)

| id | Steps | Outcome |
|---|---|---|
| `portal.paid-cap-gift` | On Solo with 50 invoices this month, issue another | Gift message; Continue; it issues; two more issue |
| `portal.paid-cap-hard-next-month` | Seeded: gift used last month, 50 issued this month, issue another | Refused, reset date, Upgrade to Business |
| `portal.paid-cap-other-meter` | Gift used on invoices this month; scan the 101st receipt | Refused (no second gift) |
| `portal.paid-usage-nudge` | 45 of 50 | Usage line with Upgrade to Business |
| `portal.paid-cap-upgrade-lifts` | At the hard cap, upgrade to Business (MUT-734) | The invoice issues |

## 11. Knowledge updates on build

New ADR "Paid plans' monthly caps are hard after one gift per account" (supersedes MUT-704's soft caps and move-up rule; amends ADR-275 d4 wording "soft caps", ADR-281 d9 now written). ADR-284 d1 note (`HARD_CAP_PLANS` widened). COMPONENT_REGISTRY (`PlanLimitNotice` gift variant), CHANGELOG, TEST_PLAN, privacy draft (MUT-732: the gift marker is account data), before-release (flag order).

## 12. Questions only Basel can answer

1. **During the gift month, is only the meter that was hit unlimited, or both?** [Default: only the one hit; the other keeps its cap and, since the gift is used, is a hard cap.]
2. **Firm at its cap after the gift** has no plan to move to. Hard cap (no invoices until the 1st), or Firm stays soft (counted, never refused)? [Default: Firm soft; it is the top plan and a firm unable to invoice for weeks is a support case.]
3. **A partner hits the owner's cap:** may the partner accept the owner's once-ever gift? [Default: yes; it is the same business.]
4. **Operator-provisioned firms with no owner** (`org:` meters): capped at all? [Default: never capped.]
5. **Copy:** the short version in §5 vs the warm, longer message in the ticket (the 2026-11-26 minimal-copy rule came after it). [Default: the short version.]
6. **Mails:** any mail at 80% / 90% / at the cap, or in-app only? [Default: in-app only; MUT-704's 80% mail dropped.]
7. **Legacy no-card trials still running** (Business limits): hard-capped like Business, or never capped? [Default: never capped; they end within 14 days of Starter's release.]
