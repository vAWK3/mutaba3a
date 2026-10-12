# MUT-61 — Received income on Malafat profiles as an unallocated payment Malafat allocates (implementation plan)

Tracker: Jira · barmajiyat · MUT via atlassian-barmajiyat · Backlog → In Progress (21) → In Review (3); Done is Basel's.
Epic: MUT-63 (Capture). Blocks: MUT-123 (phone side), MAL-1097 (Malafat allocation UI). Builds on: MUT-65 (Done; /v1/income, Payment.createdByUserId/projectId, PROFILE_DEPENDENT_DOMAINS), MUT-64 (Done; device session), MUT-66 (Done; inbox filing).
Server-only ticket: `server/` + the generated portal types. No phone, no portal UI.

## 0. What already exists (verified in code)
- `POST /v1/income` Received already writes `payments.create({..., allocations: [], createdByUserId})` — zero allocations by construction. `captureSource` is accepted but lands only in audit metadata.
- `DELETE /v1/income/{id}` already answers 409 `ALREADY_ALLOCATED` for an allocated Received, 204 on repeat, 404 for another user's.
- Both routes `requireScope('payments:write')`. On a Malafat profile `sessionScopesFor('MALAFAT')` withholds it → 403 READ_ONLY_PROFILE today.
- Store guard classifies `payments.create/allocate/reverse` and `receivables.createAdjustment` as `{ write: 'payments' }`.
- `GET /v1/customers` already serializes `externalReference`; `externalReferences.findByEntities` exists (read).
- InboxEntry already persists `captureSource String? @db.VarChar(20)` — the precedent for this column.

## 1. Core design decision — a new `capture` row, not a widened `payments` row
Widening `payments` for sessions on Malafat profiles (another PROFILE_DEPENDENT tweak) would also open: `receivables.settle` (MUT-65 mark-paid), Owed (`createAdjustment`), inbox `fileAsIncome`, and `payments.reverse` of *any* payment. Each would need its own carve-out.

Instead: one new matrix row, session-only like `expenses`:

| Domain | Scopes | Routes covered | API key | Session | Writer | Local |
|---|---|---|---|---|---|---|
| capture | capture:write | POST /v1/income (Received), DELETE /v1/income/{id} | none | read-write | USER | device |

