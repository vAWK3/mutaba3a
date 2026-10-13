# MUT-47 — Reconcile the documented data layer with the real one

Ticket: https://barmajiyat.atlassian.net/browse/MUT-47 (Task, Backlog, no blockers; relates to MUT-35, Done)
TODOS.md item 2.

## Reality check (2026-10-13, main a48f72d)

The ticket was written 2026-10-10. Re-verified against today's code:

| Ticket claim | Today |
|---|---|
| CLAUDE.md Phase 4 lists `npm run test:integration` | Still true (`CLAUDE.md:306`). No such script. |
| — | Also: Phase 4 lists `npm run test`, which is `vitest` (watch mode), so it never exits in a terminal. The real one-shot command is `test:run`. |
| — | Also: the Phase 4 ` ```bash ` fence is never closed, so the rest of CLAUDE.md renders as code. |
| `IRepositoryProvider` covers 21 (TODOS: 20) slots | **18** slots now (MUT-58/73/145 deleted some). |
| `planRepo`, `planAssumptionRepo`, `planScenarioRepo` outside the seam | Still true. Sole consumer outside `src/db`: `src/hooks/usePlanQueries.ts` (23 call sites). Planning is a **live optional area** behind `requireFeature('planning')` (ADR-032), not dead code. |
| `scheduleGenerator`, `retainerMatching` not repositories | Still true. `useRetainerQueries.ts:10` already has a one-line "Not repositories" comment at the call site; `interfaces.ts` / `provider.ts` say nothing. Same file also exports `markProjectedIncomeMissed`, `getRetainerSummary` (functions, not objects; same treatment). |
| `moneyEventRepo`, `engagementRepo` out of scope | Both already deleted. Nothing to do. |

## Decisions

**D1 — Phase 4 list: fix the docs, don't invent a script.** Integration tests here are Dexie/fake-indexeddb and hook tests mixed into `__tests__/` beside unit tests; there is no separate tier to split out, and the pyramid in TEST_PLAN.md is a ratio, not a command. A `test:integration` alias pointing at the same suite would make a check that checks nothing new — the exact failure mode this ticket is about. New list (matches what every design brief since MUT-102 already runs):

```bash
npm run lint
npm run typecheck
npm run test:run
npm run build
```

Plus one line: run under Node 22 (TD-054 — Node 25+ breaks every localStorage test), and changes under `server/` also run `npm --prefix server test`.
Rejected: adding `test:integration` as an alias (fake check); a vitest project split by glob (no clean boundary, high churn for zero signal).

**D2 — Plan repositories join the seam.** Give `planRepo`, `planAssumptionRepo`, `planScenarioRepo` interfaces and provider slots (`plans`, `planAssumptions`, `planScenarios`), and route `usePlanQueries.ts` through `getRepositories()`.
Why: ADR-002 says data access goes through the seam; every other optional area (retainers, expenses, recurring, vendors) is already inside it. Planning being outside has no reason except "nobody did it" — and the ticket says silence is not acceptable. A note saying "outside because nobody did it" is worse than doing it; the cost is one file of call sites.
Rejected: a note-only exception (it would document an accident as a decision).

**D3 — Helpers stay outside, with a written reason.** `scheduleGenerator`, `retainerMatching` (and the two loose functions `markProjectedIncomeMissed`, `getRetainerSummary`) are cross-repository operations composed *from* repositories, not storage contracts. Slotting them would make a future SQLite implementation re-implement business logic. Document it once in `interfaces.ts` (a short "Outside the seam" block above `IRepositoryProvider`) and point `provider.ts`'s header at it.

## Implementation (files)

1. **`CLAUDE.md`** — Phase 4 block: replace the five commands per D1, close the fence, add the Node 22 / server line. Nothing else in CLAUDE.md changes.
2. **`src/db/interfaces.ts`**
   - Import `Plan, PlanAssumption, PlanScenario, PlanFilters, AssumptionCategory` from `../types`.
   - `IPlanRepository` — `list, get, create, update, archive, duplicate, activate` (signatures copied from `planRepository.ts`; `create`'s param type mirrors the repo's exactly, not `BaseRepository`, since the repo has no `delete`/`list(scope)` shape to match).
   - `IPlanAssumptionRepository` — `getByPlan, getByPlanAndCategory, getForScenario, get, create, update, delete, deleteByPlan, getCategorySummary`.
   - `IPlanScenarioRepository` — `getByPlan, getDefault, get, create, update, delete, setDefault, createDefaultScenarios`.
   - Add `plans`, `planAssumptions`, `planScenarios` to `IRepositoryProvider`.
   - "Outside the seam" doc block per D3.
3. **`src/db/provider.ts`** — import the three repos from `./planRepository`, add the three slots to `dexieBase` (the existing `satisfies IRepositoryProvider` is the conformance check), update the header comment's file list.
4. **`src/hooks/usePlanQueries.ts`** — drop the direct `../db/planRepository` import; every call becomes `getRepositories().base.plans|planAssumptions|planScenarios.<method>`, matching `useRetainerQueries.ts`. Resolve inside each `queryFn`/`mutationFn`, never at module scope (test overrides must win).
   - `getCategorySummary` uses `this.getByPlan` internally — still bound correctly when called as `repos.base.planAssumptions.getCategorySummary(...)`. Covered by a test (below).
5. **`src/hooks/__tests__/usePlanQueries.test.tsx`** — switch the mock from `vi.mock('../../db/planRepository')` to `vi.mock('../../db', () => ({ getRepositories: () => ({ base }) }))`, same as `useRetainerQueries.test.tsx`. Update the comment that says the hooks sit outside the seam.
6. **`TODOS.md`** — delete item 2; keep the numbering note at the top accurate ("item 2 resolved by MUT-47").
7. **Knowledge files** — CHANGELOG (entry), DECISIONS (ADR: "Helpers composed from repositories stay outside the provider; every storage object is in it" — small, records D2+D3), PATTERNS (seam entry: list the outside-the-seam exceptions), TEST_PLAN (provider + plan-hook rows), SYSTEM_OVERVIEW only if it cites the slot count.
   - **TD-013 (`TECH_DEBT.md:951`)** is itself a drifted claim: "covers 21 repositories" (now 21 after this ticket: 18 + 3 — recount at build time, don't trust this note) and its "Repository Interfaces Created" list still names `IDocumentRepository`/`IDocumentSequenceRepository`, deleted by MUT-145. Rewrite the "Outside the seam" paragraph to the D3 helpers only, and regenerate the interface list from `interfaces.ts`. The "every declared slot has a real caller" rule holds: `usePlanQueries` reads all three new slots.

No schema change, no migration, no i18n strings, no UI change, no runtime behaviour change.

## Tests (TDD — red first)

| AC | Test | File |
|---|---|---|
| AC2/AC3 seam covers plans | `getRepositories().base.plans/planAssumptions/planScenarios` are `planRepo`/`planAssumptionRepo`/`planScenarioRepo` (red until slotted) | `src/db/__tests__/provider.test.ts` |
| AC2 conformance | existing `satisfies IRepositoryProvider` + "fills every declared slot" test; `npm run typecheck` fails if a method is renamed | provider.ts / provider.test.ts |
| AC3 hooks resolve through provider | existing 4 `describe.each` lookups re-pointed at `vi.mock('../../db')` (red until the hook switches — the old module mock stops intercepting) | `usePlanQueries.test.tsx` |
| AC3 override wins | one new case: `usePlanCategorySummary` (`usePlanQueries.ts:377`) calls `base.planAssumptions.getCategorySummary` on the injected fake, proving no direct import remains | `usePlanQueries.test.tsx` |
| AC3 no direct imports | grep guard in the build step: `grep -rn "db/planRepository" src --include=*.ts* \| grep -v src/db/` returns only tests' type imports (none expected) | verification step, not a unit test |
| AC1 | the four Phase 4 commands run green on the finished branch, Node 22 | verification |
| AC4 | TODOS item 2 gone | review |

There are no `planRepository` unit tests today; the repo objects don't change, so this ticket doesn't add them (out of scope — noted, not owed).

## Verification

Node 22 (nvm): `npm run lint && npm run typecheck && npm run test:run && npm run build` — i.e. exactly the new Phase 4 list, which is also AC1's proof. Planning page smoke on a preview build (enable Planning in Advanced, open /planning, create a plan, add an assumption) — the only user-visible surface touched.

## Risk / cost

- Risk: low. Pure re-plumbing of one hook file; types enforce conformance. Main hazard is a missed call site — the grep guard plus typecheck (no import left = unused-import/undefined error) catches it.
- Cost: zero runtime cost (same objects, one extra property read per call).
- Scale: n/a.

## Out of scope

- Splitting the test suite into tiers.
- `.nvmrc` / `engines` pin for TD-054 (separate fix; noted only).
- Moving `scheduleGenerator`/`retainerMatching` logic into a service layer.

## Business / product impact

- Contributors (and Claude sessions) stop being told to run a command that fails, and the "done" gate in CLAUDE.md becomes one that actually proves done.
- Planning, an optional area users can switch on, becomes swappable like every other area — no surprise gap when TD-013's SQLite/desktop source lands.
- Closes the last open item from MUT-35's repository-seam work; cheap now, an afternoon lost later.

## Revised implementation (after eng review D2–D7, 2026-10-13)

Supersedes the D3 bullet and widens "Implementation (files)" above; D1, D2 and steps 1–7 above still hold. Goal after this ticket: **nothing outside `src/db` reaches storage except through `getRepositories()`; the single exception is `initDatabase()` in `src/main.tsx`; ESLint enforces it.**

```
 pages / hooks / components / demo / utils
            │  getRepositories().base.<slot>.<method>()
            ▼
 provider.ts ── dexieBase satisfies IRepositoryProvider  (18 → 23 slots)
            │
            ▼  Dexie implementations (the only code that imports `db`)
 repository.ts · expenseRepository.ts · retainerRepository.ts · planRepository.ts
 dataset.ts (new: backup / profile export-import / legacy + CSV import / wipe / checks)
 demoData.ts (new: demo + visitor-sample storage)
 scheduleGenerator (internal to retainerRepo) · reconcileFeaturesAfterDataLoad(db) (internal)
