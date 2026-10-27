# MUT-464 — Seeded expense categories follow the viewer's language (ar/en)

Status: built 2026-10-27 on feature/mut-464-category-language (unmerged). Built from "Approved plan after review" below, which supersedes D2, D5 and the first Files list. ADR-208. Jira MUT-464 (Story, no epic).

## Problem
A hosted profile's preset categories are written once, in one language: the `user.locale` of whoever first calls `GET /v1/expense-categories` (`server/src/routes/expense-categories.ts:60`, `presetFor` in `server/src/expenses/presets.ts`). The same applies to the type-change reseed (`organizations.updateOwned`, `personal-profile.ts`). `ExpenseCategory` keeps a single `name` and has no preset identity, so a co-owner or member in the other language sees the seeder's language for good.

## What reads category names today (blast radius)
- `GET /v1/expense-categories` is the **only** REST read that returns names. Expenses, summaries, groups, vendors and the verdict return `categoryId` only; the portal and the phone resolve id → name from this list.
- MCP `list_categories` / category search (`server/src/mcp/read-tools.ts:193,211`).
- Records export (`server/src/repositories/prisma-records-export.ts:93`).
- "Automatic Other" detection by name: server `src/vendors/keys.ts` (`AUTOMATIC_OTHER_NAME_KEYS`), phone `capture_providers.dart:280` and `vendor_picker_sheet.dart:60`.
- The portal merges categories **by name** across profiles in Reports (ADR-189 / MUT-175). Once names follow the viewer, two profiles seeded in different languages merge correctly.

Neither client sends its UI language to the API, and no route changes `user.locale`, so `user.locale` alone can't follow an in-app language switch.

## Decisions
- **D1. The server resolves the name.** There is one translation table, the en/ar strings already in `presets.ts`. Each request resolves in this order: `Accept-Language` (first `ar` or `en` tag), then `user.locale`. Responses carry `Content-Language` and `Vary: Accept-Language`. `Accept-Language` is CORS-safelisted, so no preflight change is needed. *Rejected:* translating in the clients. It means two more copies of about 40 strings (a TS dictionary plus Flutter ARB), each able to drift, and the MCP tools and export would still need a server copy.
- **D2. `presetKey`.** Add a nullable `presetKey VARCHAR(40)` to `ExpenseCategory`. `CategoryTemplate` gains a stable `key` (`office_rent`, `utilities`, …, `other`). The same concept shares one key across presets, so `other` is one key everywhere. Personal "Rent" (`rent`) and general "Office Rent" (`office_rent`) are separate keys. The lazy seed and the type-change reseed both set it. The stored `name` / `nameKey` stay in the seeder's language, so the unique index is unchanged and old clients keep working.
- **D3. Rename semantics.** A rename clears `presetKey`, **unless** the new name equals either translation of that key. Re-saving an unchanged edit form then doesn't freeze the category in one language. Recolour and archive/restore keep the key.
- **D4. Duplicate guard across languages.** Create or rename returns 409 `CATEGORY_NAME_TAKEN` when the name matches either translation of a keyed category in the profile. Without it, an English user could add "Rent" next to a keyed "الإيجار" and see "Rent" twice. One pure helper, `presetAliasKeys(presetKey)` in `presets.ts`, is used by both stores inside the existing write transaction.
- **D5. Backfill.** Script `server/src/scripts/backfill-category-preset-keys.ts`, following the pattern of `backfill-personal-expense-categories.ts`: `--dry`, idempotent, one read for all. A row with `presetKey IS NULL` whose `nameKey` equals the en or ar key of any template in the union of presets gets that key. It's a union, not the profile's current preset, so a firm's old legal-only list and a hand-made "Rent" get translated too, which is the intent. If a profile has two rows that map to one key (e.g. both "Other" and "أخرى" exist), only the oldest gets the key and the script reports the rest. The operator step goes in `docs/operations/before-release.md`.
- **D6. "Automatic Other" detection.** Check `presetKey === 'other'` first and fall back to the name, because phone builds older than the phone half still send names.
- **D7. API contract (additive).** `ExpenseCategory` gains `presetKey: string | null`, and `name` becomes the resolved name. Bump `API_VERSION` to `1.78.0-mut464` (or the next free number at build time). Update the OpenAPI docs for `GET /v1/expense-categories`: "names of preset categories follow Accept-Language".
- **D8. Other readers.** MCP read tools resolve with `user.locale` (an agent has no UI language). The records export resolves with `user.locale` and leaves the file shape as it is (local mode has no preset concept).
- **D9. Portal.** `src/hosted/api/client.ts` sends `Accept-Language` set to the current UI language, and the expense-categories query key includes the language so a switch refetches. Nothing else changes: every view already resolves ids through that list.
- **D10. Phone half is a separate ticket** (Flutter repo, child of MUT-464 or linked): send `Accept-Language`, refetch and re-cache categories on a language change, add `presetKey` to `Category` and use it for Other. Until it ships, the phone shows names in `user.locale`, which is already right for most people.

