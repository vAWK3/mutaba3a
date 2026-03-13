# Design: Income Drawer UX Redesign

**Status:** Draft v2
**Author:** Claude
**Date:** 2026-03-13
**Revision:** Incorporates feedback on status model, profile UX, and architectural clarity

---

## 1. Problem Statement

The current `TransactionDrawer` carries legacy baggage that conflicts with the redesigned product model:

1. **Treats "receivable" as a type, not a status** - Architecture (ADR-010) says receivable = unpaid income, but the UI presents it as a sibling to "income"

2. **Includes "Expense" in income drawer** - We have a dedicated ExpenseDrawer; this is redundant

3. **No profile awareness** - Transactions can be created without profile scope, violating the multi-identity model

4. **Flattens the income journey** - The product brief defines income as Earned → Invoiced → Received, but the drawer collapses this into a binary

5. **Profile field as heavy form input** - Doesn't match the "cockpit, not CRUD" philosophy

---

## 2. Architectural Truth (from existing docs)

### From ADR-010: Receivable as Transaction Status
> Receivable = Transaction with `kind='income'` and `status='unpaid'`

This means:
- `kind` = what type of money event (income or expense)
- `status` = where it is in its lifecycle

**Receivable is NOT a peer type to income. It's unpaid income.**

### From ADR-015: Expense Belongs to BusinessProfile
> Expenses are profile-scoped by design.

Income should follow the same pattern for consistency.

### From Product Brief: Income Journey
> Income flows through: **Earned → Invoiced → Received**
> Unpaid/outstanding = earned or invoiced money not yet paid

### From Product Brief: Partial Payments
> Support partial payments through multiple received entries against unpaid income

---

## 3. Design Decisions

### Decision 1: Rename to IncomeDrawer

**Change:** `TransactionDrawer` → `IncomeDrawer`

**Rationale:** The product UX splits income and expense into separate surfaces. The component name should reflect this. Internally, we can still use the same Transaction entity.

### Decision 2: Status-based model, not type-based

**Old model (wrong):**
```
type: 'income' | 'receivable' | 'expense'  // "receivable" is not a type
```

**New model (correct):**
```
kind: 'income'  // fixed for this drawer
status: 'earned' | 'invoiced' | 'received'
```

The drawer creates income. The user selects where in the lifecycle it is.

### Decision 3: Three-status selector (Option A from feedback)

```
[ Earned ] [ Invoiced ] [ Received ]
```

| UI Label | Meaning | Database Mapping |
|----------|---------|------------------|
| **Earned** | Work done, not yet billed | kind='income', status='unpaid', substatus='earned' |
| **Invoiced** | Invoice sent, awaiting payment | kind='income', status='unpaid', substatus='invoiced' |
| **Received** | Payment collected | kind='income', status='paid' |

**Why not just Unpaid/Received?**
- "Unpaid" is ambiguous (earned? invoiced? overdue?)
- The brief explicitly wants earned vs invoiced distinction
- Better reporting: "How much have I earned but not billed?"

**Substatus field:**
For phase 1, we can store this in a new `substatus` field or in `notes`/metadata. The important thing is the UI exposes the real mental model.

### Decision 4: Contextual profile handling

Profile should feel like context, not a form field.

| Scenario | Profile UX |
|----------|------------|
| **Single profile** | Hidden entirely (auto-selected silently) |
| **Specific profile active** | Compact chip/badge in drawer header, not a form field |
| **"All Profiles" mode** | Tiny picker appears FIRST, then drawer opens with profile set |

**Why not a dropdown as first field?**
- In the common case (single profile or specific profile), it's noise
- The user should feel they're "in" a business context, not filling an admin form
- Drawer-first UX means fast entry, not form ceremony

### Decision 5: Client/Project scope - explicit statement

**Current truth (v1):**
> Clients and Projects are **global** in the current data model. They are not profile-scoped.

**Implication:**
- A user in "Business A" profile can attach income to a client that might conceptually belong to "Business B"
- This is a known limitation, not a bug

**Future direction (v2):**
> Clients and Projects should become profile-scoped, because freelancers want real separation, not cosmetic.

**For this design:**
- Document the current compromise explicitly
- Do not filter client/project dropdowns by profile (would break existing data)
- Plan for profile-scoping in a future iteration

### Decision 6: Partial payments strategy

**MVP approach (from brief):**
> Multiple received entries against unpaid income

**How it works:**
1. User creates income as "Earned" or "Invoiced" with full amount
2. When partial payment arrives, user creates new "Received" entry linked to original
3. Original stays "Invoiced" until fully paid
4. System computes: outstanding = original amount - sum(linked received)

