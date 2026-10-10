# Design Brief — MUT-12: Per-feature Advanced toggle in Settings, off by default

- **Date:** 2026-10-10
- **Epic:** MUT-2 "Strip to the core: delete dead surface, gate the optional"
- **Blocks:** MUT-13 (invoices/retainers), MUT-14 (expenses), MUT-15 (sidebar), MUT-16 (insights/planning/suppliers/projects)
- **Blocked by:** nothing. MUT-10 / MUT-11 (deletions) merged to `main` as 3c1058f before this ticket started.
- **Worktree:** `.claude/worktrees/mut-2-strip-core` (branch `feature/mut-2-strip-core`, recreated from `main` 3c1058f on 2026-10-10 after the previous epic worktree was removed at the MUT-10/11 merge), per the one-worktree-per-epic rule.
- **Status:** planned and eng-reviewed 2026-10-10 (§11); building under the owner's standing instruction to engineer MUT-12 → 13 → 14 → 16.

---

## 1. Problem and acceptance criteria

Seven optional areas (invoices/receipts, retainers, expenses, insights, planning, suppliers, projects) all sit in the product at once, which is what made it read as a sprawling CRUD app. The 2026-10-05 intake decided they stay as **optional**: present when wanted, invisible otherwise. This ticket builds the switchboard; the gating stories (MUT-13/14/15/16) consume it.

Acceptance criteria (from the ticket, verbatim intent):

1. Fresh install: every optional feature is off and only the core product is reachable.
2. Existing install with data in an optional area: that area is auto-enabled on first run after upgrade, and the user is told once.
3. Toggling takes effect immediately, no restart.
4. Preference survives reload and app restart.
5. `useFeatureEnabled` is the only read path; no component reads the raw settings object for this.
6. Dexie migration is forward-only, leaves existing settings intact, schema version bumped correctly.
7. Turning a feature off never deletes data and never hides data that cannot be reached another way (verified against seeded data).
8. Tests: default-off, auto-enable-on-existing-data, persistence, immediate effect, migration from the previous schema version.

"Only the core product is reachable" (AC 1) is delivered by the gating stories; this ticket makes it *true by configuration* (all flags false) and *provable* (the read path exists and is tested). Nothing is gated here — ticket scope says so.

## 2. Where it lives (Clean placement in this repo)

| Concern | File | Why there |
|---|---|---|
| Feature vocabulary, defaults, resolution, data probes, reconcile | `src/lib/features/features.ts` (new) | Pure, no React, no `db/` import; importable from `database.ts` (upgrade) without a cycle (§11 A1) |
| React read/write path + router read path | `src/lib/features/useFeatures.ts` (new) | Hooks live beside their store/lib; exports `useFeatureEnabled`, `useFeatureFlags`, `useSetFeatureEnabled`, `useFeatureNotice`, `readFeatureFlags` |
| Persistence | `Settings.features` on `src/types/index.ts:110`; `settingsRepo` in `src/db/repository.ts:703` | Ticket says: typed map on the existing `Settings` entity, not seven booleans |
| Migration | `src/db/database.ts` `this.version(20).upgrade(...)` | Convention: v18 did a data migration in `.upgrade()`; runs exactly once, transactionally, only on upgrade — fresh installs skip it, which is exactly AC 1 vs AC 2 |
| Reconcile after a bulk data load | `src/db/migration-safety.ts` `restoreFromBackup`, `src/components/modals/ImportDataModal.tsx`, `src/pages/settings/ImportDataPage.tsx`, `src/demo/seedData/index.ts`, `src/components/sync/ImportBundleModal.tsx` | These rewrite the settings row or add optional-area rows after the upgrade has run (§11 A2, outside voice F3) |
| UI | `src/pages/settings/AdvancedFeaturesSection.tsx` (new, rendered by `SettingsPage`), `src/components/ui/Switch.tsx` (new), `src/components/layout/FeatureNoticeBanner.tsx` (new, mounted by `AppShell`) | A section, not a second settings screen (ticket guardrail); no switch component exists in `components/ui`; the notice is a dismissible banner (outside voice F2) |
| i18n | `src/lib/i18n/translations/{en,ar}.json` under `settings.features.*` | Existing key tree |

