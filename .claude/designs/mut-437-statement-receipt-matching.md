# MUT-437 — Match statement lines to receipts so one purchase is one expense

**Status:** plan, eng-reviewed (2026-10-26; answers D1–D18 in the ledger below) · **Epic:** MUT-432 · **Blocked by:** MUT-436 (merged to local main af431cfe, In Review: cleared) · **Relates:** MUT-438 (postponed statement file import), MUT-255 receipts library, MUT-66 inbox, TD-258 (fixed here), TD-260 (inbox receipts, stays open), TD-017 (single instance)

## 1. Problem and acceptance criteria

An agent works through a card statement and a folder of receipts, and the same purchase shows up in both. The rule already exists (`server/src/expenses/similarity.ts`, ADR-200), but only `find_similar_expenses` uses it; `add_expense` relies on the agent remembering to call it. MUT-437 makes the server enforce "one purchase is one expense" on every path where Claude writes an expense.

- **AC1** When `add_expense` gets a statement line that matches an existing expense or inbox entry, it returns the match instead of creating a duplicate; the agent then attaches the receipt or skips.
- **AC2** When a receipt matches an existing statement-line expense, it is attached to that expense. The ticket names `attach_receipt`; the shipped tools are `start_receipt_upload` with `target: { kind: 'expense', expenseId }` and `complete_receipt_upload` (MUT-436).
- **AC3** With more than one match, all candidates are returned; nothing is merged or written until the person chooses.
- **AC4** The rule is one pure function with tests, shared by `find_similar_expenses` and the write tools.

Rule (ticket and epic decision 4): same currency and amount, date within ±3 days, a similar vendor ranked first. A different vendor never excludes (D2).

**Added by Basel in review (beyond the ACs):** `file_inbox_entry`, a new agent tool that files an inbox entry into a profile so a receipt can then be attached (D7). It is available whatever MCP_INBOX_WRITES is set to (D10) and guarded by the same look-alike check (D13).

## 2. What already exists (reuse, do not redefine)

| Need | Existing | Where |
|---|---|---|
| The rule | `matchScore`, `rankMatches`, `dateWindow`, `MATCH_DATE_WINDOW_DAYS` | `server/src/expenses/similarity.ts` |
| Candidate gathering (profiles + inbox, LOCKED skipped, capped) | inline in the `find_similar_expenses` handler | `server/src/mcp/read-tools.ts:203-245` |
| Idempotent writes: a 4xx is stored, anything else releases the key | `withToolIdempotency` → `runIdempotent` | `server/src/mcp/context.ts:164-196`, `server/src/idempotency.ts:56-95` |
| Receipt count per expense, one grouped query | `expenseReceipts.countReadyByExpenseIds` | `repositories/ports.ts:3024` |
| Attaching a receipt to an expense | `start_receipt_upload` / `complete_receipt_upload` | `server/src/mcp/receipt-tools.ts` |
| Inbox filing rules (session) | inline in the POST /v1/inbox/{id}/file-as-expense handler | `server/src/routes/inbox.ts:203-253` |
| Person-keyed advisory lock pattern | `pg_advisory_xact_lock(ns, hashtext(key))` | `server/src/repositories/prisma.ts:3371` (signup) |
| Agent store access | `STORE_ACCESS` classification + `AGENT_STORE_METHODS` allow-list | `server/src/auth/store-guard.ts` (~298, ~404, ~440) |

The MCP code keeps its 6-file layout (MUT-435 D1). One new non-MCP module: `server/src/inbox/file-expense.ts` (D11/D18).

## 3. Design

### 3.1 The rule gets one addition (`similarity.ts`, pure; D2)

`MatchResult` gains `vendorMatch: 'similar' | 'different' | 'unknown'` ('unknown' when either side has no vendor). Matching and ranking are unchanged: a different vendor ranks lower and never excludes.

### 3.2 One candidate finder, shared (`read-tools.ts`)

The body of the `find_similar_expenses` handler moves into an exported
`findLookAlikes(ctx, probe, { profileId?, exclude?: ReadonlySet<string> }): Promise<{ items: LookAlike[]; truncated: boolean }>`, called by `find_similar_expenses`, `add_expense` and `file_inbox_entry`.

- **Expenses (D6):** the window read also filters on `amountMinor` (new optional `ExpenseFilter.amountMinor`, memory + Prisma), so the database returns "same currency, same amount, ±3 days" and the 200-row cap is never reached in practice. `rankMatches` still applies the full rule; the database filter only narrows the read.
- **Inbox (D6, TD-258):** a new `inboxEntries.listMatchCandidates(userId, { from, to, currency, amountMinor, kind: 'EXPENSE' }, limit)` in memory + Prisma, plus a migration adding `InboxEntry @@index([userId, occurredOn])`. It replaces the newest-200 scan.
- **Inbox vendor (D16):** an inbox candidate's vendor is its note's text before the first `" · "` (trimmed, null when empty). It is used only for `vendorMatch` and ranking.
- **Exclude before slicing (D12):** ids in `exclude` are dropped *before* ranking and the 10-result slice, so each retry shows the next batch.
- **Each candidate** gains `vendorMatch`, `hasReceipt` (profile rows: one `countReadyByExpenseIds` call over the returned ids; inbox rows: false) and `canAttachReceipt` (true for profile rows; false for inbox rows, which have to be filed first via `file_inbox_entry`). `SIMILAR_OUTPUT` gains these three fields.

### 3.3 Check before every agent expense write (AC1, AC3)

This applies to `add_expense` (both destinations) and `file_inbox_entry`.

New optional input `notDuplicateOf: string[]` (uuids, at most 100; D3, D12): the candidate ids the person said are a different purchase. It is left out of the idempotency fingerprint because each tool destructures it out of the args it passes to `withToolIdempotency`; `context.ts` is unchanged (review D1).

Order inside `withToolIdempotency` (a replay returns first, so a created key never "matches itself"), all under the person lock (§3.5):

1. **Validate (D17):** `prepareExpenseCreate`, or for filing the `fileInboxExpense` rule checks. These are reads only, and a refusal here is the ordinary stored 4xx.
2. **Check:** `findLookAlikes(ctx, probe, { exclude: notDuplicateOf ∪ {the entry being filed} })` across **every readable profile and the inbox** (D4).
3. **Matched (D5):** any returned candidate → throw the internal `LookAlikesFound(candidates)` (not an `ApiError`). `runIdempotent` releases the key (`ops.fail`). The tool handler catches it and returns `{ outcome: 'matched', expense: null, candidates, replayed: false }`. Nothing is written, not even a vendor.
4. **Write:** `withResolvedVendor` → create (or `fileAsExpense`) → `touchExpenseVendor` → audit (`captureSource`, `oauthClientId`, `grantId`; `filedFromInbox` when filing). Returns `{ outcome: 'created', expense, candidates: [] }`.

Output (`ADD_EXPENSE_OUTPUT`, shared by both tools) becomes `{ outcome: 'created' | 'matched', expense: { where, profileId, id, amount, currency, occurredOn, vendor, categoryId } | null, candidates: LookAlike[], replayed }`. This changes MUT-436's shape; MUT-435/436 are unreleased. The `mcp.add-expense` QA spec is updated.

### 3.4 `file_inbox_entry` (D7, D10, D11, D13, D18)

