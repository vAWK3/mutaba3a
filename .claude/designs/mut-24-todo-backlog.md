# MUT-24 — Clear the TODO.md backlog

Status: **DRAFT, awaiting Basel's approval** (2026-10-16). Branch `feature/mut-24-todo-backlog`.

MUT-24 collects three independent items from the old `TODO.md`:

- **A.** Split the locale files by feature.
- **B.** Show "What's new" on the first run after an update.
- **C.** Raise test coverage toward 70%.

`TODO.md` itself is deleted (b9ef1d4). All five of its lines are tracked in MUT-24, which also records the two lines it drops.

The deletion tickets the ticket waited on have landed: MUT-145 (documents), MUT-226 (planning and local retainers) and the M-series gating. So A and C no longer need to wait.

Desktop is out of scope everywhere: the Tauri app is retired until v2. B's "works on the Tauri desktop build" criterion becomes "works on the web build". The code stays build-agnostic, so desktop would pick it up for free.

---

## A. Split the locale files

### Today

- `src/lib/i18n/translations/en.json`: 1,483 lines, 1,075 leaf keys in 38 top-level namespaces.
- `ar.json`: 1,523 lines, 1,115 leaf keys.
- Arabic has 40 extra leaves. These are the extra CLDR plural forms, not drift: there are no en-only keys.
- `context.tsx` imports both files eagerly. About 20 test files import a JSON file directly.
- The portal keeps its own dictionaries (`src/hosted/i18n/*.json`, 631/651 lines). They are not part of this ticket, but they share the parity checker built here.
- Largest namespaces: `settings` 197, `landing` 187, `drawer` 104, `expenses` 59, `clients` 56.

### Design

- **Layout.** `translations/en/*.json` and `translations/ar/*.json` hold one file per feature. Each file holds one or more whole top-level namespaces. **Key paths do not change**, so no `t()` call site changes.
- **Grouping.**
  - `common.json`: common, currency, toast, time, validation, filters, client, vendor, project, profile, savedFlash, sample.
  - `shell.json`: nav, addMenu, profileSwitcher, updateBanner, welcome, onboarding.
  - One file each for: overview, transactions, income, expenses, conversions, projects, clients, insights, reports, settings, drawer, fx, bulkUpload, integrity (+ orphanedRecords), demo, download, landing.
  - The final grouping follows the namespaces as they are at implementation time.
- **Composition.** `translations/en/index.ts` imports each JSON and spreads them into one `Dictionary`, and `ar/index.ts` does the same. `context.tsx` imports `./translations/en` and `./translations/ar`.
  - A test fails if two files define the same top-level namespace. Spreading would otherwise silently drop one.
- **Tests.** The ~20 test imports move to the barrels, in the same commit.
- **Parity (AC 2).** The `compare` logic in `src/hosted/i18n/__tests__/parity.test.ts` moves to a shared test helper, `src/test/i18nParity.ts`. It checks the same shape in both languages, the same `{var}` names, and that plurals have en one+other and all six Arabic forms. Both the app and the portal parity tests use it, so it is one checker, not two.
- **Missing and orphaned keys (AC 3).** A new `scripts/check-i18n-keys.ts`, also run as a Vitest test so it gates `test:run`:
  - It collects literal keys from `t('…')`, `tp('…')`, `useTp('…')` and `has('…')` across `src/`.
  - **Missing**: a literal key with no string or plural in `en` → error.
  - **Orphaned**: a defined leaf no literal reaches and no declared dynamic prefix covers → error.
  - Dynamic keys (91 template-literal `t(\`…${x}\`)` calls) are covered by an explicit `DYNAMIC_KEY_PREFIXES` list in the script. Each entry names the file that builds the key, so the list cannot rot silently.
  - Orphans found on the first run are deleted in a separate commit, so the split commit stays a pure move.
- **Lazy loading (AC 4): not doing it**, unless measurement says otherwise. The web app is one SPA and needs both languages' common strings on its first screen. I will record the gzip size of the two dictionaries in the bundle report before and after. If it is under ~25 KB gz, splitting chunks costs more round-trips than it saves.

### Risk

This is a pure move. The safety net is a test that deep-equals the composed dictionary against the old JSON. The old JSON is committed as a fixture for one commit, then deleted.

---

## B. "What's new" after an update

### Today

- `handleVersionChange` (`src/lib/platform.ts`) already compares `app-last-known-version` in localStorage with `__APP_VERSION__` on every start. It clears the updater caches and writes the new version.
- On a fresh install the key is absent. Nothing user-facing exists yet.
- **No user-facing release notes exist anywhere.** The `web-v*` tags carry only "Release web vX.Y.Z". The only changelog is `.claude/CHANGELOG.md`: English, engineering-facing, dated rather than versioned, and full of ADR/TD ids. It cannot be shown to users.

### Design

- **Detection.** `handleVersionChange` returns `{ previous: string | null, current }` instead of `void`. `main.tsx` stores the result in a tiny module (`src/lib/whatsNew/versionChange.ts`), and nothing re-reads storage.
  - `previous === null` means a fresh install, so nothing is shown (AC 3).
  - Storage that throws also means nothing is shown.