- `capture:write` joins `SESSION_ONLY_SCOPES` (never issuable to a key; Malafat's published vocabulary unchanged).
- Two new store methods are the row's *entire* write surface, classified `{ write: 'capture' }`:
  - `payments.capture(input: CaptureReceivedInput)` — the input type has no `allocations`, `replacesPaymentId` or `reference`; implemented as `createPaymentTx(tx, { ...input, allocations: [], origin: 'CAPTURE' })`. Zero allocations is structural, not a convention.
  - `payments.undoCapture(orgId, id, userId, at)` — see §4.
- `payments` row is **unchanged**: Owed, settle, inbox filing as income, allocate, reverse stay READ_ONLY_PROFILE for a session on a Malafat profile, enforced by the existing layers. (Pins MUT-69's "filing Unsorted income onto a Malafat profile is not offered".)
- Received on a personal profile also moves to `payments.capture` (one path for both profile kinds; no behavior change there).

### Route scope vs ADR-048 decision 4 (flagged)
`POST /v1/income` changes to `requireScope('capture:write')` (static, as ADR-037 d5 requires). Owed additionally writes the `payments` row. That second check is **not** a content-resolved scope: it is
1. an explicit first-line check in the Owed branch through a new `assertSessionMayWrite(c, 'payments')` helper in `auth/middleware.ts` (reusing `mayWriteFor` + `writeRefusal` — one refusal shape), and
2. the store guard on `receivables.createAdjustment` (layer 3, unchanged).
The route-access index reports `capture:write` for the route. The ADR-037 amendment records why this does not reopen ADR-048 d4: there the *whole* write depended on the entry kind; here the route's floor is static and the extra domain is the store guard's job. Splitting into two routes was rejected: it would break the MUT-68 outbox contract (in review) for a distinction the store guard already enforces.

## 2. Data model — `server/prisma/schema.prisma` + one migration
`prisma/migrations/<ts>_mut61_payment_capture/migration.sql`:
- `enum PaymentOrigin { INTEGRATION CAPTURE }`; `Payment.origin PaymentOrigin @default(INTEGRATION)`.
- `Payment.captureSource String? @db.VarChar(20)`, same as InboxEntry; validated by the existing `CaptureSourceSchema`.
- Backfill: `UPDATE payments SET origin = 'CAPTURE' WHERE "createdByUserId" IS NOT NULL` (MUT-65/66 rows; near-empty in prod, since those aren't deployed). Old `captureSource` stays null; it's still in audit metadata (TD).
- Why two columns: `origin` is the durable "from a person, not Malafat" fact. `createdByUserId` is `onDelete: SetNull`, so it can't carry it. `captureSource` is optional in the MUT-65 contract, so its absence can't carry it either.
- No new index: Malafat filters per client (`[organizationId, customerId]` exists). Org-wide unallocated scans stay small. Revisit if MAL-1097 adds an org-wide inbox (TD).
- Ports: `PaymentRecord` gains `origin`, `captureSource`. `CreatePaymentInput` gains `origin` (required; `/v1/payments` passes INTEGRATION; `writeIncomeTx` for inbox filing passes CAPTURE + the entry's `captureSource`).

> Amended per D1 (Smaller arrangement): no `assertSessionMayWrite` helper and no `auth/middleware.ts` change. In §1, items 1 and 2 under "Route scope vs ADR-048 decision 4" become: (1) `incomeCaptureRulesFor(writer).owed === false` → `writeRefusal('payments', writer)`; (2) the store guard on `receivables.createAdjustment`.

## 3. `POST /v1/income` — `server/src/routes/income.ts`, `server/src/income/compose.ts`
- New pure `incomeCaptureRulesFor(writer: ProfileWriter)` in `income/compose.ts`:
  - personal → `{ received: true, owed: true, customer: 'optional' }`
  - MALAFAT → `{ received: true, owed: false, customer: 'linked-required' }`
  One function feeds both the route and `/v1/me`, so they can't disagree.
- Owed branch: `if (!rules.owed) throw writeRefusal('payments', writer)` before any validation → 403 READ_ONLY_PROFILE `{ domain: 'payments', writerOfRecord: 'MALAFAT' }` (AC 2). Plus `assertSessionMayWrite(c, 'payments')` for personal-profile parity with the old route scope.
- `resolveIncomeLinks(store, org, kind, links, rules)` gains the rules argument:
  - `linked-required` and no customer after resolution (a project alone brings its customer, as today) → 422 `CUSTOMER_REQUIRED`, field `customerId`.
  - Customer without a `MALAFAT`/`CUSTOMER` ExternalReference (`externalReferences.findByEntities`) → 422 `CUSTOMER_NOT_LINKED`, field `customerId`.
  - Matter of another client → existing 422 `PROJECT_CUSTOMER_MISMATCH` (AC 3). Unknown ids → existing `CUSTOMER_NOT_FOUND` / `PROJECT_NOT_FOUND`.
- Received → `store.payments.capture({ ..., captureSource: body.captureSource ?? null, createdByUserId: user.id })`. Audit `income.received` unchanged, plus `origin`.
- Idempotency (`idempotent(store, 'income.create')`, session-namespaced keys) is unchanged; MUT-68's outbox retries stay safe.

## 4. `DELETE /v1/income/{id}` — atomic undo (fixes a race that this ticket makes real)
Today: read `allocatedMinor`, then the generic `payments.reverse`, which *undoes allocations*. Malafat may now allocate these payments. An allocation landing between the check and the reverse would be silently unwound by the phone.
- New `payments.undoCapture(orgId, id, userId, at)` → `'reversed' | 'already-reversed' | 'allocated' | 'not-found'`. One conditional `updateMany` where `id, organizationId, origin = CAPTURE, createdByUserId = userId, status = POSTED, allocatedMinor = 0`. On count 0, re-read to classify. `allocate` holds `FOR UPDATE` on the same row, and Postgres re-checks the WHERE after the lock wait, so exactly one of them wins. The memory store mirrors this.
- Route: `reversed` → 204 + audit `payment.reversed {reason: 'capture_undo'}`; `already-reversed` → 204; `allocated` (any allocation, partial included) → 409 `ALREADY_ALLOCATED` (AC 5); `not-found` → 404.
- The Owed branch is unchanged. On a Malafat profile no session Owed row can exist, and a Malafat receivable id has origin ≠ ADJUSTMENT → 404.

## 5. `GET /v1/payments` (+ `/{id}`) — `routes/payments.ts`, `serializers.ts`, `schemas.ts`
- `serializePayment` adds:
  - `origin: 'integration' | 'capture'`
  - `captureSource`
  - `allocationState: 'unallocated' | 'partial' | 'allocated'` (from amount/allocated; REVERSED → `unallocated` with `status` saying why)
  - `projectId` (the matter the phone picked; today it is not serialized)
- `ListPaymentsQuerySchema` adds `origin` and `allocationState` filters. `allocationState=unallocated|partial` uses Prisma 6 field references (`allocatedMinor: { lt: fields.amountMinor }`) with `status: POSTED`.
  - MAL-1097's query: `?customerId=&origin=capture&allocationState=unallocated`.
  - A phone-undone payment comes back `status: REVERSED` and drops out of `status=POSTED` lists.

## 6. `GET /v1/me` — `routes/sessions.ts` `buildMe`
- Each profile gains `income: incomeCaptureRulesFor(writerOfRecord)` (AC 6). `access.capture: 'read-write'` appears automatically from the matrix.
- `MeSchema` is updated; additive JSON, so the Flutter app is unaffected until MUT-123 reads it.

## 7. Contract + generated artifacts
- `API_VERSION` → `1.14.0-mut61` (MUT-100 also plans 1.14.0; whichever lands second takes the next minor).
- Regenerate with `npm run openapi:generate` → `server/openapi/openapi.yaml`, plus `src/hosted/api/schema.d.ts` (portal types; no portal UI change).
- New 422 reasons documented: `CUSTOMER_REQUIRED`, `CUSTOMER_NOT_LINKED`.

## 8. Tests first (TDD) — vitest, Node 22 (`nvm use 22`), from `server/`
| AC | Test (file) |
|---|---|
| 1 | Malafat profile, session Received + linked client → 201; DB row `allocatedMinor 0`, no allocation rows, `origin CAPTURE`, `captureSource 'app'`, `createdByUserId` (income-routes.test.ts, memory + test:db) |
| 2 | Malafat profile Owed → 403 READ_ONLY_PROFILE `{domain:'payments'}`, nothing written, idempotency claim not completed (income-routes) |
| 3 | No client → 422 CUSTOMER_REQUIRED; unlinked client → 422 CUSTOMER_NOT_LINKED; matter of another client → 422 PROJECT_CUSTOMER_MISMATCH; matter alone → client derived and the linked check applies |
| 4 | API key `GET /v1/payments?origin=capture&allocationState=unallocated` returns it with origin/captureSource/allocationState/projectId; after a key allocation, it is gone from the filter and `allocationState: 'allocated'` |
| 5 | DELETE unallocated → 204 + REVERSED; repeat → 204; after full or partial key allocation → 409 ALREADY_ALLOCATED; other user → 404; Malafat-fed payment id → 404; **race** (test:db): concurrent allocate + undoCapture → exactly one wins, never REVERSED with allocations unwound |
| 6 | `/v1/me`: Malafat profile `income {received:true, owed:false, customer:'linked-required'}`, personal `{true,true,'optional'}`, `access.capture 'read-write'` (routes-sessions / routes-device-sessions) |
| 7 | writability.test.ts: `sessionScopesFor('MALAFAT')` ∋ capture:write ∌ payments:write; writability-drift.test.ts: new row ↔ hosted-portal.md; store-guard.test.ts: session×{personal, MALAFAT}×{capture, undoCapture, create, allocate, reverse, createAdjustment, fileAsIncome}, apiKey×capture → PRINCIPAL_NOT_ACCEPTED; route-security / writability-routes index updated |
| regress | Personal profile: Received with no client 201, Owed 201, settle 200, inbox filing as income still works and now writes `origin CAPTURE`; inbox file-as-income onto a Malafat profile still 403; `/v1/payments` key create writes `origin INTEGRATION`; migration backfill test |

Gate: `npm run lint && npm run typecheck && npm test && npm run test:db && npm run openapi:check` in `server/`, plus the root `npm run typecheck` (portal types).

## 9. Docs (definition of done)
- `.claude/DECISIONS.md`: an ADR-037 decision 7 amendment (MUT-61): the `capture` row, Owed/receivables/allocations still Malafat-only, the note on ADR-048 d4, the atomic-undo rule.
- `.claude/designs/hosted-portal.md` §5: matrix row between the markers, plus prose.
- `.claude/designs/mut-61-malafat-received-capture.md` + `-tests.md` (/eng-build writes this plan in as the brief).
- CHANGELOG, TEST_PLAN, TECH_DEBT (TD-084+, because MUT-102's branch holds TD-079..083 and ADR-058): captureSource not backfilled for pre-MUT-61 rows; no org-wide unallocated index.
- `server/DEPLOYMENT.md`: none (additive migration).

## 10. Ticket gaps / questions surfaced
- **Who recorded it.** MAL-1097 shows "who recorded it", but nothing here exposes a name to the API key (`createdByUserId` is a Mutaba3a user id Malafat can't resolve). Recommend adding `capturedBy: { userId, displayName } | null` to the payment view (one `include`, no N+1) — **owner call**, since it puts a user's name on the integration API.
- **Disconnected integration.** A DISCONNECTED Malafat org becomes "personal" (`profileWriterOf` → null), so Received with no client is accepted there. That is existing MUT-65 semantics; noted, not changed.
- **Inbox filing as Received onto a Malafat profile** stays refused. A follow-up if wanted (it would go through `capture` + the same link rules).
- **Collision.** MUT-100 (In Progress) also edits `schema.prisma`, migrations, `schemas.ts` and the OpenAPI version. Rebase-order risk only; no logic overlap.

---

# /plan-eng-review — 2026-10-12 (target: this file, scratchpad/mut-61-plan.md)

## Scope record
feature answers: none proposed (all items map to an AC); structure: A "Smaller arrangement" (D1, user answer 2026-10-12); accepted scope: plan §1–§10 minus the `assertSessionMayWrite` helper / `auth/middleware.ts` change; Owed refusal = `incomeCaptureRulesFor().owed` + store guard; pending remedies: none.
Scope Challenge result: scope accepted as-is (smaller arrangement preserves scope).

## Decision ledger

### R1: what a phone payment's projectId means once Malafat allocates it
Finding: A1, P2, confidence 8/10, server/src/repositories/prisma.ts:824-825, reviewer: Claude (Section 1). Quoted: `// MUT-65: a payment whose own projectId names it, OR one with at least one allocation on it` / `...(filter.projectId ? { OR: [{ projectId: filter.projectId }, { allocations: { some: { receivable: { projectId: filter.projectId } } } }] } : {})`. Also schema.prisma:666 "Never set by a Malafat-fed payment, which carries the link through its allocations instead."
Plan baseline: plan §3 stores the phone's optional matter in `Payment.projectId`; §5 serializes `projectId`; no rule for after allocation.
Runtime evidence: the project filter ORs the payment's own projectId with its allocations' projects. Project summaries ignore payment.projectId (summaries.ts:97 uses receivables only). So if Malafat allocates a phone payment for matter X to receivables on matter Y, `GET /v1/payments?projectId=X` keeps listing it under X forever.
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R1 projectId after allocation | unspecified (plan silent) | the matter picked at capture is a hint; the project filter matches a payment's own projectId only while it has no allocations; allocations are authoritative after that; OpenAPI says so; one test | leave as-is: it stays matched under the captured matter even after it's allocated elsewhere |
Question D2:
D2 — What does a phone payment's matter mean after Malafat allocates it?
Project/branch/task: main, planning MUT-61 (server only).
ELI10: The phone may tag a payment with a matter. Later Malafat staff allocate the money to real bills, maybe on a different matter. Today's project filter (prisma.ts:824-825) matches a payment by its own matter OR by its allocations' matters. So a payment the phone tagged "matter X" but Malafat applied to "matter Y" would show under both X and Y forever.
Stakes if we pick wrong: Malafat's per-matter payment list shows money under a matter it was never applied to; staff see a phantom payment on X.
Recommendation: A because allocations are Malafat's real answer and the hint should stop counting once they exist; a one-line where-clause change plus one test.
Note: options differ in kind, not coverage — no completeness score.
Net: a tiny filter rule versus a lasting wrong listing on matters the money never touched.
Header: Matter link
Options:
A) Hint until allocated (recommended)
The captured projectId stays stored and serialized, documented as the matter picked at capture. GET /v1/payments?projectId= matches a payment's own projectId only while allocatedMinor = 0; after that, only through its allocations. Personal profiles are unaffected because nothing allocates there. One test in income-routes / routes-m4. Human ~1h / CC ~5min.
B) Leave as-is
A payment matches its captured matter forever, plus any matter it's later allocated to. No code. Malafat must ignore payment.projectId once allocations exist, or show the payment under the wrong matter.

State: approved
Actual answer: A) Hint until allocated (D2, user answer 2026-10-12)
Accepted scope: keep projectId stored and serialized (OpenAPI: "the matter picked at capture"). The `PaymentFilter.projectId` OR branch on a payment's own projectId applies only while `allocatedMinor = 0` (prisma.ts:825 + memory.ts mirror). Plus one test: a phone payment tagged X and allocated to Y lists under Y, not X.
History: none

### Factual corrections (Section 2, no behavior change, no question)
- C1: the `capture` matrix row's "Routes covered" cell reads `/v1/income*`, not "POST /v1/income (Received), DELETE …": both kinds pass the route's `capture:write` floor, and Owed is additionally refused by the payments row.
- C2: new repo behavior (`payments.capture`, `payments.undoCapture`, `origin`/`allocationState` filters, the D2 project-filter rule) goes in a shared store contract (`server/src/repositories/__tests__/store-contract-m4.ts`, which holds payments) run by both `store-memory-m4.test.ts` and `store-prisma-m4.test.ts`. The backfill gets a migration test modeled on `migration-mut59.test.ts`.

### R2: regression contract for writability and income (Iron Rule)
Finding: T1, P1, confidence 9/10, server/src/__tests__/writability-routes.test.ts:250-262 and server/src/__tests__/income-routes.test.ts:240, reviewer: Claude (Section 3). Quoted: `['income: Received, no client', () => '/v1/income', … , 'payments'],` within the `cases` asserting `→ 403 READ_ONLY_PROFILE` with `expect(writes(h.calls)).toEqual([])`.
Plan baseline: plan §8 "regress" row (personal-profile Received/Owed/settle/inbox, Malafat inbox 403, key create INTEGRATION, migration backfill).
Runtime evidence: these two tables pin today's Malafat refusal for Received; the plan changes that on purpose. Everything else in them must keep passing unchanged.
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R2 regression contract | plan §8 regress row (informal) | Preserve: every other row in both READ_ONLY tables (credit, /v1/payments create, Owed, settle, customers/projects create, agreements, installments) stays 403 with zero writes; personal-profile Received (no client) / Owed / undo / settle unchanged; inbox file-as-income onto Malafat stays 403; API key on /v1/income stays PRINCIPAL_NOT_ACCEPTED and on capture store methods too; summaries' per-client `unallocated` includes a phone payment until it's allocated. Intentional changes: the "Received, no client" row on Malafat moves to 422 CUSTOMER_REQUIRED; new Received rows 201; `/v1/me` gains `income` + `access.capture`; payment view gains fields; project filter per D2 | Only the plan's §8 list as written (no summaries assertion, no API-key capture-method pin) |
Question D3:
D3 — Which existing behavior must MUT-61 provably not break?
Project/branch/task: main, planning MUT-61 (server only).
ELI10: This ticket opens one narrow door, "a person may record money received on a Malafat profile", in a wall that today refuses every session write there. Two test tables (writability-routes.test.ts:250-262, income-routes.test.ts:240) pin that wall. One row ("Received, no client → 403") changes on purpose. Every other row must keep refusing with zero writes, and the money totals Malafat shows must count a phone payment exactly once.
Stakes if we pick wrong: a too-thin contract lets a later refactor quietly let sessions settle bills or post credits on a law firm's ledger, or count phone money twice in Malafat's totals.
Recommendation: A because the wall is a security boundary and Malafat renders our summaries verbatim; the extra assertions are a few table rows.
Completeness: A=10/10, B=7/10
Net: a few more table rows, in exchange for proof the door opened only as wide as intended.
Header: Regression
Options:
A) Full contract (recommended)
Preserve every other row of both READ_ONLY tables (403, zero writes); personal-profile Received/Owed/undo/settle unchanged; inbox file-as-income on Malafat stays 403; API key gets PRINCIPAL_NOT_ACCEPTED on /v1/income and on payments.capture/undoCapture; GET /v1/summaries/organization and /customers/{id} show the phone payment in `unallocated` once and drop it after allocation. Intentional changes listed explicitly in the test names. Human ~3h / CC ~15min.
B) Plan's list only
Only plan §8's regress row: personal-profile paths, inbox on Malafat, key create INTEGRATION, migration backfill. No summaries assertion and no API-key pin on the new capture store methods. Human ~2h / CC ~10min.

State: approved
Actual answer: A) Full contract (D3, user answer 2026-10-12)
Accepted scope: column A of the R2 grid. Every other row of both READ_ONLY tables stays 403 with zero writes. Personal-profile Received/Owed/undo/settle are unchanged. Inbox file-as-income on Malafat stays 403. The API key gets PRINCIPAL_NOT_ACCEPTED on /v1/income and on payments.capture/undoCapture. Summaries organization + customer count the phone payment in `unallocated` once and drop it after allocation. Intentional changes are named in the test titles.
History: none

