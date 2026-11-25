# MUT-731 + MUT-736: the free Starter plan «البداية», and invoicing for everyone with the Tax Authority connection on paid plans only

Status: **planned, not built** (2026-11-25). Epic MUT-701. Planned together because Starter's whole point is free invoicing (MUT-736 opens issuing to everyone; MUT-731 caps it).
Depends on **MUT-735** (the counter, `mut-735-usage-metering.md`, slices S1+S2). Ships only when the paid plans can be bought (Basel, comment 13532): MUT-702 Part B (held for MUT-700, the seller) and MUT-705's plan picker. Built dark behind `STARTER_PLAN` until then.
Test plan: `mut-731-736-starter-plan-tests.md`.

```
Tracker: Jira · barmajiyat.atlassian.net · MUT via atlassian-barmajiyat · Backlog = not committed · this skill may set Planned · finished → In Review
```

## 0. Neighbourhood and the decisions this plan follows

Basel's decisions (MUT-731 comments 13532, 13534, 13540; MUT-736 description), authoritative:

| Topic | Decision |
|---|---|
| Name | Starter, Arabic «البداية» (خطة البداية) |
| Limits | 1 business + the personal profile, no partners, 3 issued invoices a month, 12 receipt scans a month |
| Caps | Every Starter limit is a **hard cap**: blocks, and always offers to upgrade |
| Invoicing | On for everyone, every business profile, every plan (MUT-736). The `invoicing` grant is retired, kept only as a kill switch |
| Tax Authority | The automatic connection is paid plans only. Starter issues ₪5,000+ invoices by typing the allocation number by hand (MUT-711's panel) with an upgrade hint. Replaces "blocked at ₪5,000" (13532) |
| Sign-up | New accounts land on Starter (the review removal itself is MUT-737) |
| Paid trial | Paid plans keep a 14-day **Solo** trial, card up front; not continued → Starter (13540 Q1) |
| Failed card | After the grace period → Starter (13540 Q2) |
| Cancel | → read-only (as today); the read-only screen offers "Continue free on Starter" (13540 Q3) |
| Downgrade | → Starter or a lower plan at the end of the cycle, no refund; upgrade now, pro-rata (MUT-734) |
| Trials running today | Become Starter at their end, instead of read-only and locked |
| Over-cap gift (MUT-733) | Still open: **not planned**, a hook only |

Sibling state: MUT-702 Part A merged (ADR-275); Part B In Progress, held. MUT-704 (limits) is replaced in part by MUT-733 and shares the "read-only businesses past the plan's count" rule, which this plan builds generally and switches on for Starter only. MUT-734 (plan changes), MUT-737 (open sign-up), MUT-732 (legal texts, unpublished drafts) all Backlog.

**Blocker gate:** MUT-735 is not built. This plan is written against its brief (same branch) and every cap call is marked `requires MUT-735 S1/S2`. MUT-702 Part B blocks only the release and the "Try Solo with a card" slice, not the build.

## 1. Acceptance criteria (both tickets, merged)

MUT-731:
1. With `STARTER_PLAN` on, a person with nothing else covering them (no subscription, grant, Malafat or running trial) is **ACTIVE on Starter**, not read-only.
2. Starter's limits are enforced as hard caps: a 2nd business, any partner, a 4th counted document in a Jerusalem month, a 13th scan. Each refusal is `409 PLAN_LIMIT` naming the limit, the reset date where there is one, and the next plan (Solo).
3. New sign-ups start on Starter (no `trialStartedAt`). Trials running at release continue, then become Starter. Accounts already read-only or locked after an unpaid trial become Starter.
4. A Solo trial with a card (14 days) that is not continued drops to Starter; a failed card past grace drops to Starter; a cancelled paid plan goes read-only and offers "Continue free on Starter".
5. A Starter person with more than one business sees the extras read-only (visible, exportable) and can choose which one stays active.
6. Trial mails, the trial banner and the "trial started" step no longer appear for anyone new; the remaining copy says what happens next (Starter).
7. Portal and phone show Starter and this month's usage (ar + en); terms and privacy drafts describe Starter (with MUT-732).

MUT-736:
8. Issuing is reachable for a brand-new Starter account with no operator action (`INVOICING_FOR_ALL`).
9. Tax Authority connect and automatic allocation refuse on Starter with `PLAN_LIMIT` (limit `taxAuthority`) and an upgrade offer; allowed on Solo and above.
10. A Starter invoice at or over the threshold requires a manual allocation number (format-validated), stored (`allocationSource MANUAL`) and printed exactly like an automatic one.
11. A downgrade to Starter suspends the connection (never deletes it); an upgrade resumes it without a new setup (unless the Tax Authority's own token expired meanwhile, §7).
12. Portal and phone copy, ar + en. Terms and help text name the plans with the connection.

## 2. The lifecycle, in one table

`resolveEntitlement` (pure, `billing/entitlement.ts`) rules after this change, first match wins. New or changed rows marked ★. `STARTER_PLAN` off keeps today's rules exactly (rows ★ fall back to the old result).

| # | Facts | Result |
|---|---|---|
| 1 | Malafat connected | ACTIVE, MALAFAT (unchanged) |
| 2 | Live operator grant | ACTIVE, OPERATOR, grant tier (unchanged) |
| 3 | Covering subscription (active, trialing, past_due) | ACTIVE / GRACE, STRIPE, its tier. A card-up-front Solo trial is `trialing` → ACTIVE SOLO (unchanged rule) |
| 4 | Legacy no-card trial running (`trialStartedAt + 14 d`) | ACTIVE, TRIAL, BUSINESS (unchanged; only people who started before release) |
| 5 | Pause running (MUT-532) | READ_ONLY paused (unchanged) |
| 6 ★ | Anything else, with an owner, **except** row 7 | **ACTIVE, STARTER**. Covers: a card-up-front trial that was not continued, a failed card past grace, a legacy trial that ended (was READ_ONLY to day 30, then LOCKED), and nothing at all (was READ_ONLY NONE) |
| 7 | The **most recently ended** lapsed profile-plan subscription (by `endedAt`, not by rank) has `endedReason = cancellation_requested`, ended after its trial (`endedAt > trialEnd + 1 day`, or no trial), and the person has **not** chosen Starter since (`starterChosenAt` null or before that subscription's `createdAt`) | READ_ONLY, STRIPE (today's cancel behaviour); the screen offers Continue free on Starter |
| 8 | No owner (operator-provisioned firm) and nothing covers it | READ_ONLY, NONE (unchanged: no person to be on Starter) |

Eng review #3/#4/#20 collapsed the first draft's five rows into "Starter unless the latest lapse was a deliberate cancel after paying, with no Starter choice since". Details:
- `endedReason` null (a row the reconcile hasn't refreshed yet) reads as a deliberate cancel: today's read-only, never a silent free plan.
- Stripe's own `paused` status (a trial that ended with no payment method; `pausedFrom` null in our mirror) is a never-paid trial → Starter.
- The `+ 1 day` tolerance covers Stripe ending a trial cancelled at period end seconds after `trial_end`.
- `starterChosenAt` is compared with **that** subscription's `createdAt`, so MUT-734's downgrade-to-Starter (which sets it at scheduling time, before the end) applies, and a choice left from an older subscription doesn't apply after a later re-subscribe and cancel.

Then a **post-pass** (★, pure function `applyBusinessCap` in `billing/business-cap.ts`, **called inside `coverage.ts` `entitlementsWithFactsFor`**, so the gate, `/v1/me`, `/v1/billing`, the come-back and monthly-summary readers, `agentWriteGate`/`agentReadRefusal` and `gatePathProfile` all see the same answer; eng review #6): for each owner whose plan (`currentPlanOf`) has a business cap in `ENFORCED_BUSINESS_CAPS` (Starter only in this ticket; MUT-704 adds the paid plans), the owner's created business profiles beyond the cap become `READ_ONLY` with `planLimit: true`. When the gate resolves a single profile (`auth/billing-gate.ts` `entitlementOf`), the loader widens to the owner's created profiles only if the owner resolves to Starter: one extra indexed read on `ownerUserId`, for Starter owners only. Profiles covered by Malafat or by an organization-scoped grant or subscription are not counted. Which stay active: `User.activeBusinessIds` if set; else the most recently used (MUT-701's rule), computed **once** (one grouped read of the latest audit event per profile) and **persisted** to `activeBusinessIds`, so the hot path never scans and the answer never moves under the person. The personal profile never counts and is never read-only for this reason.

LOCKED is no longer produced with `STARTER_PLAN` on. The state stays in the types and the gate (the flag can be turned off), and its removal is a cleanup ticket once the flag is permanent.

Mapping to Basel's wording: "trial not continued → Starter", "failed card after grace → Starter" (grace itself is row 3's GRACE + `PERIOD_GRACE_DAYS`) and "trials running today become Starter" are row 6; "cancel → read-only, offers Starter" is row 7, then row 6 once chosen; "downgrade to Starter" (MUT-734) schedules the cancel at period end **and** sets `starterChosenAt` at scheduling time, so row 6 applies at the end with no read-only gap.

## 3. Design

### 3.1 `plans.ts`: Starter as rank 0

- `FREE_PLAN = 'starter'`; `AnyPlanName` gains it; `ProfilePlanTier` gains `'STARTER'`; `RANK.STARTER = 0`; `TIER_OF.starter = 'STARTER'`.
- `PLAN_LIMITS.starter = { businesses: 1, partners: 0, documentsPerMonth: 3, scansPerMonth: 12 }`.
- `PLAN_FEATURES: Record<AnyPlanName, { taxAuthority: boolean }>`: false for starter, true for solo, business, firm and legacy freelancer.
- `HARD_CAP_PLANS = new Set(['starter'])`: the plans whose monthly meters refuse at the cap. The paid plans join with MUT-733 (its gift hook reads `usage_counters.graceUntil`). `capPolicy(plan, meter, counter)` returns `{ cap: number | null }` today; MUT-733 extends it.
- `nextPlanAbove('STARTER') = 'solo'`; `changeTimingOf('STARTER', any paid) = 'now'` (falls out of RANK).
- `PLAN_NAMES` (on sale) is unchanged: Starter is never sold, so Checkout, the catalog and offers never see it.
- `currentPlanOf` treats STARTER like any covering tier. A person with one paid profile and Starter elsewhere is on the paid plan (highest rank).

No Prisma enum change: STARTER is never stored as a subscription or grant tier (operators grant paid plans; the free plan is the fallback). The API schemas gain it: `ProfilePlanTierSchema` + STARTER, `currentPlan` + `starter`, `EntitlementSource` + `STARTER`, `BillingEntitlement.planLimit?: boolean`. Additive. Flutter's `BillingTier.tryParse` returns null for an unknown tier and old builds keep working.

### 3.2 Entitlement facts and the mirror

- `BillingSubscription` gains `endedReason varchar(32) null` (Stripe `cancellation_details.reason`: `cancellation_requested`, `payment_failed`, `payment_disputed`) and `trialEnd timestamptz null`. `endedAt` **already exists** (MUT-534, mirrored at `stripe/mirror.ts:98`); `SubscriptionFact` and `factsFor`'s select gain `endedAt`, `trialEnd`, `endedReason` and `createdAt` (eng review #2). `stripe/mirror.ts` maps the new two; the nightly reconcile fills them for existing rows (until filled, `endedReason` null reads as a deliberate cancel: row 7, today's behaviour).
- `User` gains `starterChosenAt timestamptz null`, `activeBusinessIds uuid[] null`, `paidTrialUsedAt timestamptz null` (one Solo trial per person).
- `BillingFacts` gains `starterChosen: Map<ownerId, Date | null>`; `factsFor` reads it with the trial starts (same query).
- `resolveEntitlement(profile, facts, now, { starter: boolean })`: the option comes from config (`STARTER_PLAN`) through `coverage.ts`, so the pure function stays pure and both paths are tested.

### 3.3 Enforcement: where each cap lives (one door each)

| Limit | Door | How |
|---|---|---|
| Documents (3/month) | `routes/issuing.ts` `issueOne` → `store.issuing.issue` | Passes `input.usage = { subjectKey, month, plan, door, cap }` (MUT-735); `issueTx` does the conditional counter upsert in the issue transaction; `cap_reached` → `PLAN_LIMIT`. Covers single issue, Issue all and the phone, which all go through `issueOne` (MCP has no issuing tools). Issue all (`routes/documents-due.ts:198-206`) today keeps going after a refusal and keeps only a reason string: it changes to **stop at the first `PLAN_LIMIT`**, mark the remaining items refused, and `IssueDueResultSchema` gains `limit` (eng review #15). |
| Scans (12/month) | `expenses/receipts-compose.ts` `completeLibraryReceipt` / `completeOnExpense` (counted), the two starts (unlocked pre-check) | Counted at complete, in the UPDATE that marks the receipt READY (MUT-735 §2.2). Never for a Malafat API key or a MALAFAT-sourced profile (ADR-160 d4). |
| Businesses (1) | `routes/profiles.ts` `POST /v1/profiles`; `/v1/me` `limits.maxOwnedProfiles` (`me.ts:146`) | `ownedProfileCap` becomes plan-aware: Starter → personal + 1; others keep `MAX_OWNED_PROFILES` (6) until MUT-704; `/v1/me` publishes the same number. Over → `PLAN_LIMIT` (limit `businesses`); the old `CONFLICT PROFILE_LIMIT` stays for the 6-cap. QA override (`QA_MAX_OWNED_PROFILES`) unchanged. The signed-out local app (`plans: false`) keeps 6. |
| Partners (0) | `routes/admin-users.ts` grant owner (an `/admin` route, the only way to add a co-owner today) | Refuses when the creator is on Starter: `CONFLICT`, `details.reason PLAN_LIMIT`, `limit partners` (no upgrade button: the operator reads it; eng review #22). Existing partners of someone who drops to Starter are kept (Q3). |
| Tax Authority | `routes/tax-authority.ts` connect, callback, allocation-decisions; `routes/issuing.ts` `allocationMode` and the issue | §3.5 |
| Extra businesses | the lapse gate (`gateSelectedProfile`), via the post-pass `planLimit` READ_ONLY | Writes refused with 402 `SUBSCRIPTION_LAPSED`, `details.reason: 'PLAN_LIMIT'`, so every client's existing read-only handling applies (old phone builds show their generic read-only message). `lapsedError` gets its own message for it (not "its plan has ended"), and `billing:uncovered` (ADR-181 d7) leaves these profiles out (eng review #21). |

The plan is the **payer's**: `usage/plan-of.ts` (MUT-735) `payerPlanOf` runs `currentPlanOf` over the payer's own profiles, only on capped actions. Malafat-entitled profiles, Malafat API keys and Malafat writes have no plan and no caps.

**The error.** New code `PLAN_LIMIT`, HTTP 409 (not 402: 402 is the lapse gate's, and the portal and phone treat it as "plan ended"):
```jsonc
{ "code": "PLAN_LIMIT", "details": {
  "limit": "documents" | "scans" | "businesses" | "partners" | "taxAuthority",
  "plan": "starter", "used": 3, "cap": 3, "resetsOn": "2027-01-01",   // monthly meters only
  "nextPlan": "solo",
  "canUpgrade": true      // a paid plan can be bought on this server now (Checkout configured)
}}
```
`errors.ts` + `ERROR_CODES` + OpenAPI; portal `serverErrorCodes.ts`; phone `errors.dart`. **`idempotency.ts` releases the key on `PLAN_LIMIT`** (nothing was done), so the same request succeeds after an upgrade or the reset. Released phones treat an unknown 409 as terminal (`errors.dart:347`, `api_client.dart:702`) and the outbox would mark a capture failed, so **the phone build that knows `PLAN_LIMIT` ships before `STARTER_PLAN` goes on** (eng review #10).

### 3.4 Invoicing for everyone (MUT-736)

- Config `INVOICING_FOR_ALL` (`true|false`, default `false` in code; `true` in the production tfvars at release; the before-release block says so).
- `issuing/invoicing-on.ts` gets the one rule, and `routes/issuing.ts` `issuingProfileOf` calls it instead of `hasFeature` directly: business profile, not Malafat, has an owner, and (`INVOICING_FOR_ALL` **or** the owner's `invoicing` grant). Off is the kill switch: the server falls back to grants, which still work.
- `/v1/me` `user.features` includes `invoicing` when `INVOICING_FOR_ALL` is on, so the portal (`invoicingWorthAsking`) and every shipped phone build (`invoicing_providers.dart` reads the same list) open issuing with no client release.
- MUT-710's two-step gate for issuing stays (`TWO_FACTOR_ISSUING_GATE_ENABLED`): a Starter person sets up two-step before their first invoice. Noted for MUT-737's onboarding copy.
- The operator console's Features section keeps the `invoicing` toggle, labelled "only used while invoicing is off for everyone".

### 3.5 The Tax Authority connection on paid plans only

- `GET /v1/issuing/tax-authority` gains `plan: { allowed: boolean, nextPlan: 'solo' | null }`; with a connection on Starter its `state` reads `suspended` (new value) and nothing is deleted.
- `POST …/connect`: Starter → `PLAN_LIMIT` (limit `taxAuthority`). The callback is public and redirects (`routes/tax-authority.ts:96-121`), so on Starter it stores nothing and redirects with a new outcome `taxAuthority=plan`. `DELETE` (disconnect) always works.
- `POST /v1/issuing/allocation-decisions` (a held number's decision): needs the connection, so the same refusal.
- `allocationMode`: MANUAL when the plan has no `taxAuthority`, whatever the connection says. The preview's `allocation` gains `automaticOn: 'solo' | null` so both clients can show the hint.
- `issueOne`: the manual branch generalises from `needs && !tax.deps` to `needs && (!tax.deps || !planAllowsTaxAuthority)`, so a Starter issue never reaches the automatic allocator or `withoutAllocation`'s `reportDecision` (eng review #16). Without a typed number → `409 CONFLICT`, `details.reason ALLOCATION_NUMBER_REQUIRED` (as with the Tax Authority off, ADR-273 decision 2), `details.next` and `details.automaticOn: 'solo'`. A typed number goes through `manualAllocator` exactly as today: same normalization, same `forNumber` check, `allocationSource MANUAL`, same PDF.
- `israel/tax-authority/reconnect-reminder.ts` (connection-expiring mails) skips Starter connections.
- Resume on upgrade is automatic: nothing was changed, so the next request on a paid plan reads the connection as connected (if the Tax Authority's own refresh token is still valid, §7).

### 3.6 Sign-up, trials and mails

- No new no-card trial anywhere with `STARTER_PLAN` on (eng review #5): `auth/self-service.ts` `signupAccountOutcome` (`trialStartsAt: null` on every branch), the signup-review approval (`repositories/prisma.ts:4198`, `memory.ts:4674`) and `billing.setTrialStart` behind MUT-418's trial prompt (`prisma.ts:3746`). (MUT-737 removes `PENDING_REVIEW`; the two land in either order.)
- Malafat sign-in accounts: nothing to do; with no trial they resolve to Starter (row 6).
- **The Solo trial with a card** (slice S6, needs MUT-702 Part B): `POST /v1/billing/checkout-session` with `plan: 'solo', trial: true` → Checkout `subscription_data.trial_period_days = 14`, `payment_method_collection: 'always'`; refused when `User.paidTrialUsedAt` is set (`TRIAL_USED`); set on the mirror's first `trialing` row. Provider-neutral shape in `checkout.ts`, the Stripe call behind `CheckoutGateway`.
- Trial mails (ADR-184, `billing/trial-mail.ts`): with Starter on, the day-27 "locked soon" stage is dropped and the day-11 and end stages say "then you move to free Starter" (ar + en). The "trial alone decides the account" check (`trial-mail.ts:157`) treats source STARTER like TRIAL, or the end mail would never send (eng review #12).
- Monthly summary mail (`monthly-summary-mail.ts:97` sends to ACTIVE/GRACE profiles): Starter people become recipients. Default: send it to them (it is the usage mail Starter exists to encourage) and check the Resend daily budget (`MONTHLY_SUMMARY_DAILY_SENDS`) before the flag goes on (eng review #13, Q8). The stages only find legacy trials, so they go quiet within 14 days of release; the job's removal is the cleanup ticket.
- Card-failed mail (MUT-533): the last line says the account moves to Starter after the grace period, not read-only.
- The cancel confirmation (MUT-532): says read-only and offers Starter.
- Mail copy is reviewed with /slopmonster (warm, not salesy), ar + en.

### 3.7 New endpoints

| Endpoint | Gate class | What |
|---|---|---|
| `POST /v1/billing/starter` | open | "Continue free on Starter": sets `starterChosenAt = now`. Idempotent. 409 `NOTHING_TO_LEAVE` when a covering subscription is active (use the plan change, MUT-734). |
| `PUT /v1/billing/active-businesses` | open | `{ organizationIds }`: which businesses stay active when over the plan's count. Validates count = cap and that the person created each. Audit row. |
| `GET /v1/billing` | open | Gains `usage` (MUT-735), `currentPlan: 'starter'`, `starter: { chosenAt, canContinueFree }`, `activeBusinesses: { cap, chosen, readOnly: [ids] }`. |

Both new routes go into `PERSON_LEVEL_GATE` (the classification test fails otherwise).

### 3.8 Portal (`src/hosted`)

Follow DESIGN.md: drawers, one quiet line, no new page.

| Where | Change |
|---|---|
| `components/PlanLimitNotice.tsx` (new, registered) | Renders a `PLAN_LIMIT` error from its details: what was reached, when it resets, "Upgrade to Solo" (opens Billing's plan step; MUT-705 builds the picker, until then the existing Subscribe step) or, with `canUpgrade` false, no button. Used by the issue drawer, the receipt upload, `ProfileCreateDrawer`, the Tax Authority connect step. `hp-banner` recipe, no new styles. |
| `BillingDrawer.tsx` | Starter headline "You're on Starter, free"; usage lines "Invoices 2 of 3 this month · Scans 7 of 12" (reset date in Levantine Arabic); "Choose which business stays active" when over; the plan step opens from here. |
| `LapseGate.tsx` | READ_ONLY after a cancel: a second action "Continue free on Starter" (`POST /v1/billing/starter`, then refetch `/v1/me`). A `planLimit` read-only business: "This business is read-only on Starter. Choose which business stays active, or upgrade." |
| `TrialBanner.tsx` | Legacy trials only: "N days left of your trial, then free Starter". Nothing for Starter people. |
| `data/trialPrompt*.ts` (MUT-418 step) | Not shown with no trial. MUT-737 replaces it with Try Solo / Stay on Starter. |
| Manual allocation panel (MUT-711) | On Starter, one line: "Connect to the Tax Authority to get numbers automatically, on Solo." |
| `/p/$id/you/invoicing` connect step | On Starter: "The Tax Authority connection is on Solo and above" + Upgrade; a suspended connection says it resumes on upgrade. |
| `pages/operator/OperatorBillingSection.tsx` | Shows Starter and usage (MUT-735's section). |
| `profileApiErrors.ts`, `expenseApiErrors.ts`, `incomeApiErrors.ts`, issuing errors | Map `PLAN_LIMIT` to `PlanLimitNotice`. |
| `local/carryOver/mapFreeAppBackup.ts:27` (`MAX_CARRIED_BUSINESSES = 5`) | Carry-over from the free app keeps carrying every business (default, Q9): nothing is left behind; on Starter the post-pass makes the extras read-only and the person picks the active one. The server's carry-over receive path is exempt from the business cap (eng review #9). |

i18n (ar + en, Arabic first): `hosted.plan.starter.*`, `hosted.planLimit.{documents,scans,businesses,partners,taxAuthority}.*`, `hosted.billing.usage.*`, `hosted.billing.starter.*`, `hosted.lapse.continueStarter`, `hosted.issuing.allocation.automaticOnSolo`. Plan name «البداية» (MUT-701's naming list: Solo «مستقل», Business «تجاري», Firm «مؤسسة»).

Analytics (opt-in, anonymous, `docs/analytics/events.json` minor bump): `plan_cap_reached { limit }`, `plan_upgrade_offered { limit }`, `plan_upgrade_chosen { from: 'starter', to }`, `starter_continue_chosen`. See MUT-735 §2.9 for why not server-side.

### 3.9 Phone (Flutter, `mutaba3a-flutter/mutaba3a`), its own branch in that repo

The phone sells nothing (`billingLinkOut` off). It names the plan, shows usage and explains refusals.

- `lib/domain/models/billing.dart`: `BillingTier.starter`, `EntitlementSource.starter`, `planLimit` on the entitlement, `BillingUsage` from `/v1/billing.usage`.
- `billing_screen.dart` / `billing_view.dart`: headline «خطة البداية» / "Starter (free)"; usage lines; read-only-business reason.
- `core/errors.dart` + `api_client.dart`: parse `PLAN_LIMIT` (409) into a typed error; one `PlanLimitSheet` used by the issue sheet, the capture/receipt upload and profile creation: what was reached, the reset date, and "Plans are managed in your MTB3A account on the web" (no link, no price, store rules; Q4).
- The MUT-711 manual allocation panel: the same "automatic on Solo" line, without a link.
- Issuing opens by itself (server adds `invoicing` to `features`), so no phone change is needed for MUT-736's AC1.
- ARB keys ar + en; `qa/features/ios/billing.yaml` and the issuing flow re-recorded on the shared "QA iPhone" only where they change.
- Order: server first (additive), then the phone build. Old builds: a `PLAN_LIMIT` shows their generic conflict message; the plan headline shows nothing for an unknown tier. Acceptable for the short window.

### 3.10 Legal and help text

The unpublished drafts (MUT-732, ADR-279 branch): the terms' trial, cancellation and billing sections describe Starter (free, its limits), the Solo trial with a card, the drop to Starter after a failed payment, read-only after a cancel with the free option, and that the Tax Authority connection is on Solo and above. Both languages. They publish with MUT-732, not here; this plan only edits the drafts. Help text in the invoicing setup says the same.

## 4. Data model and migration

One migration `…_mut731_starter` (after MUT-735's):
- `billing_subscriptions`: `endedReason varchar(32) null`, `trialEnd timestamptz null` (`endedAt` exists already).
- `users`: `starterChosenAt timestamptz null`, `activeBusinessIds uuid[] null`, `paidTrialUsedAt timestamptz null`.
- No data migration. Everything new is derived at read time, so turning `STARTER_PLAN` on or off moves people between today's states and Starter with nothing to undo.

Additive only. Warn the orchestrator before merging (dev API restart).

## 5. Config

| Var | Default in code | Production at release |
|---|---|---|
| `STARTER_PLAN` | false | true, released with MUT-702 Part B + MUT-705, **after** the phone build that parses `PLAN_LIMIT` is live |
| `INVOICING_FOR_ALL` | false | true (may go on earlier than Starter: Basel's call, Q6) |

Both validated in `config.ts`, documented in `.env.example`, set in the Terraform tfvars, listed in `docs/operations/before-release.md`.

## 6. Build order (slices)

Requires MUT-735 S1 (ledger, counter upsert) and S2 (`/v1/billing.usage`).

1. **S1 Plans and entitlement (server, pure).** `plans.ts` Starter row, features, `HARD_CAP_PLANS`; `resolveEntitlement` rows 6–8 behind the option; the business-cap post-pass; migration; mirror fields. Tests first.
2. **S2 Invoicing for all + Tax Authority on paid plans (MUT-736 server).** `INVOICING_FOR_ALL`, `invoicingOn` single rule, `/v1/me` features, tax-authority refusals, `allocationMode`, `ALLOCATION_NUMBER_REQUIRED` with `automaticOn`, reminders skip. Independent of Starter; can ship first if Basel wants (Q6).
3. **S3 Caps at the doors.** Documents, scans, businesses, partners; `PLAN_LIMIT`; Issue all partial answer.
4. **S4 Starter endpoints and copy.** `/v1/billing/starter`, `active-businesses`, `/v1/billing` fields; sign-up `trialStartsAt: null`; trial, card-failed and cancel mail copy.
5. **S5 Portal.** `PlanLimitNotice`, Billing, LapseGate, TrialBanner, allocation hint, connect step, error maps, analytics events, i18n. Release-QA features and specs.
6. **S6 Solo trial with a card.** Checkout `trial: true` (needs MUT-702 Part B; provider per MUT-700).
7. **S7 Phone.** Flutter branch (§3.9).
8. **S8 Legal drafts + help text + docs.** MUT-732 drafts, ADRs, SYSTEM_OVERVIEW §8, before-release block (flags, order: API with flags off → web → phone → flags on together with Part B).

Cleanup ticket afterwards: remove TRIAL rows, LOCKED, the trial mail job and the trial banner once no legacy trial is left; drop the `STARTER_PLAN` flag.

## 7. Risks

| Risk | Handling |
|---|---|
| Starter changes the meaning of "nothing covers you" for every existing account at once | Behind `STARTER_PLAN`; a dry-run operator script `billing:starter-preview` lists who moves from READ_ONLY/LOCKED/NONE to Starter and who gets read-only businesses, before the flag goes on. |
| A lapsed row with `endedReason` not yet mirrored stays read-only (row 7) when it should be Starter | The reconcile fills it; the preview script lists rows with null reason so the operator runs `billing:reconcile` first. |
| Default "most recently written" active business picks the wrong one | The person can change it any time; the dry run shows the default per person. |
| Tax Authority refresh token expires while suspended | On resume the status reads expired and asks to reconnect (today's expired path). AC11's "no new setup" holds only within the token's life; stated in help text. |
| Co-owned business of a Starter creator: partners keep writing for free | Q3. Default keeps them (no lock-out); counted against the creator's meters. |
| Free plan abuse (many accounts) | Sign-up abuse controls stay (Turnstile, rate limits, email verification, MUT-737); caps are per account and the OCR cost is capped at 12 scans. |
| Issue all stops halfway | The answer lists what was issued and what was refused; nothing issued is undone (documents are immutable). |
| Clients without a Starter-aware build | All fields additive; `PLAN_LIMIT` falls back to a generic message; read-only businesses reuse the lapse code. |

## 8. Cost

- Free accounts cost OCR (12 scans/month cap: the server reader's per-page cost × 12 per active Starter person) and Postgres rows; issued PDFs are signed (signing has a per-signature cost only if the time-stamp authority charges; check the TSA contract before release, recorded in before-release.md).
- Mail: Starter adds no new recurring mail. The Resend daily cap (shared with the monthly summary) is unchanged.
- No new infrastructure.

## 9. Knowledge updates on build

ADRs (numbers at merge): **Starter is the fallback plan** (amends ADR-160 point 3 and ADR-181: unpaid trials no longer lock; a failed payment drops to Starter; supersedes ADR-184's day-27 stage), **Invoicing for everyone; the Tax Authority connection is a paid-plan feature** (amends ADR-260 D1 and ADR-196's `invoicing` flag, extends ADR-273). Amend ADR-275 (Starter rank 0, limits row). SYSTEM_OVERVIEW §8, COMPONENT_REGISTRY (`PlanLimitNotice`, `business-cap.ts`), PATTERNS (none new beyond MUT-735's), TECH_DEBT (the legacy trial code until cleanup), TEST_PLAN, CHANGELOG, `docs/admin-panel/05-FEATURES.md`.

## 10. QA scenarios (release-QA)

Web (`qa/features/portal/billing.yaml`, `portal/issuing.yaml`, `portal/profiles.yaml`, `portal-selfservice/*.yaml`):
1. **portal.starter-home**: "Sign up with a Gmail address, set a password." Expect: Home on Starter; Billing says Starter, free, 0 of 3 invoices.
2. **portal.starter-invoice-cap**: "Issue three invoices this month, then try a fourth." Expect: the fourth is refused with "You've issued Starter's 3 invoices this month. They reset on 1 <month>." and Upgrade to Solo.
3. **portal.starter-scan-cap**: "Upload 12 receipts, then a 13th." Expect: refused, reset date, upgrade.
4. **portal.starter-second-business**: "Add a second business." Expect: refused, upgrade offer.
5. **portal.starter-manual-allocation**: "As Starter, issue a ₪6,000 tax invoice to a client with a VAT number; type the allocation number." Expect: issued, the PDF prints the number; the panel says automatic numbers come with Solo.
6. **portal.solo-automatic-allocation** (against the Tax Authority sandbox where available, else `manual: true`): "On Solo, connect to the Tax Authority, issue a ₪6,000 invoice." Expect: the number comes back by itself.
7. **portal.starter-connect-refused**: "As Starter, open the Tax Authority step." Expect: on Solo and above, Upgrade.
8. **portal.cancel-continue-starter**: "Cancel a paid plan; after its end, open the profile; choose Continue free on Starter." Expect: read-only first, then Starter, writable.
9. **portal.starter-choose-active-business**: "With two businesses on Starter, open the read-only one, choose it to stay active." Expect: it becomes writable, the other read-only.
10. **portal.trial-to-starter** (seeded legacy trial past its end): Expect: Starter, not locked.

Phone (`qa/features/ios/billing.yaml`, issuing): Starter headline and usage; the 4th invoice sheet; a Starter manual allocation. Recorded on "QA iPhone".

## 11. Open questions for Basel (default in brackets; the plan builds the default)

- **Q1** Which documents count toward Starter's 3 a month? [Tax invoices and invoice-receipts only. Receipts never count, because recording a payment on an invoice already issued makes a receipt and that must never be blocked; credit notes and payment requests never count either.]
- **Q2** People whose unpaid trial already ended (read-only or locked today) — move them to Starter on release day? [Yes.]
- **Q3** Someone with partners on a business drops to Starter (no partners). What happens to the partners? [They keep their access; nobody new can be added; their documents and scans count toward the creator's Starter limits.]
- **Q4** What can the phone say when a Starter cap is hit, given the store rules on linking to payment? [The limit and its reset date, plus "Plans are managed in your MTB3A account on the web", with no link and no price.]
- **Q5** Which business stays active by default when someone on Starter has more than one? [The most recently used; they can switch any time in Billing.]
- **Q6** May invoicing-for-everyone (MUT-736) go live before Starter, for today's trial and paid people? [Yes: it's independent and only removes the operator step.]
- **Q7** Can someone use the 14-day Solo trial after they were on Starter for a while, and only once ever? [Yes, once per person, any time.]
- **Q8** Should Starter people get the monthly summary mail? [Yes, it's the mail that brings people back; we check the daily mail budget first.]
- **Q9** Someone moves from the free app (carry-over) with 3 businesses and lands on Starter. [Carry all three; one stays active, the others are read-only until they choose or upgrade. Nothing is left behind.]

## Business / product impact
- A real free door: anyone can sign up and issue their first invoices at once, which is the sign-up and usage driver Basel asked for (13534), while paid plans keep the Tax Authority connection as their clearest reason to upgrade.
- Removes the harshest state in the product (locked after an unpaid trial) and turns every lapse except a deliberate cancel into a free plan, so fewer people are lost at the end of a trial or a failed card.
- Ships dark and switches on with the three paid plans (MUT-701, after MUT-700), so there is never a free tier without something to upgrade to.

## Eng review (2026-11-25, adversarial Plan agent; findings folded in above)

| # | Sev | Finding | Resolution |
|---|---|---|---|
| 1 | CRITICAL | Counting receipts blocks recording payments on issued invoices | Only 305 + 320 count (Q1) |
| 2 | CRITICAL | `endedAt` already exists (MUT-534); migration would fail; `SubscriptionFact` lacks it | Migration adds `endedReason`, `trialEnd` only; facts carry `endedAt`, `createdAt` |
| 3, 4, 20 | HIGH | Lifecycle rows contradicted MUT-734's timing, were brittle to Stripe's trial reporting, ranked by tier not recency | Collapsed to one rule + one read-only exception on the latest lapse; tolerance; native `paused` = never paid |
| 5 | HIGH | Trials also start on signup approval and from the MUT-418 prompt | All three gated |
| 6 | HIGH | The post-pass can't run in the single-profile gate; other readers would disagree | Runs in `coverage.ts`; widened only for Starter owners; default persisted |
| 7 | HIGH | Malafat API-key writes capped | Exempt (ADR-160 d4) |
| 8 | HIGH | Signed-out local app would land on Starter | `plans: false` for the local app |
| 9 | HIGH | Carry-over would leave businesses behind | Carry all; extras read-only (Q9) |
| 10 | HIGH | 409 stored by idempotency; old phones treat 409 as terminal | Key released; phone ships before the flag |
| 11 | HIGH | Scans at start | At complete |
| 12 | HIGH | Legacy trial "ended" mail would never send | STARTER counts as trial-alone there |
| 13 | HIGH | Starter people join the monthly summary mail | Q8; budget checked |
| 15 | MED | Issue all doesn't stop; MCP has no issuing | Stop on PLAN_LIMIT, `limit` in the result; claim removed |
| 16 | MED | `withoutAllocation` path, callback is a redirect, file name, error shape | Fixed in §3.5 |
| 17 | MED | Whose plan | The payer's, on capped actions only |
| 21, 22 | LOW | Read-only message, `billing:uncovered`, admin-route error | Fixed |

Not taken: moving S6 (Solo trial), S7 (phone) and S8 (legal drafts) to separate tickets. They stay as slices because Basel asked for the whole plan set at once (13532); S6 waits on Part B and S7 must ship before the flag.
