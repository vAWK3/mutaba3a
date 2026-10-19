# MUT-267 — Hosted API: expense groups + per-day / per-category totals

Epic MUT-266. Blocks MUT-268 (portal), MUT-269 (phone), MUT-273 (per-day FX, follow-up).
No blockers. Template to copy: conversions (MUT-161/194) — session-only, versioned, soft-deleted, memory + Prisma stores, shared store contract.

## Decisions made at planning (2026-10-18, Basel)
- D1 **No server conversion.** ADR-087 #4 stands. Summary is per currency only; portal/phone convert with `/v1/fx-rates` at today's rate, labelled. The ticket's "converted block" criterion moves to MUT-268/269. Per-day-rate conversion = MUT-273 (needs ADR-087 override there, not here).
- D2 **Add `GET /v1/expense-groups?expenseId=`** so MUT-268's "In groups" line doesn't wait on another API change.

## Design choices (mine, for review)
- D3 **Groups live under the existing `expenses` domain.** Same scopes (`expenses:read|write`), session-only, writer of record USER. The `expenses` row's routes cell gains `/v1/expense-groups*`, in both `WRITABILITY_MATRIX` and the brief block in `.claude/designs/hosted-portal.md` (writability-drift test compares them). No new scope, no new domain.
- D4 **Membership is computed when read, never stored.** Member ⇔ live expense AND ((startOn ≤ occurredOn ≤ endOn ?? startOn+365) AND no `excluded` override) OR an `included` override. (*Re-review R6, 2026-10-18:* open groups stop collecting a year after their start.) One pure predicate `isGroupMember(expense, group, overrideMode)` in `server/src/expense-groups/membership.ts`. The memory store uses it, and the Prisma where-builder is tested against it in the shared store contract.
- D5 **Members are listed through the existing ledger:** `GET /v1/expenses?groupId=…[&groupMembership=member|excluded]`. `ExpenseFilter` gains `group?: { id, startOn, endOn|null, membership }`. The Prisma `expenseWhere` adds the clause inside `AND: [...]`, because `expenseCursorWhere` already owns the `AND` key, so the clauses are merged rather than spread-overwritten. Same (occurredOn, id) cursor, same indexes, no second paging scheme.
- D6 **Overrides are idempotent PUT/DELETE per expense, without If-Match:** `PUT /v1/expense-groups/{id}/expenses/{expenseId}` `{ mode: 'excluded'|'included' }`, `DELETE` = reset. Last write wins, because an override is a per-expense toggle, not a document. Any mode is accepted on any expense of the profile, and an `included` in-range expense simply stays a member after its date moves (the "explicitly included" rule). The group's own `version` isn't bumped by overrides.
- D7 **Open-ended groups:** the summary's day series runs `startOn → min(today, startOn + 365d)`. Created ranges are capped at 366 days (`GROUP_RANGE_TOO_LONG`). This bounds the payload and the expense scan.
- D8 **Day series:** zero-filled for every day in the series, per currency. *Amended by MUT-268 design review (6A, 2026-10-18):* every member dated outside the series (kept out-of-range days **and** future-dated or older-than-series members of an open group) gets a sparse bucket with `position: 'before' | 'after'`, so the buckets always sum to the currency total. In-series buckets carry `position: 'in'`. Sorted by date.
- D9 **Summary reuses `summarizeExpenses`** (byCategory, byCustomer) and adds `byDay` via a new pure `dayBuckets()`. It loads members with the same 200-row paging loop as `/v1/summaries/expenses`.

## API (API_VERSION → 1.32.0-mut267, `openapi.yaml` regenerated)
| Method | Path | Notes |
|---|---|---|
| GET | /v1/expense-groups | newest `startOn` first; `?expenseId=` → groups containing it (D2); unpaged (a profile holds tens of groups); `includeDeleted` no. *Amended (MUT-268 3A):* each item carries `currencies: [{ currency, total, count }]` and `memberCount` |
| POST | /v1/expense-groups | Idempotency-Key; `{ name 1–120, startOn, endOn?, notes? }` |
| GET | /v1/expense-groups/{id} | group + `excludedCount` (*amended, MUT-268 22A:* in-range excluded only; *re-review R7:* `includedCount` removed) |
| PATCH | /v1/expense-groups/{id} | If-Match; name/startOn/endOn(null clears)/notes |
| DELETE | /v1/expense-groups/{id} | soft; 204 again if already deleted; expenses untouched |
| PUT/DELETE | /v1/expense-groups/{id}/expenses/{expenseId} | override set / reset (D6) |
| GET | /v1/expense-groups/{id}/summary | `{ group, seriesFrom, seriesTo, currencies: [{ currency, total, count, byCategory, byCustomer, byDay: [{ date, total, count, position }] }] }` (*amended, MUT-268 6A*) |
| GET | /v1/expenses?groupId=&groupMembership= | D5. *Amended (MUT-268 22A):* `groupMembership=excluded` lists only excluded expenses dated inside the group range |

