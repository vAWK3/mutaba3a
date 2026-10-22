# MUT-390 — entries feed ordered by money date (plan, eng review, decisions D1–D6; build section: "Amended plan")

Repo: mini-crm (`server/`). Story under MUT-63. Blocks MUT-391 (phone Recent by payment date). Relates MUT-270.
No blockers. API stays additive: no params = today's feed, byte for byte.

## What the code says today

- `GET /v1/entries` (`server/src/routes/entries.ts`) → `store.entries.list(orgIds, { limit, cursor })`.
- Postgres (`repositories/prisma.ts` `entries.list`): per org, 4 kinds in parallel (expense, payment,
  ADJUSTMENT receivable, conversion), each `orderBy [createdAt desc, id desc]`, `take limit+1`,
  cursor via `feedCursorWhere` (`createdAt lte c AND (createdAt lt c OR id lt c)`, the MUT-270 bounded-OR form).
  Merged by `entries/merge.ts` `mergeNewestFirst`. Memory store mirrors it with `isBeforeCursor`.
- Cursor: `pagination.ts` `encodeCursor` = base64url `{t, id}`.
- Money date per kind (all `VarChar(10)` ISO dates, **NOT NULL**): expense `occurredOn`, payment `receivedOn`,
  receivable `postingDate` (serialized as the Owed's `occurredOn`), conversion `occurredOn`.
  → There is no "entry without a money date" on the server. AC 3 is satisfied by construction; the test asserts
  each kind sorts by its own column.
- Indexes: expense + conversion have `(org, occurredOn desc, id desc)` (ledger lists use it; keep);
  payments have none on `receivedOn`; receivables none on `postingDate`.

## Decisions

- **D1 Sort key** `(moneyDate desc, createdAt desc, id desc)`. Within a day, newest logged first (ticket).
- **D2 New indexes, one per table** (plain `CREATE INDEX`, same as MUT-270's migration; tables are pilot-sized):
  - `expenses (organizationId, occurredOn DESC, createdAt DESC, id DESC)`
  - `conversions (organizationId, occurredOn DESC, createdAt DESC, id DESC)`
  - `payments (organizationId, receivedOn DESC, createdAt DESC, id DESC)`
  - `receivables (organizationId, origin, postingDate DESC, createdAt DESC, id DESC)` — origin prefix, as MUT-270
    learned for Malafat firms full of INSTALLMENT rows.
  The existing `(org, occurredOn, id)` indexes stay (ledger lists).
- **D3 Filters are only allowed with the order whose index bounds them** (else a firm's whole history is walked
  to fill a page with few matches):
  | param | `order=createdAt` (default) | `order=occurredOn` |
  |---|---|---|
  | `occurredFrom` (date, ≥) | 422 | ✓ index range |
  | `occurredBefore` (date, <) | ✓ only with `loggedSince` (residual filter inside a bounded range) | ✓ index range |
  | `loggedSince` (datetime, ≥) | ✓ index range | 422 |
  MUT-391's two reads: window = `order=occurredOn&occurredFrom=<cutoff>`; "logged this week, dated earlier" =
  `loggedSince=<now-7d>&occurredBefore=<cutoff>` (createdAt order, a week of rows at most).
- **D4 Cursor carries its order.** New envelope `{k:'o', o:'YYYY-MM-DD', t, id}` for money-date order; the
  existing `{t, id}` stays the createdAt cursor unchanged (old phones' cursors keep working). A cursor used with the
  other order → 422 `VALIDATION_FAILED` field `cursor`. Filters are NOT encoded in the cursor (the client resends
  them, as with `profileId` today).
- **D5 `/v1/inbox` unchanged.** MUT-391 puts "sorting inside Unsorted" out of scope, and the inbox is never merged
  into day cards. The ticket's "if Recent reads it" resolves to no.
- **D6 No envelope `occurredOn` field.** It would break "byte for byte" for default calls; each item already carries
  its money date in its nested object, and the phone already reads it.
- **D7 Fan-out unchanged:** still ≤ 4 queries in flight per request (one org at a time, 4 kinds in parallel).

## Files

| Layer | File | Change |
|---|---|---|
| schema | `prisma/schema.prisma` | 4 `@@index` lines (D2) |
| migration | `prisma/migrations/2026102x_mut390_entries_money_date_indexes/migration.sql` | 4 `CREATE INDEX`, header comment like MUT-270's |
| port | `repositories/ports.ts` | `EntriesRepository.list(orgIds, page: FeedPageRequest)`; `FeedPageRequest = { limit; order: 'createdAt' \| 'occurredOn'; cursor: FeedCursor \| null; occurredFrom?; occurredBefore?; loggedSince? }`; `FeedCursor` union |
| shared logic | `entries/merge.ts` | `moneyDateOf(row: EntryRow)`; `feedKeyOf(row, order)`; `compareFeed(order)`; `isBeforeFeedCursor(order)`; `mergeNewestFirst` takes the comparator + key fn (createdAt path unchanged) |
| cursor | `entries/cursor.ts` (new) | `encodeFeedCursor` / `decodeFeedCursor(raw, order)` — wraps `pagination.ts`'s `{t,id}` for createdAt, adds `k/o` for occurredOn; mismatch → 422 |
| postgres | `repositories/prisma.ts` | per-kind `{ dateCol, orderBy }` table; `moneyCursorWhere(col, c)` = `col lte o AND (col lt o OR createdAt lt t OR (createdAt = t AND id lt id))` (bounded-OR, same trick as `feedCursorWhere`); filters as `col gte/lt`, `createdAt gte` |
| memory | `repositories/memory.ts` | same filters + `isBeforeFeedCursor(order)` + `mergeNewestFirst(compareFeed(order))` |
| validation | `schemas.ts` `ListEntriesQuerySchema` | `order` enum default `createdAt`; `occurredFrom`/`occurredBefore` `IsoDateSchema`; `loggedSince` datetime; `.superRefine` for D3 → 422 with `field` |
| route | `routes/entries.ts` | pass order + filters; decode cursor per order; description + summary say both orders |
| API docs | `openapi/openapi.yaml` (generated), `src/hosted/api/schema.d.ts` (regenerated) | via `npm run openapi:generate` |
| version | `app.ts` `API_VERSION` | `1.47.0-mut390` (renumber at landing if another branch lands first) |
| knowledge | `.claude/DECISIONS.md` ADR-168 (renumber at landing), `CHANGELOG.md`, `PATTERNS.md` (feed order/filter rule), `TEST_PLAN.md`, brief `.claude/designs/mut-390-feed-money-date.md` | |

## Tests (written first; `cd server && npm run test:db` for Postgres, `npm test` for memory)

- `entries/__tests__/merge.test.ts` — `compareFeed('occurredOn')`: day desc, then createdAt desc, then id desc;
  `isBeforeFeedCursor` at each tie level; `moneyDateOf` per kind (owed = postingDate, received = receivedOn).
- `entries/__tests__/cursor.test.ts` — round-trip both shapes; createdAt cursor with `order=occurredOn` → 422 and
  vice versa; malformed `o` → 422.
- `repositories/__tests__/store-contract-entries.ts` (runs on memory + Postgres) — **AC1** 3 days × 5 rows across
  4 kinds, page limit 2, walk all pages: exact order, no drop, no repeat across day boundaries and same-createdAt
  ties; **AC2** `occurredFrom` and `loggedSince+occurredBefore` return exactly the matching set; **AC3** an Owed with
  postingDate older than its createdAt sorts by postingDate, a Received by receivedOn; editing an expense's
  `occurredOn` moves it; deleted/undone rows still excluded.
- `__tests__/routes-entries.test.ts` — **AC4** 422s (cursor mismatch, D3 combos, bad dates); **AC6** a no-param
  request equals the pre-change JSON for the same seed (existing assertions untouched + one explicit default-order
  test); `profileId` narrowing still works with `order=occurredOn`.
- `repositories/__tests__/store-prisma-entries-plan.test.ts` — **AC5** EXPLAIN with seq/bitmap/sort off: every
  per-kind query for `order=occurredOn` (first page, past a cursor, with `occurredFrom`) is an index scan on the D2
  index; `loggedSince+occurredBefore` uses the existing createdAt index.

Verify before done: `cd server && npm run lint && npm run typecheck && npm test && npm run test:db && npm run openapi:check && npm run build`;
root `npm run typecheck` (schema.d.ts). Fresh test DB for the migration (`mutaba3a_test_mut390`).

Release-QA: API-only, no web/portal surface changes → no `qa/features` entry; user-visible proof is MUT-391's
`ios.recent.*` flows. `release-qa lint` must stay clean (no new unmapped files under `src/`).

## Rollout

Additive API + 4 index migration. Deploy before MUT-391 ships. No Cloud SQL restart. Rollback: old image ignores
the new params; indexes are harmless to leave.

## Business / product impact

- Recent will show money on the day it moved, so day totals match what the user actually spent that day — the bug
  Basel hit on 2026-10-22 with 7 backdated entries under "Today".
- Unblocks MUT-391 under MUT-63 (Capture); server-only, no phone release needed to ship this half.
- Low risk: additive params and four indexes; old clients see no change.

---

# Eng review — /plan-eng-review, 2026-10-22

Target: this plan, `MUT-390-plan.md` (above, unchanged as drafted). Repo mini-crm `server/`, base local `main` f36f4d42.

## Scope Challenge — assessment

- **What already exists:** `entries/merge.ts` `mergeNewestFirst` (exact top-`limit` of per-branch `limit+1` reads; holds for any
  total order, so it generalises with a comparator); `pagination.ts` `encodeCursor/decodeCursor` (MUT-270 D1/D4: stays
  untouched); `schemas.ts:850` `IsoDateSchema`; `prisma.ts` `feedCursorWhere` (the bounded-OR keyset trick to copy);
  `store-prisma-entries-plan.test.ts` (EXPLAIN harness with seq/bitmap/sort off) and `store-contract-entries.ts` (memory +
  Postgres parity). Expense + conversion already carry `(org, occurredOn desc, id desc)` indexes (schema.prisma).
- **Minimum change:** order param + 3 filters + 4 indexes + cursor variant. `/v1/inbox` dropped (D5).
- **Complexity:** source files touched ≈ 10 (schema.prisma, migration, ports.ts, merge.ts, cursor.ts [new], prisma.ts,
  memory.ts, schemas.ts, routes/entries.ts, app.ts) + 2 generated (openapi.yaml, schema.d.ts) + 5 docs + 5 test files.
  New modules: 1 (`entries/cursor.ts`). `store-guard.ts:253` needs no change (method name unchanged). Gate trips (8+ files).
- **Search check:** keyset pagination on a composite sort is standard practice [Layer 1]; nothing new. Web search skipped
  (no new infrastructure pattern).
- **TODOS.md:** no entry touches the feed.

### Reality rows
| premise | claim | receipt | verdict |
|---|---|---|---|
| P1 | feed sorts only by (createdAt, id) | `server/src/entries/merge.ts:16-20`, `prisma.ts` entries.list `newestFirst` | true |
| P2 | every kind has a NOT NULL money date | `schema.prisma` Expense.occurredOn, Payment.receivedOn, Receivable.postingDate, Conversion.occurredOn (`String @db.VarChar(10)`) | true |
| P3 | Owed's money date is postingDate | `serializers.ts:619` `occurredOn: r.postingDate` | true |
| P4 | Received's money date is receivedOn | `serializers.ts:601` `occurredOn: p.receivedOn` | true |
| P5 | expense/conversion already indexed by occurredOn | `schema.prisma` Expense `@@index([organizationId, occurredOn(sort: Desc), id(sort: Desc)])` | true (but no createdAt column, so not usable for D1's order) |
| P6 | phone Recent never merges inbox into day cards | flutter `recent_feed_providers.dart:519` "Unsorted has none" | true |
| P7 | store guard needs no change | `auth/store-guard.ts:253` `entries: { list: 'sessionOnly', … }` | true |
unverified=0

REALITY: premise-table pass 7 premises, unverified=0 server/src/entries/merge.ts:16
REALITY: already-done pass no commits on main since 2026-10-22 touch entries/; mut-388 and mut-148 branches touch only app.ts/schemas.ts/prisma.ts lines unrelated to the feed server/src/app.ts:157
REALITY: surface-check pass GET /v1/entries and ListEntriesQuerySchema exist; IsoDateSchema exists server/src/schemas.ts:2589
REALITY: binding-decisions pass MUT-270 D1/D4 (pagination.ts untouched) and D3 (typed findMany, no raw SQL) are honored by the plan server/src/pagination.ts:1
REALITY: numbers pass only counts in the plan (4 indexes, ≤4 queries in flight); no measured figures claimed; table sizes [estimated] pilot-scale server/src/repositories/prisma.ts:1874
REALITY: deferred-asks finding ticket asks /v1/inbox "if Recent reads it"; plan drops it (D5) because MUT-391 keeps Unsorted out of scope flutter lib/presentation/providers/recent_feed_providers.dart:519
REALITY: pr-count pass one branch, one merge; no .gstack/ship-policy.json so default one PR per wave f36f4d42

### Scope record (B)
feature answers: none proposed (no cuts); structure: Smaller arrangement (D1, answered 2026-10-22); accepted scope: the plan
as drafted, with the cursor codec in `entries/merge.ts` (tests in `merge.test.ts`), no `entries/cursor.ts`; pending remedies: R1, R2.

## Decision ledger

### R1: D3 filter rule — allow `occurredBefore` alone with `order=createdAt`
Finding: S1, P3, confidence 8/10, plan D3 table ("occurredBefore … ✓ only with loggedSince"), reviewer: Claude (Scope Challenge)
Plan baseline: original proposal: `occurredBefore` with createdAt order is 422 unless `loggedSince` is also sent.
Runtime evidence: not built. Reasoning from `prisma.ts` entries.list: with createdAt desc, `occurredOn < D` rejects only rows whose money date is recent; those are the recently logged rows, so the skip is bounded by recent volume and the last page ends at the history end exactly like the unfiltered feed. The two residual-only combos that do force a whole-history scan on the final page are `occurredFrom`+createdAt and `loggedSince`+occurredOn.
Comparison grid:
| Choice | Current (plan) | A | B |
|---|---|---|---|
| R1 occurredBefore alone + createdAt order | 422 | allowed | 422 (unchanged) |
| occurredFrom + createdAt order | 422 | 422 | 422 |
| loggedSince + occurredOn order | 422 | 422 | 422 |
| R2 edit-instability contract | pending | pending | pending |
Question D2:
D2 — Should `occurredBefore` work on its own with the default order?
Project/branch/task: mini-crm main, planning MUT-390.
ELI10: The plan refuses filter combos that would make the database read a firm's whole history to fill the last page. It also refuses "dated before X" on the default (newest logged) order unless "logged since" is sent too. That one is not actually dangerous: it only skips the few recent rows, so it costs about the same as the normal feed.
Stakes if we pick wrong: Keeping the extra rule means one more 422 a client can trip over for no gain; dropping it costs nothing at the database.
Recommendation: A because the rule guards against a scan that cannot happen, and fewer refusal rules are easier to document and test.
Completeness: A=10/10, B=9/10
Pros / cons:
A) Allow it (recommended)
  ✅ Two refusal rules instead of three; the docs and the 422 tests get simpler.
  ✅ A client can ask "everything dated before X, newest logged first" without a fake loggedSince.
  ❌ One more allowed combination to cover in the EXPLAIN test (it must still use the createdAt index).
B) Keep the plan's rule
  ✅ Narrowest surface: only the two combinations MUT-391 actually sends are allowed.
  ✅ No extra EXPLAIN case to write.
  ❌ A third 422 rule that protects against nothing, which future readers will have to reason about.
Net: a simpler, equally safe contract vs. the narrowest possible one.
Header: occurredBefore
Options:
A) Allow it (recommended)
`occurredBefore` is accepted with either order. Refused combos stay: `occurredFrom`+createdAt and `loggedSince`+occurredOn (422). Adds one EXPLAIN case (occurredBefore alone, createdAt order → createdAt index) and one route test. (human: ~30 min / CC: ~3 min)
B) Keep the plan's rule
`occurredBefore` with the createdAt order is 422 unless `loggedSince` is also sent. Three refusal rules, each with a route test. (human: same / CC: same)