- Input: `inboxEntryId`, `profileId` (required, no default: ask), `categoryId?`, `customerId?`, `projectId?`, `title?`, `vendor?`, `notDuplicateOf?`, `idempotencyKey`.
- Gates as for an add_expense profile write: `agentProfile` → `assertAgentMayWrite(…, 'expenses')` → `agentWriteGate`; `withToolIdempotency` with profile scope.
- Rules: the new `fileInboxExpense(store, { organization, userId, entry, body, now, requestId, auditExtra })` in `server/src/inbox/file-expense.ts`, moved out of `routes/inbox.ts:207-251` in a **behaviour-free refactor commit first** (D11; the existing inbox filing tests are the regression contract). The route and the tool both call it. `inbox/compose.ts` stays pure (D18).
- Registered for every grant that has both scopes (§3.6), independent of MCP_INBOX_WRITES (D10): filing never creates an 'mcp' inbox row, and the entry's own `captureSource` carries over (`routes/inbox.ts:232-233`).
- Returns the new expense id. The agent attaches the receipt with *that* id; the inbox id no longer exists after filing.

### 3.5 One write at a time per person (D15)

New store method `agentWriteLock.run(userId, fn)`:
- Prisma: an interactive `$transaction` that takes `pg_advisory_xact_lock(AGENT_WRITE_LOCK, hashtext(userId))` and runs `fn` (whose own queries use the normal client), with a timeout of 15 s.
- Memory: a per-user promise chain.

`add_expense` and `file_inbox_entry` run steps 1–4 inside it. A second parallel call for the same person waits, then sees the first call's write and answers `matched`. Each running lock holds one pool connection, bounded by the per-person agent limiter (240/min); the ADR records this. `STORE_ACCESS` classification + agent allow-list entry.

### 3.6 Scopes (D14)

`registerWriteTools`, `registerReceiptTools` and `file_inbox_entry` register only when the grant has **both** `read` and `write`. A write-only grant gets no write tools, so the matched answer never shows records to a grant that can't read. Connect grants both by default (`oauth/protocol.ts:20-22`).

### 3.7 Descriptions and instructions (D8, D9, O11)

- `add_expense`, `file_inbox_entry` and `find_similar_expenses` say:
  - For a foreign purchase, use the original amount and currency the statement shows (as the receipt has it). If only the charged amount is shown, ask the person (D8).
  - Use the purchase (transaction) date, not the posting date (D9).
  - If `outcome` is `matched`, show the candidates and ask. Same purchase → attach the receipt when `canAttachReceipt` and not `hasReceipt`, or `file_inbox_entry` first for an inbox candidate, otherwise skip. Different purchase → call again with the same `idempotencyKey` plus `notDuplicateOf: [the ids shown]`. With several candidates the person chooses; never pick one.
  - Call these tools one at a time.
- `start_receipt_upload`: for a receipt, call `find_similar_expenses` first and attach to the chosen candidate; after `file_inbox_entry`, use the expense id it returned.
- `server.ts` instructions mention `file_inbox_entry` and `notDuplicateOf`.

### 3.8 Error states