## Files
Server
- `prisma/schema.prisma` + migration `2026102xxxxxxx_mut464_category_preset_key`: `presetKey String? @db.VarChar(40)`.
- `src/expenses/presets.ts`: `key` on every template; `resolveCategoryName(record, lang)`; `presetAliasKeys`; `presetFor` returns `presetKey`.
- `src/expenses/names.ts`: unchanged. `src/request-language.ts` (new, small): `requestLanguage(c)` → `'ar' | 'en'`.
- `src/repositories/ports.ts`, `prisma.ts`, `memory.ts`: `presetKey` on `ExpenseCategoryInput`/`Record`; `presetRows`; rename-clears rule (D3); cross-language guard (D4).
- `src/routes/expense-categories.ts`, `src/serializers.ts` (`serializeExpenseCategory(c, lang)`), `src/schemas.ts`, `src/app.ts` (`API_VERSION`).
- `src/vendors/keys.ts`: `isAutomaticOtherCategory({ presetKey, name })`.
- `src/mcp/read-tools.ts`, `src/repositories/prisma-records-export.ts`: resolve the name.
- `src/scripts/backfill-category-preset-keys.ts` + `package.json` script `backfill:category-preset-keys`.

Portal
- `src/hosted/api/client.ts` (header), the expense-categories query in `src/hosted/data/expenseQueries.ts` (language in the key), regenerated `src/hosted/api/schema.d.ts`.

Docs
- ADR-208, CHANGELOG, TEST_PLAN, `docs/operations/before-release.md` (run the backfill after deploy), and a "categories" section in SYSTEM_OVERVIEW.

## Tests (TDD, written first)
- `presets.test.ts`: every template has a unique key; the same key means the same en/ar pair in every preset; `resolveCategoryName` returns en/ar for a keyed row and the stored name for an unkeyed one.
- Store contract (`store-contract-expenses.ts`, memory + Postgres):
  - seed sets `presetKey`; type-change reseed sets it;
  - rename to a new name clears it; rename to the other translation keeps it; recolour/archive keep it;
  - create "Rent" when keyed "الإيجار" exists → `UniqueViolation`.
- Route tests (`expense-categories.test.ts`): `Accept-Language: en` on an ar-seeded profile returns English names; no header → `user.locale`; `fr` → `user.locale`; `Vary` and `Content-Language` are set.
- Vendors: `lastCategoryId` is not set for keyed `other` in either language.
- Backfill (`test:db`): keys en and ar rows; leaves custom names alone; second run touches nothing; the duplicate-pair case keys the oldest only; `--dry` writes nothing.
- MCP read tools: the resolved name follows `user.locale`.
- Portal: a `client.ts` unit test for the header; a query-key test showing that a language switch refetches.
- Commands: `npm --prefix server test`, `npm --prefix server run typecheck`, `lint`, `openapi:check`, `test:db` in CI; root `lint`, `typecheck`, `test:run` (Node 22, through `heavy`).

## QA scenarios (release-qa, `qa/features/portal/expenses.yaml`)
- `categories-follow-language`: sign in as an Arabic account on a profile with seeded categories, switch the portal to English → the expense category picker and list show English names.
- `renamed-category-keeps-name`: rename a seeded category, switch the language → the renamed category shows the typed name in both.

## Cost / scale
No extra queries: the name is resolved in memory from a constant table. One nullable column; no index needed (`presetKey` is never queried except by the backfill). The backfill is one `findMany` plus batched updates per org.

## Out of scope
Hebrew (MUT-296; with a third column in `presets.ts`, it becomes a one-file change), translating user-typed names, Dexie/local app (MUT-445 retires it), the phone half (D10, separate ticket).

---

# Eng review (/plan-eng-review, 2026-10-27)
Target: this plan (`.claude/designs/mut-464-category-names-follow-language.md`), MUT-464. Report file: this file. Original plan: everything above this line, unchanged.

