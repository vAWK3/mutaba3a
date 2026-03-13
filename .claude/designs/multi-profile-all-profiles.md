# Multi-Profile with "All Profiles" Lens - Design Brief

> **Status**: Draft
> **Created**: 2026-03-13
> **Author**: Claude (implementation planning)

---

## 1. Problem Statement

Freelancers with 2-3 gigs have two conflicting needs:
1. **Separation**: Study each gig independently (different clients, different billing identities)
2. **Personal aggregate truth**: Know total income, total unpaid, total expenses across ALL gigs

The current system has `BusinessProfile` as a concept but:
- Profiles are only used for document generation, expenses, retainers, and engagements
- Core entities (transactions, clients, projects) are NOT profile-scoped
- No "All Profiles" aggregate view exists

## 2. Acceptance Criteria

### Must Have
- [ ] Profile switcher includes "All Profiles" option at top
- [ ] Active profile context visible everywhere (sidebar, page headers)
- [ ] Home supports aggregate mode with per-profile breakdown
- [ ] Income page supports aggregate mode with profile tag per row
- [ ] Expenses page supports aggregate mode with profile tag per row
- [ ] Insights page supports aggregate mode with "By Profile" tab
- [ ] Creating income/expense in "All Profiles" mode requires profile selection first
- [ ] Multi-currency totals remain per-currency (never silently sum different currencies)

### Should Have
- [ ] Clients and projects become profile-scoped (with migration)
- [ ] Profile comparison widgets in Insights
- [ ] Default profile landing preference in settings

### Won't Have (for now)
- Cross-profile client merge
- Cross-profile project merge
- Complex consolidated editing
- Profile groups
- Consolidated tax/accounting logic

## 3. Current State Analysis

### Profile-Scoped Entities (already have `profileId`)
| Entity | Field | Notes |
|--------|-------|-------|
| `Expense` | `profileId` | ✅ Already scoped |
| `RetainerAgreement` | `profileId` | ✅ Already scoped |
| `ProjectedIncome` | `profileId` | ✅ Already scoped |
| `Document` | `businessProfileId` | ✅ Already scoped |
| `Engagement` | `profileId` | ✅ Already scoped |
| `ExpenseCategory` | `profileId` | ✅ Already scoped |
| `Vendor` | `profileId` | ✅ Already scoped |
| `Receipt` | `profileId` | ✅ Already scoped |
| `RecurringRule` | `profileId` | ✅ Already scoped |
| `MonthCloseStatus` | `profileId` | ✅ Already scoped |
| `DocumentSequence` | `businessProfileId` | ✅ Already scoped |

### NOT Profile-Scoped (need migration)
| Entity | Current Scope | Action Needed |
|--------|--------------|---------------|
| `Transaction` | Global | Add `profileId` (inferred from client/project profile) |
| `Client` | Global | Add `profileId` |
| `Project` | Global (has `clientId`) | Add `profileId` |
| `Category` | Global | Keep global (expense categories already scoped) |

### Profile System Components
| Component | Location | Status |
|-----------|----------|--------|
| `ProfileSwitcher` | `src/components/layout/ProfileSwitcher.tsx` | Exists, needs "All Profiles" option |
| `useBusinessProfiles` | `src/hooks/useQueries.ts` | Exists |
| `useDefaultBusinessProfile` | `src/hooks/useQueries.ts` | Exists |
| `businessProfileRepo` | `src/db/repository.ts` | Exists, full CRUD |

## 4. Proposed Solution

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Profile Context Layer                            │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────────┐ │
│  │  ProfileStore   │  │ ProfileProvider │  │  useActiveProfile()     │ │
│  │  (Zustand)      │  │    (Context)    │  │  Hook for components    │ │
│  │                 │  │                 │  │                         │ │
│  │  activeProfile: │  │  Provides:      │  │  Returns:               │ │
│  │  string | 'all' │  │  - profileId    │  │  - isAllProfiles        │ │
│  │                 │  │  - isAll        │  │  - activeProfileId      │ │
│  │                 │  │  - profile      │  │  - activeProfile        │ │
│  │                 │  │  - setActive    │  │  - requiresProfilePick  │ │
│  └─────────────────┘  └─────────────────┘  └─────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                        Repository Query Layer                            │
│                                                                          │
│  All list/summary queries accept optional `profileId` filter:           │
│                                                                          │
│  - profileId = undefined → return all (for "All Profiles" mode)         │
│  - profileId = string → return only that profile's data                 │
│                                                                          │
│  New aggregate queries:                                                  │
│  - getTotalsByProfile(filters) → { [profileId]: OverviewTotals }        │
│  - getIncomeByProfile(filters) → TransactionDisplay[] with profileId    │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### Data Model Changes

