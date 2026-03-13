# Mutaba3a UX Redesign Spec

> **Status:** Authoritative
> **Created:** 2026-03-13
> **Purpose:** Transform Mutaba3a from entity-first CRM to question-first cash flow workspace

---

## 1. Product Reframing

### New Product Definition

Mutaba3a should stop presenting itself as a mini accounting CRM and instead become:

**A cash flow workspace for freelancers.**

The product's job is to help a freelancer answer, quickly and repeatedly:
- What did I receive?
- What is still unpaid?
- What did I spend?
- Which client or project is performing well or badly?

### New UX Principle

The redesign moves from:

**Entity-first software**
clients / projects / transactions / documents

To:

**Question-first financial UX**
income / expenses / unpaid / insights

---

## 2. Strategic UX Decisions

### Removed from Core Experience

For this redesign, the following should be hidden, deprecated, or omitted from MVP-facing UX:
- Documents
- Agreements
- Retainers
- Engagements
- Business profile complexity
- Anything that feels like formal accounting infrastructure

### Remains in Core Experience

Only the bare essentials:
- Home
- Income
- Expenses
- Insights
- Clients
- Projects
- Settings

Clients and Projects are treated as supporting structures, not the main attraction.

---

## 3. New Information Architecture

### Primary Navigation

**Main**
- Home
- Income
- Expenses
- Insights

**Supporting**
- Clients
- Projects

**System**
- Settings
- Download/Backup (if needed)

---

## 4. Sidebar Structure

```typescript
const navSections = [
  {
    key: "main",
    labelKey: "nav.sections.main",
    items: [
      { path: "/", labelKey: "nav.home", icon: HomeIcon, exact: true },
      { path: "/income", labelKey: "nav.income", icon: IncomeIcon },
      { path: "/expenses", labelKey: "nav.expenses", icon: ExpensesIcon },
      { path: "/insights", labelKey: "nav.insights", icon: InsightsIcon },
    ],
  },
  {
    key: "workspace",
    labelKey: "nav.sections.workspace",
    items: [
      { path: "/clients", labelKey: "nav.clients", icon: UsersIcon },
      { path: "/projects", labelKey: "nav.projects", icon: FolderIcon },
    ],
  },
];
```

### Remove from Sidebar
- Transactions
- Documents
- Retainers
- Engagements
- Money Answers (as separate concept)

### Rename
- Overview → Home
- Transactions → Income
- Money Answers / Reports / Analytics → Insights

---

## 5. Mental Model

### Core Model Users Should Feel

**Layer 1: Money**
- income
- expenses
- unpaid
- received

**Layer 2: Context**
- clients
- projects
- work fields

**Layer 3: Answers**
- home
- insights
- summaries

Users should never feel buried under object types. They should feel they are tracking the flow of money and slicing it by context.

---

## 6. Home Page

### Role
Home is the cash flow cockpit, not a generic dashboard.

### Goals
On one screen, the user should understand:
- what came in
- what is still pending
- what went out
- what needs attention

### Structure

#### A. Top KPI Strip
Show per currency by default. Never silently mix totals.

Cards:
- Received this month
- Outstanding unpaid
- Expenses this month
- Net this month

Each card supports:
- USD tab
- ILS tab
- Optional "Both" side-by-side display

#### B. Attention Section
Action-oriented list:
- Overdue unpaid income
- Largest recent expenses
- Projects with expenses but no received income yet
- Clients with oldest unpaid balances

#### C. Recent Activity
Unified recent ledger:
- Income received
- Unpaid created
- Expenses added

Compact chronological feed with smart labels.

#### D. Quick Summaries
Small summary cards:
- Top clients this month
- Top projects this month
- Expense categories this month

### UX Principles
- No dense tables above the fold
- No fake "business intelligence" charts on day one
- No more than 2 levels of visual emphasis
- First screen must answer something useful in under 10 seconds

---

## 7. Income Page