Validation (422 `VALIDATION_FAILED` style, like the rest of the API; the ticket's "400" is amended the way ADR-087 amended MUT-228's): `END_BEFORE_START`, `GROUP_RANGE_TOO_LONG`, MUT-227 floor on startOn/endOn via `assertNotTooOld` (an unchanged resent date isn't re-checked, as with `expensePatch`), `NOT_FOUND` for a group or expense outside the profile.

## QA scenarios (release-QA)
MUT-267 ships no UI, and release-QA covers the `web` and `portal` apps only, so its user-visible flows are specified as portal features in MUT-268 (`qa/features/portal/expense-groups.yaml`): create a trip, see expenses dated in it, leave one out and undo, keep one from before the trip, see totals per currency and per day. Each of those promises is pinned here by the route tests in `mut-267-expense-groups-api-tests.md`. Server files map to those portal features when MUT-268 lands.

## Scope note: client-accounting core override
The 2026-10-05 scope decision keeps expenses optional. Expense groups are a deliberate exception that Basel asked for on 2026-10-18 (MUT-266). They live inside the hosted expenses domain, which is already user-writable and session-only, and add no sidebar entry (MUT-268 1A). Logged in ADR-094.

## Files
**Server (new)**
- `prisma/migrations/2026101809xxxx_mut267_expense_groups/migration.sql` — `expense_groups` (id, organizationId, name, startOn, endOn?, notes?, createdByUserId, version, timestamps, deletedAt; index `(organizationId, deletedAt, startOn desc)`), `expense_group_overrides` (groupId, expenseId, organizationId, mode enum, createdAt; PK `(groupId, expenseId)`; index `(expenseId)` for the `?expenseId=` lookup and the Prisma `some/none` relation filter)
- `src/expense-groups/membership.ts` (predicate, range rules), `summary.ts` (`dayBuckets`, `summarizeGroup`), `compose.ts` (create/patch validation)
- `src/routes/expense-groups.ts`
- tests: `src/expense-groups/__tests__/{membership,summary,compose}.test.ts`, `src/__tests__/routes-expense-groups.test.ts`, `src/repositories/__tests__/store-contract-expense-groups.ts` + `store-memory-expense-groups.test.ts` + `store-prisma-expense-groups.test.ts`, `migration-mut267.test.ts`

**Server (touch)**
- `prisma/schema.prisma` (2 models, relations on Expense/Organization/User)
- `src/repositories/ports.ts` (`ExpenseGroupRepository`, `ExpenseFilter.group`, `LedgerStore.expenseGroups`), `memory.ts`, `prisma.ts` (`expenseWhere` AND-merge)
- `src/schemas.ts`, `src/serializers.ts`, `src/app.ts` (mount + API_VERSION), `src/routes/expenses.ts` (`groupId` query → filter; 404 when the group isn't the profile's)
- `src/expenses/compose.ts` — `EXPENSE_ENTITY_TYPES` += `expense_group` (Malafat's audit key never lists it)
- `src/auth/writability.ts` + `.claude/designs/hosted-portal.md` matrix block (D3)
- Any org-wide purge/type-change path that enumerates expense tables (grep `expenseCategories.seed`/profile type change): groups survive a type change, categories go → byCategory shows `null`, a contract test pins this
- `openapi/openapi.yaml` (regenerated by `openapi:check` script)

**Knowledge:** ADR-093 (groups: computed membership, overrides, no server FX), CHANGELOG, SYSTEM_OVERVIEW, TEST_PLAN, TECH_DEBT if any. Design brief `.claude/designs/mut-267-expense-groups-api.md` (+ `-tests.md`) written first at /eng-build, with a QA-scenarios section. This ticket has no UI, so release-QA coverage is API-only, and the portal and phone specs come in 268/269.

## Tests that prove each acceptance criterion (TDD, written first)
| AC | Test |
|---|---|
| 5 Oct expense logged 9 Oct joins a 3–7 Oct group | route test: create group, POST expense later, summary count/total |
| exclude drops from every total; reset restores | route: PUT excluded → summary + `?groupId` list both drop; DELETE → back |
| included 12 Sep flight counts + own day bucket | route + `dayBuckets` unit: `inRange:false` bucket 2026-09-12 |
| date moved out of range removes unless included | route: PATCH expense date → gone; with included override → stays |
| delete expense → out of every group; delete group → expenses untouched | route |
| JOD/USD/ILS separate (converted block removed per D1) | summary unit + route: 3 blocks, no cross-currency sum |
| zero days in series | `dayBuckets` unit |
| refuse users without write access | route-security test picks up the new routes; API key → 403 (session-only); other profile's group → 404 |
| bad ranges / floor → error code | compose unit + route |
| membership predicate = Prisma where | shared store contract run on memory + Prisma (test:db) |

Commands: `npm --prefix server run typecheck && npm --prefix server run lint && npm --prefix server run openapi:check && npm --prefix server test`, and `test:db` against `mutaba3a-test-pg`. All under Node 22.

## Scale / cost
- The summary reads only members: one range-bounded scan on the existing `(organizationId, occurredOn desc, id desc)` index, plus an indexed override join. The range cap (D7) bounds it to ≤ 1 year of one profile's expenses. No external calls (D1).
- `?expenseId=` loads the profile's groups (tens) + that expense's overrides (by index) and evaluates in memory.
- No new infra, env vars or third-party spend.

---
# /plan-eng-review — MUT-267 plan (this file is the target and the report file)

## Scope record
feature answers: none proposed (every endpoint maps to an AC or owner decision D2); structure: A Smaller arrangement (D1, answered 2026-10-18); accepted scope: all endpoints and contracts in the plan above, with `server/src/expenses/groups.ts` (isGroupMember, range rules, create/patch validation) and `dayBuckets`/`summarizeGroup` added to `server/src/expenses/summary.ts` instead of a new `src/expense-groups/` folder; routes stay in `server/src/routes/expense-groups.ts`; pending remedies: R2 range cap, R3 override strictness, R4 regression contract.
Scope Challenge result: scope accepted as-is (smaller arrangement preserves scope).

## Scope Challenge findings (corrections, no behaviour choice)
- C1 [P2] (confidence 9/10) ticket AC "→ 400" vs API convention. `server/src/routes/expenses.ts`: `if (from > to) throw validationError('END_BEFORE_START', ...)`, which answers 422 VALIDATION_FAILED. Correction: group validation answers 422 like every route (ADR-087 amended MUT-228 the same way). Ticket text to be noted at hand-off.
- C2 [P2] (confidence 9/10) plan D7 series bound `startOn → min(today, startOn + 365d)` inverts for a planned trip with a future start and no end (seriesTo < seriesFrom). Correction: `seriesTo = max(startOn, min(today, startOn + 365d))` for open-ended groups, `endOn` otherwise; "today" is `todayFor(organization, now)` (profile timezone), as `/v1/summaries/expenses` does.
- C3 [P2] (confidence 9/10) range rules on PATCH. `expensePatch` checks only fields in the body. A PATCH of `endOn` alone must be validated against the stored `startOn` (and vice versa). Correction: validate the merged (existing + patch) range for END_BEFORE_START and the range cap; the floor check skips an unchanged resent date, exactly like `expensePatch`'s `occurredOn`.
- C4 [P3] (confidence 8/10) MUT-91 anchor on the ledger. `ledgerPageStart(q, decodeExpenseCursor, (id) => store.expenses.getById(organization.id, id), ...)` resolves an anchor without the group filter. Correction: with `groupId`, the anchored page still applies the membership filter, and the route test pins that an anchor on a non-member starts the page at its position without listing it.

## Section 1 — Architecture
- A1 [P2] (confidence 8/10) cross-profile override: correction — route resolves group and expense via org-scoped getById before writing; contract test: another profile's expense id → 404. Disposition: accepted (correction).

## Decision ledger

### R2: Longest date range a group may cover
Finding: Section 1, P2, confidence 8/10, plan D7 (mut-267-plan.md "Created ranges are capped at 366 days"), reviewer: Claude (plan-eng-review)
Plan baseline: original proposal D7 — cap stored ranges at 366 days (GROUP_RANGE_TOO_LONG); open-ended series clamps per C2. Not approved.
Runtime evidence: `/v1/summaries/expenses` loads every row of its range in 200-row pages (routes/expenses.ts), with no cap; the MUT-227 floor allows dates ten years back.
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R2 range cap | proposed 366 days, pending | 366 days, 422 GROUP_RANGE_TOO_LONG on create and merged PATCH | none; range bounded only by the ten-year floor |
| Open-ended series end (C2) | approved correction | startOn+365 clamp | no clamp: today |
| R3 override strictness | pending | pending | pending |
| R4 regression contract | pending | pending | pending |
Question D2:
D2 — How long may one expense group run?
Project/branch/task: MUT-267 plan (hosted API), the group date-range rule.
ELI10: A group covers dates from a start to an end. The summary reads every expense in that span and returns one row per day. A cap keeps that read and the day list small; without one, a "2016 to now" group reads ten years of spending and sends back 3,650 day rows per currency.
Stakes if we pick wrong: Too tight and a long project (a renovation over 14 months) can't be a group; no cap and one big group makes the slowest call in the API.
Recommendation: A because trips and events fit in a year, and the cap keeps the summary bounded and cheap.
Completeness: A=9/10, B=7/10
Pros / cons:
A) Cap at 366 days (recommended)
  ✅ Summary reads at most a year of one profile's spending; day list at most 366 rows
  ✅ Clear 422 GROUP_RANGE_TOO_LONG instead of a slow call
  ❌ A project longer than a year must be split into two groups
B) No cap
  ✅ Any span works, including multi-year projects
  ❌ Unbounded scan and payload; a ten-year group means about 3,650 buckets per currency