#### Database Version 13: Add `profileId` to Client, Project, Transaction

```typescript
// schema changes
clients: 'id, name, profileId, createdAt, updatedAt, archivedAt'
projects: 'id, name, profileId, clientId, field, createdAt, updatedAt, archivedAt'
transactions: '...existing..., profileId'

// Type changes
interface Client {
  // ... existing fields
  profileId?: string; // Optional for backwards compatibility, but new clients require it
}

interface Project {
  // ... existing fields
  profileId?: string; // Optional for backwards compatibility
}

interface Transaction {
  // ... existing fields
  profileId?: string; // Optional for backwards compatibility
}
```

#### Migration Strategy
1. Get default profile ID
2. Assign all existing clients, projects, transactions to default profile
3. Future creates require explicit profile (unless single profile exists)

## 5. Implementation Phases

### Phase 1: Profile Context Foundation (No DB changes)
**Goal**: Add "All Profiles" UI without data model changes

1. **Profile Store** (`src/lib/profileStore.ts`)
   - Create Zustand store for active profile state
   - `activeProfileId: string | 'all'`
   - `setActiveProfile(id: string | 'all')`
   - Persist to localStorage

2. **ProfileSwitcher Enhancement**
   - Add "All Profiles" option at top of dropdown
   - Visual separation from individual profiles
   - Different styling for "All Profiles" (maybe icon)

3. **Profile Badge Component** (`src/components/ui/ProfileBadge.tsx`)
   - Small badge showing profile name/initial
   - Used in table rows when in "All Profiles" mode

4. **Profile Context UI**
   - Show active profile in TopBar subtitle
   - Show profile badge in SidebarNav below switcher

5. **i18n Keys**
   - `profileSwitcher.allProfiles`: "All Profiles"
   - `profileSwitcher.viewingAll`: "Viewing all profiles"
   - `profile.badge.label`: "Profile"

### Phase 2: Data Model Extension
**Goal**: Add `profileId` to core entities

1. **Database Schema v13**
   - Add `profileId` index to clients, projects, transactions
   - Migration assigns default profile to existing records

2. **Repository Updates**
   - All repos accept optional `profileId` filter
   - `transactionRepo.list({ profileId })`
   - `clientRepo.list({ profileId })`
   - `projectRepo.list({ profileId })`

3. **Query Hooks Updates**
   - `useTransactions({ profileId })`
   - `useClients({ profileId })`
   - `useProjects({ profileId })`
   - All hooks use active profile from context

4. **Aggregation Functions**
   - `aggregateByProfile(transactions)` → `{ [profileId]: totals }`
   - Update existing aggregations to respect profile filter

### Phase 3: Page Updates
**Goal**: All pages respect profile context

1. **Home Page**
   - Single profile: unchanged
   - All profiles: Show totals + "By Profile" breakdown card
   - KPI cards show aggregate totals

2. **Income Page**
   - Single profile: unchanged (filter by profileId)
   - All profiles: Show all, add profile column/badge
   - Add Income: Opens profile picker first

3. **Expenses Page** (Transactions-based)
   - Single profile: unchanged
   - All profiles: Show all, add profile column/badge
   - Add Expense: Opens profile picker first

4. **Expenses Page** (Profile-based `/expenses/profiles`)
   - Already profile-scoped, works as-is
   - In "All Profiles": Redirect to single profile or show combined

5. **Clients Page**
   - Single profile: Filter by profileId
   - All profiles: Show all, add profile column

6. **Projects Page**
   - Single profile: Filter by profileId
   - All profiles: Show all, add profile column

### Phase 4: Insights & Aggregate Views
**Goal**: Add analytical aggregate features

1. **Insights Page**
   - Add "By Profile" tab
   - Shows: received, unpaid, expenses, net per profile
   - Bar chart comparison (optional)

2. **Home "By Profile" Card**
   - Small summary card showing per-profile breakdown
   - Only visible in "All Profiles" mode

3. **Profile Comparison Widget**
   - Side-by-side comparison of selected profiles
   - Available in Insights

### Phase 5: Creation Flow Updates
**Goal**: Handle creation in "All Profiles" mode

1. **Profile Picker Modal** (`src/components/modals/ProfilePickerModal.tsx`)
   - Simple modal: "Which profile is this for?"
   - Shows profile list with avatars
   - Called before opening drawers in "All Profiles" mode