- **Content: one source of release notes, used everywhere.** This is the decision for Basel; see the ledger below.
  - Recommended: `release-notes.json` at the repo root, keyed by version, `{ "0.1.7": { "date": "…", "en": ["…"], "ar": ["…"] } }`.
  - The app bundles it (Vite JSON import, tree-shaken to the versions it needs).
  - `scripts/release.ts` refuses to tag a web release whose version has no entry, and writes the English notes into the tag message.
  - This makes it the one place notes are written (AC 4). The parity test covers it: every entry has both languages with the same number of lines.
- **What it shows.** Every entry newer than `previous` and up to `current`, newest first, so a user who skipped versions sees all of them.
  - If there is no entry in that range (a patch with nothing user-facing), nothing is shown and the version is marked seen.
- **Once per version (AC 2).** `whats-new-seen-version` in localStorage, written on dismiss.
  - It is shown when `seen !== current` and there are notes newer than `previous`.
  - Dismissal survives restarts. Storage reads and writes go through try/catch helpers like `context.tsx`'s.
- **UI.** `WhatsNewModal` reuses the `WelcomeModal` dialog shell (`role="dialog"`, `aria-modal`, focus on open, Escape and the close button dismiss).
  - It is a centred modal, not a drawer: drawers are for working on records, and this is a one-time notice.
  - It shows the title ("What's new in 0.1.7"), each version's date and bullets, and one "Got it" button.
  - Mounted in `AppShell` next to `WelcomeModal`. It never shows while `WelcomeModal` or the sample setup is showing.
  - i18n chrome keys sit under `whatsNew.*`. The bullets come from the notes file in the active language.
  - The version string is wrapped in `<bdi dir="ltr">` for RTL (AC 6). It is web build only in practice.
- **Settings → About** gets a "What's new" link that reopens the modal for the current version. Once dismissed, the modal is otherwise unreachable.

---

## C. Coverage toward 70%

### Baseline (main 9866f0f, 2026-10-16, Node 22, v8)

Measured with `npx vitest run --coverage --coverage.reportOnFailure` over all 385 files under `src/`. 4,414 tests passed and 4 timed out under instrumentation (see §C.5).

| Lines | Statements | Functions | Branches |
|---|---|---|---|
| **89.48** | 88.55 | 87.24 | 81.07 |

The 70% target was already met: TEST_PLAN's "~65%" dated from 2026-03. The gap was where the risk sits. The files with the most uncovered lines were `src/db/database.ts` (42.6% lines, 26.9% branches: no historical `upgrade()` before v20 had ever run in a test), `migration-safety.ts` (72.9 / 61.7), `expenseRepository.ts` (74.6 / 61.5) and `csvImport.ts` (68.2 / 51.9, the third record-less paid writer of MUT-60). The portal's MUT-227 `moneyDateFloor` had no test. The pure money and date helpers (`lib/utils`, `currencyAmounts`, `dates`, `fxService`, `paymentEntry`, `incomeEntry`, `attention`) were already at 100%.

### Result (branch `claude/mut-24-coverage-227bdc`, 2026-10-16)

**Status: BUILT.** All risk files are at target, and the thresholds are enforced in `vitest.config.ts` and in `.github/workflows/web-ci.yml`.

| | Lines | Statements | Functions | Branches |
|---|---|---|---|---|
| Final | **91.69** | 91.01 | 88.74 | 84.12 |
| Enforced global floor | 91 | 91 | 88 | 84 |

| Risk file | Baseline L / B | Final L / B | Floor |
|---|---|---|---|
| `db/database.ts` (every `upgrade()`) | 42.6 / 26.9 | 100 / 98.9 | 95 |
| `db/migration-safety.ts` | 72.9 / 61.7 | 100 / 98.3 | 95 |
| `db/csvImport.ts` | 68.2 / 51.9 | 100 / 98.7 | 95 |
| `db/expenseRepository.ts` | 74.6 / 61.5 | 99.4 / 99.4 | 95 |
| `db/repository.ts` (payment records) | 98.9 / 92.7 | 99.3 / 95.5 | 95 |
| `db/aggregations.ts` (owed, ageing filters) | 99.4 / 92.6 | 100 / 100 | 100 |
| `components/clients/clientIndexRows.ts` (overdue days) | 100 / 84.4 | 100 / 100 | 100 |
| `hosted/format/dates.ts` (MUT-227 floor) | 100 / 83.3 | 100 / 100 | 100 |
| `hosted/components/incomeApiErrors.ts` (MUT-227 bound) | 95.1 / 83.9 | 100 / 98.2 | 95 |
| `hosted/components/conversionApiErrors.ts` | 66.7 / 68.8 | 100 / 100 | 100 |
| `db/profileDefault.ts` | 100 / 83.3 | 100 / 100 | 100 |
| pure money/date/FX helpers (12 files) | 100 / 100 | 100 / 100 | 100 |