Net: bounded, predictable calls versus groups of any length.
Header: Range cap
Options:
A) Cap at 366 days (recommended)
Create and PATCH (merged range) refuse spans over 366 days with 422 GROUP_RANGE_TOO_LONG; open-ended series ends at min(today, start+365). Tests in groups unit + route. Human ~1h / CC ~5 min.
B) No cap
Any span allowed down to the ten-year floor; open-ended series runs to today. Summary payload and scan grow with the span. Human ~0 / CC ~0.

State: approved
Actual answer: A) Cap at 366 days (D2, answered 2026-10-18)
Accepted scope: create and PATCH (merged existing + patch range) refuse spans over 366 days with 422 GROUP_RANGE_TOO_LONG; open-ended series ends at max(startOn, min(today, startOn+365)) per C2; tests in groups unit + route.
History: none

### R3: Which overrides an expense may carry
Finding: Section 1, P3, confidence 7/10, plan D6 ("Any mode is accepted on any expense of the profile"), reviewer: Claude (plan-eng-review)
Plan baseline: original proposal D6 — permissive. Not approved.
Runtime evidence: none (new behaviour).
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R3 override strictness | proposed permissive, pending | permissive: any mode on any profile expense; persists across date moves | strict at write: exclude only a current in-range member, include only an out-of-range expense (422 OVERRIDE_NOT_APPLICABLE); stored overrides still apply as stored after date moves |
| R2 range cap | pending | pending | pending |
| R4 regression contract | pending | pending | pending |
Question D3:
D3 — Which "keep/leave out" marks may an expense carry?
Project/branch/task: MUT-267 plan (hosted API), membership overrides.
ELI10: You can mark an expense "leave out" or "keep" for a group. Loose rules accept either mark on any expense; strict rules only accept "leave out" on something already inside the dates and "keep" on something outside them. Strict blocks marks that do nothing today, but a mark can still go stale once the expense's date changes.
Stakes if we pick wrong: Loose allows marks that look pointless in raw data; strict adds an error path the portal and phone must handle for little gain.
Recommendation: A because one simple rule is easier to trust, and the UI only offers the mark that makes sense anyway.
Note: options differ in kind, not coverage — no completeness score.
Pros / cons:
A) Accept any mark (recommended)
  ✅ One-line membership rule, no extra error code for clients to handle
  ✅ "Keep" on an in-range expense survives a later date move, matching the AC wording
  ❌ The API stores marks that change nothing until the date moves
