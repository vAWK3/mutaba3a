# CHANGELOG.md — Change History

> **Purpose**: Track all significant changes to the codebase.
> **Rule**: Update this file after completing any change.

---

## Format

```markdown
## [Version] - YYYY-MM-DD

### Added
- New features

### Changed
- Changes to existing functionality

### Fixed
- Bug fixes

### Removed
- Removed features

### Technical
- Refactoring, dependencies, infrastructure
```

---

## [Unreleased] - 2026-03-14

### Changed
- **ProjectDrawer Profile Selector**: Profile selector now displays when at least one profile exists (changed from requiring 2+ profiles)
  - Updated condition from `profiles.length > 1` to `profiles.length > 0` in `src/components/drawers/ProjectDrawer.tsx:167`
  - Makes profile association explicit and visible even for single-profile users
  - Aligns with UX principle of making profile relationships transparent
  - Added 5 comprehensive tests for profile selector behavior in `ProjectDrawer.test.tsx`:
    - Shows selector when one profile exists
    - Shows selector when multiple profiles exist
    - Allows selecting a profile
    - Pre-populates with active profile
    - Hides selector when no profiles exist
  - Files changed: `ProjectDrawer.tsx`, `ProjectDrawer.test.tsx`
  - Test status: 13 passing (2 skipped)

### Added
- **Partial Payments UI Integration**: Fully integrated partial payment functionality into income tables across the application
  - Added `PaymentStatusBadge` component to display payment status with percentage for partial payments
  - Exported `PaymentStatusBadge` from `src/components/ui/index.ts`
  - Updated `transactionRepo.list()` to compute `paymentStatus` and `remainingAmountMinor` for all income transactions
  - Income tables now show:
    - Payment status badge (Paid, Partial X%, Unpaid)
    - Received amount display for partial payments
    - "Record Payment" action in row menu for unpaid income
    - Visual indication of payment progress
  - Updated pages:
    - `/income` (IncomePage.tsx) - main income ledger
    - `/projects/:id` (ProjectDetailPage.tsx) - project transactions tab
    - `/clients/:id` (ClientDetailPage.tsx) - receivables tab and transactions tab
  - Added comprehensive tests in `IncomePage.test.tsx`:
    - PaymentStatusBadge rendering
    - Partial payment display
    - Record payment action availability
    - Payment status calculations
  - All translations (en, ar) already in place for partial payment UI
  - Removed completed TODO item

### Fixed
- **Timezone Bug in Recurring Expense Calculations**: Fixed `shouldRuleOccurInMonth` in `forecastCalculations.ts` to use consistent year/month numeric comparison instead of Date object comparison, which was causing incorrect results in UTC+ timezones
- **untilDate End Mode**: Fixed end date logic to properly exclude months where the occurrence day would fall after the end date

### Added
- **Recurring Source Badge**: Expenses generated from recurring rules now display a "Recurring" badge next to the title
  - Added `.recurring-badge` CSS styling in `index.css`
  - Added translation keys `expenses.fromRecurring` and `expenses.recurringBadge`
- **Profile Mode Indicator**: Expenses page now shows explicit "All Profiles" vs "Current Profile" toggle
  - Added `.expenses-mode-indicator` and `.expenses-mode-button` styles
  - Added translation keys for profile mode UI
  - Now shows all available profiles as buttons for quick switching
- **Profile-Specific Tools Card**: Shows explanatory message when in All Profiles mode about features that require a specific profile
- **Delete Action**: Added delete action to expense row actions menu with confirmation dialog
  - Special confirmation message for expenses from recurring rules
- **Keyboard Shortcuts**: Added keyboard shortcuts to expenses page
  - `N` - Open new expense drawer
  - `/` - Focus search input
  - `Esc` - Close drawer (already handled by Drawer component)
- **Profile-Aware Routing**: Clicking a profile button now navigates to `/expenses/profile/$profileId`
  - Deep-linkable profile URLs
  - URL reflects current profile context

