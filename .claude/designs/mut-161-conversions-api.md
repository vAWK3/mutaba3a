# MUT-161 — Hosted `/v1/conversions` API

**Status**: Planned (pending `/plan-eng-review`)
**Ticket**: MUT-161, Backlog → will move to Planned once this brief is approved
**Epic/relates**: MUT-141 (local conversion logging, In Review, merged to local main `7425d80`) · blocks MUT-159 (mobile "log a conversion", Backlog, out of scope here)
**Blocker check**: none. MUT-141 is "relates to", not "blocked by" — its build is complete and its design (ADR-068) is the reference this ticket follows server-side. No open blocker.

## Problem (ticket's own words)

MUT-141 made `conversion` a Transaction kind in the **local/offline app only** (Dexie). There is no hosted route, no `conversion` kind anywhere server-side, and no way for a non-browser client (starting with mobile, MUT-159) to log one.

## Two premise corrections (found reading the code, same shape as ADR-068's own corrections to MUT-141)

1. **"Persisted as a Transaction/MoneyEvent"** — the hosted server has no generic Transaction/MoneyEvent table. Every kind is its own first-class Prisma model: `Expense`, `Receivable`, `Payment`, `Attachment`, etc. (`server/prisma/schema.prisma`). Conversions should follow the same shape: a new `Conversion` model, not a generic kind column. This is also what makes "excluded from P&L by construction" literally free here — a new table simply never appears in any existing summary query; there is no bare-`else` branch to tighten the way ADR-068 had to for the local app's shared `kind==='income'|'expense'` aggregators.
2. **"The portal's existing `useConversionQueries` / `ConversionDrawer`... migrated from Dexie onto this endpoint"** — those two files (`src/hooks/useConversionQueries.ts`, `src/components/drawers/ConversionDrawer.tsx`) are the **local/offline app's** components, calling `getRepositories().base.transactions`. They are not part of the hosted portal and must not be touched — the local app is deliberately Dexie-only (CLAUDE.md: "Local-first data in IndexedDB"). The hosted portal is a structurally separate tree (`src/hosted/**`) that has never reused a local hook or drawer (confirmed: `src/hosted/components/ExpenseDrawer.tsx` and `src/hosted/data/expenseQueries.ts` are hand-built siblings of the local Expense equivalents, not imports of them — `hosted-portal.md` §8 even lint-bans a `hooks/` path segment under `src/hosted/**` for exactly this reason). The hosted UI this ticket needs is **new** — `src/hosted/data/conversionQueries.ts`, `src/hosted/components/ConversionDrawer.tsx`, `src/hosted/pages/views/ConversionsList.tsx` — built to the same pattern as the Expense trio, not a migration of the local files.

Flagging both back on the ticket in the hand-off step below, the way MUT-141's own build logged its corrections via ADR-068 rather than silently building to the ticket's literal (wrong) assumption.

## Scope decision (confirmed with Basel before planning further)

Create + read only for v1: `POST /v1/conversions`, `GET /v1/conversions` (list), `GET /v1/conversions/{id}`. No `PATCH`/`DELETE` — the ticket's AC never asks for edit/undo, unlike `/v1/expenses` (which the ticket is not modeled after for that reason) or `/v1/income`'s undo. A logging mistake is corrected with a new entry, not an edit. This keeps the Prisma model schema-minimal (no `version` column needed for optimistic concurrency, no soft-delete column) and keeps MUT-159's mobile surface to target smaller. If this needs revisiting later it's an additive follow-up (new route + schema fields), not a breaking change.

## Where the code goes (follows `/v1/expenses`, the closest precedent: session+deviceSession-only, no Malafat involvement, own Prisma model, own route file)

### 1. Data layer

