# MUT-435 — MCP read tools: profiles, categories, clients, vendors, inbox, look-alikes

**Status:** plan (2026-10-26) · **Epic:** MUT-432 · **Blocked by:** MUT-433 (Done), MUT-434 (merged to local main 5822e599, In Review; only release hand checks owed) · **Blocks:** MUT-436 (shares this plan's §3 foundation), MUT-437 (reuses §4.6's rule)

**Eng review (2026-10-26) is binding and overrides the body where they differ:** file layout per the scope record (6 new files), corrections C1–C4, R1/R3/R4–R8 and OV1–OV12 at the end of this file.

## 1. Problem and acceptance criteria

`/mcp` authenticates a flagged person's own Claude and answers `tools/list` with nothing (MUT-434 D4). This ticket gives the agent the read tools it needs before it writes anything (MUT-436): where to file it (profiles), how to file it (categories, clients, vendors), what is already waiting (inbox), and whether the purchase is already recorded (look-alikes).

Ticket AC:
- **AC1** Each tool returns only what the signed-in person may see (same ownership rules as the REST routes, co-owners per MUT-373).
- **AC2** `find_similar_expenses` uses the shared matching rule from the statement ↔ receipt matching story (MUT-437).
- **AC3** Tool descriptions are English and tell the agent to show the person what it found before writing.
- **AC4** Responses are paginated and capped.

## 2. Decisions taken before planning (Basel, 2026-10-26)

- **P1: profile visibility = owned + co-owned only** (`ownedOrCoOwnedProfilesOf`, `personal-profile.ts:55`). A firm, a Malafat-fed profile, or someone else's personal profile the person merely belongs to is invisible to the agent in v1. This settles ADR-196 Deferred (a) and (b) for v1: no firm data is reachable, so neither firm-owner consent nor audit-on-join is needed yet. Revisit when firms want agents (new ticket, not this epic).
- **P2** (MUT-436): receipts upload via signed URL, two tools.
- **P3** (MUT-436): `captureSource` column on Expense.
- **P4** (MUT-436): inbox entries carry `captureSource: 'mcp'`; the audit row is written at filing (existing behaviour).

## 3. Foundation (shared with MUT-436)

### 3.1 Layout

```
server/src/mcp/
  server.ts          createMcpServer: builds McpContext, calls registerReadTools (+ registerWriteTools in 436)
  context.ts         McpContext { user, grant, store (guarded), rawStore, now, billingGate } + agentProfile()
  results.ts         toolResult(json) / toolError(ApiError|ZodError) → { isError: true, content } ; English messages
  paging.ts          cursor/limit schema (limit 1–50, default 25) + encode/decode helpers over existing cursors
  tools/
    profiles.ts      list_profiles
    catalog.ts       list_categories, list_clients, list_vendors
    inbox.ts         list_inbox
    similar.ts       find_similar_expenses
server/src/expenses/similarity.ts   pure matching rule (shared with MUT-437)
```

Nearest existing shape to follow: route handlers that call `compose` helpers + `store.*` directly (`routes/inbox.ts`, `routes/receipts.ts approve`). No HTTP self-calls (agent report §10).

### 3.2 Profile resolution — the one door (AC1)

`agentProfile(ctx, profileId)` in `mcp/context.ts`:
1. `store.memberships.find(user.id, profileId)` → none ⇒ `PROFILE_NOT_FOUND` (same as REST: no existence leak).
2. `organizations.getById` → `ownsProfile(org, user.id, membership.role)` false ⇒ the **same** not-found error (P1; a firm member gets "not found", not "forbidden").
(Eng review C1: there is no per-profile closure rule in `selectProfile`; account closure is gated per person in `agent-auth.ts`. No extraction.)

`list_profiles` = `ownedOrCoOwnedProfilesOf`. Every other tool takes a required `profileId` and passes through `agentProfile` first. Pinned by a table test: owner ✓, co-owner ✓, firm member ✗, Malafat-fed member ✗, someone's personal profile shared ✗, closing profile ✗, non-member ✗.

### 3.3 Store guard — explicit allow-list

Replace `agentStoreGuard`'s `access !== 'read'` with an explicit set:

```ts
// store-guard.ts
export const AGENT_STORE_METHODS: ReadonlySet<`${string}.${string}`> = new Set([
  // MUT-435 reads
  'memberships.find', 'memberships.listByUser', 'organizations.getById',
  'expenseCategories.list', 'customers.list', 'vendors.search',
  'inboxEntries.list', 'expenses.list' /* or the new similarity finder, §4.6 */,
  // MUT-436 adds its writes here, each with a test
]);
```