**Phase 1 simplification:**
- For MVP, partial payment = user manually adjusts amounts or creates separate entries
- The UI should not block this workflow
- Future: explicit "Add Payment" action on unpaid income

### Decision 7: Profile picker is tiny and fast

**Wrong:**
```
┌─────────────────────────────────────────┐
│                                         │
│       Select Business Profile           │
│   Which profile is this income for?     │
│        [motivational copy here]         │
│                                         │
│  ┌─────────────────────────────────┐    │
│  │ [A]  Business A                 │    │
│  └─────────────────────────────────┘    │
│                                         │
│  ┌─────────────────────────────────┐    │
│  │ [B]  Business B                 │    │
│  └─────────────────────────────────┘    │
│                                         │
│              [Cancel]                   │
│                                         │
└─────────────────────────────────────────┘
```

**Right:**
```
┌────────────────────────┐
│ Choose profile         │
├────────────────────────┤
│ ○ Business A           │
│ ○ Business B           │
└────────────────────────┘
```

- No title haiku
- No description paragraph
- Click profile → drawer opens immediately
- Feels like choosing a destination, not attending a hearing

---

## 4. Revised UI Spec

### 4.1 IncomeDrawer (Create Mode)

```
┌─────────────────────────────────────────┐
│ New Income                          [X] │
│ ┌─────────────────────────────────────┐ │
│ │ [B] Business A                      │ │  ← Profile chip (readonly, only if multi-profile)
│ └─────────────────────────────────────┘ │
├─────────────────────────────────────────┤
│                                         │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ │
│  │  Earned  │ │ Invoiced │ │ Received │ │  ← Status selector
│  │          │ │          │ │   ███    │ │
│  └──────────┘ └──────────┘ └──────────┘ │
│                                         │
│  ┌─────────────────┐ ┌─────────────┐    │
│  │ Amount *        │ │ Currency *  │    │
│  │ ____________    │ │ [USD ▼]     │    │
│  └─────────────────┘ └─────────────┘    │
│                                         │
│  Date *                                 │
│  ┌─────────────────────────────────┐    │
│  │ 2026-03-13                      │    │
│  └─────────────────────────────────┘    │
│                                         │
│  Due Date (for Earned/Invoiced)         │
│  ┌─────────────────────────────────┐    │
│  │ ____________________________    │    │
│  └─────────────────────────────────┘    │
│                                         │
│  Client                                 │
│  ┌─────────────────────────────────┐    │
│  │ Select client...              ▼ │    │
│  └─────────────────────────────────┘    │
│                                         │
│  Project                                │
│  ┌─────────────────────────────────┐    │
│  │ Select project...             ▼ │    │
│  └─────────────────────────────────┘    │
│                                         │
│  Title                                  │
│  ┌─────────────────────────────────┐    │
│  │ ____________________________    │    │
│  └─────────────────────────────────┘    │
│                                         │
│  Notes                                  │
│  ┌─────────────────────────────────┐    │
│  │                                 │    │
│  └─────────────────────────────────┘    │
│                                         │
├─────────────────────────────────────────┤
│              [Cancel]     [Save]        │
└─────────────────────────────────────────┘
```

### 4.2 Profile Chip Behavior

**Single profile (most common):**
- No chip shown
- Profile auto-selected silently
- User doesn't think about profiles

**Multi-profile, specific one active:**
```
┌─────────────────────────────────────┐
│ [B] Business A              [change]│  ← Small "change" link if user wants to switch
└─────────────────────────────────────┘
```

**Multi-profile, "All" mode:**
- Tiny picker appears before drawer
- After selection, chip shows in drawer header (readonly)

### 4.3 Tiny Profile Picker (All Profiles mode)

```
┌────────────────────────┐
│ Choose profile         │
├────────────────────────┤
│ ● Business A           │ ← Click = select + open drawer
│ ○ Business B           │
│ ○ Business C           │
└────────────────────────┘
```

- Appears as popover/dropdown from the "+ New" button, not a modal
- Single click selects and continues
- No confirm button needed
- Escape or click-away cancels

---

## 5. Data Model Clarification

### Current Schema (no changes needed for phase 1)

```typescript
interface Transaction {
  id: string;
  kind: 'income' | 'expense';
  status: 'paid' | 'unpaid';
  // ... other fields
  profileId?: string;  // Make this required for NEW transactions
}
```

### UI-to-Database Mapping

