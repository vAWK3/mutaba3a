# MUT-88 — Settings in five groups, one home per action, Delete all data set apart

**Ticket:** MUT-88 (epic MUT-74, decision S1 in `landing-apple-redesign.md`)
**Status:** Plan, 2026-10-13. Not built.
**Builds on:** MUT-139 (ADR-063 order, ADR-064 cards and SegmentedControl), MUT-73 (sync gone), MUT-145/158 (one-business export and import fixed).

## What MUT-139 already shipped (don't redo)

- The Sync row is gone (MUT-73), so the AC "Sync row not carried over" holds already. A test locks it in.
- About, Updates and Desktop App sit under one heading (`AboutSection`).
- Data Tools sits inside the 600px column (ADR-064 §4).
- Language, Theme and Currency share one card ("Preferences").

## Basel's calls (2026-10-13)

| # | Decision | Chosen over |
|---|---|---|
| D1 | **Order: Businesses → General → Features → About → Your data → Delete all data (alone, set apart).** This keeps ADR-063's spine (Businesses first, Data last) and adds the separate Delete zone. | S1's literal order (General first, About last) |
| D2 | **Your data: one Back up, one Restore, plus Export a business.** Back up saves the whole database and shows "Last: <date>". Restore takes one file and works out its type: a full backup replaces everything after a confirmation; a one-business JSON or a CSV opens the import page with that file already loaded. Export a business… (CSV/JSON, `ExportDataModal`) stays as its own row, because it does a different job. Export receipts and Check data stay. | Backup only (drop the per-business export); one Back up with a format picker |

## Defects found while planning (in scope; the ACs need them)

1. **The "back up first" step in Delete all data saves three CSVs** (clients, projects, transactions). Restore can't read that file, and it leaves out businesses, expenses, receipts and payments. The user thinks they're protected but they aren't. Fix: the step calls the shared `backUpNow()`, which writes a real, restorable backup.
2. **Two Default badges.** The repo's create, update and setDefault calls clear the other defaults, but not inside a transaction. Three paths skip the repo entirely: the demo seed (`bulkPut`), `importProfileFile({ makeDefault })` and `restoreFromBackup`. Seeding demo data over a real profile leaves two defaults.
3. **Two scroll areas.** `.page-content` carries an inline `maxWidth: 600`, so the scroll container is 600px wide and its scrollbar sits mid-window.
4. **Import Backup replaces everything without asking** (`DataToolsSection.handleImportBackup`).
5. About reads "Mutaba3a - Mini CRM". This is also on MUT-92's list; drop it there once this lands.

## Found, out of scope (follow-ups, not fixed here)

- **`deleteAllData()` clears 5 tables only** (`src/db/seed.ts:70`). Businesses, expenses, receipts, payment records and recurring rules survive "Delete all data". Filed as **MUT-164** (Bug, relates to MUT-88), per review D4.
- The registry lists a `ConfirmModal` that doesn't exist. Fix the registry entry; don't build the component.

## Plan

### 1. Data layer: exactly one default business (AC 4)

New `src/db/profileDefault.ts`:
- `pickDefaultProfileId(profiles, preferId?)`: a pure function (rule approved in review D2). Archived profiles never qualify. If exactly one active profile is default, it keeps that one. Otherwise it returns `preferId` if active; else, among the active defaults (or all active profiles if none is default), it ranks non-`demo_` before `demo_` (`DEMO_ID_PREFIX`), then the earliest `createdAt`; else `undefined`.
- `enforceSingleDefaultProfile(table, preferId?)`: runs inside the caller's transaction. It reads every profile, then calls `modify` so only the picked profile has `isDefault: true`.

Call sites (each one already runs in a transaction, or gets one):
- `businessProfileRepo.create` / `update` / `setDefault` / `archive` (`src/db/repository.ts:903-946`): wrap each in `db.transaction('rw', db.businessProfiles, …)` and replace the ad-hoc `modify({isDefault:false})` calls. `preferId` = the profile being made default.
- `seedDemoData` (`src/demo/seedData/index.ts:139`): call it inside the existing transaction. The `demo_` ranking means the user's own default wins, even when the welcome modal creates it between the seed's read (`:106`) and its write (review R2).
- `importProfileFile` (`src/db/profileImport.ts:79`): `preferId = makeDefault ? newId : undefined`.
- `restoreFromBackup` (`src/db/backup.ts:76`): call it inside the transaction, so an old backup that carries two defaults is repaired.
- **Dexie v22**: no schema change, just `upgrade(tx => enforceSingleDefaultProfile(tx.table('businessProfiles')))` to repair existing devices once. Follow the v21 pattern and `migration-v21.test.ts`. Bump anything `migration-safety.ts` keys on `verno`.