2. **Drawer Updates**
   - `TransactionDrawer`: Require `defaultProfileId` prop
   - `ClientDrawer`: Require `defaultProfileId` prop
   - `ProjectDrawer`: Require `defaultProfileId` prop
   - `ExpenseDrawer`: Already has `defaultProfileId`

3. **TopBar Add Menu**
   - In "All Profiles" mode: Open profile picker first
   - In single profile mode: Use current profile

## 6. Component Changes

### New Components

| Component | Location | Purpose |
|-----------|----------|---------|
| `ProfileBadge` | `src/components/ui/ProfileBadge.tsx` | Small profile indicator for rows |
| `ProfilePickerModal` | `src/components/modals/ProfilePickerModal.tsx` | Profile selection before create |
| `ByProfileCard` | `src/components/home/ByProfileCard.tsx` | Per-profile breakdown on Home |

### Modified Components

| Component | Changes |
|-----------|---------|
| `ProfileSwitcher` | Add "All Profiles" option, updated styling |
| `SidebarNav` | Show active profile context below switcher |
| `TopBar` | Show profile name in subtitle when single profile |
| `TransactionDrawer` | Accept and require profileId |
| `ClientDrawer` | Accept and require profileId |
| `ProjectDrawer` | Accept and require profileId |
| `DataTable` (or row components) | Render profile badge when showing all |

### Modified Pages

| Page | Changes |
|------|---------|
| `OverviewPage` | Add ByProfileCard, aggregate totals |
| `IncomePage` (new) | Profile filtering, profile column |
| `ExpensesLedgerPage` | Profile filtering, profile column |
| `ClientsPage` | Profile filtering, profile column |
| `ProjectsPage` | Profile filtering, profile column |
| `InsightsPage` | Add "By Profile" tab |

## 7. API Contract Changes

### Profile Store API

```typescript
// src/lib/profileStore.ts
interface ProfileState {
  activeProfileId: string | 'all';
  setActiveProfile: (id: string | 'all') => void;
}

export const useProfileStore = create<ProfileState>()(
  persist(
    (set) => ({
      activeProfileId: 'all', // Default to "All Profiles" for new users
      setActiveProfile: (id) => set({ activeProfileId: id }),
    }),
    { name: 'mutaba3a-profile' }
  )
);
```

### useActiveProfile Hook

```typescript
// src/hooks/useActiveProfile.ts
interface ActiveProfileContext {
  isAllProfiles: boolean;
  activeProfileId: string | undefined; // undefined when "all"
  activeProfile: BusinessProfile | undefined;
  setActiveProfile: (id: string | 'all') => void;
  requiresProfilePick: boolean; // true when "all" and creating
}

export function useActiveProfile(): ActiveProfileContext;
```

### Repository Filter Extensions

```typescript
// Extended QueryFilters
interface QueryFilters {
  // ... existing
  profileId?: string; // Filter by profile
}

interface ClientFilters {
  includeArchived?: boolean;
  profileId?: string;
  search?: string;
}

interface ProjectFilters {
  clientId?: string;
  includeArchived?: boolean;
  profileId?: string;
  search?: string;
}
```

## 8. Error Handling

| Scenario | Handling |
|----------|----------|
| Create in "All Profiles" without selecting profile | Block with profile picker |
| Profile deleted while viewing | Fall back to "All Profiles" |
| No profiles exist | Show setup prompt (existing behavior) |
| Migration fails | Log error, continue with unassigned records |

## 9. Performance Considerations

1. **Query optimization**
   - Add `profileId` index to enable efficient filtering
   - Pre-compute per-profile aggregates where possible

2. **Caching**
   - TanStack Query cache keyed by `profileId` filter
   - Invalidate relevant queries when profile changes

3. **Lazy loading**
   - Don't load all profiles' data until "All Profiles" selected
   - Virtualize long lists in aggregate view

## 10. Testing Strategy

### Unit Tests
- ProfileStore state transitions
- useActiveProfile hook behavior
- Aggregation functions with profile filter
- Repository filtering with profileId

### Integration Tests
- Profile switching flow
- Creation flow in "All Profiles" mode
- Data isolation between profiles
- Migration correctness

### E2E Tests
- Full profile switching workflow
- Creating entities in both modes
- Aggregate views accuracy

## 11. i18n Requirements