### R3: expose who captured a phone payment to Malafat (scope candidate)
Finding: S1, P2, confidence 9/10, server/src/serializers.ts:291-313 (serializePayment has no creator field) vs MAL-1097 scope "(amount, date, matter if any, who recorded it)"; reviewer: Claude (plan §10).
Plan baseline: plan §10 lists it as an owner call; not in accepted scope.
Runtime evidence: `serializePayment` emits no creator; `Payment.createdByUserId` is a Mutaba3a user id that Malafat cannot resolve; `User.displayName` exists (schema.prisma:205).
Comparison grid:
| Choice | Current | A | B | C |
|---|---|---|---|---|
| R3 capturedBy on the payment view | absent | Include: `capturedBy: { userId, displayName } \| null` on GET /v1/payments(+/{id}), one `include` on the list query (no N+1), null for Malafat-fed rows; OpenAPI documents it | Defer: Jira follow-up under MUT-63, MAL-1097 shows "from phone" without a name | Cut: never expose session user names to the integration |
Question D4:
D4 — Should Malafat see who recorded a phone payment?
Project/branch/task: main, planning MUT-61 (server only).
ELI10: MAL-1097's list of phone payments promises "who recorded it". The payment row only stores a Mutaba3a user id, which means nothing to Malafat. Adding the person's display name to the payment view is one database include. It does put a staff member's name on the integration API, but those people already belong to that firm.
Stakes if we pick wrong: defer it and MAL-1097 ships without the name it promises, or reopens this server ticket; include it and a name crosses the integration boundary.
Recommendation: A because MAL-1097 depends on it, the people are the firm's own staff, and it's one include with no extra queries.
Note: options differ in kind, not coverage — no completeness score.
Net: one field now, versus a cross-repo follow-up and a degraded allocation list.
Header: Captured by
Options:
A) Include
Add capturedBy { userId, displayName } | null to the payment view, via one include on payments.list/getById (no N+1); null for Malafat-fed payments; OpenAPI + serializer test + API-key list test. Human ~1h / CC ~10min.
B) Defer
File a Jira follow-up under MUT-63 linked to MAL-1097; MAL-1097 shows "from phone" with no name until then. No code now.
C) Cut
Never expose a session user's name to the integration; tell MAL-1097 to drop "who recorded it".

