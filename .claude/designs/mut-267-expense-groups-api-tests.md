# MUT-267 test plan — hosted expense groups API

Brief: `mut-267-expense-groups-api-plan.md` (eng-reviewed twice on 2026-10-18; the design-review amendments and the re-run decisions D1, R6 and R7 apply). Written before the code (TDD).

## Unit
- `server/src/expenses/__tests__/groups.test.ts`
  - Membership window: `windowEnd` = endOn, or startOn + 365 for an open group (R6).
  - `isGroupMember`, as a table:
    - in range;
    - before / after the range;
    - excluded in range;
    - included out of range;
    - included in range;
    - excluded out of range;
    - open group at day +365 vs +366.
  - Range rules:
    - END_BEFORE_START;
    - GROUP_RANGE_TOO_LONG (366-day span allowed, 367 refused);
    - the ten-year floor on startOn/endOn;
    - a PATCH is checked against the merged range (endOn-only and startOn-only cases, C3);
    - an unchanged resent date is not re-checked against the floor.
  - Series bounds:
    - closed group;
    - open group in the past;
    - open group with a future start (C2: seriesTo never before seriesFrom).
- `server/src/expenses/__tests__/summary.test.ts` (extends the existing file)
  - `dayBuckets` zero-fills the series and adds sparse `before`/`after` buckets for every member outside it (6A).
  - Per currency, the buckets sum to the currency total.
  - Sorted by date; `position` is `in` inside the series.

## Store contract (memory + Prisma)
`server/src/repositories/__tests__/store-contract-expense-groups.ts`, run by `store-memory-expense-groups.test.ts` and `store-prisma-expense-groups.test.ts`:
- Group CRUD: create, get, list newest-start first, versioned update (stale → `stale`), soft delete (idempotent).
- Overrides: upsert per (group, expense) — last write wins; delete resets.
- `ExpenseFilter.group`:
  - Members (in window and not excluded, or included) match `isGroupMember` on the same fixture.
  - Excluded listing returns in-window excluded only (22A).
  - Paging with the (occurredOn, id) cursor has no gaps or repeats, including after the AND-merge (Q1).
- `totalsByCurrency(org, { group })`: equals the sum of members per currency; an expense in two overlapping groups counts in both (D1).
- A deleted expense leaves every group. A deleted group leaves its expenses alone.
- Another organization's group or expense never matches.

## Migration
`server/src/repositories/__tests__/migration-mut267.test.ts` (test:db): migrating from empty creates both tables, the PK and the indexes.

## Routes
`server/src/__tests__/routes-expense-groups.test.ts` (memory store), one test per acceptance criterion plus the review findings:
- AC1: a 3–7 Oct group includes a 5 Oct expense logged on 9 Oct.
- AC2: leave out → gone from the summary and the `?groupId` list; reset → back.
- AC3: a kept 12 Sep expense counts in the totals, in a `before` bucket.
- AC4: moving the date out of range removes it, unless it was kept.
- AC5: deleting an expense removes it everywhere; deleting a group leaves its expenses.
- AC6: JOD/USD/ILS come back as separate blocks, never summed; no converted block (D1).
- AC7: zero days in the series.
- AC8: an API key gets 403 (session-only scopes); another profile's group or expense gets 404 (A1).
- AC9: 422 END_BEFORE_START / GROUP_RANGE_TOO_LONG / DATE_INVALID floor.
- POST replays under an Idempotency-Key; a PATCH with a stale If-Match gets 409.
- `?expenseId=` returns the groups containing the expense (in range, excluded, kept cases).
- List items carry `currencies` and `memberCount` matching each group's summary (3A).
- An excluded expense moved out of range drops from the excluded listing and from `excludedCount` (22A).
- The detail has no `includedCount` (R7).
- An open group collects nothing dated after startOn + 365 (R6).
- Anchor + groupId on a non-member anchor (C4).

## Existing regression guards (unchanged, must stay green)
- `store-contract-expenses.ts` ("every filter", inclusive cursor)
- `routes-expenses.test.ts` (filters, anchor)
- writability-drift (matrix brief ↔ code)
- route-security
- openapi:check

## Commands (Node 22)
`npm --prefix server run typecheck && npm --prefix server run lint && npm --prefix server run openapi:check && npm --prefix server test`, then `npm --prefix server run test:db` against `mutaba3a-test-pg`.