| UI Status | kind | status | Future: substatus |
|-----------|------|--------|-------------------|
| Earned | income | unpaid | earned |
| Invoiced | income | unpaid | invoiced |
| Received | income | paid | — |

**Phase 1:** Store substatus in a new field or use a convention (e.g., first line of notes, or a metadata field).

**Phase 2:** Add proper `substatus` column if needed for reporting.

### Migration Notes

**Existing transactions:**
- Keep working as-is
- `profileId` remains optional for old data
- New transactions require profileId at form level

**Legacy deep links:**
- Old URLs with `?newTx=expense` should redirect to ExpenseDrawer
- Old URLs with `?newTx=income` or `?newTx=receivable` should open IncomeDrawer

---

## 6. Component Architecture

### Renamed Components

| Old | New |
|-----|-----|
| `TransactionDrawer` | `IncomeDrawer` |
| `transactionDrawer` (store) | `incomeDrawer` (store) |
| `openTransactionDrawer` | `openIncomeDrawer` |

### New Components

| Component | Purpose |
|-----------|---------|
| `ProfileContextChip` | Compact readonly profile indicator in drawer header |
| `ProfileQuickPicker` | Tiny popover for profile selection |
| `useProfileAwareAction` | Hook to handle profile-checking before any action |

### useProfileAwareAction Hook

```typescript
interface UseProfileAwareActionOptions {
  onExecute: (profileId: string) => void;
}

function useProfileAwareAction(options: UseProfileAwareActionOptions) {
  const { isAllProfiles, activeProfileId, profiles } = useActiveProfile();
  const [pickerAnchor, setPickerAnchor] = useState<HTMLElement | null>(null);

  const trigger = useCallback((event: React.MouseEvent<HTMLElement>) => {
    if (profiles.length === 1) {
      // Single profile: execute immediately
      options.onExecute(profiles[0].id);
    } else if (!isAllProfiles) {
      // Specific profile: execute with that profile
      options.onExecute(activeProfileId);
    } else {
      // All Profiles: show picker anchored to click target
      setPickerAnchor(event.currentTarget);
    }
  }, [profiles, isAllProfiles, activeProfileId, options]);

  const handleSelect = useCallback((profile: BusinessProfile) => {
    setPickerAnchor(null);
    options.onExecute(profile.id);
  }, [options]);

  return {
    trigger,
    pickerProps: {
      anchor: pickerAnchor,
      profiles,
      onSelect: handleSelect,
      onClose: () => setPickerAnchor(null),
    },
  };
}
```

---

## 7. i18n Keys

### New Keys

```json
{
  "drawer.income.title": "New Income",
  "drawer.income.editTitle": "Edit Income",
  "drawer.income.statusEarned": "Earned",
  "drawer.income.statusEarnedHint": "Work done, not yet billed",
  "drawer.income.statusInvoiced": "Invoiced",
  "drawer.income.statusInvoicedHint": "Invoice sent, awaiting payment",
  "drawer.income.statusReceived": "Received",
  "drawer.income.statusReceivedHint": "Payment collected",
  "drawer.income.dueDate": "Due Date",
  "profile.choose": "Choose profile",
  "profile.change": "change"
}
```

### Arabic

```json
{
  "drawer.income.title": "دخل جديد",
  "drawer.income.editTitle": "تعديل الدخل",
  "drawer.income.statusEarned": "مُستحق",
  "drawer.income.statusEarnedHint": "عمل منجز، لم يُفوتر بعد",
  "drawer.income.statusInvoiced": "مُفوتر",
  "drawer.income.statusInvoicedHint": "فاتورة مُرسلة، بانتظار الدفع",
  "drawer.income.statusReceived": "مُستلم",
  "drawer.income.statusReceivedHint": "تم استلام الدفعة",
  "drawer.income.dueDate": "تاريخ الاستحقاق",
  "profile.choose": "اختر الملف",
  "profile.change": "تغيير"
}
```

---

## 8. Files to Modify

| File | Changes |
|------|---------|
| `src/components/drawers/TransactionDrawer.tsx` | Rename to `IncomeDrawer.tsx`, new status model |
| `src/components/drawers/index.ts` | Update exports |
| `src/lib/stores.ts` | Rename drawer state |
| `src/components/layout/SidebarNav.tsx` | Use `useProfileAwareAction`, open IncomeDrawer |
| `src/components/ui/ProfileContextChip.tsx` | New component |
| `src/components/ui/ProfileQuickPicker.tsx` | New component (replaces modal for this use case) |
| `src/hooks/useProfileAwareAction.ts` | New hook |
| `src/lib/i18n/translations/*.json` | Add new keys |
| `src/router.tsx` | Handle legacy `?newTx=` params |