State: approved
Actual answer: A) Allow it (D2, answered 2026-10-22)
Accepted scope: `occurredBefore` is accepted with either order; refused combos are only `occurredFrom`+createdAt and `loggedSince`+occurredOn (422); add one EXPLAIN case (occurredBefore alone, createdAt order → createdAt index) and one route test.
History: none

## Section 1 — Architecture

```
GET /v1/entries ?order&occurredFrom&occurredBefore&loggedSince&cursor&profileId&limit
   │ ListEntriesQuerySchema.superRefine ── bad date / refused combo ──▶ 422 VALIDATION_FAILED
   │ decodeFeedCursor(raw, order) ──────── wrong-order or malformed ──▶ 422 (field cursor)
   ▼
 memberships → orgIds (unknown profileId ──▶ 404)
   ▼
 store.entries.list(orgIds, {order, cursor, filters, limit})
   │  for each org (sequential): 4 kinds in parallel (≤4 in flight)
   │    expense    (org, occurredOn↓, createdAt↓, id↓)     ┐ order=occurredOn
   │    payment    (org, receivedOn↓, createdAt↓, id↓)     │ index range: occurredFrom ≤ d < occurredBefore,
   │    receivable (org, origin, postingDate↓, createdAt↓, id↓) │ cursor: d ≤ o AND (d < o OR createdAt < t OR (createdAt = t AND id < id))
   │    conversion (org, occurredOn↓, createdAt↓, id↓)     ┘
   │  (order=createdAt: today's indexes; loggedSince bounds, occurredBefore filters)
   ▼
 mergeNewestFirst(branches, limit, compareFeed(order)) → page + encodeFeedCursor(last)
   ▼
 receiptCounts + settledOwedIds (unchanged) → serializeEntry (unchanged)
```

