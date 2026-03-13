# Expense Routing UX Redesign

> **Status:** Proposed
> **Date:** 2026-03-13
> **Problem:** Expense pages suffer from profile context confusion, causing silent feature disappearance and navigation friction.

---

## Executive Summary

The expense routing architecture currently treats `/expenses` as a kitchen-sink page that tries to serve both "all profiles" and "single profile" modes without making that distinction explicit. This creates UX confusion where recurring expenses, forecasts, and month-close features silently vanish based on hidden state.

**Core Principle:** Make profile context a first-class page mode, not a hidden condition.

---

## Problem Statement

### The Current Tension

```
┌─────────────────────────────────────────────────────────────────────┐
│  ARCHITECTURAL REALITY           vs.    CURRENT UX BEHAVIOR        │
├─────────────────────────────────────────────────────────────────────┤
│  • Expenses are profile-scoped         • /expenses pretends to     │
│  • Recurring rules belong to profiles    work equally for all      │
│  • Month-close is per-profile            modes                     │
│  • Forecasting needs profile context   • Features silently vanish  │
│                                        • No explanation why        │
└─────────────────────────────────────────────────────────────────────┘
```

### User Mental Model Mismatch

For a freelancer, expense entry should feel like:

> "I spent money for **this business identity**, on **this date**, for **this thing**."

Not:

> "Which expense sub-area was I in, and why did recurring disappear?"

---

## Design Principles

1. **Profile context is not optional** - It's the business identity boundary
2. **Drawer-first stays** - Create/edit must remain fast and in-context
3. **Answers-first, not admin-first** - Freelancers want fast truth, not labyrinths
4. **No lying buttons** - If a feature exists, it must work. If it can't work in a context, explain why.
5. **No silent currency mixing** - Multi-currency totals must be explicit per currency

---

## Proposed Route Structure

### Before (Current)

```
/expenses                          ← Confused identity (all? one? both?)
/expenses/profiles                 ← Profile discovery gallery (rarely needed)
/expenses/profile/$profileId       ← Real working page (hidden)
/expenses/profile/$profileId/receipts
/expenses/overview                 ← Unclear differentiation from /expenses
/expenses/forecast                 ← Cross-profile forecasting
/expenses/close/profile/$profileId
```

### After (Proposed)

```
/expenses                          ← Consolidated reading view (all profiles)
                                      Clear "All Profiles" mode indicator

/expenses/profile/$profileId       ← Operational working view (single profile)
                                      The real day-to-day expense cockpit

/expenses/profile/$profileId/recurring  ← Recurring rules and due occurrences
/expenses/profile/$profileId/receipts   ← Receipt management
/expenses/profile/$profileId/close      ← Month-end reconciliation
```

**Remove or merge:**
- `/expenses/profiles` → Unnecessary if profile switching is in global nav
- `/expenses/overview` → Merge into `/expenses` if no material difference
- `/expenses/forecast` → Move to profile-specific context

---

## Page Mode Specification

### `/expenses` — Consolidated Ledger (All Profiles)

**Purpose:** Cross-profile financial reading and quick entry

**Header Treatment:**
```
┌────────────────────────────────────────────────────────────────┐
│  Expenses                                    [+ Add Expense]   │
│  ┌──────────────────────────────────────┐                      │
│  │ 🔘 All Profiles  ○ Current: Studio   │  ← Explicit mode    │
│  └──────────────────────────────────────┘                      │
└────────────────────────────────────────────────────────────────┘
```

**Contains:**
- Totals by currency (separate USD, ILS, EUR)
- Ledger table with profile column
- Grouping by category
- Search, date range filters
- Add expense (with profile picker if needed)

**Does NOT contain inline:**
- Recurring due occurrences
- Forecast projections
- Month-close widgets

**Instead, show explanatory card:**
```
┌────────────────────────────────────────────────────────────────┐
│  📋 Profile-Specific Tools                                     │
│                                                                │
│  Recurring schedules, due payments, and month close need       │
│  one profile selected.                                         │
│                                                                │
│  [Open Current Profile]  [Choose Profile]                      │
└────────────────────────────────────────────────────────────────┘
```

---

### `/expenses/profile/$profileId` — Operational Cockpit

**Purpose:** Day-to-day expense management for one business identity

**Header Treatment:**
```
┌────────────────────────────────────────────────────────────────┐
│  Expenses · Studio Profile                 [+ Expense] [+ Recurring]
│  ○ All Profiles  🔘 Current: Studio                            │
└────────────────────────────────────────────────────────────────┘
```

