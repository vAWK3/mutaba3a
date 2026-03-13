# Design Brief: Recurring Expenses System

> **Feature**: Recurring Expenses (Rule-Based Forecasting with Confirmation)
> **Date**: 2026-03-13
> **Status**: Draft v2 - Revised per feedback
> **Revision**: Simplified persistence model, separated drawer concerns, clarified profile scoping

---

## 1. Problem Statement

Users have predictable monthly/yearly expenses (subscriptions, rent, utilities) that they want to:
1. **Forecast** - See upcoming cash outflows before they happen
2. **Track** - Know when expenses are due for payment confirmation
3. **Record** - Create actual expense records only when payment is confirmed

The current `RecurringRule` entity exists but lacks the occurrence tracking layer needed to distinguish between **expected** (forecast) and **realized** (actual) expenses.

### Core Principle: Rule vs. Reality

> **Recurring expense = a rule** (for forecast only, not actual spending)
> **Actual expense = a real ledger entry** (created only when user confirms)

This separation preserves:
- Clean forecasting without fake ledger entries
- Accurate historical spend (only confirmed payments)
- Trust in an offline-first app (no silent assumptions)

### Hard Invariant (Non-Negotiable)

**Projected recurring expenses must NEVER leak into:**
- Historical expense reports
- Ledger exports
- "This year spent" totals
- Any actual money calculations

Only confirmed expenses (real `Expense` records) appear in actuals.

---

## 2. Proposed Solution

### 2.1 Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Recurring Expenses System                        │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌─────────────────┐    generates    ┌─────────────────────────┐        │
│  │ RecurringRule   │───────────────>│  Virtual Occurrence     │        │
│  │                 │    (computed)   │  (NOT persisted)        │        │
│  │ - Monthly Adobe │                 │                         │        │
│  │ - ₪120          │                 │ - Apr 5 (projected)     │        │
│  │ - Tools category│                 │ - May 5 (projected)     │        │
│  └─────────────────┘                 └─────────────────────────┘        │
│           │                                                              │
│           │ user interacts                                               │
│           ▼                                                              │
│  ┌─────────────────────────────────────────────────────────────┐        │
│  │              RecurringOccurrence (persisted)                 │        │
│  │              ONLY when user takes action:                    │        │
│  │              - resolved_paid → creates Expense               │        │
│  │              - resolved_skipped                              │        │
│  │              - snoozed                                       │        │
│  └──────────────────────────┬──────────────────────────────────┘        │
│                             │                                            │
│                             │ if resolved_paid                           │
│                             ▼                                            │
│                  ┌─────────────────────────┐                            │
│                  │       Expense           │                            │
│                  │                         │                            │
│                  │ - Adobe subscription    │                            │
│                  │ - ₪120, Mar 5           │                            │
│                  │ - recurringRuleId=X     │                            │
│                  └─────────────────────────┘                            │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### 2.2 Key Design Decision: Virtual-First Occurrences

**Persist only when needed:**
- `resolved_paid` - User confirmed payment
- `resolved_skipped` - User explicitly skipped
- `snoozed` - User deferred with specific date

**Everything else is computed on demand:**
- Projected future occurrences → generated from rule
- Due occurrences → computed as (today >= expectedDate - reminderDays)
- Overdue → computed as (today > expectedDate)

This keeps the model light and aligned with offline-first minimalism.

### 2.3 Data Flow

1. **Rule Creation**: User creates a RecurringRule in dedicated drawer
2. **Forecast Display**: System computes virtual occurrences from rule (no persistence)
3. **Due Detection**: Occurrences where expectedDate is today or past surface in Attention
4. **User Action**:
   - **Mark Paid** → Service creates `Expense` + persists `RecurringOccurrence` as resolved_paid
   - **Skip** → Service persists `RecurringOccurrence` as resolved_skipped
   - **Snooze** → Service persists `RecurringOccurrence` as snoozed with until date
5. **Ledger Integrity**: Only `Expense` records appear in actual reports

---

## 3. Data Model Changes