B) Strict at write time
  ✅ Rejects a "leave out" on an expense that was never in the group
  ❌ New 422 path in two clients, and marks still go stale after date edits
Net: simpler rule and clients versus slightly tidier stored data.
Header: Overrides
Options:
A) Accept any mark (recommended)
PUT accepts excluded or included on any expense of the profile; marks persist through date changes; DELETE resets. Human ~0 / CC ~0 beyond plan.
B) Strict at write time
PUT refuses excluded on a non-member and included on an in-range expense with 422 OVERRIDE_NOT_APPLICABLE; stored marks apply as stored after date changes. Human ~1h / CC ~10 min, plus client error handling in MUT-268/269.

State: approved
Actual answer: A) Accept any mark (D3, answered 2026-10-18)
Accepted scope: PUT accepts excluded or included on any expense of the profile; marks persist through date changes; DELETE resets; no OVERRIDE_NOT_APPLICABLE code.
History: none

### R4: Regression contract for the shared expense ledger
Finding: Section 3, regression rule. Plan D5 changes `expenseWhere` / `ExpenseFilter`, used by GET /v1/expenses and /v1/summaries/expenses.
Plan baseline: no group filter → identical results, ordering and cursors.
Runtime evidence: existing coverage — `server/src/repositories/__tests__/store-contract-expenses.ts:62` (newest first, pages without gaps, every filter; memory + Prisma) and `:93` (MUT-91 inclusive cursor); `server/src/__tests__/routes-expenses.test.ts:327, 346, 360` (filters, anchor, anchor refusals).
State: resolved without a question — the regression contract is already enforced by existing tests that stay in the suite; no behaviour change intended.
Actual answer: n/a (factual)
Accepted scope: keep those tests unchanged and green.
History: none

## Section 2 — Code quality
- Q1 [P2] (confidence 9/10) prisma.ts:1534 `return { AND: [{ OR: [...] }] }` from expenseCursorWhere is spread after expenseWhere; correction: merge filter and cursor clauses into one AND array. Disposition: accepted (correction).