Findings:
- `[P2] (confidence: 9/10) server/src/routes/entries.ts:34` — "A page is a snapshot: an entry edited or deleted later changes only when that page is read again". With `order=createdAt` the sort key never changes, so paging is stable. With `order=occurredOn` the key is editable (MUT-225 changes a saved entry's date): an entry moved to an older date after page 1 was read shows again on a later page; one moved newer than the cursor is skipped until a refresh. → R2.
- `[P3] (confidence: 8/10) flutter lib/domain/services/recent_layout.dart:33` — `foldPairs` folds a settle into its Owed only when both are loaded (`byId[owedId]`). Under money-date order an Owed posted weeks before its settle falls outside the 7-day window, so the settle shows alone. That is the existing fallback (no crash, no wrong total), but MUT-391 should know. Disposition: no server change; noted on MUT-391 (comment at handoff).
- Security: unchanged. Same session-only route, same membership resolution, filters only narrow the person's own rows. No issues.
- Distribution: no new artifact; migration ships in the API image. No issues.

### R2: what the money-date order promises when an entry's date is edited between pages
Finding: Section 1 P2, confidence 9/10, server/src/routes/entries.ts:34 (snapshot wording), reviewer: Claude
Plan baseline: original proposal is silent; the route description keeps "A page is a snapshot".
Runtime evidence: not built. `Expense.occurredOn`, `Payment.receivedOn`, `Receivable.postingDate` are editable (MUT-225); `createdAt` is not.
Comparison grid:
| Choice | Current (plan) | A | B | C |
|---|---|---|---|---|
| R2 contract under order=occurredOn | unspecified | documented: a date-edited entry can repeat or be missed across pages; clients dedupe by id and re-read page 1 after their own edit | stable paging: cursor carries the first page's server time; later pages drop rows updated after it | unspecified (no doc, no test) |
| Extra work | none | description + OpenAPI text, 1 contract test pinning repeat-on-move-older, MUT-391 comment | cursor field, `updatedAt` filter in 4 queries + memory, index check, 3 tests | none |
| R1 occurredBefore alone + createdAt | allowed (D2) | allowed | allowed | allowed |
Question D3:
D3 — What should the feed promise when an entry's date changes while someone is paging?
Project/branch/task: mini-crm main, planning MUT-390.
ELI10: Today the feed sorts by when something was logged, and that never changes, so paging is rock solid. The new order sorts by the payment date, and people can edit that date. If you edit an entry's date while the phone is halfway through loading Recent, that entry can show up twice or be missing until the next refresh.
Stakes if we pick wrong: Silent duplicates or a missing row in Recent, with a day total that is off until refresh.
Recommendation: A because the phone already re-reads page 1 after its own edits, deduping by id is one line, and freezing pages server-side adds a field and a filter to every query for a rare race.
Completeness: A=9/10, B=10/10, C=4/10
Pros / cons:
A) Document and dedupe (recommended)
  ✅ The API says plainly what can happen, and a contract test pins it so nobody is surprised later.
  ✅ No new cursor field or query filter; the hot path stays the same four index scans.
  ❌ A row edited on another device mid-scroll can still be missing until the next pull-to-refresh.