### 2. Back up / last backup date (AC 2)

- `Settings.lastBackupAt?: string` (ISO) in `src/types/index.ts`. It's not indexed, so no schema change.
- New `backUpNow()` in `src/db/backup.ts`: `exportBackup()`, then `settingsRepo.update({ lastBackupAt: nowISO() })`. The date is stamped only if the export didn't throw. A browser can't confirm that a download finished; MUT-90 owns that limit.
- After `restoreFromBackup`, set `lastBackupAt` to the backup's `timestamp`, because the restored data is exactly that backup.
- New `useBackUp()` mutation in `src/hooks/useQueries.ts`. It invalidates `['settings']`.
- Callers: Your data › Back up, DeleteAllDataModal step A, and `MigrationWizard` (it already calls `exportBackup`; switch it to `backUpNow` so its date counts too).
- Display: "Last backed up: 13 Oct 2026" via `Intl.DateTimeFormat(locale)`, or "Not backed up yet". Keys in en and ar.
- **MUT-90 coordination:** MUT-90 reads `lastBackupAt` and adds its own "changed since" signal. MUT-88 adds no reminder.

### 3. Restore: one entry point (AC 1)

- New `src/lib/dataFiles.ts` (review D1, smaller arrangement): `classifyDataFile(name, text)` returns `{ kind: 'fullBackup', timestamp, records } | { kind: 'businessExport' } | { kind: 'csv' } | { kind: 'unknown' }`. Move `isFullBackup` / `hasLegacyRows` / the v2 check out of `ImportDataPage.tsx` into it (DRY), so both places use one detector.
- In the same `src/lib/dataFiles.ts`: a module-level `setPendingImport(file)` / `takePendingImport()` (one slot, read once). `ImportDataPage` takes it in an effect gated on the profiles query succeeding (review A1, so the profile match sees real profiles), then feeds `handleFileSelect`, so the user doesn't pick the file twice.
- New `src/components/modals/RestoreBackupModal.tsx`: "Replace everything on this device with the backup from <date>? (<n> records)". It reuses the `DeleteAllDataModal.css` modal shell, plus the focus and Escape handling already in those modals. On confirm it runs `restoreFromBackup`, shows a toast, then reloads.
- Restore flow: pick a file (`.json,.csv`) → classify → fullBackup opens the modal; businessExport or csv sets the handoff and navigates to `/settings/import`; unknown shows a toast with `settings.restore.unknownFile`.

### 4. Page structure (AC 1, AC 3)

`SettingsPage.tsx` renders `<div className="settings-column">` inside `.page-content`, and drops the inline `maxWidth`. `.settings-column { max-width: 600px }` (left-aligned as today), so `.page-content` is the one full-width scroll area.

Sections, in order (each an `h2`; the a11y test still allows no `h3`):
1. **Businesses**: as today; title "Businesses".
2. **General**: the Preferences card renamed (`settings.preferences.title` → "General" / "عام"). Language, Theme, enabled and default currency.
3. **Features**: `AdvancedFeaturesSection`, title "Features" / "الميزات".
4. **About**: `AboutSection`; "Mutaba3a - Mini CRM" → "Mutaba3a".
5. **Your data**: new `src/pages/settings/YourDataSection.tsx`, which **replaces** both the inline Data block and `DataToolsSection`. Rows in order: Back up (Last: …) · Restore · Export a business… · Export receipts · Check data. The receipts and integrity handlers move over from `DataToolsSection` unchanged.
6. **Delete zone**: inline in `SettingsPage.tsx` (review D1). It sits outside any card, after a divider, with a quiet danger button "Delete all data…" that opens `DeleteAllDataModal`.

Removed: `DataToolsSection.tsx` (its test file moves to `YourDataSection.test.tsx`), `.settings-family`, `.settings-section-nested`, the inline Data block, the `handleImportBackup` duplicate, and the Export/Import duplicate rows. This reverses ADR-063 §2 ("DataToolsSection stays separate"): the reason given there was test churn, and moving the test file solves that.

