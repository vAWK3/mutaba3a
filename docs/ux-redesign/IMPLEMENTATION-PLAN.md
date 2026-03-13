# UX Redesign Implementation Plan

> **Reference:** [UX-REDESIGN-SPEC.md](./UX-REDESIGN-SPEC.md)
> **Created:** 2026-03-13

---

## Phase 1: Navigation and Labeling Cleanup ✅

**Goal:** Restructure navigation to reflect question-first UX without breaking existing functionality.

### 1.1 Sidebar Navigation Restructure ✅
- [x] **1.1.1** Update sidebar nav sections to use new structure (Main, Workspace, System)
- [x] **1.1.2** Add new nav items: `/income`, `/expenses`, `/insights`
- [x] **1.1.3** Remove nav items: Documents, Retainers, Engagements, Money Answers
- [x] **1.1.4** Reorder nav items: Home, Income, Expenses, Insights | Clients, Projects | Settings
- [x] **1.1.5** Update nav icons for Income, Expenses, Insights

### 1.2 Route Changes ✅
- [x] **1.2.1** Create `/income` route (initially can redirect to `/transactions`)
- [x] **1.2.2** Create `/expenses` route (new page or redirect)
- [x] **1.2.3** Create `/insights` route (consolidate reports/money-answers)
- [x] **1.2.4** Add redirect: `/transactions` → `/income`
- [x] **1.2.5** Add redirect: `/money-answers` → `/insights`
- [x] **1.2.6** Add redirect: `/reports` → `/insights`
- [x] **1.2.7** Hide deprecated routes from router (keep code, remove from nav)

### 1.3 i18n Label Updates ✅
- [x] **1.3.1** Add new translation keys: `nav.income`, `nav.expenses`, `nav.insights`
- [x] **1.3.2** Add section keys: `nav.sections.main`, `nav.sections.workspace`
- [x] **1.3.3** Rename `nav.overview` → `nav.home` (or add alias)
- [x] **1.3.4** Update all language files (en, ar)

### 1.4 Global Add Menu Simplification ✅
- [x] **1.4.1** Update TopBar add menu to show only: Add income, Add expense, Add client, Add project
- [x] **1.4.2** Remove: Add document, Add engagement, Add retainer from menu
- [x] **1.4.3** Update add menu i18n keys

### 1.5 Page Title Updates ✅
- [x] **1.5.1** Update Overview page title to "Home"
- [x] **1.5.2** Update page metadata/breadcrumbs to reflect new naming (no changes needed - breadcrumbs show hierarchy, not home link)

---

## Phase 2: Home, Income, Expenses Redesign

**Goal:** Rebuild core money-tracking screens with question-first UX.

### 2.1 Home Page Redesign ✅
- [x] **2.1.1** Design new Home page layout (KPI strip, attention, activity, summaries)
- [x] **2.1.2** Create `KpiCard` component for currency-aware totals
- [x] **2.1.3** Create `KpiStrip` component (Received, Outstanding, Expenses, Net)
- [x] **2.1.4** Implement currency tab switching on KPI cards (ILS/USD/Both)
- [x] **2.1.5** AttentionSection - using existing attention-list component
- [x] **2.1.6** Implement overdue unpaid query (existing useAttentionReceivables)
- [x] **2.1.7** Due next 7 days - already in attention query
- [x] **2.1.8** RecentActivity feed - using existing component
- [x] **2.1.9** Create `QuickSummaries` component (top clients, projects, categories)
- [x] **2.1.10** Wire up Home page with new components
- [ ] **2.1.11** Add empty state for new users (deferred)

### 2.2 Income Page (New) ✅
- [x] **2.2.1** Create Income page shell with header and filters
- [x] **2.2.2** Create status tabs (All, Unpaid, Received, Overdue)
- [x] **2.2.3** Create `IncomeSummaryStrip` component
- [x] **2.2.4** Create income ledger table
- [x] **2.2.5** Filter transactions to show only income types
- [x] **2.2.6** Add status-based filtering logic
- [x] **2.2.7** Implement "mark as received" quick action
- [ ] **2.2.8** Implement partial payment recording (deferred)
- [x] **2.2.9** Connect to existing TransactionDrawer for edit
- [x] **2.2.10** Add Income-specific empty state
- [x] **2.2.11** Update drawer to default to income type when opened from this page