B) Freeze pages server-side
  ✅ No repeats: later pages hide anything edited after page 1 was read.
  ✅ The client needs no dedupe logic.
  ❌ Still misses rows moved newer than the cursor, adds an updatedAt filter to 4 queries and a field to the cursor.
C) Leave it unspecified
  ✅ Zero extra work in this ticket.
  ✅ Behaviour is the same as A at runtime.
  ❌ The phone team finds duplicates in Recent by accident instead of designing for them.
Net: one documented rare glitch handled on the phone vs. more server machinery that only half-fixes it.
Header: Date edits
Options:
A) Document and dedupe (recommended)
Route description and OpenAPI say: under order=occurredOn, an entry whose date changes between page reads can repeat or be missed; dedupe by id and re-read page 1 after an edit. One store-contract test pins "moved older → appears again". A comment on MUT-391 asks for dedupe by id. (human: ~1h / CC: ~5 min)
B) Freeze pages server-side
The occurredOn cursor carries the first page's server time; later pages add `updatedAt <= t` to all 4 queries and the memory store; EXPLAIN and contract tests cover it. Rows moved newer than the cursor are still missed. (human: ~1 day / CC: ~30 min)
C) Leave it unspecified
No description change, no test, no MUT-391 note. (human: 0 / CC: 0)

State: approved
Actual answer: A) Document and dedupe (D3, answered 2026-10-22)
Accepted scope: route description and OpenAPI state that under order=occurredOn an entry whose date changes between page reads can repeat or be missed, and clients dedupe by id and re-read page 1 after an edit; one store-contract test pins "moved older → appears again"; a comment on MUT-391 asks for dedupe by id.
History: none

Dispositions (Section 1): R2 approved (D3 A); settle/Owed pairing across the window: noted for MUT-391, no server change.

## Section 2 — Code quality

- `[P3] (confidence: 8/10) server/src/entries/merge.ts:29-33` — `mergeNewestFirst` builds `nextCursor` as `{ createdAt: keyOf(last).createdAt, id: keyOf(last).id }`. Generalising it with only a comparator would drop the money date from the cursor. Fix inside the approved design: `keyOf` returns the order's full key (`{ moneyDate?, createdAt, id }`) and the cursor is built from that key. Factual correction to the plan's "takes the comparator + key fn"; no behaviour choice.
- `[P3] (confidence: 7/10) server/src/schemas.ts:2603` — the envelope uses `z.string().datetime()`, which rejects offsets (`+03:00`). `loggedSince` comes from a phone clock; accept both with `z.string().datetime({ offset: true })` and compare as an instant. Part of the approved `loggedSince` filter; no behaviour choice.
- Module shape (D1): cursor codec in `entries/merge.ts`; `pagination.ts` untouched (MUT-270 D1/D4). No other shared-code opportunity: the inbox list has its own cursor and stays out of scope (D5).
- Error paths: refused combos and bad cursors → 422 `VALIDATION_FAILED` with `field`; `occurredFrom > occurredBefore` returns an empty page (no special case, SQL answers it). No gaps.

Dispositions (Section 2): both are implementation corrections inside approved scope; folded into the Files table below.

## Section 3 — Tests

Framework: vitest (`server/package.json` "test": "vitest run"; "test:db" for Postgres).

