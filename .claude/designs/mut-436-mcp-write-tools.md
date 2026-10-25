# MUT-436 — MCP write tools: add to inbox or file to a profile, attach receipts

**Status:** plan (2026-10-26) · **Epic:** MUT-432 · **Blocked by:** MUT-433 (Done), MUT-434 (on local main), and **MUT-435** (this plan builds on its §3 foundation: `mcp/context.ts`, `agentProfile`, the agent allow-list, `results.ts`) · **Blocks:** MUT-437 · **Relates:** MUT-66 inbox, MUT-255 receipts library, MUT-254 vendors, MUT-56 malware scan (plan only)

**Eng review (2026-10-26) is binding:** see §11 and the ledger at the end of `mut-435-mcp-read-tools.md`.

## 1. Acceptance criteria (ticket)

- **AC1** A call without `destination` fails with a validation error telling the agent to ask the person which one.
- **AC2** Inbox writes reuse POST /v1/inbox rules (ADR-048, ADR-061 idempotency); profile writes reuse `expenses/compose.ts` (MUT-227 date floor, future-date rules, MUT-384 category-first).
- **AC3** Retrying with the same idempotency key creates nothing new.
- **AC4** Receipt uploads go through the existing attachment path, including the MUT-56 scan once it lands.
- **AC5** The portal shows an entry came from Claude (a small marker in the drawer).
- Guardrails: per-profile writability, the lapse gate, Arabic/Hebrew vendor names kept as typed. Out: income writes, edits/deletes.

## 2. Decisions (Basel, 2026-10-26)

- **P1** profiles reachable = owned + co-owned (MUT-435 §2). Writes inherit it: no firm, Malafat-fed or shared-personal profile is writable by an agent.
- **P2 receipts = signed URL, two tools** (`start_receipt_upload` → agent PUTs bytes → `complete_receipt_upload`). Works in Claude Code and any client with HTTP; in a Claude.ai chat Claude records the expense from what it read and tells the person to attach the file in MTB3A. The ticket's single `attach_receipt` becomes these two.
- **P3 marker = `captureSource` column on Expense** (nullable, like InboxEntry/Payment), value `'mcp'`.
- **P4 inbox audit = the row's `captureSource: 'mcp'`**; the audit row comes at filing (`inbox.ts` filing already copies `captureSource` into `expense.created` metadata). Matches POST /v1/inbox today (no audit row).

## 3. Tools

### 3.1 `add_expense`

```ts
{
  destination: { kind: 'inbox' } | { kind: 'profile', profileId: uuid },   // REQUIRED, no default
  amount: string, currency: string, occurredOn: 'YYYY-MM-DD',
  vendor?: string, title?: string, notes?: string,
  categoryId?: uuid, customerId?: uuid, projectId?: uuid,                  // profile only; refused for inbox
  idempotencyKey: string                                                   // REQUIRED, [A-Za-z0-9_\-:.]{8,128}
}
```

- **AC1:** `destination` missing ⇒ Zod error whose message is the instruction: *"destination is required. Ask the person whether this goes to their inbox or to one of their profiles (list_profiles), then call again."* A test asserts that text and that nothing was written.
- Link fields with `destination.kind = 'inbox'` ⇒ validation error ("the inbox holds amount, date and a note; file it to a profile to set a category").
- **Scope:** `write` in `grant.scopes`; otherwise the write tools are **not registered** (a read-only grant's `tools/list` doesn't offer them) — and a direct call answers `isError` `INSUFFICIENT_SCOPE`. Deviation from MUT-434 S3's "403": MCP tool calls are JSON-RPC inside one POST; a per-tool HTTP 403 would fail the whole batch. Recorded in the ADR.

**Profile path** (`mcp/tools/expenses.ts`, mirrors `POST /v1/expenses`, `routes/expenses.ts:171-195`):
1. `agentProfile(ctx, profileId)` (P1, not-found for anything else).
2. Writability (R1/D2): `agentMayWrite('expenses', profileWriterOf(org))` in mcp/context.ts = `mayWriteFor('session', …)`; no matrix change. Always true for expenses today (parity); the store allow-list is the agent's gate.
3. Lapse gate: `agentWriteGate(ctx.gateStore, org, now, ctx.billingGate)` — `gateStore` is a narrow `GateStore` built from the raw store (R8); no `rawStore` on the context.
4. Idempotency claim (§4).
5. `prepareExpenseCreate(store, org.id, user.id, todayFor(org, now), body)` → date floor, ±10y future rule, category choosable, links resolved. MUT-384 "category-first" is a UI rule with no server half (agent report §6); the tool description tells the agent to ask for the category first, nothing more.
6. `withResolvedVendor` → `expenses.create({ ...input, captureSource: 'mcp' }, loggedAt = now)` → `touchExpenseVendor`. Vendor stored **as typed** (no transliteration, no trimming beyond the existing compose rule); test with `كارفور` and `שופרסל`.
7. `audit.append({ action: 'expense.created', actorType: 'USER', actorId: user.id, organizationId, metadata: { currency, occurredOn, captureSource: 'mcp', oauthClientId, grantId } })` in the same flow as the REST route. **No new `AGENT` actor type**: an enum migration buys nothing the metadata doesn't give, and enum additions have bitten prod before (M7 enum hazard). Expense audit rows are already hidden from API keys (`SESSION_ONLY_ENTITY_TYPES`, audit.ts:14; C4), so no redaction work.
8. Result: `{ where: 'profile', profileId, expenseId, amount, currency, occurredOn, category?, vendor?, replayed: boolean }`.