`assertCanCall` passes only if `repo.method ∈ AGENT_STORE_METHODS` **and** the method is classified (unclassified still throws). Plain `'read'` methods are no longer open by default — tighter than today. A test pins the exact set (adding a method is a reviewed diff), and a second test asserts no `operator`/`sessionOnly`/`control` method other than the ones named in the set (MUT-436's idempotency claims) is in it.

`inboxEntries.list` is `sessionOnly` today; the allow-list overrides that for the agent principal only. It is per person (`userId` = the agent's user), so no profile check applies.

### 3.4 Scope

All read tools require `read` in `grant.scopes` (every grant has it today; checked anyway, one line in `context.ts`, so a future write-only grant can't read).

### 3.5 Errors and limits

- Tool failures return MCP `isError: true` with an English sentence + the API error code, never a thrown JSON-RPC error (the agent can read and recover). Zod input errors list the field.
- Every list: `limit` 1–50 (default 25), opaque `cursor`, `nextCursor` in the result. Text output is the JSON (`structuredContent` + a `text` copy for clients that ignore structured output), with `outputSchema` declared.
- Amounts: `amountMinor` as a string (bigint) **and** `amount` as a decimal string formatted by currency exponent (`currencies` helper), so the agent never divides by 100 for JOD/KWD (3 decimals, MUT-140/278).
- Rate limit: MUT-434's per-grant limiter already covers `/mcp`.

### 3.6 Server instructions and tool descriptions (AC3)

Server `instructions` (exists) extended: "Before you write anything, show the person what you found (the profile, category, amount, date, any look-alike) and ask. Never pick a profile for them." Each tool description ends with the show-before-write sentence where it applies. A test asserts every registered tool has a description containing the guard sentence and an `outputSchema`.

## 4. Tools

| Tool | Input | Reads | Output (per item) | Cap |
|---|---|---|---|---|
| `list_profiles` | — | `ownedOrCoOwnedProfilesOf` | `id, name, type (personal\|business), defaultCurrency, timezone, isPersonalDefault, coOwned` | ≤ owned cap (6) + co-owned; paged anyway |
| `list_categories` | `profileId, includeArchived?, cursor?, limit?` | `expenseCategories.list` | `id, name, archived` | in-memory page over the list |
| `list_clients` | `profileId, cursor?, limit?` | `customers.list` (keyset) | `id, name, archived` | 50 |
| `list_vendors` | `profileId, q, limit?` | `vendors.search` | `id, name, nameKey score` | 25 (store cap) |
| `list_inbox` | `cursor?, limit?` | `inboxEntries.list` | `id, kind, amount, currency, occurredOn, note, captureSource` | 50 |
| `find_similar_expenses` | `amount, currency, date, vendor?, profileId?` | §4.6 | `where (profile id \| inbox), id, amount, currency, occurredOn, vendor, score, reasons[]` | 10 |

### 4.1 `list_profiles`
`hostedProfileFor` (serializers.ts:82) carries billing, firm and owners fields the agent doesn't need; write a small `agentProfileView(org, coOwned)` instead (fewer fields = less to leak). Business-vs-personal comes from `profileTypeOf`.

### 4.2 `list_categories` — no seeding
`GET /v1/expense-categories` seeds the preset on first read (a write + SYSTEM audit). The agent path **does not seed** (no write in a read tool; the guard would refuse it anyway). An empty list returns `[]` with a `hint`: "This profile has no categories yet; the person can open it in MTB3A once to get the default set." Category is optional server-side, so MUT-436 still works.

### 4.3 `list_clients` — same filter as REST, archived excluded by default.

### 4.4 `list_vendors` — typeahead only (`q` required, ≥ 1 char): the store has no full list, and a typeahead is what the agent needs ("is 'كارفور' already a vendor?"). Arabic/Hebrew `q` passed through as typed; `vendorNameKey` normalises inside the store.

### 4.5 `list_inbox` — the person's own entries, keyset cursor via `decodeInboxCursor`. Not profile-scoped.

### 4.6 `find_similar_expenses` and the shared rule (AC2)

MUT-437 (matching) is after MUT-436, but its rule is already decided (epic decision 4, memory 2026-10-25): **same currency, same amount, date within ±3 days, similar vendor**. This ticket implements it once, pure:

```ts
// server/src/expenses/similarity.ts
export const MATCH_DATE_WINDOW_DAYS = 3;
export interface MatchProbe { amountMinor: bigint; currency: string; occurredOn: string; vendor?: string }
export interface MatchCandidate { amountMinor: bigint; currency: string; occurredOn: string; vendor: string | null }
export function matchScore(probe, candidate): { matches: boolean; score: number; reasons: MatchReason[] }
export function dateWindow(occurredOn): { from: string; to: string }
```

- Currency and amount must be equal (hard). Date within the window (hard). Vendor: if both sides have one, `scoreVendorName` (vendors/keys.ts:70) ≥ `FUZZY_SUGGESTION_FLOOR` (0.6) adds to the score; a missing vendor on either side doesn't exclude (receipts often lack one) but ranks lower. `reasons` = `['amount','currency','date±N','vendor']` so the agent can explain.
- MUT-437 imports this module; its brief must not redefine the rule. Recorded in an ADR.

**Search scope:** `profileId` given ⇒ that profile; omitted ⇒ every visible profile (P1) **and** the person's inbox. Per profile one indexed query: `expenses.list(orgId, { from, to, currency })` on `@@index([organizationId, occurredOn, id])`, ±3 days ⇒ small. Candidate rows capped at 200 per profile read (a ±3-day window above that is pathological; flag `truncated: true`). Inbox: page through `inboxEntries.list` filtered in memory, capped at 200 newest (inbox is small by design). Worst case ≈ 7 indexed reads per call.

Needs: `ExpenseFilter` has `from/to/currency` already → **no new store method** for amount; amount filtered in memory over the window. (If a later profile makes this hot, add `amountMinor` to the filter — TD, not now.)

`amount` input is a decimal string parsed with `parseExpenseAmount` (same parser as writes), currency validated by the filable-currency rule.

## 5. Wiring

- `server/src/mcp/server.ts`: drop the `void`s; `registerReadTools(server, ctx)`.
- `server/src/routes/mcp.ts`: pass `rawStore` + `now` + `billingGate` into the context (436 needs them; 435 passes them already so the seam is one change).
- No REST route, so **no OpenAPI change**; `openapi:check` stays green. API version bump `1.7x.0-mut435` (server behaviour change) per convention.
- `src/hosted/api/schema.d.ts` unchanged.

## 6. Tests (TDD, written first)

Unit (vitest, `server/src/mcp/__tests__/`, memory store):
1. `similarity.test.ts` — equal/unequal currency, amount, date edges (−3, +3, ±4), vendor present/absent/Arabic vs Latin transliteration below floor, ranking order, `reasons`.
2. `agent-profile.test.ts` — the §3.2 table (7 rows).
3. `store-guard.agent.test.ts` — pinned allow-set; a classified-but-unlisted `read` method (e.g. `audit.list`) now refuses; unclassified throws.
4. `read-tools.test.ts` — via an in-memory MCP client (`InMemoryTransport` from the SDK) against `createMcpServer`: each tool's happy path, cursor round-trip, limit cap (51 → validation error), foreign profile ⇒ not-found, `list_categories` on an empty profile writes nothing (audit count unchanged), JOD amount formatting.
5. `descriptions.test.ts` — AC3 sentence + outputSchema on every tool.

Integration:
6. `routes/__tests__/mcp.test.ts` (extend) — real `/mcp` POST with a `mat_` token: `tools/list` returns the six names; a token without `read` scope ⇒ every tool `isError`.
7. `test:db` contract: `expenses.list` window query on Postgres returns the same rows as memory for the similarity fixture.

Command: `npm --prefix server test -- mcp similarity store-guard` while iterating (via `heavy`), full server CI set at the end (typecheck, lint, openapi:check, test, test:db).

AC → test: AC1 → 2, 4 (foreign profile), 6 · AC2 → 1, 4 · AC3 → 5 · AC4 → 4 (cursor, cap).

## 7. Release-QA

No portal UI in this ticket. Feature `qa/features/portal/mcp.yaml` → `mcp.read-tools` (tier: extended): "Claude lists my profiles and finds a look-alike". Spec `qa/specs/portal/mcp.spec.ts` drives `/mcp` over HTTP with a token minted through the existing QA OAuth helper (the `portal-selfservice.connect` flow from MUT-434), asserts `tools/list` and one `find_similar_expenses` hit. `paths` cover `server/src/mcp/**`, `server/src/expenses/similarity.ts`. Manual hand check (owed with MUT-434's): real Claude.ai lists profiles.

## 8. Docs to update at build

ADR-199 (number at merge): agent visibility = owned + co-owned (closes ADR-196 Deferred for v1), agent store allow-list, shared match rule. CHANGELOG, SYSTEM_OVERVIEW (MCP tools), PATTERNS (MCP tool shape: context → agentProfile → compose/store → toolResult), TEST_PLAN, TECH_DEBT (amount filter in memory; no vendor list without `q`).

## 9. Risks

- **Prompt injection via stored text** (vendor names, notes) reaching the agent: unavoidable for a read tool; mitigated by structured output and the "ask before writing" instruction; MTB3A itself never acts on it. Noted in the ADR.

Business / product impact
- Basel's own Claude can see where an expense would go and spot that a purchase is already recorded, so a receipts folder doesn't turn into duplicates.
- Second-to-last brick of epic MUT-432; MUT-436 (writes) builds on this foundation and MUT-437 reuses the match rule.
- Ships dark (flag + `oauth_enabled`); firm data stays out of agent reach, so no consent exposure.

---

# Eng review — MUT-435 + MUT-436 (2026-10-26, /plan-eng-review)

Target: `.claude/designs/mut-435-mcp-read-tools.md` and `.claude/designs/mut-436-mcp-write-tools.md` (this file is the report file for both). Base: main 717ad15b (ADR-199 taken by MUT-252 since planning; this epic's ADRs start at ADR-200).

## Scope record

feature answers: none cut; structure: A Smaller arrangement (D1, Basel 2026-10-26); accepted scope: both plans' tools, contracts and tests unchanged, arranged as 6 new files — `server/src/mcp/context.ts` (McpContext, agentProfile, toolResult/toolError, cursor/limit schema), `mcp/read-tools.ts` (6 read tools), `mcp/write-tools.ts` (add_expense, both destinations, withToolIdempotency), `mcp/receipt-tools.ts` (start/complete_receipt_upload), `server/src/expenses/similarity.ts`, `server/src/expenses/receipts-compose.ts`; `runIdempotent` lives in the existing `server/src/idempotency.ts`; pending remedies: R1, R2, R3.

## Factual corrections (no behaviour approval needed)

- C1 (9/10) `server/src/auth/middleware.ts:350-358` `selectProfile` has no closed/closing-profile check (closure is per person, `agent-auth.ts`). MUT-435 §3.2 step 3 and the `profileSelectable` extraction are dropped; `agentProfile` = membership + `ownsProfile`.
- C2 (9/10) `server/src/repositories/ports.ts:544-548` `CustomerFilter` has no text search: `list_clients` takes no `q`.
- C3 (9/10) `server/src/auth/writability.ts:20` `Principal = 'apiKey' | 'session'`; MUT-434 added no `'agent'` principal. See R1.

## Decision ledger

### R1: how an agent's write is checked against per-profile writability
Finding: 3, P2, 9/10, `server/src/auth/writability.ts:20` (`export type Principal = 'apiKey' | 'session';`) and `:41-56` (WRITABILITY_MATRIX has `apiKey`/`session` columns only), reviewer: Claude (eng review)
Plan baseline: original proposal, MUT-436 §3.1 step 2 — "`'agent'` added to `WRITABILITY_MATRIX` with the session's expenses column only; every other domain `none`" (unapproved)
Runtime evidence: no `'agent'` principal exists; `expenses` row is `session: 'read-write'` and not profile-dependent, so `mayWriteFor('session','expenses',w)` is true on every profile; the agent's real method gate is the store-guard allow-list (MUT-435 §3.3)
Comparison grid:
| Choice | Current | A (recommended) | B |
|---|---|---|---|
| R1 agent writability check | unspecified (no agent principal) | no matrix change; tools call `mayWriteFor('session', domain, writer)` through one helper `agentMayWrite(domain, writer)` in mcp/context.ts, documented as "an agent writes as its person's session would, only through allow-listed methods"; test pins expenses=true and every other domain refused by the allow-list | widen `Principal` to `'agent'`, add an `agent: Access` column to all 13 matrix rows (expenses read-write, all else none), update `mayWrite`/`storeRefusal`/brief table; tests per row |
| R2 audit metadata | pending | pending | pending |
| R3 inbox-write switch | pending | pending | pending |
| D1 structure | Smaller (approved D1) | Smaller | Smaller |
Question D2:
D2 — How should an agent's write be checked against per-profile writability? (C3: no 'agent' principal exists.) A) reuse the session's column through one helper, the store allow-list stays the agent's real gate (recommended, human ~2h / CC ~10 min, low risk, one place to maintain); B) add an 'agent' principal and column to all 13 matrix rows (human ~1 day / CC ~40 min, touches the shared matrix every route reads, two sources of truth with the allow-list).
Header: Writability
Options:
A) Reuse session column (recommended)
No matrix change. Tools call mayWriteFor('session', domain, writer) via agentMayWrite() in mcp/context.ts; the store allow-list stays the agent's method gate. Test pins it.
B) Add 'agent' principal
Widen Principal to 'agent', add an agent column to all 13 WRITABILITY_MATRIX rows (expenses read-write, rest none), update mayWrite/storeRefusal and the brief's table.
State: approved
Actual answer: A) Reuse session column (Basel, D2, 2026-10-26)
Accepted scope: no WRITABILITY_MATRIX/Principal change; agent tools call `agentMayWrite(domain, writer)` in mcp/context.ts = `mayWriteFor('session', domain, writer)`; store allow-list remains the agent's method gate; one test pins expenses allowed and other domains refused. MUT-436 §3.1 step 2 amended accordingly.
History: none

- C4 (9/10) `server/src/routes/audit.ts:14,49`: every expense entity type is already excluded from `/v1/audit` for API keys (`SESSION_ONLY_ENTITY_TYPES`), so `oauthClientId`/`grantId` in `expense.created` metadata can't reach Malafat. MUT-436 §3.1 step 7's redaction work is dropped; R2 is withdrawn (no behaviour choice left).

### R3: keeping the shipped phone app safe from 'mcp' inbox entries
Finding: 5, P1, 9/10, `mutaba3a-flutter/mutaba3a/lib/domain/models/transaction_enums.dart:163-167` (`orElse: () => throw ArgumentError('Unknown CaptureSource: $value')`) used by `lib/data/repositories/inbox_repository.dart:64-65` (`CaptureSource.fromString(json['captureSource'] as String)`), reviewer: Claude (planning + eng review)
Plan baseline: original proposal, MUT-436 §5 — Flutter fix in this ticket, released first; server switch `MCP_INBOX_WRITES` (default off, Terraform var) refuses inbox destination until then (unapproved)
Runtime evidence: static read; shipped phone builds throw while decoding an inbox page containing an unknown source, so the person's phone inbox fails to load
Comparison grid:
| Choice | Current | A (recommended) | B |
|---|---|---|---|
| R3 inbox-write protection | none (no 'mcp' value exists yet) | Flutter tolerant decode + `mcp` value in this ticket; server config `MCP_INBOX_WRITES` default false (Terraform var) answers NOT_AVAILABLE for destination inbox until the phone release is live; before-release.md step to flip it | Flutter fix in this ticket; no server switch; operator grants `agent_access` only to people already on the fixed phone build (process rule in before-release.md) |
| R1 writability | approved A (D2) | approved A | approved A |
| D1 structure | approved Smaller | Smaller | Smaller |
Question D3:
D3 — How do we stop 'mcp' inbox entries from breaking the shipped phone app's inbox? A) server switch MCP_INBOX_WRITES, off until the phone fix is in the stores (recommended; human ~3h / CC ~15 min; enforced by code, flipped once); B) no switch, rely on granting the flag only to people on the fixed build (human ~0 / CC ~0; a process rule that one early grant breaks).
Header: Phone safety
Options:
A) Server switch, off (recommended)
Flutter tolerant decode + 'mcp' in this ticket; MCP_INBOX_WRITES (default false, Terraform var) refuses inbox writes until the phone release is live; before-release.md says when to flip it.
B) Process rule only
Flutter fix in this ticket; no server switch; the operator grants agent_access only to people already on the fixed phone build.
State: approved
Actual answer: A) Server switch, off (Basel, D3, 2026-10-26)
Accepted scope: MUT-436 ships the Flutter tolerant decode (`tryFromString`, unknown → null) and an `mcp` enum value with its label; server config `MCP_INBOX_WRITES` (default false, Terraform var) answers `NOT_AVAILABLE` for `destination: inbox` until the phone release is live; `docs/operations/before-release.md` gets the flip step; tests for both states.
History: none