### Changed
- **Duplicate Button**: Now properly prefills expense data (amount, currency, vendor, category, title) when duplicating
- **Multi-Currency Group Totals**: `ExpenseGroupedView` now shows separate totals per currency instead of summing all currencies
- **SearchInput Component**: Now uses `forwardRef` and exposes `focus()` method via ref

### Fixed
- **GAP 1**: Delete action now available in row actions menu
- **GAP 2**: Duplicate button now prefills expense data correctly
- **GAP 3**: Page mode is now explicit with visible toggle
- **GAP 4**: Profile selection now navigates to profile-specific URL
- **GAP 6**: Multi-currency group totals now show separate amounts per currency
- **GAP 10**: Recurring source badge now identifies expenses generated from rules

### Technical
- Changed `GroupedExpenses` interface from `totalMinor: number` to `totalsByCurrency: Record<string, number>`
- Added `.expense-title-cell` wrapper for title cell content
- Added `SearchInputRef` type export from filters
- Added `useNavigate` hook for profile-based routing

---

## [Previous] - 2026-03-13

### Added
- **Income Query Hooks (`useIncomeQueries.ts`)**: New dedicated hooks for income-specific queries
  - `useIncome(filters)`: Fetch income transactions with optional filters (pre-filters by kind='income')
  - `useIncomeById(id)`: Fetch a single income transaction
  - `useReceivables(filters)`: Fetch unpaid income (receivables) with optional overdue filter
  - `useIncomeTotals()`: Fetch income totals for overview displays
  - `useAttentionReceivables()`: Fetch receivables needing attention
  - `useCreateIncome()`, `useUpdateIncome()`: Create/update income transactions
  - `useMarkIncomePaid()`: Mark income as paid (replaces deprecated `useMarkTransactionPaid`)
  - `useRecordIncomePartialPayment()`: Record partial payments
  - `useDeleteIncome()`, `useArchiveIncome()`, `useUnarchiveIncome()`: Lifecycle mutations

### Changed
- **IncomePage**: Migrated from `useTransactions` to `useIncome` and `useMarkIncomePaid`
- **ClientDetailPage**: Migrated receivables tab from `useTransactions` to `useReceivables`, mark paid to `useMarkIncomePaid`
- **ProjectDetailPage**: Migrated mark paid from `useMarkTransactionPaid` to `useMarkIncomePaid`
- **TransactionsPage**: Migrated mark paid from `useMarkTransactionPaid` to `useMarkIncomePaid` (keeps `useTransactions` for mixed view)
- **RetainerMatchingDrawer**: Migrated from `useTransactions` to `useIncome` for paid income lookup

### Technical
- **Deprecated `useTransactions`**: Added deprecation notice; kept for legacy mixed views until next release
- **Deprecated `useMarkTransactionPaid`**: Added deprecation notice; use `useMarkIncomePaid` instead
- Proper query key separation for income queries vs generic transaction queries
- Income hooks automatically invalidate both income-specific and legacy transaction caches for backwards compatibility

---