**Inbox path** (`mcp/tools/inbox-write.ts`, mirrors `POST /v1/inbox`, `routes/inbox.ts:97`):
1. Person-level lapse gate: `standingOfPerson` + `standingRefuses(…, 'POST')` — same rule `PERSON_LEVEL_GATE` applies to the session's inbox POST (`billing/gate.ts:73-77`). Extract a tiny `personWriteGate(rawStore, userId, now, enforced)` beside `agentWriteGate` so both doors read one rule.
2. User-scoped idempotency claim (§4).
3. `parseInboxAmount`, `inboxDate`, `assertFilableCurrency` (inbox/compose.ts); `kind: 'EXPENSE'` fixed (no income, ticket scope-out).
4. `note` = vendor / title / notes joined as typed (InboxEntry has only `note`; filing later shows it). `captureSource: 'mcp'`.

### 3.2 `start_receipt_upload` / `complete_receipt_upload` (P2, AC4)

```ts
start_receipt_upload { profileId, target: { kind: 'expense', expenseId } | { kind: 'to_review' },
                       filename, mimeType: 'application/pdf'|'image/jpeg'|'image/png', sizeBytes, idempotencyKey }
  → { receiptId, upload: { url, method: 'PUT', headers, expiresAt } }
complete_receipt_upload { profileId, receiptId } → { receiptId, status, expenseId | null }
```

- **Reuse, don't re-implement:** extract the bodies of `POST /v1/expenses/{id}/receipts` + `…/complete` (`routes/expenses.ts:267, 298`) and `POST /v1/receipts/uploads` + `/complete` (`routes/receipts.ts:93`) into `expenses/receipts-compose.ts` (`startExpenseReceipt`, `completeExpenseReceipt`, `startLibraryReceipt`, `completeLibraryReceipt`), called by both the routes and the tools. Rules come along: `checkFile` (type, 10 MB), `MAX_RECEIPTS_PER_EXPENSE`, pending-upload caps, `verifyUploadedObject` on complete, the audit rows. When MUT-56 lands its scan hooks into these functions, the tools inherit it (AC4 "once it lands"); a TODO comment names MUT-56 there.
- `target.kind = 'to_review'` exists **only when `RECEIPTS_LIBRARY` is on**: the input schema is built from config, so with the flag off the agent never sees the option (and a forced call answers `isError` `NOT_AVAILABLE`).
- No receipts on inbox entries (the inbox holds no files today); the description says "file the expense to a profile first".
- Same gates as `add_expense` (P1 profile, `'agent'` writability on `expenses`, `agentWriteGate`, idempotency on start). `expense_receipt.added` audit carries `captureSource: 'mcp'`.
- Description tells the agent exactly how: "PUT the file bytes to `upload.url` with `upload.headers` (for example `curl -T file -H …`), then call complete_receipt_upload. If you can't make HTTP requests, don't call this; tell the person to attach the file in MTB3A."

## 4. Idempotency (AC3)

