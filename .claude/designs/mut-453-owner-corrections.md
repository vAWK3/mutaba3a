# MUT-453 — A person reverses a payment and credits what is owed on their own profiles (API + portal + phone)

Status: PLAN (eng-ticket, 2026-10-26). Not built. Resolves TD-126 (the amount half; ADR-083 fixed the date half).
Tracker: Jira · barmajiyat · MUT via atlassian-barmajiyat · Backlog → Planned (this skill) → In Progress (eng-build) → In Review (qa-reconcile).

## Neighborhood
- No epic, no links, no blockers. Status Backlog (planning allowed; precedent MUT-338).
- **MUT-443** (Backlog, epic MUT-25): atomic `correct` for Malafat keys. Shares the reverse store call; out of scope here. Its `REASON_REQUIRED` code is *its* AC, not ours (D4).
- **MUT-444** (agreement correction, credits in full): same `receivables.credit` store call; no overlap in routes.
- **MUT-312** (month close, correct by reversal): future rule "a closed month is corrected by reversal" will sit on top of this route. Nothing to do now.
- **MUT-305/306** (BOOKKEEPER/SUBMITTER roles): when roles get scopes, they decide whether those roles hold `payments:write`; this ticket inherits that (D1).
- ADR-037 (writability matrix, MUT-65/61/133/182 amendments), ADR-083 (re-date), ADR-163 (co-owners), TD-126.
- The 2026-10-26 one-off script is not in the repo (ran via `scripts/db.sh run`). This ticket makes it unnecessary.

## Where the code is today
- `POST /v1/payments/{id}/reverse` `server/src/routes/payments.ts:381-411` and `POST /v1/receivables/{id}/credits` `server/src/routes/receivables.ts:88-128`: `security: [{ apiKey: [] }]`, `keyAuth(c)`, local `audit()` hard-codes `actorType: 'API_KEY'` (`payments.ts:51`, `receivables.ts:125`).
- A session on them hits `keyOnlyRefusal` (`auth/middleware.ts:378-386`) → 403 `READ_ONLY_PROFILE` with `writerOfRecord: null` (the lie the ticket names).
- An API key can never reach an owned profile (`middleware.ts:270` `ownedProfileConflict`). So today **nobody** can reverse/credit on an owned profile.
- Store guard already classifies `payments.reverse` and `receivables.credit` as `{ write: 'payments' }` (`auth/store-guard.ts:200,215`): a session on a writer-null profile already passes below the route. Only the route layer is closed.
- `payments:write` is in a session's scopes exactly when the profile's writer is null (`writability.ts:105-116`, `sessionScopesFor`). `/v1/me` `access.payments` is computed from the same function (`serializers.ts:102`).
- Closest session pattern: `POST /v1/receivables/{id}/settle` (`receivables.ts:152-227`): session-only, `payments:write`, `idempotent`, USER audit, Malafat-fed → 403 before lookup.

## Decisions (recommended; Basel confirms D1, D2, D7)

**D1 (APPROVED, Basel 2026-10-26) — Who may: anyone whose session holds `payments:write` on the profile (same gate as settle).** On a writer-null profile that is its owner and co-owners (owned profiles have no other members) and the members of a non-Malafat operator firm. That makes AC "/v1/me tells the truth" true by construction: `access.payments === 'read-write'` ⇔ reverse and credit are allowed, pinned by a drift test.
  Alt: owner-only (`ownsProfile` or OWNER member of a writer-null firm, the MUT-447 "held" rule). Rejected as default: it would make `/v1/me`'s `payments: read-write` false again for non-owner firm members, needing a new `/v1/me` field, and settle (same domain) has no such check.

**D2 (APPROVED, NARROWED by review D5) — Any person-recorded row: POSTED CAPTURE payments and open ADJUSTMENT receivables, whoever captured them; Malafat's own rows (INTEGRATION payments, INSTALLMENT/RETAINER receivables) → 404 for a session, as settle does (receivables.ts:175).** The AC says "any POSTED payment"; the incident needed fixing a settle the owner made long ago and payments on wrong jobs. Audit row names the actor. Differs from re-date/undo, which stay per person (ADR-163 D10) because they rewrite history in place; reversal and credit leave a visible trail.