## Section 3 — Tests
```
CODE PATHS                                                   USER FLOWS (via portal/phone, MUT-268/269)
[+] expenses/groups.ts
  ├── isGroupMember: in-range/excluded/included/deleted       [+] Create trip 3–7 Oct, log 5 Oct expense on 9 Oct
  │   └── [GAP→unit] table of 6 cases (plan AC rows)            └── [GAP→route] summary count/total
  ├── validateRange: end<start, >366 (R2), floor, open-ended  [+] Exclude / reset an expense
  │   └── [GAP→unit] incl. merged PATCH (C3)                    └── [GAP→route] summary + ?groupId list
  └── seriesBounds: closed, open past, open future (C2)       [+] Keep a 12 Sep flight
      └── [GAP→unit]                                            └── [GAP→route] own day bucket inRange:false
[+] expenses/summary.ts dayBuckets/summarizeGroup             [+] Move expense date out of range
  ├── zero-fill, sparse out-of-range, per currency            │   └── [GAP→route] gone; with keep mark stays
  └── [★★★ TESTED existing] summarizeExpenses summary.test.ts [+] Delete expense / delete group
[+] routes/expense-groups.ts                                    └── [GAP→route]
  ├── POST idempotent replay / PATCH If-Match 409 stale       [+] "In groups" line (?expenseId=, D2)
  ├── PUT/DELETE override; foreign expense or group → 404(A1)   └── [GAP→route] in-range, excluded, included cases
  ├── summary on deleted group → 404                          [+] Error states
  └── API key → 403 (session-only)                              ├── [GAP→route] 422 END_BEFORE_START / GROUP_RANGE_TOO_LONG / DATE floor
[+] routes/expenses.ts ?groupId=&groupMembership=               └── [GAP→route] 404 unknown/other-profile group
  ├── member / excluded listing, cursor paging
  ├── anchor + groupId (C4)
  └── [★★★ TESTED existing] list/filters/anchor routes-expenses.test.ts:327,346,360
[+] store: ExpenseGroupRepository + ExpenseFilter.group
  ├── [GAP→contract, memory + Prisma/test:db] predicate parity, AND-merge with cursor (Q1)
  ├── profile type change → groups survive, byCategory null
  └── [★★★ TESTED existing] store-contract-expenses.ts:62, :93
[+] migration-mut267: tables, PK, indexes from empty     [GAP→test:db]

COVERAGE: existing 3/… paths ★★★ (ledger, summarizer); every new path has a planned test
QUALITY: no ★ smoke tests proposed  |  GAPS: all closed by planned tests below (0 E2E: API-only ticket; portal/phone E2E in MUT-268/269)
```
Tests added to the plan (required proof of approved behaviour; no new policy):
- `server/src/expenses/__tests__/groups.test.ts` (unit): isGroupMember table; range rules incl. merged PATCH, 366 cap, floor, open-ended future (C2/C3/R2). Value: protects=membership and range rules; fails_when=an override or bound is inverted; why_new=no group code exists; seam=none
- `server/src/expenses/__tests__/summary.test.ts` (extend existing): dayBuckets zero-fill, sparse out-of-range, per currency, ordering. Value: protects=day series shape; fails_when=a gap day or out-of-range bucket is dropped; why_new=extends existing summarizer table; seam=none
- `server/src/__tests__/routes-expense-groups.test.ts` (route, memory store): every AC row + C4, A1, D2 lookup, idempotent replay, If-Match 409, API key 403, deleted group 404, 422 codes. Value: protects=public API contract; fails_when=a route skips the org check or filter; why_new=new routes; seam=none
- `server/src/repositories/__tests__/store-contract-expense-groups.ts` + `store-memory-expense-groups.test.ts` + `store-prisma-expense-groups.test.ts`: predicate parity memory vs Prisma, AND-merge with cursor, overrides PK upsert, type change survival. Value: protects=Prisma where equals isGroupMember; fails_when=the SQL clause diverges; why_new=only a Postgres run can catch it; seam=none
- `server/src/repositories/__tests__/migration-mut267.test.ts` (test:db): migrates from empty. Value: protects=migration contract; fails_when=a column or index is missing; why_new=pattern of migration-mut194; seam=none
Tests made obsolete by this plan: none.

## Section 4 — Performance
- P1 [P3] (confidence 6/10, medium confidence, verify) the member query is `range OR EXISTS(include)` with `NOT EXISTS(exclude)`; Postgres should BitmapOr the `(organizationId, occurredOn desc, id desc)` index with the override PK. Scale: ≤ 366 days of one profile (hundreds to low thousands of rows, ≤ N/200 page queries per summary). No change; worth an EXPLAIN during test:db if a summary is slow.
- `?expenseId=`: two indexed queries (profile's groups, that expense's overrides). No N+1.
- No external calls (D1), no caches added.
Dispositions: P1 noted, no change.

## Outside voice
Codex CLI not installed (CODEX_MODE: not_installed); native fallback needs TaskOutput and TaskStop, which this session does not declare. Outside voice unavailable; no outside coverage, no clean-review credit from it.

## TODOS.md
No TODO proposals: the only deferred item (per-day FX) is already ticketed as MUT-273.

Approval readiness: PASS — R2 (D2, A), R3 (D3, A); R4 resolved by existing tests; C1–C4, A1, Q1 are corrections to the plan's own rules.