### 5. Typed confirmation (AC 6)

`DeleteAllDataModal`:
- **Step A**: "Back up first" calls `useBackUp()` and produces a real JSON backup (defect 1). If that fails, Step B stays locked.
- **Step B**: replace the checkbox with a text field. The user types the word shown: `settings.data.deleteModal.confirmWord` = "DELETE" in English, "حذف" in Arabic. Pure function `isDeleteConfirmed(input, word)`: trims, and is case-insensitive for Latin text. The Delete button stays disabled until it returns true.

### i18n

Every new or changed string has en and ar keys: `settings.businesses.title`, `settings.preferences.title` (now General), `settings.features.title`, `settings.yourData.*` (title, backUp, lastBackup, never, restore, restoreDesc, exportBusiness, exportBusinessDesc), `settings.restore.*` (modal, unknownFile), `settings.data.deleteModal.confirmWord|confirmLabel`. Dates come from `Intl`. Arabic headings get no negative tracking. Amounts aren't touched.

## Tests (written first; plan file `.claude/designs/mut-88-settings-five-groups-tests.md`)

| AC | Test |
|---|---|
| 4 one default | `src/db/__tests__/profileDefault.test.ts`: the pick rules (none, one, two defaults → earliest, archived default skipped, `preferId` wins, all archived → none). `enforce` on fake-indexeddb. Repo create(isDefault) ×2 → 1; setDefault; archiving the default hands it on; demo seed over a user default keeps the user's; `importProfileFile({makeDefault:true})` → only the new one; restoring a backup with two defaults → 1. `migration-v22.test.ts`: two defaults at v21 → one after opening. |
| 2 last backup | `backup.test.ts`: `backUpNow` stamps on success and not on throw; restore sets `lastBackupAt` = backup timestamp. `YourDataSection.test.tsx`: "Last backed up: <date>" / "Not backed up yet", and the date updates after Back up. |
| 1 each action once | `SettingsPage.structure.test.tsx` (real sections, mocked hooks): every action's accessible name appears exactly once on the page (Back up, Restore, Export a business, Export receipts, Check data, Delete all data). `classifyDataFile` unit tests (full, v2, legacy, csv, garbage). Restore routing: full opens the confirm and then restore; csv/v2 does handoff + navigate; unknown shows the error toast. `ImportDataPage` consumes the handoff on mount. |
| 3 one scroll area | Structure test: every section is a descendant of `.settings-column`, and `.page-content` has no inline max-width. Checked in the browser with a screenshot. |
| order | `SettingsPage.a11y.test.tsx`: the heading list becomes Businesses, General, Features, About, Your data; then a DOM-order assertion that the Delete zone comes last and sits outside every `.settings-section`. |
| 5 no Sync | Structure test: no element matches /sync/i. |
| 6 typed confirm | `DeleteAllDataModal.test.tsx`: Delete stays disabled until the backup is done **and** the word is typed (en "delete" accepted, "DELET" rejected; ar "حذف"); step A calls `backUpNow`, not CSV export. `isDeleteConfirmed` unit tests. |

Gate (Node 22: `export PATH=/Users/basel/.nvm/versions/node/v22.23.1/bin:$PATH`): `npm run test:run` · `npm run typecheck` · `npm run lint` · `npm run test:bundles` · `npm run build`. Then check in the browser (EN and AR, light and dark, 1440 and 768).

## Quality bar

- **DRY:** one file-type detector, one backup action (three callers), one default-picking rule (eight writers). `DataToolsSection` and the inline Data block merge into one section; nothing is copied.
- **Testable:** the pick, classify and confirm rules are pure functions; enforce takes a Dexie table, so it runs inside any transaction.
- **Scale and cost:** profiles number in the single digits, so a full-table read in `enforce` is fine. No new queries on page load beyond the existing settings read. No dependency added.
- **Risk:** the Dexie v22 bump means a backup from v22 is refused by a v21 build (the existing rule). QA specs may name "Advanced features", "Data Tools" or "Import Backup": grep `qa/` and `e2e/` at build time and update them (MUT-160 is the precedent).

## Knowledge updates at build