**D3 — Widen the existing two routes, don't add new ones.** `security: [{ apiKey: [] }, { session: [] }, { deviceSession: [] }]` (MUT-65 precedent: `POST /v1/customers`). Same handler, same `checkCredit`, same idempotency op names, same error codes. Swap `keyAuth(c)` → the principal-neutral org/actor helpers and the hard-coded `API_KEY` → `actorOf(c)` (`middleware.ts:479`), so the audit is `actorType: USER` with `actorUserId`. One handler means the Malafat and person paths can't drift.
  - `capture_undo` stays `REASON_RESERVED` for every principal.
  - Malafat-fed profile: the session lacks `payments:write` → `requireScope` → 403 `READ_ONLY_PROFILE {domain: 'payments', writerOfRecord: 'MALAFAT'}` before lookup (AC3). The portal/phone show "This profile's money is kept in Malafat. Correct it there."

**D4 — No new error code.** Ticket AC names only `CREDIT_EXCEEDS_OUTSTANDING` (already exists). Empty reason stays the schema's 422; clients trim and require a reason before enabling Save. `REASON_REQUIRED` arrives with MUT-443 for both principals at once.

**D5 (REVISED by review D6) — Undo after a person's reversal tells the truth, decided from the reversal's audit actorType, not the profile's writer.** (Superseded text follows.) `DELETE /v1/income/{id}` on a capture someone reversed answers 409 `REVERSED_BY_MALAFAT` today (`income.ts:145-148`). On a writer-null profile no Malafat key can reverse, so there it answers the existing 409 `ALREADY_REVERSED` instead. No migration.

**D6 — History reads, additive only (API 1.77.0-mut453).** The entries feed is what the phone shows; it lacks both facts.
  - `IncomeResponse` (owed) gains `credited` (Money, `0` when none) and (received) `reversalReason` (string|null). Additive in `serializeIncomeEntry` (`serializers.ts:613`), so `POST /v1/income`, `GET /v1/entries` and replays all carry it; clients treat missing as 0/null (deploy-window replays, ADR-083 note).
  - Portal uses existing reads: `GET /v1/payments/{id}` (reversedAt, reversalReason), `GET /v1/receivables/{id}` (credited, outstanding) and `GET /v1/receivables/{id}/credits`.
  - No status enum change: "Cancelled" is a client label for an Owed with `paid == 0 && credited == amount` (status already `settled`).

