# MUT-731 + MUT-736 test plan: Starter, invoicing for everyone, the Tax Authority on paid plans

Brief: `mut-731-736-starter-plan.md`. TDD per slice. Node 22; targeted runs through `heavy --light`, full suites through `heavy`, `--maxWorkers=3`.

## Unit (pure)

**`billing/__tests__/plans.test.ts`**
- Starter: rank 0, `TIER_OF.starter`, limits 1/0/3/12, `taxAuthority` false; solo/business/firm/freelancer true.
- `nextPlanAbove('STARTER') = 'solo'`; `changeTimingOf('STARTER', p) = 'now'` for each paid plan.
- `currentPlanOf`: Starter alone → starter; Starter + Solo → solo; Starter + legacy Freelancer → freelancer (rank 1 > 0).
- `HARD_CAP_PLANS` has starter only; `capPolicy` returns the cap for starter meters, null for paid plans (until MUT-733).
- `PLAN_NAMES` (on sale) does not contain starter.

**`billing/__tests__/entitlement.test.ts`** (each row in brief §2, with `starter: true` and `false`)
- Rows 1–5 unchanged under both options.
- Row 6 → STARTER for each of: `canceled` + `payment_failed`; `payment_disputed`; status `unpaid`; a card-up-front trial cancelled before paying (`endedAt ≤ trialEnd`), and one ended 30 s after `trial_end` (the 1-day tolerance); Stripe's native `paused` (trial ended with no card, `pausedFrom` null); a legacy trial ended on day 15 and day 31; an owner with nothing at all. Option off → today's READ_ONLY / LOCKED / NONE for each.
- Row 7: a paid subscription cancelled by request → READ_ONLY; with `starterChosenAt` after that subscription's `createdAt` (including one set at scheduling time, before the end: MUT-734's downgrade) → STARTER; with `starterChosenAt` before that subscription's `createdAt` (an old choice, then re-subscribed and cancelled) → READ_ONLY.
- The **latest** lapse decides: an old `payment_failed` Firm row and a newer deliberate Solo cancel → READ_ONLY; the reverse order → STARTER (not decided by rank).
- `endedReason` null on a lapsed row → row 7 READ_ONLY (safe default).
- Row 8: no owner → READ_ONLY NONE.
- A covering subscription always wins over `starterChosenAt`.

**`billing/__tests__/business-cap.test.ts`**
- Starter owner with personal + 1 business → nothing read-only.
- Personal + 2 businesses, no choice → the less recently written is READ_ONLY `planLimit` and the default is persisted (a second resolve reads `activeBusinessIds`, no audit scan); with `activeBusinessIds` → the chosen stays.
- A Malafat-covered business and an organization-scoped-grant business are not counted.
- The gate (single profile), `/v1/me`, `/v1/billing` and `agentWriteGate` agree on which business is read-only (one test per reader).
- A choice naming a profile no longer owned is ignored; a choice of the wrong size falls back to the default.
- Personal profile never read-only for this reason.
- A paid plan owner (not in `ENFORCED_BUSINESS_CAPS`) → untouched.
- Co-owned profile the person did not create → not counted for them.

**`issuing/__tests__/invoicing-on.test.ts`**
- `INVOICING_FOR_ALL` on: business profile, no grant → on; personal → off; Malafat firm → off; no owner → off.
- Off: grant → on; no grant → off.