## 3. Data model

```ts
// src/lib/features/features.ts
export const FEATURE_KEYS = [
  'invoices', 'retainers', 'expenses', 'insights', 'planning', 'projects',
] as const; // suppliers folded into expenses — D7 (revised)
export type FeatureKey = typeof FEATURE_KEYS[number];
export type FeatureFlags = Readonly<Record<FeatureKey, boolean>>;
export const DEFAULT_FEATURES: FeatureFlags = { every key: false };

/** Tolerant resolver: missing keys → default, unknown keys → dropped, non-boolean → false. */
export function resolveFeatures(stored?: Partial<Record<string, unknown>> | null): FeatureFlags;
/** Pure merge used by every writer. */
export function withFeature(flags: FeatureFlags, key: FeatureKey, enabled: boolean): FeatureFlags;

// src/types/index.ts
export interface Settings {
  id: string;
  enabledCurrencies: Currency[];
  defaultCurrency: Currency;
  defaultBaseCurrency: Currency;
  /** Optional areas, off unless the user (or the v20 upgrade / an import) turned them on. */
  features?: Partial<Record<FeatureKey, boolean>>;
  /** Set when areas were auto-enabled; cleared once the user has been told. */
  featureNotice?: FeatureKey[];
}
```

- `features` is **optional on the row** so an imported pre-v20 backup and a settings row written by an older build both resolve to defaults instead of crashing. `settingsRepo.get()` always returns a **fully resolved** `features` map, so callers never see `undefined`.
- `featureNotice` carries the "tell the user once" state in the same row — no `localStorage`, survives restart, cleared by the first render that shows it. Chosen over a persisted zustand store (`onboardingStore` pattern) because the notice is a consequence of a *data* event (migration or import) and should live with it.
- One `DEFAULT_SETTINGS` constant in `src/db/defaultSettings.ts` (imports only types, so `features.ts` can use it without a cycle) replaces the two duplicated literals in `repository.ts:709` and `seed.ts:28` (§11 C1). `settingsRepo.get()` returns `ResolvedSettings = Settings & { features: Record<FeatureKey, boolean> }` (outside voice F10).
- No Dexie index changes: `settings: 'id'` stays. v20 is `this.version(20).upgrade(...)` with no `.stores()` (Dexie 4 carries the schema forward; `Version.upgrade` is declared independently of `stores` in `dexie.d.ts:801-804`).

## 4. Migration (v19 → v20) and reconcile — auto-enable on existing data

```ts
this.version(20).upgrade(async (tx) => {
  try {
    await reconcileFeaturesWithData(tx);     // features.ts; tx satisfies TableReader
  } catch (error) {
    console.error('[db] v20: could not auto-enable optional areas:', error); // never block open (F7)
  }
});
```

`reconcileFeaturesWithData(reader)` is one function used by the upgrade **and** after restore/import (§11 A2, D9):

1. `enabled = detectFeaturesWithData(reader)` — probes below, each "any live row".
2. If nothing is newly enabled (every detected key already true), return without writing.
3. Otherwise `put` the settings row (created from `DEFAULT_SETTINGS` if absent) with `features = resolved ∪ enabled` and `featureNotice = newly enabled keys` (merged with any pending notice).

It **only ever enables**; a user's explicit "off" is overridden only when data for that area is imported or discovered, which is the same promise as AC 2 ("data you have is visible").