- `matched` → a normal result (D5), with the key released.
- `notDuplicateOf` with a non-uuid, or more than 100 → `VALIDATION_FAILED`.
- `file_inbox_entry` (the route's own refusals, unchanged):
  - another person's entry, or one already filed → `NOT_FOUND`;
  - an income entry → `ENTRY_KIND_MISMATCH`;
  - an entry whose currency can't be filed, out of date bounds, or an archived category → as the route answers;
  - a read-only or lapsed profile → `READ_ONLY_PROFILE` / the lapse gate.
- A lock wait longer than the transaction timeout → 5xx, key released, so the agent can retry.

## 4. Decisions

All answered in the review: D1 (structure) through D18. See the ledger below. Earlier draft labels in brief:
- vendor inclusive (D2)
- `notDuplicateOf` ids (D3, at most 100 per D12)
- every profile + inbox (D4)
- matched is a result (D5)
- TD-258 fix + amount pre-filter + index migration (D6)
- `file_inbox_entry` (D7), ungated (D10)
- original currency (D8), transaction date (D9)
- shared filing function, refactor first (D11), in `file-expense.ts` (D18)
- exclude before slicing (D12)
- check on filing (D13)
- write needs read (D14)
- database lock (D15)
- inbox note vendor (D16)
- validate first (D17)

## 5. Files

| File | Change |
|---|---|
| `server/src/expenses/similarity.ts` | `vendorMatch` on `MatchResult` |
| `server/src/mcp/read-tools.ts` | export `findLookAlikes` (exclude, inbox vendor, hasReceipt, canAttachReceipt), `LookAlike`; `SIMILAR_OUTPUT`; D8/D9 description |
| `server/src/mcp/write-tools.ts` | `notDuplicateOf`, validate→check→write under the lock, `LookAlikesFound`, new output, `file_inbox_entry`, read+write registration, descriptions |
| `server/src/mcp/receipt-tools.ts` | read+write registration; description |
| `server/src/mcp/server.ts` | instructions text |
| `server/src/inbox/file-expense.ts` (new) | `fileInboxExpense` |
| `server/src/routes/inbox.ts` | file-as-expense handler calls `fileInboxExpense` (refactor commit, no behaviour change) |
| `server/src/repositories/ports.ts` | `ExpenseFilter.amountMinor`; `InboxEntryRepository.listMatchCandidates`; `agentWriteLock` |
| `server/src/repositories/memory.ts`, `prisma.ts` | implement the three |
| `server/prisma/schema.prisma` + new migration | `InboxEntry @@index([userId, occurredOn])` |
| `server/src/auth/store-guard.ts` | `STORE_ACCESS` + `AGENT_STORE_METHODS`: `inboxEntries.listMatchCandidates`, `inboxEntries.getById`, `inboxEntries.fileAsExpense`, `expenseReceipts.countReadyByExpenseIds`, `agentWriteLock.run` (plus whatever `fileInboxExpense` reads: links, categories, vendors, already allowed for add_expense) |
| tests | see §6 |
| `qa/features/portal-selfservice/mcp.yaml`, `qa/specs/portal-selfservice/mcp.spec.ts` | new `statement-match`, `file-inbox-entry`; `add-expense` updated |
| `.claude/DECISIONS.md` | ADR-202 (renumber at merge if taken) |
| CHANGELOG, SYSTEM_OVERVIEW, PATTERNS (check-before-write result, person write lock), TECH_DEBT (TD-258 resolved; TD-260 updated: agents now file first), TEST_PLAN, COMPONENT_REGISTRY (`fileInboxExpense`, `findLookAlikes`) | knowledge updates |

The REST contract is unchanged (one handler refactored, no openapi change), so there's no `API_VERSION` bump. No portal UI change. No Flutter change in this ticket. The Flutter `models.g.dart` gap for `CaptureSource.mcp` was fixed separately as 6ae3a9e0 (MUT-436 follow-up).

## 6. Tests (TDD: write these first)

See the review's Section 3 diagram for the full map. In summary:

`similarity.test.ts` (AC4)
- vendorMatch is similar / different / unknown; Arabic vs Latin is `different` and still `matches`.

`mcp-read-tools.test.ts`
- amount pre-filter: 250 window expenses → finds the right one, not truncated;
- TD-258: an inbox match older than 200 newer entries is found;
- hasReceipt;
- canAttachReceipt;
- inbox note vendor ranks first (D16);
- exclude before slicing (D12: 15 matches → 10, then 5).

`mcp-write-tools.test.ts`, add_expense (**CRITICAL**):
- a replay never answers matched;
- matched writes nothing (no expense, audit row or vendor), and the same key then creates with `notDuplicateOf`;
- partial `notDuplicateOf` → still matched;
- a look-alike in another profile blocks;
- an invalid date is refused before any matched answer (D17);
- two parallel calls → one created, one matched (D15, memory);
- AC2 flow end to end;
- AC3: two candidates, the similar one first;
- the inbox destination runs the same check.

`mcp-write-tools.test.ts`, file_inbox_entry:
- files with the entry's captureSource and grant ids in the audit;
- a profile look-alike blocks, and `notDuplicateOf` then files it (D13);
- NOT_FOUND / ENTRY_KIND_MISMATCH / READ_ONLY_PROFILE / lapse;
- an idempotent replay returns the expense;
- offered with MCP_INBOX_WRITES off (D10);
- the receipt attaches to the returned expense id.

`mcp-write-tools.test.ts`, scopes:
- a write-only grant is offered no write tool (D14).

Regression contract (D11): `inbox-filing.test.ts`, `expense-capture-source.test.ts`, `routes-vendors.test.ts:135`, `inbox-isolation.test.ts` stay green on the refactor commit, unchanged.

Store contracts (memory + Prisma, `test:db`):
- `listMatchCandidates` window / currency / amount / kind / user-isolation edges;
- `expenses.list` with `amountMinor`;
- `agentWriteLock` serialises two concurrent `run`s for the same user and not for different users.

`store-guard.test.ts`: the new classifications and allow-list entries.

Iterate:

```
~/Work/tools/heavy-gate/heavy -l "MUT-437 tests" -- npm --prefix server test -- similarity mcp store-guard inbox
```

Run it under Node 22. Final: server typecheck, lint, openapi:check, test, test:db, and `prisma migrate diff` clean.

## 7. QA scenarios (release-QA, portal-selfservice app)

- `mcp.statement-match` (tier extended): "Claude adds a card statement line I already recorded from a receipt. MTB3A gives back the match instead of a second expense, and when I say it's different it records it."
  - Steps: seed an expense (grantCoverage); `add_expense` with the same amount and currency, 2 days apart → `matched`; retry with `notDuplicateOf` → `created`.
- `mcp.file-inbox-entry` (tier extended): "Claude finds my phone capture in the inbox, files it into a profile, and attaches the receipt to it."
  - Steps: seed an inbox entry; `find_similar_expenses` → inbox candidate; `file_inbox_entry` → created; `start`/`complete_receipt_upload` on the returned id → `hasReceipt` true.
- Update `mcp.add-expense` for the new output shape.
- `paths`: `server/src/mcp/**`, `server/src/expenses/similarity.ts`, `server/src/inbox/file-expense.ts`, `server/src/routes/inbox.ts`, the inbox/expense repo files.

## 8. Out of scope

- Statement file import (MUT-438).
- Matching against To-review library receipts, which carry no amount until MUT-256's reader.
- Receipts sitting on inbox entries (TD-260; agents file first).
- Income.
- A merge tool for duplicates that already exist.
- A look-alike check on the session (web/phone) filing route.

## 9. Ticket gaps to note on MUT-437

- The AC names `attach_receipt`; the tools are `start_receipt_upload` + `complete_receipt_upload` (MUT-436).
- "Similar vendor when both have one" is settled as ranking only (D2).
- Added beyond the ACs by Basel: `file_inbox_entry` (D7/D10/D13); the per-person database lock (D15); write tools need the read scope (D14).

Business / product impact
- Basel can hand Claude a month of receipts and a card statement and end up with one expense per purchase with its receipt attached, not two entries he has to clean up by hand. That includes foreign subscriptions and phone captures waiting in the inbox.
- It's the last buildable story of epic MUT-432 (MUT-438 is postponed). After it, the epic is ready for release alongside MUT-434's live Claude hand checks.
- Moderate risk: one index migration, a refactor of a shipped filing route (covered by its tests), and a new advisory lock. Without this, the agent path makes duplicates, and a doubled expense understates profit in Reports.

---

# Eng review (/plan-eng-review, 2026-10-26)

Target: `.claude/designs/mut-437-statement-receipt-matching.md` (plan, fixed). Report file: this file.

**Scope record:** feature answers: none proposed for cutting; structure: B Smaller arrangement (D1, Basel 2026-10-26); accepted scope: the plan's features, contracts and tests unchanged, but `server/src/mcp/context.ts` is not touched (add_expense destructures `notDuplicateOf` before `withToolIdempotency`); pending remedies: R1–R8.

## Scope Challenge findings

1. [P2] (confidence 9/10) plan §3.3: `fingerprintOmit` on `withToolIdempotency` has one caller. Resolved by D1 (Smaller arrangement).
2. [P1] (confidence 8/10) `server/src/expenses/similarity.ts:56` `probe.currency === candidate.currency`: a card statement charged in ILS for a USD purchase never matches the USD receipt, so the agent records the purchase twice. → R7.
3. [P2] (confidence 6/10) `server/src/expenses/similarity.ts:10` `MATCH_DATE_WINDOW_DAYS = 3`: a statement's posting date can trail the purchase by more than 3 days (weekends, foreign charges); the plan doesn't tell the agent which date to send. → R8.
4. Plan decisions D1–D6 (§4) carried as R1–R6.

## Decision ledger

### R1: Does a different vendor exclude a match? (plan D1)
Finding: plan §4 D1; ticket rule "similar vendor when both sides have one"; reviewer: Claude (eng-ticket)
Plan baseline: original proposal: inclusive (a different vendor ranks lower and is reported, never excludes)
Runtime evidence: `similarity.ts:52-60` already inclusive: `matches` ignores vendor; vendor only adds to `score` (static read)
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R1 vendor rule | inclusive (shipped MUT-435) | inclusive + `vendorMatch` field | exclude when both vendors present and dissimilar |
| R2–R8 | pending | pending | pending |
Question D2:
D2 — When a statement line and an existing expense have clearly different vendor names, are they still candidates?
Header: Vendor rule
Options:
A) Inclusive, report it (recommended)
A different vendor never excludes; the candidate ranks lower and carries vendorMatch: 'different'. find_similar_expenses keeps its shipped behavior. Tests: vendorMatch similar/different/unknown; Arabic vs Latin still matches.
B) Exclude when both differ
When both sides name a vendor and the names score below the fuzzy floor, it's not a candidate. find_similar_expenses changes too (one rule, AC4). Tests: dissimilar pair excluded; missing vendor on either side still matches.

State: approved
Actual answer: A) Inclusive, report it (D2, Basel 2026-10-26)
Accepted scope: matching never excludes on vendor; `MatchResult.vendorMatch` ('similar' | 'different' | 'unknown') added and surfaced on candidates; tests for the three values and Arabic-vs-Latin still matching.
History: none

### R2: How does the person say "it's a different purchase"? (plan D2)
Finding: plan §4 D2 / §3.3; reviewer: Claude (eng-ticket)
Plan baseline: original proposal: `notDuplicateOf: string[]` (max 10 uuids)
Runtime evidence: add_expense has no override today (`write-tools.ts:58-74`); not applicable until built
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R1 vendor rule | approved inclusive (D2) | same | same |
| R2 override | none | `notDuplicateOf: ids`; a new look-alike blocks again | `confirmedNew: true` boolean |
| R3–R8 | pending | pending | pending |
Question D3:
D3 — How does the agent record a purchase the person says is different from the look-alikes shown?
Header: Override
Options:
A) notDuplicateOf ids (recommended)
add_expense takes notDuplicateOf: the candidate ids the person said are different (max 10). Any candidate not in the list blocks again. Tests: covers one of two → still matched; covers all → created.
B) confirmedNew boolean
add_expense takes confirmedNew: true, which skips the check entirely. Tests: true → created even with candidates.

State: approved
Actual answer: A) notDuplicateOf ids (D3, Basel 2026-10-26)
Accepted scope: add_expense input `notDuplicateOf` (≤10 uuids, excluded from the fingerprint); any candidate not listed blocks; tests for partial and full coverage.
History: none