- **`server/prisma/schema.prisma`** — new `model Conversion`, mirroring `Expense`'s shape minus the link/category fields it doesn't need:
  ```prisma
  model Conversion {
    id              String       @id @default(uuid()) @db.Uuid
    organizationId  String       @db.Uuid
    organization    Organization @relation(fields: [organizationId], references: [id])
    /// Calendar date in the organization timezone, YYYY-MM-DD.
    occurredOn      String       @db.VarChar(10)
    amountMinor     BigInt
    currency        String       @db.VarChar(3)
    toAmountMinor   BigInt
    toCurrency      String       @db.VarChar(3)
    notes           String?
    createdByUserId String       @db.Uuid
    createdBy       User         @relation(fields: [createdByUserId], references: [id])
    createdAt       DateTime
    updatedAt       DateTime

    /// The ledger: newest first by date within an organization.
    @@index([organizationId, occurredOn(sort: Desc), id(sort: Desc)])
    @@map("conversions")
  }
  ```
  New migration via `prisma migrate dev`. No `deletedAt`/`version` (create+read only, decided above).

- **`server/src/repositories/ports.ts`** — add alongside `ExpenseRecord`/`ExpenseFilter`/`ExpenseRepository`:
  `ConversionRecord`, `CreateConversionInput`, `ConversionFilter` (`from`/`to`/`currency` — matching only the source leg, like expenses), `ConversionCursor` (`occurredOn`, `id`), `ConversionPage`, `ConversionRepository { create, getById, list }`. Add `conversions: ConversionRepository` to `LedgerStore`.

- **`server/src/repositories/memory.ts`** — in-memory implementation for unit tests, mirroring the expense entry (filter, sort by `occurredOn` desc then `id` desc, cursor-paginate).

- **`server/src/repositories/prisma.ts`** — Prisma-backed implementation, mirroring the expense entry's `create`/`getById`/`list` (cursor `WHERE` on `(occurredOn, id)` composite, `ORDER BY occurredOn DESC, id DESC`).

- **`server/src/conversions/cursor.ts`** (new, mirrors `server/src/expenses/cursor.ts` exactly — same opaque base64url `{d, id}` envelope) — `encodeConversionCursor`/`decodeConversionCursor`.

### 2. Validation / business rules

- **`server/src/conversions/compose.ts`** (new, small — mirrors `expenses/compose.ts`'s date/amount helpers): `conversionDate(raw)` (wraps `assertIsoDate`), and reuse (not reimplement) `parseAmount` from `agreements/compose.ts` for both legs — call it twice, once per currency, with distinct `field` names (`'amount'`, `'toAmount'`) so a bad fractional-digit count on the destination leg reports the right field. Reuse `assertNotFuture` from `income/compose.ts` (already exported, already does exactly ADR-038's rule) rather than copying it a third time.

### 3. Auth / writability

