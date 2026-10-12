# MUT-65 — personal profiles accept income, clients and matters (test plan)

Companion to `mut-65-personal-profile-income.md`. Written before implementation, mirroring the `mut-39-writability-tests.md` / `mut-42-hosted-expenses.md` §9 pairing convention. Paths are under `server/`, except where marked `src/` (none in this ticket — see the design doc §2.8/§9). Test pyramid target per `CLAUDE.md`: unit 70% / integration 20% / e2e 10%; every acceptance criterion below maps to at least one test, most to several layers.

## Acceptance-criteria → test map

| # | Acceptance criterion (ticket + the locked-in settle addition) | Covered by |
|---|---|---|
| 1 | Personal profile, session creates Received: no client / with client / with client+matter | §2 unit (compose), §4 route tests (3 cases) |
| 2 | Personal profile, session creates Owed; omitting client → 422 field error | §2 unit, §4 route tests |
| 3 | Received-with-client appears in client's payments; Owed appears in owed totals; both per currency | §5 integration (read-surface tests) |
| 4 | Session creates a customer and a project under that customer | §4 route tests (reused routes) |
| 5 | Malafat-linked profile: every write above refused `READ_ONLY_PROFILE` / `writerOfRecord: MALAFAT`; nothing written | §1 unit (writability), §4 route tests (negative cases), §6 store-guard unit |
| 6 | Every write takes `Idempotency-Key`; replay returns original, creates nothing new | §4 route tests (idempotency cases) |
| 7 | Future-dated income rejected; backdated accepted | §3 unit (date validation), §4 route tests |
| 8 | Capture source lands on the audit row when present; writes without it still succeed | §4 route tests, §7 audit tests |
| 9 | Device can delete an income entry it created (undo), within writability rules | §4 route tests (DELETE /v1/income/{id}) |
| 10 | hosted-portal.md §5 matrix and code match (drift test green); ADR-037 amended | §1 drift test |
| 11 (locked-in addition) | Owed entry can be marked paid/settled; sets the effective paid date from a payment record; future `paidAt` rejected | §4 route tests (settle), §3 unit |

## 1. Unit: `src/auth/__tests__/writability.test.ts` (extended)

