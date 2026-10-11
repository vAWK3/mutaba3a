# TECH_DEBT.md — Technical Debt Registry

> **Purpose**: Track known technical debt, workarounds, and areas needing improvement.
> **Rule**: Add debt when introduced; mark resolved when fixed.

---

## Debt Status Legend

| Status | Description |
|--------|-------------|
| **Open** | Needs attention |
| **In Progress** | Being addressed |
| **Resolved** | Fixed (move to Resolved section) |
| **Accepted** | Intentional trade-off, no action needed |

---

## Open Debt

### TD-029: The Sync Op-Log Has No Notion of a Profile
**Status**: Accepted (recorded by MUT-36; deliberately not built)
**Added**: 2026-10-11
**Priority**: Low today — becomes a blocker the day profile-selective sync is proposed
**Impact**: Profile-selective sync ("sync my firm profile, not my personal one")
cannot be expressed

`src/sync/` contains zero references to `profileId` (and `src-tauri/src` none
to `profileId`/`profile_id`). The word "profile" there means the per-field LWW
merge (`ConflictType 'profile_field'`, `applyProfileFieldOp`) and the
`businessProfile` entity type — nothing partitions, filters or scopes
operations by business profile. A sync session exchanges every captured op
(clients, projects, transactions, categories, FX rates, documents, business
profiles, payment records) regardless of which profile they belong to.

This is not a defect today: ADR-013 syncs a person's own devices, where all
profiles belong to the same person. It matters only if a future decision lets
one profile sync to a hosted service or to another person while others stay
local. MUT-34 avoided that path (ADR-033: local and hosted profiles are
separate datasets; neither syncs), so the gap is recorded, not fixed.

**If it is ever needed**: add `profileId` to `Operation`, backfill it from the
entity at capture time, and make transport filters profile-aware — a sync
protocol change requiring its own ADR (with MUT-27, TD-015).

### TD-030: English and Arabic Translations Have Drifted; Parity Is Tested for One Subtree
**Status**: Open
**Added**: 2026-10-11 (found during MUT-36)
**Priority**: Medium
**Impact**: English users can see raw keys on the retainers views; new drift
goes unnoticed

`en.json` has 1,131 leaf keys and `ar.json` 1,160. `en` is missing about 30
keys that `ar` has (`retainers.view.*`, `retainers.inspector.*`,
`retainers.scheduleState.*`, `retainers.filters.*`, `retainers.status.*`), and
`retainers.summary`
is a string in `en` but an object in `ar`. The only parity test
(`src/lib/features/__tests__/i18nParity.test.ts`) covers `settings.features`.
`t()` takes a plain string, so keys are not type-checked either.

**Fix**: a full-tree parity test (same key set, same leaf types, same `{var}`
names), then fill the gaps. MUT-43 adds the same check for the new `hosted.*`
subtree only; the rest is this entry.

### TD-031: Server Log Redaction Is Untested and Only One Level Deep
**Status**: Open (to be resolved by MUT-38)
**Added**: 2026-10-11 (found during MUT-36)
**Priority**: High once sessions exist
**Impact**: A credential nested two levels deep in a logged object would be
written to Cloud Logging in clear

`server/src/logger.ts` redacts `req.headers.authorization`,
`req.headers["x-admin-token"]`, `*.authorization`, `*.apiKey`, `*.secret`,
`*.token`, `*.key` and the bare names. Its comment says these match "at any
depth", but pino's `*.x` wildcard matches exactly one level below the root.
No test asserts redaction (the handover's "logs redact credentials" was
exercised by hand in the 2026-10-08 e2e run). Today the request log line
carries no headers or body, so nothing leaks in practice; MUT-38 adds
`password`, a session cookie and `Set-Cookie` to the request surface.

**Fix (MUT-38)**: add the session cookie, `cookie`, `set-cookie` and
`password` paths at every depth that can occur, and a test that logs a nested
object carrying each credential and asserts `[redacted]`.

### TD-022: Release Pipeline Does Not Verify the Signer Against the Compiled-In Updater Key
**Status**: Open (ticketed as MUT-51)
**Added**: 2026-10-10
**Priority**: High
**Impact**: A release cut without the signing key configured, from the wrong
checkout, or with a different key than `plugins.updater.pubkey` publishes a
manifest every installed client either cannot find (404) or cannot verify