```
CODE PATHS                                                  
[+] schemas.ts ListEntriesQuerySchema                        
  ├── order default createdAt ............ [★★ TESTED] routes-entries (existing; AC6 regression contract)
  ├── occurredFrom/occurredBefore bad date  [GAP] route test (422 field)
  ├── occurredFrom + createdAt → 422 ....... [GAP] route test
  ├── loggedSince + occurredOn → 422 ....... [GAP] route test
  ├── occurredBefore alone + createdAt (R1)  [GAP] route test (200)
  └── loggedSince with offset ............. [GAP] route test (+03:00 accepted)
[+] merge.ts
  ├── compareFeed('occurredOn') tie levels  [GAP] merge.test (day, createdAt, id)
  ├── moneyDateOf per kind ................ [GAP] merge.test (owed=postingDate, received=receivedOn)
  ├── mergeNewestFirst nextCursor carries o [GAP] merge.test
  └── encode/decodeFeedCursor ............. [GAP] merge.test (round-trip, wrong order 422, bad o 422)
[+] prisma.ts / memory.ts entries.list
  ├── occurredOn walk, 3 days × 4 kinds ... [GAP] store-contract-entries (no drop/repeat, ties)
  ├── two profiles interleaved by date .... [GAP] store-contract-entries (multi-org merge)
  ├── filters exact sets .................. [GAP] store-contract-entries
  ├── date edited → row moves (R2) ........ [GAP] store-contract-entries (moved older appears again)
  ├── undone capture / deleted excluded ... [★★ TESTED] existing, extend to occurredOn order
  ├── ≤4 queries in flight ................ [★★ TESTED] store-prisma-entries-fanout, extend to occurredOn
  └── index plans ......................... [GAP] store-prisma-entries-plan (4 new indexes, cursor, occurredFrom;
                                             loggedSince+occurredBefore and occurredBefore alone → createdAt index)
USER FLOWS: none on this server ticket; MUT-391 owns ios.recent.* flows.
COVERAGE: 3/18 paths tested today (17%); all 15 gaps have planned tests.
QUALITY: ★★:3  |  GAPS: 15 (0 E2E, 0 eval)
```

Regression contract (carried forward, ticket AC6): with no new params the response is byte for byte today's; existing `routes-entries.test.ts` assertions stay untouched.

Tests made obsolete: none.

Dispositions (Section 3): all gaps are required proof of approved behaviour (ticket ACs, D2, D3); added to the test list without new choices.

## Section 4 — Performance

- `[P3] (confidence: 7/10) server/prisma/migrations/20261018120000_mut270_entries_feed_indexes/migration.sql:5` — plain `CREATE INDEX` blocks writes on the table while it builds. Same approach MUT-270 shipped; tables are pilot-sized [estimated: thousands of rows], so the lock lasts well under a second. Accepted as planned; note it in the deploy notes.
- Write cost: 4 extra indexes on insert paths (expenses, payments, receivables, conversions). One B-tree insert each per write; negligible at pilot volume [estimated].
- Reads: unchanged shape. Per page, ≤4 index range scans in flight, `limit+1` rows each, one org at a time. No N+1 (receipt counts and settle ids stay one batched query each).
- No caching change.

Dispositions (Section 4): no remedy needed.

## Outside Voice — native fallback (Claude Plan subagent, completed within the 5-minute timer)

Codex not installed (`CODEX_MODE: not_installed`). In-host reviewer, read-only. Full report (verbatim summary of its 8 findings):
1. High — the phone already loads every row logged in the last 7 days (`recent_feed_providers.dart:111-119`, `recent_layout.dart:140,215`); regrouping those by money date on the phone fixes the reported bug without any server change. The server adds only rows logged > 7 days ago whose money date is inside the window. Plan never sized that.
2. Medium — R1 was approved on a wrong premise: `occurredBefore=D` with createdAt order walks everything logged since D before its first match when D is old; same cost class as the refused `occurredFrom`+createdAt.
3. Medium — filters and cursors both write `createdAt`/date-column keys; a plain object spread drops one bound. No planned test combines a filter with a cursor across pages.
4. Medium — the phone caches cursors (`recent_feed_providers.dart:259,423`); a cached createdAt cursor sent with order=occurredOn would 422 after upgrade. MUT-391 must version the cache key.
5. Medium — `entries.ts:38` ("next to its Owed", "next to the reversed one") and `schemas.ts:2602` ("the feed's order") become false under order=occurredOn.
6. Low — `pagination.ts` `decodeCursor` ignores unknown keys, so a money cursor sent without `order` would be accepted as a createdAt cursor unless the codec rejects `k` first.
7. Low — main moved to f06a0712 with API `1.47.0-mut388`; this ticket needs `1.49.0-mut390`.
8. Low — memory store compares date strings by code point, Postgres by collation; equal only while every value is strict YYYY-MM-DD.
Recommendation (reviewer): hold implementation until the client-only alternative and R1 are re-decided.

Parent verification:
- F1 confirmed: income `occurredOn: PastMoneyDateSchema` (`schemas.ts:1826`), conversions PastMoneyDate (`schemas.ts:2241`): never later than the org's today, so money date ≤ logged date. Expenses use `FlooredMoneyDateSchema` (`schemas.ts:854`, no upper bound): **future-dated expenses exist**, which the plan and MUT-391 both miss (order=occurredOn would put them above Today). Edge case not measured: no prod data locally.
- F2 confirmed by reasoning; R1 reopened if MUT-390 stays.
- F7 confirmed: `app.ts:157` `API_VERSION = '1.47.0-mut388'`.

### R3: keep MUT-390, or regroup on the phone first
Finding: Outside Voice F1, High, confidence 8/10, flutter `recent_layout.dart:140` + mini-crm `schemas.ts:854,1826,2241`, reviewer: Claude Plan subagent (verified by parent)
Plan baseline: MUT-390 as planned, blocking MUT-391 (ticket links, Basel's "Both" window choice in pm-intake 2026-10-22).
Runtime evidence: the phone pages the createdAt feed until a row logged before the 7-day cutoff (cap 10 pages × 20). Income and conversions cannot be future-dated; expenses can.
Comparison grid:
| Choice | Current | A Include | B Defer | C Cut | D Hold |
|---|---|---|---|---|---|
| R3 MUT-390 | planned, blocks MUT-391 | build as planned (R1 re-asked, F3–F7 fixed) | park in Backlog; MUT-391 regroups loaded rows by money date with no server change; unlink the block | close as Won't Do | stop for discussion |
| MUT-391 dependency | blocked by MUT-390 | blocked | independent | independent | unchanged |
| Missed by phone-only | — | nothing | expenses logged > 7 days ago with a then-future date now in the window; entries whose date was edited into the window | same as B, permanently | — |
| R1 occurredBefore rule | approved (D2) | reopened | moot until revived | moot | unchanged |
| Basel's "Both" window | chosen | kept | kept (the phone builds both cards from loaded rows) | kept | unchanged |
Question D4:
D4 — Should MUT-390 be built now, or should MUT-391 fix Recent on the phone alone first?
Project/branch/task: mini-crm main, planning MUT-390 (blocks MUT-391).
ELI10: The second reviewer spotted that the phone already downloads everything you logged in the last 7 days. Income and conversions can never be dated in the future, so anything dated inside the last 7 days was also logged inside them. The phone can simply re-sort what it already has by payment date and build both cards you asked for, with no server change. The only rows it would miss are rare: an expense logged over a week ago with a future date that has now arrived, or an old entry whose date someone edited into this week.
Stakes if we pick wrong: Build it now and we spend a server release, four indexes and a paging edge case on rare rows. Defer it and those rare rows stay off Recent until someone notices.
Recommendation: B because the phone-only fix covers the reported bug and both cards completely, and MUT-390 can come back the day a missing row is actually seen.
Note: options differ in kind, not coverage — no completeness score.
Pros / cons:
A) Include
  ✅ Recent is exact for every row, including future-dated expenses and edited dates.
  ✅ The server can answer "by payment date" for the portal later too.
  ❌ A server release, 4 indexes, a second cursor and a paging glitch on date edits, mostly for rare rows.