```json
{
  "profileSwitcher": {
    "allProfiles": "All Profiles",
    "viewingAll": "Viewing all profiles",
    "switchTo": "Switch to {profileName}"
  },
  "profile": {
    "badge": "Profile",
    "select": "Select Profile",
    "selectPrompt": "Which profile is this for?",
    "required": "Please select a profile"
  },
  "insights": {
    "tabs": {
      "byProfile": "By Profile"
    },
    "byProfile": {
      "title": "Performance by Profile",
      "received": "Received",
      "unpaid": "Unpaid",
      "expenses": "Expenses",
      "net": "Net"
    }
  },
  "home": {
    "byProfile": {
      "title": "By Profile"
    }
  }
}
```

## 12. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Migration corrupts data | Low | High | Backup before, transaction-safe migration |
| Performance degradation in aggregate mode | Medium | Medium | Pagination, caching, lazy load |
| UX confusion about profile context | Medium | Medium | Clear visual indicators, consistent labeling |
| Breaking existing profile-scoped features | Low | High | Careful testing of expenses, retainers, documents |

## 13. Rollout Plan

1. **Phase 1** (Foundation): Ship behind feature flag if needed
2. **Phase 2** (Data model): Auto-migration on app start
3. **Phase 3** (Pages): Incremental page updates
4. **Phase 4** (Insights): Final polish
5. **Phase 5** (Creation): UX refinement

## 14. Success Metrics

- Users can switch between profiles and "All Profiles" instantly
- Aggregate totals match sum of individual profile totals
- No data leakage between profiles
- Creation flow clearly guides profile selection
- No performance regression for single-profile users

## 15. Open Questions

1. Should new users default to "All Profiles" or their first/only profile?
   - **Recommendation**: Default to first profile; show "All Profiles" after second profile created

2. Should clients/projects be automatically assigned to profile when created from context?
   - **Recommendation**: Yes, inherit from active profile context

3. Should we allow moving entities between profiles?
   - **Recommendation**: Not in initial release; add if requested

---

## Appendix: Implementation Checklist

### Phase 1: Foundation (~8 tasks)
- [ ] Create `src/lib/profileStore.ts` with Zustand store
- [ ] Create `src/hooks/useActiveProfile.ts` hook
- [ ] Update `ProfileSwitcher.tsx` with "All Profiles" option
- [ ] Update `ProfileSwitcher.css` with "All Profiles" styling
- [ ] Create `ProfileBadge.tsx` component
- [ ] Add i18n keys for profile context
- [ ] Update `SidebarNav.tsx` to show active profile
- [ ] Write tests for profile store and hook

### Phase 2: Data Model (~12 tasks)
- [ ] Create database v13 schema with profileId indexes
- [ ] Write migration to assign default profile
- [ ] Update `Client` type with profileId
- [ ] Update `Project` type with profileId
- [ ] Update `Transaction` type with profileId
- [ ] Update `clientRepo.list()` with profileId filter
- [ ] Update `projectRepo.list()` with profileId filter
- [ ] Update `transactionRepo.list()` with profileId filter
- [ ] Update `clientSummaryRepo` with profileId
- [ ] Update `projectSummaryRepo` with profileId
- [ ] Update all query hooks with profile filtering
- [ ] Write tests for repository filters

### Phase 3: Pages (~15 tasks)
- [ ] Update `OverviewPage` with aggregate mode
- [ ] Create `ByProfileCard` component
- [ ] Update `IncomePage` with profile column
- [ ] Update `ExpensesLedgerPage` with profile column
- [ ] Update `ClientsPage` with profile filtering/column
- [ ] Update `ProjectsPage` with profile filtering/column
- [ ] Update `DataTable` or row components for profile badge
- [ ] Update `ClientDetailPage` with profile context
- [ ] Update `ProjectDetailPage` with profile context
- [ ] Add profile filter to all page query hooks
- [ ] Write page tests with profile context

### Phase 4: Insights (~6 tasks)
- [ ] Add "By Profile" tab to Insights
- [ ] Create `ByProfileInsightsTab` component
- [ ] Create aggregation function for per-profile totals
- [ ] Add CSV export for by-profile data
- [ ] Write tests for insights aggregation

### Phase 5: Creation Flows (~8 tasks)
- [ ] Create `ProfilePickerModal` component
- [ ] Update `TopBar` add menu for profile context
- [ ] Update `TransactionDrawer` to require profileId
- [ ] Update `ClientDrawer` to require profileId
- [ ] Update `ProjectDrawer` to require profileId
- [ ] Update drawer stores with profile context
- [ ] Write tests for creation flows
- [ ] E2E test for full profile workflow
