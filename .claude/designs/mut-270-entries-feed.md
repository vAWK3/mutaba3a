# MUT-270 — `GET /v1/entries`: one newest-first feed of a person's entries

Status: approved plan, eng-reviewed 2026-10-18 (plan and review ledger: `~/.gstack/projects/vAWK3-mutaba3a/MUT-270-plan.md`, decisions D1–D6). Jira MUT-270 (epic MUT-63), blocks MUT-271 (the phone's Recent redesign).

## 1. Problem and acceptance criteria

The phone's Recent shows only what this phone saved (its outbox) plus the Unsorted inbox, so entries made on the portal or another device never appear, and edits or deletes made elsewhere are not reflected. A profile's history lives in four per-organization lists (`/v1/expenses`, `/v1/payments`, `/v1/receivables`, `/v1/conversions`), each with its own cursor and order; merging them on the phone costs 4 requests per profile per page.

Acceptance criteria (Jira, refined by the review):
- Ordered by when each entry was logged (`createdAt desc`, `id desc`), stable opaque cursor, default limit 20, max 100.
- Without `profileId` the feed spans every membership; a `profileId` the person is not a member of answers 404, never another person's data.
- Deleted conversions and expenses, undone Owed and capture-undone payments are left out; Malafat-reversed payments stay, with their state.
- Invisible to Malafat's API key (session-only).
- Index-backed: no full scan of a firm's ledger per page.
- OpenAPI, API version bump, ADR; tests for ordering across kinds, cursor stability, the membership filter, the key refusal.

## 2. Design

### 2.1 Contract

`GET /v1/entries?profileId=<uuid>[&profileId=<uuid>…]&limit=20&cursor=<opaque>`

- `security`: session or device session. Organization-independent (no `X-Mutaba3a-Profile`), like `/v1/inbox`; declares no scope.
- `profileId`: optional, repeatable, deduplicated. Any id that is not a membership, or not a UUID, answers `404 NOT_FOUND "Profile not found"` (the same message `selectProfile` uses).
- `limit`: 1..100, default 20 (zod, in `ListEntriesQuerySchema`; `pagination.ts` untouched, D1).
- `cursor`: `pagination.ts`'s (createdAt, id) envelope, unchanged (D4).

Response `EntryPage { items: Entry[], nextCursor: string | null }`; `Entry` is a discriminated union on `kind`:

| kind | envelope | embedded |
|---|---|---|
| `expense` | `profileId, createdAt, createdByUserId` | `expense: Expense & { receiptCount }` |
| `received` | `profileId, createdAt, createdByUserId \| null, origin: capture \| integration, settlesOwedId, replacesPaymentId` | `income: IncomeResponse` (status unallocated / partial / allocated / reversed) |
| `owed` | `profileId, createdAt, createdByUserId \| null` | `income: IncomeResponse` (status open / settled) |
| `conversion` | `profileId, createdAt, createdByUserId` | `conversion: Conversion` |

- Receivables: origin `ADJUSTMENT` only (Owed a person recorded). INSTALLMENT and RETAINER_CHARGE are excluded, and the feed never lazy-posts, so a GET never writes (D2).
- Exclusions: `deletedAt` on expenses, conversions and receivables; payments with `reversalReason = 'capture_undo'`.
- `receiptCount`: READY, not-deleted receipts, one grouped count per page.

### 2.2 IncomeStatus widened (D5)

`IncomeStatusSchema` becomes `unallocated | partial | allocated | reversed | open | settled`. `serializeIncomeEntry` derives a received payment's status from the record through `incomeStatusOf` (`payments/allocation-state.ts`): `REVERSED → reversed`, otherwise `allocationStateOf` (unallocated / partial / allocated). A fresh payment still reads `unallocated`, so `/v1/income` and inbox filing answer exactly as before.

### 2.3 Flow

```
GET /v1/entries ─► authenticate (session/device) ─► organizationIndependent: no selectProfile
      │                                              storeGuard('session', null)
      ▼
routes/entries.ts
  memberships.listByUser(user) ──► orgIds ── profileId filter ⊆ orgIds? ── no ─► 404 Profile not found
      │                                                              yes
      ▼
store.entries.list(orgIds, {limit, cursor})            (sessionOnly in STORE_ACCESS)
  for org in orgIds × kind in {expense, payment, receivable(ADJUSTMENT), conversion}
      findMany(org, (createdAt,id) < cursor, desc, take limit+1)   ── Promise.all (4×N)
  mergeNewestFirst(branches, limit) ─► { rows, nextCursor }
      │
      ▼
expenseReceipts.countReadyByExpenseIds(page expense ids)  (READY, not deleted)
serializeEntry(row, counts) ─► { items, nextCursor: encodeCursor(...) }
```

### 2.4 Store port — `EntriesRepository` (ports.ts, memory.ts, prisma.ts)

`list(organizationIds, page: PageRequest): Promise<Page<EntryRow>>`, where `EntryRow` is `{ kind: 'expense', record } | { kind: 'payment', record } | { kind: 'receivable', record } | { kind: 'conversion', record }`. The repository trusts the ids it is given; the route resolves them from memberships. Prisma: one typed `findMany` per organization and kind (D3), one organization at a time with its 4 kinds in parallel, so a request holds at most 4 pooled connections (review D1); no raw SQL. The cursor condition is `createdAt <= t AND (createdAt < t OR id < i)`, so the index range starts at the cursor (the OR-only form sorted the whole organization). Memory: the same filters over its maps. Both finish with `mergeNewestFirst` (`entries/merge.ts`, pure).

`expenseReceipts.countReadyByExpenseIds(organizationIds, expenseIds): Promise<Map<string, number>>`.

`entries.settledOwedIds(organizationIds, paymentIds): Promise<Map<string, string>>` (review D2): a payment with exactly one allocation, to an ADJUSTMENT receivable, is that Owed's settle. The route asks only for CAPTURE payments with money applied. `replacesPaymentId` comes straight from the payment row. A page is a snapshot: edits and deletions show when a page is re-read (review D3, in the route's OpenAPI description).