- **ADR-071:** Settings Your data: one Back up, one type-sniffing Restore, the data layer owns "one default business", `lastBackupAt` lives on the settings row. It amends ADR-063 §2 and ADR-064 §4 (the Data Tools family is removed).
- **CHANGELOG, COMPONENT_REGISTRY** (YourDataSection, RestoreBackupModal, backUpNow, `lib/dataFiles`, enforceSingleDefaultProfile; drop DataToolsSection and the stale ConfirmModal), **TEST_PLAN**, **SYSTEM_OVERVIEW** (Settings).
- **PATTERNS:** a one-slot handoff module for passing a File across a route change.

---

# Eng review (/plan-eng-review, 2026-10-13)

**Target:** `.claude/designs/mut-88-settings-five-groups.md` (this plan, the version above this line). **Reviewer:** Claude (native). This plan is the design doc; gstack's design-doc finder returned an unrelated May 2026 doc, which was ignored.

## Scope Challenge

- **Already exists:** the repo's create/update/setDefault (`repository.ts:903-934`) and the demo seed's `existingDefault` guard (`seedData/index.ts:106`, `profile.ts:58`). `exportBackup` / `restoreFromBackup` (`backup.ts:42,61`). The import page's full-backup detection (`ImportDataPage.tsx:46`). `ExportDataModal`. The integrity check. The receipts ZIP.
- **Complexity:** about 15 changed files and 6 new modules (profileDefault, dataFileKind, importHandoff, RestoreBackupModal, YourDataSection, DeleteAllDataZone). The gate trips.
- **Search [Layer 1]:** a one-time data repair goes in `version(n).upgrade(tx)` and uses only `tx`. `on('ready')` blocks every open, so it's wrong for this ([Dexie.version()](https://dexie.org/docs/Dexie/Dexie.version()), [Dexie.on.ready](https://dexie.org/docs/Dexie/Dexie.on.ready)). The plan already does this.
- **TODOS.md:** nothing blocks this plan.
- **Factual corrections (no question):**
  - SC1: the gate command is `npm run test:run`, not `npx vitest run` (learning `mutaba3a-typecheck-script-now-exists`).
  - SC2: the plan said the demo seed writes a second default with no guard. It does have a guard, but it reads *outside* the transaction (`seedData/index.ts:106` reads; `:123` writes). A welcome-modal "Default Profile" created in that window gives two defaults. The data-layer fix still covers it; see R2.

## Decision ledger

### R1: Complexity: file arrangement
Finding: Scope Challenge, complexity gate, about 15 changed files and 6 new modules.
Plan baseline: Original plan (6 new modules).
Runtime evidence: n/a (arrangement only).
Comparison grid:
| Choice | Current | A Original | B Smaller |
|---|---|---|---|
| Delete zone | new `DeleteAllDataZone.tsx` | separate file | inline JSX in `SettingsPage.tsx` (~12 lines) |
| Classify and handoff | two modules (`db/dataFileKind.ts`, `lib/importHandoff.ts`) | two modules | one `src/lib/dataFiles.ts` (classify + one-slot handoff) |
| Other modules | profileDefault, RestoreBackupModal, YourDataSection | unchanged | unchanged |
| Features, ACs, tests | as planned | same | same |
Question D1: How many new files should MUT-88 add? Options: A) Original arrangement (6 new files), B) Smaller arrangement (recommended; 4 new files, the Delete zone inline, `lib/dataFiles.ts` = classify + handoff).
State: approved
Actual answer: B) Smaller arrangement (Basel, D1, 2026-10-13)
Accepted scope: New files: `src/db/profileDefault.ts`, `src/components/modals/RestoreBackupModal.tsx`, `src/pages/settings/YourDataSection.tsx`, `src/lib/dataFiles.ts` (`classifyDataFile` + `setPendingImport`/`takePendingImport`). The Delete zone is inline in `SettingsPage.tsx`. `DeleteAllDataZone.tsx`, `db/dataFileKind.ts` and `lib/importHandoff.ts` are not created. Features, ACs and tests are unchanged.
History: none

**Scope record:** feature answers: none proposed; structure: B (D1); accepted scope: plan as written, in the smaller arrangement; pending remedies: R2, R3. Scope Challenge result: scope accepted as-is.