**D7 — "Cancel" = credit the whole outstanding**, with a reason, effective today; it keeps history (unlike Undo, which deletes the person's own unpaid entry). On a partly paid Owed it reads "Cancel what's left (₪X)". Both actions shown only while outstanding > 0.

**D8 — Phone: online-only, not the outbox.** Reverse/credit need a fresh outstanding/version and a confirmation; queuing them offline invites a stale over-credit. Offline → the tiles are disabled with "Needs a connection".

**D9 — Lapse gate unchanged.** Both writes go through the store guard, so `SUBSCRIPTION_LAPSED` applies; clients already gate via `useWriteGate` / `billing_gate.dart`.

## Part A — server (mini-crm, `server/`)
Files:
- `src/routes/payments.ts` reverse route: security, `requireScope('payments:write')` stays, org from `c.get('auth').organization` (as `routes/customers.ts:59` does for both principals), `audit` → `actorOf(c)` (`middleware.ts:479`, `{actorType, actorId}`). Delete the local `API_KEY` audit helper if it has no other key-only caller left; otherwise parametrize.
- `src/routes/receivables.ts` credits route: same.
- `src/routes/income.ts` undo: D5 branch.
- `src/repositories/prisma.ts:2714` + memory twin: `settledOwedIds` counts only `payment.status = 'POSTED'` (review D3); entries-feed test with a reversed settle.
- `src/serializers.ts` `serializeIncomeEntry`: `credited`, `reversalReason`. `src/schemas.ts` `IncomeResponse` fields (register before routes, see the `CaptureSource` lesson in ADR-037 MUT-61).
- `src/app.ts:266` `API_VERSION = '1.77.0-mut453'` + description bullet (`app.ts:574-588`); pinned literals in routes-m2/m3/m4/m5/m6/m8 tests; `npm run openapi:generate`.
- Docs: hosted-portal.md §5 matrix note ("reverse/credits: API key, or a session where payments is read-write"), ADR-206 (check free) amending ADR-037 decision 7 + ADR-083 consequences; TD-126 → Resolved; CHANGELOG.

Tests first (unit, in-memory store; `npm --prefix server test -- <files>`):
- `src/__tests__/owner-corrections.test.ts` (new, modelled on `receivables-settle.test.ts`):
  1. owned personal profile, session: reverse a settle payment → 200 REVERSED; allocations gone; receivable back to OPEN with outstanding = gross; audit `payment.reversed` `actorType USER`, `actorUserId` = me, metadata reason + `allocationsUndone`.
  2. co-owner reverses a payment the creator recorded → 200 (D2).
  3. device session (phone) reverse → 200.
  4. reverse twice → 409 `ALREADY_REVERSED`; Idempotency-Key replay → same 200 body, one audit row.
  5. reason `capture_undo` → 422 `REASON_RESERVED`.
  6. credit open Owed ₪100 by ₪40 → 201, outstanding 60, audit `receivable.credited` USER; credit 61 → 422 `CREDIT_EXCEEDS_OUTSTANDING {outstanding}`; credit full → status SETTLED (Cancel).
  7. credit on a PAID receivable → 422 `RECEIVABLE_NOT_OPEN`.
  8. Malafat-fed profile session: reverse and credit → 403 `READ_ONLY_PROFILE {writerOfRecord: MALAFAT}` and no lookup (404 id gives 403 too).
  9. lapsed subscription → 402 `SUBSCRIPTION_LAPSED`.
  10. drift: for every profile in a fixture `/v1/me`, `access.payments === 'read-write'` ⇔ reverse is not 403.
  11. API key on a Malafat profile: unchanged (existing routes-m4 tests stay green, audit still `API_KEY`).
  12. undo (`DELETE /v1/income`) of a capture the person reversed → 409 `ALREADY_REVERSED` (D5); Malafat-reversed on a Malafat profile still `REVERSED_BY_MALAFAT`.
  13. summaries/verdict after a person's reversal and credit: paid/received drop by the payment; owed drops by the credit (one test each in the existing summaries test file; logic is status-based already, test proves it).
- `route-security.test.ts`: move the two ops into the session list. `writability-routes.test.ts:260` stays (Malafat 403).
- Entries feed test: owed `credited`, received `reversalReason`.
- Verify: `npm --prefix server run typecheck && run lint && run openapi:check && test` (through `heavy`). `test:db` on CI (lock-order unchanged: no new store method).

## Part B — portal (mini-crm, `src/hosted/`)
- `npm run hosted:types`; aliases in `api/client.ts` (`Credit`, `CreditRequest`, `CreditResponse`, `ReversePaymentRequest`); `api.reversePayment(id, body, key)`, `api.creditReceivable(id, body, key)`, `api.receivableCredits(id)`.
- `data/incomeQueries.ts`: `useReversePayment`, `useCreditReceivable` (both `invalidateIncome()` + `credits` key), `useReceivableCredits`.
- `data/incomeAffordances.ts`: one gate `correctionAffordancesFor(profile, row, writable)` → `owned && writable` (ADR-066/MUT-133, outside voice 3) ∧ `access.payments === 'read-write'` ∧ (`canReverse`: POSTED ∧ origin capture; `canCredit`: origin ADJUSTMENT ∧ outstanding > 0). Undo hidden once credited > 0. Unit tests in the existing affordances test file. Malafat-fed → false plus `managedInMalafat: true` for the notice.
- `components/RedateDrawer.tsx` becomes the entry/payment detail drawer: footer adds "Reverse payment" / "Reduce amount owed" / "Cancel"; each switches the drawer into an inline mode (PasskeysDrawer confirm pattern, danger button, no new dialog component): reason textarea (required, trimmed), amount (reuse `parseIncomeAmount`/`amountError`, max = outstanding, live "₪X left after this"). The modes live in a new `CorrectionPane.tsx` from the start (RedateDrawer is 279 lines; outside voice 7).
- Open the drawer for any row the gate allows, not only own captures: `PaymentsList` `canOpen`, `ReceivablesList`, `ClientDetailPage`. Date field stays editable only where `canRedate*` says (unchanged).
- History: payment drawer shows "Reversed on <date> · <reason>"; Owed drawer shows a "Credits" list (amount, date, reason) under `EntryPayments`; ReceivablesList shows "Cancelled" label per D6. PaymentsList REVERSED filter already exists.
- `components/incomeApiErrors.ts`: `mapCorrectionError` (CREDIT_EXCEEDS_OUTSTANDING → refetch + show new max; ALREADY_REVERSED → refetch; RECEIVABLE_NOT_OPEN; READ_ONLY_PROFILE; VERSION_MISMATCH → refetch).
- Remove the `hosted.settle.honest` note (TD-126 fix line).
- i18n `hosted.correct.*` in en.json + ar.json (parity test). Copy table goes to Basel with the brief.
- Tests: Vitest for the gate, error mapper, drawer modes (reason required, max amount, success toast "Saved · Payment reversed", Malafat notice).
- QA (`qa/features/portal/income.yaml` + `qa/specs/portal/income.spec.ts`): `reverse-payment`, `credit-owed`, `credit-over-outstanding`, `cancel-owed`, `correct-malafat-readonly`. Each run once to green (`release-qa run --attach --only <id>`), `release-qa lint` clean.
- Verify: `npm run lint && npm run typecheck && npm run test:run && npm run build` (Node 22, via `heavy`).

## Part C — phone (mutaba3a-flutter) → MOVES TO A NEW LINKED STORY (review D4); kept here as that story's plan
- `data/repositories/income_repository.dart`: `reversePayment(id, reason, key)`, `creditOwed(id, amount, reason, key)`, `credits(id)`; online-only (D8).
- `domain/models/feed_entry.dart`: parse `credited` (owed), `reversalReason` (received); missing → 0/null.
- `presentation/screens/recent/recent_actions.dart`: new actions `reversePayment`, `reduceOwed`, `cancelOwed` in the enum and `_serverActions`, gated by `profile.access['payments'] == 'read-write'` (read the published access, not `owned`) and row state; Malafat-linked rows keep `recentReversedInMalafat`-style copy. Reason sheet adapted from `name_dialog.dart`; amount from `amount_field.dart`.
- Details sheet history: reversed line with reason; credited line; "Cancelled" label.
- `recent_providers.dart`: `_invalidateAll` after success.
- l10n en/ar arb (`make gen-l10n`).
- Tests: widget tests for gating + sheet validation; repository tests with the fake client.
- QA: `qa/features/ios/recent.yaml` `reverse-payment`, `reduce-owed`, `cancel-owed` + flows in `integration_test/qa/`. Simulator rules: "Mutaba3a QA" only, `--wait`.

## Order and release
A → B in one mini-crm worktree (`feature/mut-453-owner-corrections`); C in one Flutter worktree after A merges (needs the local :8787 API). Release: API before web/phone (clients feature-detect nothing; they need 1.77.0 to stop getting 403).

## Scalability / cost
No new tables, no migration, no new store methods, no extra reads on hot paths. Credits list is a per-drawer read. Feed gains two scalar fields.

## Out of scope
Atomic correct (MUT-443), agreement correction (MUT-444), editing an amount in place, moving a payment to another client, month close (MUT-312), per-role scopes (MUT-305/306), a Malafat write-back.

---
# Eng review (plan-eng-review, 2026-10-26)
Target: this file (mut-453-owner-reverse-credit-plan.md). Original plan above is unchanged.

## Scope Challenge
- Reuse: the store calls (`payments.reverse` prisma.ts:1762, `receivables.credit` prisma.ts:1653), `checkCredit` (payments/credit.ts:28), the store-guard classification (store-guard.ts:200,215), `idempotent()` for both principals (as settle uses it, receivables.ts:160), `actorOf` (middleware.ts:479), and the portal's generated types (schema.d.ts:7277, :17444) already exist. The plan adds no store method, table or migration.
- Complexity: about 12 server files (6 of them pinned-version test files), about 10 portal files and about 8 Flutter files. One optional new component (`CorrectionPane.tsx`). That is over the 8-file gate, so the structure question is asked (R4).
- Findings:
  - [P1] (confidence 9/10) server/src/repositories/prisma.ts:2716-2722: `settledOwedIds` reads `paymentAllocation` rows with no payment-status filter. `reverse` (prisma.ts:1766) sets `allocatedMinor: 0n` but keeps the allocation rows. So the feed still sends `settlesOwedId` for a reversed settle payment. Flutter `recent_layout.dart:34-37` then folds it under its Owed once that Owed reads `settled` (for example: paid by P1+P2, P1 reversed, the rest credited). The portal is safe: `usePaymentsForEntry` filters `status === 'POSTED'` (incomeQueries.ts:56). → R3
  - [P2] (confidence 9/10) prisma.ts:1797: `undoCapture` returns `reversed-elsewhere`, which income.ts:145-148 maps to `REVERSED_BY_MALAFAT`. That is false once a person can reverse. Already plan D5 (accepted as common work under D3's behaviour).
  - [P2] (confidence 8/10) API_VERSION collision. Other branches are in flight off 1.76.0-mut447. Pick the number at build from main's current value.
- REALITY: premise-table pass (premises verified: key cannot reach owned profile middleware.ts:270; store guard allows session payments.ts writes store-guard.ts:200,215; session idempotency receivables.ts:160) unverified=0
- REALITY: already-done pass (no session reverse/credit in git log; TD-126 still Open TECH_DEBT.md:1110)
- REALITY: surface-check pass (route security arrays verified receivables.ts:39,95,160)
- REALITY: binding-decisions finding (ADR-163 D10 keeps re-date/undo per person; D2 widens correction to any row → R2)
- REALITY: numbers pass (file counts above are estimates, labelled)
- REALITY: deferred-asks pass (ticket asks 1 API, 2 app portal+phone, 3 /v1/me truthful; all mapped: Part A, B+C, D1 drift test)
- REALITY: pr-count finding (two repos → at least 2 merges; phone-split question R4)

## Decision ledger

### R1: Who may reverse/credit on a non-Malafat profile
Finding: plan D1, severity P1 product rule, confidence 9/10 (writability.ts:105-116)
Plan baseline: original proposal, `payments:write` (same gate as settle)
Runtime evidence: on a writer-null profile, `payments:write` goes to every member's session (sessionScopesFor). Owned profiles have only OWNER members.
Comparison grid: | R1 | current: no session may | A: any session holding payments:write | B: owner/co-owner, or an OWNER member of a non-Malafat firm |
State: approved
Actual answer: A, same as Record payment (Basel, D1, 2026-10-26)
Accepted scope: gate = session holds payments:write; drift test /v1/me access.payments read-write <=> reverse/credit allowed

### R2: Which rows a person may correct
Finding: plan D2 against ADR-163 D10, confidence 8/10
Plan baseline: original proposal, any POSTED payment or open receivable on the profile
Comparison grid: | R2 | current: none | A: any row on the profile | B: only rows they captured (like re-date) |
State: approved
Actual answer: A, any row on the profile (Basel, D2, 2026-10-26)
Accepted scope: any POSTED payment / open receivable; re-date and undo stay per person (ADR-163 D10 unchanged)

### R3: Reversed payments still claim to settle an Owed in the feed
Finding: Scope P1, confidence 9/10, prisma.ts:2716-2722
Plan baseline: not in the original plan
Comparison grid: | R3 | current: allocation rows of reversed payments counted | A: server filters `payment.status = POSTED` in settledOwedIds (+memory store, + test) | B: phone ignores reversed in foldPairs | C: leave |
State: approved
Actual answer: A, filter on the server (Basel, D3, 2026-10-26)
Accepted scope: settledOwedIds counts POSTED payments only (Prisma + memory) + entries-feed test

### R4: Arrangement (structure, plan-eng-review-structure)
Finding: complexity gate, about 30 files across 2 repos
Plan baseline: original arrangement, one ticket with A server + B portal (one mini-crm worktree), then C phone (one Flutter worktree)
Comparison grid: | R4 | Original: A+B+C under MUT-453 | Smaller: A+B under MUT-453, C as a linked phone ticket (MUT-333/115 halves pattern) |
Pending remedies not decided here: R1, R2, R3
State: approved
Actual answer: B, split the phone into its own ticket (Basel, D4, 2026-10-26)
Accepted scope: MUT-453 = Part A server + Part B portal; Part C becomes a new linked phone story (blocked by MUT-453), built right after. Scope accepted as-is (no reduction)

Scope Challenge result: scope accepted as-is (the phone split keeps all the work and moves Part C to its own linked ticket).

## 1. Architecture review
```
portal drawer / phone sheet
   │ POST /v1/payments/{id}/reverse {reason}        POST /v1/receivables/{id}/credits {amount, reason, effectiveDate?}
   ▼  (Idempotency-Key)
authenticate → selectProfile(session|device|apiKey) ── Malafat-fed session: no payments:write
   │                                                        └─► requireScope → 403 READ_ONLY_PROFILE{MALAFAT}
   ▼
idempotent(op) → handler: org = auth.organization, actor = actorOf(c)
   │  reverse: mustGetPayment → REASON_RESERVED? → store.payments.reverse (tx: payment POSTED→REVERSED, lock receivables, paid -=)
   │  credit : checkCredit (AMOUNT_INVALID / RECEIVABLE_NOT_OPEN / CREDIT_EXCEEDS_OUTSTANDING) → store.receivables.credit
   ▼
store guard {write:'payments'} + SUBSCRIPTION_LAPSED → audit payment.reversed / receivable.credited (USER|API_KEY)
```
- No issues beyond the ledger's. Security holds: three layers stay (scope, route `security`, store guard), and none is widened past `payments:write`. Lock order is unchanged (no new store path).
- Production failure: the connection drops after the reverse commits. The client retries with the same attempt key, and `idempotent` replays the stored 200. Covered by test 4.

## 2. Code quality review
- [P3] (confidence 8/10) payments.ts:46-52: the local `actorOf`/`audit` hard-code `API_KEY` and still serve the key-only allocation routes. Keep the helper and pass `actorOf(c)` from middleware, rather than deleting it. Common work under D3.
- No shared-code extraction proposed. The reuse is direct, of existing helpers.

## 3. Test review
```
CODE PATHS                                              USER FLOWS (portal)
[+] reverse route                                       [+] Reverse a payment
  ├── [GAP→T] session owned, settle payment → OPEN        ├── [GAP→QA] reverse-payment (reason, history line)
  ├── [GAP→T] co-owner, device session                   └── [GAP→QA] double submit → one reversal (attempt key)
  ├── [★★★ routes-m4:310] key path, ALREADY_REVERSED     [+] Reduce / Cancel owed
  ├── [GAP→T] capture_undo reason → REASON_RESERVED (session)  ├── [GAP→QA] credit-owed, cancel-owed ("Cancelled")
  └── [GAP→T] Malafat-fed → 403 before lookup            └── [GAP→QA] credit-over-outstanding (stale tab → new max)
[+] credits route                                       [+] Malafat profile
  ├── [★★★ routes-m4:352] key path                         └── [GAP→QA] correct-malafat-readonly (no buttons, notice)
  ├── [GAP→T] session credit, over → 422, full → SETTLED
  └── [GAP→T] lapsed → 402
[+] undo after person's reversal → ALREADY_REVERSED [GAP→T]
[+] settledOwedIds ignores REVERSED [GAP→T] (D3)
[+] /v1/me ⇔ allowed drift [GAP→T] (D1)
[+] summaries after reversal/credit [GAP→T]
COVERAGE today: 2/16 paths (both key paths) | all gaps have a planned test or QA spec
```
- Regression to protect (CRITICAL): the API-key paths keep the same behaviour, `actorType API_KEY` and error codes. The existing routes-m4/mut100/m5 tests carry it unchanged. The contract was already approved as D3 "same handler, same codes".
- Tests made obsolete: route-security's key-only expectation for these two ops (rewritten, not removed). writability-routes.test.ts:260 stays.

## 4. Performance review
- No issues. Reverse loops over one payment's allocations (one for settle). The credits list is one read per opened drawer. The feed filter adds one join column. No new hot-path reads.

## Failure modes
| Path | Failure | Handling | User sees |
|---|---|---|---|
| reverse | double click / retry | attempt key + idempotent | one reversal |
| credit | other tab paid meanwhile | 422 CREDIT_EXCEEDS_OUTSTANDING{outstanding} → refetch | new maximum |
| either | subscription lapsed | 402 via store guard | existing lapse banner |
| either | Malafat-fed | 403 READ_ONLY_PROFILE | "Correct it in Malafat" |
| undo after reversal | stale button | 409 ALREADY_REVERSED | refreshed row |
Critical gaps: 0.

## NOT in scope
- Atomic correct (MUT-443), agreement terms (MUT-444), month close (MUT-312), per-role scopes (MUT-305/306), editing an amount in place, `REASON_REQUIRED` (it comes with MUT-443).
- Phone UI: moved to a new linked story (D4). It is built next, not deferred indefinitely.

## What already exists
- Store `payments.reverse` / `receivables.credit`, `checkCredit`, the store-guard classification, session `idempotent`, `actorOf`, generated portal types, and `GET /v1/receivables/{id}/credits`. All are reused, nothing rebuilt.

## Worktree parallelization strategy
| Step | Modules | Depends on |
|---|---|---|
| A server | server/src/routes, repositories, serializers, openapi | — |
| B portal | src/hosted | A (types regenerated from A's openapi) |
| C phone (new ticket) | flutter lib/ | A merged (local :8787) |
Lane 1: A → B (one mini-crm worktree, sequential). Lane 2: C after A merges. Two lanes, sequential.

## Outside voice (native fallback: Plan subagent; Codex CLI not installed)
OUTSIDE VOICE (Claude subagent), completed within the timer. Summary of findings, each verified by me against the code:
1. Critical, verified receivables.ts:172-175 + writability.ts:139-141: a disconnected Malafat firm gives every member `payments:write`. D2 "any row" would let a session reverse INTEGRATION payments and credit INSTALLMENT/RETAINER receivables. Settle guards this with origin ADJUSTMENT → 404. → R5 (reopens R2)
2. High, verified middleware.ts:270 (keys are blocked only on owned profiles): D5's "writer-null ⇒ a person reversed it" is false on a disconnected firm. → R6
3. High, verified incomeAffordances.ts:35-44: the portal write gate is `owned && writable` (ADR-066/MUT-133). The plan's gate dropped both. Fix: keep `owned && writable` in `correctionAffordancesFor`. This follows the existing decision (common work, no ADR override).
4. Medium: payments.ts:36-52 has a local `actorOf`/`Actor` built on `keyAuth`, still used by create (:210) and allocate (:354). Rename it `keyActorOf` and import middleware `actorOf`. Common work under D3.
5. Medium: income.ts:133. Undo on a credited Owed says "already been settled". Clients hide Undo once credited > 0; the server message becomes "already been paid or credited" (same code ALREADY_SETTLED, copy only). Common work.
6. Low: drift test #10 is re-scoped to "a CAPTURE/ADJUSTMENT row is allowed ⇔ access.payments read-write".
7. Low: `CorrectionPane.tsx` from the start (RedateDrawer.tsx is 279 lines).
8. Low: the "Cancelled" label rule goes into the copy table for Basel's sign-off.

### R5: Which rows a session may correct (reopens R2)
Finding: outside voice 1, Critical, confidence 9/10, receivables.ts:172-175
Plan baseline: R2 approved "any row on the profile" (Basel D2)
Runtime evidence: settle refuses non-ADJUSTMENT with 404; profileWriterOf null when the integration is disconnected
Comparison grid: | R5 | R2 value: any row | A: session only CAPTURE payments + ADJUSTMENT receivables (any person's), else 404; API key unchanged | B: keep any row |
State: approved
Actual answer: A, people's rows only (Basel, D5, 2026-10-26)
Accepted scope: a session principal may reverse only origin CAPTURE payments and credit only origin ADJUSTMENT receivables (anyone's); otherwise 404 NOT_FOUND like settle; API key unchanged; test: disconnected-firm session reversing an INTEGRATION payment → 404, crediting an INSTALLMENT → 404
History: R2 answered A (any row) at D2. Reopened for the concrete new risk above. A keeps "any person's row", so the co-owner part of D2 stands.

### R6: How undo tells who reversed a capture
Finding: outside voice 2, High, confidence 8/10, middleware.ts:270, income.ts:145-148
Plan baseline: D5 = branch on writer-null
Comparison grid: | R6 | current: reversed-elsewhere → REVERSED_BY_MALAFAT | A: read the payment's latest `payment.reversed` audit actorType (USER → ALREADY_REVERSED, API_KEY → REVERSED_BY_MALAFAT), only on that error path | B: branch on writer-null (original D5) |
State: approved
Actual answer: A, read the audit row (Basel, D6, 2026-10-26)
Accepted scope: undoCapture 'reversed-elsewhere' → read the payment's latest payment.reversed audit actorType: USER → 409 ALREADY_REVERSED, API_KEY → 409 REVERSED_BY_MALAFAT; one read on that error path only; tests for both incl. a disconnected firm

Approval readiness: PASS. R1 (D1), R2→R5 (D2 narrowed by D5), R3 (D3), R4 (D4), R6 (D6), all actual answers by Basel on 2026-10-26. Outside-voice items 3, 4, 5, 6, 7 and 8 are common work under approved behaviour (existing gate ADR-066, D3 same-handler, honest errors).

## Implementation Tasks
- [ ] **T1 (P1, human: ~1d / CC: ~30min)**: server routes. Both routes accept session + deviceSession; `keyActorOf` rename; middleware `actorOf`; origin guard CAPTURE/ADJUSTMENT → 404 for sessions (D5). Surfaced by: plan D1/D3, outside voice 1, 4. Files: server/src/routes/payments.ts, receivables.ts. Verify: owner-corrections.test.ts.
- [ ] **T2 (P1, human: ~2h / CC: ~10min)**: settledOwedIds counts POSTED only (D3). Files: repositories/prisma.ts, memory.ts. Verify: entries feed test.
- [ ] **T3 (P2, human: ~2h / CC: ~10min)**: undo truth from the reversal audit actorType (D6) + "paid or credited" copy. Files: routes/income.ts. Verify: income-routes.test.ts additions.
- [ ] **T4 (P2, human: ~2h / CC: ~10min)**: feed `credited` / `reversalReason`, API 1.77.0-mut453 (number confirmed at build), openapi regen, pinned literals, route-security lists. Verify: `npm --prefix server run openapi:check && test`.
- [ ] **T5 (P1, human: ~2d / CC: ~1h)**: portal gate (`owned && writable`), CorrectionPane, history lines, error mapper, i18n en/ar, remove `hosted.settle.honest`. Verify: Vitest + QA ids reverse-payment, credit-owed, credit-over-outstanding, cancel-owed, correct-malafat-readonly.
- [ ] **T6 (P2, human: ~1h / CC: ~10min)**: docs. ADR-206 (amends ADR-037 d7 + ADR-083), TD-126 resolved, CHANGELOG, hosted-portal.md §5.
- [ ] **T7 (P1, human: ~15min / CC: ~5min)**: create the linked phone story for Part C (D4), blocked by MUT-453.

## Unresolved decisions
None. The copy table (with the "Cancelled" rule) goes to Basel at build, as usual.

## Completion summary
- Step 0: Scope Challenge, scope accepted as-is (phone moved to a linked ticket, no work cut)
- Reality rows: 7/7 emitted, 0 unverified premises
- Architecture Review: 0 issues
- Code Quality Review: 1 issue
- Test Review: diagram produced, 13 gaps identified (all planned)
- Performance Review: 0 issues
- NOT in scope: written
- What already exists: written
- TODOS.md updates: 0 proposed (follow-ups are Jira tickets: the phone story)
- Failure modes: 0 critical gaps
- Unresolved decisions: 0
- Outside voice: codex not installed → native Plan subagent completed (in-host), 8 findings; 2 reopened decisions (D5, D6), 6 common work
- Parallelization: 2 lanes, 0 parallel / 2 sequential
- Lake Score: 6/6

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Outside Review | native Plan subagent (codex not installed) | Independent 2nd opinion | 1 | unavailable (in-host fallback completed) | 8 findings, 1 critical, folded in via D5/D6 |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | issues_open (all mapped, approved) | 14 issues, 0 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | — |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **OUTSIDE COVERAGE:** codex: not installed. Claude Plan subagent fallback completed in time; that does not count as external coverage.
- **VERDICT:** Eng review run with every finding mapped to an approved task. The portal UI is unreviewed by design review; recommended before build.

NO UNRESOLVED DECISIONS

---
## QA scenarios (release-qa, web portal) — as built
| id | The user says | Promise |
|---|---|---|
| `reverse-payment` | "I recorded a payment on the wrong job; reverse it." | Open the payment, Reverse payment, give a reason: the payment reads Reversed with that reason, and the Owed it paid is owed again. |
| `credit-owed` | "We agreed a lower fee; reduce what they owe." | Open the Owed, Reduce amount owed by part, give a reason: what is left drops by that amount and the credit is listed. |
| `credit-over-outstanding` | "I try to reduce by more than is left." | Refused before sending, with what is left shown. |
| `cancel-owed` | "The client dropped the job; cancel what they owe." | Cancel amount owed with a reason: the entry reads Cancelled. |
| `correct-malafat-readonly` | "On my firm's Malafat profile I want to fix a payment." | No correction is offered there (Malafat keeps that ledger). |

---
## qa-reconcile amendment (2026-10-26, Basel)
- D1 is owner-only: `ownsProfile` (creator or co-owner) before any lookup, else 403 READ_ONLY_PROFILE {reason: NOT_OWNER}. /v1/me truth = `owned && access.payments === 'read-write'`.
- Fixes from review: allocation guard on a person's reversal (404 if it paid any non-ADJUSTMENT entry); `pastMoneyDate` on a person's credit `effectiveDate`; IncomeResponse new fields optional; portal rotates the attempt key after 409; Cancel reports a partial cancel and toasts a 422.
- Follow-ups filed: audit rows inside the reverse/credit transaction (+ allocationsUndone race, audit-lookup ordering); "Cancelled" label for a partly paid, fully credited entry; MUT-454 handles ALREADY_REVERSED on the shipped phone's Undo.
