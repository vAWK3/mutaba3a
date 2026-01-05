
## **1) Route map + app shell layout**

  

### **Routes**

- / → **Overview**
    
- /projects → **Projects index**
    
- /projects/:projectId → **Project detail**
    
- /clients → **Clients index**
    
- /clients/:clientId → **Client detail**
    
- /transactions → **Transactions ledger**
    
- /reports → **Reports**
    
- /settings → **Settings**
    

  

### **AppShell (shared layout)**

- **Left Sidebar** (fixed)
    
    - Overview
        
    - Projects
        
    - Clients
        
    - Transactions
        
    - Reports
        
    - (Settings pinned at bottom)
        
    
- **TopBar** (sticky inside content)
    
    - Page title (and breadcrumb only for detail pages)
        
    - Global filters (optional per page)
        
    - **Primary CTA**: + Add (menu)
        
    
- **Main Content** (scroll)
    
- **Global Drawers**
    
    - TransactionDrawer (Add/Edit)
        
    - ProjectDrawer (Add/Edit basic)
        
    - ClientDrawer (Add/Edit basic)
        
    

  

**Key UX rule:** no “create pages.” Everything is **drawer-first** so the app feels like a tool, not a website.

---

## **2) Shared UI components (implementation-ready spec)**

  

### **Navigation + framing**

- SidebarNav
    
    - Active state, keyboard friendly
        
    - Collapsible sections (later, not MVP)
        
    
- TopBar
    
    - Breadcrumbs (only on /projects/:id and /clients/:id)
        
    - AddMenuButton (always visible)
        
    

  

### **Filters (reused across pages)**

- DateRangePicker (presets: This month, Last month, This year, Custom)
    
- CurrencyTabs (USD, ILS, All (Converted) optional)
    
- StatusSegment (All, Paid, Unpaid, Overdue) — only when relevant
    
- SearchInput (searches client/project/note)
    

  

### **Tables**

- DataTable
    
    - sortable columns
        
    - column visibility (later)
        
    - row click opens detail OR drawer depending on page
        
    
- RowActions
    
    - Edit
        
    - Duplicate (nice-to-have)
        
    - Delete (soft-delete preferred)
        
    

  

### **Drawers**

- TransactionDrawer
    
    - mode: create/edit
        
    - type switch: Income (Paid), Receivable (Unpaid), Expense
        
    - smart defaults: last currency, last project for client, today’s date
        
    
- ClientDrawer, ProjectDrawer
    
    - minimal fields only
        
    

---

## **3) Screen-by-screen: layout + columns + filters**

  

### **A) Overview** 

### **/**

  

**Top controls**

- Date range preset (default: **This month**)
    
- Currency tabs: USD | ILS | All (Converted) (the last one can be disabled until FX settings exist)
    

  

**KPI cards (for selected currency)**

- Paid Income
    
- Unpaid Receivables
    
- Expenses
    
- Net (Paid - Expenses)
    
    _(Optional microtext: “Net incl. receivables”)_
    

  

**Needs attention list**

- Overdue receivables (sorted by most overdue)
    
- Receivables due in next 7 days
    

  

**Recent activity table (last 10)**

Columns:

- Date
    
- Type (Income / Receivable / Expense)
    
- Client
    
- Project
    
- Amount
    
- Status (Paid/Unpaid + due date if unpaid)
    

  

Row click → opens TransactionDrawer (edit)

---

### **B) Projects index** 

### **/projects**

  

**Filters**

- Search (name + client)
    
- Field filter (simple dropdown)
    
- Currency tabs
    

  

**Columns**

- Project
    
- Client
    
- Field
    
- Paid Income
    
- Unpaid
    
- Expenses
    
- Net
    
- Last activity
    

  

Row click → /projects/:projectId

---

### **C) Project detail** 

### **/projects/:projectId**

  

Header:

- Project name
    
- Quick stats inline (Paid / Unpaid / Expenses)
    
- + Add prefilled with project
    

  

Tabs:

1. **Summary**
    
    - KPI row for project
        
    - Month breakdown list (not a full chart)
        
    
2. **Transactions**
    
    - same table as ledger but scoped to project
        
    
3. **Notes** (optional MVP but low effort, high value)
    

  

Transactions tab filters:

- Date range
    
- Currency
    
- Status (All/Paid/Unpaid/Overdue)
    
- Search
    

  