- **Insights Reintegration (Phase 1 & 2)**:
  - **Phase 1: Data Contracts & Aggregation Functions**
    - New forecast types: `ForecastKPIs`, `AmountByCurrency`, `ForecastOptions`, `MonthActuals`, `AttentionItem` in `src/types/index.ts`
    - Pure aggregation functions in `src/lib/aggregations.ts`:
      - Date utilities: `getTodayISO`, `getMonthRange`, `getDaysInMonth`, `daysBetween`, `isDateInRange`
      - Amount utilities: `zeroAmounts`, `addAmount`, `subtractAmount`
      - Transaction grouping: `getTransactionEffectiveDate`, `groupTransactionsByDay`, `groupTransactionsByMonth`
      - Forecast calculations: `calculateForecastKPIs`, `calculateMonthActuals`, `calculateRunningBalance`
      - Attention helpers: `findOverdueUnpaidIncome`, `findUnpaidIncomeDueSoon`, `findUnpaidIncomeMissingDueDate`
    - 60 unit tests for aggregation functions in `src/lib/__tests__/aggregations.test.ts`
    - Terminology update per ADR-010: "receivables" → "unpaid income", "projections" → "projected retainer"
  - **Phase 2: Home Page Components**
    - `PredictiveKpiStrip` component: 3 forecast KPI cards (Will I Make It?, Cash on Hand, Coming/Leaving)
    - `AttentionFeed` component: Severity-sorted attention items with max 5 items, collapsible
    - `MonthActualsRow` component: Collapsible summary of received/unpaid/expenses/net
    - `InfoIcon` in icons
    - Updated `OverviewPage` to use new components (current-month only, no date range selector)
    - i18n translations for all new components (English and Arabic)
    - CSS styles for all new components
  - **Phase 3: Insights Page Enhancement**
    - Added Cash Flow Timeline link to Insights Summary tab
    - Links to `/money-answers` page for dedicated timeline view with its own date picker
    - i18n translations for timeline link and hint text (English and Arabic)
    - Removed inline period toggle and inclusion toggles to avoid conflicts with Insights date range
  - **Phase 4: Polish, Responsiveness, Testing, Documentation**
    - **Responsive Design**:
      - Added mobile breakpoint (480px) for attention-feed, actuals-row, kpi-card-forecast
      - Stack layouts and reduced padding on small screens
      - Hidden currency tabs on mobile in actuals-row (uses localStorage default)
    - **Accessibility Improvements**:
      - AttentionFeed: semantic `<ul>`/`<li>` with role="list"/role="listitem"
      - Added aria-label on attention list container
      - Added aria-hidden="true" on decorative icons
      - Added aria-label on action buttons for screen readers
      - Added aria-expanded on expand/collapse toggle buttons
    - **Component Documentation**:
      - Updated COMPONENT_REGISTRY.md with new Home components section
      - Documented PredictiveKpiStrip, AttentionFeed, MonthActualsRow, QuickSummaries, InfoIcon
      - Added props tables, usage examples, and accessibility notes
      - Updated Component Ownership table
    - **Integration Tests**:
      - 47 new tests for Home components in `src/components/home/__tests__/`
      - AttentionFeed.test.tsx: rendering, accessibility, severity styling, actions, currency display
      - PredictiveKpiStrip.test.tsx: currency tabs, help tooltips, value display, Coming/Leaving card
      - MonthActualsRow.test.tsx: expand/collapse, localStorage persistence, currency tabs, color coding

### Fixed
- **Desktop app update mechanism**:
  - Fixed `deploy.sh` signature extraction - was including full CLI output instead of just the base64 signature in `latest.json`, breaking Tauri's auto-updater
  - Added version change detection (`handleVersionChange()` in `src/lib/platform.ts`) - clears update-related localStorage caches when app version changes, ensuring users who install a new DMG see the correct version (macOS preserves app data across installs)

### Added
- **Migration Safety Layer** (`src/db/migration-safety.ts`):
  - Automatic pre-migration backups to prevent data loss during schema updates
  - Post-migration validation to detect missing fields (profileId, receivedAmountMinor)
  - Auto-fix capability for common migration issues
  - Backup storage in separate IndexedDB database (`mutaba3a_backup`)
  - Recovery functions: `restoreFromBackup()`, `importBackupFromFile()`
  - Validation functions: `validateMigration()`, `autoFixMigrationIssues()`
  - Export functions: `downloadBackup()`, `exportCompleteBackup()`
  - Migration event logging for audit trail
  - Keeps last 3 backups automatically, cleans up older ones
  - Tests: 16 tests in `src/db/__tests__/migration-safety.test.ts`
  - Integrated into `initDatabase()` - runs automatically on app startup
  - `repairDatabase()` function for manual recovery