- `sessionAccessFor('payments', null) === 'read-write'`; `sessionAccessFor('payments', 'MALAFAT') === 'read'`.
- Same two assertions for `'customers'` and `'projects'`.
- `sessionAccessFor('agreements', null) === 'read'` (unchanged — agreements is **not** profile-dependent; a personal profile still cannot write agreements). Same for `'attachments'`, `'integration'`, `'audit'`, `'summaries'`.
- `sessionAccessFor('expenses', null) === 'read-write'` and `sessionAccessFor('expenses', 'MALAFAT') === 'read-write'` (unchanged — expenses was already profile-independent; this is a regression guard that MUT-65 didn't accidentally make expenses profile-dependent).
- `sessionScopesFor(null)` includes `customers:write`, `projects:write`, `payments:write`, `expenses:write`; `sessionScopesFor('MALAFAT')` excludes all three but still includes `expenses:write`, `customers:read`, `payments:read`.
- **New (eng-review finding — no existing test covers this):** `GET /v1/me`'s `access` map actually differentiates by profile. Extend `routes-sessions.test.ts`'s "lists each membership as a hosted profile" test (currently only asserts `byId[a.org.id].access`, the Malafat-fed org, against `sessionAccess()`) with a second assertion on `byId[b.org.id].access` (the personal, non-Malafat org already created in that test): `toMatchObject({ customers: 'read-write', projects: 'read-write', payments: 'read-write', expenses: 'read-write', integration: 'none' })`. Without this, §2.6's `GET /v1/me` change (`sessionAccess()` → per-organization `sessionAccessFor`) ships with zero test coverage of the one case it actually changes — the existing test only exercises the Malafat-fed org, whose values are unchanged by this ticket.
- `mayWriteFor('session', 'payments', null) === true`; `mayWriteFor('session', 'payments', 'MALAFAT') === false`; `mayWriteFor('apiKey', 'payments', null) === true` and `mayWriteFor('apiKey', 'payments', 'MALAFAT') === true` (API-key column is untouched on every profile — explicit non-regression assertion per the design doc's "what does NOT change" callout).
- `mayWriteFor('session', 'agreements', null) === false` (profile-dependent domains are exactly the three named; nothing else silently became writable).

**Drift test** (`server/src/__tests__/writability-drift.test.ts`, extended): for each of the three profile-dependent rows (`customers`, `projects`, `payments`), `expect(cells[4]).toBe(\`${row.session}; read-write on a personal profile\`)` — the exact literal suffix, no grammar/parser — plus a direct `expect(sessionAccessFor(row.domain, null)).toBe('read-write')` and `expect(sessionAccessFor(row.domain, 'MALAFAT')).toBe(row.session)`. Every other row's existing literal `row.session` comparison is unchanged. A mismatched brief edit (wrong suffix, or suffix on the wrong row) fails this assertion directly — no grammar to get wrong.

## 2. Unit: `src/income/__tests__/compose.test.ts` (new, pure — mirrors `expenses/compose.ts`'s test shape)

- `kind: 'owed'` with no `customerId` → validation error `CUSTOMER_REQUIRED_FOR_OWED`, field `customerId`.
- `kind: 'received'` with no `customerId` → no error (money can stand alone).
- `projectId` given, resolves to a different customer than the stated/explicit `customerId` → `PROJECT_CUSTOMER_MISMATCH` (reused reason).
- `projectId` given, no `customerId` given (received) → `customerId` is taken from the project (mirrors MUT-42 D6's existing rule, exercised here for the first time on the income path too).
- Owed's `dueDate` defaults to `dueDateFor(occurredOn, 'EOM_15')` when omitted — not `occurredOn` — including the boundary case where `occurredOn` is the last day of a month (e.g. `2026-01-31` → due `2026-02-15`) and a leap-February case (`2028-02-29` → due `2028-03-15`), to prove reuse of the existing `endOfMonth`/`daysInMonth` helpers rather than a reimplementation that mishandles month length.
- Owed's VAT fields are always `{ vatTreatment: 'OUT_OF_SCOPE', vatRateBasisPoints: 0, netMinor === grossMinor === amountMinor, vatMinor: 0n }`, regardless of any `VatRate` configured on the organization (explicit regression guard for the "deliberate simplification" in the design doc — a future change to compute real VAT must not happen by accident).
- Archived customer/project may still be linked (MUT-42 D6 precedent, re-asserted on this new path).

## 3. Unit: date validation reuse

- `occurredOn` later than `today` → rejected with the same reason/shape `payments.ts` already produces for a future `receivedOn` (not a new reason — a table-driven test asserts byte-identical error shape between the two call sites).
- `occurredOn` equal to `today` → accepted (same-day, not "future" — ADR-022's local-calendar-date discipline, reused).
- `occurredOn` backdated (e.g. 30 days ago) → accepted.
- Settle's `paidAt`: same three cases, reusing the identical helper call.

## 4. Route tests: `src/__tests__/income-routes.test.ts` (new) + `src/__tests__/receivables-settle.test.ts` (new)

Setup, mirroring `writability-routes.test.ts`: organization **P** (personal, no integration), organization **M** (Malafat, `CONNECTED` integration), one user with memberships in both.

**`POST /v1/income`, on P:**
- Received, no client → `201`; `Payment.customerId === null`; the response's `status === 'unallocated'`.
- Received, with client → `201`; `Payment.customerId` set; appears via `GET /v1/payments?customerId=`.
- Received, with client + matter → `201`; `Payment.projectId` set.
- Owed, with client only → `201`; `Receivable.origin === 'ADJUSTMENT'`, `agreementId === null`, `projectId === null`.
- Owed, with client + matter → `201`; `Receivable.projectId` set.
- Owed, no client → `422`, field `customerId`, reason `CUSTOMER_REQUIRED_FOR_OWED` (AC 2, exact wording).
- Future `occurredOn` (either kind) → `422` (AC 7).
- Missing `Idempotency-Key` → `422` (existing middleware behavior, asserted for this new route too).
- Replaying the same key + same body → `201` with the identical response body, **no second row** in either table (assert via a direct count, not just response equality — AC 6's "creates nothing new" is the load-bearing half).
- Replaying the same key with a **different** body (amount changed) → `409` (idempotency mismatch, existing middleware).
- `captureSource` present → the `income.received`/`income.owed` audit row's `metadata.captureSource` equals it. `captureSource` absent → the write still succeeds and the audit row has no `captureSource` key at all (not `null` — key absence, matching the existing optional-metadata convention).

**`POST /v1/income`, on M (Malafat-fed):**
- Every one of the six positive cases above → `403 READ_ONLY_PROFILE { domain: 'payments', writerOfRecord: 'MALAFAT' }`. A spy on the base store asserts **zero calls** to `payments.create` / `receivables.createAdjustment` (writability must refuse before any store write is attempted, not after).
- An API key belonging to M, calling `/v1/income` → `403 PRINCIPAL_NOT_ACCEPTED` (session-only route; the key never even reaches the writability-per-profile question).

**`DELETE /v1/income/{id}` (undo, AC 9):**
- Delete a just-created Received entry (no allocations) → `204`; `payments.getById` now shows `status: 'REVERSED'`; a second call → `204` again (idempotent).
- Delete a just-created Owed entry (no payments against it) → `204`; `receivables.getById` now excludes it from `GET /v1/receivables` (deletedAt set); a second call → `204` again.
- Delete an Owed entry that has since been partially settled (`paidMinor > 0`) → `409 { reason: 'ALREADY_SETTLED' }`; the row is untouched.
- Delete a Received entry that has since been allocated (via settle, or Malafat-side allocate — shouldn't happen cross-profile but test the guard anyway) → `409 { reason: 'ALREADY_ALLOCATED' }`.
- Delete an id created by **another user** (second membership on the same personal profile) → `404` (not `403` — never confirm existence to a non-owner, matching the house non-leaking convention).
- Delete an id that belongs to M (Malafat-fed, a real installment-origin receivable) while authenticated on P → `404` (cross-organization, existing convention) — and separately, authenticated on M itself as a session → the route never gets there because `payments:write`/writability already refuses at the profile level before the id is even looked up... **except** `DELETE` doesn't declare a write scope check ahead of lookup in the same way creates do; assert explicitly that a session on M cannot void/reverse *any* receivable or payment via this route, including ones it could theoretically guess the id of.
- Delete an unknown id → `404`.

**`POST /v1/receivables/{id}/settle` (AC 11, the locked-in criterion):**
- Full-amount settle (no `amount` given) → `201`/`200`(per house convention for this response shape — pin to whichever `POST /v1/receivables/{id}/credits` uses, since this mirrors it); receivable `status` flips to `SETTLED`; a `Payment` row exists with `allocatedMinor === amountMinor` and one `PaymentAllocation`.
- Partial settle (`amount` less than outstanding) → receivable stays `OPEN`, `paidMinor` increases by exactly `amount`.
- `amount` greater than outstanding → `422 ALLOCATION_EXCEEDS_OUTSTANDING` (reused reason, verbatim); nothing written.
- `paidAt` in the future → `422` (same shape as §3).
- `paidAt` omitted → defaults to today; `paidAt` backdated → accepted, and the resulting `Payment.receivedOn` equals the backdated value (this is the literal "sets paidAt" behavior from the locked-in resolution — assert the date lands on the *payment*, since `Receivable` itself carries no `paidAt` field, by design, §5 of the brief).
- Idempotency: replay with the same key → same result, no second payment row.
- On M (Malafat-fed) → `403 READ_ONLY_PROFILE`.
- Settling a receivable from a *different* organization's id while authenticated on P → `404`.
- Settling an already-`SETTLED` receivable → `422 RECEIVABLE_NOT_OPEN` or equivalent (reused from `credit`'s existing check in `payments/allocate.ts`; assert which exact reason by reading `checkCredit`'s current behavior at implementation time — pin whichever it is, don't invent a new one).

## 5. Integration: read-surface agreement (AC 3)

- Create Received with a client on P → `GET /v1/payments?customerId=` includes it; `GET /v1/summaries/customers/{id}` reflects it in the customer's received total for that currency, and in no other currency's block.
- Create Owed with a client on P → `GET /v1/receivables?customerId=` includes it with `status: 'OPEN'`; `GET /v1/summaries/organization` shows it in the Owed figure for its currency; after it becomes overdue (advance the clock past `dueDate`), the same figure appears in Overdue, not Owed-and-current (ADR-022 bucketing, exercised end-to-end for the first time on a session-created row).
- Two currencies captured on the same profile → each currency's block is independent; no cross-currency sum anywhere in the response (ADR-004 regression guard).
- Settle a partial amount → the customer's outstanding figure decreases by exactly the settled amount, in that currency only.

## 6. Unit: `src/auth/__tests__/store-guard.test.ts` (extended)

- `storeRefusal('session', null, { write: 'payments' })` → `null` (allowed).
- `storeRefusal('session', 'MALAFAT', { write: 'payments' })` → `READ_ONLY_PROFILE` error with `domain: 'payments'`.
- `storeRefusal('session', null, { write: 'agreements' })` → still refused (`READ_ONLY_PROFILE` — agreements stays out of session reach even on a personal profile; explicit non-regression case named in the design doc §2.3).
- The two new `receivables` methods (`createAdjustment`, `softDeleteAdjustment`) are present in `STORE_ACCESS`, classified `{ write: 'payments' }`; `STORE_ACCESS`'s compile-time exhaustiveness check (the mapped type over `LedgerStore`) is exercised by `npm run typecheck` failing if either is left unclassified — asserted by a repo-level smoke test the way MUT-39's original coverage did (every function-valued property of every repository is classified on the real store).
- Proxy test: inside a request on M, a direct call to `requestScopedStore(store).payments.create(...)` throws before reaching the base store; a spy on the base confirms zero invocation (mirrors MUT-39's existing proxy test, extended to the newly-conditional domains).

## 7. Audit tests

- `income.received`, `income.owed`, `income.owed.voided`, `payment.reversed` (reused for undo-Received), `payment.recorded` + `receivable.settled` (reused for settle) all appear with `actorType: 'USER'`, `actorId` = the session's user id — never `API_KEY`, never `SYSTEM` (SYSTEM stays reserved for lazy posting, per the existing MUT-39 test's "No other session read writes anything" guarantee; these are session *writes*, a separate, already-expected category).
- `captureSource` presence/absence, as in §4.

## 8. Contract and gates

- `ERROR_CODES`/`VALIDATION_REASONS` gain `CUSTOMER_REQUIRED_FOR_OWED`, `ALREADY_SETTLED`, `ALREADY_ALLOCATED` (the only genuinely new reasons; everything else is reused verbatim per the design doc).
- `openapi.yaml` regenerated; `npm run openapi:check` passes; API version bump (`1.12.0-mut65`).
- `route-security.test.ts`'s fixed session-operation count grows by the two new routes (mirrors MUT-42's "grows by 13" note for its own route count).
- Malafat's vendored contract: confirm no operation, scope, or schema it uses changes (this ticket touches no Malafat-reachable operation's shape — `POST /v1/customers`/`/v1/projects` gain a *second* principal but their request/response schemas are unchanged, so no vendored-contract refresh is expected; assert this explicitly rather than assume it, the way MUT-42 did for its own contract check).
- Full gates: lint, typecheck, `npm test`, `npm run test:db` (the migration applied from empty, and from a copy of the pre-MUT-65 schema with existing Malafat-fed rows — assert every existing row's `customerId`/`projectId` stays non-null and every existing reader still returns identical results before/after the migration, the way MUT-59's forward-repair migration was tested), `openapi:check`, `build`.

## 9. Mutation checks (run once during implementation, then reverted — proves each guard is load-bearing)

- Remove the `sessionScopesFor` wiring in `selectProfile` (revert to static `sessionScopes()`) → every positive Received/Owed/customer/project-create case in §4 fails with `INSUFFICIENT_SCOPE` instead of succeeding. Shows layer 2 is necessary.
- Remove the `mayWriteFor` change in `store-guard.ts` (revert to static `mayWrite`) → the same cases fail at the store layer instead, even if layer 2 were (hypothetically) bypassed. Shows layer 3 is independently necessary, not redundant with layer 2.
- Remove the `createdByUserId` ownership check in `DELETE /v1/income/{id}` → the "another user's entry" case in §4 wrongly succeeds (`204`) instead of `404`. Shows the ownership check is load-bearing, not cosmetic.
- Remove the `paidMinor === 0n` guard before `softDeleteAdjustment` → the "already-settled Owed" case wrongly deletes a receivable with real money applied to it.
- **New (eng-review finding):** Remove the `deletedAt` filter from `receivables.listEligible`/`countOutstandingByProject` (once added per the design doc's call-site audit, §2.1) → a voided Owed entry wrongly reappears as an eligible allocation target (`GET`-driven `plan()` in `routes/payments.ts`) and wrongly keeps blocking project archival (`routes/projects.ts:213`) after it was undone. Positive-path coverage: create an Owed entry on a personal profile, `DELETE /v1/income/{id}` it, then assert it is absent from `receivables.listEligible(...)`'s result and does not count in `receivables.countOutstandingByProject(...)` for its project.

## 10. Not covered here (explicitly deferred, per the design doc §9/§10)

- Portal UI/copy changes for personal-profile income becoming real (flagged as a follow-up ticket, not built or tested here).
- MUT-69's "recent entries" listing/undo UI — this plan tests the API primitives MUT-69 will consume (`createdByUserId`, the DELETE route), not MUT-69's own feature.
- MUT-66's inbox-filing route itself — this plan asserts `/v1/income`'s contract is stable and callable with the fields MUT-66 names ("Owed requires a client"), not MUT-66's own transaction/atomicity tests.
