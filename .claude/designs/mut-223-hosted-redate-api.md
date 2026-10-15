# MUT-223 — Hosted API: change the date of a saved income entry or payment

Status: Planned (eng-ticket, 2026-10-15). Server only. Blocks MUT-224 (portal), MUT-225 (phone).
Tracker: Jira · barmajiyat · MUT · Backlog → Planned → In Progress (eng-build) → In Review (qa-reconcile).

## 1. Problem and acceptance criteria

On a hosted profile, a saved Owed entry (Receivable, origin `ADJUSTMENT`) and a recorded payment (Payment,
origin `CAPTURE`) keep their date forever. Expenses and conversions can already be re-dated with `If-Match`
PATCH (ADR-075). Basel's decisions (2026-10-15): **date only**, **owned profiles only** (`profileOwnerOf`),
**an Owed entry keeps its stored `dueDate`**.

AC1–AC9 are the ticket's, unchanged. §6 maps each one to a test.

## 2. Contract

### `PATCH /v1/income/{incomeId}`  (routes/income.ts)
- Security `session` | `deviceSession` (an API key is refused by `sessionAuth`, the same as DELETE). Middleware
  `requireScope('capture:write')`, `ifMatch()`.
- Body `UpdateIncomeRequestSchema = { occurredOn: IsoDate }`, `.strict()`.
- Resolution matches DELETE /v1/income/{id}: the id is a receivable, or failing that a payment.
  - Receivable: it must have `origin = ADJUSTMENT`, `createdByUserId = user`, and not be deleted. Then
    `postingDate := occurredOn`, `dueDate` is unchanged, and `version` goes up by 1.
  - Payment: it must have `origin = CAPTURE`, `createdByUserId = user` and `status = POSTED`, and nothing
    allocated to it (`allocatedMinor = 0`). Then `receivedOn := occurredOn` and `version` goes up by 1.
  - A payment that has allocations (on an owned profile, that is only a settle payment) gives
    **409 `ALREADY_ALLOCATED`**, the same refusal DELETE gives, with the detail "change it through
    PATCH /v1/payments/{id}". The reason: `IncomeStatus` has no "allocated" value, so the income shape can't
    describe that payment honestly.
- 200 returns `IncomeResponse`. **`IncomeResponse` gains `version`** (an additive change), so a client can send
  `If-Match` straight from a create response. MUT-225 needs this for saved income on the phone.