### R4: regression contract for the two extractions MUT-436 makes from live routes
Finding: S3-1, P1 (regression risk), 8/10, `server/src/idempotency.ts:46` (`withIdempotency`) and `:157` (`identityIdempotent`); `server/src/routes/expenses.ts:267,298` and `server/src/routes/receipts.ts:93` (receipt start/complete bodies), reviewer: Claude (test review)
Plan baseline: original proposal, MUT-436 §4 "existing idempotency tests must stay green unchanged" and §3.2 extraction into `expenses/receipts-compose.ts` (no stated contract for the receipt routes)
Runtime evidence: static read; both are live REST paths (phone, portal, Malafat-free); behaviour is pinned by existing route tests today
Comparison grid:
| Choice | Current | A (recommended) | B |
|---|---|---|---|
| R4 regression contract | unstated for receipts; "tests unchanged" for idempotency | Behaviour preserved byte-for-byte: status codes, response bodies, audit rows, replay/409/422 semantics of the 3 idempotency middlewares and the 4 receipt routes. Intended differences: none. Acceptance: existing route + idempotency suites pass with zero edits to their assertions, run before and after the extraction commit (refactor commit lands alone, before any MCP code); plus one new contract test per extracted function at its own boundary | Same preservation, proven only by the existing suites passing at the end of the branch (no separate refactor commit, no new boundary tests) |
| R1, R3, D1 | approved | unchanged | unchanged |
Question D4:
D4 — Regression contract for extracting runIdempotent and receipts-compose out of live routes. A) separate refactor commit first, existing suites untouched and green before and after, plus one boundary test per extracted function (recommended; human ~4h / CC ~20 min); B) existing suites green at the end only (human ~0 / CC ~0; a broken replay can hide behind later MCP commits).
Header: Regression
Options:
A) Refactor commit first (recommended)
Extraction lands alone before MCP code; existing idempotency and receipt route suites pass with unchanged assertions before and after; one new contract test per extracted function.
B) Suites green at the end
Same preserved behaviour, proven only by the existing suites passing on the final branch; no separate commit or boundary tests.
State: approved
Actual answer: A) Refactor commit first (Basel, D4, 2026-10-26)
Accepted scope: `runIdempotent` (from idempotency.ts:46/157) and `expenses/receipts-compose.ts` (from routes/expenses.ts:267/298, routes/receipts.ts:93 + its complete) land in their own commit before any MCP code; existing idempotency and receipt route suites pass with unchanged assertions before and after; one boundary contract test per extracted function; intended behaviour differences: none.
History: none

