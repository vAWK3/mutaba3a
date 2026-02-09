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

### TD-001: Limited Test Coverage
**Status**: In Progress
**Priority**: High
**Introduced**: 2024-05
**Updated**: 2026-02-09
**Impact**: Bugs may slip through, refactoring risky

**Description**:
Test coverage has been improved but still needs work.

**Current State (Updated 2026-02-09)**:
- `src/db/__tests__/` - Repository tests (businessProfileRepo, documentRepo, transactionRepo, clientRepo, projectRepo, settingsRepo, aggregations) - **✅ Good coverage**
- `src/hooks/__tests__/` - Hook tests for business profile and document hooks
- `src/components/__tests__/` - BusinessProfileDrawer component test
- `src/features/documents/__tests__/` - totals.test.ts, pdf.test.ts

**Remaining Gaps**:
- Drawer component tests (TransactionDrawer, ClientDrawer, ProjectDrawer)
- Page component tests
- Expense and Retainer repository tests
- useTransactionFilters and other utility hooks

**Remediation**:
1. ~~Add unit tests for all repository methods~~ ✅ Done for core repos
2. Add component tests for critical UI (drawers, tables)
3. Add integration tests for key flows (create transaction, mark paid)
4. Target: 80% coverage for critical paths

**Effort**: Medium (reduced from Large)

---

### TD-002: Reports Feature Incomplete
**Status**: Open
**Priority**: Medium
**Introduced**: 2024-06
**Impact**: Reports page exists but lacks functionality

**Description**:
The `/reports` route exists but the Reports page is not fully implemented. Currently redirects or shows placeholder.

**Current State**:
- Route defined in router
- Page component exists but features commented out
- Query hooks for reports data exist

**Remediation**:
1. Implement report presets (by project, by client, by category)
2. Add CSV export functionality
3. Add date range and currency filters
4. Consider PDF export

**Effort**: Medium

---

### TD-003: Sync Not Yet Activated
**Status**: Open
**Priority**: High
**Introduced**: 2024-06
**Impact**: Users cannot sync between devices

**Description**:
Sync infrastructure is in place (HLC, OpLog, types, conflict resolution) but not yet wired to UI and transport.

**Current State**:
- `src/sync/core/` - Complete types and logic
- `src/sync/transport/` - Bundle encoder exists
- `src/sync/stores/` - State management ready
- UI: Settings has placeholder for sync

**Remediation**:
1. Implement LAN discovery (mDNS or manual IP entry)
2. Implement device pairing UI
3. Wire bundle export/import to UI
4. Test conflict resolution flows
5. Add sync status indicators

**Effort**: Large

---

### TD-004: No E2E Tests
**Status**: Open
**Priority**: Medium
**Introduced**: 2024-05
**Impact**: Critical flows not validated automatically

**Description**:
No end-to-end tests exist. Critical user journeys are only tested manually.

**Remediation**:
1. Set up Playwright or Cypress
2. Add E2E tests for critical flows:
   - Create transaction
   - Generate invoice
   - Export data
   - Demo mode toggle
3. Add to CI pipeline

**Effort**: Medium

---

### TD-005: Large IndexedDB Tables
**Status**: Open
**Priority**: Low
**Introduced**: 2024-08
**Impact**: Performance may degrade with large datasets

**Description**:
No pagination or virtualization for large tables. Users with 10K+ transactions may experience slowness.

**Current State**:
- All data loaded into memory
- Tables render all rows

**Remediation**:
1. Implement cursor-based pagination in repositories
2. Add virtualization to DataTable (react-window or similar)
3. Add loading states for large datasets
4. Consider IndexedDB query optimization

**Effort**: Medium

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
**Status**: Open
**Priority**: Medium
**Introduced**: 2024-05
**Impact**: App may not be fully accessible

**Description**:
No formal accessibility audit has been performed. Some ARIA attributes exist but coverage is inconsistent.

**Remediation**:
1. Run axe-core or similar accessibility checker
2. Fix critical issues (keyboard navigation, focus management)
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

## In Progress

*No items currently in progress.*

---

## Resolved Debt

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
