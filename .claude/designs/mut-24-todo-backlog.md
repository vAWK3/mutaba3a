# MUT-24 — Clear the TODO.md backlog

Status: **A and B built** on `feature/mut-24-todo-backlog`. **C** is running in its own session and branch (`claude/mut-24-coverage-*`). Approved by Basel 2026-10-16 (D1–D3 below).

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
- **Lazy loading (AC 4): not done.**
  - Measured gzipped dictionary sizes: en 15.4 KB, ar 18.3 KB; before the orphan cleanup they were 16.6 KB and 19.7 KB.
  - Lazy-loading could only skip the inactive language, at most ~15–18 KB gz once. It would cost an async load on every language switch. The Arabic default needs `ar` on first paint anyway.
  - Loading stays eager.

### What the build found (2026-10-16)
- **Two live raw-key bugs**, both fixed with tests that use the real dictionaries:
  - Projects' search-miss state asked for three keys that never existed: `projects.emptyFiltered`, `projects.emptyFilteredCount` and `projects.clearSearch`.
  - Expenses' uncategorized group asked for `common.noCategory`.
  - `t()` returns the key on a miss, so each `|| 'fallback'` beside the call never ran.
- **121 orphaned keys**, left by deleted screens, are gone from both languages, along with `bulkUpload.json`.
- The scanner learned three dynamic shapes: a template literal with a dot before its first `${`, a concatenation onto a dotted literal, and a dotted namespace constant. Its limits are TD-152.
- **Six Arabic `…Singular` strings drop `{count}`.** That is correct Arabic, so the parity rule allows exactly that (TD-151: make them plurals).
- The unused hand-written `Translations` interface is deleted.

### Risk

This is a pure move. The safety net is a test that deep-equals the composed dictionary against the old JSON. The old JSON is committed as a fixture for one commit, then deleted.

---

## B. "What's new" after an update

### Today

- `handleVersionChange` (`src/lib/platform.ts`) already compares `app-last-known-version` in localStorage with `__APP_VERSION__` on every start. It clears the updater caches and writes the new version.
- On a fresh install the key is absent. Nothing user-facing exists yet.
- **No user-facing release notes exist anywhere.** The `web-v*` tags carry only "Release web vX.Y.Z". The only changelog is `.claude/CHANGELOG.md`: English, engineering-facing, dated rather than versioned, and full of ADR/TD ids. It cannot be shown to users.

### Design

- **Detection, as built.** `handleVersionChange` returns the previous version (`string | null`). `main.tsx` passes it to `seedSeenVersion(previous, APP_VERSION)`.
  - The seed writes `whats-new-seen-version` once: the running version on a fresh install, so nothing shows (AC 3); the previous version on an upgrade.
  - Keying on the seen version, not on `previous`, keeps the notes until they are dismissed. `handleVersionChange` rewrites `app-last-known-version` on every start, so a tab closed without dismissing would otherwise lose them.
  - Storage that throws means nothing shows.
- **Content: one source of release notes, used everywhere.** This is the decision for Basel; see the ledger below.
  - Chosen (D1): `release-notes.json` at the repo root, keyed by version, `{ "0.1.7": { "en": ["…"], "ar": ["…"] } }`. There is no date: the notes are written before the release day is known.
  - The app bundles it (Vite JSON import, tree-shaken to the versions it needs).
  - **Web releases go through `make release-web`, not `scripts/release.ts`** (that is the desktop pipeline).
    - The Makefile runs `npm run release:notes -- <v>` after the bump and before the build, and stops without an entry.
    - `tag-release.sh` writes the English lines into the `web-v*` tag message, from the tagged commit.
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

_Filled in from `npx vitest run --coverage`; see §C.4._

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
   - `vitest.config.ts` gets `coverage.thresholds`: global lines/statements 70 (ratchet), plus per-glob thresholds for the risk files. `json-summary` and `text-summary` reporters are added.
   - `npm run test:coverage` fails below threshold.
   - There is **no web CI workflow today** (only `server-ci.yml` and `build-windows.yml`). The decision ledger asks whether to add `.github/workflows/web-ci.yml`, which would run lint, typecheck and `test:coverage` and write the summary to the job summary.
5. **Known issue.** Under coverage instrumentation, `ClientsPage.test.tsx` "sorts overdue by how late…" exceeds the 5 s default timeout (5.3 s). Fix it by giving that test a longer timeout or cutting its seed size, not by raising the global timeout.

---

## Decision ledger (for Basel)

Resolved with Basel, 2026-10-16:

| # | Question | Decision |
|---|---|---|
| D1 | Where release notes live (B, AC 4) | A root `release-notes.json` (en + ar per version). The `make release-web` gate and the tag message both read it (ADR-089). |
| D2 | Web CI workflow for coverage visibility (C, AC 4) | Yes: `web-ci.yml` (built in the C session). |
| D3 | Order of work | A, then B here. C runs in parallel in its own session and worktree. |

## Impact

- **No data model change and no Dexie version bump.**
- B adds two localStorage keys: `whats-new-seen-version`, and reuses the existing `app-last-known-version`.
- **Bundle:** B adds the notes (a few KB). A is neutral.
- **Cost:** D2 adds Actions minutes per push.
- ADRs:
  - ADR-089: release notes as a single source, and the seen-version rule.
  - The locale layout and the key check are in `PATTERNS.md`.
- New build input: `MUTABA3A_APP_VERSION` (x.y.z, or the build fails). A QA build runs as the version the notes describe before the bump. It is unset in release builds (`INFRA.md`).

## QA scenarios (release-qa → `qa/features/web/whats-new.yaml`; 3/3 passing on a `MUTABA3A_APP_VERSION=0.1.7` preview build)

As built:
- Scenarios 1 and 2 are `after-update`.
- Scenario 3 is `fresh-install`.
- Scenarios 4 and 5 are `reopen-arabic`. Reopening from About in Arabic covers RTL, because the auto-open path and the Arabic rendering share one component, already covered by unit tests.

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