### 3.1 Enhanced RecurringRule (Existing Entity - Extend)

```typescript
interface RecurringRule {
  // Existing fields
  id: string;
  profileId: string;               // REQUIRED - ADR-015 profile scoping
  title: string;
  vendor?: string;
  vendorId?: string;
  categoryId?: string;
  amountMinor: number;
  currency: Currency;
  startDate: string;
  endMode: RecurringEndMode;       // 'endOfYear' | 'untilDate' | 'noEnd'
  endDate?: string;
  isPaused: boolean;
  createdAt: string;
  updatedAt: string;

  // NEW/CLARIFIED fields
  frequency: RecurringFrequency;   // 'monthly' | 'yearly'
  dayOfMonth: number;              // 1-28 (avoids end-of-month edge cases)
  monthOfYear?: number;            // 1-12, REQUIRED when frequency='yearly'
  projectId?: string;              // Optional: link to project
  scope: 'general' | 'project';    // General or project-scoped expense
  notes?: string;                  // Default notes for occurrences
  reminderDaysBefore: number;      // Days before due to show reminder (default: 0)
}

type RecurringFrequency = 'monthly' | 'yearly';
```

**Note on dayOfMonth 1-28**: This avoids February and 30/31 edge cases. The UI should explain this clearly: "Day of month (1-28 to avoid end-of-month issues)".

### 3.2 RecurringOccurrence Entity (Persisted Only When Needed)

```typescript
interface RecurringOccurrence {
  id: string;
  ruleId: string;                  // FK to RecurringRule
  profileId: string;               // REQUIRED - copied from rule, explicit scoping
  expectedDate: string;            // ISO date (YYYY-MM-DD)
  amountMinorSnapshot: number;     // Amount at time rule was checked
  currencySnapshot: Currency;      // Currency (never changes)
  status: RecurringOccurrenceStatus;

  // Resolution tracking
  fulfilledExpenseId?: string;     // FK to Expense if resolved_paid
  resolvedAt?: string;             // ISO timestamp when resolved (paid or skipped)
  snoozeUntil?: string;            // ISO date if snoozed

  // Override fields (user can adjust before confirming)
  actualAmountMinor?: number;      // If user edited amount
  actualPaidDate?: string;         // Actual payment date (may differ from expected)
  notes?: string;                  // Per-occurrence notes

  createdAt: string;
  updatedAt: string;
}

// Simplified status - only what needs persistence
type RecurringOccurrenceStatus =
  | 'snoozed'           // User deferred, will resurface
  | 'resolved_paid'     // User confirmed → Expense created
  | 'resolved_skipped'; // User skipped, no expense

// Computed display states (NOT persisted)
type ComputedOccurrenceState =
  | 'projected'   // Future, not yet due
  | 'due'         // Within reminder window or on expected date
  | 'overdue';    // Past expected date, no action taken
```

### 3.3 Virtual Occurrence (Computed, Not Persisted)

```typescript
interface VirtualOccurrence {
  ruleId: string;
  profileId: string;
  expectedDate: string;
  amountMinor: number;
  currency: Currency;
  computedState: ComputedOccurrenceState;

  // Check if persisted occurrence exists
  persistedOccurrence?: RecurringOccurrence;
}
```

### 3.4 Expense Entity (Existing - Clarify link)

```typescript
interface Expense {
  // Existing fields unchanged...

  // Link to source (already exists)
  recurringRuleId?: string;        // FK to rule that spawned this

  // NEW: link to specific occurrence
  recurringOccurrenceId?: string;  // FK to persisted occurrence
}
```

### 3.5 Database Schema Change