## Scope Challenge findings
1. [CRITICAL] (confidence: 9/10) `src/hosted/local/index.ts:47` — `const store = new MemoryLedgerStore();` Portal local mode runs the server routes in the browser on `MemoryLedgerStore`, persisted to IndexedDB with snapshot migrations keyed off `CURRENT_STORE_SNAPSHOT_VERSION = 7` (`server/src/repositories/memory.ts:199`, `src/hosted/local/migrations/index.ts`). The plan's backfill script (D5) never reaches a browser, so every existing local profile keeps unkeyed categories. Needs a 7 → 8 snapshot migration using the same matcher as the server backfill.
2. [CRITICAL] (confidence: 8/10) `src/hosted/local/carryOver/replay.ts:146` — `const found = existing.get(op.name.toLocaleLowerCase());` Carry-over matches a backup's category against the server list by the name the GET returns. Once that name is resolved per language, a backup "Office Rent" no longer matches a keyed "إيجار المكتب". It POSTs, D4 answers 409, and `created()` (`replay.ts:111-114`) counts it as refused and returns null, so that category's expenses carry over uncategorized.
3. [INFORMATIONAL] (confidence: 8/10) `server/src/app.ts:283` — `c.header('Cache-Control', 'no-store');` API responses are never cached, so D1's `Vary: Accept-Language` costs nothing and stays as a guard. No change.

Complexity: about 19 changed files plus 2 new modules (`request-language.ts`, backfill script) [estimated from the plan's Files list], so the complexity gate trips.

REALITY: premise-table pass unverified=0; seed/locale/single-name claims receipted at presets.ts:107, expense-categories.ts:60, schema.prisma:1231
REALITY: already-done pass; git log on presets.ts/expense-categories.ts shows no later work on languages (latest ac9c6be6)
REALITY: surface-check pass; GET/POST/PATCH /v1/expense-categories verified at expense-categories.ts:45-110; Accept-Language not read anywhere today (grep, none)
REALITY: binding-decisions pass; ADR MAL-1118 "seeds once per type" (DECISIONS.md:2856) kept, as D2 changes neither when nor what is seeded
REALITY: numbers pass; ~19 files [estimated], snapshot version 7 [measured: memory.ts:199]
REALITY: deferred-asks finding; MUT-464 AC "on the phone" moves to a separate phone ticket (D10), listed as deferred .claude/designs/mut-464-category-names-follow-language.md:27
REALITY: pr-count pass; one branch, one merge to local main, no remote PRs (CLAUDE.md never-push rule) CLAUDE.md:1

## Scope record
feature answers: none asked (no cuts proposed); structure: B Smaller arrangement (D1, answered 2026-10-27); accepted scope: the plan's D1–D10 with `requestLanguage(c)` in `server/src/routes/shared.ts` instead of a new `request-language.ts`; pending remedies: R1, R2.

## Decision ledger

### R1: Local-mode profiles get preset keys
Finding: 1, CRITICAL, 9/10, src/hosted/local/index.ts:47, reviewer claude
Plan baseline: original proposal: server backfill script only (D5); local mode not mentioned
Runtime evidence: local mode uses MemoryLedgerStore persisted as snapshot v7 (memory.ts:199) with migrations in src/hosted/local/migrations/index.ts; no presetKey anywhere today
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R1 local keys | none | snapshot migration 7→8 sets presetKey with the same `presetKeyForName` matcher the server backfill uses (one matcher, two callers) | nothing: local profiles stay in the seeder's language; new local seeds get keys |
| R2 carry-over match | pending | pending | pending |
Question D2:
D2 — How do existing local-mode profiles get preset keys?
Project/branch/task: MUT-464 plan on main, planning only.
ELI10: Signed-out portal users keep their books in the browser, using the same server code with an in-memory store saved to IndexedDB. The server backfill script never runs there. Without a browser-side step, those people's existing categories stay in one language even after they switch.
Stakes if we pick wrong: local-mode users who switch language keep seeing the old one, and the server and local mode behave differently for the same data.
Recommendation: A, because the local store already has a versioned migration chain built for exactly this, and sharing one matcher with the server backfill keeps both sides identical.
Completeness: A=10/10, B=6/10
Header: Local keys
Options:
A) Snapshot migration (recommended)
Bump CURRENT_STORE_SNAPSHOT_VERSION 7→8; a migration keys existing categories via a shared presetKeyForName in presets.ts, also used by the server backfill. Tests: migration unit test, plus a backfill test on the same matcher. Human ~half day / CC ~20 min.
B) Leave local unkeyed
Only new local seeds get keys; existing local profiles stay in the seeder's language. No migration. Human ~0 / CC ~0. Local and hosted behave differently.

State: approved
Actual answer: A) Snapshot migration (D2, answered 2026-10-27)
Accepted scope: bump CURRENT_STORE_SNAPSHOT_VERSION 7→8; local migration keys existing categories with a shared `presetKeyForName` in `server/src/expenses/presets.ts`, also used by the server backfill; migration unit test plus backfill test on the same matcher
History: none