State: approved
Actual answer: A) Include (D4, user answer 2026-10-12)
Accepted scope: `capturedBy: { userId, displayName } | null` on GET /v1/payments and GET /v1/payments/{id}, through one `include: { createdBy: { select: { id, displayName } } }` on payments.list/getById (memory store mirrors it); null for Malafat-fed rows and for a deleted user; OpenAPI documents it; tests: serializer + API-key list on a Malafat profile.
History: none

Approval readiness: PASS — D1 (scope record, Smaller arrangement), R1/D2 (A), R2/D3 (A), R3/D4 (A); C1/C2 are factual corrections with no behavior change.

## Review body

### Section findings
**Scope Challenge:** no feature cuts; one structure change (D1).
**1. Architecture:**
- [P2] (confidence: 8/10) server/src/repositories/prisma.ts:825 — the project filter ORs a payment's own projectId with its allocations' projects, so a phone payment tagged X and allocated to Y lists under X forever. → D2 accepted (hint until allocated).
- Confirmed in plan, no change: [P1] (confidence: 9/10) server/src/routes/income.ts:121-123 — `if (payment.allocatedMinor > 0n) throw …; const result = await store.payments.reverse(…)` is check-then-act, and `reverse` (prisma.ts:851-857) unwinds allocations. Plan §4's conditional-update `undoCapture` fixes it. This is the payment-side twin of e12a5c2's receivable fix.
Dispositions: A1 accepted (D2); the race fix stays as planned.
**2. Code quality:** no main-report findings; corrections C1, C2 recorded above. Dispositions: C1/C2 applied as factual corrections.
**3. Tests:** coverage diagram below; regression contract D3 accepted; test-plan artifact at ~/.gstack/projects/vAWK3-mutaba3a/basel-main-eng-review-test-plan-20261012-184831.md. Dispositions: T1 accepted (D3).
**4. Performance:** no issues found. POST /v1/income on a Malafat profile adds one `externalReferences.findByEntities` read. `/v1/me` adds no queries (`incomeCaptureRulesFor` is pure). The per-client unallocated query uses the existing `[organizationId, customerId]` index. D4's `capturedBy` is one include, not N+1. Existing debt not introduced here: `paymentView` awaits allocations per item on list (payments.ts:250).