### R3: Where does add_expense look for look-alikes? (plan D3)
Finding: plan §4 D3 / §3.3 step 2; reviewer: Claude (eng-ticket)
Plan baseline: original proposal: every readable profile + inbox
Runtime evidence: find_similar_expenses already searches all readable owned/co-owned profiles + inbox when profileId is omitted (`read-tools.ts:213-226`)
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R1, R2 | approved (D2, D3) | same | same |
| R3 scope | n/a | all readable profiles + inbox (≤6+1 window reads) | destination profile only (+ inbox for an inbox write) |
| R4–R8 | pending | pending | pending |
Question D4:
D4 — When add_expense checks for look-alikes, does it search every profile or only the one it's writing to?
Header: Check scope
Options:
A) Every profile + inbox (recommended)
findLookAlikes with no profileId: all readable owned/co-owned profiles (LOCKED skipped) and the inbox. Test: a look-alike in another profile blocks.
B) Destination only
Only the destination profile (or the inbox for an inbox write). Test: a look-alike in another profile does not block.

State: approved
Actual answer: A) Every profile + inbox (D4, Basel 2026-10-26)
Accepted scope: add_expense calls findLookAlikes with no profileId (all readable owned/co-owned profiles, LOCKED skipped, plus inbox when readable); test that a look-alike in another profile blocks.
History: none

### R4: Is "matched" a normal result or an error? (plan D4)
Finding: plan §4 D4 / §3.5; reviewer: Claude (eng-ticket)
Plan baseline: original proposal: normal result `outcome: 'matched'`, key released (non-ApiError → `ops.fail`, verified `ports.ts:401-402` "Releases the key so a retry can run the operation again")
Runtime evidence: `withToolIdempotency` stores 4xx ApiErrors and replays them (`context.ts:186-190`); a 4xx error would burn the key
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R1–R3 | approved | same | same |
| R4 matched shape | n/a | result `{outcome:'matched', expense:null, candidates}`, key released | isError `POSSIBLE_DUPLICATE` with candidates in details, key released (not stored) |
| R5–R8 | pending | pending | pending |
Question D5:
D5 — When add_expense finds look-alikes, does it answer with a normal result or an error?
Header: Match answer
Options:
A) Normal result (recommended)
outcome: 'matched', expense: null, candidates. The output schema gains outcome/expense/candidates (MUT-436 shape changes, unreleased). Key released. Tests: matched result, nothing written, same key reusable.
B) Error with candidates
isError with a new code POSSIBLE_DUPLICATE and candidates in details; output schema unchanged; key released, never stored. Tests: same, asserted on the error.

State: approved
Actual answer: A) Normal result (D5, Basel 2026-10-26)
Accepted scope: `ADD_EXPENSE_OUTPUT` = `{ outcome, expense | null, candidates, replayed }`; matched answers release the key (internal LookAlikesFound, caught in the add_expense handler); `mcp.add-expense` QA spec updated; tests: nothing written, same key reusable.
History: none

### R5: Fix TD-258 (filtered inbox query) and add the amount pre-filter here? (plan D5)
Finding: plan §4 D5 / §3.2; TECH_DEBT TD-258 ("fix with MUT-437"); reviewer: Claude (eng-ticket)
Plan baseline: original proposal: `inboxEntries.listMatchCandidates` + migration `@@index([userId, occurredOn])` + `ExpenseFilter.amountMinor`
Runtime evidence: inbox has `@@index([userId, createdAt desc, id desc])` (schema.prisma InboxEntry); expenses have `@@index([organizationId, occurredOn desc, id desc])` (static read). An inbox is a short per-person queue, so the userId index already narrows to a few rows.
Comparison grid:
| Choice | Current | A | B | C |
|---|---|---|---|---|
| R1–R4 | approved | same | same | same |
| R5 inbox query | newest-200 scan, JS filter | filtered query, NO migration (existing userId index) | filtered query + new (userId, occurredOn) index migration | keep the scan (TD-258 open) |
| R5 expense amount pre-filter | none | yes | yes | no |
| R6–R8 | pending | pending | pending | pending |
Question D6:
D6 — Fix TD-258 (the inbox look-alike scan) and add the amount pre-filter as part of MUT-437, and with or without a new index?
Header: Inbox query
Options:
A) Fix, no migration (recommended)
inboxEntries.listMatchCandidates (window, currency, amount, kind) in memory + Prisma using the existing userId index; ExpenseFilter.amountMinor; allow-list + test:db contracts. TD-258 resolved.
B) Fix with new index
Same as A plus a migration adding InboxEntry @@index([userId, occurredOn]).
C) Defer
Keep the newest-200 scan and no amount filter; TD-258 stays open; truncated look-alike searches can let a duplicate through.

State: approved
Actual answer: B) Fix with new index (D6, Basel 2026-10-26)
Accepted scope: `inboxEntries.listMatchCandidates` (window, currency, amount, kind EXPENSE) in memory + Prisma; migration adding `InboxEntry @@index([userId, occurredOn])`; `ExpenseFilter.amountMinor` in memory + Prisma; agent allow-list entries; test:db contracts; TD-258 resolved.
History: none

### R6: What happens when the look-alike is an inbox entry? (plan D6)
Finding: plan §4 D6; TD-260 (no receipts on inbox entries); reviewer: Claude (eng-ticket)
Plan baseline: original proposal: candidate carries `canAttachReceipt: false`; description says skip and tell the person to file it in MTB3A; no new agent tool
Runtime evidence: agents have no inbox-filing tool (`server.ts` registers read/write/receipt tools only); `fileAsExpense` exists in the store (`ports.ts:3279`) for the session route
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R1–R5 | approved | same | same |
| R6 inbox match | n/a | `canAttachReceipt:false`, agent skips, tells the person | new `file_inbox_entry` agent tool (inbox → chosen profile), then attach |
| R7, R8 | pending | pending | pending |
Question D7:
D7 — When the look-alike is an inbox entry, does the agent just skip, or get a tool to file the entry so it can attach the receipt?
Header: Inbox match
Options:
A) Skip and tell (recommended)
Candidate shows canAttachReceipt: false; description says skip and ask the person to file it in MTB3A, then attach. No new tool; TD-260 stays open. Test: inbox candidate flagged.
B) Add filing tool
New file_inbox_entry tool (destination profile required, category asked), reusing inbox fileAsExpense + compose; then the receipt attaches. Larger scope; new allow-list entry, tests, QA.

State: approved
Actual answer: B) Add filing tool (D7, Basel 2026-10-26)
Accepted scope: new agent tool `file_inbox_entry` (inbox entry → a chosen profile, destination profile required, category asked) reusing `inboxEntries.fileAsExpense` + the expense compose path, the profile write gates and idempotency like add_expense; marked `captureSource` as the entry's; then the receipt attaches via start/complete_receipt_upload. Inbox candidates carry `canAttachReceipt: false` until filed. Allow-list entry, tests, release-QA feature. Scope beyond the ticket's ACs, chosen by Basel.
History: none

### R7: Foreign-currency statement lines (review finding 2)
Finding: #2 [P1] (8/10) `similarity.ts:56` `probe.currency === candidate.currency`; reviewer: Claude (plan-eng-review)
Plan baseline: original proposal: nothing (rule unchanged; no guidance)
Runtime evidence: the rule requires equal currency (static read); MTB3A stores the original amount + currency (CLAUDE.md currency rule 1)
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R1–R6 | approved | same | same |
| R7 foreign line | ILS-charged line never matches a USD receipt | tool descriptions: use the original amount + currency the statement shows for a foreign purchase; if it shows only the charged amount, ask the person | no change; duplicates possible |
| R8 | pending | pending | pending |
Question D8:
D8 — For a foreign-currency purchase on a card statement, which amount and currency does the agent record and match on?
Header: Foreign lines
Options:
A) Original currency (recommended)
add_expense, find_similar_expenses and file_inbox_entry descriptions say: use the original amount + currency the statement shows for a foreign purchase (as the receipt has it); if only the charged amount is shown, ask the person. No rule change. Covered by the existing description snapshot test, if any; otherwise none (text only).
B) No change
Rule and descriptions unchanged; a foreign purchase's statement line and receipt don't match and can be recorded twice.