Transactions columns:

- Date
    
- Type
    
- Client
    
- Category
    
- Amount
    
- Status / Due
    
- Note indicator
    

---

### **D) Clients index** 

### **/clients**

  

**Filters**

- Search
    
- Currency tabs
    

  

**Columns**

- Client
    
- Active projects
    
- Paid Income
    
- Unpaid
    
- Last payment date
    
- Last activity
    

  

Row click → /clients/:clientId

---

### **E) Client detail** 

### **/clients/:clientId**

  

Header:

- Client name
    
- Quick stats
    
- + Add prefilled with client
    

  

Sections/Tabs (either is fine; I’d do tabs for consistency):

1. Summary
    
2. Projects (list of linked projects)
    
3. Receivables (focused table)
    
4. Transactions (full scoped ledger)
    

  

Receivables table columns:

- Due date
    
- Project
    
- Amount
    
- Days overdue
    
- Status
    
- Actions: Mark paid
    

---

### **F) Transactions ledger** 

### **/transactions**

  

This is the “truth table” screen.

  

**Filters (top row)**

- Date range (default This month)
    
- Currency tabs
    
- Type: All | Income | Receivable | Expense
    
- Status (contextual): All | Paid | Unpaid | Overdue
    
- Search
    

  

**Columns**

- Date
    
- Type
    
- Client
    
- Project
    
- Category
    
- Amount (with currency)
    
- Status (Paid/Unpaid + due)
    
- Note / Attachments indicator
    

  

Row click → TransactionDrawer (edit)

---

### **G) Reports** 

### **/reports**

  

Left panel: report presets

Right panel: report view + export

  

Presets:

- This month
    
- This year
    
- By project
    
- By client
    
- Expenses by category
    
- Unpaid aging (0–7 / 8–30 / 31–60 / 60+)
    

  

Common controls:

- Date range (where relevant)
    
- Currency tabs
    
- Export CSV (MVP)
    
- Toggle All (Converted) (only if FX configured)
    

---

### **H) Settings** 

### **/settings**

  

MVP-only settings:

- Enabled currencies (USD/ILS)
    
- Default currency tab
    
- FX settings (only needed for “All converted”)
    
- Data export/import
    
- (Later) Sync login + status
    

---

## **4) Data model (offline-first, multi-currency, receivables clean)**

  

### **Core entities**

- **Client**
    
- **Project**
    
- **Transaction**
    

  

### **The big choice: how to represent “unpaid income”**

  

Do **not** invent a second object. Make it a transaction with kind=income and status=unpaid.

That way:

- receivables are first-class
    
- “mark paid” is just flipping status + setting paid_at
    

  

### **Transaction types**

- kind: income | expense
    
- status: paid | unpaid _(only meaningful for income; expenses are always paid unless you want “payables” later)_
    
- due_date: required if income+unpaid, else null
    

  

### **Currency handling rules (non-negotiable)**

1. **Always store the original amount & currency.**
    
2. Reports are **per-currency by default**.
    
3. “All (Converted)” is optional and must:
    
    - clearly show the base currency
        
    - clearly state the FX source (manual rate, date)
        
    

  

### **Minimal schema (SQLite-friendly, works later for sync)**

```
-- clients
CREATE TABLE clients (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT
);

-- projects
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  client_id TEXT,
  field TEXT,              -- e.g. "Design", "Development", "Legal"
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT,
  FOREIGN KEY (client_id) REFERENCES clients(id)
);

-- categories (simple, optional table; or keep category as TEXT on transaction)
CREATE TABLE categories (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,      -- 'income' or 'expense'
  name TEXT NOT NULL
);

-- transactions
CREATE TABLE transactions (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,              -- 'income' | 'expense'
  status TEXT NOT NULL,            -- 'paid' | 'unpaid' (income only; expenses use 'paid')
  title TEXT,                      -- optional short label
  client_id TEXT,
  project_id TEXT,
  category_id TEXT,
  amount_minor INTEGER NOT NULL,   -- store cents/agorot
  currency TEXT NOT NULL,          -- 'USD' | 'ILS'
  occurred_at TEXT NOT NULL,       -- when it happened (invoice date / expense date)
  due_date TEXT,                   -- required if income+unpaid
  paid_at TEXT,                    -- set when marking paid
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  FOREIGN KEY (client_id) REFERENCES clients(id),
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (category_id) REFERENCES categories(id)
);

-- fx rates (only needed for unified converted reports)
CREATE TABLE fx_rates (
  id TEXT PRIMARY KEY,
  base_currency TEXT NOT NULL,     -- e.g. 'ILS'
  quote_currency TEXT NOT NULL,    -- e.g. 'USD'
  rate REAL NOT NULL,              -- 1 quote_currency = rate base_currency? pick and stick to one convention
  effective_date TEXT NOT NULL,    -- YYYY-MM-DD
  source TEXT NOT NULL,            -- 'manual'
  created_at TEXT NOT NULL
);
```