- **AmountWithConversion component**: New UI component that displays single-currency amounts with hover tooltip showing ILS-converted value using live FX rates from Frankfurter API
  - Used in transaction tables where each row has a single currency
  - Shows original currency with hover tooltip displaying approximate ILS conversion and FX rate source (Live/Cached)
  - Graceful degradation: shows plain amount if FX rate unavailable

### Changed
- **Multi-currency display reintegration**: Updated all transaction-related pages to use unified currency display components
  - **TransactionsPage**: Uses `AmountWithConversion` for individual transaction amounts with hover conversion
  - **OverviewPage**: Uses `AmountWithConversion` in recent activity and needs attention sections
  - **ClientDetailPage**: Uses `AmountWithConversion` in transaction tables and recent activity
  - **ProjectDetailPage**: Uses `AmountWithConversion` in transaction tables
  - **IncomePage**: Uses `CurrencySummaryPopup` for summary totals, `AmountWithConversion` for rows
  - **ExpensesLedgerPage**: Uses `CurrencySummaryPopup` for summary totals, `AmountWithConversion` for rows
- ILS is now the default display currency with hover tooltips showing conversion breakdown

### Changed
- **IncomeDrawer Refactor (TransactionDrawer → IncomeDrawer)**:
  - Renamed `TransactionDrawer` to `IncomeDrawer` for clarity
  - Replaced type selector (Income/Receivable/Expense) with status selector (Earned/Invoiced/Received)
  - New status model maps: Earned → unpaid, Invoiced → unpaid, Received → paid
  - Added contextual profile handling:
    - Single profile users: profile hidden
    - Multi-profile users: profile shown as compact chip
    - "All Profiles" mode: shows profile quick picker
  - Added `ProfileContextChip` component for drawer profile display
  - Added `ProfileQuickPicker` component for fast profile selection
  - Added `useProfileAwareAction` hook for profile-checking before actions
  - Updated `useDrawerStore` with `incomeDrawer` state (legacy `transactionDrawer` aliased)
  - Updated SidebarNav to use profile-aware actions
  - Added i18n keys for income drawer status labels (en/ar)
  - Migrated tests from TransactionDrawer.test.tsx to IncomeDrawer.test.tsx

### Added
- **Partial Payments Support**:
  - Added `receivedAmountMinor` field to Transaction for tracking partial payments
  - Added `PaymentStatus` type ('unpaid' | 'partial' | 'paid')
  - Database schema v14 with migration for existing transactions
  - `transactionRepo.recordPartialPayment()` method to record incremental payments
  - Updated `transactionRepo.getDisplay()` to compute `paymentStatus` and `remainingAmountMinor`
  - `PaymentStatusBadge` component (`src/components/ui/PaymentStatusBadge.tsx`)
  - `PartialPaymentDrawer` component with quick-fill buttons (25%, 50%, 100%)
  - `useRecordPartialPayment` mutation hook
  - i18n keys for partial payment UI in en.json and ar.json

- **URL-Persisted Sorting**:
  - `useSortState` hook (`src/hooks/useSortState.ts`) for URL-based sort state management
  - ClientsPage and ProjectsPage now persist sort field/direction in URL params
  - Sort state survives page refresh and navigation

- **First-Run Onboarding**:
  - `useOnboardingStore` (`src/lib/onboardingStore.ts`) - Zustand store with localStorage persistence
  - `OnboardingOverlay` component with step-based guided setup
  - `OnboardingStepIndicator` component for visual progress
  - 3-step flow: Add Client → Create Project → Record Income
  - Auto-advances when drawers complete entity creation
  - Skip option persists in localStorage
  - i18n keys for onboarding UI in en.json and ar.json