**Trial starts** (eng review #5)
- `signupAccountOutcome` with Starter on: `trialStartsAt` null on every branch; off: unchanged.
- Signup-review approval with Starter on → no `trialStartedAt` (prisma and memory).
- MUT-418 trial prompt's `setTrialStart` with Starter on → refused / no-op.

## Routes (memory store, `server/src/__tests__/`)

**Caps** (each at cap − 1, cap, cap + 1)
- Documents: Starter issues 3 tax invoices → the 4th is `409 PLAN_LIMIT` (`limit documents`, `used 3`, `cap 3`, `resetsOn`, `nextPlan solo`); at 3/3 a credit note still issues, and **paying a tax invoice (`payTaxInvoice`, which issues a receipt) → 201** (eng review #1); next Jerusalem month → allowed again (clock moved to 22:00 UTC on the last day).
- Issue all of 3 at 1/3 → 2 issued, then it stops: the 3rd is refused with `limit documents` in the result; nothing rolled back.
- Same Idempotency-Key replay of an issued document at 3/3 → the original 201, not a refusal.
- Refused at 3/3 → grant Solo → **the same Idempotency-Key** → 201 (the key was released, eng review #10).
- Two concurrent requests with the **same** key at 2/3 → one document, the other replays it (P2002 path), counter 3.
- Scans: 12 completed uploads → the 13th start is refused by the pre-check (`PLAN_LIMIT scans`); two uploads racing at 11/12 → both start, the second complete is refused; an abandoned (never completed) upload doesn't count; a repeated complete counts once; the per-expense complete counts the same meter.
- A Malafat API key starting and completing a receipt on a Starter owner's profile at 12/12 → allowed, recorded with plan `malafat`, counter unchanged (ADR-160 d4).
- Signed-out local app (`createLocalApp`, `plans: false`): a 2nd and 3rd business can be created; no `usage` written.
- Businesses: Starter `POST /v1/profiles` business #2 → `PLAN_LIMIT businesses`; Solo still capped at 6 by the old rule (until MUT-704).
- Partners: operator grant-owner on a Starter creator's business → `CONFLICT` reason `PLAN_LIMIT`, `limit partners`.
- A co-owner issuing on a Starter creator's profile is capped by the creator's counter.
- Malafat-connected profile → never capped.
- With `STARTER_PLAN` off → no caps anywhere (counter still records).

**Read-only businesses**
- A write on the non-active business → 402 `SUBSCRIPTION_LAPSED` `details.reason PLAN_LIMIT`; reads and the records export work.
- `PUT /v1/billing/active-businesses` swaps them; wrong count → 422; a profile not created by the person → 404; audit row written.

**Starter endpoints**
- `POST /v1/billing/starter` on a cancelled, read-only account → 200, then `/v1/me` shows STARTER ACTIVE; repeat → 200 unchanged; with an active subscription → 409 `NOTHING_TO_LEAVE`.
- `GET /v1/billing`: `currentPlan starter`, `usage`, `starter.canContinueFree`, `activeBusinesses`.
- `PERSON_LEVEL_GATE` classification test passes with the two new routes.

**Invoicing for everyone (MUT-736)**
- New account (no grant), `INVOICING_FOR_ALL` on → `GET /v1/issuing/setup` 200; off → 404.
- `/v1/me` `user.features` includes `invoicing` when on, even with no grant.
- MUT-710 gate still applies: issuing without two-step on a server with the gate on → its existing refusal.

**Tax Authority on paid plans**
- Starter: `POST /v1/issuing/tax-authority/connect` → `PLAN_LIMIT taxAuthority`; callback → redirect with `taxAuthority=plan`, nothing stored; a held number's `withoutAllocation` on Starter never calls `reportDecision`; `allocation-decisions` → same; `DELETE` → 204.
- Starter with an existing connection: `GET` → `state suspended`, `plan.allowed false`; nothing deleted (store row unchanged).
- Upgrade (grant Solo) → `GET` connected again with no new connect.
- Preview on Starter for a ₪6,000 tax invoice to a VAT customer → `allocation.mode MANUAL`, `automaticOn solo`, even with the Tax Authority on and connected.
- Issue on Starter without a number → `409 CONFLICT` reason `ALLOCATION_NUMBER_REQUIRED` with `next` and `automaticOn`; with a well-formed number → 201, `allocationSource MANUAL`; malformed → 422 `ALLOCATION_NUMBER_INVALID`; `forNumber` stale → 409 `ALLOCATION_NUMBER_MOVED`.
- Solo, connected → automatic allocation as today (existing MUT-572 tests stay green).
- Reminders job skips Starter connections.

**Mirror** (`billing/stripe/__tests__/mirror.test.ts`)
- Maps `cancellation_details.reason`, `trial_end`, `ended_at`; unknown reason stored as given (≤ 32 chars).

**Checkout trial (S6)**
- `plan solo, trial true` → the gateway gets `trial_period_days 14` and card collection always; a second trial → 409 `TRIAL_USED`; `trial` with business/firm → 422.

**Mail copy**
- Trial mail stages with Starter on: day-27 stage never selected; the end mail **is** selected for an ended legacy trial now resolving STARTER (eng review #12); day-11 and end copy mention Starter (ar + en snapshots).
- Monthly summary mail recipients with Starter on include Starter profiles (Q8 default). Card-failed and cancel copy snapshots.

## Postgres contract (`test:db`)

- Migration round trip: new columns nullable, `uuid[]` read and written.
- `factsFor` returns `starterChosenAt` in the same query (query count assertion).
- Counter race at 2/3 with two parallel issues → one 201, one `PLAN_LIMIT`, counter 3, one document (issue transaction rolled back for the loser, numbering has no gap).

## Portal (Vitest + RTL)

- `PlanLimitNotice`: each `limit` renders its copy in ar and en, the reset date in Levantine Arabic, Upgrade only when `canUpgrade`; RTL; numbers in `<bdi>`.
- Error maps: `PLAN_LIMIT` from income, expense/receipt, profile and issuing calls lands on the notice, not a generic toast.
- `BillingDrawer`: Starter headline, usage lines, choose-active control; legacy trial still shows the trial.
- `LapseGate`: cancelled read-only shows Continue free on Starter → calls the endpoint → refetches `/v1/me`; `planLimit` read-only shows its own words.
- `TrialBanner` hidden for Starter people.
- Allocation panel: the "automatic on Solo" line only when `automaticOn` is set.
- Connect step: Starter refusal state; suspended state.
- Carry-over on Starter: all businesses carried; the receive path is exempt from the business cap; extras read-only after.
- Analytics guard: the four new events pass the contract guard; anything else is dropped.
- i18n parity, direction classification (`ManualAllocationPanel` sites), the spacing guard.

## Phone (Flutter, `flutter test --concurrency=2`)

- `billing_overview_test`, `billing_view_test`: Starter tier, usage parsing, unknown fields ignored.
- `billing_screen_test`: Starter headline ar/en, usage lines, read-only-business reason.
- `api_client_test` / `errors_test`: `PLAN_LIMIT` 409 parsed into the typed error with each `limit`.
- `PlanLimitSheet` widget test: copy, reset date, no link and no price.
- Issue sheet: manual allocation panel line on Starter.

## Release-QA

Web features and specs from brief §10 (ids `portal.starter-*`, `portal.cancel-continue-starter`, `portal.trial-to-starter`, `portal.solo-automatic-allocation`), each in `qa/specs/portal/*.spec.ts` tagged `@portal.<area>.<id>`, every action in `step(...)`. Seeds: a fresh Starter person; one at 3/3 documents; one at 12/12 scans; a cancelled paid person; a legacy trial past its end; a Starter person with two businesses. Each passes once; `release-qa lint` clean with the new paths mapped. Phone: `qa/features/ios/billing.yaml` + issuing flow, re-recorded only for the changed screens.

## Regression

- Server: full suite, `test:db`, typecheck, lint, `openapi:check`.
- Portal: lint, typecheck, `test:run`, build (Node 22).
- With both flags off, every existing billing, lapse-gate, trial-mail and issuing test passes unchanged (the flags-off path is today's product).