### R2: Carry-over still finds a keyed category named in the other language
Finding: 2, CRITICAL, 8/10, src/hosted/local/carryOver/replay.ts:146, reviewer claude
Plan baseline: original proposal: D4 returns 409 CATEGORY_NAME_TAKEN on a cross-language clash; carry-over not mentioned
Runtime evidence: replay matches by lower-cased GET name (replay.ts:146,206); `created()` turns a 409 into a counted refusal and returns null (replay.ts:111-114)
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R1 local keys | approved: snapshot migration (D2) | unchanged | unchanged |
| R2 carry-over match | name match only | the 409 CATEGORY_NAME_TAKEN body carries `details.categoryId` of the clashing category; replay treats that 409 as found and uses the id; tests on the route and on replay | nothing: such categories are refused and their expenses carry over uncategorized |
Question D3:
D3 — How does carry-over find a category that exists under its other-language name?
Project/branch/task: MUT-464 plan on main, planning only.
ELI10: When someone moves a free-app backup into their hosted books, the portal matches each backup category to an existing one by name. After this change, the server shows names in the viewer's language, so a backup "Office Rent" won't match "إيجار المكتب" and the new duplicate guard refuses to create it. Those expenses would land with no category.
Stakes if we pick wrong: carried-over expenses silently lose their category, and the person has to re-file them by hand.
Recommendation: A, because the server already knows which category clashed, and passing its id back is one field plus one branch in replay.
Completeness: A=10/10, B=4/10
Header: Carry-over
Options:
A) Clash returns the id (recommended)
409 CATEGORY_NAME_TAKEN adds details.categoryId; replay.ts treats that 409 as found and reuses the id. Additive to the error body. Tests: a route test for the details, and a replay test with an other-language backup. Human ~2h / CC ~10 min.
B) Leave carry-over as is
Cross-language categories are refused during carry-over and their expenses arrive uncategorized. No code. Human ~0 / CC ~0.

State: approved
Actual answer: A) Clash returns the id (D3, answered 2026-10-27)
Accepted scope: 409 CATEGORY_NAME_TAKEN adds `details.categoryId` (additive); `replay.ts` treats that 409 as found and reuses the id; a route test for the details and a replay test with an other-language backup
History: none

Scope Challenge result: scope accepted as-is (D1 picked a smaller arrangement with the same scope).

## 1. Architecture review
No new issues beyond findings 1 and 2. The rest was checked against the code:
- **One read path.** Expenses, summaries, groups, vendors and the verdict return only `categoryId` (`server/src/serializers.ts:563,581`), so resolving the name in `serializeExpenseCategory` (`serializers.ts:606`) plus MCP and the export covers every reader. The portal and the phone need no display changes.
- **Old phone builds.** A recolour that re-sends the unchanged resolved name keeps the key (D3), so an old build can't freeze a category in one language by accident.
- **Security.** `Accept-Language` is read only as `ar` or `en`, and anything else falls back to `user.locale`. Bounded input, no new data exposure.
- **Production failure.** If the backfill hasn't run yet, rows stay unkeyed and show their stored name, which is exactly today's behavior. A failed local migration follows the existing migration chain's failure handling (`src/hosted/local/migrations/index.ts`).

```
GET /v1/expense-categories (portal / phone / local backend)
  │  Accept-Language: ar|en ──► requestLanguage(c) (routes/shared.ts) ──► else user.locale
  ▼
lazy seed if empty ──► presetFor(...) rows carry presetKey (seeder's language in name/nameKey)
  ▼
list ──► serializeExpenseCategory(c, lang):
           presetKey? ──yes──► PRESET_NAMES[presetKey][lang]
                     └─no───► c.name (as typed)
POST / PATCH name ──► clash with the name or either translation of a keyed row? ──► 409 CATEGORY_NAME_TAKEN {categoryId}
PATCH name ──► new name is one of presetKey's translations? keep key : clear key
```

Dispositions: findings 1 and 2 approved (D2, D3); finding 3 no change.

## 2. Code quality review
No issues found.
- `presetKeyForName(name)` has two real callers: the server backfill and the local 7→8 migration (D2). That's genuine sharing: one matcher, so both sides key the same rows.
- `isAutomaticOtherCategory` (`server/src/vendors/keys.ts:14`) moves to `{ presetKey, name }` with the name fallback kept. Its callers are `prisma.ts:2064` and `memory.ts:2341`.
- The cross-language guard has no race worth handling. Keyed rows appear only through the seed, which holds the organization row and runs only on an empty profile, or through a rename that keeps a translation.

Dispositions: none needed.

## 3. Test review
Framework: Vitest (server `npm --prefix server test`, Postgres `test:db`; root `npm run test:run`), per CLAUDE.md Phase 4.