- **Multi-Profile with "All Profiles" Lens**:
  - Added `profileId` field to `Client`, `Project`, `Transaction` types for profile isolation
  - Database schema v13 with migration to assign existing records to default profile
  - `ProfileStore` (`src/lib/profileStore.ts`) - Zustand store for active profile state
  - `useActiveProfile` hook (`src/hooks/useActiveProfile.ts`) - Business logic for profile context
  - `useProfileFilter` hook - Helper for query filtering
  - "All Profiles" option in ProfileSwitcher when 2+ profiles exist
  - `ProfileBadge` component (`src/components/ui/ProfileBadge.tsx`) - Visual indicator for profile
  - `ProfilePickerModal` (`src/components/modals/ProfilePickerModal.tsx`) - Profile selection for creation flows
  - Updated drawer stores to support `defaultProfileId` parameter
  - Updated pages (Overview, Clients, Projects, Expenses) to respect profile context
  - i18n keys: `profileSwitcher.allProfiles`, `profile.select`, `profile.selectPrompt`, `profile.badge.viewingAll` (en/ar)

- **UX Redesign Phase 4 - Insights Page** (`src/pages/insights/InsightsPage.tsx`):
  - New consolidated Insights page at `/insights` replacing Reports redirect
  - Preset tabs: Summary, Clients, Projects, Expenses, Unpaid
  - Summary tab: Paid income, unpaid receivables, expenses, net calculation
  - Clients tab: Client list with paid income and unpaid breakdown
  - Projects tab: Project list with received, unpaid, expenses, net columns
  - Expenses tab: Expenses by project breakdown
  - Unpaid tab: Aging buckets (current, 1-30d, 31-60d, 60+d overdue)
  - Date range filter (period control)
  - Currency mode selector (USD, ILS, Both)
  - CSV export for each preset tab
  - Tests: 21 tests in `src/pages/insights/__tests__/InsightsPage.test.tsx`
  - i18n: Added `insights.title` and `insights.tabs.*` keys (en/ar)
  - CSS: Added `.insights-tabs`, `.insights-tab`, `.insights-section` styles

### Fixed
- **i18n**: Added missing `transactions.columns.description` key (en: "Description", ar: "الوصف")

### Changed
- **Router**: `/insights` route now uses dedicated InsightsPage instead of redirecting to ReportsPage

### Deprecated
- **MoneyAnswersPage** (`src/pages/money-answers/`): Marked as deprecated with JSDoc comments. Route redirects to `/insights`. Code kept for reference.
- **ReportsPage** (`src/pages/reports/`): Marked as deprecated with JSDoc comments. Route redirects to `/insights`. Code kept for reference.

### Added
- **UX Redesign Specification**:
  - Created `docs/ux-redesign/UX-REDESIGN-SPEC.md` - Authoritative spec for question-first UX redesign
  - Created `docs/ux-redesign/IMPLEMENTATION-PLAN.md` - 4-phase implementation breakdown with ~100 actionable tasks
  - Product direction shift: entity-first CRM → question-first cash flow workspace
  - New navigation structure: Home, Income, Expenses, Insights | Clients, Projects | Settings
  - Deprecation plan for Documents, Retainers, Engagements, standalone Reports/Money Answers

### Added
- **UX Redesign Phase 2.3 - Expenses Page** (`src/pages/expenses/ExpensesLedgerPage.tsx`):
  - New question-first expenses ledger page at `/expenses`
  - View toggles: List (default), By Category, By Project
  - Expenses summary strip showing total expenses
  - Category grouping with subtotals
  - Project grouping with subtotals
  - Transaction-based filtering (kind='expense')
  - Connects to TransactionDrawer for edit with default kind='expense'
  - Empty state with "Add Expense" action
  - Tests: 15 tests in `src/pages/expenses/__tests__/ExpensesLedgerPage.test.tsx`
  - Profile-based expense system moved to `/expenses/profiles` route

- **EmptyState Component Enhancement** (`src/components/ui/EmptyState.tsx`):
  - Added `hint` prop as alias for `description`
  - Added `actionLabel` and `onAction` props as convenience alternatives to `action` object
  - Maintains backwards compatibility with existing `description` and `action` props