### Coverage diagram
```
CODE PATHS                                              USER FLOWS
[+] routes/income.ts POST /v1/income                    [+] Phone records cash on a Malafat profile
  ├── requireScope('capture:write')                       ├── [GAP→PLANNED] Received + linked client → 201
  │   ├── [GAP→PLANNED] session personal/MALAFAT 201      ├── [GAP→PLANNED] Outbox replay same Idempotency-Key
  │   └── [★★★ TESTED] apiKey → PRINCIPAL_NOT_ACCEPTED    └── [GAP→PLANNED] No/unlinked client → inline 422
  ├── kind=owed & !rules.owed → 403 [GAP→PLANNED]        [+] Malafat allocates
  ├── resolveIncomeLinks(rules)                           ├── [GAP→PLANNED] list ?origin=capture&allocationState=unallocated
  │   ├── no customer + linked-required → 422 [GAP]       ├── [GAP→PLANNED] allocate → leaves filter, capturedBy shown
  │   ├── customer w/o ExternalReference → 422 [GAP]      └── [GAP→PLANNED] summaries unallocated once
  │   ├── project of other client → 422 [★★★ TESTED pers.] [+] Phone undo
  │   └── project only → derived client, link check [GAP]  ├── [GAP→PLANNED] before allocation → 204, REVERSED
  └── payments.capture (allocations: [] by type) [GAP]    ├── [GAP→PLANNED] after partial/full allocation → 409
[+] routes/income.ts DELETE                               └── [GAP→PLANNED][→E2E test:db] concurrent allocate vs undo
  └── payments.undoCapture → reversed|already|allocated|not-found [GAP→PLANNED]
[+] routes/payments.ts list/get: origin, captureSource, allocationState, projectId, capturedBy, filters, D2 rule [GAP→PLANNED]
[+] routes/sessions.ts buildMe: income rules + access.capture [GAP→PLANNED]
[+] auth: capture row, capture:write session-only, store-guard classes [GAP→PLANNED]; drift test [★★★ TESTED, extend]
[+] migration: origin backfill [GAP→PLANNED]
COVERAGE (planned): all new paths have a planned ★★★ test; regression contract D3 pins existing rows.
```