### R2: Which profile keeps Default when two claim it
Finding: P1, confidence 8/10. Reviewer: Claude. `src/demo/seedData/index.ts:106` reads the existing default outside the transaction (`const existingDefault = !!(await db.businessProfiles.filter(...).first());`), and the write happens later at `:123`. `profile.ts:59` stamps `createdAt: now` when the rows are generated.
Plan baseline: with no `preferId`, `pickDefaultProfileId` keeps the earliest-created existing default, and the seed passes no `preferId`.
Runtime evidence: demo profiles are timestamped before their transaction runs. A welcome-modal "Default Profile" created in that window is *newer*, so "earliest default wins" would pick the sample profile over the user's own.
Comparison grid:
| Choice | Current plan | A | B |
|---|---|---|---|
| Tie-break rule | earliest-created default | the rule ranks non-demo profiles before `demo_` ones, then the earliest-created default, then the earliest-created active profile | unchanged; the seed re-reads a non-demo default inside its transaction and passes it as `preferId` |
| Race result | sample profile wins | user's profile wins | user's profile wins |
| Restore / v22 repair, with one demo and one real default | earliest wins (the demo one can win) | the real profile wins | earliest wins (the demo one can win) |
| Demo knowledge | none in the data layer | `profileDefault.ts` imports `DEMO_ID_PREFIX` | stays in the seed |
Question D2: Which profile keeps Default when two claim it? Options: A) Real profiles outrank sample (recommended), B) Fix only the seed.
State: approved
Actual answer: A) Real profiles outrank sample (Basel, D2, 2026-10-13)
Accepted scope: `pickDefaultProfileId(profiles, preferId?)`:
1. Exactly one active default → keep it (no-op).
2. Otherwise, `preferId` if it's active.
3. Otherwise, among the active defaults (or all active profiles if none is default): non-`demo_` before `demo_`, then the earliest `createdAt`.
4. Archived profiles never qualify.

`profileDefault.ts` imports `DEMO_ID_PREFIX`. The rule applies to repo create/update/setDefault/archive, the demo seed (inside its transaction), `importProfileFile`, `restoreFromBackup` and the Dexie v22 repair.

Tests: the race (seed generated, then the welcome default, then the seed write) leaves the user's profile as default. A restored backup with a demo default and a real default leaves the real one. With exactly one default, nothing changes.
History: none

## Section 1: Architecture

Restore flow (approved D2-user, "One Restore + Export"):
```
[Restore] → <input type=file .json,.csv> → file.text()
   └─ classifyDataFile(name, text) ──┬─ fullBackup {timestamp, records}
                                     │     → RestoreBackupModal (date, count)
                                     │         ├─ Cancel → nothing changes
                                     │         └─ Replace → restoreFromBackup()
                                     │               ├─ ok   → enforceSingleDefault + lastBackupAt=timestamp
                                     │               │         (same tx), toast, reload
                                     │               └─ throw (newer version / bad JSON) → error toast, data untouched
                                     ├─ businessExport | csv → setPendingImport(file) → navigate /settings/import
                                     │     ImportDataPage: once profiles loaded → takePendingImport() → handleFileSelect(file)
                                     └─ unknown → toast settings.restore.unknownFile
```

- **A1** [P2] (confidence 7/10) `ImportDataPage.tsx:61` `const { data: existingProfiles = [] } = useBusinessProfiles();` and `:124` `findMatchingProfile(existingProfiles, …)`. A handoff taken at mount, before the profiles query resolves, matches nothing, so a one-business file the user meant to merge would default to "create". **Required implementation of the approved Restore behaviour (no question):** take the handoff in an effect gated on the profiles query succeeding. Take-once is StrictMode-safe, because the async state lands on the preserved fiber. Check `react-hooks/set-state-in-effect` (learning `feedback-react-hooks-v7-set-state-in-effect`): `handleFileSelect` awaits before it sets state.
- **A2** [P3] (8/10) `classifyDataFile` returns the parsed payload (`timestamp`, record count) so the JSON is parsed once and the modal can show the date and count. Implementation detail.
- **Failure per new path:** v22 upgrade throws → Dexie open fails. This is the existing behaviour for any upgrade, covered by the migration-test pattern. `backUpNow` export throws → no stamp, error toast (tested). Restore of a newer-version backup throws → toast, nothing cleared, because the version check runs before the transaction (`backup.ts:68`). No silent failures.

Dispositions: A1 accepted as required implementation of approved behaviour; A2 accepted as implementation detail.

## Section 2: Code quality