### `PATCH /v1/payments/{paymentId}`  (routes/payments.ts)
- Security `session` | `deviceSession`. Middleware `requireScope('payments:write')` (the settle route's scope)
  and `ifMatch()`.
- Body `UpdatePaymentRequestSchema = { receivedOn: IsoDate }`, `.strict()`.
- The payment must have `origin = CAPTURE`, `createdByUserId = user` and `status = POSTED`. Allocations are
  allowed and stay unchanged. Then `receivedOn := new`, `version` goes up by 1, and `updatedAt := now`.
- 200 returns `Payment`, with allocations, built by `serializePayment` as GET /v1/payments/{id} does today.

### Shared rules (both routes)
1. **The owner gate comes first:** `profileOwnerOf(organization) !== user.id` gives **404**. This covers
   Malafat-fed profiles, where MUT-61 lets a person create `CAPTURE` payments, so `createdByUserId` alone is
   not enough.
   Exception (eng review D2): on a Malafat-fed profile PATCH /v1/payments never reaches the gate.
   `requireScope('payments:write')` answers 403 `READ_ONLY_PROFILE` first, as settle does. The OpenAPI
   description says so.
2. **The date:** `assertIsoDate` gives 422 `VALIDATION_FAILED` for a malformed date. `assertNotFuture(date,
   todayFor(organization, now))` gives 422 `DATE_INVALID`. Both are the same calls create uses (MUT-65; the
   phone side of MUT-162 is merged and the server rule is unchanged).
3. **Concurrency:** read the row first. If `row.version !== If-Match`, return 409 `VERSION_MISMATCH` with
   `currentVersion` (`versionMismatch()` in routes/shared.ts). Otherwise do the conditional write, which
   re-checks the version. If the write finds it stale, return the same 409. The read-first step also gives the
   exact old date for the audit, because the version matched both times, so nothing wrote in between.
4. **404 means nothing to touch:** another user's row, an `INTEGRATION` payment, an `INSTALLMENT` or
   `RETAINER_CHARGE` receivable, a voided receivable or a reversed payment all give 404. The store's
   conditional write carries the same ownership predicate, so its re-read can't turn "not yours" into a stale
   409.
5. **Audit**, appended after the write (the accepted TD-101 shape):
   - `income.owed.redated` (entityType `receivable`)
   - `payment.redated` (entityType `payment`, used by both routes)
   - metadata `{ from, to, version }`
6. **Same-date PATCH:** treated as a normal write (the version goes up and an audit row is written). This
   matches conversions and expenses. No special no-op branch.

### Edge cases decided (they go in the ADR)
- **Payment number:** `PAY-YYYY-NNNN` keeps its original year when `receivedOn` moves into another year. The
  number is a gap-free identifier, not a date. Renumbering would break the gap-free sequence.
- **Paid before owed:** a payment dated before its receivable's `postingDate` is allowed. Settle already
  allows it today (it only checks `paidAt ≤ today`), and an advance is real money.
- **Due date before posting:** moving an Owed entry past its `dueDate` is allowed and the due date is
  unchanged (Basel's decision). If it is unpaid, `receivableStatus` reads it as overdue.
- **Derived reads need no change:** the paid date has no stored column (ADR-038 derives it from payments).
  Summaries (`lastPaymentOn` in summaries/compute.ts), the `receivedOn` and `postingDate` list filters and
  aging all read the stored date, so AC3 and AC8 hold without extra steps.

## 3. Where the code goes (files)

| Layer | File | Change |
|---|---|---|
| Rules | `server/src/income/compose.ts` (extended, eng review D1) | `assertOwnedProfile(organization, userId)` (404), `redateDate(raw, organization, now, field)` (assertIsoDate + assertNotFuture), `assertExpectedVersion(row, expected)`. They go next to `assertNotFuture`. Pure, so they are unit-tested without HTTP. |
| Ports | `server/src/repositories/ports.ts` | `ReceivableRepository.redateAdjustment(orgId, id, userId, expectedVersion, postingDate, at): Promise<UpdateResult<ReceivableRecord>>`; `PaymentRepository.redateCapture(orgId, id, userId, expectedVersion, receivedOn, at): Promise<UpdateResult<PaymentRecord>>` (no option, D3); `AuditFilter.excludeActions?: readonly string[]` |
| Memory store | `server/src/repositories/memory.ts` | Mirrors both write methods and `excludeActions`. |
| Prisma store | `server/src/repositories/prisma.ts` | `updateMany` with the predicates in §2 plus `version: expected`, then a re-read under the same ownership predicate → `stale`/`not_found` (the conversions.update shape, lines ~1153–1157). Audit where: `action: { equals?, notIn? }`, next to `entityTypeWhere`. |
| Routes | `server/src/routes/income.ts`, `server/src/routes/payments.ts` | The two PATCH routes above. |
| Audit feed | `server/src/routes/audit.ts` | `SESSION_ONLY_ACTIONS = ['income.owed.redated', 'payment.redated']`, passed as `excludeActions`. An entity-type exclusion would hide every receivable and payment event from Malafat, so it can't be used. |
| Schemas | `server/src/schemas.ts` | `UpdateIncomeRequestSchema`, `UpdatePaymentRequestSchema`; `version` on `IncomeResponseSchema`. |
| Serializer | `server/src/serializers.ts` | `serializeIncomeEntry` emits `version`. |
| Contract | `server/openapi/openapi.yaml` (`npm --prefix server run openapi:generate`), `src/hosted/api/schema.d.ts` (`npm run hosted:types`), `API_VERSION` in `server/src/app.ts` → `1.26.0-mut223` |
| Knowledge | `.claude/DECISIONS.md` ADR-082 (hosted re-dating: date-only, owner-only, If-Match, the four edge cases above; it extends ADR-075's contract and ADR-038's server addendum); `TECH_DEBT.md` TD-126 note (a wrong date can now be fixed, a wrong amount still can't); `CHANGELOG`, `SYSTEM_OVERVIEW`, `PATTERNS` (owner gate + action-level audit exclusion), `TEST_PLAN` |

No migration: `receivables.version` and `payments.version` already exist. No new index: both writes hit the
primary key.

## 4. Reuse (DRY)
- Reused: `ifMatch()`, `versionMismatch()`, `IfMatchHeaderSchema`, `UpdateResult<T>`, `assertIsoDate`,
  `assertNotFuture`, `todayFor`, `profileOwnerOf`, `serializePayment`, `serializeIncomeEntry`, and the
  conditional-update shape from conversions and expenses.
- New shared code goes only in `income/compose.ts` (D1) and is used by both routes. The payment re-date is one
  store method serving both routes. PATCH /v1/income checks `allocatedMinor > 0n` on its pre-read (D3: on an owned
  profile only settle allocates, and only to the payment it creates, so the check can't race).

## 5. Scale and cost
- Each PATCH is one primary-key read, one conditional `updateMany`, at most one re-read and one audit insert.
  There are no list scans and no third-party calls.
- `excludeActions` adds a `notIn` on `audit_events.action` inside a query already scoped by the
  `(organizationId, createdAt)` index, so the cost is negligible.

## 6. Tests (written first)
Route tests: `server/src/__tests__/income-redate.test.ts`, on the in-memory app with the
income-routes.test.ts harness.

| AC | Case |
|---|---|
| 1 | PATCH an Owed entry with v1: 200, `occurredOn` moved, `dueDate` unchanged, `version` 2 |
| 2 | PATCH a Received entry: the payment's `receivedOn` moves; GET /v1/payments/{id} shows it |
| 2b | PATCH /v1/income on a settle payment: 409 `ALREADY_ALLOCATED` |
| 3 | PATCH /v1/payments on a settle payment: `receivedOn` moves, allocations are unchanged, the receivable is still SETTLED and its `paidMinor` is unchanged |
| 4 | stale If-Match → 409 `VERSION_MISMATCH` with `currentVersion`; an Owed entry PATCHed with its pre-settle version after a settle → 409 (settle bumps `receivable.version`, prisma.ts:1495); tomorrow in the org's timezone (a clock just past midnight UTC, org in Asia/Amman) → 422 `DATE_INVALID`; `2026-02-30` → 422; If-Match missing → 422; an extra body field → 422 |
| 5 | Each gives 404 and the row is unchanged: another user's entry; a Malafat-fed profile's own CAPTURE via PATCH /v1/income (via PATCH /v1/payments it gives 403 READ_ONLY_PROFILE, D2); an INTEGRATION payment; an INSTALLMENT receivable; a voided Owed entry; a reversed (undone) capture |
| 6 | Cookie session: 200; device session: 200; API key: refused (same status as DELETE's test) |
| 7 | The audit row has `{ from, to, version }` (find rows by `action`, never by position: TODOS #8 ordering flake); GET /v1/audit with an API key doesn't list `income.owed.redated` or `payment.redated` but still lists `income.owed` |
| 8 | Re-date a Received entry into the previous month: GET /v1/payments with `receivedAfter`/`receivedBefore` for that month includes it and the original month's window doesn't; `/v1/summaries/customers/{id}` `lastPaymentOn` follows. Re-date an Owed entry: GET /v1/receivables returns the new `postingDate`. |

Note on AC8's wording: the server has no month-windowed summaries and no `postingDate` filter on
`/v1/receivables`. The portal groups months on the client. "Moves to that month" therefore means the stored
date the lists return, plus the payment window filter. No new filter is added (that would be scope creep). If
MUT-224 needs a `postedAfter`/`postedBefore` filter, it gets its own small ticket.

Store contract: extend `server/src/repositories/__tests__/store-contract-capture.ts` (it runs under both
`store-memory-capture.test.ts` and `store-prisma-capture.test.ts`, so AC9 is covered):
- `redateAdjustment`: updated; stale (record returned); not_found when the user, origin or deletion differs
- `redateCapture`: updated; stale; not_found for INTEGRATION, REVERSED or another user; an allocated payment
  is re-dated with its allocations unchanged (the store has no allocation predicate, D3)
- audit `excludeActions` combined with `action` and with `excludeEntityTypes`

Unit: extend `server/src/income/__tests__/` (the compose tests) for the three pure helpers.

Commands (Node 22, TD-054): `npm --prefix server run typecheck && npm --prefix server run lint &&
npm --prefix server run openapi:check && npm --prefix server test`, then `npm --prefix server run test:db`
(Postgres :54329). Root: `npm run typecheck` (hosted types changed).

## 7. QA scenarios (release-qa)
The release-qa catalog has no API app: the `portal` app stubs `/v1`, and `server/**` isn't watched. These
scenarios are automated by **MUT-224** in `qa/specs/portal/`, and its brief must carry them:
1. "Change the date of an Owed entry": open it, pick yesterday, save. It shows the new date, and the due date
   is unchanged.
2. "Change the date of a payment I recorded": open the settled entry's payment, pick an earlier day, save.
   The paid date follows.
3. "Someone changed it first": the save is refused, the drawer refetches and says so (MUT-221's lesson).

This ticket's own definition of done is the server suite above. No portal path changes here.

## 8. Risks and things flagged
- **MUT-196 (In Review):** an expense PATCH sent an `If-Match` taken from a re-read, which silently
  overwrote changes. That is a client-side trap. MUT-224/225 must send the version from the row they showed,
  never a fresh re-read.
- **MUT-221 (Backlog):** the portal expense drawer never refetches after a 409. MUT-224 must not copy it.
- **Malafat-fed profiles stay closed:** this is enforced by the owner gate, and a test proves it.
- **i18n:** no user-facing strings on the server. Error codes only.

---

# Eng review (/plan-eng-review, 2026-10-15)

Target: `.claude/designs/mut-223-hosted-redate-api.md` (this plan, §1–§8 above, as drafted by /eng-ticket).

## Scope record
feature answers: none proposed (all nine ACs kept); structure: A Smaller arrangement (D1, AskUserQuestion answer
2026-10-15); accepted scope: helpers in `income/compose.ts`, no `income/redate.ts`, 9 authored files + 2 generated;
pending remedies: R2, R3.
Scope Challenge result: scope accepted as-is (smaller arrangement, same scope).

## Decision ledger

### R2: What PATCH /v1/payments/{id} answers on a Malafat-fed profile
Finding: #1, P2, confidence 9/10, server/src/auth/middleware.ts:358-361, reviewer: native (Claude)
Plan baseline: §2 "Shared rules" 1 says the owner gate gives 404 for Malafat-fed profiles on both routes, and AC5 says
"a Malafat-fed profile's entry … gives 404". §2 also gives PATCH /v1/payments `requireScope('payments:write')`.
Runtime evidence: `requireScope` runs before the handler. On a Malafat-fed profile a session lacks `payments:write`,
and `matrixRow('payments').writerOfRecord === 'MALAFAT'`, so it throws `writeRefusal` (403 READ_ONLY_PROFILE) before
the owner gate (middleware.ts:358-361; writability.ts:45 `session: 'read'`). PATCH /v1/income is not affected:
`capture:write` is held on every hosted profile (writability.ts:52), so it reaches the owner gate and 404s. Settle
(receivables.ts:161) already 403s the same way on Malafat-fed.
Comparison grid:
| Choice | Current (plan) | A | B |
|---|---|---|---|
| R2 PATCH /v1/payments on Malafat-fed | 404 (stated) but 403 in fact | 403 READ_ONLY_PROFILE, documented; AC5 test asserts 403 for this route | 404 via `capture:write` scope; matrix + hosted-portal.md brief row updated |
| PATCH /v1/income on Malafat-fed | 404 | 404 (unchanged) | 404 (unchanged) |
| R3 store flag | pending | pending | pending |
Question D2:
D2 — On a Malafat-fed profile, should PATCH /v1/payments say 403 "read-only profile" or 404 "not found"?
Project/branch/task: MUT-223 plan on main, server only.
ELI10: The ticket says a Malafat-fed profile's payments answer "not found". But the permission check runs before our
code and already says "this profile is read-only for payments" (403), exactly as Record Payment (settle) does today.
To get 404 we'd have to file this route under the "capture" permission instead of "payments", which also means
editing the writability table and the design brief that a test keeps in sync with it.
Stakes if we pick wrong: Either way nothing changes on the profile. A: the phone and portal see the same read-only
answer settle gives. B: we bend the permission model for one route.
Recommendation: A because 403 READ_ONLY_PROFILE is the honest, existing answer for every session payments write on a
Malafat-fed profile, and whether a profile is Malafat-fed is already public to its member through /v1/me, so 404 hides nothing.
Note: options differ in kind, not coverage — no completeness score.
Pros / cons:
A) Keep payments:write, answer 403 (recommended)
  ✅ Matches settle and every other session payments write on a Malafat-fed profile, so clients handle one refusal
  ✅ No edit to the writability matrix or the brief that writability-drift.test.ts checks cell by cell
  ❌ AC5's literal wording ("gives 404") needs a one-line note on the ticket for this one route
B) Use capture:write so it reaches the owner gate and 404s
  ✅ AC5 holds word for word: every refusal on both routes is 404
  ❌ Puts a /v1/payments route under the capture row, which MUT-61 kept separate so it "never widens payments"
  ❌ Edits WRITABILITY_MATRIX and hosted-portal.md's matrix block together, a new place for drift
Net: one honest 403 matching settle, against literal AC wording at the cost of the permission model's boundary.
Header: Malafat 403
Options:
A) Keep payments:write, 403
PATCH /v1/payments keeps requireScope('payments:write'). On a Malafat-fed profile it answers 403 READ_ONLY_PROFILE before the handler (as settle does). The AC5 test asserts 403 for this route and 404 for PATCH /v1/income; the OpenAPI description says so; a note goes on MUT-223. Human ~10 min / CC ~2 min.
B) capture:write, 404
PATCH /v1/payments uses requireScope('capture:write') so it reaches the owner gate and 404s. Update WRITABILITY_MATRIX capture row routes to name PATCH /v1/payments/{id} and the same cell in hosted-portal.md's writability-matrix block. Human ~45 min / CC ~5 min.

State: approved
Actual answer: A) Keep payments:write, 403 (D2, AskUserQuestion answer 2026-10-15)
Accepted scope: PATCH /v1/payments keeps requireScope('payments:write'); on a Malafat-fed profile it answers 403 READ_ONLY_PROFILE before the handler (as settle does). AC5 test asserts 403 for this route and 404 for PATCH /v1/income; OpenAPI description says so; a note goes on MUT-223.
History: none

### R3: How PATCH /v1/income refuses a payment that has allocations
Finding: #2, P3, confidence 9/10, plan §3 Ports row (`redateCapture(..., opts: { requireUnallocated: boolean })`), reviewer: native (Claude)
Plan baseline: §2 says PATCH /v1/income on an allocated payment gives 409 ALREADY_ALLOCATED, and §3 enforces it with a
`requireUnallocated` option on the store write (an option flag on a store method, used by one caller).
Runtime evidence: on an owned profile (the only kind that reaches the write, §2 rule 1 + D2) an existing payment can
gain allocations only through `POST /v1/payments/{id}/allocations`, which is `security: [{ apiKey: [] }]`
(routes/payments.ts:307). API keys are refused on owned profiles (auth/middleware.ts:234 `ownedProfileConflict`).
Settle allocates only the payment it creates, in the same write (receivables.ts:191-207). So a payment's
`allocatedMinor` is fixed at creation on an owned profile, and a route-level check on the pre-read can't race.
Comparison grid:
| Choice | Current (plan) | A | B |
|---|---|---|---|
| R3 where the "allocated → 409" check lives | store option `requireUnallocated` | route checks `allocatedMinor > 0n` on the pre-read; store method has no option; a comment cites payments.ts:307 + middleware.ts:234 | keep the store option (atomic in the write) |
| 409 ALREADY_ALLOCATED behavior (§2) | approved in plan | unchanged | unchanged |
| R2 | approved A (403) | unchanged | unchanged |
Question D3:
D3 — Should "this payment has allocations" be checked in the route or inside the store write?
Project/branch/task: MUT-223 plan on main, server only.
ELI10: PATCH /v1/income refuses a payment that already has money applied to an Owed entry (a settle payment). The plan
puts that check inside the database write as an on/off option, so it can never race. But on the profiles this route
serves, nothing can add allocations to an existing payment: only Malafat's API key can, and API keys are locked out of
owned profiles. A plain check on the row we already read is just as safe and keeps the store method simple.
Stakes if we pick wrong: A: if owned profiles ever accept API keys, a re-date could slip through on a payment allocated
a millisecond earlier, and the comment names that tripwire. B: one more option on a store method, tested in both stores.
Recommendation: A because the race can't happen on owned profiles today (payments.ts:307, middleware.ts:234), and an option-free store method is simpler to test and keep in sync across memory and Postgres.
Completeness: A=9/10, B=10/10
Pros / cons:
A) Check in the route (recommended)
  ✅ One store method, `redateCapture(orgId, id, userId, expectedVersion, receivedOn, at)`, the same for both routes
  ✅ Drops two contract-test cases for the option in both stores, and a memory/Postgres drift point
  ❌ Safe only while API keys stay locked out of owned profiles; a comment marks the assumption
B) Keep the store option
  ✅ Atomic in the write, so it stays correct even if allocation rules change later
  ❌ An option flag on a store method used by one caller, mirrored and tested in both stores