State: approved
Actual answer: A) Original currency (D8, Basel 2026-10-26)
Accepted scope: add_expense, find_similar_expenses and file_inbox_entry descriptions: for a foreign purchase use the original amount + currency the statement shows; if only the charged amount is shown, ask the person. Matching rule unchanged.
History: none

### R8: Which statement date does the agent send? (review finding 3)
Finding: #3 [P2] (6/10) `similarity.ts:10` `MATCH_DATE_WINDOW_DAYS = 3`; reviewer: Claude (plan-eng-review)
Plan baseline: original proposal: nothing
Runtime evidence: window is ±3 days around the probe date (static read); statements commonly list a transaction date and a later posting date
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R1–R7 | approved | same | same |
| R8 statement date | unspecified | descriptions: use the transaction (purchase) date, not the posting date | widen the window to ±7 days (rule change, find_similar too) |
Question D9:
D9 — Which date should the agent use for a statement line so it lands within ±3 days of the receipt?
Header: Line date
Options:
A) Transaction date (recommended)
Descriptions say: use the purchase/transaction date, not the posting date. Window stays ±3 (epic decision 4). Text only.
B) Widen to ±7 days
MATCH_DATE_WINDOW_DAYS = 7 for everyone (find_similar_expenses too); similarity tests updated; more unrelated candidates.

State: approved
Actual answer: A) Transaction date (D9, Basel 2026-10-26)
Accepted scope: add_expense, find_similar_expenses and file_inbox_entry descriptions: for a statement line use the purchase/transaction date, not the posting date. Window stays ±3.
History: none

**Scope Challenge result:** scope accepted as-is, then widened by Basel's D7 (file_inbox_entry). R1–R8 approved.

## Section 1: Architecture

5. [P2] (confidence 8/10) `server/src/mcp/write-tools.ts:79` `if (!options.inboxWrites) throw new ApiError('FEATURE_NOT_ENABLED', …)`: the D7 tool needs its own rule for MCP_INBOX_WRITES. Filing *removes* an inbox row the phone already decodes and creates a profile expense that carries the entry's own captureSource (`routes/inbox.ts:233`), so the D3/D5 phone hazard (unknown 'mcp' on inbox rows) does not apply. → R9.
6. Common work, no question: file_inbox_entry runs the agent write path of add_expense: `agentProfile` + `assertAgentMayWrite(…, 'expenses')` + `agentWriteGate`, `withToolIdempotency` (profile scope), audit `expense.created` with `filedFromInbox: true`, `oauthClientId`, `grantId` (ADR-201 pattern; D7 accepted scope).

### R9: Is file_inbox_entry behind MCP_INBOX_WRITES? (review finding 5)
Finding: #5 [P2] (8/10) `write-tools.ts:79`; reviewer: Claude (plan-eng-review)
Plan baseline: D7 accepted scope (tool exists); gating unspecified
Runtime evidence: MCP_INBOX_WRITES only gates creating inbox rows marked 'mcp' (`write-tools.ts:24-27` "off until the phone decodes 'mcp'"); filing keeps the entry's existing captureSource (`routes/inbox.ts:232-233`)
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R1–R8 | approved | same | same |
| R9 gating | n/a | always offered to a write grant | offered only when MCP_INBOX_WRITES is on |
Question D10:
D10 — Should Claude's "file this inbox entry" tool be available while agent inbox writes are switched off?
Header: Filing gate
Options:
A) Always available (recommended)
file_inbox_entry is registered for any grant with the write scope, independent of MCP_INBOX_WRITES. Test: offered and works with the switch off.
B) Behind the switch
Registered only when MCP_INBOX_WRITES is on. Test: absent with the switch off. Inbox look-alikes stay skip-only until the phone ships.

State: approved
Actual answer: A) Always available (D10, Basel 2026-10-26)
Accepted scope: file_inbox_entry registered for any write-scope grant regardless of MCP_INBOX_WRITES; test that it is offered and works with the switch off.
History: none

Section 1 dispositions: #5 accepted (D10 A); #6 common work under D7.

## Section 2: Code quality

7. [P2] (confidence 9/10) `server/src/routes/inbox.ts:207-251`: the file-as-expense rules (kind and currency checks, the MUT-227/392 date rule in the profile's timezone `expenseOccurredOn(entry.occurredOn, todayFor(organization, now))`, `resolveLinks`, `assertCategoryChoosable`, `withResolvedVendor` after every check, `fileAsExpense` in one transaction, `touchExpenseVendor`, the `expense.created` audit with `filedFromInbox`) live inline in the route handler. D7's tool needs exactly these rules. → R10.

Shared-code rubric for R10: callers: (1) `routes/inbox.ts` POST /v1/inbox/{entryId}/file-as-expense handler, lines 203-253 (existing); (2) proposed `file_inbox_entry` in `mcp/write-tools.ts` (D7). Destination: `server/src/inbox/compose.ts` (already holds `assertKind`, `assertFilableCurrency`, `inboxDate`). Contract: `fileInboxExpense(store, { organization, userId, entry, body, now, requestId, auditExtra }) → ExpenseRecord`; it throws the same ApiErrors. Lines: ~45 moved out of the route, ~10 added for the call sites; the tool's copy (~40) is avoided. Est. net ≈ +5 implementation lines versus about −35 for a copy-paste. Blast radius: the session filing route; covered by the existing `routes/__tests__/inbox*.test.ts` filing tests.

### R10: Share the inbox filing rules between the route and the tool? (review finding 7)
Finding: #7 [P2] (9/10) `routes/inbox.ts:207-251`; reviewer: Claude (plan-eng-review)
Plan baseline: D7 accepted scope says "reusing inboxEntries.fileAsExpense + the expense compose path"; mechanism unspecified
Runtime evidence: the rules are inline in the route handler (static read)
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R1–R9 | approved | same | same |
| R10 filing rules | inline in route | extract `fileInboxExpense` into `inbox/compose.ts`; route + tool call it (refactor commit first) | tool re-implements the steps beside the route |
Question D11:
D11 — Should the inbox filing rules move into one shared function that both the session route and Claude's tool call?
Header: Filing code
Options:
A) Extract, refactor first (recommended)
fileInboxExpense in server/src/inbox/compose.ts; a behaviour-free refactor commit moves the route onto it (existing inbox filing tests stay green), then the tool calls it with its agent gates and audit extras.
B) Copy in the tool
file_inbox_entry repeats the ~40 lines of checks and the transaction call; the route is untouched.

State: approved
Actual answer: A) Extract, refactor first (D11, Basel 2026-10-26)
Accepted scope: `fileInboxExpense` in `server/src/inbox/compose.ts`; first commit moves the route onto it with no behaviour change (existing inbox filing tests green); the tool then calls it with agent gates and audit extras (oauthClientId, grantId).
History: none

Section 2 dispositions: #7 accepted (D11 A).

## Section 3: Tests

Framework: Vitest (server: `npm --prefix server test`, Postgres contracts `test:db`; CLAUDE.md Phase 4). Release-QA: Playwright specs in `qa/specs/portal-selfservice/mcp.spec.ts`.