```
CODE PATHS                                                     USER FLOWS
[+] server/src/expenses/presets.ts                             [+] Viewer language
  ├── template keys unique, same key = same en/ar   [GAP]        ├── [GAP] [→E2E] ar-seeded profile, portal in English → English names
  ├── resolveCategoryName keyed / unkeyed           [GAP]        └── [GAP] [→E2E] rename seeded category, switch language → typed name kept
  └── presetKeyForName en / ar / custom / none      [GAP]      [+] Carry-over
[+] routes/shared.ts requestLanguage                             └── [GAP] other-language backup category maps onto keyed one (replay test)
  ├── ar / en / "en-GB,en;q=0.9" / fr / absent      [GAP]      [+] Local mode
[+] routes/expense-categories.ts                                 └── [GAP] v7 snapshot opens, categories keyed (migration test)
  ├── GET resolves per header, Vary + Content-Language [GAP]
  ├── existing seed tests                           [★★ TESTED] expense-categories tests
  ├── POST alias clash → 409 + details.categoryId   [GAP]
  └── PATCH rename clears / keeps key               [GAP]
[+] stores (memory + prisma, store-contract-expenses.ts)
  ├── seed + type-change reseed set presetKey       [GAP]
  └── alias guard UniqueViolation                   [GAP]
[+] vendors/keys.ts isAutomaticOther by key         [GAP] extend store-contract-vendors.ts
[+] mcp/read-tools.ts resolved names                [GAP] extend MCP read-tool tests
[+] records export resolved name                    [GAP] extend records-export parity test
[+] backfill script (test:db)                       [GAP]
[+] portal client.ts Accept-Language; query key     [GAP]
[+] replay.ts 409 → found                           [GAP]
[+] local migration 7→8                             [GAP]

COVERAGE: 1/19 paths tested (5%) | all new code; every gap is in the plan's or the approved tests
QUALITY: ★★:1 | GAPS: 18 (2 E2E via release-qa)
```
Regression contract (carried from MUT-464's AC, no new approval needed): an unkeyed category and a custom name return exactly as stored, in every language. Existing `expense-categories` and `store-contract-expenses` tests must pass unchanged, except where they assert the seeder's language on a keyed row read in another language.
Tests made obsolete: none.

Dispositions: test requirements accepted as part of the approved scope (plan Tests, plus D2 and D3 tests).

## 4. Performance review
No issues found. The name is resolved in memory from a constant table, with no extra queries per request. The backfill does one `findMany` over profiles that have categories, at roughly 16 rows per profile [estimated]; at pilot scale (tens of profiles) that's trivial, and it runs once. The local migration touches only one device's snapshot.

## Outside voice (Claude subagent, native fallback; Codex not installed)
OUTSIDE VOICE (Claude subagent): completed in 213 s within the 5-minute timer. 13 findings: 1 Critical, 3 High, 5 Medium, 4 Low. Verified by the parent:
- OV1 (Critical) the stored presetKey can be derived at read time with `presetKeyForName(c.name)`, which removes the column, backfill, local migration and export coupling. Reopens D2/R1 and R2/D3.
- OV2 (High) verified: `git show ac9c6be6` removes 11 legal-list names that no current preset contains, so a union matcher misses every firm seeded before 2026-10-22. MAL-1137 "Projects" has the same gap.
- OV3 (High) record export: the format version moves to 8 while the export omits presetKey (stored-key design only).
- OV4 (High) verified: `src/hosted/data/reportQueries.ts:126` is a second expense-categories query that D9 missed. Necessary implementation of the approved behavior, so it is carried into scope without a question: language goes into both query keys.
- OV5 (Medium) existing cross-language duplicate pairs (from carry-over) would read as two identical rows.
- OV6/OV7/OV8 (Medium) D4 create/backfill inconsistency, the 409 id having no Prisma path, and `presetAliasKeys` pointing the wrong way. All dissolve under OV1.
- OV9 (Medium) browsers send Accept-Language on their own. The portal's `send()` sets it explicitly for every API call, and both category queries go through `api` (`client.ts:397`), so no change. Noted.
- OV10 (Low) factual correction: only `list_categories` (`mcp/read-tools.ts:193`) needs changing; line 211 is list_vendors.
- OV11/OV12 (Low) idempotent replay caches the first language; the old phone's 409 UX. Notes for the phone ticket.
- OV13 (Low) "معاشات": regional usage for salaries; not changed here.

### R3: Stored preset key vs derived at read time
Finding: OV1, Critical, 8/10, server/src/serializers.ts:606 + approved D2/D3, reviewer outside voice (Claude subagent)
Plan baseline: approved: stored `presetKey` column (plan D2), server backfill (D5), local snapshot migration 7→8 (R1/D2 answer), 409 carries categoryId for carry-over (R2/D3 answer)
Runtime evidence: categories store only `name`/`nameKey` (schema.prisma:1231); the portal's local backend imports server code (src/hosted/local/index.ts:2), so replay.ts can call presetKeyForName in-page
Comparison grid:
| Choice | Current | A Apply | B Keep | C Investigate | D Defer |
|---|---|---|---|---|---|
| Key source | stored column (approved) | derived: `presetKeyForName(stored name)` at read; when two rows in a profile map to one key, only the oldest is translated | stored column | unchanged until a 1-hour spike compares both on real prod category data | proposal left open; stored design stands for now |
| Column + backfill + local migration | approved | dropped | kept | unchanged | kept |
| Carry-over match | 409 carries id (approved) | replay matches by derived key in-page; no 409 change | 409 carries id | unchanged | 409 carries id |
| Rename rule | clear/keep key (plan D3) | none needed: a translation stays translated, anything else as typed | kept | unchanged | kept |
| Retired-template aliases (R4) | pending | pending | pending | pending | pending |
Question D4:
D4 — Store a preset key on each category, or work it out from the name when reading?
Project/branch/task: MUT-464 plan on main, planning only.
ELI10: To translate a seeded category we need to know which preset it came from. The plan stores that as a new column, so it needs a database backfill, a browser-storage migration for local mode and a carry-over fix. The outside reviewer points out that the server can instead recognise any stored name that matches a preset name, in either language, every time it reads. The data stays as it is, and none of those migrations are needed.
Stakes if we pick wrong: the stored design ships three migration paths that can drift apart. The derived design can't let a person keep a preset name untranslated on purpose, because any name that matches a preset is translated.
Recommendation: A, because it gives the same visible behavior with about 8 changed files instead of about 19, no data changes and nothing to roll back, and the one behavior it adds (a hand-typed "Rent" gets translated) is one the plan already wanted.
Note: options differ in kind, not coverage — no completeness score.
Header: Key source
Options:
A) Derive at read (recommended)
Drop the column, backfill, local migration and 409 id. The server resolves via presetKeyForName on the stored name; duplicate pairs translate only the oldest row; create/rename refuse a name whose key a row already has; replay matches by derived key. Human ~1 day / CC ~1h, fewer files.
B) Keep stored key
Keep the approved design: presetKey column, server backfill, local 7→8 migration, 409 carries categoryId. Also needs OV3's export fix and OV6–OV8's corrections. Human ~2 days / CC ~2h.
C) Spike first
One-hour spike: count prod and local category names that match presets in both languages and duplicate pairs, then choose. Nothing is built until then; R1/R2 answers stay as they are.
D) Defer this change
Leave OV1 unresolved for now; build nothing on the key source until it is decided. The other approved choices stay.