### **Receivable logic (exact behavior)**

- A transaction is a **receivable** if:
    
    - kind = 'income' AND status = 'unpaid'
        
    
- It is **overdue** if:
    
    - receivable AND due_date < today
        
    
- “Mark as paid” does:
    
    - set status='paid'
        
    - set paid_at = now()
        
    - optionally set occurred_at unchanged (keep original “earned” date)
        
    

  

This preserves a useful distinction:

- **occurred_at** = when you earned/issued it
    
- **paid_at** = when cash actually arrived
    

---

## **5) Repository API (so storage can swap later: IndexedDB now, SQLite in Tauri)**

  

Define a storage-agnostic interface. Your UI never touches SQL directly.

```
type Currency = 'USD' | 'ILS';
type TxKind = 'income' | 'expense';
type TxStatus = 'paid' | 'unpaid';

export interface Transaction {
  id: string;
  kind: TxKind;
  status: TxStatus;
  clientId?: string;
  projectId?: string;
  categoryId?: string;
  amountMinor: number;
  currency: Currency;
  occurredAt: string; // ISO
  dueDate?: string;   // ISO date
  paidAt?: string;    // ISO
  notes?: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

export interface QueryFilters {
  dateFrom?: string;
  dateTo?: string;
  currency?: Currency;         // if undefined => all (but show grouped totals)
  kind?: TxKind;
  status?: TxStatus | 'overdue';
  clientId?: string;
  projectId?: string;
  search?: string;
  limit?: number;
  offset?: number;
  sort?: { by: string; dir: 'asc' | 'desc' };
}

export interface Repo {
  listTransactions(filters: QueryFilters): Promise<Transaction[]>;
  getTransaction(id: string): Promise<Transaction | null>;
  upsertTransaction(tx: Transaction): Promise<void>;
  markIncomePaid(id: string, paidAtIso: string): Promise<void>;
  softDeleteTransaction(id: string): Promise<void>;

  listProjects(...): Promise<...>;
  listClients(...): Promise<...>;

  getOverviewTotals(filters: { dateFrom: string; dateTo: string; currency?: Currency }): Promise<{
    paidIncomeMinor: number;
    unpaidIncomeMinor: number;
    expensesMinor: number;
  }>;
}
```

**Why this matters:** you can start with **Dexie/IndexedDB** for web speed, then implement the same Repo using **SQLite in Tauri** without rewriting screens.

---

## **6) “All (Converted)” unified view (FX behavior that won’t lie)**

- Only enabled when:
    
    - user selects a base currency (e.g. ILS)
        
    - at least one relevant FX rate exists for date range
        
    
- Conversion convention (pick one and never mix):
    
    - Example: store **USD→ILS** as base=ILS, quote=USD, rate=3.65 meaning:
        
        - amountILS = amountUSD * 3.65
            
        
    
- For a converted report, each row should optionally show:
    
    - original amount + currency
        
    - converted amount + base currency
        
    - FX rate used (effective date)
        
    

  

MVP shortcut (honest one): for “This month” converted totals, use the **latest rate** in that month unless a per-day rate exists.

---

## **7) What to build first (fastest path)**

1. Implement **Repo + schema + seed data**
    
2. Build **Transactions ledger + TransactionDrawer**
    
3. Add **Projects index/detail** (just filtered ledger + summary)
    
4. Add **Clients index/detail**
    
5. Add **Overview** (computed totals + attention list)
    
6. Add **Reports presets** (reuse query + group)
    

  

That order gives you a usable tool early, and every new screen is mostly just “different query + grouping.”

---

Below is a buildable **component tree per route** (React desktop-first) plus a **minimal design system spec** so it feels like a sharp financial cockpit, not an admin CRUD swamp.

---

## **0) App architecture decisions (so the code stays sane)**

  