## Outside voice (Claude Plan subagent, native fallback; Codex not installed) — completed in 155 s, inside the 5-minute timer

Applied as corrections / required proof of approved contracts (verified against code):
- OV1 (High) store-guard.ts:384 passes through outside a Hono context: every tool test runs inside a context with `agentStoreGuard` set, plus one `/mcp` HTTP test per tool file proving a non-allow-listed method is refused from inside a tool callback.
- OV4 (Medium) idempotency.ts:46-80: `runIdempotent` takes the fingerprint(s) and a status classifier (5xx/429 release, 4xx stored + replayed); tools map a thrown ApiError to its status before classifying; R4 contract test pins "4xx stored and replayed" for tools; in-flight code is `OPERATION_IN_PROGRESS` (idempotency.ts:62).
- OV6 (Medium) app.ts:497: `mcpRoutes` options gain storage, urlTtlSeconds, receiptsLibrary, mcpInboxWrites, billingGate; requestId from the request; a context-free audit writer replaces `audit(c, …)` in receipts-compose.
- OV8 (Low) `agentMayWrite('expenses')` is always true; documented as parity, the allow-list is the gate.
- OV9 (Low) AC1 test asserts "contains" the instruction; custom `error` on the discriminated union.
- OV10 (Low) only InboxEntry and Expense outputs widen to `StoredCaptureSourceSchema`; Payment output unchanged.
- OV11 (Low) start_receipt_upload description notes each attempt holds a pending row counted in the caps.
- OV12 (Low) `destination: inbox` is built from config like `to_review`: absent while `MCP_INBOX_WRITES` is off.
- Flutter: `CaptureSource.tryFromString` already exists (transaction_enums.dart:170); the fix is the call site in inbox_repository.dart:65.