Store guard: `entries.list` is `sessionOnly` (a person's own cross-profile view; an API key has no person); `countReadyByExpenseIds` is `{ read: 'expenses' }`, like every expense-receipt method (MUT-42).

### 2.5 Indexes (migration)

- `expenses (organizationId, createdAt desc, id desc)`
- `conversions (organizationId, createdAt desc, id desc)`
- `receivables (organizationId, origin, createdAt, id)`
- payments: the existing `(organizationId, createdAt, id)`, scanned backwards.

### 2.6 Connection pool (D6)

Terraform writes `DATABASE_URL`; it gains `&connection_limit=${var.db_pool_size}` (default 10). The Cloud SQL instance gets an explicit `max_connections` flag (`var.db_max_connections`, default 50, db-g1-small's default). A precondition keeps `2 × db_pool_size × max_instances + 10` (two revisions overlap during a deploy; the 10 cover migrations, the operator's proxy and Cloud SQL's reserved connections) within `db_max_connections`. Prisma's default pool is CPU-derived and, in a container, can read the host's CPU count, so the size is now chosen, not inherited. Changing the flag restarts the instance; INFRA.md records it.

## 3. Reuse analysis

- `pagination.ts` cursor envelope — reused unchanged.
- Organization-independent routes (`app.ts` set, `finishSessionAuth`) — reused.
- `STORE_ACCESS` `sessionOnly` — reused.
- `serializeExpense`, `serializeConversion`, `serializeIncomeEntry` — reused (the last derives its status now).
- `allocationStateOf` — reused, wrapped by `incomeStatusOf`.
- Existing per-kind list queries are per-organization and oldest-first or occurredOn-ordered: not reusable for a createdAt-desc feed.

## 4. Impact

- New route; `/v1/income` and inbox filing gain truthful statuses for allocated/reversed payments (fresh ones unchanged).
- API minor bump; portal `schema.d.ts` regenerates (no portal code calls the route).
- Malafat's key: no change (route is session-only; vocabulary untouched).

## 5. i18n, cost, infra

- No user-facing strings.
- Per page: 1 membership read + 4×N index-bounded queries + 1 receipt count.
- Terraform: pool size and `max_connections` (2.6). One migration adding indexes only.

## 6. Tech debt to record

None new. A cross-table UUID collision at the same millisecond on a page boundary would skip one row (ADR, D4).

## 7. Files

`server/prisma/schema.prisma` + migration · `server/src/entries/merge.ts` (new) · `server/src/routes/entries.ts` (new) · `server/src/repositories/{ports,memory,prisma}.ts` · `server/src/auth/store-guard.ts` · `server/src/app.ts` · `server/src/schemas.ts` · `server/src/serializers.ts` · `server/src/payments/allocation-state.ts` · `server/openapi/openapi.yaml` · `src/hosted/api/schema.d.ts` · `server/infrastructure/terraform/{main,variables}.tf`, `production.tfvars.example` · knowledge files.

## 8. QA scenarios (release-qa)

Server-only, no user-visible web flow: no web catalog entry. The end-to-end scenario ("an entry made on the portal appears in the phone's Recent after a refresh") belongs to MUT-271's iOS catalog.