```
CODE PATHS                                                       USER FLOWS (agent ↔ person)
[+] expenses/similarity.ts matchScore                            [+] Receipt first, statement later
  ├── vendorMatch similar/different/unknown  [GAP→ add rows]       ├── [GAP] add_expense(line) → matched → skip
  └── existing currency/amount/date edges    [★★★ similarity.test]  └── [GAP] receipt already attached → hasReceipt true
[+] mcp/read-tools.ts findLookAlikes (extracted)                  [+] Statement first, receipt later (AC2)
  ├── profiles: amountMinor pre-filter        [GAP]                └── [GAP] find_similar → start/complete upload on it
  ├── LOCKED profile skipped                  [★★ read-tools test]
  ├── inbox: listMatchCandidates window/kind  [GAP, replaces scan] [+] Two look-alikes (AC3)
  ├── hasReceipt via countReadyByExpenseIds   [GAP]                └── [GAP] both returned, similar vendor first, none written
  └── canAttachReceipt inbox=false            [GAP]
[+] mcp/write-tools.ts add_expense                                [+] Person says "different"
  ├── replay before check (no self-match)     [GAP CRITICAL]       └── [GAP] same key + notDuplicateOf → created
  ├── matched → LookAlikesFound, key released [GAP CRITICAL]
  ├── notDuplicateOf partial → still matched  [GAP]               [+] Look-alike in the inbox (D7/D10)
  ├── look-alike in another profile blocks    [GAP]                └── [GAP][→E2E] file_inbox_entry → attach receipt
  ├── inbox destination runs the same check   [GAP]
  └── created path (shipped)                  [★★★ mcp-write-tools.test:55-104]
[+] inbox/compose.ts fileInboxExpense (extracted, D11)
  └── route behaviour unchanged               [★★★ inbox-filing.test, expense-capture-source.test, routes-vendors.test:135] REGRESSION CONTRACT (D11)
[+] mcp/write-tools.ts file_inbox_entry (D7)
  ├── profile not owned/co-owned → NOT_FOUND  [GAP]
  ├── read-only / lapsed profile refused      [GAP]
  ├── income entry → ENTRY_KIND_MISMATCH      [GAP]
  ├── another person's / filed entry → 404    [GAP]
  ├── idempotent replay returns the expense   [GAP]
  ├── captureSource kept, audit grant ids     [GAP]
  └── offered with MCP_INBOX_WRITES off (D10) [GAP]
[+] repos: listMatchCandidates, ExpenseFilter.amountMinor          [GAP test:db contract]
[+] store-guard allow-list (+3 methods)                            [GAP extend store-guard.test]
[+] migration InboxEntry(userId, occurredOn) (D6)                  [GAP prisma migrate diff clean]

COVERAGE (planned paths): 4/27 already covered | GAPS: 23 (1 E2E) | no LLM eval: tool descriptions change, but behaviour is server-enforced
```

Tests to add (all Vitest unless marked):
- `similarity.test.ts` rows: vendorMatch three values; Arabic vs Latin `different` but `matches`. Value: protects=vendor never excludes (D2); fails_when=someone adds vendor to `matches`; why_new=no vendorMatch today; seam=none; no_claim=none beyond protects.
- `mcp-read-tools.test.ts`: amount pre-filter (250 same-window expenses, one right amount → found, truncated false); TD-258 (inbox match older than 200 newer entries found); hasReceipt; canAttachReceipt.
- `mcp-write-tools.test.ts` **CRITICAL**: replay of a created key returns `created`/`replayed:true`, never `matched`; matched writes nothing (count + audit unchanged) and the same key then creates with notDuplicateOf; partial notDuplicateOf; cross-profile look-alike blocks; AC2 flow; AC3 two candidates ordered; inbox-destination check.
- `mcp-write-tools.test.ts` file_inbox_entry block: the seven rows above.
- `inbox-filing.test.ts` etc.: unchanged, must stay green across the D11 refactor commit (regression contract).
- Store contracts (memory + Prisma, `test:db`): listMatchCandidates window/currency/amount/kind edges and user isolation; expenses.list amountMinor.
- `store-guard.test.ts`: allow-list includes `inboxEntries.listMatchCandidates`, `expenseReceipts.countReadyByExpenseIds`, `inboxEntries.fileAsExpense` (agents) and `inboxEntries.getById`.
- Release-QA [→E2E]: `mcp.statement-match` (matched → notDuplicateOf → created) and `mcp.file-inbox-entry` (inbox look-alike filed, receipt attached); `mcp.add-expense` updated for the new output.

Tests made obsolete: none (the read-tools inbox-scan assertions change to the filtered query; same intent).

Section 3 dispositions: all gaps are required proof of approved behaviour (D2–D11); no new choices.

## Section 4: Performance

No issues found. add_expense per call: 1 idempotency claim, ≤6 profile window reads (index `expenses(organizationId, occurredOn)`, amount pre-filtered), 1 inbox read (new `(userId, occurredOn)` index, D6), 1 grouped receipt count, then the create or a key release [estimated from the plan; profile cap 6 per MUT-182]. A 60-line statement ≈ 60 × ~9 small indexed queries; no loops of queries per candidate. Payload: ≤10 candidates per answer.

## Outside voice (Claude Plan subagent, native fallback: Codex CLI not installed)

Completed within the 5-minute limit. Full report summarised; each claim re-checked against af431cfe by the parent reviewer.

| # | Sev | Finding | Verified | Disposition |
|---|---|---|---|---|
| O1 | Critical | Plan body §3–§9 still describes pre-D7 design (no file_inbox_entry, "No REST change", file table/tests/QA missing D7/D10/D11) | yes, plan:63,69,84,103,148 | common work: rewrite §3–§9 to the ledger (no question) |
| O2 | High | notDuplicateOf ≤10 vs candidates cut at 10 (`read-tools.ts:24`) → a frequent same-price purchase can block forever | yes | → R11 |
| O3 | High | file_inbox_entry (D7) bypasses the look-alike check | yes | → R12 |
| O4 | Medium | matched answer returns other profiles' records to a write-only grant (`oauth/protocol.ts:16-24` lets a client request `write` alone; read tools need `read`, `read-tools.ts:94`) | yes | → R13 |
| O5 | Medium | "one agent works sequentially" is wrong: Claude makes parallel tool calls; two keys both pass the check | yes (plan:65) | → R14 |
| O6 | Medium | inbox candidates always vendorMatch 'unknown' (`read-tools.ts:224` vendor null; MCP inbox note starts with the vendor, `write-tools.ts:92`) | yes | → R15 |
| O7 | Medium | look-alike question asked before date/category validation; a stored 4xx on the retry then burns the key | yes (check inside `work` before `prepareExpenseCreate`) | → R16 |
| O8 | Low | `inbox/compose.ts:7-13` is "Entirely pure … nothing to look up"; D11's fileInboxExpense does reads, a transaction, an audit | yes | → R17 (reopens D11's destination only) |
| O9 | Low | `listMatchCandidates` also needs a `STORE_ACCESS` entry (`store-guard.ts:298`, `:440` throws "Unclassified store method") | yes | factual correction, common work |
| O10 | Low | D6 index migration may be unneeded | n/a | not reopened: Basel chose B knowingly with the same evidence (R5); disagreement recorded |
| O11 | Low | server.ts instructions + descriptions omit file_inbox_entry, notDuplicateOf, D8/D9; agent must use the new expense id after filing | yes | common work under D3/D7/D8/D9 |