- **UX Redesign Phase 3.1 - Clients List Redesign** (`src/pages/clients/ClientsPage.tsx`):
  - Added "Received" column showing paid income totals per client
  - Added summary strip with total clients count, total received, total unpaid
  - CurrencySummaryPopup for multi-currency display (USD/ILS/EUR)
  - Tests: 16 tests in `src/pages/clients/__tests__/ClientsPage.test.tsx`
  - i18n: Added `clients.columns.received` and `clients.summary.*` keys

- **UX Redesign Phase 3.3 - Projects List Redesign** (`src/pages/projects/ProjectsPage.tsx`):
  - Added columns: Received, Expenses, Net
  - Net calculation: received - expenses per project
  - Visual indicator for negative net projects (color-coded cells)
  - Summary strip with totals: projects count, received, unpaid, expenses, net
  - Tests: 23 tests in `src/pages/projects/__tests__/ProjectsPage.test.tsx`
  - i18n: Added `projects.columns.received` and `projects.summary.*` keys
  - CSS: Added `.projects-summary-strip`, `.net-cell.positive/.negative` styles

### Changed
- **UX Redesign Phase 1 Complete** (Navigation + Routes + i18n + Add Menu + Titles):
  - **Sidebar restructured** with question-first navigation sections (Main, Workspace, System)
  - **New routes**: `/income`, `/expenses`, `/insights` created
  - **Legacy redirects added**:
    - `/transactions` → `/income`
    - `/reports` → `/insights`
    - `/money-answers` → `/insights`
  - **Navigation items removed** from sidebar: Documents, Retainers, Engagements, Money Answers
  - **Global Add Menu simplified**: Removed Document option from TopBar add menu (now only: Income, Expense, Project, Client)
  - **Page title updated**: Overview page title changed from "Overview" to "Home" (en: "Home", ar: "الرئيسية")
  - **i18n labels** updated in en.json and ar.json with new nav keys
  - Files changed:
    - `src/router.tsx` - Added redirects for legacy routes
    - `src/components/layout/SidebarNav.tsx` - Already restructured with new nav sections
    - `src/components/layout/TopBar.tsx` - Removed Document from add menu
    - `src/lib/i18n/translations/en.json` - Updated overview.title to "Home"
    - `src/lib/i18n/translations/ar.json` - Updated overview.title to "الرئيسية"

---

## [0.0.51] - 2026-03-13

### Fixed
- **Desktop App Update System**:
  - Re-enabled UpdateBanner component in AppShell
  - Fixed translation interpolation syntax (changed `{{var}}` to `{var}` to match i18n system)
  - UpdateBanner now properly shows when updates are available in Tauri desktop app
  - Users see update notifications with download progress and restart prompts

### Added
- **Update Banner Tests**:
  - `src/components/__tests__/UpdateBanner.test.tsx` (11 tests) - Full coverage for update banner states
  - `src/hooks/__tests__/useTauriUpdater.test.ts` (8 tests) - Hook behavior and API tests

### Technical
- Test count increased from 337 to 356 (19 new tests for update system)
- All 356 tests passing (5 skipped)
- Files changed:
  - `src/components/ui/UpdateBanner.tsx` - Uncommented and improved implementation
  - `src/components/layout/AppShell.tsx` - Re-enabled UpdateBanner import and usage
  - `src/lib/i18n/translations/en.json` - Fixed interpolation syntax in updateBanner keys
  - `src/lib/i18n/translations/ar.json` - Fixed interpolation syntax in updateBanner keys

---

## [0.0.50] - 2026-02-09

### Added
- **Reports Feature (TD-002 Resolved)**:
  - Full Reports page at `src/pages/reports/ReportsPage.tsx`
  - 5 report presets: Summary, By Project, By Client, Expenses by Project, Unpaid Aging
  - Date range filter (This Month, Last Month, This Year, All Time, Custom)
  - Currency mode selector (USD, ILS, Both)
  - CSV export for all report types
  - Route activated in `router.tsx`

- **Error Boundaries (TD-008 Resolved)**:
  - `ErrorBoundary` component for app-level error catching
  - `InlineErrorBoundary` for drawer-level errors
  - CSS styling for error fallback states