### **Rendering + state boundaries**

- **Server is irrelevant for MVP** → build as SPA/PWA.
    
- **Data lives locally** (IndexedDB now), with a **Repo** abstraction.
    
- **UI state** (filters, drawers) is URL + lightweight store.
    
- **Derived totals** are computed in the Repo (preferred) or memoized selectors.
    

  

### **Suggested stack (fast + predictable)**

- React + Vite
    
- TanStack Router _or_ React Router
    
- TanStack Query for caching async queries (even offline repos benefit)
    
- Dexie (IndexedDB) for web storage
    
- Later: swap Repo to SQLite in Tauri
    

---

## **1) Global component system (App Shell)**

  

### **<AppRoot />**

- Provides:
    
    - <RepoProvider repo={repo} />
        
    - <QueryClientProvider />
        
    - <AppUIProvider /> (drawer state, toasts)
        
    - Router
        
    

  

### **<AppShell />**

###  **(always mounted)**

```
AppShell
 ├─ SidebarNav
 ├─ TopBar
 ├─ MainViewport
 └─ GlobalOverlays
     ├─ TransactionDrawerController
     ├─ ProjectDrawerController
     └─ ClientDrawerController
```

#### **SidebarNav**

Props:

- items: NavItem[]
    
- activePath: string
    

  

Memo boundary:

- React.memo(SidebarNav) (re-renders only on route change)
    

  

#### **TopBar**

Props:

- title: ReactNode
    
- breadcrumbs?: Breadcrumb[]
    
- rightSlot?: ReactNode (Add menu, page actions)
    
- filterSlot?: ReactNode (page-level filters)
    

  

Memo boundary:

- split:
    
    - TopBarTitle
        
    - TopBarActions
        
    - TopBarFilters
        
    

  

#### **GlobalOverlays**

State:

- drawerState in a small store (Zustand or Context + reducer)
    
- But: **open drawer state should mirror URL** when possible (deep linkable):
    
    - ?tx=123 for edit drawer
        
    - ?newTx=income for create
        
    

---

## **2) Shared primitives (the “cockpit kit”)**

  

### **Filters**

- <DateRangeControl value onChange presets />
    
- <CurrencyTabs value onChange enabledCurrencies />
    
- <TypeSegment value onChange /> (All / Income / Receivable / Expense)
    
- <StatusSegment value onChange /> (All / Paid / Unpaid / Overdue)
    
- <SearchInput value onChange debounceMs=200 />
    

  

Perf rule: Filters update a **single FiltersModel** object and push to URL (replaceState), not multiple setStates.

  

### **Tables**

- <DataTable columns rows rowKey onRowClick />
    
- <CellAmount amountMinor currency />
    
- <CellStatus status dueDate paidAt />
    
- <RowActionsMenu />
    

  

Perf rule: Tables should take **already-shaped rows**. Don’t pass raw transactions and compute per cell.

  

### **Summary blocks**

- <KpiRow items />
    
- <InlineStat label value />
    
- <AttentionList items onAction />
    

---

## **3) Data fetching pattern (per screen)**

  

Use TanStack Query with **stable query keys** derived from filters.

  

Example:

- ['transactions', normalizedFilters]
    
- ['overviewTotals', dateRange, currency]
    
- ['project', projectId]
    
- ['projectTotals', projectId, dateRange, currency]
    

  

Normalization:

- ensure dateFrom/dateTo are ISO strings
    
- ensure undefined fields are stripped (so query keys don’t churn)
    

  

Memo boundaries:

- useMemo(() => normalizeFilters(filters), [filters])
    
- don’t recreate column defs every render: useMemo(columns, [])
    

---

# **4) Route-by-route component trees**

  

## **/**

##  **Overview**

```
OverviewPage
 ├─ OverviewHeader
 │   ├─ DateRangeControl
 │   └─ CurrencyTabs
 ├─ OverviewKpis (query: overview totals)
 ├─ AttentionPanel (query: overdue + due soon)
 └─ RecentActivityTable (query: last 10 tx)
```

### **OverviewPage state**

- filters: { dateFrom, dateTo, currencyTab } synced to URL
    

  

### **Queries**

- useOverviewTotals({dateFrom,dateTo,currency})
    
- useAttentionReceivables({dateFrom,dateTo,currency}) (overdue + next 7 days)
    