### R11: notDuplicateOf vs the 10-candidate cut (O2)
Finding: O2 [High] (9/10) `read-tools.ts:24` `SIMILAR_MAX_RESULTS = 10`; plan §3.3 notDuplicateOf max 10; reviewer: outside voice
Plan baseline: D3 approved: "any candidate not listed blocks", max 10 ids
Runtime evidence: candidates are ranked then sliced to 10 (`read-tools.ts:234`)
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R11 block set | all matches (undefined past 10) | block only on the returned (top-10) candidates; notDuplicateOf max 50; `truncated` reported, not blocking | raise the candidate cut to 50 for add_expense and keep "all matches block" |
| other R | approved/pending | same | same |
Question D12: How should add_expense handle more look-alikes than it can show at once? A) Exclude, then top 10 (recommended): findLookAlikes drops notDuplicateOf ids before ranking/slicing to 10; add_expense blocks only on what it returns; notDuplicateOf max 100. B) Show up to 50: up to 50 candidates, notDuplicateOf 50, past 50 still blocks on unseen ones.
State: approved
Actual answer: A) Exclude, then top 10 (D12, Basel 2026-10-26)
Accepted scope: findLookAlikes takes an `exclude` id set applied before ranking/slicing; add_expense blocks only on returned candidates; notDuplicateOf max 100 (supersedes D3's max 10, same semantics); test: 15 matches → 10, then 5, then created.
History: D3 approved notDuplicateOf max 10; reopened by O2 (unbounded block past the 10 cut).

### R12: Does file_inbox_entry run the look-alike check? (O3)
Finding: O3 [High] (8/10) D7 tool; `routes/inbox.ts:207-251` has no check either; reviewer: outside voice
Plan baseline: D7/D10/D11 approved; check on filing unspecified
Runtime evidence: the session filing route runs no look-alike check (static read)
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R12 filing check | none | file_inbox_entry runs findLookAlikes (excluding the entry itself, notDuplicateOf like add_expense); session route unchanged | filing exempt, documented in the description and ADR |
Question D13: Should Claude's inbox filing check for look-alikes first, like add_expense? A) Check like add_expense (recommended) B) Exempt, documented.
State: approved
Actual answer: A) Check like add_expense (D13, Basel 2026-10-26)
Accepted scope: file_inbox_entry runs findLookAlikes excluding the entry itself, honours notDuplicateOf, answers outcome matched, releases the key; session route unchanged; tests: profile look-alike blocks filing, notDuplicateOf files it.
History: none

### R13: Write-only grants and the matched answer (O4)
Finding: O4 [Medium] (8/10) `oauth/protocol.ts:20-24` a client may request `write` alone; `read-tools.ts:94` read tools need `read`; reviewer: outside voice
Plan baseline: matched answer returns full candidates (D5)
Runtime evidence: Connect grants both by default (protocol.ts:12-13 "both advertised and granted when none is requested")
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R13 write-only grant | n/a | write tools need both `read` and `write` (registered only when both are granted) | matched answer strips vendor/title/note for a grant without `read` |
Question D14: A) Write needs read too (recommended) B) Strip details.
State: approved
Actual answer: A) Write needs read too (D14, Basel 2026-10-26)
Accepted scope: registerWriteTools / registerReceiptTools / file_inbox_entry register only when the grant has both `read` and `write`; test: a write-only grant is offered no write tool (extends mcp-write-tools.test "scopes").
History: none

### R14: Parallel add_expense calls (O5)
Finding: O5 [Medium] (8/10) plan §3.3 "one agent works sequentially"; reviewer: outside voice
Plan baseline: race accepted and recorded in the ADR
Runtime evidence: Cloud Run `max_instances` default 1, held at 1 until TD-017 (`terraform/variables.tf:167-170`); per-person agent limiter is already in-process (`index.ts` agentPersonLimiter, MUT-435 D4); advisory xact lock precedent `prisma.ts:3371` (signup)
Comparison grid:
| Choice | Current | A | B | C |
|---|---|---|---|---|
| R14 parallel writes | race (both pass) | in-process per-person queue around check+write for add_expense and file_inbox_entry; descriptions say one at a time; ADR ties the cross-instance race to TD-017 | Postgres advisory xact lock around check+create via a new store method (memory + Prisma) | descriptions only; race recorded |
Question D15: A) Per-person queue (recommended) B) Database lock C) Description only.
State: approved
Actual answer: B) Database lock (D15, Basel 2026-10-26)
Accepted scope: Postgres `pg_advisory_xact_lock` keyed by the person (pattern `prisma.ts:3371`) held across look-alike check + create, through a new store method (memory: per-user promise chain; Prisma: one transaction) used by add_expense (both destinations) and file_inbox_entry; the agent allow-list + STORE_ACCESS entry; test:db contract: two concurrent calls for the same line → one created, one matched. Descriptions also say one call at a time.
History: none

### R15: Vendor ranking for inbox look-alikes (O6)
Finding: O6 [Medium] (9/10) `read-tools.ts:224` inbox candidates `vendor: null`; MCP inbox notes start with the vendor (`write-tools.ts:92` `[vendor, title, notes].join(' · ')`); reviewer: outside voice
Plan baseline: inbox candidates vendorMatch 'unknown'
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R15 inbox vendor | null → 'unknown' | use the note's text before the first " · " as the inbox candidate's vendor (any capture source) | keep null; document |
Question D16: A) Note's first part (recommended) B) Keep unknown.
State: approved
Actual answer: A) Note's first part (D16, Basel 2026-10-26)
Accepted scope: inbox candidate vendor = note text before the first " · " (trimmed, null if empty), used for vendorMatch and ranking only; test: "Starbucks · latte" inbox note ranks first, vendorMatch similar.
History: none

### R16: Validate before asking "same purchase?" (O7)
Finding: O7 [Medium] (8/10) plan §3.3 step 2 runs the check inside `work` before `prepareExpenseCreate` (`write-tools.ts:110`); a stored 4xx on the retry burns the key (`context.ts:186-190`); reviewer: outside voice
Plan baseline: check first, then compose
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R16 order | check → validate → create | validate (prepareExpenseCreate / filing rules, no writes) → check → create, all inside the D15 lock | keep check first |
Question D17: A) Validate first (recommended) B) Check first.
State: approved
Actual answer: A) Validate first (D17, Basel 2026-10-26)
Accepted scope: inside the D15 lock: validation (prepareExpenseCreate / filing rules, no writes) → look-alike check → withResolvedVendor → create; tests: invalid date refused before any matched answer; matched answer creates no vendor.
History: none

### R17: Where fileInboxExpense lives (O8, reopens D11's destination only)
Finding: O8 [Low] (9/10) `inbox/compose.ts:7-13` "Entirely pure … nothing to look up"; reviewer: outside voice
Plan baseline: D11 approved extraction into `server/src/inbox/compose.ts`
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R17 destination | inbox/compose.ts (D11) | new `server/src/inbox/file-expense.ts` (compose.ts stays pure) | keep compose.ts, rewrite its header |
| D11 extraction, refactor-first | approved | same | same |
Question D18: A) New file-expense.ts (recommended) B) Keep compose.ts.
State: approved
Actual answer: A) New file-expense.ts (D18, Basel 2026-10-26)
Accepted scope: fileInboxExpense in `server/src/inbox/file-expense.ts`; compose.ts unchanged; D11's refactor-first commit otherwise as approved.
History: D11 named inbox/compose.ts; reopened by O8 (pure-module contract).

Outside voice dispositions: O1 applied (plan §1–§9 rewritten to the ledger); O2→D12 A; O3→D13 A; O4→D14 A; O5→D15 B; O6→D16 A; O7→D17 A; O8→D18 A; O9 and O11 applied as common work (§3.5–§3.7, §5); O10 not reopened. Remaining disagreement: the reviewer doubts the value of the D6 index; Basel chose it knowingly.