```typescript
// Version 15: Add RecurringOccurrence table, enhance RecurringRule
this.version(15).stores({
  // ... existing tables ...

  // Enhanced recurringRules
  recurringRules: 'id, profileId, categoryId, vendorId, frequency, dayOfMonth, monthOfYear, scope, startDate, isPaused, createdAt',

  // NEW: recurringOccurrences - only persisted when user acts
  recurringOccurrences: 'id, ruleId, profileId, expectedDate, status, fulfilledExpenseId, snoozeUntil, [ruleId+expectedDate], [profileId+status]',

  // Expense: add recurringOccurrenceId index
  expenses: 'id, profileId, categoryId, vendorId, currency, occurredAt, recurringRuleId, recurringOccurrenceId, createdAt, deletedAt',
}).upgrade(async (tx) => {
  // Migration: set defaults for existing rules
  await tx.table('recurringRules').toCollection().modify((rule: {
    dayOfMonth?: number;
    monthOfYear?: number;
    frequency?: string;
    startDate?: string;
    scope?: string;
    reminderDaysBefore?: number;
  }) => {
    // Infer dayOfMonth from startDate if available
    if (!rule.dayOfMonth && rule.startDate) {
      const day = new Date(rule.startDate).getDate();
      rule.dayOfMonth = Math.min(day, 28); // Cap at 28
    } else if (!rule.dayOfMonth) {
      rule.dayOfMonth = 1; // Fallback only if no startDate
    }

    // Set scope default
    if (!rule.scope) {
      rule.scope = 'general';
    }

    // Set reminder default
    if (rule.reminderDaysBefore === undefined) {
      rule.reminderDaysBefore = 0;
    }

    // For yearly frequency, infer monthOfYear from startDate
    if (rule.frequency === 'yearly' && !rule.monthOfYear && rule.startDate) {
      rule.monthOfYear = new Date(rule.startDate).getMonth() + 1;
    }
  });
});
```

---

## 4. Service Layer (Use-Case Orchestration)

Following ADR-002 (repository abstraction), complex mutations that span multiple repositories belong in a service layer, not inside repositories.

### 4.1 RecurringExpenseService