- useTransactions({dateFrom,dateTo,currency, limit:10, sort:'occurredAt:desc'})
    

  

Memo boundaries

- OverviewKpis memoizes formatted numbers, only rerenders when totals change.
    
- RecentActivityTable gets pre-shaped rows.
    

  

Actions

- “Mark paid” calls repo.markIncomePaid(txId) then invalidates:
    
    - overviewTotals
        
    - attentionReceivables
        
    - transactions
        
    

---

## **/transactions**

##  **Ledger**

```
TransactionsPage
 ├─ LedgerHeader
 │   ├─ DateRangeControl
 │   ├─ CurrencyTabs
 │   ├─ TypeSegment
 │   ├─ StatusSegment
 │   └─ SearchInput
 ├─ LedgerTable (query: transactions list)
 └─ LedgerFooter
     ├─ Pagination (optional MVP)
     └─ TotalsStrip (query: totals by currency/kind)
```

### **Ledger filters model**

```
{
  dateFrom, dateTo,
  currency?,            // undefined = all currencies
  kind?,                // undefined = all
  status?,              // includes 'overdue'
  search?,
  limit, offset,
  sort
}
```

### **Table columns (exact)**

1. Date (occurredAt)
    
2. Type (Income / Receivable / Expense)
    
3. Client
    
4. Project
    
5. Category
    
6. Amount (right aligned)
    
7. Status (Paid/Unpaid + due)
    
8. Note/Attachment indicator
    

  

Row click → opens TransactionDrawer with ?tx=<id>

  

Memo boundaries

- LedgerTable only re-renders when rows or columns change
    
- columns defined once with useMemo([])
    

---

## **/projects**

##  **Projects index**

```
ProjectsPage
 ├─ ProjectsHeader
 │   ├─ SearchInput
 │   ├─ FieldSelect
 │   └─ CurrencyTabs
 ├─ ProjectsTable (query: projects summary list)
 └─ EmptyState / CreateProjectCTA
```

### **Query shape**

  

Prefer one query that returns “summary rows”:

repo.listProjectSummaries({currency, search, field})

  

Columns

- Project
    
- Client
    
- Field
    
- Paid Income
    
- Unpaid
    
- Expenses
    
- Net
    
- Last activity
    

  

Row click → /projects/:id

---

## **/projects/:projectId**

##  **Project detail**

```
ProjectDetailPage
 ├─ ProjectTopBar
 │   ├─ Breadcrumbs (Projects / ProjectName)
 │   ├─ InlineStats (paid/unpaid/expenses)
 │   └─ AddMenuButton (prefill projectId)
 ├─ ProjectTabs
 │   ├─ SummaryTab
 │   │   ├─ KpiRow (query: project totals)
 │   │   └─ MonthBreakdownList (query: grouped by month)
 │   ├─ TransactionsTab
 │   │   ├─ FiltersRow (date/currency/status/search)
 │   │   └─ TransactionsTable (scoped query)
 │   └─ NotesTab (optional)
```

### **Queries**

- useProject(projectId) (name, clientId, field)
    
- useProjectTotals(projectId, dateRange, currency)
    
- useProjectMonthly(projectId, year, currency) (simple list)
    
- useTransactions({projectId,...filters})
    

  

Perf rule

- Tabs should mount lazily (only render active tab) to avoid running all queries.
    

---

## **/clients**

##  **Clients index**

```
ClientsPage
 ├─ ClientsHeader
 │   ├─ SearchInput
 │   └─ CurrencyTabs
 ├─ ClientsTable (query: client summary list)
 └─ EmptyState / CreateClientCTA
```

Columns

- Client
    
- Active projects
    
- Paid income
    
- Unpaid
    
- Last payment date
    
- Last activity
    

---

## **/clients/:clientId**

##  **Client detail**

```
ClientDetailPage
 ├─ ClientTopBar
 │   ├─ Breadcrumbs (Clients / ClientName)
 │   ├─ InlineStats
 │   └─ AddMenuButton (prefill clientId)
 ├─ ClientTabs
 │   ├─ SummaryTab (totals + tiny breakdown)
 │   ├─ ProjectsTab (query: projects for client)
 │   ├─ ReceivablesTab
 │   │   ├─ StatusSegment (Unpaid/Overdue/All)
 │   │   └─ ReceivablesTable (scoped query)
 │   └─ TransactionsTab (scoped ledger)
```

Receivables columns