```

### A. Plans (D2) — unchanged from steps 2–5 above
Slots `plans`, `planAssumptions`, `planScenarios`.

### B. Retainers (D3 A)
- `IProjectedIncomeRepository` += `refreshDueStates()`, `markMissed(id)`, `getMatchSuggestions(transactionId)`, `getAllMatchSuggestions()`, `match(projectedIncomeId, transactionId)`, `unmatch(projectedIncomeId, transactionId)`.
- `IRetainerAgreementRepository` += `getSummary(profileId?, currency?)`; its doc states `create`/`update`/`activate`/`resume` maintain the projected schedule (a future source must do the same).
- `retainerRepository.ts`: bodies move from `retainerMatching` / `scheduleGenerator.updateDueStates` / `markProjectedIncomeMissed` / `getRetainerSummary` into `projectedIncomeRepo` / `retainerRepo`. `scheduleGenerator.generateSchedule/regenerateSchedule` stay module-internal (still exported for `retainerRepo.test.ts`). `calculateMatchScore` becomes a pure exported function.
- `useRetainerQueries.ts`: lines 118, 269, 281, 296, 307, 328, 351 call `getRepositories().base.*`; the "Not repositories" import block goes.

### C. Whole-database slot `dataset` (D4 B, D5 A) — new `src/db/dataset.ts` + `IDatasetRepository`
| Method | Moves from | Behaviour kept |
|---|---|---|
| `serializeBackup()` | `backup.ts serializeAllTables` | same JSON |
| `restoreBackup(json)` | `backup.ts restoreFromBackup` | same (txn + reconcile) |
| `exportProfile(profileId)` → `ProfileExportFile` + CSV rows | `ExportDataModal.tsx:73-153` | same filters incl. "or no profileId" related clients |
| `importProfile(file, target)` / `findMatchingProfile` | `profileImport.ts` | same |
| `importLegacyV1(data)` | `ImportDataPage.tsx:328-352` (clearDatabase + 6 bulkAdds + reconcile) | per regression contract (Test review) |
| `csvValidationContext()` | `ImportDataPage.tsx:160-161` | all-profile client/project names |
| `importCsvRows(rows, opts)` | `ImportDataPage.tsx:186-312` + `utils/csvImport.ts` | same per-row writes, name lookups, ids |
| `exportCoreTables()` | `DeleteAllDataModal.tsx:54-56` | raw clients/projects/transactions |
| `wipeCoreData()` | `seed.ts deleteAllData` | same 5 tables |
| `integrityCheck()` | `integrityCheck.ts` | same |
| `findOrphanedRecords()` | `orphanedRecords.ts` | same |

Download/UI stays in the components (`downloadTextFile` etc.); only storage moves. `csvImport.ts` keeps its pure helpers and calls the provider.

### D. Demo slot `demoData` (D4 B) — new `src/db/demoData.ts` + `IDemoDataRepository`
`hasDemoData()`, `removeDemoData()`, `seed(bundle)` (row generators stay in `src/demo`, storage write + reconcile move), `defaultUserProfile()` (non-demo default), `hasOwnData()`, `sampleUnpaidIncome()`, `countSessionAdditions(startedAt)`, `removeSessionAdditions(startedAt)`. `settingsRepo` calls in `seedData/index.ts:92,94` and `visitorSample.ts:141,147` → `base.settings`.

### E. Smaller slots (D4 B, D5 A)
- `ITransactionRepository` += `listNeedsReview()` (uses the `needsReview` index), `assignProfile(ids, profileId)` — `MigrationWizard.tsx:48-72`; `exportBackup()` there → `dataset.serializeBackup()` + download.
- `IClientSummaryRepository` += `getCrossProfileStats()` — `ClientsPage.tsx:120`.
- `IExpenseCategoryRepository` += `seedDefaults(profileId, …)` — `useExpenseQueries.ts:265` (wraps `seedExpenseCategories`).
- `DataToolsSection.tsx`, `OrphanedRecordsBanner.tsx`, `useOrphanedRecords.ts` → `base.dataset.*`.

### F. Guard (D6 A) and docs (D1, D7 A)
- `eslint.config.js` app-scope `no-restricted-imports` block; `main.tsx` one commented disable for `initDatabase`.
- CLAUDE.md Phase 4: `lint`, `typecheck`, `test:run`, `build` under Node 22; server line mirroring server-ci.
- `interfaces.ts` header: the seam rule + the one bootstrap exception. TD-013 rewritten from the code (slot count, interface list, no stale IDocument*). ADR records "every storage call goes through the provider; Dexie implementation modules are the only importers of `db`; enforced by lint".

### Files (estimate)
src/db: interfaces.ts, provider.ts, retainerRepository.ts, dataset.ts (new), demoData.ts (new), backup.ts, profileImport.ts, seed.ts, integrityCheck.ts, orphanedRecords.ts, crossProfileStats.ts, defaultExpenseCategories.ts, repository.ts, index.ts · callers: usePlanQueries.ts, useRetainerQueries.ts, useExpenseQueries.ts, useOrphanedRecords.ts, ClientsPage.tsx, DataToolsSection.tsx, OrphanedRecordsBanner.tsx, ExportDataModal.tsx, DeleteAllDataModal.tsx, MigrationWizard.tsx, ImportDataPage.tsx, utils/csvImport.ts, demo/seedData/index.ts, demo/visitorSample.ts, main.tsx · config/docs: eslint.config.js, CLAUDE.md, TODOS.md + 5 knowledge files · tests: see Test review. ≈ 37 source/doc files + ~15 test files.


---

# Eng review — /plan-eng-review, 2026-10-13

Target: `.claude/designs/mut-47-data-layer-reconcile.md` (this file, above the rule). Base: main a48f72d.

## Scope record

feature answers: none proposed; structure: A "Original arrangement" (D1, 2026-10-13); accepted scope: 12 files as listed in Implementation (7 code/docs + 5 knowledge files); pending remedies: R1, R2, R3, R4.

Scope update (late change, 2026-10-13): D2/D3 (retainer helpers into repo contracts), D4 (whole-database files + csvImport behind the seam), D5 (integrity/orphan/backup/stats/seed helpers), D6 (ESLint guard) and D7 (server line) expanded accepted scope well past D1's 12 files; see "Revised implementation" below. D1's structure answer predates this growth; the revised arrangement is in Parallelization.

## Scope Challenge findings

1. **[P1] (confidence 9/10) `src/db/retainerRepository.ts:567,773,782,889,915` — D3's rationale is false.** D3 says `scheduleGenerator` / `retainerMatching` are "composed *from* repositories". They are not: `retainerMatching.matchTransaction` does `await db.transactions.update(transactionId, {` and `await db.projectedIncome.update(projectedIncomeId, {`; `scheduleGenerator` does `await db.projectedIncome.bulkAdd(newItems)`; `markProjectedIncomeMissed` and `getRetainerSummary` read `db.projectedIncome` / `db.retainerAgreements` directly. Under a swapped provider these keep writing Dexie. Writing D3 as drafted would add exactly the documented-but-false claim this ticket exists to remove. (reviewer: Claude, Scope Challenge)
2. **[P2] (confidence 9/10) seam bypasses beyond the ticket's five.** Outside `src/db`: `src/utils/csvImport.ts:1-2` (`import { businessProfileRepo } from '../db/repository'`, `import { expenseRepo, expenseCategoryRepo } from '../db/expenseRepository'`), `src/demo/seedData/index.ts:8,10`, `src/demo/visitorSample.ts:13-14`, and direct `db` in `MigrationWizard.tsx:3`, `DeleteAllDataModal.tsx:4`, `ExportDataModal.tsx:4`, `ImportDataPage.tsx:4`. TD-013 does not list them. (reviewer: Claude)
3. **[P2] (confidence 9/10) `eslint.config.js:43-53` — nothing enforces the seam in the app.** The only `no-restricted-imports` rule is portal-scoped. The plan's grep guard runs once at build time; the next direct import is unchecked again. (reviewer: Claude)
4. **[P3] (confidence 8/10) Phase 4 server line.** The plan adds "changes under `server/` also run `npm --prefix server test`". `server-ci.yml:61-69` actually gates on `typecheck`, `lint`, `openapi:check`, `test:db`; naming only `test` would document a gate that differs from CI. (reviewer: Claude)

Prior learning applied: mutaba3a-typecheck-script-now-exists (confidence 10/10, from 2026-10-12).

## Decision ledger

### R1: How the retainer helpers that write Dexie directly join the seam
Finding: #1, P1, confidence 9/10, `src/db/retainerRepository.ts:567,773,782,889,915`, reviewer Claude. Reopened: new risk `src/db/retainerRepository.ts:247,267,294,334`.
Plan baseline: approved D2 answer B "Route through seam now": add primitive repo methods (projectedIncome bulkAdd/update/delete, a transactions write path) and rewrite the four helpers to call `getRepositories()`.
Runtime evidence: the Dexie `retainerRepo` itself calls `scheduleGenerator.generateSchedule` / `regenerateSchedule` from `create` (247), `update` (267), `activate` (294), `resume` (334). Hooks call the helpers at `useRetainerQueries.ts:118,269,281,296,307,328,351`. `transactionRepo.update` (`repository.ts:363`) takes a fast path when no amount/currency/payment-state key is sent, so a `linkedProjectedIncomeId` write is safe through it.
Reason for reopening: under the approved mechanism, a Dexie repository (`retainerRepo.create`) would call `scheduleGenerator`, which would call back out through `getRepositories()` to whatever provider is active. Implementation code depending on the provider inverts the layering: with a test fake or a future SQLite source injected, Dexie retainer writes would land schedule rows in the other store. The outcome you chose (no hook bypasses the seam for retainers) stands; only the mechanism is in question.
Comparison grid:

| Choice | Current | A Fold into repo contracts | B Services over primitives (as approved) |
|---|---|---|---|
| R1 outcome: hooks reach retainer storage only via `getRepositories()` | approved (D2 B) | kept | kept |
| R1 mechanism | approved D2 B: primitives + helpers call provider | Add to `IProjectedIncomeRepository`: `refreshDueStates()`, `markMissed(id)`, `getMatchSuggestions(txId)`, `getAllMatchSuggestions()`, `match(piId, txId)`, `unmatch(piId, txId)`; add `getSummary(profileId?, currency?)` to `IRetainerAgreementRepository`. Bodies move into the Dexie repo objects (db access there is the implementation). `scheduleGenerator` stays a Dexie-internal helper of `retainerRepo`; the interface doc states that `create`/`update`/`activate`/`resume` must maintain the projected schedule. Hooks call `base.projectedIncome.*` / `base.retainerAgreements.getSummary`. `calculateMatchScore` stays a pure exported function. | Add `projectedIncome.bulkCreate/delete/getByState` + use `transactions.update`; rewrite the 4 helpers to call `getRepositories()`; move schedule orchestration out of `retainerRepo.create/update/activate/resume` into the hooks so the repo no longer calls the provider |
| Tests | approved: matching/schedule tests | existing `retainerRepo.test.ts` describes for scheduleGenerator/retainerMatching/getRetainerSummary re-pointed at the new repo methods; `useRetainerQueries` tests mock `base.projectedIncome.*`; provider conformance via `satisfies` | same retainer tests re-pointed + new hook-orchestration tests for create/activate/resume/update scheduling |
| R2 other bypasses | pending | pending | pending |
| R3 lint guard | pending | pending | pending |
| R4 server gate line | pending | pending | pending |

Question D3:
D3 — Reopening D2: how should the retainer helpers move behind the seam?
Project/branch/task: MUT-47 plan on main; you chose to route the four retainer helpers through the seam (D2 B).
ELI10: You picked "move them behind the seam now", and that outcome stays. While designing it I found the retainer repository calls the schedule helper itself whenever a retainer is created, edited, activated or resumed. If the helper starts asking the provider for storage, the local repository would reach out to whatever storage is plugged in, which mixes two backends. The cleaner way is to make matching, due-state refresh, mark-missed and the summary real methods on the repositories, and keep schedule generation as part of the local implementation.
Stakes if we pick wrong: Plan B as approved makes a test fake or a future desktop database receive schedule rows written by the local one, a silent split-brain bug.
Recommendation: A because it gives the outcome you chose with no backwards dependency, and moves no orchestration out of the repo.
Completeness: A=10/10, B=9/10
Net: same outcome either way; A puts the logic inside the repository contract, B pulls orchestration up into hooks.
Header: Seam mechanism
Options:
A) Fold into repo contracts (recommended)
Matching, suggestions, due-state refresh, mark-missed become IProjectedIncomeRepository methods; summary becomes IRetainerAgreementRepository.getSummary; schedule generation stays inside the local retainer repo and the interface documents it. ✅ Hooks never touch Dexie and nothing in src/db calls the provider. ✅ Existing retainerRepo tests move over almost unchanged. ❌ Interfaces grow by 7 methods a future SQLite source must implement. (human: ~4h / CC: ~30min)
B) Services over primitives
Add bulkCreate/delete/getByState primitives, rewrite the helpers to call getRepositories(), and move schedule generation out of retainerRepo.create/update/activate/resume into the hooks. ✅ Repositories stay thin storage primitives. ✅ Business logic lives in one service layer. ❌ Moves retainer create/activate side effects into hooks, a behavior-path change with more regression risk. (human: ~1 day / CC: ~50min)

State: approved
Actual answer: A) Fold into repo contracts (D3, 2026-10-13)
Accepted scope: add `refreshDueStates()`, `markMissed(id)`, `getMatchSuggestions(txId)`, `getAllMatchSuggestions()`, `match(piId, txId)`, `unmatch(piId, txId)` to `IProjectedIncomeRepository` and `getSummary(profileId?, currency?)` to `IRetainerAgreementRepository`; move the helper bodies into the Dexie `projectedIncomeRepo` / `retainerRepo`; `scheduleGenerator` stays a Dexie-internal helper and the interface documents that create/update/activate/resume maintain the schedule; `calculateMatchScore` stays a pure exported function; `useRetainerQueries.ts` calls only `getRepositories()`; re-point the existing retainerRepo.test.ts describes and the useRetainerQueries tests.
History: D2 asked "How should MUT-47 document the retainer helpers that write Dexie directly?" Options: A) Honest note + TD (recommended), B) Route through seam now, C) Keep D3 wording. Answer: B) Route through seam now (2026-10-13). Accepted scope then: add projectedIncome bulkAdd/update/delete + transactions write path, rewrite the four helpers to call getRepositories(), add matching/schedule tests. Reopened for the layering risk above.

### R2: The seam bypasses outside the ticket's named five
Finding: #2, P2, confidence 9/10, reviewer Claude
Plan baseline: original proposal — not addressed; plan only covers the five named objects.
Runtime evidence: repo singletons imported outside `src/db`: `src/utils/csvImport.ts:1-2` (3 repos, 4 call sites, used by `ImportDataPage.tsx`), `src/demo/seedData/index.ts:10`, `src/demo/visitorSample.ts:14` (`settingsRepo`). Direct `db.*` outside `src/db`: `ExportDataModal.tsx` (10), `ImportDataPage.tsx` (15), `DeleteAllDataModal.tsx` (3), `MigrationWizard.tsx` (3), `demo/seedData/index.ts` (50), `demo/visitorSample.ts` (10). The `db.*` users are whole-database operations (backup export/import, wipe, migration, demo seeding): Dexie-specific by nature, with no repository contract to route through today.
Comparison grid:

| Choice | Current | A csvImport now, document the rest | B Migrate everything now | C Document only |
|---|---|---|---|---|
| R2 csvImport.ts | direct repo imports, pending | switch to `getRepositories().base.*` (4 call sites) | same as A | listed in TD-013, unchanged |
| R2 whole-database `db.*` users + demo seeds | undocumented, pending | listed in TD-013 and the `interfaces.ts` "outside the seam" note as Dexie-specific whole-database operations; follow-up ticket for a backup/restore/wipe contract | design a backup/restore/wipe/seed contract on the provider and migrate 6 files (~90 `db.*` call sites) | listed in TD-013 + note, unchanged |
| R1 helpers | approved D3 A | unchanged | unchanged | unchanged |
| R3 lint guard | pending | pending | pending | pending |
| R4 server gate line | pending | pending | pending | pending |

Question D4:
D4 — What does MUT-47 do about the other places that skip the repository seam?
Project/branch/task: MUT-47 plan on main; the ticket names five objects, the code has more bypasses.
ELI10: Besides the five objects the ticket names, a few more places go around the repository layer. One is small and ordinary: the CSV importer imports three repositories directly instead of asking the provider. The rest are whole-database jobs (backup export and import, delete-all, the migration wizard, demo seeding) that read and write the local database table by table, because there is no backup contract to go through yet. Fixing the CSV importer is four lines; building a proper backup contract is its own project.
Stakes if we pick wrong: Leaving them undocumented means the "every storage call goes through the seam" claim is still false after this ticket, which is the exact problem it exists to fix.
Recommendation: A because it makes the docs fully true now, fixes the cheap bypass, and gives the backup contract its own ticket.
Completeness: A=9/10, B=10/10, C=7/10
Net: true docs + one cheap fix now vs a backup-contract design project inside this ticket.
Header: Other bypasses
Options:
A) csvImport now, document rest (recommended)
Route csvImport.ts through getRepositories(); list the backup/import/wipe/migration/demo db users in TD-013 and the interfaces.ts note as Dexie-specific whole-database operations; file a follow-up ticket for a backup/restore/wipe contract. ✅ After this ticket every bypass is either fixed or written down with its reason. ✅ Small, safe diff. ❌ Backup and wipe stay Dexie-only until the follow-up. (human: ~1h / CC: ~10min)
B) Migrate everything now
Design a backup/restore/wipe/seed contract on the provider and move all 6 files (~90 db call sites) behind it. ✅ The seam becomes complete for the whole app. ✅ A future SQLite source gets backup and wipe for free. ❌ A design project touching data export/import and delete-all; high regression risk in a docs ticket. (human: ~3 days / CC: ~2h)
C) Document only
List every bypass, including csvImport, in TD-013 and the note; change no code. ✅ Smallest diff, zero behavior risk. ✅ Docs become true. ❌ Leaves a four-line fix undone for no reason. (human: ~30min / CC: ~5min)

State: approved
Actual answer: B) Migrate everything now (D4, 2026-10-13)
Accepted scope: route `csvImport.ts` through `getRepositories()`; design a backup/restore/wipe/seed contract on the provider and move `ExportDataModal.tsx`, `ImportDataPage.tsx`, `DeleteAllDataModal.tsx`, `MigrationWizard.tsx`, `demo/seedData/index.ts`, `demo/visitorSample.ts` behind it (no `db.*` or repo-singleton import outside `src/db` afterwards). Contract design detailed in the working plan below; its own sub-decisions, if any, are asked separately.
History: none

### R5: Do the extra src/db helpers that hooks/pages call directly also move behind the seam?
Finding: #5 (new, from the bypass map), P2, confidence 9/10, reviewer Claude (Explore agent map)
Plan baseline: D4 B approved migrating the six named whole-database files + csvImport. These were not named in D4.
Runtime evidence: helpers in `src/db` that read `db` internally, called directly from outside `src/db`: `findOrphanedRecords` (`useOrphanedRecords.ts:3,21`), `runIntegrityCheck` (`OrphanedRecordsBanner.tsx:3,18`, `DataToolsSection.tsx:5,37`), `exportBackup` / backup.ts `restoreFromBackup` (`DataToolsSection.tsx:6,57,92`), `getCrossProfileClientStats` (`ClientsPage.tsx:30,120`), `seedExpenseCategories` (`useExpenseQueries.ts:4,265`, uses `expenseCategoryRepo` singleton), `initDatabase` (`main.tsx:13,130`), and `reconcileFeaturesAfterDataLoad(source, db)` taking raw Dexie from `ImportDataPage.tsx:352` / `seedData/index.ts:154`.
Comparison grid:

| Choice | Current | A Include them (same pattern as D3) | B Document, follow-up |
|---|---|---|---|
| R5 integrity/orphan/cross-profile/seed-categories/backup helpers | direct calls, pending | each becomes a method on an existing slot or the new whole-database slot; callers use `getRepositories()` | listed in TD-013 + `interfaces.ts` note; follow-up ticket |
| R5 `initDatabase` in `main.tsx` | direct call, pending | stays direct: it opens Dexie before React mounts (ADR-002 / provider.ts comment), documented as the single bootstrap exception | same, documented |
| R5 `reconcileFeaturesAfterDataLoad(…, db)` | raw Dexie passed from 2 files outside src/db, pending | the call moves inside the src/db operations that load data (as backup.ts already does) | stays, documented |
| D4 six files + csvImport | approved | unchanged | unchanged |

Question D5:
D5 — Does "migrate everything" also cover the integrity, orphan, backup and stats helpers?
Project/branch/task: MUT-47 plan on main; D4 approved migrating six whole-database files plus the CSV importer.
ELI10: A full map of the code found five more helpers that live in the data folder but read the database directly, and get called straight from pages and hooks: the integrity check, the orphaned-records finder, the JSON backup and restore, the cross-business client stats, and default expense-category seeding. They have the same problem as the retainer helpers you already chose to fix. The app's startup call that opens the database has to stay direct, because it runs before anything else exists.
Stakes if we pick wrong: Without them, "nothing outside the data folder touches storage directly" is still false after this ticket, and a lint guard could not be turned on.
Recommendation: A because D4 chose a complete seam and these use the same fold-into-contract pattern as D3; only startup stays as a documented exception.
Completeness: A=10/10, B=7/10
Net: a truly complete seam in one go vs a smaller diff with a written list of what's left.
Header: Extra helpers
Options:
A) Include them (recommended)
Fold integrity check, orphan finder, backup/restore, cross-profile stats and expense-category seeding into repository contracts; feature reconcile moves inside the data-loading operations; only initDatabase stays direct, documented. ✅ The seam claim becomes fully true and lint-enforceable. ✅ Same pattern as D3, so no new idea to learn. ❌ Adds about 8 call sites and their tests to an already large ticket. (human: ~1 day / CC: ~40min)
B) Document, follow-up
List them in TD-013 and the interfaces.ts note, file a follow-up ticket. ✅ Keeps this ticket from growing further. ✅ Docs stay true. ❌ The seam is still incomplete, and a lint guard would need a longer allowlist. (human: ~30min / CC: ~5min)

State: approved
Actual answer: A) Include them (D5, 2026-10-13)
Accepted scope: `findOrphanedRecords`, `runIntegrityCheck`, backup.ts `exportBackup`/`restoreFromBackup`, `getCrossProfileClientStats`, `seedExpenseCategories` become provider methods and their callers (`useOrphanedRecords.ts`, `OrphanedRecordsBanner.tsx`, `DataToolsSection.tsx`, `ClientsPage.tsx`, `useExpenseQueries.ts`) use `getRepositories()`; `reconcileFeaturesAfterDataLoad` is called only from inside src/db data-loading operations; `initDatabase` in `main.tsx` stays direct as the single documented bootstrap exception.

### R3: Make the seam self-checking with a lint rule
Finding: #3, P2, confidence 9/10, `eslint.config.js:35-54` (only rule is portal-scoped), reviewer Claude
Plan baseline: original proposal — a one-time grep at build time.
Runtime evidence: no rule stops app code outside `src/db` importing `db`, a `*Repo` singleton, or a storage helper; `src/__tests__/no*Modules.test.ts` guards cover dead modules only. After D3/D4/D5 the only legitimate outside import is `initDatabase` in `src/main.tsx`.
Comparison grid:

| Choice | Current | A ESLint rule | B Guard test | C No guard |
|---|---|---|---|---|
| R3 enforcement | grep once, pending | new `eslint.config.js` block for `src/**/*.{ts,tsx}` ignoring `src/db/**`, `src/hosted/**` (has its own rule), `**/__tests__/**`, `src/test/**`: `no-restricted-imports` patterns for `**/db/{database,repository,expenseRepository,retainerRepository,planRepository,backup,seed,integrityCheck,orphanedRecords,crossProfileStats,profileImport,migration-safety}` and import names `db` + every `*Repo` from `**/db`; `src/main.tsx` allowed `initDatabase` via an inline `eslint-disable-next-line` with a reason | `src/__tests__/noStorageBypass.test.ts` greps `src/` for the same imports, like the existing `no*Modules` guards | rely on review |
| R1, R2, R5 | approved | unchanged | unchanged | unchanged |
| R4 server gate line | pending | pending | pending | pending |

Question D6:
D6 — How do we stop the next direct database import from creeping back in?
Project/branch/task: MUT-47 plan on main; after D3-D5 nothing outside src/db should touch storage directly.
ELI10: Once this ticket lands, the rule is simple: pages, hooks and components ask the provider for data and never import the database or a repository directly. Today nothing checks that, which is how the drift MUT-35 and this ticket found built up. A lint rule fails the moment someone writes the forbidden import, in the editor and in npm run lint. A guard test does the same thing as a test file, the way this repo already guards against deleted modules coming back.
Stakes if we pick wrong: Without a check, the seam starts drifting again with the next feature, and the docs go false a third time.
Recommendation: A because the editor flags it as you type and lint is already in the done-gate; the startup exception gets one visible disable comment.
Completeness: A=10/10, B=9/10, C=4/10
Net: an editor-time rule vs a repo-style guard test vs trusting review again.
Header: Seam guard
Options:
A) ESLint rule (recommended)
App-scope no-restricted-imports banning db, repository singletons and storage helper modules outside src/db; tests and the portal excluded; main.tsx's initDatabase gets one commented disable. ✅ Flags a bypass in the editor, before commit. ✅ Runs in npm run lint, already in the done-gate. ❌ A pattern list to keep current when a new db module is added. (human: ~1h / CC: ~10min)
B) Guard test
A noStorageBypass.test.ts that greps src/ for the same imports, matching the existing no*Modules guard tests. ✅ Same style as the repo's current guards. ✅ Easy to read failure message. ❌ Only fails when tests run, not in the editor. (human: ~1h / CC: ~10min)
C) No guard
Rely on code review and the TD-013 note. ✅ Zero extra config. ✅ Nothing to maintain. ❌ Repeats the exact failure this ticket is fixing.

State: approved
Actual answer: A) ESLint rule (D6, 2026-10-13)
Accepted scope: new app-scope `eslint.config.js` block (`src/**/*.{ts,tsx}`, ignoring `src/db/**`, `src/hosted/**`, `**/__tests__/**`, `src/test/**`) with `no-restricted-imports` banning the db storage modules and the `db` / `*Repo` names from the `db` barrel; `src/main.tsx` `initDatabase` gets one `eslint-disable-next-line` with a reason; the rule must pass on the finished branch.

### R4: What CLAUDE.md Phase 4 says for changes under server/
Finding: #4, P3, confidence 8/10, `.github/workflows/server-ci.yml:61-69`, reviewer Claude
Plan baseline: original proposal D1 — add "changes under `server/` also run `npm --prefix server test`".
Runtime evidence: server-ci gates on `npm run typecheck`, `npm run lint`, `npm run openapi:check`, `npm run test:db` (Postgres at `localhost:54329`); server `package.json` has `test = vitest run` (in-memory store) and `test:db` (needs Postgres). TODOS #8: a known same-millisecond audit-ordering flake in the server suite.
Comparison grid:

| Choice | Current | A Mirror server CI | B App only | C test only (as drafted) |
|---|---|---|---|---|
| R4 server line | drafted: `npm --prefix server test`, pending | "Changes under `server/`: `npm --prefix server run typecheck`, `run lint`, `run openapi:check`, `test`; CI also runs `test:db` against Postgres (TODOS #8 flake known)" | no server line; Phase 4 is the app's gate | `npm --prefix server test` |
| D1 app list | lint/typecheck/test:run/build + Node 22 | unchanged | unchanged | unchanged |

Question D7:
D7 — What should CLAUDE.md's done-gate say for changes to the hosted server?
Project/branch/task: MUT-47 plan on main; fixing CLAUDE.md's Phase 4 command list.
ELI10: CLAUDE.md's "run these before calling it done" list is for the web/desktop app. The hosted server in server/ has its own checks, and its CI runs four of them. My draft said only "run the server tests", which is a different, smaller gate than CI. The point of this ticket is that the documented gate must match reality.
Stakes if we pick wrong: A server change passes the documented gate locally, then fails openapi:check or lint in CI.
Recommendation: A because it lists exactly what server CI enforces, and names the Postgres step and known flake instead of hiding them.
Completeness: A=10/10, B=6/10, C=5/10
Net: one accurate extra line vs a shorter list that undersells server CI.
Header: Server gate
Options:
A) Mirror server CI (recommended)
One conditional line: changes under server/ also run typecheck, lint, openapi:check and test there; note CI also runs test:db on Postgres and the TODOS #8 flake. ✅ The documented gate equals what CI enforces. ✅ Nobody is told to run a command that can't pass locally without saying so. ❌ One more line to keep in sync with server-ci.yml. (human: ~10min / CC: ~2min)
B) App only
Phase 4 lists the app's four commands only, no server line. ✅ Shortest, and every listed command is exactly true. ✅ Server CI already enforces its own gate. ❌ Contributors touching server/ get no local guidance from CLAUDE.md.
C) test only (as drafted)
Add "changes under server/ also run npm --prefix server test". ✅ Simple, one command. ✅ Catches most server regressions. ❌ Differs from CI (misses lint, typecheck, openapi:check), recreating a small documented-vs-real gap.

State: approved
Actual answer: A) Mirror server CI (D7, 2026-10-13)
Accepted scope: CLAUDE.md Phase 4 gets one conditional line: changes under `server/` also run `npm --prefix server run typecheck`, `run lint`, `run openapi:check`, `test`; it notes CI also runs `test:db` against Postgres and the TODOS #8 flake.

## Section 1 — Architecture review
No new issues beyond R1/R2/R5 (already decided). Notes: the two new slots keep Dexie code as the only `db` importer, so a test fake or future source never receives writes from Dexie code (the D3 risk does not recur: `dataset` and `demoData` call no other slot through the provider). `reconcileFeaturesAfterDataLoad(source, db)` stays Dexie-internal, called from `restoreBackup`, `importLegacyV1` and `demoData.seed`, the same places that call it today (backup.ts, ImportDataPage, seedData), moved into src/db. Hosted bundle unaffected: `src/hosted/**` keeps its own rule and imports no `db`.
Dispositions: none pending.

## Section 2 — Code quality review
No new issues. Reuse notes: `exportProfile` lives beside `importProfile` in the dataset module and returns the existing `ProfileExportFile` type (`profileImport.ts:24-34`), so export and import share one shape for the first time. The two `restoreFromBackup` functions (barrel → migration-safety; UI → backup.ts) stay as they are (TD-074); the slot method is named `restoreBackup` to avoid adding a third.
Dispositions: none pending.

## Section 3 — Test review (in progress)

### R6: Regression contract for the moved whole-database operations
Finding: Test review, CRITICAL regression risk, confidence 9/10, reviewer Claude
Plan baseline: D4 B / D5 A approved moving these operations; behaviour change not discussed.
Runtime evidence (current behaviour the move puts at risk; most have no direct test today — DeleteAllDataModal, MigrationWizard, seedData have none):
- `ImportDataPage.tsx:328-347` legacy v1 import: `clearDatabase()` then six `bulkAdd`s, **no transaction** — a failing bulkAdd leaves tables half empty.
- `seed.ts:70-84` `deleteAllData` clears 5 tables only; profiles, expenses, payment records, retainers, plans and the rest survive "Delete all data".
- `MigrationWizard.tsx:69-72` `db.transactions.update(...)` sets no `updatedAt`; `transactionRepo.update` would add one.
- `ImportDataPage.tsx:298` conversion rows get no `profileId`; `ImportDataPage.tsx:207,232` client/project name lookups are global across profiles.
Comparison grid:

| Choice | Current | A Byte-identical move | B Fix the transaction gap while moving |
|---|---|---|---|
| R6 legacy v1 import atomicity | no transaction | unchanged (no transaction) | `importLegacyV1` runs clear + bulkAdds in one rw transaction (all or nothing) |
| R6 deleteAllData table set | 5 tables | unchanged | unchanged (product question, separate TODO) |
| R6 needsReview update `updatedAt` | not set | unchanged (`assignProfile` writes exactly `{profileId, needsReview: undefined}`) | unchanged |
| R6 CSV conversion profileId / global name lookups | as today | unchanged | unchanged |
| R6 regression tests | none for 3 of 6 files | new characterization tests pin today's behaviour for every moved method, written red-first against the old call path, then kept green across the move | same tests; the legacy-import test asserts all-or-nothing instead of partial |

Question D8:
D8 — When the database jobs move behind the seam, do they behave exactly as today?
Project/branch/task: MUT-47 plan on main; D4/D5 move backup, import, delete-all, migration and demo storage code into src/db.
ELI10: Moving code is safest when it does precisely what it did before, proven by tests written before the move. While mapping the code I found a few rough edges in what we're moving. The worst: the old-format import wipes six tables, then refills them with no safety net, so a failure halfway leaves your data half-deleted. We can either move everything exactly as-is and file the rough edges as tickets, or also wrap that one import in a database transaction while we're there, so it either fully succeeds or changes nothing.
Stakes if we pick wrong: Changing behaviour silently during a move hides regressions; leaving the import as-is keeps a real data-loss path open until someone picks up the ticket.
Recommendation: B because that one fix is a 3-line transaction wrapper on code we're already rewriting and closes a data-loss path; everything else moves byte-identical with characterization tests.
Completeness: A=8/10, B=10/10
Net: pure move with all bugs ticketed vs pure move plus one all-or-nothing fix on the risky import.
Header: Regression rule
Options:
A) Byte-identical move
Every moved operation keeps today's behaviour exactly, pinned by characterization tests written before the move; the four rough edges become TODOs/tickets. ✅ Zero intended behaviour change, so any diff in tests is a real regression. ✅ Easiest to review as a move. ❌ The half-wipe import path stays live until a follow-up ships. (human: ~1 day tests / CC: ~40min)
B) Fix transaction gap too
Same characterization tests, except importLegacyV1 runs in one transaction and its test asserts nothing changes when a bulkAdd fails; the other three edges stay as-is and become TODOs. ✅ Closes the data-loss path in code already being rewritten. ✅ One intended difference, named and tested. ❌ One behaviour change inside a refactor, so the move is not purely mechanical. (human: ~1 day / CC: ~45min)

State: approved
Actual answer: B) Fix transaction gap too (D8, 2026-10-13). Note: the sent label was shortened from the first saved draft ("Fix the transaction gap while moving"); description and commitments identical.
Accepted scope: characterization tests for every moved method, written red-first against the old call path and kept green across the move; `importLegacyV1` runs clear + bulkAdds + reconcile in one rw transaction, with a test proving a failing bulkAdd leaves every table unchanged; `deleteAllData` table set, MigrationWizard `updatedAt`, CSV conversion `profileId` and global name lookups move unchanged and become TODOs.

### R7: AC1 needs a green suite; main has a load-dependent IncomeDrawer failure
Finding: Test review, P2, confidence 8/10, `src/components/__tests__/IncomeDrawer.test.tsx:582`, reviewer Claude
Plan baseline: AC1 "every command in Phase 4 exists and passes on a clean tree"; plan assumed main is green.
Runtime evidence: full `npm run test:run` on main a48f72d under Node 22: 1 failed / 3501 passed — `expect(await screen.findByRole('option', { name: /Brand New Co/ })).toBeInTheDocument();` not found (file took 78s). Same test alone: passes in 7.5s. `src/test/setup.ts:10` already sets `asyncUtilTimeout: 3000`, so it is not the default-1s timeout; likely a race after `user.selectOptions(...)` that shows under load. Lint, typecheck, build: green.
Comparison grid:

| Choice | Current | A Bounded root-cause in this ticket | B Separate bug, AC1 notes it |
|---|---|---|---|
| R7 flaky test | fails under full-suite load, pending | investigate up to ~1h (`/investigate`), fix the race (test or component) with a red-first repro under load; if not root-caused in the bound, fall back to B | file a Bug in MUT now; AC1 evidence records this one known failure with the bug key |
| AC1 evidence | gate run | gate fully green | gate green except one ticketed known failure |

Question D9:
D9 — The test suite on main already has one test that fails under load; fix it here or ticket it?
Project/branch/task: MUT-47 plan on main; AC1 says every done-gate command passes on a clean tree.
ELI10: I ran the full done-gate on main. Lint, typecheck and build pass. One IncomeDrawer test fails when the whole suite runs, but passes alone. The test helper already waits 3 seconds, so it isn't just slowness; something in the drawer races when the machine is busy. AC1 of this ticket literally requires the gate to pass, so either we find and fix the race, or we ticket it and say so honestly in AC1's evidence.
Stakes if we pick wrong: Shipping "the gate passes" with a known red test teaches everyone to ignore red; a real race in the income drawer could also bite users.
Recommendation: A because AC1 is this ticket's own promise, and a race that only shows under load may be a real bug in the most-used drawer; time-boxed with a fall back to B.
Completeness: A=10/10, B=7/10
Net: one bounded investigation for a truly green gate vs an honest exception with a bug ticket.
Header: Flaky test
Options:
A) Bounded root-cause here (recommended)
Investigate up to about an hour, reproduce under load, fix the race in the test or the drawer with a red-first repro; if not found in the bound, file a bug and fall back to B. ✅ AC1 ends with a genuinely green gate. ✅ Catches a possible real race in the income drawer. ❌ Unrelated work inside this ticket, up to an hour. (human: ~2h / CC: ~20min)
B) Separate bug, note in AC1
File a MUT Bug now; AC1's evidence lists this one known failure with the bug key. ✅ Keeps MUT-47 focused on the seam. ✅ Honest: the exception is written down, not re-run away. ❌ The done-gate stays red on main until the bug is picked up.

State: approved
Actual answer: A) Bounded root-cause here (D9, 2026-10-13)
Accepted scope: up to ~1h investigation of `IncomeDrawer.test.tsx:569-584` under full-suite load; fix the race (test or component) with a red-first repro; if not root-caused within the bound, file a MUT Bug and record the one known failure with its key in AC1's evidence.

### Coverage diagram (existing tests vs planned paths)

```
CODE PATHS                                                         USER FLOWS
[+] provider.ts / interfaces.ts                                    [+] Planning (feature on)
  ├── [★★ TESTED] default slots resolve — provider.test.ts           ├── [GAP] create plan → add assumption → summary (preview smoke)
  ├── [GAP] plans/planAssumptions/planScenarios/dataset/demoData     └── [★★ TESTED] by-id lookups null-safe — usePlanQueries.test
  │         slots resolve to the Dexie objects                     [+] Retainers
  └── [★★★ TESTED] conformance — `satisfies` + typecheck              ├── [★★ TESTED] match/unmatch/suggestions — retainerRepo.test:544-730
[+] retainerRepository.ts (D3)                                       ├── [GAP] refreshDueStates (upcoming→due by date)
  ├── [★★ TESTED] generateSchedule incl. idempotency — :427-540      ├── [GAP] markMissed
  ├── [GAP] regenerateSchedule (keeps received/partial)              └── [GAP] getAllMatchSuggestions (unlinked paid income only)
  └── [★★ TESTED] getSummary — :731+                               [+] Settings › Data
[+] dataset.ts (D4/D5)                                               ├── [★★ TESTED] export per-profile JSON/CSV — ImportExportModals.test
  ├── [★★ TESTED] serialize/restore round trip (retainedSchema etc.) ├── [★★ TESTED] CSV + v2 import — ImportDataPage.test, csvImport.test
  ├── [★★ TESTED] importProfile — profileImport.test                 ├── [GAP] legacy v1 import, incl. failing bulkAdd → nothing changed (D8)
  ├── [GAP] importLegacyV1 all-or-nothing (D8 intended change)       ├── [GAP] Delete all data: CSV pre-export + 5-table wipe
  ├── [GAP] exportCoreTables + wipeCoreData                          ├── [★★ TESTED] integrity check / backup buttons — DataToolsSection.test
  ├── [★★ TESTED] integrityCheck, findOrphanedRecords                └── [GAP] Migration wizard: needsReview list + assign profile
  └── [★★ TESTED] exportProfile/importCsvRows via page tests       [+] Demo / sample
[+] demoData.ts                                                      ├── [★★ TESTED] enter/leave sample, counts — visitorSample.test
  ├── [★★ TESTED] seed/remove/hasOwnData via visitorSample.test      └── [GAP] ?demo=1 seed + reset (no direct test)
  └── [GAP] removeDemoData leaves non-demo rows (direct)
[+] transactions.listNeedsReview / assignProfile                   [+] Guard
  └── [GAP] both                                                     └── [GAP] lint rule rejects a db import outside src/db
[+] clientSummaries.getCrossProfileStats — [★★ TESTED] crossProfileBadges.test
[+] expenseCategories.seedDefaults — [GAP] idempotent per profile
[+] IncomeDrawer race (D9) — [GAP] red-first repro under load

COVERAGE: 14/27 paths tested (52%) | GAPS: 13 (0 E2E required; 1 preview smoke)
```

### Tests to add (approved scope: D2, D3 A, D4 B, D5 A, D6 A, D8 B, D9 A)
Red-first: each characterization test is written against today's call path, then the call site moves and the test stays green (D8 B's one intended difference is red→green).

| # | File | Asserts | Value card |
|---|---|---|---|
| T1 | `src/db/__tests__/provider.test.ts` (extend) | the five new slots are the Dexie objects | protects=slot wiring; fails_when=a slot points at the wrong object; why_new=existing test checks 6 of 18 slots; seam=none |
| T2 | `src/db/__tests__/retainerRepo.test.ts` (extend) | `refreshDueStates` flips only upcoming rows with `expectedDate <= today`; `markMissed` sets state+updatedAt; `getAllMatchSuggestions` skips linked/unpaid/deleted; `regenerateSchedule` keeps received/partial rows | protects=retainer state machine; fails_when=a body is altered in the move; why_new=no test today; seam=none |
| T3 | `src/hooks/__tests__/useRetainerQueries.test.tsx` (extend) | hooks call `base.projectedIncome.match/unmatch/refreshDueStates/markMissed` and `base.retainerAgreements.getSummary` on the injected fake | protects=hooks go through the seam; fails_when=a direct import returns; why_new=only useRetainer covered; seam=none |
| T4 | `src/hooks/__tests__/usePlanQueries.test.tsx` (rewrite mock + 1 case) | per plan step 5 + `usePlanCategorySummary` hits the fake | as in plan |
| T5 | `src/db/__tests__/dataset.test.ts` (new) | `importLegacyV1`: happy path writes 6 tables + reconciles; a forced `bulkAdd` failure leaves every table as before (D8); `exportCoreTables` returns raw rows incl. archived/deleted; `wipeCoreData` clears exactly the 5 tables and keeps settings/profiles | protects=whole-db behaviour + D8 atomicity; fails_when=table set or atomicity changes; why_new=no direct tests; seam=none |
| T6 | `src/db/__tests__/transactions.needsReview.test.ts` (new) | `listNeedsReview` returns only `needsReview===true`; `assignProfile` writes exactly `{profileId, needsReview: undefined}` and no `updatedAt` (characterizes today, TODO filed) | protects=migration wizard data; fails_when=extra fields written; why_new=no test; seam=none |
| T7 | `src/db/__tests__/demoData.test.ts` (new) | `removeDemoData` deletes only `demo_` ids across the 12 tables and leaves user rows | protects=user data during demo reset; fails_when=prefix filter widens; why_new=only indirect coverage; seam=none |
| T8 | `src/db/__tests__/defaultExpenseCategories.test.ts` (new or extend) | `seedDefaults` twice for one profile creates no duplicates | protects=idempotent seeding; fails_when=duplicate categories; why_new=none today; seam=none |
| T9 | existing `ImportExportModals.test`, `ImportDataPage.test`, `csvImport.test`, `visitorSample.test`, `DataToolsSection.test`, `OrphanedRecordsBanner.test`, `ClientsPage.test` | unchanged assertions; mocks re-pointed only where they mocked a moved module path | regression net for the moves |
| T10 | `eslint` run on a fixture (in `src/__tests__/seamLint.test.ts` via ESLint API) | a file outside src/db importing `db` or `clientRepo` is reported; `src/db/**` and `__tests__` are not | protects=D6 guard config; fails_when=the pattern list or ignores break; why_new=nothing tests lint config; seam=none |
| T11 | `IncomeDrawer.test.tsx:569` | red-first repro of the load race (D9), then fixed | per D9 |

Tests made obsolete: none deleted. `usePlanQueries.test.tsx`'s module mock of `db/planRepository` is replaced, not kept.

Dispositions (Section 3): R6 approved (D8 B), R7 approved (D9 A); T1–T11 are required proof of approved scope.

## Section 4 — Performance review
- [P3] (confidence 7/10) bundle: provider.ts statically imports every implementation. Measured on main: `planRepository` and `backup.ts` already sit in the main chunk (`index-*.js`, 730,957 B / 205,417 B gz); `ExportDataModal`'s export logic is in the `SettingsPage` chunk and `ImportDataPage`'s in its own lazy chunk, so moving them into `dataset.ts` moves a few KB into main. Requirement within approved scope: record the main-chunk gz size before/after in CHANGELOG; no gate.
- `listNeedsReview` switches the MigrationWizard read from a full scan to the `needsReview` index (`database.ts:804`): fewer reads on every app load (the wizard is mounted in AppShell).
- `refreshDueStates` keeps the indexed `where('state').equals('upcoming')` read.
- No new loops over storage; no N+1 introduced. Scale: local IndexedDB, single user.
Dispositions: informational, no choice pending.

## Outside voice
Codex CLI not installed (`CODEX_MODE: not_installed`); the native fallback needs a TaskOutput tool this session does not declare, so it took the unavailable path. Outside voice unavailable; no clean-review credit. Logged as `codex-plan-review` unavailable.

## TODOS.md updates (approved by D8 B: the rough edges not fixed here become TODOs)
To be written into `TODOS.md` during the build, in the same edit that removes item 2:
- **"Delete all data" keeps profiles, expenses, payment records, retainers and plans.** What: `deleteAllData` (`seed.ts:70-84`) clears 5 tables. Why: the button's name promises everything. Pros: matches the label. Cons: product call (maybe deliberate, keeps businesses). Context: now `dataset.wipeCoreData()`; pinned by T5. Depends on: a product decision.
- **Migration wizard writes no `updatedAt`.** What: `transactions.assignProfile` writes `{profileId, needsReview: undefined}` only (pinned by T6). Why: every other write stamps `updatedAt`. Pros: consistent audit fields. Cons: none known. Context: `src/db/repository.ts` after MUT-47. Depends on: nothing.
- **CSV import: conversion rows get no `profileId`, and client/project name lookups ignore the business.** What: `dataset.importCsvRows` (moved from `ImportDataPage.tsx:207,232,298`). Why: rows can land in no business or attach to another business's client. Pros: correct filing. Cons: changes import results for existing CSVs. Context: pinned by existing `ImportDataPage.test`. Depends on: nothing.

## Approval readiness: PASS
Checked: D1 (structure A), R1 (D3 A; history D2 B), R2 (D4 B), R5 (D5 A), R3 (D6 A), R4 (D7 A), R6 (D8 B), R7 (D9 A). Every accepted remedy cites its own answer. Regression contract: D8 B (characterization tests, one intended difference).

## NOT in scope
- A backup/restore format change: `dataset` reuses today's JSON shapes.
- The three TODOs above (product or behaviour changes kept out of a move).
- Removing the duplicate `restoreFromBackup` names (TD-074).
- `.nvmrc` / `engines` pin for TD-054: CLAUDE.md names Node 22; pinning is a separate change.
- Splitting the test suite into unit/integration tiers (D1).

## What already exists
- `getRepositories()` / `satisfies IRepositoryProvider` (`provider.ts:46-69`): reused for all new slots.
- `vi.mock('../../db')` test pattern (`useRetainerQueries.test.tsx:10-15`): reused for plan and retainer hook tests.
- `ProfileExportFile` (`profileImport.ts:24-34`): reused as `exportProfile`'s return type (first producer of that type).
- `serializeAllTables` / `restoreFromBackup` (`backup.ts`), `deleteAllData` (`seed.ts`), `runIntegrityCheck`, `findOrphanedRecords`, `getCrossProfileClientStats`, `seedExpenseCategories`: moved behind slots, not rewritten.
- Portal `no-restricted-imports` block (`eslint.config.js:35-54`): model for the D6 app-scope rule.

## Failure modes
| New path | Realistic failure | Covered by | User sees |
|---|---|---|---|
| plan slots | a hook still imports `planRepository` | T4 + D6 lint | build/lint fails, not users |
| retainer `match` via provider | body altered in move, totals wrong | T2/T3 + existing retainerRepo tests | wrong period state (caught by tests) |
| `importLegacyV1` | bulkAdd throws mid-import | T5 (D8) | import error toast; data unchanged |
| `wipeCoreData` | table set drifts | T5 | — |
| `demoData.removeDemoData` | prefix filter widens, deletes user rows | T7 | — |
| lint guard | ignores too broad, misses a bypass | T10 | — |
No critical gaps: every new path has a test, and none fails silently without one.

## Worktree parallelization strategy
| Step | Modules touched | Depends on |
|---|---|---|
| S0 interfaces + provider skeleton | src/db (interfaces, provider) | — |
| S1 plans | src/hooks, src/db | S0 |
| S2 retainers | src/db (retainerRepository), src/hooks | S0 |
| S3 dataset + settings callers | src/db (dataset, backup, seed, profileImport…), src/pages/settings, src/components/modals, src/utils | S0 |
| S4 demoData + demo callers | src/db (demoData), src/demo | S0 |
| S5 small slots (needsReview, cross-profile, seedDefaults, orphan/integrity callers) | src/db (repository, expenseRepository), src/hooks, src/pages/clients, src/components/layout | S0 |
| S6 lint guard + docs + knowledge files + TODOS | eslint.config.js, CLAUDE.md, .claude/ | S1–S5 |
| S7 IncomeDrawer race (D9) | src/components (drawers + test) | — |
Every step after S0 edits `interfaces.ts` and `provider.ts`, so lanes would conflict there. Per the one-worktree-per-ticket rule: **sequential in one worktree**, S0 → S1 … S5 → S6, one commit per step; S7 can go first or last. Parallelization: 1 lane, 0 parallel / 8 sequential.

## Implementation Tasks
- [ ] **T1 (P1, human: ~1h / CC: ~10min)** — db seam — Add plan, dataset, demoData slots and new methods to interfaces + provider
  - Surfaced by: Scope Challenge #1/#2/#5; D2–D5
  - Files: src/db/interfaces.ts, src/db/provider.ts, src/db/__tests__/provider.test.ts
  - Verify: `npm run typecheck`; provider.test.ts
- [ ] **T2 (P1, human: ~1h / CC: ~10min)** — planning — Route usePlanQueries through getRepositories()
  - Surfaced by: ticket AC3; plan step 4–5
  - Files: src/hooks/usePlanQueries.ts, src/hooks/__tests__/usePlanQueries.test.tsx
  - Verify: `npx vitest run src/hooks/__tests__/usePlanQueries.test.tsx`
- [ ] **T3 (P1, human: ~4h / CC: ~30min)** — retainers — Fold matching/due-state/missed/summary into repo contracts
  - Surfaced by: Scope Challenge #1; D3 A
  - Files: src/db/retainerRepository.ts, src/hooks/useRetainerQueries.ts, src/db/__tests__/retainerRepo.test.ts, src/hooks/__tests__/useRetainerQueries.test.tsx
  - Verify: retainerRepo + useRetainerQueries tests; retainer matching drawer smoke on preview
- [ ] **T4 (P1, human: ~1 day / CC: ~50min)** — whole-database — Create dataset slot; move export/import/wipe/backup/integrity/orphan callers; importLegacyV1 in one transaction
  - Surfaced by: Scope Challenge #2/#5; D4 B, D5 A, D8 B
  - Files: src/db/dataset.ts (new), backup.ts, seed.ts, profileImport.ts, integrityCheck.ts, orphanedRecords.ts, ExportDataModal.tsx, DeleteAllDataModal.tsx, ImportDataPage.tsx, utils/csvImport.ts, DataToolsSection.tsx, OrphanedRecordsBanner.tsx, useOrphanedRecords.ts, src/db/__tests__/dataset.test.ts (new)
  - Verify: characterization tests red-first, then green after the move; ImportExportModals/ImportDataPage/csvImport/DataToolsSection tests
- [ ] **T5 (P1, human: ~4h / CC: ~30min)** — demo — Create demoData slot; move seedData/visitorSample storage
  - Surfaced by: Scope Challenge #2; D4 B
  - Files: src/db/demoData.ts (new), src/demo/seedData/index.ts, src/demo/visitorSample.ts, src/db/__tests__/demoData.test.ts (new)
  - Verify: visitorSample tests + T7; `?demo=1` and `?sample=1` smoke on preview
- [ ] **T6 (P1, human: ~2h / CC: ~15min)** — small slots — listNeedsReview/assignProfile, getCrossProfileStats, seedDefaults
  - Surfaced by: Scope Challenge #2/#5; D4 B, D5 A
  - Files: src/db/repository.ts, src/db/expenseRepository.ts, MigrationWizard.tsx, ClientsPage.tsx, useExpenseQueries.ts, new tests T6/T8
  - Verify: new tests + ClientsPage.test
- [ ] **T7 (P1, human: ~1h / CC: ~10min)** — guard — App-scope ESLint seam rule + lint-config test
  - Surfaced by: Scope Challenge #3; D6 A
  - Files: eslint.config.js, src/main.tsx, src/__tests__/seamLint.test.ts
  - Verify: `npm run lint` green; T10
- [ ] **T8 (P2, human: ~2h / CC: ~20min)** — tests — Bounded root-cause of the IncomeDrawer load race
  - Surfaced by: Test review R7; D9 A
  - Files: src/components/__tests__/IncomeDrawer.test.tsx (+ drawer if the race is real)
  - Verify: full `npm run test:run` green twice in a row
- [ ] **T9 (P2, human: ~1h / CC: ~10min)** — docs — CLAUDE.md Phase 4 (D1 + D7), TODOS (item 2 out, 3 new), knowledge files, ADR, TD-013 rewrite
  - Surfaced by: ticket AC1/AC4; D1, D7, D8
  - Files: CLAUDE.md, TODOS.md, .claude/{CHANGELOG,DECISIONS,PATTERNS,TEST_PLAN,TECH_DEBT}.md
  - Verify: AC1: the four Phase 4 commands green under Node 22; main-chunk gz delta recorded

## Completion summary
- Step 0: Scope Challenge — scope accepted as-is (then expanded by D2–D7 approvals; no reduction)
- Architecture Review: 0 issues found
- Code Quality Review: 0 issues found
- Test Review: diagram produced, 13 gaps identified (all mapped to T1–T11), plus R6 regression contract and R7 flake
- Performance Review: 1 issue found (bundle delta, informational)
- NOT in scope: written
- What already exists: written
- TODOS.md updates: 3 items (approved via D8)
- Failure modes: 0 critical gaps flagged
- Unresolved decisions: 0 in this review
- Outside voice: codex, unavailable (CLI not installed; native fallback lacks TaskOutput)
- Parallelization: 1 lane, 0 parallel / 8 sequential
- Lake Score: 8/8 (D2 B, D3 A, D4 B, D5 A, D6 A, D7 A, D8 B, D9 A each picked the 10/10 option; D1 had no completeness score)

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Outside Review | codex via `/plan-eng-review` | Independent 2nd opinion | 17 | unavailable | CLI not installed |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 16 | ISSUES OPEN | 14 issues, 0 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 for this plan | — | no UI change |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **OUTSIDE COVERAGE:** codex, plan-review phase, unavailable (not installed; native fallback unavailable). No outside findings.
- **VERDICT:** No review CLEAR for this plan; all 14 issues are mapped to approved tasks T1–T9. eng review required (status issues_open by definition: findings exist, all resolved into scope).

NO UNRESOLVED DECISIONS