```typescript
// src/services/recurringExpenseService.ts

interface ConfirmPaymentInput {
  ruleId: string;
  expectedDate: string;
  actualAmountMinor?: number;      // Override amount
  actualPaidDate?: string;         // Override date (default: today)
  notes?: string;
}

interface ConfirmPaymentResult {
  expense: Expense;
  occurrence: RecurringOccurrence;
}

export const recurringExpenseService = {
  /**
   * Confirm a recurring expense as paid.
   * Creates Expense + persists RecurringOccurrence as resolved_paid.
   */
  async confirmPayment(input: ConfirmPaymentInput): Promise<ConfirmPaymentResult> {
    const rule = await recurringRuleRepo.get(input.ruleId);
    if (!rule) throw new Error('Rule not found');

    const now = nowISO();
    const paidDate = input.actualPaidDate || todayISO();
    const amount = input.actualAmountMinor ?? rule.amountMinor;

    // 1. Create the actual expense
    const expense = await expenseRepo.create({
      profileId: rule.profileId,
      title: rule.title,
      vendor: rule.vendor,
      vendorId: rule.vendorId,
      categoryId: rule.categoryId,
      amountMinor: amount,
      currency: rule.currency,
      occurredAt: paidDate,
      notes: input.notes,
      recurringRuleId: rule.id,
    });

    // 2. Persist the occurrence as resolved
    const occurrence = await recurringOccurrenceRepo.create({
      ruleId: rule.id,
      profileId: rule.profileId,
      expectedDate: input.expectedDate,
      amountMinorSnapshot: rule.amountMinor,
      currencySnapshot: rule.currency,
      status: 'resolved_paid',
      fulfilledExpenseId: expense.id,
      actualAmountMinor: input.actualAmountMinor,
      actualPaidDate: paidDate,
      notes: input.notes,
      resolvedAt: now,
    });

    // 3. Update expense with occurrence link
    await expenseRepo.update(expense.id, {
      recurringOccurrenceId: occurrence.id,
    });

    return { expense, occurrence };
  },

  /**
   * Skip a recurring expense occurrence.
   * Persists RecurringOccurrence as resolved_skipped.
   */
  async skipOccurrence(ruleId: string, expectedDate: string): Promise<RecurringOccurrence> {
    const rule = await recurringRuleRepo.get(ruleId);
    if (!rule) throw new Error('Rule not found');

    return recurringOccurrenceRepo.create({
      ruleId: rule.id,
      profileId: rule.profileId,
      expectedDate,
      amountMinorSnapshot: rule.amountMinor,
      currencySnapshot: rule.currency,
      status: 'resolved_skipped',
      resolvedAt: nowISO(),
    });
  },

  /**
   * Snooze a recurring expense occurrence.
   * Persists RecurringOccurrence as snoozed.
   */
  async snoozeOccurrence(
    ruleId: string,
    expectedDate: string,
    snoozeUntil: string
  ): Promise<RecurringOccurrence> {
    const rule = await recurringRuleRepo.get(ruleId);
    if (!rule) throw new Error('Rule not found');

    // Check if already persisted (e.g., snoozed before)
    const existing = await recurringOccurrenceRepo.getByRuleAndDate(ruleId, expectedDate);

    if (existing) {
      await recurringOccurrenceRepo.update(existing.id, {
        status: 'snoozed',
        snoozeUntil,
      });
      return { ...existing, status: 'snoozed', snoozeUntil };
    }

    return recurringOccurrenceRepo.create({
      ruleId: rule.id,
      profileId: rule.profileId,
      expectedDate,
      amountMinorSnapshot: rule.amountMinor,
      currencySnapshot: rule.currency,
      status: 'snoozed',
      snoozeUntil,
    });
  },

  /**
   * Generate virtual occurrences for forecast display.
   * Does NOT persist anything.
   */
  async getVirtualOccurrences(
    profileId: string,
    fromDate: string,
    toDate: string
  ): Promise<VirtualOccurrence[]> {
    const rules = await recurringRuleRepo.listActive(profileId);
    const persisted = await recurringOccurrenceRepo.list({
      profileId,
      dateFrom: fromDate,
      dateTo: toDate,
    });

    const persistedMap = new Map(
      persisted.map(o => [`${o.ruleId}:${o.expectedDate}`, o])
    );

    const virtual: VirtualOccurrence[] = [];

    for (const rule of rules) {
      const dates = generateExpectedDates(rule, fromDate, toDate);

      for (const expectedDate of dates) {
        const key = `${rule.id}:${expectedDate}`;
        const existing = persistedMap.get(key);

        // Skip if already resolved
        if (existing?.status === 'resolved_paid' || existing?.status === 'resolved_skipped') {
          continue;
        }

        // Check snooze
        if (existing?.status === 'snoozed' && existing.snoozeUntil) {
          if (existing.snoozeUntil > todayISO()) {
            continue; // Still snoozed
          }
        }

        virtual.push({
          ruleId: rule.id,
          profileId: rule.profileId,
          expectedDate,
          amountMinor: rule.amountMinor,
          currency: rule.currency,
          computedState: computeState(expectedDate, rule.reminderDaysBefore),
          persistedOccurrence: existing,
        });
      }
    }

    return virtual.sort((a, b) => a.expectedDate.localeCompare(b.expectedDate));
  },

  /**
   * Get due occurrences for attention display.
   */
  async getDueOccurrences(profileId: string): Promise<VirtualOccurrence[]> {
    const today = todayISO();
    const virtual = await this.getVirtualOccurrences(
      profileId,
      subDays(today, 30), // Include overdue up to 30 days
      addDays(today, 7)   // Include upcoming 7 days
    );

    return virtual.filter(v =>
      v.computedState === 'due' || v.computedState === 'overdue'
    );
  },
};

// Helper: compute state from expectedDate
function computeState(expectedDate: string, reminderDays: number): ComputedOccurrenceState {
  const today = todayISO();
  const reminderDate = subDays(expectedDate, reminderDays);

  if (expectedDate < today) return 'overdue';
  if (reminderDate <= today) return 'due';
  return 'projected';
}

// Helper: generate expected dates for a rule within range
function generateExpectedDates(
  rule: RecurringRule,
  fromDate: string,
  toDate: string
): string[] {
  const dates: string[] = [];
  const start = new Date(Math.max(
    new Date(rule.startDate).getTime(),
    new Date(fromDate).getTime()
  ));
  const end = new Date(toDate);

  if (rule.frequency === 'monthly') {
    let current = new Date(start.getFullYear(), start.getMonth(), rule.dayOfMonth);
    if (current < start) {
      current = new Date(current.getFullYear(), current.getMonth() + 1, rule.dayOfMonth);
    }

    while (current <= end) {
      if (rule.endDate && current > new Date(rule.endDate)) break;
      dates.push(current.toISOString().split('T')[0]);
      current = new Date(current.getFullYear(), current.getMonth() + 1, rule.dayOfMonth);
    }
  } else if (rule.frequency === 'yearly') {
    const month = (rule.monthOfYear ?? 1) - 1; // 0-indexed
    let current = new Date(start.getFullYear(), month, rule.dayOfMonth);
    if (current < start) {
      current = new Date(current.getFullYear() + 1, month, rule.dayOfMonth);
    }

    while (current <= end) {
      if (rule.endDate && current > new Date(rule.endDate)) break;
      dates.push(current.toISOString().split('T')[0]);
      current = new Date(current.getFullYear() + 1, month, rule.dayOfMonth);
    }
  }

  return dates;
}
```