## TODOS.md

No TODOs proposed: everything deferred is already tracked (TD-260 inbox receipts, TD-017 multi-instance, MUT-438 import, MUT-256 reader).

## NOT in scope

- Statement file import (MUT-438): postponed by the epic until the card offers CSV/XLSX.
- Matching To-review library receipts: they carry no amount until MUT-256's reader.
- Receipts on inbox entries (TD-260): agents file first (D7).
- A look-alike check on the session filing route: the ticket and D13 cover agent paths only.
- A merge tool for existing duplicates: not asked for.

## What already exists

See plan §2. Reused, not rebuilt: `similarity.ts` (the rule), the find_similar candidate code (extracted into `findLookAlikes`), `withToolIdempotency`/`runIdempotent` key release, `countReadyByExpenseIds`, the receipt tools, the signup advisory-lock pattern, the inbox filing rules (extracted into `fileInboxExpense`, D11/D18: callers `routes/inbox.ts:203-253` and `file_inbox_entry`; ~45 lines moved, ~10 added, ~40 not copied).

## Diagram: agent expense write (add_expense / file_inbox_entry)

```
call ──► gates (agentProfile, mayWrite, lapse) ──► withToolIdempotency(key, args − notDuplicateOf)
                                                       │ replay? ──► stored answer (created / 4xx)
                                                       ▼
                                   agentWriteLock.run(person) ── pg_advisory_xact_lock
                                                       │
                       validate (no writes) ── 4xx ──► stored refusal
                                                       │
                 findLookAlikes(all profiles + inbox, exclude = notDuplicateOf ∪ entry)
                         │ any ──► LookAlikesFound ──► key released ──► {outcome: matched, candidates}
                         ▼ none
       resolve vendor ─► create / fileAsExpense ─► touch vendor ─► audit ─► {outcome: created, expense}
```

## Failure modes

| Path | Realistic failure | Covered by | User sees |
|---|---|---|---|
| matched answer | key not released (LookAlikesFound mapped as a 4xx) | write-tools test "same key then creates" | clear: retry works |
| replay | check before the claim → self-match | CRITICAL replay test | clear |
| lock | pool exhaustion under parallel calls / tx timeout | test:db lock contract; per-person limiter; 5xx releases the key | clear error, retry |
| filing refactor | a rule dropped while moving the route | existing inbox filing tests (regression contract) | clear 4xx stays |
| inbox query | Prisma string-date window off by one | test:db window edges | none (silent miss) → covered by contract |
| scopes | write-only grant still offered tools | scopes test | n/a |

Critical gaps: 0 (every silent path has a planned test).

## Worktree parallelization strategy

Sequential implementation, no parallelization opportunity: every step touches `server/src` (mcp, inbox, repositories, store-guard), and the refactor commit must land first.

## Implementation Tasks

- [ ] **T1 (P1, human: ~2h / CC: ~15min)** — inbox — extract `fileInboxExpense` into `server/src/inbox/file-expense.ts`, move the route onto it (refactor commit, no behaviour change)
  - Surfaced by: Section 2 #7, D11/D18
  - Files: server/src/inbox/file-expense.ts, server/src/routes/inbox.ts
  - Verify: inbox-filing, expense-capture-source, routes-vendors, inbox-isolation tests green unchanged
- [ ] **T2 (P1, human: ~4h / CC: ~30min)** — repositories — `ExpenseFilter.amountMinor`, `inboxEntries.listMatchCandidates`, index migration, `agentWriteLock` (memory + Prisma), store-guard classification + allow-list
  - Surfaced by: D6, D15, O9
  - Files: ports.ts, memory.ts, prisma.ts, schema.prisma + migration, store-guard.ts
  - Verify: store contracts on test:db; store-guard.test
- [ ] **T3 (P1, human: ~3h / CC: ~20min)** — mcp read — `findLookAlikes` (exclude, inbox note vendor, hasReceipt, canAttachReceipt), `vendorMatch` in similarity.ts
  - Surfaced by: D2, D12, D16, plan §3.2
  - Files: similarity.ts, read-tools.ts
  - Verify: similarity + mcp-read-tools tests
- [ ] **T4 (P1, human: ~6h / CC: ~45min)** — mcp write — validate → check → write under the lock; `notDuplicateOf`; matched result; `file_inbox_entry`; read+write registration; descriptions/instructions
  - Surfaced by: D3–D5, D7–D10, D12–D17, O11
  - Files: write-tools.ts, receipt-tools.ts, server.ts
  - Verify: mcp-write-tools tests incl. CRITICAL replay + matched-release
- [ ] **T5 (P2, human: ~3h / CC: ~30min)** — release-QA — `mcp.statement-match`, `mcp.file-inbox-entry`, update `mcp.add-expense`; run each until it passes
  - Surfaced by: plan §7
  - Files: qa/features/portal-selfservice/mcp.yaml, qa/specs/portal-selfservice/mcp.spec.ts
  - Verify: `release-qa run --attach --only <id>`, `release-qa lint`
- [ ] **T6 (P2, human: ~1h / CC: ~10min)** — docs — ADR-202, CHANGELOG, SYSTEM_OVERVIEW, PATTERNS, TECH_DEBT (TD-258 resolved, TD-260/TD-017 notes), TEST_PLAN, COMPONENT_REGISTRY
  - Surfaced by: CLAUDE.md knowledge protocol
  - Verify: files updated in the same branch

Effort ratios assumed: features ~30x, tests ~50x, refactor ~20x.

## Unresolved decisions

None.

## Completion summary

- Step 0: Scope Challenge — scope accepted as-is (then widened by Basel's D7)
- Reality rows: 7/7 tier-1 + 1 tier-2 (db) considered; premises verified by code reads, 0 unverified premises
- Architecture Review: 1 issue found (#5)
- Code Quality Review: 1 issue found (#7)
- Test Review: diagram produced, 23 gaps identified (all mapped to required tests)
- Performance Review: 0 issues found
- NOT in scope: written
- What already exists: written
- TODOS.md updates: 0 items proposed to user
- Failure modes: 0 critical gaps flagged
- Unresolved decisions: 0 in this review
- Outside voice: Claude Plan subagent (native fallback), completed; Codex unavailable (CLI not installed); 11 findings, 7 resolved by D12–D18, 3 applied as common work, 1 not reopened
- Parallelization: 1 lane, 0 parallel / 6 sequential
- Lake Score: 13/16 answers picked a 10/10 option (scored answers only)

Decision ledger ends. Approval readiness: PASS — R1 (D2), R2 (D3, max superseded by D12), R3 (D4), R4 (D5), R5 (D6), R6 (D7), R7 (D8), R8 (D9), R9 (D10), R10 (D11), R11 (D12), R12 (D13), R13 (D14), R14 (D15), R15 (D16), R16 (D17), R17 (D18); scope D1.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Outside Review | native fallback (Claude Plan subagent; Codex CLI not installed) | Independent 2nd opinion | 1 | unavailable (in-host completed) | 11 findings, all dispositioned |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | ISSUES OPEN (mapped work) | 25 issues, 0 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | — |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **OUTSIDE COVERAGE:** codex, plan-review: unavailable (CLI not installed); native Claude Plan subagent completed within 5 minutes with 11 findings. That native report does not count as outside coverage.
- **VERDICT:** no review CLEAR; eng review ran with all 18 decisions answered and 25 mapped issues (implementation work, not open questions). eng review required before landing per dashboard rules; ready to implement per the ledger.

NO UNRESOLVED DECISIONS