State: approved
Actual answer: A) Derive at read (D4, answered 2026-10-27)
Accepted scope: no presetKey column, no server backfill, no local snapshot migration, no 409 categoryId. `presetKeyForName(name)` in presets.ts maps a stored name (either language) to a preset key; serializers, MCP `list_categories` and the export resolve through it (the export keeps stored names as they are, no format change); when two rows in one profile map to one key, only the oldest is translated; create and rename refuse (409 CATEGORY_NAME_TAKEN) a name whose key another row in the profile already has; replay.ts matches backup categories by derived key in-page; the serialized category exposes the derived `presetKey`; tests for each.
History: supersedes R1 (D2 snapshot migration) and R2 (D3 409 categoryId); both answers kept above for the record, now void.

### R4: Retired preset names still resolve
Finding: OV2, High, 9/10, `git show ac9c6be6 -- server/src/expenses/presets.ts` (11 removed legal-list names), reviewer outside voice (verified by parent)
Plan baseline: D4 answer: matcher over current presets only
Runtime evidence: firms seeded before 2026-10-22 hold the old legal-only names; personal profiles may hold "Projects"/"المشاريع" (MAL-1137)
Comparison grid:
| Choice | Current | A Apply | B Keep | C Investigate | D Defer |
|---|---|---|---|---|---|
| Retired names | not matched | a `RETIRED_TEMPLATES` list (old legal list + Projects) used only for resolving, never seeded; presets.test pins name→key one-to-one across live+retired | not matched: those firms' old categories stay in the seeder's language | unchanged until a prod count of firms with old names | open |
| Key source | approved derived (D4) | unchanged | unchanged | unchanged | unchanged |
Question D5:
D5 — Translate categories from preset lists we've since retired?
Project/branch/task: MUT-464 plan on main, planning only.
ELI10: Malafat firms set up before 22 October got an older legal-only category list, and some personal profiles still have "Projects". Those names aren't in today's presets, so the new matcher wouldn't recognise them and they'd stay in one language. Keeping a list of retired names for recognising only (never for seeding new profiles) fixes it.
Stakes if we pick wrong: the firms that are Malafat's earliest customers see half-translated category lists.
Recommendation: A, because it's one constant list plus a test, and the earliest firms are exactly who'd notice.
Note: options differ in kind, not coverage — no completeness score.
Header: Retired names
Options:
A) Add retired names (recommended)
RETIRED_TEMPLATES (11 old legal names + Projects, en/ar) used by presetKeyForName only, never seeded; presets.test asserts no name maps to two keys across live and retired. Human ~1h / CC ~5 min.
B) Current presets only
Retired names stay untranslated; firms seeded before 2026-10-22 see mixed languages. No code.
C) Count first
Count prod profiles holding retired names before deciding; build nothing for retired names until then.
D) Defer this change
Leave retired names open; build the rest.