### Role
Main operational page replacing "Transactions."

### User Questions to Answer
- What have I earned?
- What have I invoiced?
- What is still unpaid?
- What did I receive?
- What is overdue?

### Structure

#### A. Header
- Title: Income
- Primary action: Add income
- Secondary controls: search, filters, currency selector

#### B. Segmented Status Tabs
- All
- Earned
- Invoiced
- Unpaid
- Received
- Overdue

#### C. Summary Strip
- Total received in selected period
- Total unpaid
- Total overdue
- Total invoiced

Per currency.

#### D. Ledger List
Each row shows:
- Project
- Client
- Amount
- Currency
- Status
- Due date (if relevant)
- Received amount (if partial)
- Remaining amount
- Latest activity date

#### E. Filters
- Month / year / custom range
- Client
- Project
- Field
- Status
- Currency

### Interaction Model
- Click row opens income drawer
- Add income opens drawer with default type = income
- Quick actions inline: mark received, add partial payment, edit

---

## 8. Expenses Page

### Role
Cleanest page in the app. Just money leaving the system.

### User Questions to Answer
- What did I spend this month?
- What did I spend this year?
- What did I spend on Project X?
- Which categories are growing?

### Structure

#### A. Header
- Title: Expenses
- Primary action: Add expense
- Filters button
- Optional export

#### B. Summary Strip
- This month
- This year
- Project-linked expenses
- General expenses

Per currency.

#### C. Main Views
One list with view toggles:
- List
- By category
- By project

#### D. Expense Row Fields
- Amount
- Currency
- Category
- Linked project or General
- Note
- Date

#### E. Filters
- Date range
- Category
- Project/general
- Currency

### UX Principles
- Adding expense should take seconds
- Categories editable but not over-designed
- No receipts workflow in primary flow
- No tax fields
- No "billable expense" complexity

---

## 9. Insights Page

### Role
Single home for:
- Reports
- Analytics
- Summaries
- Answers

### Structure

#### A. Top Preset Tabs
- Summary
- Clients
- Projects
- Expenses
- Unpaid

#### B. Shared Filter Bar
- Period
- Currency mode
- Client
- Project
- Field

#### C. Main Content by Preset

**Summary**
- Received
- Unpaid
- Expenses
- Net
- Monthly trend

**Clients**
- Total received by client
- Total outstanding by client
- Top clients
- Slowest-paying clients (later)

**Projects**
- Received vs expenses
- Outstanding by project
- Top profitable projects
- Projects with negative net

**Expenses**
- By category
- By project
- By month

**Unpaid**
- Unpaid aging
- Overdue count
- Total outstanding by client/project

### Important Rule
Insights is for understanding, not editing. Editing happens through drawers from the originating page.

---

## 10. Clients Page

### Role
Money relationship directory, not a CRM module.

### List Page Shows
- Client name
- Active projects count
- Total received
- Total unpaid
- Last activity date
- Optional small tag for main field of work

### Detail Page Sections
- Headline summary (total received, outstanding, expenses)
- Projects list
- Income ledger for this client
- Recent activity
- Notes

### UX Principle
Default view answers "is this client valuable and do they owe me money?" not "what is their phone number."

---

## 11. Projects Page

### Role
Profitability lens.

### List Page Shows
- Project name
- Client
- Field
- Status
- Received
- Unpaid
- Expenses
- Net

### Detail Page Sections
- Summary (received, unpaid, expenses, net)
- Income timeline
- Expense timeline
- Notes

### UX Principle
A project page answers: "Was this project worth it?"

---

## 12. Global Add Flow

### New Global Add Menu
- Add income
- Add expense
- Add client
- Add project

Nothing else for now.

### Drawer Behavior
- All create/edit actions in drawers
- Deep-linking remains possible
- Context preserved underneath

---

## 13. Global Search

### Role
Lightweight retrieval, not system-wide command magic.