B) Defer (recommended)
  ✅ MUT-391 ships without waiting for a server deploy, and paging stays stable (logged order never changes).
  ✅ MUT-390 stays in Backlog with this review attached, ready if a missing row ever shows up.
  ❌ An expense logged over a week ago with a future date, or an old entry edited into this week, won't show in Recent.
C) Cut
  ✅ Removes a ticket nobody may ever need.
  ✅ Same phone outcome as B.
  ❌ Loses the reviewed plan if the rare case turns out to matter.
D) Hold
  ✅ Lets you look at real data or talk it through before choosing.
  ✅ Nothing changes while you decide.
  ❌ MUT-391 stays blocked until you come back.
Net: exact-but-heavy now vs. a phone fix that covers the bug and nearly every row.
Header: MUT-390
Options:
A) Include
Build MUT-390 as planned. R1 (occurredBefore rule) is re-asked with corrected reasoning; F3–F7 fixes are added (combined filter+cursor tests, MUT-391 cache-key note, route/schema wording, codec rejects foreign cursors, API 1.49.0-mut390). MUT-391 stays blocked.
B) Defer (recommended)
Park MUT-390 in Backlog with this review linked. MUT-391 regroups its already-loaded rows by money date and builds the "dated earlier" card on the phone; remove the Blocks link and add a comment on both tickets (incl. future-dated expenses). R1 and F3–F7 wait for revival.
C) Cut
Close MUT-390 as Won't Do with this review linked; MUT-391 goes phone-only as in B.
D) Hold
Stop here and discuss; MUT-390 and MUT-391 stay as they are.

State: approved
Actual answer: A) Include — Basel 2026-10-22, after asking for a plainer explanation: "i want the most robust fix, and I want to allow future dates as well (I can log owed income in a month, or an expense I know I will pay in 3 days)"
Accepted scope: build MUT-390 as planned; MUT-391 stays blocked; F3 (combined filter+cursor where-clauses and tests), F4 (MUT-391 cache-key note), F5 (route/schema wording for both orders), F6 (codec rejects a money cursor without order), F7 (API 1.49.0-mut390) are added. R1 reopened. Future dates: new requirement, placement decided in R4.
History: D4 first answer "explain in simpler terms" (2026-10-22); plain explanation given in chat; re-answered as above.

### R1 (reopened): `occurredBefore` with the default order
Reason for reopening: Outside Voice F2 — D2's premise ("only skips the few recent rows") is false for an old date: `occurredBefore=D` with createdAt order skips everything logged since D before its first match, the same cost class as the refused `occurredFrom`+createdAt. Basel asked for the most robust fix (D4).
Plan baseline: approved D2 A (allowed with either order).
Comparison grid:
| Choice | Current (D2) | A | B |
|---|---|---|---|
| occurredBefore alone + createdAt | allowed | 422 unless loggedSince is also sent (original plan rule) | allowed (unchanged) |
| occurredFrom + createdAt | 422 | 422 | 422 |
| loggedSince + occurredOn | 422 | 422 | 422 |
Question D5:
D5 — Should "dated before X" on the default order require "logged since"?
Project/branch/task: mini-crm main, MUT-390.
ELI10: I told you earlier this combination was cheap. That was wrong when X is an old date: the database would read everything logged since X before finding a single match. The phone never needs it on its own; it always sends "logged since" with it.
Stakes if we pick wrong: Allowing it leaves a slow query anyone can trigger; refusing it costs nothing the phone uses.
Recommendation: A because it closes the slow path and the phone's real request still works.
Completeness: A=10/10, B=6/10
Header: Dated before
Options:
A) Require "logged since" (recommended)
`occurredBefore` with the default order is 422 unless `loggedSince` is also sent (the plan's original rule). Route test for the 422; EXPLAIN case for loggedSince+occurredBefore stays.
B) Keep it allowed
Keep D2: allowed alone; the EXPLAIN case for it stays; an old date can scan a firm's history.

State: approved
Actual answer: A) Require "logged since" (D5, answered 2026-10-22)
Accepted scope: `occurredBefore` with the default order is 422 unless `loggedSince` is also sent; refused combos: `occurredFrom`+createdAt, `loggedSince`+occurredOn, `occurredBefore`+createdAt without `loggedSince`. Route test for each 422; EXPLAIN case for loggedSince+occurredBefore (createdAt index). The D2 EXPLAIN case and route test for occurredBefore alone are dropped.
History: D2 A approved 2026-10-22 on a wrong premise (see reason); superseded by D5 A.