Owner choices R5–R8 — all **approved A** (Basel, D5–D8, 2026-10-26): R5 raise iOS+Android minimum build (MUT-293) to the fixed phone build before flipping MCP_INBOX_WRITES; R6 inbox filing (inbox.ts:247) and receipt approval (receipts.ts:319) copy captureSource onto the expense column; R7 idempotency keys namespaced `a:<userId>:` + one-key-per-source-document guidance + visible `replayed`; R8 McpContext carries a narrow `GateStore`, no `rawStore`, pinned by a test. Grids: each varies only its own row; R1, R3, R4, D1 fixed as approved.
- R5: A apply (before-release step raises iOS+Android minimum build via MUT-293 `auth/minimum-build.ts` to the fixed build, then flips MCP_INBOX_WRITES) / B keep (flip once the release is live) / C investigate / D defer.
- R6: A apply (`fileAsExpense` inbox.ts:247 and receipts approve routes/receipts.ts:319 copy the source onto the expense column) / B keep / C investigate / D defer.
- R7: A apply (namespace keys by user `a:<userId>:` so a reconnect still replays, and the description says one key per source document, never reused) / B keep (`a:<grantId>:`, description guidance only) / C / D.
- R8: A apply (context carries a narrow `GateStore` built from the raw store, no `rawStore`; test pins it) / B keep rawStore / C / D.