State: approved
Actual answer: A) Add retired names (D5, answered 2026-10-27)
Accepted scope: `RETIRED_TEMPLATES` (the 11 legal-list names removed in ac9c6be6 plus MAL-1137's Projects, en/ar) used by `presetKeyForName` only, never seeded; presets.test asserts no name maps to two keys across live and retired templates
History: none

Approval readiness: PASS. Checked: D1 structure (answer D1), R1 (D2, superseded by R3), R2 (D3, superseded by R3), R3 (D4), R4 (D5); OV4 reportQueries key carried as necessary implementation of the approved behavior; regression contract carried from MUT-464 AC.

## Approved plan after review (supersedes D2, D5 and the Files list above where they differ)
- **Key source (D4).** Nothing is stored. `presetKeyForName(name)` in `server/src/expenses/presets.ts` maps a stored name to a key: `categoryNameKey` against the en and ar names of every live template plus `RETIRED_TEMPLATES` (D5). Seeding is unchanged.
- **Display.** `displayCategoryNames(rows, lang)`: a row whose derived key is not held by an older row in the same profile shows the template's name in `lang`. Every other row shows its stored name. The serialized `ExpenseCategory` gains `presetKey: string | null` (derived). API is additive, bump `API_VERSION`.
- **Language.** `requestLanguage(c)` in `server/src/routes/shared.ts`: `Accept-Language` (`ar`/`en`), then `user.locale`. `Vary` and `Content-Language` on the list response.
- **Guard.** Create or rename returns 409 `CATEGORY_NAME_TAKEN` when the new name's derived key is held by another row in the profile. This lives in both stores, inside the existing write path, next to the `nameKey` unique check.
- **Automatic Other.** `isAutomaticOtherCategory(name)` becomes `presetKeyForName(name) === 'other'`.
- **MCP** `list_categories` (`read-tools.ts:193`) resolves with `user.locale`. The **records export** stays as it is (stored names, no format change).
- **Portal.** `send()` sets `Accept-Language` to the UI language. Both category queries (`expenseQueries.ts`, `reportQueries.ts:126`) key on the language. `replay.ts` matches a backup category by derived key, then by name.
- **Phone.** Separate Flutter ticket (D10).

## NOT in scope
- Phone display and refetch on a language switch: a separate Flutter ticket (D10). Until then the phone shows `user.locale` names.
- Merging existing cross-language duplicate pairs (OV5): with the oldest-wins display, the second row keeps its own name, so nothing is lost or hidden. Merging means moving expenses, which belongs in its own decision.
- Hebrew (MUT-296): adding it later means adding a third name per template.
- The local `/app` Dexie categories (MUT-445 retires it).
- Fixing the "معاشات" wording (OV13): regional usage. With the derived key it can be renamed later by moving the old string to the retired list.

## What already exists
- `categoryNameKey` (`server/src/expenses/names.ts:6`): reused as the matcher's normaliser.
- The en/ar template strings (`presets.ts`): reused as the only translation table. No client copy.
- `MemoryLedgerStore` in local mode (`src/hosted/local/index.ts:47`) runs the same routes, so local mode gets the behavior with no extra code.
- `nameTaken()` (`routes/expense-categories.ts:118`): reused for the new 409.
- `presetKeyForName` has three callers: serializer/MCP, the store guard and `replay.ts`. It's a shared pure function, not an abstraction.

## Failure modes
| Path | Realistic failure | Covered by | User sees |
|---|---|---|---|
| derive key | a template string edit stops matching stored rows | presets.test: every name renamed away goes into RETIRED_TEMPLATES (pinned list) | stored name, not silent data loss |
| language header | client sends no header | falls back to `user.locale`; route test | account language |
| guard | user types the other-language name of an existing category | 409 test | "already have this category" |
| duplicate pair | two rows map to one key | oldest-wins test | the second keeps its own name |
| carry-over | backup category in the other language | replay test | category kept |
Critical gaps: 0.

## Worktree parallelization strategy
Sequential implementation, no parallelization opportunity. The server contract has to land before the portal changes, and both are small.

## Implementation Tasks
- [ ] **T1 (P1, human: ~3h / CC: ~20min)** — server/expenses — keys, `RETIRED_TEMPLATES`, `presetKeyForName`, `displayCategoryNames`
  - Surfaced by: Outside voice OV1/OV2 (D4, D5)
  - Files: server/src/expenses/presets.ts, presets.test.ts
  - Verify: `npm --prefix server test -- presets`
- [ ] **T2 (P1, human: ~3h / CC: ~20min)** — server/routes — `requestLanguage`, resolved list, Vary/Content-Language, `presetKey` field, API_VERSION
  - Surfaced by: plan D1/D7, D1 structure answer
  - Files: server/src/routes/shared.ts, routes/expense-categories.ts, serializers.ts, schemas.ts, app.ts
  - Verify: `npm --prefix server test -- expense-categories` + `openapi:check`
- [ ] **T3 (P1, human: ~2h / CC: ~15min)** — server/repositories — cross-language guard in both stores
  - Surfaced by: plan D4 as reshaped by D4 answer
  - Files: server/src/repositories/{prisma,memory,ports}.ts, __tests__/store-contract-expenses.ts
  - Verify: `npm --prefix server test` + CI `test:db`
- [ ] **T4 (P2, human: ~1h / CC: ~10min)** — server — automatic Other by key; MCP list_categories resolves
  - Surfaced by: plan D6/D8, OV10
  - Files: server/src/vendors/keys.ts, mcp/read-tools.ts + their tests
  - Verify: `npm --prefix server test -- vendors mcp`
- [ ] **T5 (P1, human: ~2h / CC: ~15min)** — portal — Accept-Language header; language in both category query keys
  - Surfaced by: plan D9, OV4
  - Files: src/hosted/api/client.ts, data/expenseQueries.ts, data/reportQueries.ts, api/schema.d.ts
  - Verify: `npm run test:run -- src/hosted` (Node 22, via heavy)
- [ ] **T6 (P1, human: ~2h / CC: ~10min)** — portal carry-over — match by derived key
  - Surfaced by: Scope finding 2 (D3, reshaped by D4)
  - Files: src/hosted/local/carryOver/replay.ts + test
  - Verify: replay test with an other-language backup
- [ ] **T7 (P2, human: ~2h / CC: ~20min)** — release-qa — two portal scenarios
  - Surfaced by: plan QA scenarios
  - Files: qa/features/portal/expenses.yaml, qa/specs/portal/expenses.spec.ts
  - Verify: `release-qa run --attach --only categories-follow-language,renamed-category-keeps-name`
- [ ] **T8 (P2, human: ~30min / CC: ~5min)** — Jira — file the phone ticket (D10), carrying OV11/OV12 notes
  - Surfaced by: deferred-asks reality row
  - Verify: ticket linked to MUT-464

## Unresolved decisions
None.

## Completion summary
- Step 0: Scope Challenge: scope accepted as-is
- Reality rows: 7/7 applicable rows emitted (PLAN_REALITY complete), 0 unverified premises
- Architecture Review: 0 new issues (scope findings 1 and 2 handled in Scope Challenge)
- Code Quality Review: 0 issues found
- Test Review: diagram produced, 18 gaps identified (all new-code tests in scope)
- Performance Review: 0 issues found
- NOT in scope: written
- What already exists: written
- TODOS.md updates: 0 items proposed (the phone follow-up is a Jira ticket, T8)
- Failure modes: 0 critical gaps flagged
- Unresolved decisions: 0 in this review
- Outside voice: Claude subagent (native fallback; Codex not installed), completed, 13 findings; D4 and D5 adopted from it
- Parallelization: 1 lane, 0 parallel / 1 sequential
- Lake Score: 2/2 (D2, D3 picked 10/10 options; D1, D4, D5 differ in kind)

## Suppressed findings
- None below confidence 5.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Outside Review | in-host Claude subagent (Codex not installed) | Independent 2nd opinion | 1 | unavailable (native fallback completed) | 13 findings, D4 + D5 adopted |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | issues_open | 18 issues, 0 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | — |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **OUTSIDE COVERAGE:** codex, plan-review, unavailable (not installed); in-host Claude subagent completed, 13 findings.
- **VERDICT:** no review CLEAR; eng review required. ISSUES OPEN means the 18 planned test gaps are mapped work, not defects.

NO UNRESOLVED DECISIONS