## NOT in scope
- Server-side conversion of any kind (D1, ADR-087 #4); per-day FX is MUT-273.
- Local web / Dexie groups (epic decision).
- Portal and phone UI and their E2E/release-QA specs (MUT-268/269).
- A strict override policy (R3 chose permissive).

## What already exists
- Reused: `summarizeExpenses` (byCategory/byCustomer), the 200-row loop of `/v1/summaries/expenses`, `assertNotTooOld`, `todayFor`, `idempotent`, `ifMatch`, `ledgerPageStart`, `expenses` writability row and scopes, conversions CRUD/store-contract pattern.
- Rejected: folding into `/v1/summaries/expenses?groupId=` (group-specific 404, series bounds and inRange buckets need their own contract).

## Failure modes
| Path | Realistic failure | Covered by | User sees |
|---|---|---|---|
| summary | group deleted in another tab | route test 404 | clear 404 |
| override PUT | expense deleted meanwhile | route test 404 | clear 404 |
| ?groupId list | Prisma clause diverges from predicate | store contract on Postgres | (caught pre-release) |
| PATCH range | endOn-only patch makes end < start | unit + route (C3) | clear 422 |
| open-ended future trip | inverted series | unit (C2) | n/a (fixed) |
Critical gaps: 0.

## Worktree parallelization strategy
Sequential implementation, no parallelization opportunity (one module: server/; migration → store → routes depend in order).

## Implementation Tasks
Synthesized from this review's findings. Each task derives from a specific finding above.
- [ ] **T1 (P1, human: ~1h / CC: ~5min)** — groups rules — validate the merged range on PATCH and cap at 366 days
  - Surfaced by: Scope C3, R2/D2
  - Files: server/src/expenses/groups.ts, server/src/expenses/__tests__/groups.test.ts
  - Verify: npm --prefix server test -- groups
- [ ] **T2 (P1, human: ~30min / CC: ~5min)** — series bounds — open-ended future start never inverts
  - Surfaced by: Scope C2
  - Files: server/src/expenses/summary.ts, server/src/expenses/__tests__/summary.test.ts
  - Verify: npm --prefix server test -- summary
- [ ] **T3 (P1, human: ~1h / CC: ~10min)** — Prisma expenseWhere — merge group and cursor clauses into one AND array
  - Surfaced by: Section 2 Q1
  - Files: server/src/repositories/prisma.ts, server/src/repositories/__tests__/store-contract-expense-groups.ts
  - Verify: npm --prefix server run test:db
- [ ] **T4 (P1, human: ~30min / CC: ~5min)** — override routes — org-scoped lookup of group and expense before writing
  - Surfaced by: Section 1 A1
  - Files: server/src/routes/expense-groups.ts, server/src/__tests__/routes-expense-groups.test.ts
  - Verify: npm --prefix server test -- routes-expense-groups
- [ ] **T5 (P2, human: ~30min / CC: ~5min)** — ledger anchor — membership filter still applies with anchor + groupId
  - Surfaced by: Scope C4
  - Files: server/src/routes/expenses.ts, server/src/__tests__/routes-expense-groups.test.ts
  - Verify: npm --prefix server test -- routes-expense-groups
_No new tasks from Performance._

## Unresolved decisions
None.

## Completion summary
- Step 0: Scope Challenge — scope accepted as-is (smaller arrangement, D1)
- Architecture Review: 1 issue found (A1) + 2 decisions (R2, R3)
- Code Quality Review: 1 issue found (Q1)
- Test Review: diagram produced, 5 test files planned for all gaps; regression contract held by existing tests
- Performance Review: 1 note (P1), no change
- NOT in scope: written
- What already exists: written
- TODOS.md updates: 0 items proposed
- Failure modes: 0 critical gaps flagged
- Unresolved decisions: 0
- Outside voice: codex, unavailable (CLI not installed; native fallback tools not declared)
- Parallelization: 1 lane, 0 parallel / 1 sequential
- Lake Score: 0/1 (D2 picked the best offered option, scored 9/10; D1 and D3 differ in kind)

## Suppressed findings
None.

## Design review amendments (MUT-268 /plan-design-review, 2026-10-18)
The portal design review changed three API contracts. They supersede the matching lines above (already edited in place) and need the eng review to re-validate them before /eng-build.

1. **List totals (3A).** `GET /v1/expense-groups` items gain `currencies: [{ currency, total, count }]` and `memberCount`. *Re-review D1:* computed per group by `store.expenses.totalsByCurrency(orgId, { group })` (Prisma `groupBy(['currency'])` with `_sum`/`_count` over `expenseWhere`'s group clause; memory store: `isGroupMember` + sum), at most 4 groups at a time (A2). Same filter as the member list, so list totals can't drift from the summary.
2. **Every out-of-series member gets a bucket (6A).** `dayBuckets` emits sparse buckets for any member outside `seriesFrom..seriesTo`, with `position: 'before' | 'after'`, replacing the `inRange` flag. Invariant: the sum of a currency's buckets equals its total.
3. **Excluded means in-range excluded (22A).** `groupMembership=excluded` and `excludedCount` include only excluded expenses whose `occurredOn` falls inside the group range. Out-of-range excluded marks stay stored and invisible.

Unchanged by design: one save per pick and per bulk leave-out (12A/13A, no batch endpoint); picker pool, per-day figure, weekly bars and other-currency markers are client-side; the portal loads all member pages (bounded by the cap) and orders them oldest-first itself (4A); the converted line uses `GET /v1/fx-rates?base=<profile default>`.

Added tests:
- `summary.test.ts`: buckets sum to the total for (a) a kept pre-trip day, (b) a future-dated member of an open group, (c) an open group older than the series clamp; `position` values. Value: protects=chart reconciles with headline; fails_when=an out-of-series member is dropped; why_new=new invariant; seam=none
- `routes-expense-groups.test.ts`: list items carry per-currency totals, counts and memberCount matching each group's summary; excluded listing and `excludedCount` drop an excluded expense once its date moves out of range. Value: protects=list and excluded contracts; fails_when=list totals diverge from summary; why_new=new fields; seam=none
- store contract: the union scan assigns an expense to two overlapping groups. Value: protects=multi-group membership in the list path; fails_when=an expense counts in one group only; why_new=new query path; seam=none

Added tasks:
- [ ] **T6 (P1, human: ~2h / CC: ~10min)** — list — per-group totals via `totalsByCurrency` (groupBy aggregate, concurrency 4)
- [ ] **T7 (P1, human: ~1h / CC: ~5min)** — summary — sparse buckets for every out-of-series member, `position`
- [ ] **T8 (P1, human: ~30min / CC: ~5min)** — excluded listing/count — in-range only

# /plan-eng-review (re-run) — MUT-267 design-review amendments, 2026-10-18
Target: the section "Design review amendments (MUT-268 …)" above. Prior decisions D1–D3, R2, R3 and corrections C1–C4, A1, Q1 stand.

## Scope record (re-run)
feature answers: none proposed; structure: B Smaller arrangement (D1 of this run, answered 2026-10-18); accepted scope: amendment 1 computes list totals with `store.expenses.totalsByCurrency(orgId, { group })` — Prisma `groupBy(['currency'])` with `_sum.amountMinor` and `_count` over `expenseWhere`'s group clause (memory store: `isGroupMember` + sum), run per group with `Promise.all`, replacing the union scan; amendments 2 and 3 unchanged; pending remedies: R6 open-group membership window, R7 includedCount.
Scope Challenge result: scope accepted as-is (smaller arrangement preserves scope).

## Scope Challenge findings (re-run)
- F1 [P1] (confidence 9/10) plan D4: `Member ⇔ live expense AND ((startOn ≤ occurredOn ≤ endOn-or-∞) …`. An open-ended group's membership has no upper bound, but R2's 366-day cap only checks stored ranges and C2 clamps only the day series. An open group never closed keeps collecting forever, so its summary scan, its list aggregate and amendment 2's "after" buckets all grow without bound. → R6.
- F2 [P3] (confidence 8/10) plan API row `group + excludedCount (in-range excluded only), includedCount`. After 22A, `includedCount` is ambiguous (in-range keep marks are no-ops) and no MUT-268 decision reads it. → R7.
- C5 correction (amendment 2): series buckets carry `position: 'in'`, sparse ones `'before' | 'after'`; `inRange` is removed everywhere (schema, serializer, tests).

## Decision ledger (re-run)

### R6: Does an open-ended group stop collecting after a year?
Finding: F1, P1, confidence 9/10, plan D4, reviewer: Claude (plan-eng-review re-run)
Plan baseline: D4 as written — open group membership is startOn → ∞.
Runtime evidence: none (new code); R2/C2 bound only stored ranges and the series.
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R6 open-group window | startOn → ∞ (pending) | startOn → startOn+365; later expenses don't join | startOn → ∞; summary and list grow with time |
| R7 includedCount | pending | pending | pending |
| D1 structure | B approved | B | B |
Question D2:
D2 — Does a "still going" group stop collecting after a year?
Project/branch/task: MUT-267 membership rule (D4), re-review of the design amendments.
ELI10: A group with no end date collects every later expense. Nothing stops it, so an open group forgotten for three years would pull in three years of spending: slow pages, and a trip total that's wrong. Capping open groups at a year matches the rule that closed groups can't be longer than a year.
Stakes if we pick wrong: A forgotten open group silently absorbs years of unrelated spending and slows every list load.
Recommendation: A because it makes "a group covers up to a year" true for open groups too, keeping every call bounded.
Completeness: A=9/10, B=6/10
Pros / cons:
A) Open groups stop at a year (recommended)
  ✅ Membership window start → start+365 for open groups, the same rule as closed ones
  ✅ Every summary, list aggregate and bucket list stays bounded by one year
  ❌ After a year new expenses stop joining; the UI must say so (10A's nudge becomes "This group reached a year")
B) Open groups collect forever
  ✅ No surprise cutoff for long-running open groups
  ❌ Unbounded scans and payloads, and forgotten groups quietly absorb unrelated spending
Net: a bounded, honest rule versus no cutoff.
Header: Open groups
Options:
A) Stop at a year (recommended)
isGroupMember / expenseWhere use endOn ?? startOn+365 as the upper bound; series and 'after' buckets follow; MUT-268 10A nudge copy adds "This group reached a year — new expenses no longer join" once past it. Human ~1h / CC ~5 min.
B) Collect forever
Keep startOn → ∞; summary/list cost grows with group age. Human ~0 / CC ~0.