Approval readiness: PASS — D1 (scope record), R1/D2, R3/D3, R4/D4, R5/D5, R6/D6, R7/D7, R8/D8 each cite Basel's actual answer (2026-10-26); R2 withdrawn by C4; OV1/OV4/OV6/OV8–OV12 are corrections or required proof of approved contracts.

## Section findings

**1. Architecture**
- [P2] (confidence: 8/10) plan §3.5 maps only `ApiError|ZodError` to tool errors — an unexpected throw (DB down) must become a generic "MTB3A had a problem; try again" `isError` result, reported to Sentry, and release the idempotency key (5xx class). Required proof of the approved "tool failures return isError" contract; applied.
- Flow:
```
Claude ──POST /mcp (mat_)──► authenticateAgent ─► McpContext{user,grant,guardedStore,gateStore,cfg}
   tools/call ─► scope check ─► agentProfile (member ∧ ownsProfile) ─► [write] agentMayWrite + agentWriteGate
             ─► runIdempotent(a:<userId>:key) ─► compose helpers ─► guarded store (allow-list) ─► audit
             ─► toolResult {structuredContent,text} | toolError {isError}
```
- Failure modes: guard bypass (OV1, covered), phone decode crash (R3+R5, covered), duplicate on reconnect (R7, covered), lost marker on filing (R6, covered), unexpected throw (above, covered). 0 critical gaps open.

