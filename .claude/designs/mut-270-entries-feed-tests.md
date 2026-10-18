# MUT-270 — test plan

Brief: `mut-270-entries-feed.md`. TDD: each file below is written before the code it covers.

## Unit — `server/src/entries/__tests__/merge.test.ts`

- Interleaves four branches newest first; equal `createdAt` breaks by `id` descending.
- `nextCursor` only when more than `limit` rows exist across branches; it is the last returned row's (createdAt, id).
- Empty branches and all-empty input.

## Unit — `server/src/payments/__tests__/allocation-state.test.ts` (extend or new)

- `incomeStatusOf`: POSTED with 0 / part / all allocated → unallocated / partial / allocated; REVERSED → reversed.

## Routes (memory store) — `server/src/__tests__/routes-entries.test.ts`

1. Mixed kinds across two profiles come back `createdAt desc`; each item has `kind`, `profileId`, `createdAt`, `createdByUserId` and its embedded object.
2. `limit=2` pages walk every row exactly once; a row created between pages does not shift later pages.
3. No `profileId` spans every membership; `profileId=A` only A; `profileId=A&profileId=B` both; `profileId=A&profileId=A` each entry once.
4. Another person's organization, an unknown UUID and a non-UUID each answer 404 with the same body.
5. Deleted expense, deleted conversion, undone Owed, capture-undone payment are absent; a Malafat-reversed payment is present with `status: 'reversed'`.
6. Malafat payment allocated → `allocated`, partly → `partial` (via `income.status`), `origin: 'integration'`; a fresh capture stays `unallocated` with `origin: 'capture'`.
7. INSTALLMENT receivables are absent.
8. API key → 403 PRINCIPAL_NOT_ACCEPTED; no session → 401.
9. A sent `X-Mutaba3a-Profile` header is ignored.
10. `receiptCount` is 0 and 2; a PENDING receipt and a deleted READY receipt are not counted.
11. Bad cursor, `limit` 0 / 101 → 422 VALIDATION_FAILED.

## Route security — `server/src/__tests__/route-security.test.ts`

- `GET /v1/entries` joins the session-only and device operation lists.

## Postgres — `server/src/repositories/__tests__/prisma-entries.db.test.ts` (test:db)

- Same ordering, exclusions and paging against SQL.
- `EXPLAIN` of each per-kind query on a seeded organization (thousands of expenses and installments) uses an index scan, no Seq Scan, no full Sort.

## Regression

- `income-routes.test.ts:122,274`, `inbox-filing.test.ts:291` keep `status: 'unallocated'` for fresh payments.
- Root `npm run typecheck` after `npm run hosted:types` (widened enum).