---

## 5. Repository API

### 5.1 IRecurringRuleRepository (Extend)

```typescript
interface IRecurringRuleRepository extends BaseRepository<RecurringRule, CreateRecurringRuleData> {
  list(filters?: {
    profileId?: string;  // REQUIRED for proper scoping
    isPaused?: boolean;
    scope?: 'general' | 'project';
  }): Promise<RecurringRule[]>;

  listActive(profileId: string): Promise<RecurringRule[]>;
  pause(id: string): Promise<void>;
  resume(id: string): Promise<void>;
}
```

### 5.2 IRecurringOccurrenceRepository (New)

```typescript
interface IRecurringOccurrenceRepository extends BaseRepository<RecurringOccurrence, CreateOccurrenceData> {
  // Query - always profile-scoped
  list(filters: {
    profileId: string;   // REQUIRED
    ruleId?: string;
    status?: RecurringOccurrenceStatus | RecurringOccurrenceStatus[];
    dateFrom?: string;
    dateTo?: string;
  }): Promise<RecurringOccurrence[]>;

  getByRuleAndDate(ruleId: string, expectedDate: string): Promise<RecurringOccurrence | undefined>;

  // Get history for a specific rule
  getHistoryForRule(ruleId: string): Promise<RecurringOccurrence[]>;
}
```

### 5.3 Display Types

```typescript
interface VirtualOccurrenceDisplay extends VirtualOccurrence {
  // Resolved from rule
  ruleTitle: string;
  vendor?: string;
  vendorName?: string;
  categoryId?: string;
  categoryName?: string;
  categoryColor?: string;
  projectId?: string;
  projectName?: string;

  // Computed
  daysUntilDue: number;           // Negative if overdue
  isOverdue: boolean;
  isUpcoming: boolean;            // Due but not overdue

  // Display helpers
  effectiveAmount: number;        // From rule or override
  effectiveCurrency: Currency;
}
```

---

## 6. UI Components

### 6.1 Component Overview

| Component | Purpose | Location |
|-----------|---------|----------|
| `RecurringRuleDrawer` | Create/edit recurring expense rules | **Separate drawer** |
| `ExpenseDrawer` | Create/edit actual expenses | **Unchanged** (link to rule optional) |
| `RecurringOccurrenceCard` | Single occurrence with actions | Attention list, Forecast |
| `RecurringConfirmModal` | Mark paid confirmation flow | Modal on action |
| `RecurringRulesList` | List of rules for a profile | Expenses page section |
| `ForecastSection` | Upcoming projected expenses | Home, Expenses pages |

### 6.2 Drawer Separation (Critical)

**Do NOT merge rule authoring into ExpenseDrawer.**