### R4: where "allow future dates" lands
Finding: Basel's new requirement (D4 answer, 2026-10-22): log Owed income dated next month and an expense due in 3 days.
Plan baseline: none (new requirement).
Runtime evidence: server: expenses already accept future dates (`schemas.ts:2167` FlooredMoneyDateSchema, no upper bound); Owed/Received income refuse them (`schemas.ts:1826` PastMoneyDateSchema); a 10-year-ahead rule already exists (`schemas.ts:861` BoundedMoneyDateSchema). Phone: both pickers stop at today (`details_sheet.dart:95`, `recent_actions.dart:988`). Recent has no place for future rows.
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| Owed income future date (server) | refused | new ticket | in MUT-390 |
| Phone pickers allow future (expense + Owed) | capped at today | new ticket | in MUT-391 |
| Recent "Upcoming" card above Today | none | MUT-391 AC | MUT-391 AC |
| MUT-390 feed includes future rows (sorted above today) | n/a | yes, + test | yes, + test |
| What a future Owed means for Owed now / overdue totals | n/a | specced in the new ticket | specced inside MUT-390 |
Question D6:
D6 — Where should "allow future dates" be built?
ELI10: The new feed will already put future-dated entries above Today, and Recent will get an "Upcoming" card for them. The rest is a separate rule change: the server must accept a future date on Owed income, the phone's date pickers must let you pick future days, and we must decide whether a next-month Owed counts in "owed now" today.
Recommendation: A because it is a different rule with its own accounting question, and keeping it apart lets MUT-390 ship without waiting on that answer.
Header: Future dates
Options:
A) New ticket (recommended)
File a new MUT story (server Owed accepts future dates up to the existing 10-year bound; phone pickers allow future for expense and Owed; how future Owed counts in totals). MUT-390 adds "future rows sort above today" to its tests; MUT-391 gets an "Upcoming" card AC.
B) Fold it in
Owed future-date rule goes into MUT-390 (server) and the picker change into MUT-391 (phone); the totals question is decided inside MUT-390.

State: approved
Actual answer: A) New ticket (D6, answered 2026-10-22)
Accepted scope: file a new MUT story (server Owed accepts future dates up to the existing 10-year bound; phone pickers allow future for expense and Owed; how future Owed counts in totals). MUT-390 adds "future rows sort above today" to its tests; MUT-391 gets an "Upcoming" card AC.
History: none