No issues found. Reuse checks: `ExportDataModal` stays as is. The integrity-check and receipts handlers move from `DataToolsSection` unchanged. `backUpNow` replaces three backup callers (YourData, DeleteAllDataModal step A, MigrationWizard) and deletes one copy-paste CSV exporter (`DeleteAllDataModal.tsx:51-79`, about 28 lines). `classifyDataFile` absorbs `isFullBackup` and `hasLegacyRows` from `ImportDataPage.tsx:46-53`.

## Section 3: Tests

```
CODE PATHS                                              USER FLOWS
[+] db/profileDefault.ts                                [+] Settings page
  ├─ pick: one default (no-op)          [GAP→new]         ├─ order Businesses…Your data, then Delete last  [extend a11y :130]
  ├─ pick: two defaults, real vs demo   [GAP→new]         ├─ each action exactly once                       [GAP→new structure test]
  ├─ pick: none default → earliest real [GAP→new]         ├─ one scroll area (.settings-column)             [GAP→new + browser]
  ├─ pick: preferId archived → ignored  [GAP→new]         └─ no Sync row                                    [GAP→new]
  └─ enforce in tx (fake-indexeddb)     [GAP→new]       [+] Your data
[+] repository create/update/setDefault/archive           ├─ Back up → "Last backed up" updates             [GAP→new]
  └─ existing businessProfileRepo.test.ts [★★ extend]      ├─ Back up fails → toast, date unchanged          [port DataTools :165]
[+] seed race / profileImport makeDefault / restore       ├─ Restore full → confirm → replace               [GAP→new]
  └─ one default after each             [GAP→new]          ├─ Restore full → Cancel → untouched              [GAP→new]
[+] Dexie v22 repair (migration-v22.test) [GAP→new]        ├─ Restore failure → localized error              [port :191]
[+] backup.ts backUpNow / restore stamp  [GAP→new]         ├─ Restore csv/v2 → import page preloaded         [GAP→new][→E2E optional]
[+] lib/dataFiles classify (5 kinds)     [GAP→new]         ├─ Check data clean/issues/plurals EN+AR          [port :117,:205,:226]
[+] DeleteAllDataModal                                     └─ Export receipts                                 [port]
  ├─ Delete disabled until backup + word [GAP→new]      [+] Delete all data
  └─ step A = JSON backup, not CSV       [GAP→new]        └─ typed word EN "DELETE"/AR "حذف"                [GAP→new]
COVERAGE: 0/22 new paths tested today (all planned) | regression ports: 5 DataToolsSection cases + 9 a11y cases
```
Tests made obsolete: `DataToolsSection.test.tsx` (moved, not deleted: its cases are ported to `YourDataSection.test.tsx`). The `:130` assertion "Business Profiles first and Data last" changes on purpose to the new order.

### R3: Regression contract for the Data Tools rewrite
Finding: CRITICAL (IRON RULE). `DataToolsSection.tsx` is deleted and the inline Data block is rewritten. Existing behaviour at risk: integrity-check wording (EN plurals, AR "label: {count}"), the backup success/failure toasts, the localized restore failure, the receipts count/disabled state, and the 9 `SettingsPage.a11y` cases (h2-only headings, currency toggles, segmented controls).
Plan baseline: the plan moves the test file but names no contract.
Question D3: Which existing behaviours must the rewrite keep? Options: A) Keep all; change only the listed (recommended), B) Keep only what the ACs touch.
State: approved
Actual answer: A) Keep all; change only the listed (Basel, D3, 2026-10-13)
Accepted scope:
- **Port every case:** all 6 `DataToolsSection.test.tsx` cases go to `YourDataSection.test.tsx` (labels, clean/issues reporting, backup success/failure toast, localized restore failure, EN plurals, AR "label: {count}"). All 9 `SettingsPage.a11y.test.tsx` cases stay.
- **Intended changes only:**
  - section titles and order: Businesses, General, Features, About, Your data, then Delete last, outside every card (`:130` rewritten);
  - the Import Backup row merges into Restore;
  - the Data Tools heading is removed;
  - Export Data becomes "Export a business…";
  - the delete checkbox becomes a typed word.
- **Added:** the new tests in the diagram above.

Test plan artifact: `~/.gstack/projects/vAWK3-mutaba3a/basel-main-eng-review-test-plan-20261013-211812.md`.
History: none

Dispositions (Section 3): 22 new paths planned, all accepted per the ACs and D2/D3; R3 approved.

## Section 4: Performance

