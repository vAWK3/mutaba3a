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
**Status**: Open
**Priority**: High
**Introduced**: 2024-05
**Impact**: Bugs may slip through, refactoring risky

**Description**:
Current test coverage is low (~3%). Only 6 test files exist.

**Current State**:
- `src/db/__tests__/` - Basic repository tests
- `src/hooks/__tests__/` - Some hook tests
- `src/components/__tests__/` - Minimal component tests

**Remediation**:
1. Add unit tests for all repository methods
2. Add component tests for critical UI (drawers, tables)
3. Add integration tests for key flows (create transaction, mark paid)
4. Target: 80% coverage for critical paths

**Effort**: Large

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
**Status**: Open
**Priority**: Low
**Introduced**: 2025-01
**Impact**: Initial load time may increase

**Description**:
As features are added, bundle size grows. Currently ~250KB gzipped total.

**Current State**:
- Manual chunks for vendors (react, router, query, forms, db)
- Lazy loading for some routes
- PDF library is heavy (~50KB)

**Remediation**:
1. Audit bundle with `vite-bundle-visualizer`
2. Split PDF generation to separate chunk
3. Tree-shake unused i18n strings
4. Consider CDN for static assets

**Effort**: Small

---

### TD-008: Error Boundaries Missing
**Status**: Open
**Priority**: Medium
**Introduced**: 2024-05
**Impact**: Errors may crash entire app

**Description**:
No React error boundaries in place. A rendering error in one component can crash the entire app.

**Remediation**:
1. Add ErrorBoundary at router level
2. Add ErrorBoundary around drawers
3. Add fallback UI for error states
4. Add error reporting (optional, privacy-respecting)

**Effort**: Small

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

### TD-011: Design System Inconsistencies Between Landing and App
**Status**: Open
**Priority**: High
**Introduced**: 2024-03 (identified 2026-02)
**Impact**: Visual inconsistency, maintenance burden, dark mode issues in some components

**Description**:
The design system has accumulated inconsistencies between the landing page and the main app. Two parallel styling systems exist with different variable naming conventions, duplicate button implementations, and mixed focus styles.

**Current State**:

1. **Duplicate Token Definitions**:
   - `theme.css` (canonical): `--text-sm`, `--weight-medium`, `--space-4` (rem)
   - `index.css` (legacy): `--font-size-sm`, `--font-weight-medium`, `--space-4` (px)
   - Both files define the same concepts with different names

2. **Dual Button Systems**:
   - `Button.css`: App button with `.btn-*` classes, proper size variants
   - `LandingPage.css`: Landing button with `.landing-btn--*` classes, no size variants
   - Duplicated hover/active/focus logic

3. **Focus Style Mismatch**:
   - `theme.css`: `box-shadow: var(--focus-ring)` (teal glow)
   - `index.css`: `outline: 2px solid var(--color-primary)` (outline)

4. **Legacy Color Mapping**:
   - `index.css` maps `--color-*` to theme variables
   - Some components still use `--color-*` directly
   - Extra indirection complicates maintenance

5. **Landing Page Defensive Fallbacks**:
   - CSS uses `var(--bg, #070C16)` with inline fallbacks
   - Suggests uncertainty about theme.css import order

6. **Heading Typography**:
   - `theme.css`: Defines `--font-heading` (Source Serif 4)
   - `index.css`: Headings don't use `--font-heading`
   - Landing page correctly uses serif headings

**Remediation**:

Phase 1 - Documentation & Standards (Small):
1. Document canonical token names in PATTERNS.md
2. Add deprecation notices to legacy variables in index.css
3. Create quick reference for new development

Phase 2 - Button Unification (Medium):
1. Export app Button component/styles for use on landing
2. Remove `.landing-btn--*` classes from LandingPage.css
3. Or create shared button CSS imported by both

Phase 3 - Token Migration (Medium):
1. Audit all 26 component CSS files for legacy variable usage
2. Replace `--font-size-*` → `--text-*`
3. Replace `--font-weight-*` → `--weight-*`
4. Replace `--color-*` → direct theme tokens
5. Remove redundant definitions from index.css

Phase 4 - Focus & Typography Standardization (Small):
1. Standardize focus styles to `box-shadow: var(--focus-ring)`
2. Ensure app headings use `--font-heading`
3. Remove landing page CSS fallback values

**Effort**: Medium (spread across 4 phases)

**Files Affected**:
- `src/styles/theme.css` - Canonical (no changes needed)
- `src/index.css` - Legacy mapping to deprecate
- `src/pages/landing/LandingPage.css` - Remove custom buttons, fallbacks
- `src/components/ui/Button.css` - May need exports
- `src/components/**/*.css` - Audit for legacy usage (26 files)

---

## In Progress

*No items currently in progress.*

---

## Resolved Debt

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