- **`server/src/auth/scopes.ts`** — add `'conversions:read'`, `'conversions:write'` to `SESSION_ONLY_SCOPES` (same list `expenses:*`/`capture:write` sit in — never issuable to a Malafat API key).
- **`server/src/auth/writability.ts`** — add `'conversions'` to the `Domain` union, and a new matrix row: `{ domain: 'conversions', scopes: ['conversions:read', 'conversions:write'], routes: '/v1/conversions*', apiKey: 'none', session: 'read-write', writerOfRecord: 'USER' }` (identical shape to the `expenses` row — this is what makes "an API key cannot create one" true without any route-level code, and what auto-publishes `access.conversions` on `GET /v1/me` via `sessionAccessFor`, since that endpoint iterates `WRITABILITY_MATRIX` generically — no serializer change needed).
- **`.claude/designs/hosted-portal.md`** — the writability-matrix markers block must get the new row too (MUT-39's drift test, `server/src/__tests__/writability-drift.test.ts`, fails the build otherwise).

### 4. Route

- **`server/src/routes/conversions.ts`** (new), registered in **`server/src/app.ts`** next to `expenseRoutes`/`incomeRoutes` (`app.route('/', conversionRoutes(store))`):
  - `POST /v1/conversions` — `security: SESSION_ONLY`, `middleware: [requireScope('conversions:write'), idempotent(store, 'conversions.create')]`. Body: `occurredOn`, `amount`, `currency`, `toAmount`, `toCurrency`, optional `notes`. Validates `occurredOn` not future (`assertNotFuture`, reused), both amounts `> 0` (`AMOUNT_INVALID` on the specific field, matching income.ts's pattern), `currency !== toCurrency` (422 `SAME_CURRENCY` on field `toCurrency`) — **this check exists in the local app today** (`src/components/drawers/conversionFormSchema.ts:39-45`, `ctx.addIssue(... path: ['toCurrency'])`) and must be ported, not just assumed; without it the hosted route would be laxer than the local UI it's supposed to match, and any client bypassing a drawer (a raw API call, or mobile/MUT-159) could log a same-currency "conversion" the local app's own form never allows. Parses both legs with `parseAmount`. No client/project linking (not in scope). Creates the row, audits `conversion.created` (`actorType: 'USER'`), returns `201` with the full record.
  - `GET /v1/conversions` — `requireScope('conversions:read')`, cursor-paginated list, `from`/`to`/`currency` filters (mirrors `ListExpensesQuerySchema`'s shape minus the link filters), newest first.
  - `GET /v1/conversions/{id}` — `requireScope('conversions:read')`, 404 on a conversion this organization never had (mirrors `mustGet` pattern from expenses.ts).

### 5. Schemas / OpenAPI

- **`server/src/schemas.ts`** — add near the Expense block: `ConversionSchema` (id, occurredOn, amount, currency, toAmount, toCurrency, notes, createdByUserId, createdAt — no `version`/`updatedAt` churn fields, since there's no update), `ConversionPageSchema`, `CreateConversionRequestSchema` (`.strict()`, mirrors `CreateExpenseRequestSchema`'s shape), `ListConversionsQuerySchema`, `ConversionIdParamSchema`.
- **`server/src/serializers.ts`** — `serializeConversion(c: ConversionRecord)`, mirrors `serializeExpense` (both legs through `formatMoney`).
- `openapi.yaml` is generated from the Zod schemas + route defs (confirmed by how `expenses.ts`/`schemas.ts` work together) — add a `Conversions` tag; **`server/openapi/openapi.yaml`** regenerates via the existing build step, no hand edits.
- **`schema.d.ts`** (hosted) regenerates via `npm run hosted:types:check` / the codegen script the Expense types already go through — this is also the AC's explicit "generated schema.d.ts include the new path" requirement.

### 6. Hosted portal UI (new files, not edits to the local app)

- **`src/hosted/api/client.ts`** — add `Conversion`, `CreateConversionRequest` types from `Schemas[...]`, and `api.conversions(profileId, query)`, `api.conversion(profileId, id)`, `api.createConversion(profileId, body, idempotencyKey)` — same three-liner shape as the `expenses`/`createExpense` entries.
- **`src/hosted/data/conversionQueries.ts`** (new, mirrors `expenseQueries.ts`): `useConversions(profileId, filters)` (via the shared `useCursorList`), `useConversion(profileId, id)`, `useCreateConversion(profileId)` (invalidates the list key on success, same as `invalidateExpenses`).
- **`src/hosted/data/filters.ts`** — add `parseConversionsPage` alongside `parseExpensesPage`.
- **`src/hosted/components/ConversionDrawer.tsx`** (new, mirrors `ExpenseDrawer.tsx`'s create-only shape, not the local drawer's edit/delete one): from-amount/currency, to-amount/currency, date, optional note, implied rate shown read-only (reuse the `impliedRate` calc — small enough to duplicate once, like `AmountWithConversion` already does independently on each side of the local/hosted split — or factor it into a tiny shared pure function if it turns out identical; decide at implementation time, not here).
- **`src/hosted/pages/views/ConversionsList.tsx`** (new, mirrors `ExpensesList.tsx`): the list + the one create action, no row-click edit (create+read only).
- **`src/hosted/router.tsx`** — new `conversionsRoute` under `profileRoute`, `path: '/conversions'`, added to `routeTree`'s children array alongside `expensesRoute`.
- **`src/hosted/shell/HostedShell.tsx`** — add `{ path: '/conversions', key: 'conversions', exact: false }` to `SECTIONS`. Gate the nav entry (and the route) on `me.access.conversions !== 'none'` the same way the existing sections already read `me.access` — **(needs a one-line confirmation during build: does any existing `SECTIONS` entry already gate on `access`, or do all hosted profiles currently get every section unconditionally? If the latter, conversions simply joins the unconditional list, matching current behavior, and the `access.conversions` field this ticket adds for free is forward-looking for MUT-159 rather than used immediately.)**
- **i18n**: new `hosted.nav.conversions`-style keys in `src/hosted/i18n/**`, following whatever key convention the existing Expenses nav entry uses.

## Test plan (TDD — tests first, per project convention)

- **`server/src/repositories/__tests__/store-contract-conversions.ts`** (new, mirrors `store-contract-expenses.ts`): one organization only, create+read, list ordering/pagination, cursor round-trip — run against both `memory.ts` and `prisma.ts` via the existing `store-memory-*.test.ts` / `store-prisma-*.test.ts` harness pattern.
- **`server/src/conversions/__tests__/cursor.test.ts`** (new, mirrors `expenses/__tests__/cursor.test.ts`): encode/decode round-trip, rejects a cursor from another collection.
- **`server/src/routes/__tests__/conversions.test.ts`** (new): 
  - 201 on valid create; amount/toAmount both required `> 0`.
  - 422 `AMOUNT_INVALID` on a non-positive or wrong-precision amount on *either* leg (JOD 3-decimal, confirming field-specific errors).
  - **Future-dated `occurredOn` rejected** (the AC's explicit ADR-038 callback) — a dedicated test, since `/v1/expenses` deliberately has no such check and this route needs to prove it does.
  - Backdated accepted.
  - A session or device-session token can create one; an API key gets 403 (writability test, same shape as the existing expenses writability test).
  - 422 `SAME_CURRENCY` when `currency === toCurrency` (ports the local form's rule, `conversionFormSchema.ts:39-45`).
  - Idempotency-Key replay returns the original 201 body and does not create a second row (reuses the existing `idempotent()` middleware test pattern from `expenses`/`income`).
  - List/get-by-id scoped to the organization (cross-org 404), newest-first ordering.
- **`server/src/__tests__/writability-drift.test.ts`** — existing test, just needs the brief's matrix table updated to stay green; no new test logic.
- **Regression, not new**: a test asserting a created conversion never appears in any `/v1/summaries/*` response — since conversions live in their own Prisma table never touched by any summary query, this is a true-by-construction property; the regression test is a cheap guard that stays green by never needing a summary query to special-case anything (add one assertion to the existing summaries test suite that creates a conversion and asserts the organization summary totals are unchanged by its presence — the proof that "excluded by construction" is real, not just believed).
- **Hosted**: `src/hosted/data/__tests__/conversionQueries.test.ts`, `src/hosted/components/__tests__/ConversionDrawer.test.tsx`, `src/hosted/pages/__tests__/ConversionsList.test.tsx` — same shape as the Expense equivalents (mock `api.*`, assert cache invalidation, assert idempotency key sent).
- Verification commands: `npm run typecheck`, `npm run lint`, `npm run build`, `npm run hosted:types:check`, `vitest run` (server + root), per CLAUDE.md's Phase 4.

## Quality bar

- **DRY / reuse**: `assertNotFuture`, `parseAmount`, `idempotent()`, `useCursorList`, the expense cursor envelope shape, the writability-matrix/`sessionAccessFor` machinery, and the hosted `request()` client wrapper are all reused as-is, zero duplication. The only genuinely new logic is the `Conversion` model/route/schemas themselves — unavoidable, since every other kind on this server is its own model by established pattern (`COMPONENT_REGISTRY`/architecture precedent, not a new pattern needing a `PATTERNS.md` entry).
- **Testable**: route logic takes `store: LedgerStore` by injection exactly like `expenseRoutes`/`incomeRoutes`, so route tests run against the in-memory store with no network or real Postgres; the amount/date validation lives in pure functions (`conversions/compose.ts`) testable with no Hono context.
- **Scalable**: cursor-paginated list (not offset), indexed `(organizationId, occurredOn desc, id desc)` exactly like expenses' hottest-path index; no N+1 — `create`/`getById`/`list` are each one query.
- **Cost-effective**: no new infrastructure, no new third-party calls; one new Postgres table and one migration. Reuses the existing attachments-free, Malafat-free session-only pattern — cheapest correct shape for a feature explicitly scoped to exclude balance tracking and live FX lookups.
- **Constraints respected**: writability matrix (API key can never write/read conversions — matches ACs' "an API key cannot [create one]"); ADR-038 future-date rule reused verbatim; ADR-065 (currency always explicit, no default) honored — every `parseAmount` call passes its own leg's currency; i18n keys for the new hosted nav entry and drawer copy, RTL via the existing `dir="ltr"` amount-input convention `ConversionDrawer.tsx` (local) already established.

## Open items to confirm during build (flagged now, not decided here)

1. Whether `HostedShell`'s `SECTIONS` currently gate any entry on `me.access` at all, or all six are unconditional — determines whether the new nav entry needs a visibility check or just joins the list.
2. Whether `impliedRate` (currently duplicated conceptually between the local `ConversionDrawer` and the planned hosted one) should be factored into one shared pure function now or left as a second small duplicate, matching how `AmountWithConversion` already exists independently in both trees.

## Plan review (adversarial pass)

Reviewed architecture, code quality, test coverage and performance against the actual code (not just the plan text).

- **[P1] (confidence: 9/10) `src/components/drawers/conversionFormSchema.ts:39-45` — the server plan was missing the local app's `fromCurrency !== toCurrency` rule.** Quoted: `if (data.fromCurrency === data.toCurrency) { ctx.addIssue(... path: ['toCurrency']) }`. A hosted route built to the plan as originally written would accept a same-currency "conversion" that the local app's own drawer has refused since MUT-141 — any client bypassing a drawer (mobile/MUT-159, or a raw API call) could create one. **Fixed**: added the `422 SAME_CURRENCY` check and its route test to the plan above.
- **Architecture**: domain boundaries, auth and data flow all follow the `/v1/expenses` precedent exactly (session+deviceSession only, own Prisma model, own writability-matrix row, cursor-paginated list) — no new pattern, no new single point of failure, no cross-service coupling. The "excluded from P&L by construction" property is genuinely structural here (a separate table no summary query touches), not an allowlist that could regress — stronger than ADR-068's own fix for the local app's shared aggregators.
- **Code quality**: every piece of logic reused (`assertNotFuture`, `parseAmount`, `idempotent()`, `useCursorList`, the expense cursor envelope, the writability-matrix→`access` map auto-publish) is an existing, tested helper — no copy-paste. The only pre-existing open question (noted in the plan itself) is whether `impliedRate` should be factored into one shared pure function instead of a second small duplicate; left for build time since it's a one-line call, not an architectural risk.
- **Tests**: the test plan already traces every branch (positive/negative amount, wrong-precision-per-currency, future-date, cross-org isolation, idempotency replay, writability) and now the same-currency rule. No gaps found beyond the one fixed above.
- **Performance**: indexed, cursor-paginated, no N+1 — matches the expenses ledger's proven shape at the same scale.

Scope note on this review pass: ran the substantive architecture/code-quality/test/performance analysis directly against the plan and the real code, rather than the full ceremony (per-finding decision-ledger files, external Codex subprocess, multi-round approval loops) `/plan-eng-review` otherwise prescribes — that apparatus is built for a dedicated top-level review session and was disproportionate to pressure-testing one ticket's plan as an `/eng-ticket` sub-step. The one finding it surfaced was real, verified against a quoted line, and is already folded in above.

## Business / product impact

- Closes the one remaining hole in hosted write coverage for money-movement: income and expenses already reach the hosted API from any client (device-session bearer, MUT-64); conversions are the only kind still browser-only, and that gap is the sole thing blocking MUT-159 (mobile "log a conversion"), not MUT-141 generally (which is done and in review).
- Sits under no numbered epic directly but is the server-side half of the MUT-141/MUT-159/MUT-161 conversion-logging arc from the original intake ("it costs me money and confusion" — cross-currency movements going unrecorded). Shipping this unblocks mobile capture, the next real usage surface for the feature.
- Low risk, additive: a new table and route, zero changes to existing income/expense/summary behavior, and the create+read-only scope keeps the mobile target small and the Prisma model minimal.