No issues found. `enforceSingleDefaultProfile` reads the whole `businessProfiles` table (single digits of rows) once per profile write, seed, import or restore. That isn't a hot path. Page load adds one settings field and no new queries. `classifyDataFile` parses the picked file once.

## Outside voice

Codex is not installed (`CODEX_MODE: not_installed`). The native fallback needs TaskOutput, which this session doesn't have, so the outside voice is **unavailable** and gives no coverage credit.

### R4: "Delete all data" leaves 19 tables behind (TODO choice)
Finding: P2, confidence 9/10. `src/db/seed.ts:70-82` clears `transactions, projects, clients, categories, fxRates` only. Reviewer: Claude.
Plan baseline: out of scope, follow-up via `/pm-intake` + a TD entry.
Question D4: Track it or fix it here? Options: A) Track as follow-up (recommended), B) Skip, C) Build it now in MUT-88.
State: approved
Actual answer: Other: "file it in its own ticket" (Basel, D4, 2026-10-13)
Accepted scope: Filed **MUT-164** (Bug, Backlog, relates to MUT-88), with the table list, the open decisions and the ACs. No TD entry and no TODOS.md entry; MUT-88 doesn't change what Delete clears.
History: none

Approval readiness: PASS. R1 (D1 = B), R2 (D2 = A), R3 (D3 = A), R4 (D4 = own ticket, MUT-164). A1 and A2 are required implementation of Basel's "One Restore + Export" answer (pre-review, 2026-10-13). SC1 and SC2 are factual corrections.

## NOT in scope

- What Delete all data clears: MUT-164.
- The backup reminder, desktop auto-backup and "changed since": MUT-90. It reads `lastBackupAt` from here.
- Manual FX rates in General: still unbuilt (ADR-063 §3); needs its own design.
- An Enabled-currencies toggle for EUR/JOD: TD-107.
- Moving `/settings/import` onto `TopBar` + breadcrumb: TD-108.
- The other craft fixes on MUT-92. Only the About name moves here; drop that bullet from MUT-92 when this lands.

## What already exists

- `exportBackup` / `restoreFromBackup` (`src/db/backup.ts`): reused. `backUpNow` wraps them and isn't a rewrite.
- `ExportDataModal`: reused as is behind "Export a business…".
- `ImportDataPage` and its `handleFileSelect`: reused. It gains only the handoff intake, and its detectors move to `lib/dataFiles`.
- `runIntegrityCheck` and `exportAllProfilesReceiptsAsZip`: reused, and their handlers move unchanged.
- The repo's default handling (`repository.ts:903-946`): replaced by one rule (`profileDefault.ts`), not duplicated.
- The demo seed's `existingDefault` guard: kept; the data-layer rule backs it up.
- `SegmentedControl`, `.settings-section` cards (ADR-064) and `AboutSection` (ADR-063): reused.

## Failure modes

| Path | Realistic failure | Covered by | User sees |
|---|---|---|---|
| Back up | the browser blocks the download, or serializing throws | try/catch, no stamp, error toast (test) | "Backup failed" |
| Restore (full) | a backup from a newer version, or bad JSON | the version check runs before the clear (test) | localized error; data untouched |
| Restore (handoff) | the profiles query hasn't loaded yet | gated effect (A1, test) | the preview matches the right profile |
| Restore (unknown) | junk file | classify → unknown (test) | "This file isn't a Mutaba3a backup or export" |
| v22 repair | upgrade throws | Dexie open fails, as for any upgrade; migration test | the existing open-error path |
| Typed delete | Arabic word with stray spaces | trim (test) | the button enables |

Critical gaps: 0.

## Worktree parallelization strategy

Sequential implementation, no parallelization opportunity. One module (Settings plus its data helpers), and every UI step depends on `profileDefault` and `backUpNow`.

## Implementation Tasks
Synthesized from this review's findings. Each task derives from a specific
finding above. Run with Claude Code or Codex; checkbox as you ship.

- [ ] **T1 (P1, human: ~3h / CC: ~15min)** — data — `profileDefault.ts` (D2 rule) wired into repo, seed, profileImport, restore, plus the Dexie v22 repair
  - Surfaced by: R2 / Scope Challenge SC2. The seed reads outside its transaction (`seedData/index.ts:106`).
  - Files: src/db/profileDefault.ts, src/db/repository.ts, src/demo/seedData/index.ts, src/db/profileImport.ts, src/db/backup.ts, src/db/database.ts, src/db/__tests__/profileDefault.test.ts, src/db/__tests__/migration-v22.test.ts
  - Verify: `npm run test:run -- profileDefault migration-v22 businessProfileRepo profileImport`