**2. Code quality** — No issues beyond C1–C4. Shared-code: `runIdempotent` (callers idempotency.ts:46, :157, + tool wrapper) and receipts-compose (routes/expenses.ts:267/298, routes/receipts.ts:93 + complete, + tools) each have ≥2 verified callers; extraction approved under R4.

**3. Tests** — R4 regression contract approved. Coverage diagram:
```
CODE PATHS                                  USER FLOWS
[+] mcp/context.ts                          [+] Claude files an expense
  ├─ agentProfile 7-row table  [PLANNED]      ├─ [PLANNED][→E2E] release-qa mcp.add-expense
  ├─ scope read/write          [PLANNED]      └─ [PLANNED] drawer chip en/ar/he
  └─ toolError incl. catch-all [PLANNED]    [+] Claude reads before writing
[+] read-tools.ts (6 tools)    [PLANNED]      └─ [PLANNED][→E2E] release-qa mcp.read-tools
[+] write-tools.ts                          [+] Retry / reconnect
  ├─ no destination (AC1)      [PLANNED]      └─ [PLANNED] same key replays; reconnect replays
  ├─ inbox off/on              [PLANNED]    [+] Phone inbox with 'mcp' entry
  └─ profile path gates        [PLANNED]      └─ [PLANNED] Flutter decode test
[+] receipt-tools.ts           [PLANNED]
[+] similarity.ts (pure)       [PLANNED]
[+] runIdempotent / receipts-compose — existing suites ★★★ (unchanged, R4) + boundary tests [PLANNED]
COVERAGE (planned): every new path has a ★★/★★★ test; Test Plan artifact: ~/.gstack/projects/vAWK3-mutaba3a/basel-main-eng-review-test-plan-20261026-012449.md
```

**4. Performance** — No issues. find_similar_expenses: ≤ 7 indexed window reads `[estimated: 6 owned cap + inbox]`, candidates capped 200 per read; list_profiles is one batched read (personal-profile.ts:62-65).

Dispositions: A-1 applied (required proof); S3-1 → R4 approved A; all others "no issues".

## NOT in scope
- Firm profiles for agents and firm-owner consent (P1; revisit when firms ask).
- Receipts on inbox entries (the inbox holds no files).
- Uploading a file from a Claude.ai chat (no HTTP from chat; P2).
- Amount filter in `ExpenseFilter` (in-memory over a ±3-day window is enough; TD).
- Income writes, edits, deletes (ticket scope-out). MUT-437 matching tools and MUT-438 import.