### 2.3 Expenses Page (New) ✅
- [x] **2.3.1** Create Expenses page shell with header and filters
- [x] **2.3.2** Create `ExpensesSummaryStrip` component
- [x] **2.3.3** Create expense list view
- [x] **2.3.4** Create "by category" view toggle
- [x] **2.3.5** Create "by project" view toggle
- [x] **2.3.6** Filter transactions to show only expense types
- [x] **2.3.7** Implement category grouping logic
- [x] **2.3.8** Implement project grouping logic
- [x] **2.3.9** Connect to existing TransactionDrawer for edit
- [x] **2.3.10** Add Expenses-specific empty state
- [x] **2.3.11** Update drawer to default to expense type when opened from this page

### 2.4 Shared Components ✅
- [x] **2.4.1** Create/update `CurrencyTabs` component for page-level currency switching
- [x] **2.4.2** Create `SummaryStrip` base component (reusable across pages) - inline in Income/Expenses pages
- [x] **2.4.3** Create `SegmentedTabs` component for status filtering
- [x] **2.4.4** Update `DateRangeControl` if needed for new pages - no changes needed

### 2.5 First-Run Flow
- [ ] **2.5.1** Design first-run onboarding flow (3 steps)
- [ ] **2.5.2** Create `OnboardingStep` component
- [ ] **2.5.3** Implement "Add first client" step
- [ ] **2.5.4** Implement "Add first project" step
- [ ] **2.5.5** Implement "Add first income/expense" step
- [ ] **2.5.6** Add onboarding completion detection
- [ ] **2.5.7** Redirect to Home with live data after completion

---

## Phase 3: Clients and Projects Repositioning

**Goal:** Transform entity pages into money-relationship views.

### 3.1 Clients List Redesign ✅
- [x] **3.1.1** Update columns: name, active projects, received, unpaid, last activity
- [x] **3.1.2** Remove CRM-style fields from list view (not needed - columns already clean)
- [x] **3.1.3** Add inline value indicators (received total, unpaid total)
- [ ] **3.1.4** Update sorting options (by value, by unpaid, by activity) (deferred)

### 3.2 Client Detail Redesign ✅
- [x] **3.2.1** Create `ClientSummaryHeader` with key financials (inline-stats)
- [x] **3.2.2** Add "Total received" stat (paidIncome)
- [x] **3.2.3** Add "Total outstanding" stat (unpaid)
- [x] **3.2.4** Add "Expenses on projects" stat
- [x] **3.2.5** Refactor projects section to show financial summary per project (received, unpaid, expenses, net)
- [x] **3.2.6** Add income ledger filtered to this client (transactions tab exists)
- [ ] **3.2.7** Add recent activity section (deferred)
- [ ] **3.2.8** Simplify/reduce profile-style information (deferred)

### 3.3 Projects List Redesign ✅
- [x] **3.3.1** Update columns: name, client, field, received, unpaid, expenses, net, last activity
- [x] **3.3.2** Add net calculation (received - expenses)
- [x] **3.3.3** Add visual indicator for negative net projects (color-coded net cell)
- [x] **3.3.4** Add summary strip with totals (received, unpaid, expenses, net)
- [ ] **3.3.5** Update sorting options (by net, by unpaid, by activity) (deferred)

### 3.4 Project Detail Redesign ✅
- [x] **3.4.1** Create `ProjectSummaryHeader` with key financials (inline-stats)
- [x] **3.4.2** Add "Received" stat (shown as "Paid")
- [x] **3.4.3** Add "Unpaid" stat
- [x] **3.4.4** Add "Expenses" stat
- [x] **3.4.5** Add "Net" stat with color coding
- [x] **3.4.6** Add income timeline section (transactions tab)
- [x] **3.4.7** Add expense timeline section (transactions tab shows both)
- [x] **3.4.8** Simplify notes section (already simplified)

---

## Phase 4: Insights Consolidation

**Goal:** Unify all reporting into single powerful page.