In `deploy.sh`, `check_updater_signing` only warns when the signing key is
missing and the release proceeds without an update archive or `latest.json`;
`load_release_env` resolves its env file relative to the current directory;
`UPDATER_PRIVATE_KEY_FILE` is declared and never read; `tag_and_push` pushes
and tags from whatever branch is checked out; and `sign_update_artifact`
passes the key and password to `tauri signer sign` as CLI arguments although
the CLI reads the `TAURI_SIGNING_PRIVATE_KEY*` environment variables itself
(the `signer sign` step in `.github/workflows/build-windows.yml` does the
same). Nothing compares the key id in the produced signatures (line 2, bytes
2..10) with the key id in `src-tauri/tauri.conf.json`, and the macOS and
Windows halves sign from separately configured secrets with no check that
they hold the same key. The Windows workflow has the matching soft-fail:
its "Build and sign NSIS updater bundle" step exits 0 with a warning when the
secret is unset and the release then carries a `latest.json` with no
`windows-x86_64` entry, so Windows clients silently never update. The macOS
path also runs no test before building; the Windows workflow now runs
`updater-config.test.ts` before `tauri build` (MUT-49), `deploy.sh` does
not. The workflow's "latest.json not found" message also pointed at
`scripts/deploy.sh`, which does not exist (fixed to `./deploy.sh` in MUT-49).
Found during the MUT-49 review (ADR-031); MUT-51 owns the hard-fail on both
paths, the file fallback, the deploy.sh test gate and the post-publish
verification.

### TD-021: Two Overlapping Invalidation Key Lists for the Same Money Views
**Status**: Open
**Added**: 2026-10-10
**Priority**: Low
**Impact**: A new money query key has to be added in two places or one of the
two write paths silently serves stale data -- which is exactly how MUT-6 AC #5
broke

`invalidateIncomeQueries` (`src/hooks/useIncomeQueries.ts:61`) and
`invalidateTransactionQueries` + `invalidatePaymentRecordQueries`
(`src/hooks/useQueries.ts:21,174`) list overlapping sets of the same keys.
MUT-6 fixed the symptom by adding the four income keys to
`invalidatePaymentRecordQueries` in place; the eng review chose the smaller
arrangement deliberately over extracting a shared `invalidateMoneyQueries`,
and recorded the duplication here instead. Extract it the next time a third
caller needs the same list.

**Note (2026-10-10, MUT-6 QA):** the money-event keys hit exactly that
threshold and were extracted — `invalidateMoneyEventQueries` lives in
`useMoneyEventQueries.ts`, beside the keys it owns, and the four write paths
call it. The *income* key duplication described above is untouched and still
open; the precedent for fixing it is to put the list in the module that owns
the keys rather than in a new `src/hooks/invalidation.ts`.

### TD-020: Import State Loads Linked Entities One By One
**Status**: Open
**Added**: 2026-10-08
**Priority**: Low
**Impact**: `POST /v1/import/{preview,commit}` issue one `getById` per already-linked
customer/project (≤ 500 per call by the batch cap); fine for M2 volumes,
wasteful once M3 adds agreements to the same path

`src/routes/import.ts` `loadState` resolves references first (batched) and
then the entities individually. Add `customers.getByIds` / `projects.getByIds`
to the store port and use them here. Introduced by Money v1 M2.

### TD-017: Hosted API Rate Limiter Is Per Instance
**Status**: Open
**Added**: 2026-10-08
**Impact**: On Cloud Run with more than one instance, a key's budget is per
instance, so the effective limit is N × RATE_LIMIT_PER_MINUTE