Approval readiness: PASS — D1 (structure, Smaller), R1 (D5 A, supersedes D2), R2 (D3 A), R3 (D4 A, Basel's words quoted), R4 (D6 A). Section 2 corrections and Section 3 tests are required proof of these approvals.

---

# Amended plan — build from this section

Supersedes the plan at the top where they differ. Base: local main b857e063 (API 1.48.0-mut148).

## Contract
- `GET /v1/entries?order=createdAt|occurredOn` (default `createdAt`, today's behaviour byte for byte).
- `order=occurredOn`: `(moneyDate desc, createdAt desc, id desc)`. Money date per kind: expense `occurredOn`, received `receivedOn`, owed `postingDate`, conversion `occurredOn`. **Future-dated rows (expenses today; Owed once the new future-dates story lands) sort above today.**
- Filters: `occurredFrom` (date, ≥), `occurredBefore` (date, <), `loggedSince` (instant, ≥; `z.string().datetime({ offset: true })`).
- Refused (422 `VALIDATION_FAILED`, `field` set): `occurredFrom` with createdAt order; `loggedSince` with occurredOn order; `occurredBefore` with createdAt order unless `loggedSince` is also sent (D5).
- Cursor: createdAt order keeps `pagination.ts`'s `{t,id}` untouched; occurredOn order uses `{k:'o',o,t,id}`. The feed codec rejects a cursor of the other order **both ways** (a `{k:'o'}` cursor without `order=occurredOn` is 422, checked before delegating to `decodeCursor`, F6).
- Paging under occurredOn order (D3): an entry whose money date changes between page reads can repeat or be missed; clients dedupe by id and re-read page 1 after an edit. Stated in the route description and OpenAPI.
- Wording (F5): `routes/entries.ts` summary/description cover both orders and limit "settle next to its Owed" / "correction next to the reversed one" to the createdAt order; `schemas.ts` envelope `createdAt` comment no longer says "the feed's order".
- `/v1/inbox` unchanged.

## Files (D1: no new module)
| File | Change |
|---|---|
| `prisma/schema.prisma` + migration `2026102x_mut390_entries_money_date_indexes` | 4 indexes: expenses/conversions `(org, occurredOn↓, createdAt↓, id↓)`, payments `(org, receivedOn↓, createdAt↓, id↓)`, receivables `(org, origin, postingDate↓, createdAt↓, id↓)`; plain CREATE INDEX (pilot-sized, sub-second lock) |
| `repositories/ports.ts` | `FeedPageRequest` / `FeedCursor`; `EntriesRepository.list(orgIds, FeedPageRequest)`; `PageRequest` untouched |
| `entries/merge.ts` | `moneyDateOf`, `compareFeed(order)`, `isBeforeFeedCursor(order)`, `encodeFeedCursor` / `decodeFeedCursor(raw, order)`; `mergeNewestFirst(branches, limit, keyOf, compare)` where `keyOf` returns the order's full key and `nextCursor` is built from it (Section 2) |
| `repositories/prisma.ts` | per-kind `{dateCol}`; **each column's bounds built as one range or as separate `AND` entries, never spread over each other (F3)**: cursor `dateCol lte o AND (dateCol lt o OR createdAt lt t OR (createdAt = t AND id lt id))`, filters `dateCol gte/lt`, `createdAt gte` |
| `repositories/memory.ts` | same filters + comparator |
| `schemas.ts` | `ListEntriesQuerySchema`: `order`, 3 filters, `superRefine` for the 3 refusals; envelope comment (F5) |
| `routes/entries.ts` | wire order/filters/codec; description (D3, F5) |
| `app.ts` | `API_VERSION = '1.49.0-mut390'` (F7; renumber at landing if needed) |
| generated | `openapi/openapi.yaml`, `src/hosted/api/schema.d.ts` |
| docs | ADR-168 (renumber at landing), CHANGELOG, PATTERNS (feed order/filter/cursor rule), TEST_PLAN, brief `.claude/designs/mut-390-feed-money-date.md` |

## Tests (write first)
- `merge.test.ts`: compareFeed tie levels; moneyDateOf per kind; nextCursor carries `o`; codec round-trip; wrong order both ways → 422; malformed `o` → 422.
- `store-contract-entries.ts` (memory + Postgres): walk limit 2 across 2 profiles × 3 days × 4 kinds (no drop/repeat at day and same-createdAt boundaries); **filters walked with a cursor, limit 2 (F3)**; a future-dated expense sorts above today's rows; Owed by postingDate, Received by receivedOn; date edited older → appears again (D3); deleted / undone capture still excluded.
- `routes-entries.test.ts`: the 3 refusals; bad dates; `loggedSince` with `+03:00`; `profileId` narrowing with occurredOn; existing assertions untouched (AC6 regression contract).
- `store-prisma-entries-fanout.test.ts`: ≤4 in flight under occurredOn.
- `store-prisma-entries-plan.test.ts`: each kind's occurredOn query uses its new index (first page, past a cursor, with occurredFrom, **filter + cursor together with both bounds in Index Cond (F3)**); loggedSince+occurredBefore uses the createdAt index.
- Verify: `cd server && npm run lint && npm run typecheck && npm test && npm run test:db && npm run openapi:check && npm run build`; root `npm run typecheck`. Fresh test DB `mutaba3a_test_mut390`.

## Handoffs to MUT-391 (comment)
1. Dedupe feed rows by id; re-read page 1 after an edit (D3).
2. Version or wipe the Recent feed cache key when switching to order=occurredOn, so a cached createdAt cursor never reaches the new order (F4).
3. A settle can land outside the window from its Owed; `foldPairs` then shows it alone (existing fallback).
4. Add an "Upcoming" card above Today for future-dated rows (D6).
5. Two reads: window `order=occurredOn&occurredFrom=<cutoff>`; dated-earlier `loggedSince=<now-7d>&occurredBefore=<cutoff>`.

## NOT in scope
- Accepting future dates on Owed income and opening the phone pickers: new story (D6).
- `/v1/inbox` ordering (D5 in the original plan; MUT-391 keeps Unsorted out).
- `COLLATE "C"` on the date indexes (F8): every stored value is validated `YYYY-MM-DD`, so code-point and collation order agree; revisit only if a non-validated import path appears.
- Freezing pages server-side (D3 B, rejected).

## What already exists
`mergeNewestFirst` (generalised, not rewritten), `feedCursorWhere`'s bounded-OR keyset (copied per date column), `pagination.ts` codec (delegated to, untouched), `IsoDateSchema`, the EXPLAIN harness and the memory/Postgres contract suite from MUT-270, existing `(org, occurredOn, id)` indexes (kept for ledger lists).

## Failure modes
| Path | Realistic failure | Covered by | User sees |
|---|---|---|---|
| filter + cursor where-clause | a spread drops a bound: paging loops or filter vanishes | contract walk with filters, EXPLAIN Index Cond | (would be duplicates/missing rows) now tested |
| cursor codec | foreign cursor accepted, wrong page | merge.test both directions | clear 422 |
| date edited mid-scroll | row repeats or is missed | documented; MUT-391 dedupes | duplicate removed; missing until refresh |
| index missing on prod | seq scan per page | EXPLAIN test + migration | slow Recent, no error |
| old phone cache cursor | 422 on first scroll | MUT-391 cache-key handoff | none once handled |
Critical gaps: 0.

## Worktree parallelization
Sequential implementation, no parallelization opportunity (one module, `server/src/entries` + its store adapters).

## Implementation Tasks
- [ ] **T1 (P1, human: ~1h / CC: ~5min)** — schema — 4 indexes + migration. Surfaced by: plan D2. Verify: `npm run test:db` plan test.
- [ ] **T2 (P1, human: ~3h / CC: ~15min)** — entries/merge.ts — comparator, key, codec (both-way rejection). Surfaced by: Section 2 nextCursor, F6. Verify: merge.test.
- [ ] **T3 (P1, human: ~3h / CC: ~15min)** — prisma.ts + memory.ts — order/filters with non-overlapping bounds. Surfaced by: F3. Verify: store-contract-entries (memory + Postgres).
- [ ] **T4 (P1, human: ~2h / CC: ~10min)** — schemas.ts + routes/entries.ts — params, 3 refusals, offset datetime, wording. Surfaced by: D5, Section 2, F5, D3. Verify: routes-entries.
- [ ] **T5 (P1, human: ~2h / CC: ~10min)** — EXPLAIN + fan-out tests. Surfaced by: AC5, F3. Verify: `npm run test:db`.
- [ ] **T6 (P2, human: ~1h / CC: ~5min)** — API 1.49.0-mut390, openapi + schema.d.ts regen, ADR-168, CHANGELOG/PATTERNS/TEST_PLAN, brief. Surfaced by: F7. Verify: `npm run openapi:check`, root typecheck.
- [ ] **T7 (P2, human: ~15min / CC: ~2min)** — Jira: MUT-391 handoff comment; new future-dates story. Surfaced by: F4, D3, D6.

## Completion summary
- Step 0: Scope Challenge — scope accepted as-is (structure: Smaller arrangement, D1)
- Reality rows: 7/7 applicable rows emitted (`PLAN_REALITY: phase=eng rows=7/7 verdict=complete`), 0 unverified premises
- Architecture Review: 2 issues found (R2 date-edit paging, settle pairing note)
- Code Quality Review: 2 issues found (nextCursor key, offset datetime)
- Test Review: diagram produced, 15 gaps identified (all planned)
- Performance Review: 1 issue found (index build lock, accepted)
- NOT in scope: written
- What already exists: written
- TODOS.md updates: 0 items proposed to user
- Failure modes: 0 critical gaps flagged
- Unresolved decisions: 0 in this review
- Outside voice: codex not installed; native Claude Plan subagent completed (8 findings: F1 → D4, F2 → D5, F3–F7 accepted under D4 A, F8 not in scope); outside_status unavailable
- Parallelization: 1 lane, 0 parallel / 1 sequential
- Lake Score: 4/5 = answers picking a 10/10 option / answers scored (D2, D3, D5 scored; D3 A scored 9; D2 superseded)

## Suppressed findings
- (confidence 4) Malafat-fed firms with many INSTALLMENT receivables might make the receivables index build longer than "sub-second"; not measured, no prod data locally.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Outside Review | native Claude Plan subagent (codex not installed) | Independent 2nd opinion | 46 | unavailable (native completed) | 8 findings: 1 High, 4 Medium, 3 Low; all dispositioned |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 48 | ISSUES OPEN | 20 issues, 0 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 10 | ISSUES OPEN (2026-10-19, a different plan) | not run for MUT-390 (server-only) |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **OUTSIDE COVERAGE:** codex: unavailable (not installed). Native Claude Plan subagent completed within the 5-minute timer; it found the phone-only alternative (D4) and the wrong R1 premise (D5). Native coverage does not count as outside coverage.
- **VERDICT:** Eng review complete with all findings mapped to tasks; status ISSUES OPEN means mapped work, not blockers. Ready to implement from "Amended plan".

**UNRESOLVED DECISIONS:**
- none in this review + 14 unresolved from prior reviews