### 4.1 Insights Page Structure ✅
- [x] **4.1.1** Create Insights page shell
- [x] **4.1.2** Create preset tabs component (Summary, Clients, Projects, Expenses, Unpaid)
- [x] **4.1.3** Create shared filter bar (period, currency, client, project, field)
- [x] **4.1.4** Implement tab routing/state management

### 4.2 Summary Preset ✅
- [x] **4.2.1** Create Summary view layout
- [x] **4.2.2** Show received total
- [x] **4.2.3** Show unpaid total
- [x] **4.2.4** Show expenses total
- [x] **4.2.5** Show net calculation
- [ ] **4.2.6** Add monthly trend visualization (simple) (deferred)

### 4.3 Clients Preset ✅
- [x] **4.3.1** Create Clients insight view
- [x] **4.3.2** Show received by client breakdown
- [x] **4.3.3** Show outstanding by client
- [ ] **4.3.4** Show top clients ranking (deferred)
- [ ] **4.3.5** (Later) Add slowest-paying clients (deferred)

### 4.4 Projects Preset ✅
- [x] **4.4.1** Create Projects insight view
- [x] **4.4.2** Show received vs expenses comparison
- [x] **4.4.3** Show outstanding by project
- [ ] **4.4.4** Show top profitable projects (deferred)
- [x] **4.4.5** Show projects with negative net (color-coded net column)

### 4.5 Expenses Preset ✅
- [x] **4.5.1** Create Expenses insight view
- [ ] **4.5.2** Show expenses by category breakdown (deferred)
- [x] **4.5.3** Show expenses by project breakdown
- [ ] **4.5.4** Show expenses by month trend (deferred)

### 4.6 Unpaid Preset ✅
- [x] **4.6.1** Create Unpaid insight view
- [x] **4.6.2** Implement unpaid aging buckets (30/60/90+ days)
- [x] **4.6.3** Show overdue count and total
- [ ] **4.6.4** Show outstanding by client (deferred)
- [ ] **4.6.5** Show outstanding by project (deferred)

### 4.7 Export and Actions ✅
- [x] **4.7.1** Implement CSV export for each preset
- [x] **4.7.2** Ensure currency mode applies to all views
- [ ] **4.7.3** Add print-friendly view option (optional) (deferred)

### 4.8 Deprecation Cleanup ✅
- [x] **4.8.1** Mark Money Answers page as deprecated (redirect in place, code kept for reference)
- [x] **4.8.2** Mark standalone Reports page as deprecated (redirect in place, code kept for reference)
- [x] **4.8.3** Deprecation notices added to index files and main components

---

## Cross-Cutting Concerns

### Testing
- [ ] Update existing tests for renamed routes
- [ ] Add tests for new Income page
- [ ] Add tests for new Expenses page
- [ ] Add tests for new Insights page
- [ ] Add tests for Home page redesign
- [ ] Add tests for redirects
- [ ] E2E tests for critical flows

### Documentation
- [ ] Update COMPONENT_REGISTRY.md with new components
- [ ] Update CHANGELOG.md after each phase
- [ ] Update SYSTEM_OVERVIEW.md with new architecture
- [ ] Update user-facing help/docs if any

### Performance
- [ ] Ensure summary calculations are memoized
- [ ] Verify no re-render storms with new filter state
- [ ] Test with larger datasets

---

## Implementation Priority

| Phase | Priority | Estimated Scope |
|-------|----------|-----------------|
| 1.1-1.3 (Nav + Routes) | P0 | Foundation for all other work |
| 1.4-1.5 (Add menu + Titles) | P0 | Quick wins, user-visible |
| 2.1 (Home) | P1 | Core value proposition |
| 2.2 (Income) | P1 | Primary workflow |
| 2.3 (Expenses) | P1 | Primary workflow |
| 2.4-2.5 (Shared + First-run) | P2 | Polish and onboarding |
| 3.x (Clients/Projects) | P2 | Enhancement |
| 4.x (Insights) | P2 | Consolidation |

---

## Success Metrics

- [ ] User can understand received/unpaid/expenses from Home in <10 seconds
- [ ] Adding income takes <30 seconds
- [ ] Adding expense takes <15 seconds
- [ ] All existing data remains accessible
- [ ] No regression in existing functionality
- [ ] All tests pass after each phase