Rationale:
- `ExpenseDrawer` creates **reality** (actual expenses)
- `RecurringRuleDrawer` creates **expectation** (forecast rules)

These are related but distinct mental models. Forcing them into one form muddies the UX.

**Flow options:**
1. From Expenses page: "+ Add Recurring Rule" button opens `RecurringRuleDrawer`
2. From `ExpenseDrawer` (after creating expense): "Save as recurring template" option
3. From due occurrence: "Mark Paid" opens `RecurringConfirmModal` or prefilled `ExpenseDrawer`

### 6.3 RecurringRuleDrawer

```tsx
// URL pattern
?newRecurring=true&profileId=X
?recurring=<ruleId>  // edit mode
```

**Fields:**
- Title (required)
- Default amount (required)
- Currency (required)
- Frequency: Monthly / Yearly radio
- Day of month: 1-28 stepper with help text
- Month of year: (only if yearly) dropdown
- Start date
- End mode: End of year / Until date / No end
- Category (optional typeahead)
- Vendor (optional typeahead)
- Project (optional, enables project scope)
- Notes (optional)

**Help text for day of month:**
> "Day 1-28 only. This avoids end-of-month edge cases (e.g., Feb 30 doesn't exist)."

### 6.4 RecurringOccurrenceCard

```tsx
interface RecurringOccurrenceCardProps {
  occurrence: VirtualOccurrenceDisplay;
  onMarkPaid: () => void;
  onSkip: () => void;
  onSnooze: () => void;  // Opens date picker
}

// Visual states:
// - Projected: Ghost/muted styling, no actions
// - Due: Normal styling, all action buttons visible
// - Overdue: Warning styling with "X days overdue" badge
// - Snoozed: Muted with "Snoozed until X" badge
// - Resolved (paid): Success styling, link to expense
// - Resolved (skipped): Muted with "Skipped" badge
```

### 6.5 RecurringConfirmModal

Minimal confirmation when user clicks "Mark Paid":

```tsx
interface ConfirmPaymentModalProps {
  occurrence: VirtualOccurrenceDisplay;
  onConfirm: (data: ConfirmPaymentData) => void;
  onCancel: () => void;
}

interface ConfirmPaymentData {
  actualAmountMinor: number;      // Pre-filled from rule
  paidDate: string;               // Pre-filled with today
  notes?: string;
}
```

**Modal sections:**
1. **Amount** - Editable, defaults to rule amount
2. **Payment Date** - Defaults to today
3. **Notes** - Optional

**Deferred (Phase 2+):** "Update future occurrences with this amount" checkbox.

---

## 7. Attention Integration

Recurring due items surface as actionable expense reminders in the Attention feed.

```typescript
interface AttentionItem {
  id: string;
  severity: 'warning' | 'info';   // warning if overdue, info if due
  category: string;               // Defer to insights taxonomy, don't assume "reduce"
  title: string;                  // e.g., "Adobe subscription due today"
  description: string;            // e.g., "₪120 monthly payment"
  impactMinor: number;
  impactCurrency: Currency;
  relatedEntityIds: string[];     // [ruleId, expectedDate composite key]
  action: {
    label: 'Mark Paid' | 'Review';
    type: 'openRecurringConfirm';
    ruleId: string;
    expectedDate: string;
  };
}
```

**Severity mapping:**
- Overdue > 7 days: `critical` (if supported)
- Overdue 1-7 days: `warning`
- Due today or upcoming: `info`

---

## 8. Forecast Integration

### 8.1 Display Rules

| View | Shows Recurring As |
|------|-------------------|
| **Forecast / Cash Flow** | Virtual projected rows (ghost styling) |
| **Attention area** | Due/overdue occurrences with actions |
| **Expense Ledger** | Only actual `Expense` records |
| **Monthly totals** | Only actual `Expense` records |
| **Reports** | Only actual `Expense` records |
| **"This year spent"** | Only actual `Expense` records |

### 8.2 "Will Make It" KPI Integration