- [ ] **T2 (P1, human: ~2h / CC: ~10min)** — data — `lastBackupAt`, `backUpNow`, `useBackUp`; restore stamps the backup's timestamp
  - Surfaced by: AC 2, plan §2
  - Files: src/types/index.ts, src/db/backup.ts, src/hooks/useQueries.ts, src/components/modals/MigrationWizard.tsx, src/db/__tests__/backup.test.ts
  - Verify: `npm run test:run -- backup`
- [ ] **T3 (P1, human: ~3h / CC: ~15min)** — settings — `lib/dataFiles` (classify + handoff), `RestoreBackupModal`, and the ImportDataPage intake gated on profiles
  - Surfaced by: A1, A2, D1
  - Files: src/lib/dataFiles.ts, src/components/modals/RestoreBackupModal.tsx, src/pages/settings/ImportDataPage.tsx, tests alongside
  - Verify: `npm run test:run -- dataFiles ImportDataPage RestoreBackupModal`
- [ ] **T4 (P1, human: ~4h / CC: ~20min)** — settings — `YourDataSection`, the page order, `.settings-column`, the inline Delete zone, the DeleteAllDataModal typed word plus a real backup step; delete `DataToolsSection`
  - Surfaced by: ACs 1, 3, 5, 6; R3
  - Files: src/pages/settings/{SettingsPage,YourDataSection,AboutSection}.tsx, src/components/modals/DeleteAllDataModal.tsx, src/index.css, en.json, ar.json, __tests__ (ported per D3)
  - Verify: `npm run test:run -- settings DeleteAllDataModal`, then lint, typecheck, test:bundles, build; browser EN/AR, light/dark
- [ ] **T5 (P2, human: ~1h / CC: ~5min)** — qa — grep `qa/` and `e2e/` for "Advanced features", "Data Tools", "Import Backup", "Export Data" and update the selectors
  - Surfaced by: the MUT-160 precedent
  - Files: qa/specs/**, e2e/**
  - Verify: run the affected specs on a preview build
- [ ] **T6 (P2, human: ~1h / CC: ~5min)** — knowledge — ADR-071 (amends ADR-063 §2 and ADR-064 §4), CHANGELOG, COMPONENT_REGISTRY (and drop the stale ConfirmModal), TEST_PLAN, SYSTEM_OVERVIEW, PATTERNS (one-slot handoff)
  - Surfaced by: the CLAUDE.md knowledge protocol
  - Verify: the files are updated in the docs(knowledge) commit

## Completion summary

- Step 0: Scope Challenge — scope accepted as-is (smaller arrangement, D1)
- Architecture Review: 3 issues found (R2, A1, A2)
- Code Quality Review: 0 issues found
- Test Review: diagram produced, 1 gap identified (R3 regression contract; 22 planned paths)
- Performance Review: 0 issues found
- NOT in scope: written
- What already exists: written
- TODOS.md updates: 1 item proposed to user (D4 → its own Jira ticket, MUT-164)
- Failure modes: 0 critical gaps flagged
- Unresolved decisions: 0 in this review
- Outside voice: codex, unavailable (not installed; native fallback lacks TaskOutput)
- Parallelization: 1 lane, 0 parallel / 1 sequential
- Lake Score: 2/2 (D2 and D3 picked the 10/10 option)

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Outside Review | codex via `/plan-eng-review` | Independent 2nd opinion | 14 | unavailable | codex not installed; no outside coverage |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 13 | ISSUES OPEN | 4 issues, 0 critical gaps (all resolved: D1–D4) |
| Design Review | `/plan-design-review` | UI/UX gaps | 3 (other tickets) | — | not run for MUT-88 |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **OUTSIDE COVERAGE:** codex, plan-review phase, unavailable (not installed); native fallback unavailable (no TaskOutput). No findings.
- **VERDICT:** Eng review complete, with every issue resolved into the plan (ISSUES OPEN = mapped work, not failure). No review is CLEAR, so eng review is still required to clear. Ready to implement via `/eng-build MUT-88`.

NO UNRESOLVED DECISIONS