| Feature | Tables | Live means |
|---|---|---|
| invoices | `documents` | `!deletedAt` |
| retainers | `retainerAgreements` | any row (archived counts) |
| expenses | `expenses`, `vendors` | expenses `!deletedAt`, or any vendor row (vendors are the expenses module's table) |
| planning | `plans` | any row (archived counts) |
| projects | `projects` | any row — `Project` has `archivedAt` only and `projectRepo.delete` hard-deletes (outside voice F4) |
| insights | — (empty probe list, with a comment) | never auto-enabled: it owns no data (reports are derived) |

Archived rows count as data: the user created them and can still reach them inside the area; only soft-deleted rows do not.

Properties: forward-only; the upgrade is idempotent by construction (Dexie runs it once per database) and the reconcile is idempotent by step 2; never touches other rows; a fresh install creates the DB at v20 and never runs the upgrade (all flags stay off, no notice); probes stop at the first live row, so cost is one short scan per table, once per upgrade/import.

Call sites of the reconcile besides the upgrade, all through the swallowing `reconcileFeaturesAfterDataLoad(source, db)`: end of `restoreFromBackup` (its boolean result is unaffected by a failure, which is logged; callers reload), after every import mode in `ImportDataModal` and `ImportDataPage` (they invalidate all queries), after the demo seed in `src/demo/seedData/index.ts` (the modal reloads), and after `importBundle` in `ImportBundleModal` (invalidates `['settings']`). **Invalidation contract:** a path that writes features outside `useSetFeatureEnabled` invalidates `['settings']` or reloads, otherwise the sidebar can lag the route guard by the 60 s `staleTime` (outside voice F9).

## 5. Read and write paths

- `useFeatureEnabled(key): boolean` — `useSettings()` → `resolveFeatures(data?.features)[key]`. Returns `false` while settings load (a gated entry appears *after* load rather than flashing in and out; settings are one tiny Dexie row, cached by TanStack Query for the session).
- `useFeatureFlags(): FeatureFlags` — the whole map, for the Settings section and `SidebarNav` (MUT-15); memoised on the row so the reference is stable between renders with the same data.
- `useSetFeatureEnabled()` — mutation `{ key, enabled }` → `settingsRepo.update({ features: withFeature(current, key, enabled) })`, invalidates `['settings']`. Immediate effect follows from every consumer reading through the query cache (AC 3). The repository contract `update(Partial<Settings>)` is unchanged, so `ISettingsRepository` and the `satisfies` check in `provider.ts` do not move (§11 C2).
- `readFeatureFlags(): Promise<FeatureFlags>` — `getRepositories().base.settings.get()` → resolve. For `beforeLoad` redirects in MUT-13/16 ("without a flash of the page rendering first"). Reads Dexie directly, so a toggle is visible to the next navigation with no cache plumbing; Dexie queues the read behind open/upgrade, so racing `initDatabase()` is safe (§11 A4).
- `useFeatureNotice()` — returns the pending `featureNotice`, `isLoaded`, and a `dismiss()` that clears it through the repository and invalidates. `FeatureNoticeBanner` (mounted once in `AppShell`, above the page content beside `OrphanedRecordsBanner`) renders it as a dismissible banner with the area names and an "Open settings" link; the notice is cleared **only on dismiss**, so it survives a missed glance, a reload and a restart, and rendering is idempotent (no StrictMode guard needed). Replaces the toast of the first draft (outside voice F2).

Rule enforced by review (and a convention note in PATTERNS.md): components never read `settings.features` directly.

## 6. UI

New `settings-section` "Advanced features" placed after Currency and before Data (optional areas belong with preferences, not with destructive data tools). One `settings-row` per feature: label + one-line description on the left, `Switch` on the right. Order follows `FEATURE_KEYS`. Copy (en / ar drafts, native review is an open follow-up like the Money strings):

| key | label | description |
|---|---|---|
| invoices | Invoices and receipts / الفواتير والإيصالات | Create numbered documents from income entries / إنشاء مستندات مرقّمة من قيود الدخل |
| retainers | Retainers / العقود الشهرية | Recurring agreements with projected income / اتفاقيات متكررة مع دخل متوقع |
| expenses | Expenses / المصروفات | Track money out in a single ledger, with the vendors you pay / تتبّع المصروفات في سجل واحد، مع المورّدين الذين تدفع لهم |
| insights | Insights / التحليلات | Reports and trends across clients and months / تقارير واتجاهات عبر العملاء والأشهر |
| planning | Planning / التخطيط | Scenarios and assumptions for the months ahead / سيناريوهات وافتراضات للأشهر القادمة |
| projects | Projects / المشاريع | Group income entries under a project / تجميع قيود الدخل تحت مشروع |

Section intro: "Optional areas. Off by default; turning one off hides it but never deletes its data." The `Switch` is a `<button role="switch" aria-checked>` using logical CSS properties (`inset-inline-start`) so it mirrors in RTL; focus ring via `var(--focus-ring)` (PATTERNS.md).

## 7. Decisions

| # | Decision | Rationale |
|---|---|---|
| D1 | Flags live on `Settings.features` as a typed partial map; `settingsRepo.get()` returns it fully resolved | Ticket requirement; tolerant of old rows and imported backups; adding an area is one key in `FEATURE_KEYS` |
| D2 | Auto-enable runs in Dexie `version(20).upgrade()` | Exactly-once, transactional, skipped on fresh installs — matches AC 1 and 2 without a "first run" flag; same pattern as v18 |
| D3 | `insights` is never auto-enabled | It owns no data; auto-enabling it would contradict "fresh-feeling core" for users who never used reports |
| D4 (revised) | The "told once" state is `Settings.featureNotice`, shown by `FeatureNoticeBanner` in `AppShell` and cleared **only on dismiss** | Lives with the data event that produced it; no `localStorage`. First draft was a toast cleared on show; the outside voice (F2) showed a 3 s toast on the first launch after upgrade, beside welcome/migration modals, is "told" only technically |
| D5 | Two read paths, one resolver: `useFeatureEnabled` (React) and `readFeatureFlags` (router `beforeLoad`) | AC 5 names the hook as *the* component read path; route guards are not components and MUT-13/16 require redirect-before-render |
| D6 | New `Switch` UI component | None exists (`components/ui` has no toggle); a switch is semantically a switch, not two buttons; registered in COMPONENT_REGISTRY |
| D7 (revised) | **Six keys; `suppliers` folds into `expenses`** | The ticket lists seven, but `vendors` is the expenses module's table (`Expense.vendorId`) and `/suppliers` is a second view over the same rows (outside voice F5): a separate toggle would be auto-enabled for every expenses user, and MUT-14 deletes the `/suppliers` view anyway. Overrides the ticket's list; recorded on MUT-12/14/16 |
| D8 | `MiniCrmDatabase` gains an optional constructor `name` | Lets the v20 upgrade test open a v19 database under a unique name and upgrade it; production default unchanged |
| D9 | `reconcileFeaturesWithData()` runs after restore and every import mode; it only ever enables | §11 A2: a restored pre-v20 backup must not hide the user's invoices/projects |
| D10 | Two-module arrangement (`features.ts` pure incl. probes; `useFeatures.ts` React + repo) | Keeps `database.ts`'s import graph acyclic; fewer files than first planned |
| D11 (revised) | One `DEFAULT_SETTINGS` constant in `src/db/defaultSettings.ts` | §11 C1; the brief first said `repository.ts`, which would re-create the cycle A1 removed (outside voice F11) |
| D12 | ADR number for this ticket is **ADR-030** | `main` holds ADR-028 (attachments) and ADR-029 (table retention, MUT-10/11) |
| D13 | Archived rows count as data; soft-deleted do not; projects any row | Outside voice F4: `Project` has no `deletedAt`; hiding an area whose only rows are archived would still hide user data |
| D14 | The v20 upgrade body is try/caught and never aborts the version change | Outside voice F7: there is no pre-migration backup, so a throwing upgrade would fail every launch with no recovery UI |
| D15 | Reconcile also after demo seeding and sync-bundle import; every such path invalidates `['settings']` or reloads | Outside voice F3/F9 |

## 8. Reuse, impact, i18n, cost

- **Reuse:** `useSettings` / `useUpdateSettings` (`hooks/useQueries.ts`), `settingsRepo`, `useToast` (`lib/toastStore.ts`), `settings-section` / `settings-row` CSS, repository seam (`setRepositories`) for hook tests. Nothing in COMPONENT_REGISTRY overlaps a switch.
- **Impact:** `Settings` type widens (optional fields only) — `ISettingsRepository` unchanged; `server/` untouched; sync untouched (settings are not synced); `backup.ts` round-trips the row unchanged; `migration-safety.ts` validation does not enumerate settings fields.
- **i18n:** every label/description via keys in both locales; RTL verified on the switch.
- **Cost:** one Dexie row read per flag consumer, served from the query cache; upgrade/import cost is six `first()` probes.
- **Out of scope (ticket):** gating any area, remote config, licensing.

## 9. Risks

- **R1 — Dexie version collision** with any concurrent ticket adding `version(20)`: whoever lands second renumbers; this ticket's `database.ts` change is its own checkpoint commit with the version number in the message.
- **R2 — Stale settings in the query cache after the notice is dismissed**: `dismiss()` invalidates `['settings']`.
- **R3 — `readFeatureFlags` races `initDatabase()`**: Dexie auto-opens on first access and queues the read behind the open/upgrade.

## 10. Build order (each step ends green)

1. `features.ts` (vocabulary, resolver, `withFeature`, probes, reconcile) with tests (red → green).
2. `Settings` type + `DEFAULT_SETTINGS` + `settingsRepo` resolution + tests.
3. `database.ts` v20 upgrade + `migration-v20.test.ts` (v19 → v20 on a named DB; fresh DB); reconcile wired into restore/import + tests.
4. `useFeatures.ts` hooks + `readFeatureFlags` with seam-injected tests.
5. `Switch` component + Settings section + i18n + page test; `AppShell` notice toast + test.
6. Knowledge files: CHANGELOG, COMPONENT_REGISTRY (Switch), PATTERNS (feature flags read path), DECISIONS (ADR-030), TEST_PLAN, TECH_DEBT (suppliers conflict), SYSTEM_OVERVIEW (Settings capability).
7. `npm run lint && npm run typecheck && npm run test:run && npm run build`.

## Business / product impact
- Makes the intake decision real: a new user sees a client-accounting tool, not thirty routes; existing users lose nothing because areas with data switch themselves on and say so once.
- Unblocks MUT-13, 14, 15, 16 — the whole "gate the optional" half of MUT-2 — and therefore the strip-down that MUT-26 said must precede any extraction.
- Risk framing: local preference only, no data path changes; the only irreversible act (schema v20) adds optional fields and never drops anything.

---

## 11. Engineering review (2026-10-10, `/plan-eng-review`, condensed run)

Run with the owner away: findings were resolved by the reviewer and are listed as **auto-decided** so any can be overridden before build. Scope Challenge → Architecture → Code quality → Tests → Performance → Outside voice.

### 11.0 Scope Challenge — scope accepted as-is, arrangement reduced

Complexity count: 5 new files + 7 modified in the original arrangement (gate trips at 8+). **Structure (auto-decided, `Smaller arrangement`):** two modules instead of four, same features and contracts: `src/lib/features/features.ts` (pure; imports only `type { Transaction } from 'dexie'`, no import from `db/`, so `database.ts → features.ts` is acyclic), `src/lib/features/useFeatures.ts` (hooks + `readFeatureFlags`, imports `getRepositories`), `src/components/ui/Switch.tsx` (+ `.css`). TODOS.md: nothing related; no entry blocks this plan.

### 11.1 Architecture

- **A1 [P1] (9/10)** `src/db/database.ts:912` `this.version(19).stores({` — the v20 `.upgrade()` lives in `database.ts`; if the probes imported `getRepositories` the chain `database.ts → provider.ts → repository.ts → database.ts` would be circular. **Resolved:** probes are pure over a `TableReader` (`{ table(name) }`, satisfied by both a Dexie `Transaction` and `db`); `readFeatureFlags` lives in the hook module. (auto-decided)
- **A2 [P1] (9/10)** `src/components/modals/ImportDataModal.tsx:351` and `src/pages/settings/ImportDataPage.tsx:305` `await db.settings.bulkAdd(fileData.settings …)` after `clearDatabase()`, and `src/db/migration-safety.ts:299-306` `table.clear(); table.bulkAdd(data)` for every table including `settings` — a backup or legacy export written by a pre-v20 build carries a settings row with no `features`; the v20 upgrade has already run on the (empty) database and never runs again, so a user restoring their data onto a fresh install lands with invoices, projects or expenses hidden behind off toggles. This defeats AC 2 for exactly the users most likely to upgrade by reinstalling. **Resolved:** D9 reconcile after restore and every import mode. (auto-decided — a flag is never turned *off* by data, so this cannot surprise anyone)
- **A3 [P2] (8/10)** `src/main.tsx:116-117` `<RouterProvider …/><ToastContainer />` — the toast store is global and `AppShell` mounts for every route, so one toast from `useFeatureNotice` is the right surface, but it must fire only once `useSettings` has data and must survive StrictMode's double effect. **Resolved:** effect keyed on the notice, clears before showing, ref guard; test added. (auto-decided)
- **A4 [P3] (7/10)** `readFeatureFlags()` opens Dexie on first call; Dexie queues the read behind open/upgrade, so a `beforeLoad` racing `initDatabase()` sees post-upgrade data. No change. (no action)

```
 install/upgrade          import / restore                 UI toggle
 ───────────────          ─────────────────                ─────────
 Dexie open ──v19→v20──▶ upgrade(tx)                       Switch ──▶ useSetFeatureEnabled
                │                                            │          │
                ▼                                            │          ▼
   reconcileFeaturesWithData(tx) ◀── same fn ── after bulkAdd┘   settingsRepo.update({features})
                │                                                       │
                ▼                                                       ▼
   settings.features += on, featureNotice = [..]  ──▶ invalidate ['settings']
                                                                        │
                       ┌────────────────────────────────────────────────┤
                       ▼                                                ▼
            useFeatureEnabled(key) / useFeatureFlags()        readFeatureFlags()
            (SidebarNav, Settings, entry points)              (router beforeLoad, MUT-13/16)
                       │
                       ▼
            useFeatureNotice → one toast → update({featureNotice: undefined})
```

- Failure modes: upgrade throws mid-probe → **corrected by the outside voice (F7)**: there is no pre-migration backup (`checkAndPrepareForMigration` backs up after Dexie opens), so an aborted version change would fail every launch; the upgrade body is therefore try/caught (D14) and only logs. Import/restore/demo/sync reconcile throws → the data load already succeeded, the failure is logged and the user can toggle manually (not silent; data reachable via Settings). No critical gaps.

### 11.2 Code quality

- **C1 [P2] (9/10)** `src/db/repository.ts:709-713` default settings literal and `src/db/seed.ts:28-33` the same literal — adding `features` would make a third copy. **Resolved:** one `DEFAULT_SETTINGS` constant. Shared-code rubric: two verified first-party callers, ~6 lines saved, one source of truth for a row every reader depends on. (auto-decided)
- **C2 [P2] (8/10)** `src/db/repository.ts:719` `put({ ...current, ...data, id: 'default' })` — a partial `features` object would *replace* the map, not merge it. **Resolved:** writers always pass a full map via `withFeature`; `get()` returns a resolved map so `current.features` is always complete; repository contract unchanged. (auto-decided)
- **C3 [P3] (7/10)** `insights` can never be auto-enabled; a reader of the probe table will look for it. **Resolved:** explicit `insights: null` entry with a comment; unit test asserts it. (auto-decided)

### 11.3 Tests

Framework: Vitest + jsdom + fake-indexeddb (`vitest.config.ts:18-20`, `src/test/setup.ts`). Existing coverage touched: `settingsRepo.test.ts` (extend), `provider.test.ts` (seam, reused), `ImportExportModals.test.tsx` (extend with the reconcile call).

```
CODE PATHS                                                    USER FLOWS
[+] src/lib/features/features.ts                              [+] Fresh install
  ├── resolveFeatures()                                          └── [GAP→§1,§4] all off, no toast
  │   ├── [GAP→§1] missing/null/{}                             [+] Upgrade with data
  │   ├── [GAP→§1] unknown key dropped                           ├── [GAP→§4] flags on + notice
  │   └── [GAP→§1] non-boolean → false                           └── [GAP→§8] one toast, cleared, no repeat
  ├── withFeature()            [GAP→§1]                        [+] Restore / import old backup
  ├── detectFeaturesWithData() [GAP→§2] per table, deleted rows  └── [GAP→§3b] reconcile enables, never disables
  └── reconcileFeaturesWithData() [GAP→§3b] no-op when nothing new
[+] src/db/database.ts v20 upgrade                             [+] Toggle in Settings
  ├── [GAP→§4] data → put merged row + notice                    ├── [GAP→§7] click → persisted → reflected
  ├── [GAP→§4] no settings row → created                         ├── [GAP→§5] immediate effect via cache
  └── [GAP→§4] nothing to enable → untouched                     └── [GAP→§6] keyboard Space/Enter, RTL
[+] src/db/repository.ts settingsRepo                          [+] Toggle off never deletes
  ├── get() resolved defaults     [★★ settingsRepo.test:15]      └── [GAP→§9] row counts unchanged
  └── update() preserves fields   [★★ settingsRepo.test:40]
[+] src/lib/features/useFeatures.ts                [GAP→§5 ×6]
[+] src/components/ui/Switch.tsx                   [GAP→§6]
COVERAGE today: 2/21 paths (10%) — every gap maps to a planned test in the companion test plan; none needs a production seam beyond setRepositories (exists).
```

Regression rule: `settingsRepo.get()` gains a `features` field; existing assertions use per-field `toBe`, so they keep passing; `restoreFromBackup` gains a trailing reconcile that must not change its boolean result on failure (test: reconcile throws → restore still returns true, error logged). Tests made obsolete: none.

### 11.4 Performance

- Probes: `filter(row => !row.deletedAt).first()` stops at the first live row; worst case one full scan of a table whose rows are all deleted, once per database at upgrade/import. Tables without `deletedAt` use `toCollection().first()`. Scale: single-user Dexie, thousands of rows. No finding.
- Read path: one cached query row; no per-render Dexie reads. No finding.

### 11.5 Outside voice

Codex is not installed on this machine, so gstack's outside coverage is **unavailable**; a native Plan subagent (same harness, fresh context) ran as the fallback on the third attempt (the first died on the session rate limit, the second lost its working directory when the previous epic worktree was removed). It verified Dexie 4.2.1 semantics (`version(n)` calls `stores({})` so a bare `.upgrade()` inherits the schema; `runUpgraders` skips everything when `oldVersion === 0`; the upgrade transaction spans every store) and the `readFeatureFlags` / `initDatabase` race, then raised twelve findings.

### 11.6 Outside-voice findings and dispositions

| # | Sev | Finding | Disposition |
|---|---|---|---|
| F1 | High | `features.ts` imported `db/database` lazily — the cycle A1 claimed to remove | **Fixed** before the report arrived: `reader` is a required argument of `reconcileFeaturesAfterDataLoad`; no `db/` import in `features.ts` |
| F2 | High | "Told once" was a 3 s toast cleared on show, on the busiest first launch | **Accepted** → D4 revised: `FeatureNoticeBanner`, cleared only on dismiss |
| F3 | Med | Reconcile missed the demo seed and the sync-bundle import; `clearDatabase()` clears only five tables | **Accepted** for demo + sync (D15). `clearDatabase()` is pre-existing debt → TD-020, flagged for the owner |
| F4 | Med | `projects` probe filtered `deletedAt`, a field `Project` does not have; archived rows undecided | **Accepted** → D13: any row for projects; archived counts everywhere; tests added |
| F5 | Med | `suppliers` is the wrong unit — vendors are the expenses table | **Accepted** → D7 revised: six keys, vendors switch expenses on; i18n and tests updated |
| F6 | Med | Projects off by default collides with onboarding, `+ Add → Project`, the income drawer's project field | **Recorded** in §12 as MUT-15/16 scope (not MUT-12 work); comment posted on MUT-16 |
| F7 | Med | "Covered by the migration-safety backup" was false; a throwing upgrade bricks open | **Accepted** → D14: upgrade body try/caught; §11.1 corrected |
| F8 | Low | Migration fixture had a `deletedAt` projects index that never existed; fresh-install assertion should go through `initDatabase` | **Accepted**: fixture uses the real v19 index string; `settingsRepo.test` asserts resolved flags after `initDatabase()` |
| F9 | Low | Cache vs Dexie read paths can disagree for 60 s after an out-of-hook write | **Accepted**: invalidation contract stated in §4 and PATTERNS; `ImportBundleModal` invalidates `['settings']`; the other paths reload or invalidate all |
| F10 | Low | `get()` promised a resolved map but the type said `Partial` | **Accepted**: `ResolvedSettings` return type; hooks still resolve defensively (seam fakes return raw rows) |
| F11 | Low | Plan said `DEFAULT_SETTINGS` lives in `repository.ts`; code has `defaultSettings.ts` | **Accepted**: D11 revised |
| F12 | Low | The reconcile was added to two near-identical legacy import copies | **Deferred** → TD-021 (extracting the import is MUT-12 scope creep; neither MUT-14 nor MUT-16 touches it) |

Cross-model note: both passes agreed on A2 (restore/import rewrite the row); the outside voice found the two call sites (demo, sync) and the probe/type mismatch the native pass missed.

## 12. Downstream for MUT-15 / MUT-16 (surfaced here, owned there)

With `projects` off by default, three core flows reference projects and must become flag-aware when the area is gated:

- `src/lib/onboardingStore.ts:4` — onboarding steps are `client → project → income`; skip the project step while projects is off (MUT-16, or MUT-15 if it owns onboarding copy).
- `src/components/layout/SidebarNav.tsx:199` — `+ Add → Project` navigates to `/projects`; MUT-15 already lists the conditional `+ Add` menu.
- `IncomeDrawer` project field (ten references) — hide or collapse the optional project tag while projects is off (MUT-16); `Transaction.projectId` data stays untouched either way, per the ticket.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Outside Review | native Plan subagent (Codex not installed) | Independent 2nd opinion | 1 | unavailable (native fallback completed) | 12 findings: 2 high, 5 medium, 5 low — 10 accepted, 1 recorded for MUT-15/16, 1 deferred (TD-021) |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | ISSUES OPEN → all mapped and built | 8 issues (A1–A4, C1–C3 + 1 perf-none), 0 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | — |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **OUTSIDE COVERAGE:** provider codex, phase plan-review, **unavailable** (CLI not installed); native in-host fallback **completed** with the findings in §11.6. Not outside coverage in gstack's sense.
- **CROSS-MODEL:** not applicable (no completed external review; the native fallback runs in the same harness).
- **VERDICT:** ENG review complete with every finding dispositioned; built and verified (2,088 tests pass, 18 pre-existing MUT-20 failures unchanged, typecheck and build green). Design review not run: the UI is one settings section and a banner on existing patterns.

**UNRESOLVED DECISIONS:**
- D7 (revised) folds `suppliers` into `expenses`, overriding the ticket's seven-toggle list — owner to confirm or revert (one line + two i18n strings).
- TD-020: whether a legacy "replace all data" import should clear every user table (owner).