- Due date
    
- Project
    
- Amount
    
- Days overdue
    
- Status
    
- Action: Mark paid
    

---

## **/reports**

##  **Reports**

```
ReportsPage
 ├─ ReportsLayout
 │   ├─ ReportsSidebar (preset list)
 │   └─ ReportPanel
 │       ├─ ReportHeader (title + controls)
 │       │   ├─ DateRangeControl (contextual)
 │       │   ├─ CurrencyTabs
 │       │   ├─ ConvertedToggle (disabled until FX set)
 │       │   └─ ExportButton (CSV)
 │       └─ ReportBody (varies by preset)
```

### **Preset components**

- ReportThisMonth
    
- ReportThisYear
    
- ReportByProject
    
- ReportByClient
    
- ReportExpensesByCategory
    
- ReportUnpaidAging
    

  

Each preset should use **one query** returning grouped rows.

  

Example:

repo.getReport({type:'expensesByCategory', dateFrom, dateTo, currency})

  

Export:

- Use same dataset as UI (no recomputation), generate CSV client-side.
    

---

## **/settings**

##  **Settings**

```
SettingsPage
 ├─ CurrencySettings (enabled currencies, default tab)
 ├─ FxSettings (manual rates list + add rate)
 └─ DataTools (export/import backup)
```

DataTools MVP actions

- Export JSON backup (all tables)
    
- Import JSON backup (with validation)
    
- Later: “Open backup folder” via Tauri
    

---

# **5) Drawers (exact structure + state)**

  

## **TransactionDrawer (Create/Edit)**

```
TransactionDrawer
 ├─ Header (mode + close)
 ├─ TypeSelector (Income / Receivable / Expense)
 ├─ FormBody
 │   ├─ AmountInput (amount + currency)
 │   ├─ DateInput (occurredAt)
 │   ├─ ClientCombobox (optional)
 │   ├─ ProjectCombobox (optional, filtered by client)
 │   ├─ CategorySelect
 │   ├─ (Receivable only) DueDate + Status
 │   ├─ Notes
 │   └─ (Later) Attachments
 └─ Footer
     ├─ Delete (edit only)
     ├─ Save
     └─ Save + Add Another (nice)
```

### **Drawer state rules**

- Open edit: ?tx=<id>
    
- Open create: ?newTx=income|expense|receivable&clientId=&projectId=
    
- On save:
    
    - upsert, invalidate relevant queries
        
    - close drawer by removing query param (router replace)
        
    

  

Perf + correctness:

- Use form library (React Hook Form) + schema validation.
    
- amountMinor computed safely from decimal input.
    

---

# **6) Minimal Design System Spec (desktop-first)**

  

## **Layout + spacing**

- Base unit: **8px**
    
- Page padding: **24px**
    
- Card padding: **16px**
    
- Table row height: **40px** (dense, readable)
    
- Header height: **56px**
    
- Sidebar width: **240px**
    

  

## **Typography (simple hierarchy)**

- Page title: 18–20px / semibold
    
- Section title: 14–16px / semibold
    
- Body: 13–14px / regular
    
- Muted/meta: 12px
    

  

## **Table density + alignment rules**

- Amounts always **right-aligned**
    
- Dates and statuses are compact
    
- “Type” uses small pill/badge, not huge labels
    
- Zebra striping optional; prefer subtle row hover
    

  

## **Color semantics (don’t over-design)**

- Paid income: positive tone
    
- Expenses: neutral/negative tone
    
- Unpaid: warning tone
    
- Overdue: stronger warning tone
    

  

But keep it minimal: most rows should look identical; semantics are hints, not a rainbow.

  

## **Interaction rules**

- Primary action always in top-right: + Add
    
- Row click opens drawer (fast edit)
    
- Esc closes drawer
    
- Cmd/Ctrl+K opens global search (later, but keep room)
    

  

## **Empty states**

  

Every index page needs:

- short explanation
    
- one CTA: “Create X”
    
    No illustrations needed.
    

---

# **7) Performance guardrails (so it stays snappy)**

- Pre-shape rows in a useMemo before passing to tables.
    
- Column defs in useMemo([]) with stable callbacks.
    
- Avoid re-render storms: keep filter state in one object + URL sync.
    
- For large ledgers later:
    
    - add pagination or virtualization (TanStack Virtual)
        
    - add “This month” as default hard cap
        
    