State: approved
Actual answer: A) Stop at a year (D2 of this run, answered 2026-10-18)
Accepted scope: membership upper bound = endOn ?? startOn+365 in isGroupMember and expenseWhere (store contract covers both); day series, 'after' buckets, excluded in-range filter (22A) and list aggregates all use that window; MUT-268 10A nudge copy adds "This group reached a year — new expenses no longer join" once past it; tests for an open group with an expense dated startOn+366.
History: none

### R7: includedCount on the group detail
Finding: F2, P3, confidence 8/10, plan API table row for GET /v1/expense-groups/{id}, reviewer: Claude (plan-eng-review re-run)
Plan baseline: `includedCount` returned (counts every included mark).
Runtime evidence: none; MUT-268 decisions 1A–23A never read it.
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R7 includedCount | all included marks (pending) | removed from the response | kept, counting only kept expenses dated outside the range |
| R6 open-group window | pending | pending | pending |
Question D3:
D3 — Keep the "kept" count on the group detail?
Project/branch/task: MUT-267 group detail response, re-review.
ELI10: The group detail returns how many expenses were "kept" from outside the dates. No screen in the portal design uses that number, and after the left-out change it's unclear whether it should count keep marks on expenses already inside the dates. Unused fields still need tests and get misread later.
Stakes if we pick wrong: A field nobody reads that drifts from what the screen shows.
Recommendation: A because no screen uses it, so removing it is less to build, test and misread.
Note: options differ in kind, not coverage — no completeness score.
Pros / cons:
A) Remove includedCount (recommended)
  ✅ Less contract to build and test; nothing in MUT-268 or MUT-269 reads it
  ✅ Kept expenses are still visible as members with position before/after in the summary
  ❌ A future screen wanting the number needs an additive field later
B) Keep it, counting kept out-of-range expenses
  ✅ The number is ready if a future screen shows "3 kept from outside"
  ❌ One more field and test with no consumer today
