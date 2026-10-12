# MUT-65 — Personal hosted profiles accept income, clients and matters from the user (design brief)

**Status:** planning (`/eng-ticket`, 2026-10-12). **Epic:** MUT-63 (Mutaba3a Capture). **Builds on:** `hosted-portal.md` §3, §5 (writability matrix), ADR-037, ADR-038, ADR-033, ADR-022; the landed shape of MUT-42 (`mut-42-hosted-expenses.md`) and MUT-44. **Consumed by:** MUT-68 (keypad capture), MUT-61 (log against a Malafat client/matter), MUT-66 (unsorted inbox filing), MUT-69 (recent entries / undo). **Branch:** not yet created (planning only; no worktree opened per instructions).

## 0. Tracker / status summary

Jira, `barmajiyat.atlassian.net` (cloudId `0d7aa5cf-389d-46d9-b734-1a96f4966c18`), project **MUT**. Status semantics on this board: `To Do` = not started (committed, not gated like a separate "Idea" backlog state), `In Progress`, `Done`. **MUT-65 is currently `To Do`.** This document is the `/eng-ticket` plan; it does not transition the ticket (per instructions) and does not write code.

**Resolution already locked in (2026-10-12, Jira comment 11000, do not re-litigate):** a minimal "mark settled" write is in scope. §4.4 below designs it.

## 1. Related tickets and blocker gate