```typescript
interface ForecastKPIs {
  // ... existing fields ...

  leaving: AmountByCurrency; // Includes projected recurring expenses
}

// Calculate projected recurring for month
async function getProjectedRecurringForMonth(
  profileId: string,
  month: string // YYYY-MM
): Promise<AmountByCurrency> {
  const startOfMonth = `${month}-01`;
  const endOfMonth = getLastDayOfMonth(month);

  const virtual = await recurringExpenseService.getVirtualOccurrences(
    profileId,
    startOfMonth,
    endOfMonth
  );

  // Only projected and due (not resolved)
  const projected = virtual.filter(v =>
    v.computedState === 'projected' || v.computedState === 'due'
  );

  return sumAmountByCurrency(projected);
}
```

---

## 9. Edge Cases

### 9.1 Amount Changed This Month

User confirms but wants different amount:
1. Modal shows editable amount field
2. User changes amount
3. Expense created with new amount
4. Occurrence stores `actualAmountMinor` for record
5. Rule amount unchanged (Phase 2: add "update future" option)

### 9.2 Skipped This Month

User clicks "Skip":
1. Occurrence persisted as `resolved_skipped`
2. No expense created
3. Rule continues generating future occurrences
4. Skipped occurrence appears in rule history

### 9.3 Late Payment

Expected: May 5, User confirms on May 9:
1. `actualPaidDate = 2024-05-09`
2. Expense created with `occurredAt = 2024-05-09`
3. Occurrence keeps `expectedDate = 2024-05-05` for reference

### 9.4 Paused Subscription

User pauses rule:
1. `rule.isPaused = true`
2. No virtual occurrences generated for paused rules
3. Existing due occurrences: user can still resolve them
4. Resume: `isPaused = false`, virtual generation resumes

### 9.5 Deleted Rule

User deletes rule:
1. Rule soft-deleted (`deletedAt` set)
2. Historical occurrences preserved
3. Linked expenses unchanged
4. No new virtual occurrences generated

### 9.6 Overdue Without Action

Occurrence is overdue (past expectedDate) and user hasn't acted:
- **Computed state**: `overdue`
- **Display**: Warning styling with "X days overdue"
- **No automatic state change** - remains actionable until user resolves
- **No "missed" persistence** - computed display only

---

## 10. Implementation Plan

### Phase 1: Core System (Ship First)

1. **Database Migration** (v15)
   - RecurringOccurrence table
   - Enhanced RecurringRule schema
   - Expense recurringOccurrenceId

2. **Repository Implementation**
   - `recurringOccurrenceRepo` with CRUD
   - Extend `recurringRuleRepo` with listActive

3. **Service Layer**
   - `recurringExpenseService.confirmPayment()`
   - `recurringExpenseService.skipOccurrence()`
   - `recurringExpenseService.getVirtualOccurrences()`
   - `recurringExpenseService.getDueOccurrences()`

4. **Types**
   - `RecurringOccurrence`, `RecurringOccurrenceStatus`
   - `VirtualOccurrence`, `VirtualOccurrenceDisplay`
   - Enhanced `RecurringRule`

5. **UI: RecurringRuleDrawer**
   - Create/edit form
   - Frequency picker, day/month pickers
   - Validation

6. **UI: RecurringOccurrenceCard**
   - All computed states
   - Action buttons

7. **UI: RecurringConfirmModal**
   - Amount editing
   - Payment date

8. **Attention Integration**
   - Surface due occurrences
   - Action handling

9. **Basic Rule History**
   - Show resolved occurrences per rule

### Phase 2: Enhancement (Defer)

- Snooze with custom date picker
- "Update future occurrences" checkbox
- Bulk confirm multiple due
- Fulfillment rate analytics
- Weekly frequency support

---

## 11. i18n Keys