### Search Targets
- Clients
- Projects
- Maybe income entries later

### UI
Small global search in top bar or command-style overlay:
- Type client/project name
- Jump to record
- Optionally create new if no result

---

## 14. Multi-Currency UX Rules

### Sacred Rules
- Never sum USD and ILS silently
- Always show separate totals by default
- If converted total shown, display:
  - Original amount
  - Rate used
  - Converted amount
- If rate missing, say "missing rate"

### UI Recommendation
Default currency mode = Separate

Optional switch:
- USD
- ILS
- Both
- Converted (later, possibly paid feature)

---

## 15. Empty States and First-Run UX

### First-Run Structure

**Step 1:** Add first client
**Step 2:** Add first project
**Step 3:** Add first income or expense

Then take user to Home with live numbers.

### Empty State Language
- "Add your first income entry"
- "Track an expense"
- "Create a project under a client"

Practical, not motivational.

---

## 16. Route Map

### Keep
- `/` (Home)
- `/income`
- `/expenses`
- `/insights`
- `/clients`
- `/clients/:id`
- `/projects`
- `/projects/:id`
- `/settings`

### Hide or De-emphasize
- `/transactions`
- `/documents`
- `/retainers`
- `/engagements`
- `/money-answers`
- `/reports` (as standalone)

### Redirect Strategy
- `/transactions` → `/income`
- `/money-answers` → `/insights`
- `/reports` → `/insights`
- documents/retainers/engagements not exposed in nav

---

## 17. Content and Naming

### Navigation Labels
- Home
- Income
- Expenses
- Insights
- Clients
- Projects
- Settings

### Avoid
- Transactions
- Money Answers (as nav label)
- Ledger (as primary nav term)
- Reports (as only wording)

---

## 18. Page Acceptance Criteria

### Home
User can see received this month, unpaid outstanding, expenses, and attention items within seconds of opening.

### Income
User can add income, filter by status/client/project/date/currency, understand unpaid vs received, record partial payments.

### Expenses
User can add expense in seconds, link to project or General, filter by category/project/date/currency, understand yearly and monthly spend.

### Insights
User can view summary/client/project/expense/unpaid insights, change time period and currency mode, export data.

### Clients
User can see client value and outstanding money at a glance, navigate to related projects and income.

### Projects
User can see project net picture quickly, view linked income and expenses in one place.

---

## 19. Technical Constraints to Preserve

### Drawer-First CRUD
System uses drawers for create/edit to preserve context and speed. Do not switch to full-page forms.

### URL-Driven Drawer State
Deep-linking and back-button behavior are decision-backed. Preserve them.

### Offline-First
No redesign should assume network availability. IndexedDB remains primary data store.

### Per-Currency Architecture
Part of the product's honesty layer. Do not break.

---

## 20. Deprecation List

### Demote Now
- Documents
- Retainers
- Engagements
- Generic transactions page
- Standalone reports page
- Standalone money answers page

### Keep in Code, Hide in UX
Freedom to reintroduce later if needed.

---

## 21. Rollout Phases

### Phase 1: Navigation and Labeling Cleanup
- Rename Overview to Home
- Rename Transactions to Income
- Merge Money Answers/Reports into Insights
- Hide Documents/Retainers/Engagements from nav
- Simplify global add menu

### Phase 2: Home, Income, Expenses Redesign
- Rebuild these three screens around new structure
- Preserve existing drawers and repositories
- Focus on empty states and first-run flow

### Phase 3: Clients and Projects Repositioning
- Refactor list and detail screens into summary-oriented views
- Reduce CRM-style profile emphasis

### Phase 4: Insights Consolidation
- Unify reporting UX into one page
- Retire report sprawl and naming confusion

---

## 22. Product Truth

The sharpest version of Mutaba3a is not:
"a mini CRM with accounting features."

It is:
"a focused cash flow tool that helps freelancers know what they made, what they're owed, and what they spent."