Net: a simpler store contract that rests on a documented assumption, against atomicity that guards a race nobody can trigger today.
Header: Alloc check
Options:
A) Check in the route
PATCH /v1/income reads the payment, and if allocatedMinor > 0n answers 409 ALREADY_ALLOCATED ("change it through PATCH /v1/payments/{id}") before writing. PaymentRepository.redateCapture has no option. A code comment cites routes/payments.ts:307 and auth/middleware.ts:234 as why no race exists. Route test covers the 409. Human ~15 min / CC ~3 min.
B) Keep the store option
Keep redateCapture(..., { requireUnallocated }) as planned: the predicate adds allocatedMinor = 0 inside updateMany, and the contract tests cover the option in memory and Postgres. Human ~45 min / CC ~6 min.

State: approved
Actual answer: A) Check in the route (D3, AskUserQuestion answer 2026-10-15)
Accepted scope: PATCH /v1/income reads the payment, and if allocatedMinor > 0n answers 409 ALREADY_ALLOCATED ("change it through PATCH /v1/payments/{id}") before writing. PaymentRepository.redateCapture has no option. A code comment cites routes/payments.ts:307 and auth/middleware.ts:234 as why no race exists. Route test covers the 409.
History: none

Approval readiness: PASS (checked R1/D1 structure A, R2/D2 A, R3/D3 A, all AskUserQuestion answers 2026-10-15; test
additions in §6 are required proof of the approved AC4/AC7 contracts, no new policy)