```json
{
  "recurring": {
    "title": "Recurring Expenses",
    "rule": "Rule",
    "createRule": "Create Recurring Expense",
    "editRule": "Edit Recurring Expense",

    "frequency": {
      "monthly": "Monthly",
      "yearly": "Yearly"
    },

    "dayOfMonth": "Day of Month",
    "dayOfMonthHelp": "Day 1-28 only (avoids end-of-month edge cases)",
    "monthOfYear": "Month",

    "scope": {
      "general": "General Expense",
      "project": "Project Expense"
    },

    "state": {
      "projected": "Projected",
      "due": "Due",
      "overdue": "Overdue",
      "snoozed": "Snoozed",
      "paid": "Paid",
      "skipped": "Skipped"
    },

    "actions": {
      "markPaid": "Mark Paid",
      "skip": "Skip",
      "snooze": "Snooze"
    },

    "confirm": {
      "title": "Confirm Payment",
      "amountLabel": "Payment Amount",
      "dateLabel": "Payment Date",
      "confirmButton": "Confirm Payment"
    },

    "attention": {
      "dueToday": "{{title}} due today",
      "overdue": "{{title}} is {{days}} days overdue"
    }
  }
}
```

---

## 12. Test Plan

### 12.1 Unit Tests (Service Layer)

- `recurringExpenseService.confirmPayment()` - creates expense + occurrence
- `recurringExpenseService.skipOccurrence()` - creates occurrence, no expense
- `recurringExpenseService.getVirtualOccurrences()` - correct dates, excludes resolved
- `generateExpectedDates()` - monthly and yearly patterns
- `computeState()` - projected/due/overdue logic

### 12.2 Repository Tests

- `recurringOccurrenceRepo.create()` - validates required fields
- `recurringOccurrenceRepo.getByRuleAndDate()` - finds existing
- `recurringRuleRepo.listActive()` - excludes paused

### 12.3 Component Tests

- `RecurringRuleDrawer` - form validation, yearly requires monthOfYear
- `RecurringOccurrenceCard` - all computed states render correctly
- `RecurringConfirmModal` - amount editing works

### 12.4 Integration Tests

- Create rule → virtual occurrences appear in forecast
- Mark paid → expense in ledger, occurrence resolved
- Skip → no expense, occurrence marked
- Pause rule → no new virtual occurrences
- Profile filtering works throughout

---

## 13. Acceptance Criteria

### Must Have (Phase 1)

- [ ] User can create recurring expense rules (monthly/yearly)
- [ ] Virtual occurrences appear in forecast (ghost styling)
- [ ] Due occurrences surface in Attention area
- [ ] "Mark Paid" creates actual expense linked to rule
- [ ] "Skip" marks occurrence without creating expense
- [ ] Expense ledger shows ONLY actual expenses (never projected)
- [ ] Monthly totals exclude projected recurring
- [ ] Reports exclude projected recurring
- [ ] Rule history shows resolved occurrences
- [ ] Amount can be edited before confirming
- [ ] profileId explicit on all persisted entities

### Nice to Have (Phase 2)

- [ ] Snooze with custom date picker
- [ ] "Update future" checkbox for amount changes
- [ ] Bulk confirm multiple due occurrences
- [ ] Weekly frequency support

---

## 14. Reuse Analysis

| Existing Component | Reuse Strategy |
|-------------------|----------------|
| `DateRangeControl` | Reuse for date pickers |
| `CurrencyInput` | Reuse for amount input |
| `StepperInput` | Use for day-of-month picker |
| `Select` | Use for frequency, month dropdowns |
| `AttentionItem` | Extend for recurring actions |
| `toast` | Use for confirmation feedback |
| `EmptyState` | Use for no rules state |
| `Modal` | Base for confirm modal |

**Do NOT reuse:** `ExpenseDrawer` (keep separate)

---

## 15. References

- ADR-002: Repository Pattern for Storage Abstraction
- ADR-015: Profile-Scoped Expenses
- ADR-003: Drawer-First UX Pattern
- ADR-010: Receivable as Transaction Status (similar rule-vs-reality pattern)
- `src/db/expenseRepository.ts` - existing expense repo
- `src/types/index.ts` - RecurringRule, Expense types
- `src/db/interfaces.ts` - IRecurringRuleRepository interface