**Contains:**
- Profile-specific summary (totals, active recurring count)
- Due occurrences section (always visible when items exist)
- Forecast section (collapsible)
- Expense ledger with grouping
- Recurring rules preview with quick actions
- Links to: Receipts, Month Close

**Routing Behavior:**
- When user has active profile selected globally → `/expenses` redirects here
- When user explicitly chooses "All Profiles" → stays on `/expenses`

---

## Profile Switcher Integration

### Current Behavior (Broken)
- User switches profile in global nav
- Visits `/expenses`
- Lands on consolidated page regardless
- Profile context is disconnected from route

### Proposed Behavior
- User switches profile in global nav
- Visits `/expenses`
- **Redirects to** `/expenses/profile/$activeProfileId`
- "All Profiles" is explicit opt-in, not default

### Single Profile Shortcut
- If user has only one business profile, skip all profile selection friction
- Auto-prefill profile in drawers
- Don't show profile picker modals

---

## Drawer Behavior Specification

### Entry Context Rules

| Entry Point | Profile State | Drawer Behavior |
|------------|---------------|-----------------|
| Sidebar "+ New → Expense" | Single profile exists | Open immediately, prefill profile |
| Sidebar "+ New → Expense" | Active profile set | Open immediately, prefill active profile |
| Sidebar "+ New → Expense" | All Profiles mode, multiple exist | Show ProfileQuickPicker first |
| Profile expense page | Always known | Open immediately, lock profile (show chip, not dropdown) |
| Row duplicate | Always known | Open with prefillData, lock profile |

### Profile Field Treatment

Profile is not just another dropdown. It's the business identity boundary.

**When profile is known (from context):**
```
┌────────────────────────────────────────────────────────────────┐
│  New Expense                                                   │
│                                                                │
│  Profile: [Studio Profile ▾]  ← Small, de-emphasized           │
│           └─ "change" link (not prominent dropdown)            │
│                                                                │
│  Amount*:  [________] [USD ▾]                                  │
│  ...                                                           │
└────────────────────────────────────────────────────────────────┘
```

**When profile is unknown:**
```
┌────────────────────────────────────────────────────────────────┐
│  New Expense                                                   │
│                                                                │
│  Profile*:  [Select business profile ▾]  ← Required first     │
│                                                                │
│  (rest of form appears after profile selected)                 │
└────────────────────────────────────────────────────────────────┘
```

---

## Specific Gap Fixes

### GAP 1: Add Delete to Row Actions

**Before:**
```typescript
<RowActionsMenu
  actions={[
    { label: 'Duplicate', icon: <CopyIcon />, onClick: handleDuplicate },
  ]}
/>
```

**After:**
```typescript
<RowActionsMenu
  actions={[
    { label: 'Duplicate', icon: <CopyIcon />, onClick: handleDuplicate },
    { label: 'Delete', icon: <TrashIcon />, onClick: handleDelete, variant: 'danger' },
  ]}
/>
```

**Delete behavior:**
- Opens confirm modal (not native confirm)
- If expense linked to receipt: "This expense is linked to a receipt. Delete anyway?"
- If expense from recurring: "This was created from 'Monthly Rent' recurring rule."

---

### GAP 2: Implement Duplicate Properly (HIGH PRIORITY)

**Current (broken):**
```typescript
const handleDuplicate = (_expenseId: string) => {
  openExpenseDrawer({ mode: 'create' });  // ← Ignores expenseId!
};
```

**Fixed:**
```typescript
const handleDuplicate = (expense: ExpenseDisplay) => {
  openExpenseDrawer({
    mode: 'create',
    defaultProfileId: expense.profileId,
    prefillData: {
      amountMinor: expense.amountMinor,
      currency: expense.currency,
      vendor: expense.vendor,
      vendorId: expense.vendorId,
      categoryId: expense.categoryId,
      title: expense.title,
      notes: expense.notes,
      // Do NOT copy: id, occurredAt, receiptId, createdAt
    },
  });
};
```

**Drawer title when duplicating:**
```
"Duplicate Expense"  (not "New Expense")
```

---

### GAP 3: Profile Mode Feedback

**Before:** Sections silently disappear when `profileId` is undefined.

**After:** Show blocked-state card:

```tsx
{!profileId && (
  <div className="profile-required-card">
    <InfoIcon />
    <h4>Profile-Specific Tools</h4>
    <p>Recurring schedules, due payments, and month close need one profile selected.</p>
    <div className="profile-required-actions">
      <button onClick={goToCurrentProfile}>Open Current Profile</button>
      <button onClick={showProfilePicker}>Choose Profile</button>
    </div>
  </div>
)}
```

---

### GAP 6: Fix Mixed-Currency Group Totals

**Before (misleading):**
```
Software
  └─ $1,280.00  ← Actually includes ILS expenses converted incorrectly
```

**After (honest):**
```
Software
  ├─ $420.00
  └─ ₪860.00
```

**Implementation:**
```typescript
interface GroupedExpenses {
  id: string;
  name: string;
  expenses: ExpenseDisplay[];
  totalsByCurrency: Record<Currency, number>;  // ← Changed from single totalMinor
}

// In render:
<span className="expenses-group-totals">
  {Object.entries(group.totalsByCurrency).map(([currency, amount]) => (
    <span key={currency} className="amount-negative">
      {formatAmount(amount, currency, locale)}
    </span>
  ))}
</span>
```

---

### GAP 10: Add Recurring Source Badge

When an expense was generated from a recurring rule, show origin:

```tsx
<td>
  {expense.title || '-'}
  {expense.recurringRuleId && (
    <Badge
      variant="subtle"
      onClick={() => openRecurringRule(expense.recurringRuleId)}
    >
      Recurring
    </Badge>
  )}
</td>
```

---

## Form Field Prioritization

### One-Time Expense (optimized order)

1. **Amount** + **Currency** (side by side)
2. **Date** (default: today)
3. **Vendor** (typeahead) — auto-suggest category from history
4. **Title** (optional if vendor exists)
5. **Category** (remember last-used per vendor)
6. **Receipt** (optional attachment)
7. **Notes** (optional)

Profile appears at top only if unknown; otherwise shown as locked chip.

### Recurring Expense

1. **Title** (required — "Monthly Rent", "Canva Subscription")
2. **Amount** + **Currency**
3. **Frequency** (Monthly / Yearly)
4. **Start Date** + **Day of Month**
5. **End Mode** (End of Year / Until Date / No End)
6. **Vendor** (optional)
7. **Category**

---

## Keyboard Shortcuts (Phase 2)

| Shortcut | Action | Scope |
|----------|--------|-------|
| `N` | New expense | Expense pages |
| `R` | New recurring expense | Profile expense page |
| `Esc` | Close drawer | Global |
| `/` | Focus search | Pages with search |
| `E` | Edit selected row | When row focused |

---

## Implementation Priority

| Priority | Item | Effort | Impact |
|----------|------|--------|--------|
| P0 | Fix duplicate (GAP 2) | Medium | High — lying button |
| P1 | Add delete to row actions (GAP 1) | Small | Medium |
| P2 | Explicit page mode: All vs Profile (GAP 3) | Medium | High |
| P3 | Route active profile to /expenses/profile/$id (GAP 4) | Medium | High |
| P4 | Replace hidden sections with explanatory card | Small | Medium |
| P5 | Fix multi-currency group totals (GAP 6) | Medium | Medium |
| P6 | Add recurring source badge (GAP 10) | Small | Low |
| P7 | Keyboard shortcuts (GAP 7) | Medium | Low |
| -- | Batch operations (GAP 8) | Large | Low — future |

---

## Success Metrics

1. **Profile context is never ambiguous** — User always knows which mode they're in
2. **No silent feature disappearance** — If a feature can't work, it explains why
3. **Duplicate actually duplicates** — No more lying buttons
4. **Multi-currency totals are honest** — No fake single-currency sums
5. **Profile-specific pages feel like home** — Not a hidden basement

---

## Appendix: Route Behavior Matrix

| Current Route | Active Profile Set | No Active Profile | Proposed Behavior |
|--------------|-------------------|-------------------|-------------------|
| `/expenses` | Redirect to profile | Stay, show "All Profiles" mode | Make mode explicit |
| `/expenses/profiles` | Show grid | Show grid | Remove or merge into /expenses |
| `/expenses/profile/$id` | Show profile page | Show profile page | Keep as primary workspace |

---

## References

- CLAUDE.md: Drawer-first UX rule
- CLAUDE.md: Currency rules (no silent mixing)
- CLAUDE.md: Offline-first, profile-scoped architecture
- Current implementation: `src/pages/expenses/`, `src/components/drawers/ExpenseDrawer.tsx`