## Review findings by section

**Scope Challenge:** No issues found beyond the 8-file gate (resolved by D1, smaller arrangement).

**1. Architecture**
- `[P2] (confidence: 9/10) server/src/auth/middleware.ts:358-361`: `requireScope('payments:write')` answers 403
  READ_ONLY_PROFILE on a Malafat-fed profile before PATCH /v1/payments' owner gate, so the plan's "404" was wrong
  for that route.
- Checked, no issue: settle bumps `receivable.version` (prisma.ts:1495), so a re-date after a settle needs a fresh
  read. That's correct behavior, and a test is added under AC4.
- Checked, no issue: `excludeActions` stays even though API keys can't reach owned profiles today
  (middleware.ts:234). AC7 asks for it, and it keeps the feed clean if an owned profile is ever linked to Malafat
  (MUT-189 territory).
Dispositions: #1 accepted, D2 = A.

**2. Code quality**
- `[P3] (confidence: 9/10) plan §3 Ports row`: the `requireUnallocated` store option guards a race that can't occur
  on owned profiles (routes/payments.ts:307 is API-key only; middleware.ts:234 locks keys out of owned profiles).
Dispositions: #2 accepted, D3 = A (the check moves to the route, and the store method has no option).

**3. Tests**
```
CODE PATHS                                              USER FLOWS (via MUT-224/225)
[+] PATCH /v1/income/{id}                               [+] Fix an Owed date
  ├── owner gate (profileOwnerOf ≠ user) → 404 [GAP→§6 AC5]  ├── [GAP→MUT-224] pick date, save, see it
  ├── receivable branch                                  │   └── [GAP→MUT-224] 409 → refetch (MUT-221)
  │   ├── origin/creator/deleted mismatch → 404 [GAP→§6 AC5]  [+] Fix a payment date
  │   ├── pre-read version ≠ If-Match → 409 [GAP→§6 AC4]     └── [GAP→MUT-224] paid date follows
  │   ├── stale after settle → 409 [GAP→§6 AC4, added]
  │   └── write ok → 200, dueDate same [GAP→§6 AC1]
  ├── payment branch
  │   ├── allocatedMinor > 0 → 409 ALREADY_ALLOCATED [GAP→§6 2b]
  │   ├── INTEGRATION/REVERSED/other user → 404 [GAP→§6 AC5]
  │   └── write ok → 200 [GAP→§6 AC2]
  ├── date: malformed/future-in-org-tz → 422 [GAP→§6 AC4]
  └── audit income.owed.redated / payment.redated [GAP→§6 AC7]
[+] PATCH /v1/payments/{id}
  ├── Malafat-fed → 403 READ_ONLY_PROFILE (D2) [GAP→§6 AC5]
  ├── settle payment → 200, allocations same [GAP→§6 AC3]
  └── API key refused / device session ok [GAP→§6 AC6]
[+] audit list excludeActions (memory + prisma) [GAP→§6 store contract; existing routes-m6 audit tests = regression]
COVERAGE: 0/17 today (all new code), 17/17 specified in §6 at ★★★ (behavior + edge + error)
```
Two required proofs were added to §6, with no new policy: a stale version after a settle (AC4), and audit
assertions keyed on `action`, not row order (TODOS #8). Regression: the existing `routes-m6` audit tests and
`income-routes` DELETE tests must stay green unchanged. Tests to retire: none. Artifact:
`~/.gstack/projects/vAWK3-mutaba3a/basel-main-eng-review-test-plan-20261015-171844.md`.

**4. Performance:** No issues found. Each PATCH does one primary-key read, one conditional `updateMany`, at most
one re-read and one audit insert. `excludeActions` adds a `notIn` to a query already scoped by
`(organizationId, createdAt)`.

**Outside voice:** unavailable. The Codex CLI isn't installed, and the native fallback needs TaskOutput/TaskStop,
which this session doesn't declare. No outside coverage. Logged as unavailable.

**TODOS.md:** no new items. #8 (audit ordering) is honored in the tests, not fixed here.

## NOT in scope
- Amount, client, matter or note edits: Basel's decision, ADR-030 overpayment rules, a separate ticket.
- Reversing or deleting a settled payment: TD-126 stays open for that half.
- A `postedAfter`/`postedBefore` filter on `/v1/receivables`: only if MUT-224 proves it needs one.
- Portal and phone UI: MUT-224, MUT-225.

## What already exists
`ifMatch()`, `versionMismatch()`, `IfMatchHeaderSchema`, `UpdateResult<T>`, `assertIsoDate`, `assertNotFuture`,
`todayFor`, `profileOwnerOf`, `serializePayment`, `serializeIncomeEntry`, and the conversions conditional-update
shape are all reused, not rebuilt. No extraction was proposed.

## Diagram: PATCH /v1/income/{id}
```
request ─► sessionAuth ─► requireScope(capture:write) ─► ifMatch ─► owner gate ─┐
   (API key → refused)      (held on every profile)     (422 if absent)  (404)   │
   ┌──────────────────────────────────────────────────────────────────────────┘
   ▼
 date check (422) ─► getByIdIncludingDeleted(receivable)?
   ├─ yes: ADJUSTMENT ∧ mine ∧ live? ─no─► 404
   │        version == If-Match? ─no─► 409 VERSION_MISMATCH
   │        redateAdjustment (conditional) ─stale─► 409 / ─not_found─► 404
   │        audit income.owed.redated {from,to,version} ─► 200 IncomeResponse(+version)
   └─ no:  payments.getById: CAPTURE ∧ mine ∧ POSTED? ─no─► 404
           allocatedMinor > 0 ─► 409 ALREADY_ALLOCATED (D3)
           version check ─► redateCapture ─► audit payment.redated ─► 200
```

## Failure modes
| Path | Realistic failure | Covered by | User sees |
|---|---|---|---|
| Re-date write | Two tabs edit the same entry | version predicate + 409 test | clear refusal + currentVersion |
| Re-date write | Lost response, client retries | 409 on replay (version moved) | refusal; re-read shows date already moved |
| Owner gate | Malafat-fed capture via /v1/income | 404 test | not found |
| Audit feed | Session edit leaks to Malafat | excludeActions test | n/a (privacy) |
| Settle race | Settle lands between read and write | settle bumps version → 409 | clear refusal |
Critical gaps: 0.

## Worktree parallelization strategy
Sequential implementation, no parallelization opportunity (one module: `server/`; store → routes → contract regen
depend on each other).

## Implementation Tasks
Synthesized from this review's findings. Each task derives from a specific finding above.

- [ ] **T1 (P2, human: ~10 min / CC: ~2 min)** — routes/payments.ts — Keep `payments:write` and document the 403 on Malafat-fed
  - Surfaced by: Architecture #1 (D2)
  - Files: server/src/routes/payments.ts, server/src/__tests__/income-redate.test.ts
  - Verify: AC5 test asserts 403 READ_ONLY_PROFILE for PATCH /v1/payments on a Malafat-fed profile
- [ ] **T2 (P3, human: ~15 min / CC: ~3 min)** — routes/income.ts — Route-level allocation check, option-free `redateCapture`
  - Surfaced by: Code quality #2 (D3)
  - Files: server/src/routes/income.ts, server/src/repositories/{ports,memory,prisma}.ts
  - Verify: test 2b (409 ALREADY_ALLOCATED); contract test re-dates an allocated payment with allocations unchanged
- [ ] **T3 (P2, human: ~20 min / CC: ~3 min)** — tests — Stale-after-settle 409, and audit asserted by action
  - Surfaced by: Tests (prisma.ts:1495; TODOS #8)
  - Files: server/src/__tests__/income-redate.test.ts
  - Verify: `npm --prefix server test -- income-redate`

## Unresolved decisions
None.

## Completion summary
- Step 0: Scope Challenge — scope accepted as-is (smaller arrangement, D1)
- Architecture Review: 1 issue found
- Code Quality Review: 1 issue found
- Test Review: diagram produced, 2 gaps identified (both added as required proof)
- Performance Review: 0 issues found
- NOT in scope: written
- What already exists: written
- TODOS.md updates: 0 items proposed to user
- Failure modes: 0 critical gaps flagged
- Unresolved decisions: 0 in this review
- Outside voice: codex, unavailable (CLI not installed; native fallback tools not declared)
- Parallelization: 1 lane, 0 parallel / 1 sequential
- Lake Score: 0/1 (D3 picked the 9/10 option; D1 and D2 differed in kind, unscored)

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Outside Review | codex via `/plan-eng-review` | Independent 2nd opinion | 1 | unavailable | CLI not installed; no coverage |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | issues_open (all resolved) | 4 issues, 0 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | n/a, server-only (portal UI is MUT-224) |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **OUTSIDE COVERAGE:** codex, plan-review phase, unavailable (CLI not installed; native fallback lacks TaskOutput/TaskStop). No findings, no coverage.
- **VERDICT:** No review CLEAR in the strict sense: Eng Review found 4 issues, all resolved in-plan (D1–D3 approved, 2 test proofs added). Ready to implement; eng review required status satisfied by this run's resolved decisions.

NO UNRESOLVED DECISIONS