Net: less unused contract versus a field ready in advance.
Header: Kept count
Options:
A) Remove it (recommended)
GET /v1/expense-groups/{id} returns the group + excludedCount only; tests drop includedCount.
B) Keep, out-of-range only
includedCount counts included marks on expenses dated outside the membership window.

State: approved
Actual answer: A) Remove it (D3 of this run, answered 2026-10-18)
Accepted scope: GET /v1/expense-groups/{id} returns the group + excludedCount only; schema, serializer and tests drop includedCount.
History: none

## Re-run Section 1 — Architecture
- A2 [P2] (confidence 8/10) amendment 1 per-group aggregates under `Promise.all`: dozens of concurrent queries can take every connection in the Cloud Run Prisma pool and stall other requests. Correction: run at most 4 groups at a time (a chunked loop; no new dependency). Accepted as a correction (no behaviour change).
- R6 approved (open groups stop at a year), R7 approved (includedCount removed).
```
GET /v1/expense-groups ─► groups (live) ─► for each ≤4 at a time: totalsByCurrency(group)
                                             └► expenseWhere(group: window = startOn..endOn ?? startOn+365, overrides) groupBy currency
GET …/summary ─► list members (same where) ─► dayBuckets: series in-window ('in') + sparse 'before'/'after' for every other member
GET /v1/expenses?groupId&groupMembership=excluded ─► excluded marks AND occurredOn in window
```
Dispositions: A2 accepted (correction), R6 approved A, R7 approved A.

## Re-run Section 2 — Code quality
No issues found: `totalsByCurrency` reuses `expenseWhere` (Prisma) and `isGroupMember` (memory); the window rule lives once in `groups.ts` and both stores read it.

## Re-run Section 3 — Tests
```
[+] expenses/groups.ts window          [GAP→unit] member at startOn+365, not at startOn+366 (open); closed uses endOn
[+] expenses/summary.ts dayBuckets     [GAP→unit] position in/before/after; sum of buckets = currency total (kept pre-trip, future-dated open, past-window none)
[+] store totalsByCurrency             [GAP→contract memory+Prisma] equals summary totals for the same group; overlapping groups both count an expense
[+] routes list                        [GAP→route] items carry currencies + memberCount; ?expenseId= items too
[+] routes excluded listing            [GAP→route] excluded expense moved out of window drops from listing and excludedCount
[+] routes detail                      [GAP→route] no includedCount field
```
Required proof of approved behaviour, added to the plan's test list (value: each fails when the window, bucket position, aggregate filter or in-range rule drifts; why_new: new contracts; seam: none). Regression: existing ledger tests (`store-contract-expenses.ts:62/93`, `routes-expenses.test.ts:327/346/360`) still hold the ledger contract.

## Re-run Section 4 — Performance
- List: G aggregates, ≤4 concurrent, each an indexed range scan bounded to ≤366 days by R6. Scale: tens of groups → tens of small queries, no row transfer.
- Summary and buckets bounded to one year of members by R6. No new findings.

## Re-run outside voice
Codex not installed; native fallback tools (TaskOutput/TaskStop) not declared → unavailable, no coverage credit.

Approval readiness (re-run): PASS — D1 structure (B), R6 (D2, A), R7 (D3, A); A2 and C5 are corrections.

## Re-run Implementation Tasks
- [ ] **T9 (P1, human: ~1h / CC: ~5min)** — groups.ts + both stores — window upper bound endOn ?? startOn+365 (R6)
  - Verify: groups.test.ts boundary + store contract on Postgres (test:db)
- [ ] **T10 (P2, human: ~30min / CC: ~5min)** — list route — bounded concurrency of 4 for per-group aggregates (A2)
  - Verify: routes-expense-groups.test.ts with 10 groups
- [ ] **T11 (P3, human: ~15min / CC: ~2min)** — detail schema — drop includedCount (R7)
  - Verify: openapi:check + route test
- MUT-268 follow-on: 10A nudge copy adds "This group reached a year — new expenses no longer join" (R6).

## Re-run completion summary
- Step 0: scope accepted as-is (smaller arrangement D1)
- Architecture: 1 issue (A2) + 2 decisions (R6, R7)
- Code Quality: 0 issues
- Test Review: diagram produced, 6 gaps, all planned
- Performance: 0 issues
- Failure modes: 0 critical gaps
- Unresolved decisions: 0
- Outside voice: codex unavailable
- Parallelization: sequential (one module)
- Lake Score: 0/1 (D2 picked the best offered option, scored 9/10)

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Outside Review | codex via `/plan-eng-review` | Independent 2nd opinion | 38 | unavailable | CLI not installed |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 38 | issues_open (all mapped to tasks) | first run 3 issues; re-run 1 issue + 2 decisions on the design amendments; 0 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 9 | clean (MUT-268 plan) | score: 3/10 → 9/10, 23 decisions |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **OUTSIDE COVERAGE:** codex, plan-review, unavailable on both runs; no findings, no coverage credit.
- **VERDICT:** DESIGN CLEARED (MUT-268). Eng review re-validated the MUT-268 amendments: issues_open only in the sense of mapped tasks T1–T11, 0 unresolved, 0 critical gaps; ready for /eng-build MUT-267.

NO UNRESOLVED DECISIONS