`server/src/rate-limit.ts` is an in-process sliding window behind a
`RateLimiter` port. It is honest about what it is and stops a runaway client
from exhausting one instance, but a shared store (Redis/Upstash, matching
Malafat's choice) must replace it before the service scales horizontally.
Routes do not change; only `index.ts` wiring does. Introduced by Money v1 M1.

**Mitigation (2026-10-08)**: `infrastructure/terraform/variables.tf` validates
`max_instances == 1`, so a deployment cannot scale horizontally by accident.
Resolving this debt means replacing the limiter port implementation *and*
loosening that validation in the same change.

### TD-015: OAuth Refresh Tokens Have No Durable, Secure Store
**Status**: Open
**Added**: 2026-10-05
**Impact**: Connecting to a Malafat workspace does not survive an app restart

`InMemoryTokenStore` (`src/services/tokenStore.ts`) holds tokens for the
process lifetime only, so every restart forces a re-auth. That is the safe
failure and was chosen deliberately over writing a long-lived credential to
IndexedDB or a plain file. The fix is the OS keychain (Keychain / Credential
Manager / libsecret), which in Tauri 2 needs a plugin and a narrow capability.
The `TokenStore` port exists so this can be swapped without touching the flow.
Introduced by MUT-28.

### TD-016: CI Does Not Run `cargo test`
**Status**: Open
**Added**: 2026-10-05
**Impact**: 14 Rust tests had never executed once

`src-tauri` had no `[dev-dependencies]` section while
`src/sync/persistence.rs:279` had referenced `tempfile::tempdir` since it was
written. The Rust test target therefore failed to compile, and nothing noticed —
which means CI never ran `cargo test`. MUT-28 declared the dependency and all 14
pre-existing tests (pairing, persistence, crypto) now pass. The gap to close is
the CI step, not the dependency.

### TD-014: Remaining UTC Date Derivations Outside Receivables
**Status**: Open
**Added**: 2026-10-05
**Impact**: Three test failures appear only west of UTC; latent off-by-one-day bugs in non-receivable date logic

MUT-17 unified receivable date logic into `src/lib/dates.ts` (ADR-022) but
deliberately scoped out the rest. `grep -rn "toISOString().split('T')\[0\]" src`
still reports ~45 occurrences across ~26 files. Most are **correct** — instants
for HLC timestamps, sync bundles and backup filenames — but these three are
confirmed broken under `TZ=America/New_York` and pass only on a UTC+n machine:

- `src/lib/aggregations.ts` `getDaysInMonth` — `aggregations.test.ts > Date Utilities > getDaysInMonth > should return all days in March`
- `src/db/forecastCalculations.ts` — 2 failures in `forecastCalculations.test.ts > generateVirtualExpenses` (end-of-month clamping, endOfYear end mode)
- `src/features/documents/pdf` — `pdf.test.ts > Date Formatting > should format dates in DD/MM/YYYY format`

**Two private UTC-based `todayISO()` copies remain** (found during QA
reconciliation of MUT-17). Both are in domains ADR-022 scoped out, so neither
affects receivable overdue, but both are the same class of defect:

- `src/db/retainerRepository.ts:29` — feeds the `ProjectedIncome` overdue
  comparison at `:406`, keyed on `expectedDate`
- `src/services/recurringExpenseService.ts:32` — recurring-expense occurrence
  states

For the record, MUT-17 found **six** `todayISO`/`getTodayISO` definitions in
total, not the three its description listed. Four now delegate to
`todayLocalISO()`; these two do not.

**Resolution**: audit each remaining site, classify it as instant (keep
`toISOString()`) or calendar date (move to `src/lib/dates.ts`), and fix the
three confirmed failures. Verify with `npm run test:tz`.

**Effort**: Medium — mechanical, but each site needs classifying rather than
blanket-replacing.

---

### TD-001: Limited Test Coverage
**Status**: In Progress
**Priority**: Medium (reduced from High)
**Introduced**: 2024-05
**Updated**: 2026-03-14
**Impact**: Reduced - Core pages and repos now well tested

**Description**:
Test coverage has been significantly improved. Core pages and repositories now meet 70%+ targets.

**Current State (Updated 2026-03-14)**:
- `src/db/__tests__/` - Repository tests - **✅ ~85% coverage**
- `src/pages/clients/__tests__/` - **✅ 70.08% coverage** (33 tests)
- `src/pages/projects/__tests__/` - **✅ 73.03% coverage** (40+ tests)
- `src/pages/income/__tests__/` - **✅ ~90% coverage** (30 tests)
- `src/pages/expenses/__tests__/` - **✅ ~80% coverage** (4 pages, 67-100% each)
- `src/hooks/__tests__/` - Partial coverage for business profile and document hooks
- `src/components/__tests__/` - UpdateBanner, BusinessProfileDrawer tested
- `src/features/documents/__tests__/` - totals.test.ts, pdf.test.ts
- **Overall: ~65% coverage** (1,771 tests passing)

**Completed Since Last Update**:
- ✅ ClientsPage: Added 17 new tests (16→33), achieved 70.08% coverage
- ✅ IncomePage: Added 7 new tests (23→30), achieved ~90% coverage
- ✅ ExpensesOverviewPage: Fixed 4 failing tests, all 29 passing, 100% coverage
- ✅ All core page coverage targets met (70%+)

**Remaining Gaps**:
- Hook tests: useTransactionFilters, useProfileAwareAction, other utility hooks
- Component tests: Tables, filters, UI components
- Integration tests for complex flows
- E2E tests (planned in separate TD item)

**Remediation**:
1. ~~Add unit tests for all repository methods~~ ✅ Done
2. ~~Add page component tests~~ ✅ Done (core pages)
3. Add hook tests for utility hooks (useTransactionFilters, etc.)
4. Add component tests for tables and filters
5. Target: 80% overall coverage

**Effort**: Small (reduced from Medium) - Major work completed

---

### TD-013: SQLite Migration for Tauri
**Status**: In Progress
**Priority**: Medium
**Introduced**: 2024-06
**Updated**: 2026-03-13
**Impact**: Desktop app uses IndexedDB instead of native SQLite

**Description**:
Per CLAUDE.md project spec, the app should use SQLite in Tauri desktop builds for better performance and native file system integration. Currently, both web and desktop use IndexedDB via Dexie.

**Current State (2026-10-10, MUT-35)**:
- ✅ Repository interfaces created (`src/db/interfaces.ts`)
- ✅ All repository operations documented with TypeScript interfaces
- ✅ **Conformance is now enforced by the compiler** — `src/db/provider.ts`
  applies `satisfies` to all 21 base repositories and all 8 synced decorators.
  Deleting or renaming a repository method fails `npm run typecheck`.
- ✅ Migration Safety Layer implemented (`src/db/migration-safety.ts`)
- Schema version at 14 with all tables defined

> **Correction (MUT-35).** The entry previously claimed "Current Dexie
> implementation satisfies the interfaces". That was an assertion no check
> enforced: before MUT-35 the `satisfies` count in the codebase was 0. When
> conformance was actually applied, **7 interfaces turned out to have drifted**
> — every case an interface declaring a method the implementation never had:
> `transactionRepo.delete`, `receiptRepo.getByExpense`, `vendorRepo.findByName`,
> `monthCloseRepo.set`, `retainerRepo.delete`,
> `projectedIncomeRepo.{getBySource,getByPeriod,create,delete}`, plus
> `expenseRepo.{getYearlyTotals,getAllProfilesTotals,getReceiptCount}` missing
> from the interface and three wrong parameter/return types. All were fixed by
> correcting the interface to describe reality, never by adding runtime code.
> Lesson: "documented" and "checked" are different states; only the second
> survives contact with a refactor.

**Known gap — the seam is only half swappable.**
`gstack-shortcut(dec-5f2c2123)`: the decorators in
`src/sync/core/synced-repository.ts` bind the Dexie singletons at module load
(`clientRepo.list.bind(clientRepo)`), so `setRepositories()` redirects `base`
but **not** `synced.*`. Harmless today — nothing calls `setRepositories` outside
tests — but a hosted data source injected by MUT-43 would be silently bypassed
on every synced write path. Upgrade when MUT-43 lands: resolve the decorators
lazily through `getRepositories().base`, with a test asserting ops are captured
against a swapped base.

> **Re-homed (2026-10-11, MUT-36).** The hosted portal does not inject into
> the registry (ADR-033 decision 10: it is a separate build target with its own
> HTTP client), so MUT-43 will not trigger this. The upgrade is now due when a
> second implementation is actually injected — the SQLite/Tauri swap this
> entry tracks.

**Every declared slot has a real caller.** Verified by grepping
`base.<slot>.<method>` across `src/`: nine consumers resolve through the
provider, including `useRetainerQueries`. A slot that nothing reads would make
a future `setRepositories` swap silently leave that domain on Dexie — the
registry must never advertise coverage it does not have.

**Outside the seam.** `IRepositoryProvider` covers 21 repositories. Not covered:
`planRepo`, `planAssumptionRepo`, `planScenarioRepo` (`planRepository.ts`),
`scheduleGenerator`, `retainerMatching` (`retainerRepository.ts`) — the last two
are not repositories. Also `moneyEventRepo`: it was left alone pending MUT-11,
which then kept it because three mounted Overview components import it
(ADR-029), so it is still outside the seam. `engagementRepo` was deleted with
its module in MUT-10. See TODOS.md item 2.

**Repository Interfaces Created**:
- `IClientRepository`, `IProjectRepository`, `ICategoryRepository`
- `ITransactionRepository`, `IProjectSummaryRepository`, `IClientSummaryRepository`
- `IFxRateRepository`, `ISettingsRepository`, `IBusinessProfileRepository`
- `IDocumentRepository`, `IDocumentSequenceRepository`
- `IExpenseRepository`, `IExpenseCategoryRepository`, `IReceiptRepository`
- `IVendorRepository`, `IMonthCloseStatusRepository`, `IRecurringRuleRepository`
- `IRetainerAgreementRepository`, `IProjectedIncomeRepository`
- `IRepositoryProvider` (factory interface)

**Remaining**:
1. Create SQLite schema matching Dexie tables
2. Implement SQLite repositories using `@tauri-apps/plugin-sql`
3. Create repository factory that selects implementation based on platform
4. Add migration logic for existing IndexedDB data → SQLite
5. Test sync operations with SQLite backend
6. Benchmark performance improvements
7. Implement SQLite-native backup (file copy) for Tauri builds

**Migration Path**:
1. **Phase 1** (Complete): Define interfaces for all repositories
2. **Phase 2**: Implement SQLite versions of repositories
3. **Phase 3**: Add platform detection and factory pattern
4. **Phase 4**: Data migration from IndexedDB to SQLite
5. **Phase 5**: Remove IndexedDB code from Tauri builds

**Note**: Migration Safety Layer is already in place for IndexedDB. When migrating to SQLite, the backup strategy should use native file system backup (copy .db file before migration) instead of the IndexedDB-based backup.

**Effort**: Large

---

### TD-003: Live Sync Not Yet Activated
**Status**: In Progress
**Priority**: High
**Introduced**: 2024-06
**Updated**: 2026-02-09
**Impact**: Users can sync via bundle export/import but not via live LAN/network sync

**Description**:
Sync infrastructure is in place (HLC, OpLog, types, conflict resolution). Bundle-based offline sync is fully working. Live network sync is partially implemented.

**Current State (2026-02-09)**:
- `src/sync/core/` - Complete types and logic ✅
- `src/sync/transport/` - Bundle encoder + crypto ✅
- `src/sync/stores/syncStore.ts` - Complete state management ✅
- **Bundle Sync (Offline)**: ✅ FULLY WORKING
  - `ExportBundleModal` and `ImportBundleModal` wired in AppShell
  - `SyncSection` in Settings page with export/import buttons
  - Encrypted bundle generation and import working
- **Wi-Fi Sync (LAN)**: PARTIALLY IMPLEMENTED
  - UI exists in `SyncSection.tsx` (Tauri-only conditional)
  - Requires Tauri backend commands (`start_sync_server`, `stop_sync_server`)
  - Device discovery and pairing UI exists
  - Status: Needs Tauri backend verification
- **Conflict Resolution UI**:
  - `ConflictBanner` component exists and renders in AppShell
  - Conflict review flow needs testing

**Remaining**:
1. ~~Wire bundle export/import to UI~~ ✅ Done
2. ~~Add sync status indicators~~ ✅ Done (SyncStatusChip, status in SyncSection)
3. Verify Tauri backend sync commands work end-to-end
4. Test Wi-Fi sync between desktop devices
5. Test conflict resolution flows
6. Consider WebRTC or relay server for web-to-web sync (future)

**Effort**: Medium (reduced from Large - much already done)

---

### TD-004: No E2E Tests
**Status**: In Progress
**Priority**: Medium
**Introduced**: 2024-05
**Updated**: 2026-02-09
**Impact**: Critical flows not validated automatically

**Description**:
No end-to-end tests exist. Critical user journeys are only tested manually.

**Current State (2026-02-09)**:
- Playwright installed and configured
- `playwright.config.ts` created with Chromium setup
- E2E tests added:
  - `e2e/navigation.spec.ts` - Main page navigation tests
  - `e2e/transaction.spec.ts` - Transaction CRUD tests
  - `e2e/settings.spec.ts` - Settings page tests
- npm scripts added: `test:e2e`, `test:e2e:ui`

**Remaining**:
1. Add more E2E tests for:
   - Generate invoice
   - Export data
   - Demo mode toggle
2. Add to CI pipeline (GitHub Actions)
3. Expand browser coverage (Firefox, Safari)

**Effort**: Medium (reduced from initial)

---

### TD-005: Large IndexedDB Tables
**Status**: In Progress
**Priority**: Low
**Introduced**: 2024-08
**Updated**: 2026-02-09
**Impact**: Performance may degrade with large datasets

**Description**:
No pagination or virtualization for large tables. Users with 10K+ transactions may experience slowness.

**Current State (2026-02-09)**:
- Repository already supports offset/limit in QueryFilters
- Created reusable `Pagination` component
- Added ChevronLeft/Right icons for pagination controls
- CSS styles for pagination added to index.css

**Remaining**:
1. ~~Implement cursor-based pagination in repositories~~ ✅ Already exists
2. ~~Add reusable pagination component~~ ✅ Done
3. Integrate pagination into TransactionsPage (requires useTransactions hook update)
4. Add virtualization for very large datasets (react-window)
5. Consider IndexedDB query optimization

**Effort**: Medium (reduced)

---

### TD-006: Demo Mode Cleanup
**Status**: Accepted
**Priority**: Low
**Introduced**: 2024-07
**Impact**: Demo data stored in same database as real data

**Description**:
Demo mode uses the same database instance with special flags. This is intentional for simplicity but means demo data cleanup must be careful.

**Current State**:
- Demo data seeded with specific IDs
- Cleanup function removes by ID prefix
- Time-frozen dates for deterministic testing

**Status**: Accepted as design choice. Demo isolation would require separate database.

---

### TD-007: Bundle Size Growth
**Status**: Open (Audited 2026-02-09)
**Priority**: Low
**Introduced**: 2025-01
**Impact**: Initial load time may increase

**Description**:
Bundle size has grown significantly. Total precache is 11.5MB (though most is lazy-loaded).

**Current State** (Audit 2026-02-09):
- **fonts-*.js**: 1,586 KB (527 KB gzipped) - 9 font families/weights bundled together
- **index-B5kMr9UK.js**: 590 KB (163 KB gzipped) - PDF library (@react-pdf/renderer)
- **index-ZWWaRq82.js**: 205 KB (48 KB gzipped) - Unknown, needs investigation
- **monthDetection-*.js**: 101 KB (32 KB gzipped) - Date utilities
- Vendor chunks well-organized (react, router, query, forms, db)
- Page routes are lazy-loaded correctly

**Optimization Opportunities**:
1. **Fonts** (HIGH IMPACT): 527KB gzipped for fonts is excessive
   - Move fonts to external CDN (Google Fonts, Bunny Fonts)
   - Or use font subsetting to reduce file size
   - Consider loading Arabic fonts only when Arabic is selected
2. **PDF library** (MEDIUM): Could be further lazy-loaded to only load on document export
3. **Date utilities**: Consider using native Intl APIs where possible

**Remediation**:
1. ~~Audit bundle~~ ✅ Done
2. Move fonts to CDN or use subsetting
3. Lazy-load PDF library on first document action
4. Tree-shake unused i18n strings

**Effort**: Medium

---

### TD-009: Accessibility Audit Needed
**Status**: In Progress
**Priority**: Medium
**Introduced**: 2024-05
**Updated**: 2026-02-09
**Impact**: App may not be fully accessible

**Description**:
No formal accessibility audit has been performed. Some ARIA attributes exist but coverage is inconsistent.

**Current State (2026-02-09)**:
- axe-core/playwright installed for automated accessibility testing
- Created `e2e/accessibility.spec.ts` with tests for:
  - Overview, Transactions, Projects, Clients, Reports, Settings pages
  - Transaction drawer accessibility
- Automated checks will catch common issues (WCAG violations)

**Remaining**:
1. ~~Run axe-core or similar accessibility checker~~ ✅ Done
2. Fix critical issues identified by axe-core
3. Add ARIA labels to interactive elements
4. Test with screen reader
5. Document accessibility features

**Effort**: Medium

---

### TD-010: PDF Template Flexibility
**Status**: Open
**Priority**: Low
**Introduced**: 2024-09
**Impact**: Users cannot customize PDF layouts beyond predefined templates

**Description**:
Document PDF generation uses hardcoded templates (template1, template2, template3). Users cannot customize layouts.

**Remediation**:
1. Extract template components to be more modular
2. Consider template builder (future)
3. Allow header/footer customization

**Effort**: Large (if template builder), Small (if just modular)

---

### TD-023: `clearDatabase()` clears five tables, so a legacy import keeps stale optional-area data
**Status**: Open
**Priority**: Medium
**Introduced**: pre-2026 (surfaced by MUT-12, 2026-10-10)
**Impact**: A legacy ("replace all data") import wipes transactions, projects, clients, categories, fxRates and settings but leaves documents, expenses, vendors, retainers and plans. Since MUT-12, the post-import reconcile switches those areas on and the banner announces "your existing data" for rows that are leftovers from before the import.

**Description**:
`src/db/seed.ts` `clearDatabase()` predates the optional-area tables. The legacy import in `ImportDataModal` and `ImportDataPage` relies on it to mean "replace everything".

**Remediation**:
1. Decide whether legacy import means *all* user tables (then `clearDatabase()` clears every data table, or reuses `deleteAllData()`), or only the legacy export's tables (then say so in the import copy).
2. Add a test that a legacy import leaves no rows in the probed tables.

**Effort**: Small

---

### TD-024: The legacy import is duplicated in `ImportDataModal` and `ImportDataPage`
**Status**: Open
**Priority**: Low
**Introduced**: when the import page was added beside the modal (surfaced by MUT-12, 2026-10-10)
**Impact**: Every change to the legacy import (MUT-12 added the feature reconcile) is made twice; the two copies already differ slightly.

**Remediation**: extract `runLegacyImport(fileData)` into `src/db/` (or `src/lib/import/`) and call it from both; one test.

**Effort**: Small

---

### TD-025: Legacy `/transactions` page keeps an ungated "Generate invoice" action
**Status**: Open
**Priority**: Low
**Introduced**: when `/transactions` became a redirect to `/income` (surfaced by MUT-13, 2026-10-10)
**Impact**: `src/pages/transactions/TransactionsPage.tsx` still renders a Generate/View invoice menu that ignores the Invoices switch. Unreachable today (the route redirects), so no user impact; it is dead code waiting for the MUT-2 deletion pass.

**Remediation**: delete `TransactionsPage` with the rest of the unreachable surface, or gate its actions with `useFeatureEnabled('invoices')` if it is ever reinstated.

**Effort**: Small

---

### TD-026: Receipts archive is built in one pass in memory
**Status**: Open
**Priority**: Low
**Introduced**: MUT-14, 2026-10-10
**Impact**: `buildAllReceiptsArchive` decodes every receipt's base64 payload across all profiles into memory before `generateAsync`; for a photo-heavy database this can be hundreds of MB in a tab. Fine for the pilot's volumes; a per-profile or per-month streaming build (JSZip `generateInternalStream`, or one ZIP per profile) is the fix.

**Remediation**: build per profile (or per month) and offer one download each, or stream; keep `receipts.count()` as the only payload-free read.

**Effort**: Small

---

### TD-027: Onboarding shows a completed "Project" step while the Projects area is off
**Status**: Open
**Priority**: Low
**Introduced**: MUT-16, 2026-10-10
**Impact**: D4 auto-completes the project step in `OnboardingOverlay` while projects is off, so a fresh install's `OnboardingStepIndicator` still renders three steps with step 2 ticked before the user did anything. Harmless functionally (the flow is client → income) but reads as odd on the first launch.

**Remediation**: make `OnboardingStepIndicator` take the step list from the overlay and omit `project` while the area is off; or let `onboardingStore` carry a step list set at `startOnboarding()` from the flags (needs a persisted-state migration). Decide alongside MUT-15's sidebar/add-menu shape.

**Effort**: Small

---

## In Progress

*No items currently in progress.*

---

## Resolved Debt

### TD-028: By-Id Query Hooks Resolved `undefined` for Missing Rows
**Status**: Resolved
**Resolved**: 2026-10-10
**Original Priority**: Low

Every by-id hook that wrapped a repository `get(id)` / `getDefault(planId)`
(`useTransaction`, `useClient`, `useClientSummary`, `useProject`,
`useProjectSummary`, `useDocument`, `useBusinessProfile`, `useIncomeById`,
`useExpense`, both `useRecurringRule`s, `useRetainer`, `usePlan`,
`usePlanAssumption`, `usePlanScenario`, `usePlanDefaultScenario`) now resolves
`null` for a missing row and is typed `Entity | null`, as
`useDefaultBusinessProfile` already was. Repository contracts are unchanged.
The only consumer change was `!!existingDoc` in the two document forms'
`isReadOnly`. Each hook has a "missing row → `null`, no `console.error`" test
(PATTERNS.md, Query Hooks rule; CHANGELOG 2026-10-10).

### TD-018: Organizations and API Keys Are Operator-Provisioned Only
**Status**: Accepted
**Decided**: 2026-10-08 by the product owner
**Original Priority**: Medium

Keys stay operator-issued through `/admin/v1/*` and `npm run provision`; there
will be no self-serve account, organization or key-management flow. Mutaba3a
keeps no account system (ADR-023). Malafat's side records the same decision in
its ADR-150 addendum (MAL-870). Revisit only if a customer other than Malafat
needs keys without an operator.

> **Correction (2026-10-11, ADR-033).** "Mutaba3a keeps no account system" is
> no longer true: the hosted service gains
> users, memberships and sessions for the hosted portal. The *decision* this
> entry records is unchanged and extends to users — they are operator-issued
> through `/admin/v1/users*` exactly like keys, with no self-serve signup,
> invite or password reset in any environment.

### TD-019: No CI for `server/`
**Status**: Resolved
**Resolved**: 2026-10-08
**Original Priority**: High

`.github/workflows/server-ci.yml` runs on every change under `server/`:
type-check, lint, `openapi:check`, unit + route tests, the Postgres contract
suite against a `postgres:16` service container, the Docker image build
(with a `/health` probe), and `terraform validate`. CI never pushes or
deploys; deploys run from the operator's machine (`server/scripts/deploy.sh`).

### TD-002: Reports Feature Incomplete
**Status**: Resolved
**Resolved**: 2026-02-09
**Original Priority**: Medium

**Description**:
The `/reports` route existed but the Reports page was not fully implemented.

**Resolution**:
- Created full Reports page at `src/pages/reports/ReportsPage.tsx`
- Implemented 5 report presets: Summary, By Project, By Client, Expenses by Project, Unpaid Aging
- Added date range filter with presets (This Month, Last Month, This Year, All Time, Custom)
- Added currency mode selector (USD, ILS, Both)
- Implemented CSV export for all report types
- Uncommented and activated route in router.tsx

---

### TD-008: Error Boundaries Missing
**Status**: Resolved
**Resolved**: 2026-02-09
**Original Priority**: Medium

**Description**:
No React error boundaries in place. A rendering error in one component could crash the entire app.

**Resolution**:
- Created `ErrorBoundary` component for app-level error catching with retry/reload UI
- Created `InlineErrorBoundary` for drawer-level errors with minimal fallback
- Wrapped main App component in `ErrorBoundary` in main.tsx
- Wrapped all 8 drawers in `InlineErrorBoundary` in AppShell.tsx
- Added CSS styling for error fallback states

---

### TD-012: fxRateRepo.getLatest() Missing Compound Index
**Status**: Resolved
**Resolved**: 2026-02-09
**Original Priority**: Low

**Description**:
The `fxRateRepo.getLatest()` function used a compound index `[baseCurrency+quoteCurrency]` that was not defined in the database schema, causing SchemaError when called.

**Resolution**:
- Added database version 12 with compound index `[baseCurrency+quoteCurrency]` on fxRates table
- Unskipped tests in `src/db/__tests__/settingsRepo.test.ts`
- All 16 settingsRepo tests now pass

---

### TD-011: Design System Inconsistencies Between Landing and App
**Status**: Resolved
**Resolved**: 2026-02-09
**Original Priority**: High

**Description**:
The design system had accumulated inconsistencies between the landing page and the main app: duplicate token definitions (`--font-size-*` vs `--text-*`), dual button systems (`.landing-btn--*` vs `.btn-*`), focus style mismatch (`outline` vs `box-shadow`), landing page defensive fallbacks, and heading typography not using `--font-heading`.

**Resolution**:
- **Phase 1**: Added deprecation notices to all legacy CSS variables in `index.css`
- **Phase 2**: Removed dead `.landing-btn--*` classes from `LandingPage.css`, removed inline fallback values from 12 landing page CSS files
- **Phase 3**: Migrated 39 CSS files from legacy tokens to canonical tokens:
  - `--font-size-*` → `--text-*`
  - `--font-weight-*` → `--weight-*`
  - `--color-*` → direct theme tokens
  - `--shadow-sm/md/lg` → `--shadow-1/2/3`
- **Phase 4**: Standardized all `:focus-visible` styles to use `box-shadow: var(--focus-ring)` instead of `outline`; updated heading line-height to use `--leading-tight` (kept compact heading sizes for app's data-dense UI)

**Files Modified**:
- `src/index.css` (deprecation notices + token migration + focus styles + heading line-height)
- `src/pages/landing/LandingPage.css` (button removal + fallback removal + focus styles)
- `src/components/layout/ProfileSwitcher.css` (focus styles)
- `src/components/ui/Toast.css` (focus styles)
- `src/components/ui/RowActionsMenu.css` (focus styles)
- `src/features/documents/components/SplitWorkspace.css` (shadow token)
- 39+ component CSS files (token migration)

---

### TD-R001: Missing Document Immutability
**Status**: Resolved
**Resolved**: 2024-08
**Original Priority**: High

**Description**: Documents could be edited after export, breaking audit trail.

**Resolution**: Implemented `lockedAt` timestamp on first PDF export. Locked documents cannot be modified.

---

### TD-R002: No Multi-Profile Support
**Status**: Resolved
**Resolved**: 2024-09
**Original Priority**: High

**Description**: Expenses and documents not scoped to business profiles.

**Resolution**: Added `profileId` to expenses, retainers, and engagements. Business profiles fully isolated.

---

## Adding New Debt

When adding technical debt:

```markdown
### TD-XXX: [Title]
**Status**: Open
**Priority**: High | Medium | Low
**Introduced**: YYYY-MM
**Impact**: [User/developer impact]

**Description**:
[What the debt is and why it exists]

**Current State**:
[How it currently works]

**Remediation**:
1. [Step 1]
2. [Step 2]

**Effort**: Small | Medium | Large
```

When resolving debt:
1. Move to "Resolved Debt" section
2. Add resolution date and description
3. Update status to "Resolved"