---

## 9. Acceptance Criteria

### Must Have
- [ ] Drawer renamed to IncomeDrawer (component and store)
- [ ] Status selector: Earned / Invoiced / Received
- [ ] No "Expense" option in income drawer
- [ ] Profile auto-selected for single-profile users (invisible)
- [ ] Profile shown as compact chip for multi-profile users
- [ ] ProfileQuickPicker appears in "All Profiles" mode before drawer opens
- [ ] New income transactions have profileId
- [ ] Due date field shown for Earned/Invoiced, hidden for Received
- [ ] Legacy `?newTx=expense` redirects to ExpenseDrawer

### Should Have
- [ ] "Change" link on profile chip to switch profile
- [ ] Status selector has subtle hints on hover/focus
- [ ] Smooth animation from picker to drawer

### Won't Have (Phase 1)
- [ ] Profile-scoped client/project filtering (documented limitation)
- [ ] Explicit "Add Payment" action for partial payments
- [ ] Substatus as formal database column

---

## 10. Testing Plan

### Unit Tests
- [ ] `useProfileAwareAction` returns correct behavior for 1/N/All profile modes
- [ ] Status mapping: Earned → unpaid, Invoiced → unpaid, Received → paid
- [ ] Schema validation requires profileId for new income

### Integration Tests
- [ ] Single profile user: drawer opens without picker, profile auto-selected
- [ ] Multi-profile user in specific mode: drawer opens with profile chip
- [ ] Multi-profile user in "All" mode: picker appears, then drawer
- [ ] Edit mode loads existing income correctly
- [ ] Legacy URL params handled correctly

### Manual Testing
- [ ] Flow feels fast (no unnecessary clicks)
- [ ] RTL layout correct
- [ ] Mobile/touch works

---

## 11. Known Limitations (Documented)

### Client/Project Scope
> **Current state:** Clients and Projects are global, not profile-scoped.
>
> **Implication:** User can attach income to any client, regardless of which profile is selected.
>
> **Future:** Consider profile-scoping clients/projects for true business separation.

### Partial Payments
> **Current state:** Users handle partial payments by creating multiple received entries manually.
>
> **Future:** Add explicit "Record Payment" action on unpaid income with remaining balance tracking.

### Earned vs Invoiced Distinction
> **Current state:** Stored as metadata or convention; both map to status='unpaid' in database.
>
> **Future:** Add formal `substatus` column if reporting requires it.

---

## 12. Decision Log

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Rename TransactionDrawer → IncomeDrawer | Yes | Matches product model; stops carrying legacy naming |
| Three statuses (Earned/Invoiced/Received) | Yes | Matches brief; avoids "Pending" ambiguity |
| Profile hidden for single-profile users | Yes | Reduces noise in common case |
| Profile as chip, not form field | Yes | Context, not admin form |
| Tiny picker, not modal | Yes | Fast; feels like destination choice |
| Client/Project remain global (v1) | Yes | Document limitation; don't break existing data |
| No Expense in income drawer | Yes | Dedicated ExpenseDrawer exists |

---

## Appendix: Migration from TransactionDrawer

### Code Changes

```diff
- // Old: type as top-level concept
- type: z.enum(['income', 'receivable', 'expense'])
+ // New: status within income
+ incomeStatus: z.enum(['earned', 'invoiced', 'received'])
+ profileId: z.string().min(1)

- // Old: mapping
- const kind = data.type === 'expense' ? 'expense' : 'income';
- const status = data.type === 'receivable' ? 'unpaid' : 'paid';
+ // New: mapping
+ const kind = 'income'; // Always income in this drawer
+ const status = data.incomeStatus === 'received' ? 'paid' : 'unpaid';
```

### URL Handling

| Old URL | New Behavior |
|---------|--------------|
| `?newTx=income` | Open IncomeDrawer, default to Earned |
| `?newTx=receivable` | Open IncomeDrawer, default to Invoiced |
| `?newTx=expense` | Redirect to ExpenseDrawer |
| `?tx=<id>` (edit) | Detect kind, open appropriate drawer |

---

## Ready for Review

This revision addresses:
1. Status model aligned with product brief (Earned/Invoiced/Received)
2. "Receivable" treated as status, not type
3. Profile UX is contextual, not form-heavy
4. Client/Project scope explicitly documented as global (v1 limitation)
5. Partial payment strategy documented
6. Tiny picker, not ceremonial modal
7. Component renamed to IncomeDrawer
8. Legacy URL handling specified