### NOT in scope
- Inbox filing as Received onto a Malafat profile: stays refused (MUT-69 AC). A follow-up if wanted, via `capture` + the same link rules.
- Session Owed, allocations or receivables on Malafat profiles: Malafat-only, per the ticket.
- Portal UI (MUT-93) and the phone UI (MUT-123).
- Backfilling `captureSource` for pre-MUT-61 rows (it's in audit metadata) and an org-wide unallocated index: TECH_DEBT entries.

### What already exists
- `POST /v1/income` Received with `allocations: []` (routes/income.ts:57-73): reused, rerouted through `payments.capture`.
- `DELETE /v1/income` 409 ALREADY_ALLOCATED contract (income.ts:121): kept; made atomic.
- `externalReferences.findByEntities`, `serializeCustomer(..., reference)`: reused for the link check and the phone's picker.
- `unallocatedOf` (summaries/compute.ts:55): already shows phone money as unallocated per client; no change.
- The InboxEntry `captureSource VarChar(20)` precedent; the `store-contract-*` and `migration-mut59` test patterns.

### Diagram: capture → allocate
```
phone ──POST /v1/income (Received, linked client, matter?)──► payments.capture ──► Payment{origin:CAPTURE, allocated:0}
                                                                                       │
Malafat ──GET /v1/payments?customerId&origin=capture&allocationState=unallocated ◄───────┤
Malafat ──POST /v1/allocations/preview {paymentId} → POST /v1/payments/{id}/allocations ─► allocated>0 (FOR UPDATE)
phone ──DELETE /v1/income/{id} ─► undoCapture: UPDATE … WHERE allocatedMinor=0 ─► 204 | 409 ALREADY_ALLOCATED
```

### Failure modes
| Path | Realistic failure | Covered by | User sees |
|---|---|---|---|
| capture | client unlinked in Malafat after the phone cached the list | 422 CUSTOMER_NOT_LINKED test | failed entry with reason in Recent (MUT-69) |
| undo vs allocate | both at once | conditional update + test:db race test | 409 or 204, never a silent unwind |
| allocation to another matter | phantom listing under the captured matter | D2 rule + test | correct matter list |
| integration disconnected | profile turns personal; clientless Received accepted | existing MUT-65 semantics, noted | works; no error |
| outbox retry | duplicate capture | idempotent('income.create') existing tests | single payment |
Critical gaps: 0.

### Worktree parallelization strategy
Sequential implementation, no parallelization opportunity. A single module (`server/`), and every step touches `ports.ts`/`schemas.ts`.

## Implementation Tasks
- [ ] **T1 (P1, human: ~3h / CC: ~20min)** — server/auth — `capture` matrix row, `capture:write` session-only scope, store-guard classes, brief matrix row (C1 wording)
  - Surfaced by: plan §1, D1
  - Files: server/src/auth/{scopes,writability,store-guard}.ts, .claude/designs/hosted-portal.md
  - Verify: writability.test.ts, writability-drift.test.ts, store-guard.test.ts
- [ ] **T2 (P1, human: ~3h / CC: ~20min)** — server/data — `PaymentOrigin`, `origin`, `captureSource`, migration + backfill; `payments.capture`, atomic `payments.undoCapture`; store contract (C2)
  - Surfaced by: plan §2/§4, Section 1 race
  - Files: server/prisma/schema.prisma, server/prisma/migrations/<ts>_mut61_payment_capture/, server/src/repositories/{ports,prisma,memory}.ts, repositories/__tests__/store-contract-m4.ts
  - Verify: npm test, npm run test:db (race test)
- [ ] **T3 (P1, human: ~3h / CC: ~20min)** — server/income — `incomeCaptureRulesFor`, link rules, Owed refusal, routes on `capture:write`
  - Surfaced by: plan §3, D1
  - Files: server/src/income/compose.ts, server/src/routes/income.ts, server/src/schemas.ts
  - Verify: income-routes.test.ts, writability-routes.test.ts
- [ ] **T4 (P1, human: ~2h / CC: ~15min)** — server/payments — view fields (origin, captureSource, allocationState, projectId, capturedBy), filters, D2 project rule
  - Surfaced by: plan §5, D2, D4
  - Files: server/src/routes/payments.ts, server/src/serializers.ts, server/src/schemas.ts, repositories/{prisma,memory}.ts
  - Verify: routes-m4.test.ts + store contract
- [ ] **T5 (P1, human: ~1h / CC: ~10min)** — server/sessions — `/v1/me` income rules
  - Surfaced by: plan §6
  - Files: server/src/routes/sessions.ts, server/src/schemas.ts
  - Verify: routes-sessions.test.ts, routes-device-sessions.test.ts
- [ ] **T6 (P1, human: ~2h / CC: ~15min)** — regression contract D3
  - Surfaced by: Section 3 T1
  - Files: writability-routes.test.ts, income-routes.test.ts, inbox-filing.test.ts, summaries tests
  - Verify: npm test
- [ ] **T7 (P2, human: ~1h / CC: ~10min)** — contract + docs — API_VERSION, openapi:generate, portal schema.d.ts, ADR-037 amendment, CHANGELOG/TEST_PLAN/TECH_DEBT (TD-084+)
  - Surfaced by: plan §7/§9
  - Files: server/src/app.ts, server/openapi/openapi.yaml, src/hosted/api/schema.d.ts, .claude/*.md
  - Verify: npm run openapi:check; root npm run typecheck

### Unresolved decisions
None.

### Completion summary
- Step 0: Scope Challenge — scope accepted as-is (smaller arrangement, D1)
- Architecture Review: 1 issue found
- Code Quality Review: 0 issues found (2 factual corrections)
- Test Review: diagram produced, 1 gap identified (regression contract, D3)
- Performance Review: 0 issues found
- NOT in scope: written
- What already exists: written
- TODOS.md updates: 0 items proposed (follow-ups go to Jira, as this project tracks them)
- Failure modes: 0 critical gaps flagged
- Unresolved decisions: 0 in this review
- Outside voice: codex unavailable (not installed); native fallback unavailable (no TaskOutput in this session) — missing coverage
- Parallelization: 1 lane, 0 parallel / 7 sequential
- Lake Score: 1/1 (D3 picked the 10/10 option)

## Suppressed findings
- (4/10) The new `capture` row's `writerOfRecord: 'USER'` makes `writeRefusal` answer PRINCIPAL_NOT_ACCEPTED, not READ_ONLY_PROFILE, for an API key: consistent with `expenses`, likely fine.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Outside Review | codex via `/plan-eng-review` (default-on) | Independent 2nd opinion | 10 | unavailable | codex not installed; native fallback unavailable (no TaskOutput) |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 10 | issues_open | 2 issues, 0 critical gaps (all resolved: D2, D3; plus D1 structure, D4 scope) |
| Design Review | `/plan-design-review` | UI/UX gaps | 3 | — (other plans; MUT-61 has no UI) | — |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **OUTSIDE COVERAGE:** codex, plan-review phase, unavailable (CLI not installed, native fallback not dispatchable). Missing coverage, not clean.
- **VERDICT:** No review CLEAR (Eng Review issues_open = mapped work, all decisions resolved); eng review required. Every finding was resolved into accepted scope; ready to implement on the amended plan.
NO UNRESOLVED DECISIONS