- **Database Schema v12**:
  - Added compound index `[baseCurrency+quoteCurrency]` on fxRates table (TD-012 resolved)

- **Test Coverage Expansion**:
  - `src/db/__tests__/expenseRepo.test.ts` (37 tests) - Expense, category, receipt, vendor, monthClose repos
  - `src/db/__tests__/retainerRepo.test.ts` (26 tests) - Retainer, projected income, schedule generator, matching
  - `src/components/__tests__/TransactionDrawer.test.tsx` (12 tests)
  - `src/components/__tests__/ClientDrawer.test.tsx` (10 tests)
  - `src/components/__tests__/ProjectDrawer.test.tsx` (10 tests)

- **E2E Testing Infrastructure (TD-004)**:
  - Playwright test framework configured (`playwright.config.ts`)
  - E2E test files created:
    - `e2e/navigation.spec.ts` - Page navigation tests
    - `e2e/transaction.spec.ts` - Transaction CRUD tests
    - `e2e/settings.spec.ts` - Settings page tests
  - npm scripts: `test:e2e`, `test:e2e:ui`

- **Accessibility Testing Infrastructure (TD-009)**:
  - axe-core/playwright installed for automated a11y testing
  - `e2e/accessibility.spec.ts` - Tests for WCAG compliance on all main pages

- **Pagination Infrastructure (TD-005)**:
  - `Pagination` component at `src/components/ui/Pagination.tsx`
  - `ChevronLeftIcon` and `ChevronRightIcon` icons
  - Pagination CSS styles with RTL support

- **SQLite Migration Preparation (TD-013)**:
  - Created `src/db/interfaces.ts` with TypeScript interfaces for all repositories
  - 19 repository interfaces defined for complete data layer abstraction
  - `IRepositoryProvider` factory interface for platform-based implementation selection
  - Exported interfaces from `src/db/index.ts`

### Fixed
- Fixed missing required fields in test data (BusinessProfile, Receipt)
- Fixed unused variable warning in retainerRepo.test.ts

### Technical
- Test count increased from 246 to 337 (91 new tests)
- All 337 tests passing (5 skipped)
- TD-002, TD-008, TD-012 resolved
- **Sync Feature Audit (TD-003 Updated)**:
  - Verified bundle export/import sync is fully working
  - All sync modals wired in AppShell (Export, Import, Pairing)
  - `initializeSync()` called on app load
  - SyncSection component displayed in Settings
  - Updated TD-003 status: bundle sync working, live LAN sync needs Tauri verification

---

## [0.0.49] - 2026-02-09

### Added
- **Comprehensive Test Coverage for Main Flows**:
  - `src/db/__tests__/transactionRepo.test.ts` (37 tests) - Full CRUD, filtering, totals, overdue/attention logic
  - `src/db/__tests__/clientRepo.test.ts` (22 tests) - CRUD operations and client summaries
  - `src/db/__tests__/projectRepo.test.ts` (24 tests) - CRUD operations and project summaries
  - `src/db/__tests__/settingsRepo.test.ts` (16 tests) - Settings, FX rates, categories
  - `src/db/__tests__/aggregations.test.ts` (27 tests) - Pure aggregation functions
- Extended `src/test/utils.tsx` with new factory functions:
  - `createMockTransaction`, `createMockProject`, `createMockCategory`, `createMockFxRate`
  - Helper functions: `createMockIncome`, `createMockExpense`, `createMockReceivable`, `createMockOverdueReceivable`
  - Date utilities: `getRelativeDate`, `getRelativeTimestamp`

### Changed
- Updated `TEST_PLAN.md` with current coverage status
- Updated `TECH_DEBT.md`:
  - TD-001 status changed to "In Progress" with updated coverage information
  - Added TD-012 for fxRateRepo.getLatest() missing compound index bug