- **Epic:** MUT-63, "Mutaba3a Capture: log income and expenses from your iPhone in seconds."
- **Blocks (outward):** MUT-68, "Keypad-first capture with targets, presets and an offline outbox" — the phone app's capture UI. MUT-65's write contract is what MUT-68 calls.
- **Relates:** MUT-61, "[Intake] Log income against a Malafat client and matter: client picker, project from matter, title suggestions from tasks" — a sibling capture flow for Malafat-linked profiles (still read-only per this ticket; MUT-61 is about picker UX, not a writability change).
- **Sibling (same epic, not linked but dependent per the orchestrator's brief):** MUT-66, "Unsorted inbox," whose "file as income" action explicitly defers to "MUT-65 rules" (Owed requires a client). §4 below is written so MUT-66's filing action is a direct, unmodified call to `POST /v1/income`.
- **Also under MUT-63:** MUT-69, "Recent entries on the phone: see what landed, fix it, undo it, file it" — needs to enumerate and undo entries a session created. Not planned here (out of this pass's scope per instructions), but §4.3/§5 below are shaped so MUT-69 has what it needs (`createdByUserId` on both ledger rows it will read).

**Blocker-gate check:** MUT-65 carries no `is blocked by` link, and no blocker is named in its description prose. **Nothing blocks planning or building this ticket.** (It is itself a blocker of MUT-68, the other direction.)

## 2. Where the code belongs

This is 100% `server/` work (Hono + Prisma hosted API, ADR-025). No change to `src/` (the local/offline app) and — with one flagged exception (§9) — no change to `src/hosted/**` (the read-only web portal), because the ticket's consumer is the phone capture app (MUT-63/68), which calls `/v1` directly, not the portal.

### 2.1 Schema (`server/prisma/schema.prisma` + one migration)

A single additive-but-column-altering migration, `prisma/migrations/<ts>_mut65_personal_income/migration.sql`:

| Table | Change | Why |
|---|---|---|
| `payments` | `customerId` → **nullable** (`DROP NOT NULL`) | Received can "stand alone... with no client" (ticket AC 1) |
| `payments` | **+ `projectId UUID NULL REFERENCES projects(id)`**, `@@index([organizationId, projectId])` | Received can optionally carry a matter; Payment has no project column today |
| `payments` | **+ `createdByUserId UUID NULL REFERENCES users(id)`** | Who captured it (audit convenience + MUT-69's ownership check); mirrors `Expense.createdByUserId` exactly |
| `receivables` | `projectId` → **nullable** | Owed's matter is optional (ticket AC 2); Agreement-created receivables keep a project always, so no existing row is affected |
| `receivables` | **+ `title String? `** | "what you did" (ticket, Owed); Receivable has no free-text field today |
| `receivables` | **+ `createdByUserId UUID NULL REFERENCES users(id)`** | Same reasons as Payment's |
| `receivables` | **+ `deletedAt DateTime? `** | Soft-delete for the undo path (§4.3); mirrors `Expense.deletedAt` exactly — see the enumerated call-site list below (not just "list/getById/summary"; `Receivable` has two read paths `Expense` doesn't) |

**Why alter existing tables rather than a new table, despite MUT-42's own migration being additive-only.** MUT-42's "new tables only" was a *choice*, not a house rule (its own brief: "reversible" means new tables for *that* migration's scope). Here, reusing `Receivable`/`Payment` is the better call because:
1. **The figures must agree with existing readers by construction, not by a second aggregation.** "Owed income appears in their owed totals" (AC 3) and "Both are per currency" already hold for free if Owed *is* a `Receivable`: `GET /v1/receivables`, `GET /v1/summaries/organization`, `GET /v1/summaries/customers/{id}` already read `Receivable` rows with no code change. A new table would need its own summary aggregation merged into every one of those, duplicating the exact kind of "one definition per money question" drift ADR-033/PATTERNS.md's "Reconcile on read" pattern exists to prevent.
2. **No Malafat-fed row is ever affected.** A session can only reach writes on an organization where `profileWriterOf(store, org) === null` (§3). On any organization with a `CONNECTED` Malafat integration, every `Agreement`/`Receivable`/`Payment` is created by the API key through the existing M3/M4 paths, which always supply a `customerId` and `projectId` — the loosened nullability is simply never exercised on that data. The migration is additive *in effect*: no existing row gains a null, no existing reader's assumption breaks.
3. **The `ADJUSTMENT` origin was already reserved for exactly this.** `ReceivableOrigin.ADJUSTMENT` exists in the schema and the ports interface, declared since M3, and is unused by any landed code path (`grep -rn ADJUSTMENT server/src` outside tests returns nothing). A free-standing receivable not created through an Agreement/Installment is precisely what that enum value was reserved for.

**`deletedAt` call-site audit (eng-review finding, verified against `server/src/repositories/prisma.ts`, 2026-10-12).** `Expense`'s soft-delete touches exactly four call sites (`getById`, `list`, `update`, `softDelete`). `Receivable` has six read call sites today, and two of them are neither "list", "getById" nor "summary" — they are existing, already-shipped reads that a soft-deleted `ADJUSTMENT` row must not silently keep feeding:

- `getById` (`prisma.ts:740`) — add `deletedAt: null`.
- `getByIds` (`prisma.ts:741-745`) — add `deletedAt: null`; used by `routes/payments.ts` (`paymentView`, `auditSettled`) and `agreements/create.ts` to resolve receivables referenced by id.
- `list` (`prisma.ts:762-777`) — add `deletedAt: null`.
- `credit`'s existence check (`prisma.ts:751`) — add `deletedAt: null`; a voided Owed entry must not be creditable.
- `listEligible` (`prisma.ts:746-749`) — **easy to miss**: filters only `status: 'OPEN'`, no `deletedAt` today (there's nothing to filter yet). It feeds `routes/payments.ts`'s allocation `plan()` (lines 93, 194, 283) — the preview/create/allocate-later flow. `softDeleteAdjustment` does not flip `status` away from `OPEN` (per §2.2, it's "a plain soft-delete"), so without this filter a voided Owed entry stays `status: 'OPEN'` and would still surface as an eligible allocation target for any payment on that customer/currency.
- `countOutstandingByProject` (`prisma.ts:778-781`) — **easy to miss**: same `status: 'OPEN'` filter, no `deletedAt`. It gates project archival (`routes/projects.ts:213`, "has posted activity / outstanding" check). Without this filter, undoing (voiding) an Owed entry the app just created would leave the project permanently un-archivable even though nothing is actually outstanding.

Both of the last two are reached from routes this ticket does not otherwise touch (`POST /v1/payments`'s allocation preview/create, apiKey-only; `PATCH /v1/projects/{id}/archive`), so a gap here is a regression in existing, already-tested behavior, not just an incomplete new feature. The test plan's mutation-check section (§9) should add: delete an Owed entry, then assert it no longer appears in `listEligible`'s result and no longer counts in `countOutstandingByProject`.

The cost accepted: `ReceivableRecord.projectId` and `PaymentRecord.customerId` become `string | null` in `ports.ts`, which ripples into every consumer that currently assumes non-null (listed in §5).

### 2.2 `server/src/repositories/ports.ts`

- `PaymentRecord`/`CreatePaymentInput`: `customerId: string | null`; add `projectId: string | null`; add `createdByUserId: string | null`.
- `ReceivableRecord`: `projectId: string | null`; add `title: string | null`; add `createdByUserId: string | null`; add `deletedAt: Date | null`.
- New: `CreateAdjustmentReceivableInput` (`organizationId, customerId, projectId: string | null, currency, amountMinor, title: string | null, dueDate: IsoDate, postingDate: IsoDate, createdByUserId: string, requestId: string | null`) and `ReceivableRepository.createAdjustment(input, at): Promise<ReceivableRecord>`.
- New: `ReceivableRepository.softDeleteAdjustment(organizationId, id, at): Promise<ReceivableRecord | null>` — restricted at the **route** layer (not the repository) to `origin === 'ADJUSTMENT' && paidMinor === 0n && creditedMinor === 0n`; the repository method itself is a plain soft-delete, kept generic so the guard logic lives in one visible place (`routes/income.ts`), matching MUT-42 D5's shape for `DELETE /v1/expenses/{id}`.
- `PaymentFilter.projectId` (already exists, documented as "payments with at least one allocation on the project") gains a second match path: a payment whose own `projectId` column equals the filter, OR an allocation on that project — an `OR`, not a replacement, since Malafat-fed payments never populate the new column and must keep matching via allocation.

**Cross-ticket finding (MUT-66 dependency, verified against `prisma.ts:784-799`), folded in here because this ticket owns the repository methods.** `PaymentRepository.create` opens its own `this.prisma.$transaction(...)` internally and returns; it cannot today be nested inside a caller's transaction. MUT-66 (unsorted inbox) needs exactly that: "file" must insert the income/expense row *and* delete the inbox entry atomically, so a failure rolls back both. The codebase already has the right idiom for this — internal `tx`-accepting helpers composed by the public method (see `settleReceivable(tx, receivableId, data)` at `prisma.ts:997`, used by both `payments.create`'s own transaction and `receivables.credit`). Apply the same shape here: factor `PaymentRepository.create`'s body into an internal `createPaymentTx(tx, input, at)` that the public `create` wraps in its own `$transaction`, and give `ReceivableRepository.createAdjustment` (new in this ticket) the same internal/public split from the start. Neither changes this ticket's own routes (`POST /v1/income`, `POST /v1/receivables/{id}/settle` still call the public `create`/`createAdjustment` exactly as written below) — the internal variant exists solely so MUT-66 can open one transaction, call `createPaymentTx`/`createAdjustmentTx`, then delete the inbox row, all inside it. Building this now avoids MUT-66 needing to re-touch this same repository code right after it lands.

### 2.3 `server/src/auth/writability.ts` — the per-profile writability change

This is the structural crux of the ticket. Today `WRITABILITY_MATRIX`'s `session` column and `writerOfRecord` are **static per domain**. MUT-65 requires three of ten rows — `customers`, `projects`, `payments` — to depend on the *actual profile*, not just the principal:

```ts
export const PROFILE_DEPENDENT_DOMAINS: ReadonlySet<Domain> = new Set(['customers', 'projects', 'payments']);

/** hosted-portal.md §5a (MUT-65 amendment): for these three rows the session
 * column is a function of the profile, not a constant. Personal profile
 * (profileWriter === null) → read-write; Malafat-fed → read, unchanged. */
export function sessionAccessFor(domain: Domain, profileWriter: ProfileWriter): Access {
  if (!PROFILE_DEPENDENT_DOMAINS.has(domain)) return matrixRow(domain).session;
  return profileWriter === null ? 'read-write' : 'read';
}

export function sessionScopesFor(profileWriter: ProfileWriter): readonly Scope[] {
  return WRITABILITY_MATRIX.flatMap((row) => row.scopes.filter((s) => granted(sessionAccessFor(row.domain, profileWriter), s))).filter(isScope);
}

export function mayWriteFor(principal: Principal, domain: Domain, profileWriter: ProfileWriter): boolean {
  if (principal === 'session' && PROFILE_DEPENDENT_DOMAINS.has(domain)) return profileWriter === null;
  return mayWrite(principal, domain); // unchanged for apiKey and the other 7 domains
}
```

`sessionScopes()` (today's static function, used in exactly one place) is replaced by `sessionScopesFor(profileWriter)`; `mayWrite()` stays as the static primitive `store-guard.ts` falls back to for every domain except the three profile-dependent ones.

**Drift-test consequence (eng-review finding, verified against `server/src/__tests__/writability-drift.test.ts:36-48`), flagged, not silently decided.** That test does a literal `expect(cells).toEqual([..., row.session, ...])` — it compares hosted-portal.md's markdown cell against `WRITABILITY_MATRIX[i].session`, a plain `Access` scalar. This design keeps `WRITABILITY_MATRIX` itself unedited for `customers`/`projects`/`payments` (`sessionAccessFor` is a wrapper function layered on top, not a matrix edit), so `row.session` for these three rows stays the literal string `'read'` forever — it never becomes "read-write on a personal profile." But the companion test plan (§1) asks the drift test to parse "richer cell text" via a new "parser grammar extension," which assumes the cell (and the comparison) *does* change shape. These two statements are inconsistent as written, and the test plan doesn't specify the actual cell format. **Recommended concrete fix** (so the two files can't drift from each other during implementation): keep the existing column and `row.session` exactly as the Malafat-fed value, and extend the cell text with a *fixed*, literal suffix rather than a general grammar — e.g. the hosted-portal.md cell becomes `` `read; read-write on a personal profile` `` for exactly the three rows in `PROFILE_DEPENDENT_DOMAINS`, and the drift test's per-row assertion becomes: for a profile-dependent row, `expect(cells[4]).toBe(\`${row.session}; read-write on a personal profile\`)` plus a direct `expect(sessionAccessFor(row.domain, null)).toBe('read-write')`; for every other row, the existing literal `row.session` comparison is unchanged. This needs no general parser and keeps the brief/code pairing exact. If the ticket owner wants a different convention for how hosted-portal.md communicates per-profile access to its readers, that's a documentation-style call or product call, not something I decided here — raised as open question in §9.

**What does NOT change, and why it's safe:**
- The **API-key column is untouched** for every domain, including these three. Unlike MUT-42 (where expenses had to become invisible to the key), MUT-65 adds no exposure: an API key's access to customers/projects/payments is exactly what it is today, on every organization, connected or not. This is a deliberate, stated non-goal ("MALAFAT keeps today's matrix" — ticket text) and is why no cross-principal canary sweep is needed here (contrast MUT-42 §2).
- `agreements` and `attachments` stay session:`'read'` globally — Owed is written **directly as a `Receivable`**, never through an `Agreement`/`Installment`, so the ticket's explicit out-of-scope item ("fee proposals... any change for Malafat-linked profiles") is met by construction: the `agreements` domain is simply never touched by this ticket.
- `requireScope()`'s existing refusal logic (`auth/middleware.ts`) needs **no change**: it throws `READ_ONLY_PROFILE` when a session lacks a write scope on a row whose *static* `matrixRow(domain).writerOfRecord === 'MALAFAT'`. For the three profile-dependent rows that static value stays `'MALAFAT'` in the table (representing the Malafat-fed case, which is still what's refused); on a personal profile the scope is simply granted by `sessionScopesFor`, so this branch never fires. No regression, no missed case — traced through both branches in §2.4.
- `keyOnlyRefusal()` is untouched: it only fires for routes whose `security` excludes `session`. The two routes being newly opened to sessions (`POST /v1/customers`, `POST /v1/projects`) gain `session` in their `security` array, so they stop going through that path entirely — they go through the normal `requireScope` path like every other session-reachable route.

### 2.4 `server/src/auth/middleware.ts`

One line in `selectProfile()`:
```diff
- return { kind: 'session', organization, user: identity.user, session: identity.session, scopes: sessionScopes(), writerOfRecord };
+ return { kind: 'session', organization, user: identity.user, session: identity.session, scopes: sessionScopesFor(writerOfRecord), writerOfRecord };
```
`writerOfRecord` is already computed on the line above via `profileWriterOf(store, organization.id)` — it was already being resolved per request, just not fed into scope computation. This is the single root-cause fix; everything else in §2.3–§2.5 is this same resolved value reaching the places that previously ignored it.

### 2.5 `server/src/auth/store-guard.ts`

`storeRefusal()`'s write branch currently calls the static `mayWrite(principal, access.write)`. It already has `profileWriter` in scope (it's a parameter of the enclosing function):

```diff
- return mayWrite(principal, access.write) ? null : writeRefusal(access.write, profileWriter);
+ return mayWriteFor(principal, access.write, profileWriter) ? null : writeRefusal(access.write, profileWriter);
```

`STORE_ACCESS` gains two entries for the new repository methods:
```ts
receivables: { ..., createAdjustment: { write: 'payments' }, softDeleteAdjustment: { write: 'payments' } },
```
No other `STORE_ACCESS` entries change — `customers.create`, `projects.create`, `payments.create` are already classified `{ write: 'customers' | 'projects' | 'payments' }`, and now resolve correctly through `mayWriteFor`.

### 2.6 `GET /v1/me` (wherever `HostedProfile.access` is assembled — `server/src/routes/sessions.ts`)

Today this reads the static `sessionAccess()` for the `access` map every profile in the response carries. It must become per-organization:
```diff
- access: sessionAccess(),
+ access: Object.fromEntries(WRITABILITY_MATRIX.map((row) => [row.domain, sessionAccessFor(row.domain, await profileWriterOf(store, org.id))])),
```
(eng-review correction: there is no exported `DOMAINS` constant in `server/src/auth/writability.ts` today — grepped, confirmed absent. `WRITABILITY_MATRIX.map((row) => row.domain)` is the existing, already-available way to enumerate domains; used directly above instead of inventing a new export.)
so the portal's "read-only surfaces explain themselves" copy (hosted-portal.md §7.4) continues to be driven by what the server actually grants, not a constant (flagged as a portal copy follow-up in §9 — the *mechanism* here is correct and required regardless of whether the portal's prose is updated in this ticket).

### 2.7 Routes — reused as-is, relaxed, or new

| Route | Change |
|---|---|
| `POST /v1/customers` (`routes/customers.ts`) | `security: [{ apiKey: [] }, { session: [] }]` (was apiKey-only). Handler: replace `keyAuth(c)` with a new `actorOf(c)` helper (added to `middleware.ts`, mirroring `postingActorOf`) that returns `{ actorType: 'API_KEY'|'USER', actorId }` for the audit call; organization already comes from `c.get('auth').organization`, which already works for both principals. **Add a guard**: `if (auth.kind === 'session' && body.externalReference) throw new ApiError('VALIDATION_FAILED', ...)` — a session has no Malafat integration to reference against; reject rather than silently ignore. |
| `POST /v1/projects` (`routes/projects.ts`) | Same shape of change as customers. |
| `PATCH`/`archive` on both | **Unchanged, apiKey-only.** The ticket's AC only asks for *create*; narrowing the diff to exactly what's asked avoids scope creep into update/archive semantics for session-owned rows (archiving someone's own captured client is a reasonable later ask, not this ticket's). |
| `POST /v1/payments`, `/v1/allocations/*`, `/v1/agreements*` | **Untouched.** Received/Owed never call the preview-token allocation dance (§2 of `payments.ts`) — that machinery is Malafat's multi-receivable UI and would be far heavier than a phone keypad needs. |
| **New: `routes/income.ts`** | `POST /v1/income`, `DELETE /v1/income/{id}` — §4.1–§4.3 |
| `routes/receivables.ts` | **+ `POST /v1/receivables/{receivableId}/settle`** — §4.4 |
| `routes/expenses.ts` | One field added to the existing create path: thread `body.captureSource` into the `expense.created` audit metadata (§4.5) |
| `schemas.ts` | New: `CaptureSourceSchema`, `IncomeKindSchema`, `CreateIncomeRequestSchema`, `IncomeResponseSchema`, `SettleReceivableRequestSchema`. One field added to `CreateExpenseRequestSchema`: `captureSource: CaptureSourceSchema.optional()`. |
| `serializers.ts` | `serializeIncomeEntry(...)` for the new response envelope (§4.1) |
| `app.ts` / `index.ts` | Mount `incomeRoutes(store)` the same way every other domain router is mounted |
| `openapi/openapi.yaml` | Regenerated by `npm run openapi:check`; minor version bump (`1.12.0-mut65`) |

No change needed to `routes/agreements.ts`, `installments.ts`, `fee-proposals.ts`, `retainers.ts`, `vat.ts`, `attachments.ts`, `import.ts`, `integration.ts` — none of these domains are touched by this ticket.

### 2.8 Portal (`src/hosted/**`)

**No API-client or UI change is required for MUT-65's stated acceptance criteria** — there is no portal-UI story in this ticket; the consumer is the phone capture app, calling `/v1` directly. One consequence is flagged, not built, in §9.

## 3. Writability enforcement — summary

Three layers, same shape as MUT-39/MUT-42, now profile-aware on three rows:

1. **Route `security`.** `/v1/income` and `/v1/receivables/{id}/settle` declare `security: [{ session: [] }]` only — like MUT-42's expense routes, this is a session-only capability; an API key gets `PRINCIPAL_NOT_ACCEPTED` (Malafat has its own, richer payment/allocation routes and never needs this simplified contract). `POST /v1/customers`/`/v1/projects` declare both principals (§2.7).
2. **`requireScope`.** Each route needs `customers:write` / `projects:write` / `payments:write` as appropriate. A session's effective scope set is now `sessionScopesFor(writerOfRecord)` (§2.4) — granted on a personal profile, refused with `READ_ONLY_PROFILE { domain, writerOfRecord: 'MALAFAT' }` on a Malafat-fed one, exactly matching the ticket's AC 5.
3. **Store guard.** `requestScopedStore`'s proxy calls `storeRefusal` → `mayWriteFor` (§2.5) for every classified write, so even a route or helper that forgot layer 1/2 cannot write past the guard — the same "no route can opt out" guarantee MUT-39 established.

## 4. The write contract

### 4.1 `POST /v1/income` — Received or Owed, one contract

```
POST /v1/income
security: [{ session: [] }]
scope:    payments:write
headers:  Idempotency-Key (required)
body: {
  kind: 'received' | 'owed',
  amount: string,                 // canonical decimal, like every other wire amount
  currency: string,                // ISO 4217
  occurredOn: string,              // YYYY-MM-DD; rejected if later than today (ADR-038 rule, §4.6)
  customerId?: string,             // required for 'owed'; optional for 'received'
  projectId?: string,              // optional for both; must belong to customerId
  title?: string,                  // 'owed' only — "what you did"
  notes?: string,                  // 'received' only — maps onto Payment.notes, which already exists
  dueDate?: string,                // 'owed' only; defaults to EOM_15 of occurredOn (dueDateFor(occurredOn, 'EOM_15'))
  method?: 'CASH' | 'BANK',        // 'received' only; defaults CASH
  captureSource?: 'app'|'siri'|'widget'|'quick_action'|'share'
}
```

Response `201`:
```
{
  id: string,                      // the underlying Payment.id (received) or Receivable.id (owed)
  kind: 'received' | 'owed',
  amount, currency, occurredOn, customerId, projectId, title, notes,
  dueDate,                         // owed only
  status: 'unallocated' | 'open' | 'settled',  // received: always 'unallocated' at creation; owed: OPEN|SETTLED mapped from ReceivableStatus
}
```

**Validation:**
- `kind === 'owed'` and no `customerId` → `422 VALIDATION_FAILED`, `{ field: 'customerId', reason: 'CUSTOMER_REQUIRED_FOR_OWED' }` — this is the ticket's own literal AC 2.
- `customerId`/`projectId` given but unknown to the organization → `422` (`CUSTOMER_NOT_FOUND`/`PROJECT_NOT_FOUND`), same convention M4/M7/MUT-42 already use for body-referenced ids (404 is reserved for path ids).
- `projectId` given with `customerId` (explicit or resolved) → must agree, else `422 PROJECT_CUSTOMER_MISMATCH` (MUT-42 D6, reused verbatim).
- Archived customers/projects may still be linked (MUT-42 D6 precedent: "last year's expense on a closed matter is legitimate" — same logic applies to logging a job against a client you've since archived).
- `occurredOn` future → `422`, same reason/shape as `payments.ts`'s existing `assertNotAbsurdDate(receivedOn, today, 'receivedOn')` check, reused for `occurredOn` (and for `settle`'s `paidAt`, §4.4). This is ADR-038's rule ("future-dated payments are rejected... backdated is accepted") ported from the local app's `Transaction.paidAt` to this new server write path — see §4.6 for the exact ADR note to add.
- `Idempotency-Key` required and namespaced per session the same way MUT-42 D4/§10 namespaces expense keys (`s:` + SHA-256(user id, key)) — this machinery is already built and reused unmodified.
- Writability: refused with `403 READ_ONLY_PROFILE { domain: 'payments', writerOfRecord: 'MALAFAT' }` on a Malafat-fed profile (AC 5), before any store write is attempted (layer 1/2, §3).

**Internals:**
- `kind: 'received'` → `store.payments.create({ organizationId, customerId: body.customerId ?? null, projectId: body.projectId ?? null, currency, amountMinor, receivedOn: occurredOn, method: body.method ?? 'CASH', reference: null, notes: body.notes ?? null, replacesPaymentId: null, createdByUserId: user.id, requestId, allocations: [] })`. Reuses the existing `PaymentRepository.create` transaction verbatim (number assignment, `allocatedMinor` stays 0) — **zero new repository logic for Received.** Audit: `income.received`, entityType `payment`, `metadata: { amount, currency, customerId, projectId, ...(captureSource ? { captureSource } : {}) }`.
- `kind: 'owed'` → `store.receivables.createAdjustment({ organizationId, customerId, projectId: body.projectId ?? null, currency, amountMinor, netMinor: amountMinor, vatMinor: 0n, grossMinor: amountMinor, vatTreatment: 'OUT_OF_SCOPE', vatRateBasisPoints: 0, title: body.title ?? null, dueDate: body.dueDate ?? dueDateFor(occurredOn, 'EOM_15'), postingDate: occurredOn, postedAt: now, createdByUserId: user.id, requestId })`. Audit: `income.owed`, entityType `receivable`.

**Deliberate simplification — flagged, not silently decided:** captured Owed receivables are always `OUT_OF_SCOPE` VAT with a zero rate. The ticket's AC and proposed solution never mention VAT for Received/Owed, and a personal profile has no VAT settings UI; computing a real `VatRate` for a one-off capture would need VAT fields in the capture app's keypad flow that MUT-68 does not describe. If VAT-aware personal capture is wanted later, it is a follow-up, not a silent gap — called out again in §10.

**Due date default for Owed — resolved (2026-10-12, ticket owner):** `EOM_15` (end of the month `occurredOn` falls in, plus 15 days), not `occurredOn` itself — a same-day default was flagged as unrealistic (it would make an unpaid Owed item "overdue" (ADR-022) the very next calendar day unless marked settled immediately). `EOM_15` is not a new rule: it's one of the existing `PAYMENT_TERMS` (`server/src/dates.ts:10`) already used for agreement/retainer line items, computed by the existing `dueDateFor(postingDate, terms)` helper (`dates.ts:99-114`) — reused verbatim, not reimplemented. No new date math, no new constant.

### 4.2 Capture-source tag — shared across all four writes

`captureSource` is **not** a persisted column anywhere. It is validated by one shared `CaptureSourceSchema` (`z.enum(['app','siri','widget','quick_action','share']).optional()`) and written only into the relevant `AuditEvent.metadata`, exactly the pattern every other optional audit detail already uses (`...(body.replacesPaymentId ? { replacesPaymentId: ... } : {})`). This satisfies the AC directly ("recorded on the audit row... writes with none still succeed") with no schema change and no new query path, and keeps it uniform across `income.received`, `income.owed`, `receivable.settled` (via settle, §4.4) and `expense.created` (§4.5, the one existing write path the ticket explicitly says must also gain it).

### 4.3 `DELETE /v1/income/{id}` — undo

```
DELETE /v1/income/{id}
security: [{ session: [] }]
scope:    payments:write
```
`id` is resolved across both tables (collision-free UUIDs, so trying one then the other is unambiguous and cheap):

1. **Try `receivables.getById`.** If found: must be `origin === 'ADJUSTMENT'` and `createdByUserId === session.user.id`, else `404` (never reveal that an id exists but belongs to someone else or to Malafat — same non-leaking discipline as every cross-organization 404 in this codebase). Must have `paidMinor === 0n && creditedMinor === 0n`, else `409 CONFLICT { reason: 'ALREADY_SETTLED' }` — "undoing an entry the app just created" (ticket scope) stops being safe the moment money has been applied to it; that's an edit, explicitly out of scope. Otherwise `store.receivables.softDeleteAdjustment(...)`, audit `income.owed.voided`, `204`.
2. **Else try `payments.getById`.** Must be `createdByUserId === session.user.id` and `status === 'POSTED'` and `allocatedMinor === 0n`, else `404`/`409 { reason: 'ALREADY_ALLOCATED' }` respectively. Otherwise `store.payments.reverse(organizationId, id, 'capture_undo', now)` — **the existing, tested M4 reversal path, reused unmodified.** No new "delete" semantics for Payment at all: "undo" *is* reverse here, which already has the right audit trail and already excludes the row from outstanding math.
3. **Neither found** → `404`.

Repeated calls are naturally idempotent (`204` for an already-voided/-reversed row of this organization, per the MUT-42 D5/§10 convention for soft-deletes), so no `Idempotency-Key` is required on this route.

### 4.4 `POST /v1/receivables/{receivableId}/settle` — the new, locked-in criterion

```
POST /v1/receivables/{receivableId}/settle
security: [{ session: [] }]
scope:    payments:write
headers:  Idempotency-Key (required)
body: {
  amount?: string,        // defaults to the full outstanding amount
  paidAt?: string,        // defaults to today; rejected if later than today
  method?: 'CASH'|'BANK', // defaults CASH
  captureSource?: ...
}
```

This is the ticket's own description of ADR-038's rule, applied to a receivable rather than a `Transaction`: *paidAt is not a field you set directly — it comes from a payment record.* Concretely: `amount ?? outstandingOf(receivable)` is validated `≤ outstandingOf(receivable)` (else `422 ALLOCATION_EXCEEDS_OUTSTANDING`, the exact reason `payments/allocate.ts` already defines); `paidAt` is validated with the same `assertIsoDate` + `assertNotAbsurdDate(paidAt, today, 'paidAt')` pair `POST /v1/payments` already applies to `receivedOn` (§4.6).

Internally this calls **the same `PaymentRepository.create`** that both `/v1/payments` and `/v1/income` (Received) use, with exactly one allocation:
```ts
store.payments.create({
  organizationId, customerId: receivable.customerId, projectId: receivable.projectId,
  currency: receivable.currency, amountMinor, receivedOn: paidAt ?? today,
  method: body.method ?? 'CASH', reference: null, notes: null, replacesPaymentId: null,
  createdByUserId: user.id, requestId,
  allocations: [{ receivableId: receivable.id, amountMinor }],
}, now)
```
This is the **existing, tested M4 one-transaction path** (payment + allocation + the receivable's `paidMinor`/status recompute, atomically) — zero new repository code for settlement math. No preview-token dance: unlike Malafat's `/v1/payments` (built for a multi-receivable, multi-strategy allocation UI), a single named receivable needs no suggestion/strategy machinery, so the route skips straight from validated input to `payments.create`.

Response: `{ receivable: serializeReceivable(...), payment: serializePayment(...) }`, mirroring `POST /v1/receivables/{id}/credits`'s existing `{ receivable, credit }` response shape. Audit: `payment.recorded` (reused) + `receivable.settled` when the status flips (reusing `payments.ts`'s existing `auditSettled` helper, which already does exactly this check) — both carry `captureSource` in metadata when present.

**Restriction:** since on a personal profile the only receivables that can ever exist are `ADJUSTMENT`-origin ones created through `/v1/income` (agreements stay out of session reach entirely, §2.3), no explicit origin check is needed in this route — the writability matrix already guarantees it can never reach an `INSTALLMENT`/`RETAINER_CHARGE` receivable belonging to a Malafat-fed profile (that profile's session access on `payments` is `'read'`, so `requireScope` refuses before the handler runs).

### 4.5 `expenses.ts` — thread `captureSource` through the existing create route

One-line addition to `CreateExpenseRequestSchema` and the `expense.created` audit metadata assembly in `routes/expenses.ts` (§4.2). No other change to MUT-42's landed code.

### 4.6 Date validation — making ADR-038's rule explicit on the server

ADR-038, as written, is scoped to the local app's `Transaction.paidAt`. This ticket applies the same *rule* (reject future, accept backdated) to three new server-side date fields (`occurredOn`, `settle`'s `paidAt`) by reusing the exact helper (`assertNotAbsurdDate`) `payments.ts` already applies to `receivedOn`. **I recommend an explicit ADR-038 addendum** (not a new ADR — same rule, new surface) recording that the server now enforces this independently of the local app, since a reviewer reading ADR-038 cold would reasonably assume it's local-app-only. Exact text to add, for implementation to paste into `DECISIONS.md` under ADR-038:

> **Addendum 2026-10-12 (MUT-65).** The same rule — a payment date is never later than today; backdating is accepted — is now also enforced server-side, on `server/`'s `POST /v1/income` (`occurredOn`) and `POST /v1/receivables/{id}/settle` (`paidAt`), reusing the validation `POST /v1/payments` already applies to `receivedOn`. This is the same rule applied to a second surface, not a new decision.

## 5. Data model mapping — summary table

| Ticket concept | Server entity | Required fields | Optional fields | Read surfaces that show it, unchanged |
|---|---|---|---|---|
| **Received**, no client | `Payment`, `customerId: null` | amount, currency, receivedOn | projectId, notes, method | `GET /v1/payments` (org-wide list only — no customer to filter by) |
| **Received**, with client (+ matter) | `Payment`, `customerId` set | + customerId | projectId | `GET /v1/payments?customerId=`, client-detail Payments tab, `GET /v1/summaries/customers/{id}` |
| **Owed** | `Receivable`, `origin: 'ADJUSTMENT'`, `agreementId: null` | customerId, amount, currency, dueDate | projectId, title | `GET /v1/receivables`, `GET /v1/summaries/organization` (Owed/Overdue), client-detail Receivables tab |
| **Mark settled** | New `Payment` + `PaymentAllocation` against the `Receivable`, via the existing M4 transaction | receivableId, amount (≤ outstanding) | paidAt, method | Same as Owed's, plus `GET /v1/payments` |
| **Undo (Received)** | `Payment.reverse()` (existing M4 method, unmodified) | — | — | Reversed payments are excluded from outstanding math by existing status logic |
| **Undo (Owed)** | `Receivable.deletedAt` (new soft-delete, mirrors `Expense`) | — | — | Every list/get/summary query excludes `deletedAt IS NOT NULL` |
| **Capture source** | `AuditEvent.metadata.captureSource` | — | — | `GET /v1/audit` (API-key only; irrelevant here since these actions are session-only and thus invisible to the key regardless) |
| **Create client/matter** | Existing `Customer`/`Project` creation, unmodified | — | — | Everywhere customers/projects are already read |

No new tables. Every change is to `Payment`/`Receivable` nullability plus two new columns each, and two new repository methods (`createAdjustment`, `softDeleteAdjustment`) on `ReceivableRepository`.

## 6. Customer/project creation

`POST /v1/customers` and `POST /v1/projects` are reused unmodified in every way except `security` and actor derivation (§2.7). No new validation is needed beyond what already exists (name required, currency required on project, etc.) — a session simply becomes a second kind of caller the existing handler already serves correctly once `c.get('auth').organization` resolves for both kinds (it already does) and the audit actor is derived correctly (the one real code change, via `actorOf(c)`).

## 7. Capture-source tag — audit threading

Covered fully in §4.2. Repeated here only to state the AC mapping explicitly: *"A write made by the app or its extensions with a capture source lands on the audit row; writes with none still succeed"* is met because `captureSource` is an optional zod field spread conditionally into `metadata`, never required, never blocking a write that omits it.

## 8. Quality-bar pass

**DRY / reuse.** Explicitly reused, unmodified: `PaymentRepository.create` (Received, and the engine under `settle`), `PaymentRepository.reverse` (undo-Received), the session idempotency namespacing from MUT-42 D4, the `{ read }`/`{ write }` store-guard classification scheme from MUT-39, the `actorOf`-style pattern from ADR-037 §4.4, `assertNotAbsurdDate`/`assertIsoDate` from `agreements/compose.ts`, MUT-42 D6's archived-entity-still-linkable rule, and the exact soft-delete shape (`deletedAt`, filtered at every read) MUT-42 established for `Expense`. New, and justified as new: `ReceivableRepository.createAdjustment`/`softDeleteAdjustment` (no existing method creates a bare receivable outside an agreement), `sessionAccessFor`/`sessionScopesFor`/`mayWriteFor` (the one genuinely new mechanism — per-profile writability — which nothing in MUT-39/42 needed, since expenses were globally session-writable and never profile-conditional).

**Testability.** Every new piece of logic is either a pure function (`sessionAccessFor`, `mayWriteFor` — table lookups with one branch) or a thin route composing existing, already-tested repository methods. The one piece of real new repository logic (`createAdjustment`) is a straight insert with no derived math, testable as a contract test on both `MemoryLedgerStore` and Prisma exactly like every other repository method (PATTERNS.md "Money math is pure and tabular" / the standing `src/repositories/__tests__` contract-test convention).

**Scalability.** No new query shape: receivable/payment lists already paginate by `(organizationId, ..., createdAt, id)` keyset cursors; the new nullable columns extend existing indexes (`@@index([organizationId, projectId])` already exists on `receivables`, now simply tolerant of null; the new `payments.projectId` index is new but identically shaped). No N+1: `/v1/income`'s create is one or two repository calls (customer/project lookups for validation, one create), matching the existing expense-create route's call count.

**Cost.** Zero new infrastructure (no bucket, no secret, no service). Two new columns per table, both nullable, both cheap. The settle route adds one more session-reachable write to the existing per-request integration lookup (MUT-39's documented per-session cost), no different from any other session write.

**Constraints respected:** ADR-004 (original currency preserved, no conversion — Received/Owed never touch FX), ADR-022 (overdue computed server-side in the organization's timezone via the existing `todayFor`, not reimplemented), ADR-033's "one definition" discipline (Owed is a real `Receivable`, read by the one existing Owed/Overdue aggregation), ADR-038 (dates enforced via the existing helper, §4.6), the closed, non-hierarchical scope vocabulary (no new scope needed — `customers:write`/`projects:write`/`payments:write` already exist; this ticket changes who gets them, not what they are).

## 9. Gaps found — resolutions (2026-10-12)

**Due-date default for Owed — resolved.** `EOM_15`, computed via the existing `dueDateFor` helper. See §4.1.

**hosted-portal.md's per-profile cell convention — resolved, ticket owner delegated the wording call.** Locking in the suffix already specified in §2.3 as the final wording, not just a mechanism placeholder: the matrix cell for each of the three profile-dependent rows (`customers`, `projects`, `payments`) reads `` `read; read-write on a personal profile` ``, and the drift test asserts that literal string plus `sessionAccessFor(row.domain, null) === 'read-write'`. No dedicated extra column, no link-out — the inline suffix keeps the existing table shape and is implemented in this ticket (§2.3).

**The hosted portal's read-only copy becomes inaccurate for personal profiles once this ships — kept out of scope, follow-up ticket to be filed.** `hosted-portal.md` §7.4 hard-codes: *"`null`: 'Income isn't recorded on hosted profiles yet. This profile is for expenses.'"* (also asserted byte-for-byte in `src/hosted/pages/__tests__/views.test.tsx:204`, sourced from `src/hosted/i18n/en.json:85`). After MUT-65, a personal profile's income **is** recorded — by the user, through the phone app — so this string becomes false, and the portal's read-only "Record payment"/edit affordances that §7.4 currently suppresses unconditionally for read-only domains arguably should unsuppress for personal profiles too. That's `src/hosted/**` portal-UI work (copy + conditional affordance + updated test), a different module than this ticket's `server/` scope, not required by any MUT-65 AC, and large enough (an actual UI/UX call on whether to also enable editing, not just reword a sentence) that it stays a fast-follow rather than folded into this build. Filed as MUT-93 so it isn't lost the way MUT-44's CSP gap was before MUT-45 picked it up.

## 10. Business / product impact

MUT-63 (Mutaba3a Capture) promises logging income "in seconds" from a phone; MUT-34/ADR-037 built the hosted service and portal but left every personal (non-Malafat) hosted profile permanently read-only, meaning a freelancer with no firm behind them had no door to use the capture app at all — the exact user MUT-65's "personal profile" concept (hosted-portal.md §3.1: "operator-provisioned organization with no Malafat integration and the user as its only member") was designed for but never wired to a write path. This ticket is the one that makes that wiring real: it is a direct, named blocker of MUT-68 (the keypad capture screen), so nothing in the capture epic can ship for a personal-profile user until this lands. The per-profile writability mechanism (§2.3) is also the one piece of new infrastructure MUT-61 (Malafat-linked capture UX) and MUT-66 (unsorted inbox filing) both depend on being correct, since both explicitly defer their own "is this writable" question to this ticket's rules.