`idempotencyKey` is a required argument (MCP has no header per tool call). `mcp/idempotency.ts` → `withToolIdempotency(ctx, { scope: 'profile', organizationId } | { scope: 'person' }, operation, args, run)`:
- Key namespaced `a:<userId>:<key>` (R7: a retry after reconnecting still replays) (sha256'd like `sessionClaimKey`), so an agent key can never collide with a session's or an API key's.
- Fingerprint = canonical JSON of `{ tool, args minus idempotencyKey }`.
- `claim` → `fresh` runs and `complete`s with the result; `replay` returns the stored result with `replayed: true`; fingerprint mismatch ⇒ `isError` `IDEMPOTENCY_KEY_REUSED`; in-flight ⇒ `OPERATION_IN_PROGRESS` (retry later); classification as REST (OV4): 5xx/429 release the key, 4xx (a thrown ApiError mapped to its status) is stored and replayed. The description says: one key per source document (receipt or statement line), never reused for another purchase.
- **DRY:** factor the claim/complete/fail state machine out of `withIdempotency` into a framework-free `runIdempotent(claimStore, { fingerprints, classify }, run)` (fingerprints incl. the legacy byte one; a status classifier); the Hono middlewares and the tool wrapper call it. R4: lands in its own refactor commit before any MCP code, existing suites unchanged and green before and after, plus a boundary contract test (incl. "4xx stored and replayed").
- Allow-list (MUT-435 §3.3) gains: `idempotency.claim/complete/fail` (control), `userIdempotency.claim/complete/fail` (sessionOnly → agent), `expenses.create`, `vendors.*` used by `withResolvedVendor`/`touchExpenseVendor`, `expenseCategories.getById`, `customers.getById`, `projects.getById`, `inboxEntries.create`, `expenseReceipts.*` used by the extracted functions, `audit.append`. Each with a guard test.

## 5. Schema, contract and cross-repo

- **Migration** `…_expense_capture_source`: `ALTER TABLE expenses ADD COLUMN capture_source varchar(20)` — nullable, additive, rolling-deploy safe. Prisma `Expense.captureSource String? @db.VarChar(20)`; memory store + `ExpenseRecord` + `CreateExpenseInput` gain it; the REST create paths set it from `body.captureSource` too (so phone `siri`/`share` expenses get the marker data for free — zero UI for them now).
- **Two enums, so the marker can't be spoofed:** `CaptureSourceSchema` (request input) stays `app|siri|widget|quick_action|share`. New `StoredCaptureSourceSchema` = input + `'mcp'` for the `InboxEntry` and `Expense` outputs only (OV10; Payment output unchanged). Only the MCP path can write `'mcp'`. OpenAPI regenerated, `src/hosted/api/schema.d.ts` regenerated, API `1.7x.0-mut436`.
- **⚠ Phone hazard (found while planning):** the shipped Flutter app decodes inbox `captureSource` with `CaptureSource.fromString`, which **throws** on an unknown value (`mutaba3a/lib/domain/models/transaction_enums.dart:163`, used in `inbox_repository.dart:65`). One `'mcp'` inbox entry would break that person's phone inbox. Plan: a Flutter change in this ticket (call the existing `CaptureSource.tryFromString` at inbox_repository.dart:65, plus `mcp('mcp')` in the enum and an "Added by Claude" label where the source shows), released to the stores. Server config `MCP_INBOX_WRITES` (default off; Terraform var, R3) removes `destination: inbox` from the tool schema while off (OV12; a forced call answers `NOT_AVAILABLE`). Before flipping it, raise the iOS+Android minimum build (MUT-293 `auth/minimum-build.ts`) to the fixed build (R5). Expense output gains a new *field*, which the phone ignores (verify its JSON decode is non-strict on extra keys — test in the Flutter PR).
- **Local mode / records export:** local mode has no agents; `captureSource` on expenses is **not** carried into the local records format (format version unchanged); `hosted-export-parity` test updated to list it as server-only.

## 6. Portal marker (AC5)

`src/hosted/components/ExpenseDrawer.tsx`: when `expense.captureSource === 'mcp'`, a small muted chip under the title: en "Added by Claude", ar "أضافها Claude", he "נוסף על ידי Claude" (i18n keys `expenses.drawer.addedByClaude`; "Claude" stays Latin inside RTL via `<bdi>` per ADR-101). Reuse the existing chip/badge component from COMPONENT_REGISTRY (no new component). Read-only, no action. Nothing in the list rows (ticket asks for the drawer only).

## 7. Tests (TDD, first)

Server unit (memory store, SDK `InMemoryTransport`):
1. AC1: no destination ⇒ exact instruction text, zero rows/audit; inbox + categoryId ⇒ refused.
2. Profile path: happy path writes expense with `captureSource 'mcp'` + audit metadata; date floor (−10y−1d refused), future +10y+1d refused, archived category refused (`assertCategoryChoosable`), foreign/firm profile ⇒ not-found, Malafat-fed ⇒ not-found (P1), lapsed profile ⇒ `SUBSCRIPTION_LAPSED`, read-only grant ⇒ tools absent + forced call `INSUFFICIENT_SCOPE`.
3. Vendor as typed: Arabic and Hebrew round-trip byte-identical; vendor row linked (MUT-254).
4. AC3: same key + same args twice ⇒ one row, second `replayed: true`; same key + different args ⇒ `IDEMPOTENCY_KEY_REUSED`; a throwing create releases the key (second call succeeds); key from grant A doesn't replay for grant B.
5. Inbox path: person-level gate; `kind EXPENSE`; note composition; `MCP_INBOX_WRITES` off ⇒ `NOT_AVAILABLE`.
6. Receipts: start → memory storage PUT → complete ⇒ FILED on expense; wrong mime / 11 MB refused at start; 11th receipt refused; `to_review` absent from schema with flag off, works with it on; complete before PUT ⇒ verify error.
7. `runIdempotent` extraction: existing `idempotency.test.ts` untouched and green.
8. Spoof: REST `POST /v1/expenses` with `captureSource: 'mcp'` ⇒ 422.
Integration: `/mcp` over HTTP with a real `mat_` token for add_expense; `test:db` contract for the new column + create.
Portal: `ExpenseDrawer` test for the chip in en/ar/he; absent for null/`siri`.
Flutter: `CaptureSource.tryFromString('mcp')` and an unknown value → null; inbox list decodes an unknown source.

Commands (through `heavy`, Node 22): `npm --prefix server test -- mcp idempotency expenses receipts`, then server CI set (typecheck, lint, openapi:check, test, test:db) + web `lint/typecheck/test:run/build`; Flutter `flutter test --concurrency=2` on the touched files.

AC → test: AC1 → 1 · AC2 → 2, 5 · AC3 → 4 · AC4 → 6 · AC5 → portal drawer test + release-QA.

## 8. Release-QA

- `qa/features/portal/mcp.yaml` adds `mcp.add-expense` ("Claude files an expense to my business profile and I see 'Added by Claude' in its drawer") and `mcp.receipt-upload`. Spec drives `/mcp` with the QA OAuth helper, then opens the portal Expenses page and the drawer, asserting the chip. `paths`: `server/src/mcp/tools/**`, `server/src/expenses/receipts-compose.ts`, `src/hosted/components/ExpenseDrawer.tsx`.
- Flutter: the inbox flow re-run with a seeded `'mcp'` entry (ios.inbox), no new flow.
- Hand check (owed, with MUT-434's): real Claude Code files a receipt end to end.

## 9. Docs at build

ADR (number at merge): agent writes = same compose path, `captureSource 'mcp'` column + stored-vs-input enum split, no AGENT actor, per-tool scope as a tool error, inbox writes behind `MCP_INBOX_WRITES` until the phone fix ships. CHANGELOG, SYSTEM_OVERVIEW, PATTERNS (`runIdempotent`, receipts-compose), COMPONENT_REGISTRY (none new), TECH_DEBT (inbox has no receipts; Claude.ai chat can't upload files), TEST_PLAN, `docs/operations/before-release.md` (turn on `MCP_INBOX_WRITES` only after the phone release is live).

## 10. Order of work

1. MUT-435 lands first (foundation). 2. `runIdempotent` + receipts-compose extractions (pure refactors, existing tests green). 3. Migration + enums. 4. Tools. 5. Portal chip. 6. Flutter PR (separate repo, same epic worktree rule).

Business / product impact
- This is the moment the epic pays off: Basel hands Claude a receipts folder and the expenses land in the right profile, receipts attached, each one asked about first and safe to retry.
- Unblocks MUT-437 (statement ↔ receipt matching); MUT-438 stays postponed.
- Risk held down: no firm data, no spoofable marker, the lapse gate and date rules unchanged, and the phone crash path is closed before inbox writes switch on.

## 11. Eng review additions (2026-10-26; see the ledger in mut-435-mcp-read-tools.md)

- R6: `fileAsExpense` (routes/inbox.ts:247) and receipt approval (routes/receipts.ts:319) copy `captureSource` onto the new expense's column, so inbox-filed Claude entries keep the drawer chip; test rows on both paths.
- OV1: every tool test runs inside a request context with `agentStoreGuard` set; one `/mcp` HTTP test per tool file proves a non-allow-listed method is refused from inside a tool callback.
- OV6 wiring: `mcpRoutes` options gain `storage`, `urlTtlSeconds`, `receiptsLibrary`, `mcpInboxWrites`, `billingGate`, a narrow `gateStore`; requestId comes from the request; receipts-compose takes a context-free audit writer instead of `audit(c, …)`.
- OV9: AC1 test asserts the result *contains* the instruction; the custom `error` sits on the destination union.
- OV11: `start_receipt_upload` description: each attempt holds a pending row counted in the pending caps; if you can't PUT, don't start one.
- before-release.md: (1) phone release with the tolerant decode live, (2) raise minimum build, (3) flip `MCP_INBOX_WRITES`.