### Technical
- Test coverage improved from ~3% to ~40%
- All 246 tests passing (2 skipped due to missing compound index)
- Repository layer now has ~85% test coverage
- Tests cover: transactions, clients, projects, documents, business profiles, settings, categories, aggregations

---

## [0.0.48] - 2026-02-09

### Added
- Created `.claude/SYSTEM_OVERVIEW.md` - comprehensive system documentation
- Created `.claude/DECISIONS.md` - architectural decision records
- Created `.claude/COMPONENT_REGISTRY.md` - reusable component catalog
- Created `.claude/PATTERNS.md` - code patterns and conventions
- Created `.claude/CHANGELOG.md` - this file
- Created `.claude/TECH_DEBT.md` - technical debt tracking
- Created `.claude/CI_CD.md` - CI/CD pipeline documentation
- Added h5, h6 heading styles to index.css for completeness

### Changed
- Updated `DECISIONS.md` ADR-018 with canonical token naming clarification
- Updated `PATTERNS.md` with Design Token Patterns section (token quick reference, button styling, focus styles, dark mode support)
- Updated `TECH_DEBT.md` with TD-011 for design system inconsistencies (now resolved)

### Fixed
- **Design System Unification (TD-011 - Resolved)**:
  - Phase 1: Added deprecation notices to legacy CSS variables in index.css
  - Phase 2: Removed dead `.landing-btn--*` classes from LandingPage.css, removed inline fallback values from 12 landing page CSS files
  - Phase 3: Migrated 39+ CSS files from legacy tokens to canonical tokens (`--font-size-*` → `--text-*`, `--font-weight-*` → `--weight-*`, `--shadow-sm/md/lg` → `--shadow-1/2/3`)
  - Phase 4: Standardized focus styles to use `box-shadow: var(--focus-ring)` instead of `outline` across 7 files; updated line-height to use `--leading-tight` (kept compact heading sizes for app UI)

### Technical
- Formalized project knowledge management system
- Design system now has single source of truth: `theme.css` for canonical tokens
- All focus-visible styles use `box-shadow: var(--focus-ring)` for consistency
- App headings use compact sizes (h1: 20px, h2: 18px, h3: 16px, h4: 14px) for data-dense cockpit UI
- Landing page headings use larger theme.css scale for marketing emphasis
- Fixed missed token migration in SplitWorkspace.css (`--shadow-lg` → `--shadow-3`)

---

## [0.0.47] - Previous

### Added
- Engagement letter feature (task/retainer types)
- PDF generation for engagement letters
- Profile-scoped engagements

### Changed
- Engagement schema to support profileId

---

## [0.0.46] - Previous

### Fixed
- Payment matching UI improvements
- Cache issues with service worker

---

## [0.0.44] - Previous

### Added
- Web release automation
- Service worker improvements

---

## [0.0.43] and Earlier

*Historical releases - see git log for details.*

---

## Migration Notes

### v0.0.48
- No database schema changes
- No breaking API changes

### v0.0.47
- Database schema v10: Added `profileId` to engagements table
- Migration: Existing engagements assigned to default profile

### v0.0.44
- Database schema v9: Added engagement tables

---

## Version History Summary

| Version | Date | Highlights |
|---------|------|------------|
| 0.0.48 | 2026-02-09 | System documentation |
| 0.0.47 | 2026-02 | Engagement letters |
| 0.0.46 | 2026-01 | Payment UI fixes |
| 0.0.44 | 2026-01 | Web release |
| 0.0.40 | 2025-12 | Retainer matching |
| 0.0.35 | 2025-11 | Document immutability |
| 0.0.30 | 2025-10 | Expense tracking |
| 0.0.25 | 2025-09 | Document generation |
| 0.0.20 | 2025-08 | Sync foundation |
| 0.0.15 | 2025-07 | Multi-profile support |
| 0.0.10 | 2025-06 | Desktop (Tauri) |
| 0.0.5 | 2025-05 | Core MVP |
| 0.0.1 | 2025-04 | Initial release |