## What already exists (reused)
`ownedOrCoOwnedProfilesOf`/`ownsProfile` (personal-profile.ts), `prepareExpenseCreate`/`withResolvedVendor`/`touchExpenseVendor` (expenses/compose.ts), `parseInboxAmount`/`inboxDate`/`assertFilableCurrency` (inbox/compose.ts), `agentWriteGate`/`standingOfPerson`/`standingRefuses`, `scoreVendorName` (vendors/keys.ts), signed-URL storage + `verifyUploadedObject`, idempotency stores, MUT-293 minimum-build gate, `CaptureSource.tryFromString` (Flutter).

## Worktree parallelization
Sequential: MUT-435 (one worktree, one PR-equivalent local merge) → MUT-436 server (refactor commit, then tools) → MUT-436 Flutter (separate repo, can run in parallel with the portal chip once the enum is fixed). One worktree per repo per epic.

## Implementation Tasks
1. MUT-435: mcp/context.ts, read-tools.ts, expenses/similarity.ts, store-guard allow-list, tests, release-qa mcp.read-tools, ADR-200.
2. MUT-436 a: refactor commit — runIdempotent + receipts-compose, suites unchanged + boundary tests.
3. MUT-436 b: migration + StoredCaptureSourceSchema (InboxEntry/Expense) + filing copies source (R6).
4. MUT-436 c: write-tools.ts + receipt-tools.ts + MCP_INBOX_WRITES (Terraform var) + wiring (OV6, R8).
5. MUT-436 d: ExpenseDrawer chip + i18n en/ar/he + release-qa mcp.add-expense / mcp.receipt-upload.
6. MUT-436 e: Flutter tryFromString call site + mcp enum + label + test.
7. before-release.md: phone release → raise minimum build → flip MCP_INBOX_WRITES.
(JSONL task artifact not written: tasks live in the Jira tickets.)

## Suppressed findings (appendix)
- (4/10) SDK 1.32.1 `InMemoryTransport` path and `registerTool` outputSchema assumed from SDK docs; node_modules not installed in this checkout, verify at build.
- Search check: Aside not probed; in-distribution knowledge only for MCP tool idempotency patterns.

## Completion summary
- Scope Challenge: scope accepted as-is (smaller arrangement D1, no feature cut); 4 corrections C1–C4.
- Sections: 2 issues (Architecture 1, Tests 1), 0 critical gaps, 0 unresolved.
- Outside voice: Claude Plan subagent (native fallback), completed, 12 findings: 8 applied as corrections, 4 approved (R5–R8).
- Reality: premise-table pass (C1–C4 corrected, unverified=1 SDK API) · already-done pass (git log 5822e599..717ad15b touches no MCP/guard/expense files) · surface-check pass (routes/commands named verified: /mcp, idempotency stores, minimum-build.ts; SDK unverified locally) · binding-decisions pass (P1–P4, MUT-434 D4/S3 honoured; S3 403 deviation recorded) · numbers pass (caps are decisions, read counts [estimated]) · deferred-asks pass (AC "MUT-56 scan once it lands" inherited via receipts-compose; nothing dropped) · pr-count pass (sequential local merges, one worktree per repo).
- REALITY: premise-table pass C1–C4 corrected server/src/auth/middleware.ts:350
- REALITY: already-done pass no MCP tool commits server/src/mcp/server.ts:13
- REALITY: surface-check pass routes verified server/src/routes/mcp.ts:21
- REALITY: binding-decisions pass P1–P4 honoured .claude/DECISIONS.md:5294
- REALITY: numbers pass caps are decisions server/src/pagination.ts:12
- REALITY: deferred-asks pass MUT-56 via receipts-compose server/src/routes/expenses.ts:267
- REALITY: pr-count pass sequential merges .claude/designs/mut-436-mcp-write-tools.md:1

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Outside Review | Claude Plan subagent (native fallback; Codex not installed) | Independent 2nd opinion | 1 | completed (native, no outside credit) | 12 findings, 8 applied, 4 approved |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | ISSUES OPEN (all resolved into the plan) | 2 issues, 0 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | — |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **OUTSIDE COVERAGE:** Codex unavailable (not installed); native Claude Plan subagent completed in 155 s within the 5-minute timer; native results give no external coverage.
- **VERDICT:** ENG reviewed, every finding resolved into the plans; ready to implement MUT-435, then MUT-436.

NO UNRESOLVED DECISIONS