How the migrations are tested: `src/test/legacyDexie.ts` derives the schema at any past version from `database.ts`'s own `stores()` history. `migration-history.test.ts` creates a database at v(n−1), seeds it in that version's shape, and opens the current `MiniCrmDatabase` over it, so v(n)'s upgrade and every later one run.

Found on the way and deferred: TD-153 (a future-dated paid CSV row throws after its income row is written, which leaves a record-less paid entry and a half-done import), TD-154 (the expense ledger's year/month filters and v15's day inference read a date-only string as UTC midnight, wrong west of UTC), TD-155 (more coverage-only timeouts when the host is loaded).

### Plan

1. **Measure and record** the baseline in this brief and in `TEST_PLAN.md`: overall numbers plus the per-file numbers for the risk list.
2. **Risk-first targets (AC 2).** These files must reach ≥95% lines/branches, and 100% where the logic is pure:
   - Money arithmetic: `src/lib/money*`, amount/minor-unit helpers, `CellAmount`'s formatter, the FX conversion helpers.
   - Overdue and ageing: receivable status, days overdue, the unpaid-ageing buckets in reports, the date floor (MUT-227).
   - Payment-record recalculation: the repository's payment apply/void/recompute paths (MUT-18/60).
   - Dexie migrations: `src/db/schema*`/`migrations*`, each `upgrade()` exercised from the previous version's shape with fake-indexeddb.
   - The exact file list comes from the baseline report, ranked by (risk × uncovered lines).
3. **Then breadth** until overall lines reach 70%. Hooks and pages are covered through their existing test harnesses (`renderWithProviders`), not by snapshot tests. Coverage must come from assertions on behaviour.
4. **Make it visible (AC 4).**
   - `vitest.config.ts` gets `coverage.thresholds`: global floors at the measured run (lines 91, statements 91, functions 88, branches 84, all well over 70), plus per-file floors for the risk files. `json-summary` and `text-summary` reporters are added, and `reportOnFailure` is on.
   - `npm run test:coverage` fails below threshold.
   - There was **no web CI workflow** (only `server-ci.yml` and `build-windows.yml`). D2 approved one: `.github/workflows/web-ci.yml` runs lint, typecheck and `test:coverage` on PRs and pushes to main, and appends `scripts/coverage-summary.ts`'s markdown table to the job summary.
5. **Known issue (done).** Under coverage instrumentation, `ClientsPage.test.tsx` "sorts overdue by how late…" (5.3 s) and `ClientDetailPage.test.tsx` "renders Owed Now, Work and billing and Payments together…" (5.7 s) exceed the 5 s default. The baseline run surfaced four more: BootSplash's first test, IncomeDrawer's "picks a client whose exact name was typed", hosted views' "prefills the client on Client detail" and ProfileCreateDrawer's CR1. Each of the six takes `SLOW_UNDER_COVERAGE` (15 s, `src/test/timeouts.ts`) as a per-test option. The global timeout stays at 5 s. When the host's load average climbed to 100–700 (parallel sessions, Android Studio, Xcode), about 20 more tests crossed 5 s and passed on rerun. TD-155 tracks that: if Web CI shows one, it gets the same per-test option.

---

## Decision ledger (for Basel)

| # | Question | Recommendation |
|---|---|---|
| D1 | Where release notes live (B, AC 4) | A root `release-notes.json` (en + ar per version). `release.ts` refuses a web release without an entry and uses it for the tag message. |
| D2 | Add a web CI workflow for coverage visibility (C, AC 4) | **Approved by Basel 2026-10-16, built.** `web-ci.yml` with lint, typecheck and `test:coverage` plus the job summary, on PRs and pushes to main (skips server-only and docs-only changes). It costs only Actions minutes. |
| D3 | Order of work | A, then B (B adds `whatsNew` keys into the split layout), then C. C can run in its own worktree and session in parallel with A+B, because it only adds tests and config. |

## Impact

- **No data model change and no Dexie version bump.**
- B adds two localStorage keys: `whats-new-seen-version`, and reuses the existing `app-last-known-version`.
- **Bundle:** B adds the notes (a few KB). A is neutral.
- **Cost:** D2 adds Actions minutes per push.
- ADRs:
  - A new ADR for release notes as a single source.
  - The parity/orphan gate goes in `PATTERNS.md`, not an ADR.

## QA scenarios (release-qa → `qa/features/web/whats-new.yaml`)

1. **Upgrade shows notes.**
   - Steps: start the app with `app-last-known-version` set to the previous version.
   - Expect: "What's new in <current>" with that version's bullets in the active language.
2. **Dismiss persists.**
   - Steps: press "Got it", then reload.
   - Expect: no modal.
3. **Fresh install shows nothing.**
   - Steps: clear storage and start the app.
   - Expect: the welcome flow, no What's new.
4. **Arabic and RTL.**
   - Steps: with Arabic chosen, run the upgrade case.
   - Expect: an RTL dialog with Arabic bullets and the version isolated LTR.
5. **Reopen from Settings.**
   - Steps: Settings → About → What's new.
   - Expect: the modal shows the current version's notes.

A and C have no user-visible flows. Their gates are the parity/orphan test and the coverage thresholds.
