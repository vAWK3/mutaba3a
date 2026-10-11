# COMPONENT_REGISTRY.md — Reusable Components

> **Purpose**: Document all reusable components to prevent duplication.
> **Rule**: Check this registry before creating any new component.

---

## Quick Lookup

| Category | Components |
|----------|------------|
| **Layout** | AppShell, SidebarNav, TopBar, PageHeader, FeatureNoticeBanner, ClientRetainersCard, ClientWorkSection, ClientPaymentsSection |
| **Drawers** | TransactionDrawer, ClientDrawer, ProjectDrawer, ExpenseDrawer, RetainerDrawer, DocumentDrawer, BusinessProfileDrawer, OrphanedRecordsDrawer |
| **Forms** | Input, Select, StepperInput, DatePicker, CurrencyInput, Textarea, Switch |
| **Buttons** | Button, IconButton, RowActionsMenu, RecordPaymentButton |
| **Table headers** | SortableHeader |
| **Display** | Card, Badge, StatusBadge, EmptyState |
| **Home** | HomeNeedsAttention, HomeRecentPayments (with OwedNowSummary) |
| **Tables** | DataTable, CellAmount, CellStatus, CellDate |
| **Filters** | DateRangeControl, SearchInput, StatusSegment, TypeSegment, CurrencyTabs |
| **Feedback** | Toast, Modal, ConfirmModal |
| **Money** | OwedNowSummary, UnifiedAmount, AmountWithConversion, CurrencySummaryPopup, FxRateBanner, CurrencyBadge |
| **Icons** | Custom SVG icons (see Icons section) |

---

## Layout Components

### AppShell
**Location**: `src/components/layout/AppShell.tsx`
**Purpose**: Root layout wrapper with sidebar, content area, and global overlays.

```tsx
<AppShell>
  <Outlet /> {/* Route content renders here */}
</AppShell>

// Structure:
// ├─ SidebarNav
// ├─ main (content area)
// │   └─ Outlet
// └─ GlobalOverlays
//     ├─ TransactionDrawerController
//     ├─ ClientDrawerController
//     └─ ProjectDrawerController
```

**Props**: None (uses context and routing)

---

### SidebarNav
**Location**: `src/components/layout/SidebarNav.tsx`
**Purpose**: Fixed left navigation with profile switcher.

```tsx
// Auto-rendered by AppShell
// Contains:
// - Profile/business switcher
// - Navigation links
// - Settings link (pinned bottom)
```

**Features**:
- Active state highlighting (prefix match, Home exact; one entry active per route, pinned by tests for every route)
- Keyboard navigation (links in DOM order; the New menu via `useMenuButton`)
- RTL support (logical rail and menu offsets; the collapse chevron points toward the collapsing edge)
- Collapsible to a 64px rail (choice kept in `localStorage.sidebarCollapsed`); toggles in normal flow; a hairline separates core from "More"
- **Shape (MUT-15, ADR-034):** `coreItems` (Home, Clients, Income) render first with no header and never depend on a flag; `optionalItems` render the "More" section with only the enabled areas, in the order Expenses, Documents, Retainers, Insights, Planning, Projects; `systemItems` (Settings) sit in the footer, never gated.
- New menu: actions and order from `visibleAddMenuActions(flags)`; `newMenuEntries` maps each to its label and icon.

---

### TopBar
**Location**: `src/components/layout/TopBar.tsx`
**Purpose**: Sticky header with title, breadcrumbs, and primary CTA.

```tsx
<TopBar
  title="Transactions"
  breadcrumbs={[{ label: 'Home', href: '/' }]}
  actions={<Button onClick={openDrawer}>+ Add</Button>}
/>
```

**Props**:
| Prop | Type | Description |
|------|------|-------------|
| `title` | string | Page title |
| `breadcrumbs?` | BreadcrumbItem[] | Navigation trail |
| `actions?` | ReactNode | Right-side action buttons |

The `+ Add` menu renders `visibleAddMenuActions(useFeatureFlags())` (Income, Client, then Expense/Project while on; MUT-15) with `useMenuButton` keyboard behaviour; `addMenuEntries` maps each action to its label and icon.

---

### addMenuActions
**Location**: `src/components/layout/addMenuActions.ts`
**Purpose**: The single list of `+ Add` actions, their area gates and their order, shared by the sidebar New menu and the top bar Add menu (MUT-15).

```ts
visibleAddMenuActions(flags); // ['income', 'client'] with every area off
```

Core actions first, optional appended, so a switch never moves a core entry. Each menu maps an `AddMenuAction` to its own label, icon and click behaviour. Tests: `layout/__tests__/addMenuActions.test.ts` (all 64 flag combinations keep Income, Client first).

---

### useMenuButton
**Location**: `src/hooks/useMenuButton.ts`
**Purpose**: A button that opens a menu of actions with WAI-ARIA menu-button keyboard behaviour (MUT-15).

```tsx
const menu = useMenuButton();
<button {...menu.buttonProps} type="button">Add</button>
{menu.isOpen && (
  <div {...menu.menuProps}>
    <button role="menuitem" tabIndex={-1} onClick={() => { menu.close(); run(); }}>Income</button>
  </div>
)}
```

Opening (click, ArrowDown, ArrowUp) focuses the first/last `[role="menuitem"]`; arrows wrap; Home/End jump; Escape closes and refocuses the button; Tab and a mousedown outside close. Used by `SidebarNav` and `TopBar`. `RowActionsMenu` still has its own listeners (TD-031). Tests: `hooks/__tests__/useMenuButton.test.tsx`.

---

### PageHeader
**Location**: `src/components/layout/PageHeader.tsx`
**Purpose**: Standardized page header with title and optional actions.

```tsx
<PageHeader
  title={t('transactions.title')}
  subtitle="Manage your income and expenses"
  action={<Button>+ Add</Button>}
/>
```

---

### FeatureNoticeBanner
**Location**: `src/components/layout/FeatureNoticeBanner.tsx`
**Purpose**: One-time, dismissible notice naming the optional areas that were switched on for the user's existing data (v20 upgrade, restore, import, demo, sync). Mounted once in `AppShell` above the page content; renders nothing when `Settings.featureNotice` is empty; clears the notice on dismiss (MUT-12, ADR-032).

```tsx
<FeatureNoticeBanner />   // no props; reads useFeatureNotice()
```

Tests: `src/components/layout/__tests__/FeatureNoticeBanner.test.tsx`.

---

### AdvancedFeaturesSection
**Location**: `src/pages/settings/AdvancedFeaturesSection.tsx`
**Purpose**: Settings › Advanced features — one `Switch` per `FEATURE_KEYS` entry, labels and descriptions from `settings.features.items.*`. Reads `useFeatureFlags()`, writes `useSetFeatureEnabled()`; never touches the settings row.

```tsx
<AdvancedFeaturesSection />   // rendered by SettingsPage between Currency and Data
```

Tests: `src/pages/settings/__tests__/AdvancedFeaturesSection.test.tsx`.

---

### DataToolsSection
**Location**: `src/pages/settings/DataToolsSection.tsx`
**Purpose**: Settings › Data Tools: integrity check (`runIntegrityCheck`), JSON backup export/import (`exportBackup` / `restoreFromBackup`) and the receipts ZIP. Every message comes from `integrity.*` or `settings.*`. The check's result is kept as numbers (`{ total, issues }`) and worded at render, so it follows a language switch.

```tsx
<DataToolsSection />   // rendered by SettingsPage below the main settings
```

Tests: `src/pages/settings/__tests__/DataToolsSection.test.tsx`.

---

### ClientRetainersCard
**Location**: `src/components/clients/ClientRetainersCard.tsx`
**Purpose**: Retainer status for one client, below Payments on the client profile (MUT-13; the Summary tab it first lived in is gone with MUT-3): list of the client's retainers (status badge, next expected date, due now) with **New retainer** (`openRetainerDrawer({ mode: 'create', defaultClientId })`) and **View all** (`/retainers?clientId=`). The page renders it only while `useFeatureEnabled('retainers')` is true.

```tsx
{retainersEnabled && <ClientRetainersCard clientId={client.id} />}
```

Tests: `src/pages/clients/__tests__/ClientDetailPage.test.tsx` ("Advanced-feature entry points").

---

### ClientWorkSection
**Location**: `src/components/clients/ClientWorkSection.tsx`
**Purpose**: "What have I worked on for this client?" on the client profile (MUT-3): the client's income entries as one table — date, title with project tag, amount, status with due/overdue line, remaining balance on partial rows — with its own filter row (date range, status, search held as one object) and the row actions (Record payment via `RecordPaymentButton`, Mark paid, invoice actions while Invoices is on, duplicate). No work at all → `EmptyState` with one action, Add income, prefilled with the client; filters that hide every row → "No entries match" + Clear filters. Rows are shaped by `toWorkRow` (`clientProfileRows.ts`) in a `useMemo`.

```tsx
<ClientWorkSection clientId={clientId} />
```

Tests: `src/pages/clients/__tests__/ClientDetailPage.test.tsx` ("Work and billing"), `src/components/clients/__tests__/clientProfileRows.test.ts`.

---

### ClientPaymentsSection
**Location**: `src/components/clients/ClientPaymentsSection.tsx`
**Purpose**: "When did they pay, and for what?" on the client profile (MUT-3, the MUT-4 UI): `usePaymentsByClient(clientId)` unfiltered, newest first — date, amount, the entry it paid for, notes. A `record` row opens `editPaymentRecord` (the payment drawer's edit mode, which also deletes); an `entry` row (money saved on the income entry itself, ADR-033) opens the income drawer and reads "Recorded on the entry". Never totals across currencies.

```tsx
<ClientPaymentsSection clientId={clientId} />
```

Tests: `src/pages/clients/__tests__/ClientDetailPage.test.tsx` ("Payments").

---

### OnboardingOverlay
**Location**: `src/components/onboarding/OnboardingOverlay.tsx`
**Purpose**: First-run guided flow over `onboardingStore` (client → project → income). While the Projects area is off (MUT-16) an effect completes the project step with no entity, so the flow is client → income; the store's order and completion rule are unchanged. The effect waits for `useFeaturesLoaded()` so a loading settings row is not read as "off". The drawers advance the step by calling `completeStep` on the store directly.

```tsx
<OnboardingOverlay onComplete={() => setShowOnboarding(false)} />
```

Tests: `src/components/onboarding/__tests__/OnboardingOverlay.projects.test.tsx`.

---

## Drawer Components

### Base Drawer Pattern
All drawers follow this structure:

```tsx
interface DrawerProps {
  open: boolean;
  onClose: () => void;
  // Entity-specific props
}

// Usage via controller (URL-driven)
<TransactionDrawerController />

// Or direct (programmatic)
<TransactionDrawer
  open={isOpen}
  onClose={handleClose}
  transactionId={id}
/>
```

---

### TransactionDrawer
**Location**: `src/components/drawers/TransactionDrawer.tsx`
**Purpose**: Create/edit transactions (income/expense).

```tsx
// Via URL
navigate({ search: { tx: transactionId } });        // Edit
navigate({ search: { newTx: 'income' } });          // Create

// Via controller
<TransactionDrawerController />
```

**Features**:
- Form validation (Zod)
- Client/Project typeahead
- Currency selection
- Due date for unpaid income
- Linked document reference

---

### ClientDrawer
**Location**: `src/components/drawers/ClientDrawer.tsx`
**Purpose**: Create/edit clients.

```tsx
navigate({ search: { client: clientId } });         // Edit
navigate({ search: { newClient: true } });          // Create
```

---

### ProjectDrawer
**Location**: `src/components/drawers/ProjectDrawer.tsx`
**Purpose**: Create/edit projects.

```tsx
navigate({ search: { project: projectId } });       // Edit
navigate({ search: { newProject: true, clientId } }); // Create
```

---

### ExpenseDrawer
**Location**: `src/components/drawers/ExpenseDrawer.tsx`
**Purpose**: Create/edit expenses (profile-scoped).

**Features**:
- Vendor typeahead with normalization
- Category selection
- Receipt attachment
- Recurring rule linking

---

### RetainerDrawer
**Location**: `src/components/drawers/RetainerDrawer.tsx`
**Purpose**: Create/edit retainer agreements.

**Features**:
- Monthly/quarterly cadence
- Payment day selection
- Start/end date
- Client/project linking

---

### RetainerMatchingDrawer
**Location**: `src/components/drawers/RetainerMatchingDrawer.tsx`
**Purpose**: Match transactions to projected income from retainers.

**Features**:
- Smart matching suggestions
- Score breakdown display
- Partial match support

---

### DocumentDrawer
**Location**: `src/components/drawers/DocumentDrawer.tsx`
**Purpose**: Quick view/actions for documents.

**Note**: Full document editing is in `/documents/:id/edit` page.

---

### BusinessProfileDrawer
**Location**: `src/components/drawers/BusinessProfileDrawer.tsx`
**Purpose**: Create/edit business profiles.

**Features**:
- Logo upload (base64)
- Tax settings
- Bank details
- Default currency/language

---

### OrphanedRecordsDrawer
**Location**: `src/components/drawers/OrphanedRecordsDrawer.tsx`
**Purpose**: Lists every record without a business profile (the ones `OrphanedRecordsBanner` counts) grouped Clients / Projects / Income / Expenses, and assigns them. One profile: no pickers, one "Assign all to ‹profile›" action. Several: "Assign all to ‹default›" plus a picker per row and Save. Each row starts on its linked client's profile, then its project's, then the default (`startingProfileId`). A row that fails (TD-035) stays listed with an inline message. Replaced `OrphanedRecordsModal` (deleted 2026-10-11).

```tsx
// Opened from the banner's "Review now"; mounted by AppShell
useDrawerStore.getState().openOrphanedRecordsDrawer();
{orphanedRecordsDrawer.isOpen && <OrphanedRecordsDrawer />}
```

Data: `useOrphanedRecords()` → `findOrphanedRecords()` and `useAssignOrphanedRecords()` (`src/hooks/useOrphanedRecords.ts`); "unassigned" is defined once by `isOrphaned` in `src/db/orphanedRecords.ts`, which `runIntegrityCheck` also uses.

Tests: `src/components/drawers/__tests__/OrphanedRecordsDrawer.test.tsx`, `src/db/__tests__/orphanedRecords.test.ts`.

---

## Form Components

### Input
**Location**: `src/components/ui/Input.tsx`
**Purpose**: Text input with label, error state, and icon support.

```tsx
<Input
  label="Email"
  type="email"
  placeholder="name@example.com"
  error={errors.email?.message}
  icon={<MailIcon />}
  {...register('email')}
/>
```

**Props**:
| Prop | Type | Description |
|------|------|-------------|
| `label?` | string | Input label |
| `error?` | string | Error message |
| `icon?` | ReactNode | Leading icon |
| `...rest` | InputHTMLAttributes | Standard input props |

---

### Select
**Location**: `src/components/ui/Select.tsx`
**Purpose**: Dropdown select with consistent styling.

```tsx
<Select
  label="Currency"
  options={[
    { value: 'USD', label: 'US Dollar' },
    { value: 'ILS', label: 'Israeli Shekel' },
  ]}
  {...register('currency')}
/>
```

---

### StepperInput
**Location**: `src/components/ui/StepperInput.tsx`
**Purpose**: Numeric input with increment/decrement buttons.

```tsx
<StepperInput
  label="Quantity"
  min={1}
  max={100}
  step={1}
  value={quantity}
  onChange={setQuantity}
/>
```

---

### DatePicker
**Location**: `src/components/ui/DatePicker.tsx`
**Purpose**: Date input with native picker.

```tsx
<DatePicker
  label="Due Date"
  value={dueDate}
  onChange={setDueDate}
  minDate={today}
/>
```

---

### CurrencyInput
**Location**: `src/components/ui/CurrencyInput.tsx`
**Purpose**: Amount input with currency display.

```tsx
<CurrencyInput
  label="Amount"
  currency="USD"
  value={amountMinor}
  onChange={setAmountMinor}
/>
```

**Behavior**: Displays as decimal ($19.99), stores as minor (1999).

---

### Textarea
**Location**: `src/components/ui/Textarea.tsx`
**Purpose**: Multi-line text input.

```tsx
<Textarea
  label="Notes"
  rows={3}
  placeholder="Additional notes..."
  {...register('notes')}
/>
```

---

### Switch
**Location**: `src/components/ui/Switch.tsx` (+ `Switch.css`)
**Purpose**: On/off control. `<button role="switch" aria-checked>`; toggles on click, Space and Enter; `disabled` sets `aria-disabled`; the knob travels in the reading direction (logical properties, mirrored in RTL); focus ring via `--focus-ring`.

```tsx
<span id="lbl">Expenses</span>
<Switch checked={on} onChange={setOn} labelledBy="lbl" />
<Switch checked={on} onChange={setOn} ariaLabel="Dark mode" disabled />
```

Props: `checked`, `onChange(next)`, `labelledBy?`, `ariaLabel?`, `disabled?`, `id?`, `className?`.
Tests: `src/components/ui/__tests__/Switch.test.tsx`. First consumer: `AdvancedFeaturesSection` (MUT-12).

---

## Button Components

### Button
**Location**: `src/components/ui/Button.tsx`
**Purpose**: Primary action button.

```tsx
<Button variant="primary" size="md" onClick={handleClick}>
  Save
</Button>

<Button variant="secondary" disabled={isLoading}>
  Cancel
</Button>

<Button variant="danger" isLoading>
  Delete
</Button>
```

**Props**:
| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `variant` | 'primary' \| 'secondary' \| 'danger' \| 'ghost' | 'primary' | Button style |
| `size` | 'sm' \| 'md' \| 'lg' | 'md' | Button size |
| `isLoading?` | boolean | false | Show spinner |
| `disabled?` | boolean | false | Disable button |
| `icon?` | ReactNode | - | Leading icon |

---

### IconButton
**Location**: `src/components/ui/IconButton.tsx`
**Purpose**: Icon-only button (e.g., close, menu).

```tsx
<IconButton
  icon={<CloseIcon />}
  label="Close"
  onClick={onClose}
/>
```

---

### RowActionsMenu
**Location**: `src/components/ui/RowActionsMenu.tsx`
**Purpose**: Three-dot menu for table row actions.

```tsx
<RowActionsMenu
  items={[
    { label: 'Edit', onClick: handleEdit },
    { label: 'Delete', onClick: handleDelete, danger: true },
  ]}
/>
```

---

### RecordPaymentButton
**Location**: `src/components/ui/RecordPaymentButton.tsx`
**Purpose**: The primary row affordance for recording a payment against a
receivable, with the remaining balance shown on the button. Owns the single
gate deciding where that affordance appears, so the surfaces cannot drift
(before MUT-6 the same concept had three different inline conditions across
four call sites, and one surface had none).

**Gate**: renders `null` unless `kind === 'income' && paymentStatus !== 'paid'
&& (remainingAmountMinor ?? 0) > 0`. A `lockedAt` transaction is deliberately
**not** excluded -- paying an invoice is the normal flow (ADR-030).

**Props-in, no store import**, like the rest of `components/ui`: the caller
passes `onRecordPayment` using the drawer hook it already holds. The click
calls `stopPropagation`, so it is never mistaken for a row click.

Place it inside the existing row actions cell (`.row-actions-cell`), never in a
new column, so it cannot push the amount column off-screen.

```tsx
<td>
  <div className="row-actions-cell">
    <RecordPaymentButton
      transaction={tx}
      onRecordPayment={() => openPartialPaymentDrawer({ transactionId: tx.id })}
    />
    <RowActionsMenu actions={[...]} />
  </div>
</td>
```

**Used by**: ClientWorkSection (client profile work list, MUT-3), IncomePage,
ProjectDetailPage.
**Tests**: `src/components/ui/__tests__/RecordPaymentButton.test.tsx`

---

### SortableHeader
**Location**: `src/components/ui/SortableHeader.tsx` (+ `.css`)
**Purpose**: A `<th>` whose label is a button that sorts its column (MUT-7). It sets `aria-sort` (`ascending` / `descending` / `none`) and shows an arrow on the active column. It optionally aligns to the end edge for numeric columns, and its `title` can explain the ordering. Props-in: the caller owns the state (usually `useSortState`) and decides what a click does. The clients index toggles the active column, or switches to the clicked one in its natural direction.

```tsx
<SortableHeader field="owed" label={t('clients.columns.owedNow')} align="end"
  title={t('clients.index.owedOrderHint')}
  sortField={sortField} sortDir={sortDir} onSort={handleSort} />
```

**Used by**: ClientsPage. ProjectsPage still uses a sort dropdown and can adopt this.
**Tests**: `src/components/ui/__tests__/SortableHeader.test.tsx`

---

## Display Components

### Card
**Location**: `src/components/ui/Card.tsx`
**Purpose**: Container with consistent padding and styling.

```tsx
<Card>
  <Card.Header>
    <h3>Title</h3>
  </Card.Header>
  <Card.Body>
    Content here
  </Card.Body>
  <Card.Footer>
    Actions
  </Card.Footer>
</Card>
```

---

### Badge
**Location**: `src/components/ui/Badge.tsx`
**Purpose**: Small label for categorization.

```tsx
<Badge variant="success">Paid</Badge>
<Badge variant="warning">Pending</Badge>
<Badge variant="danger">Overdue</Badge>
<Badge variant="info">Draft</Badge>
```

---

### StatusBadge
**Location**: `src/components/ui/StatusBadge.tsx`
**Purpose**: Transaction/document status indicator.

```tsx
<StatusBadge status="paid" />      // Green "Paid"
<StatusBadge status="unpaid" />    // Yellow "Unpaid"
<StatusBadge status="overdue" />   // Red "Overdue"
```

---

### EmptyState
**Location**: `src/components/ui/EmptyState.tsx`
**Purpose**: Placeholder for empty lists.

```tsx
<EmptyState
  icon={<InboxIcon />}
  title="No transactions yet"
  description="Create your first transaction to get started."
  action={<Button onClick={openDrawer}>+ Add Transaction</Button>}
/>
```

---

## Home Components

Home is three blocks since MUT-8 (ADR-036): `OwedNowSummary` (Money Components) over every receivable, then these two sections in `.home-two-column`. The old `PredictiveKpiStrip`, `AttentionFeed`, `MonthActualsRow`, `KpiCard`/`KpiStrip` were deleted by decision. `QuickSummaries` never existed in this tree. A guard test (`src/__tests__/noDeadHomeModules.test.ts`) keeps them gone.

### HomeNeedsAttention
**Location**: `src/components/home/HomeNeedsAttention.tsx`
**Purpose**: "Who is late?" (MUT-8). It renders `useAttentionReceivables(undefined, profileId)` as is: overdue or due within 7 days (inclusive), every currency, oldest due date first, ties by client name then id. Each row shows the client (or "No client"), what it was for, the remaining amount in its own currency, and "Nd overdue", "Due in Nd" or "Due today". Rows are shaped with `toWorkRow`, so bucketing uses the ADR-010/022 helpers. A row opens the client profile, or the entry's income drawer when there is no client. The empty state reads "No overdue or upcoming receivables".

```tsx
<HomeNeedsAttention profileId={profileId} />
```

### HomeRecentPayments
**Location**: `src/components/home/HomeRecentPayments.tsx`
**Purpose**: "What came in?" (MUT-8). It renders `useRecentPayments(profileId)`, the last 10 payments across clients from `paymentRecordRepo.listRecent`. These are the same payment rows as a client's Payments section (ADR-033), so they include income saved as Received. Each row shows the client, what it was for, the date and the amount in its own currency; nothing is totalled. A row opens the client profile, or the entry when there is no client.

```tsx
<HomeRecentPayments profileId={profileId} />
```

Tests: `src/pages/overview/__tests__/OverviewPage.test.tsx`; data in `transactionRepo.test.ts` ("as Home's Needs attention") and `paymentRecords.test.ts` (`listRecent`).

---

### InfoIcon
**Location**: `src/components/icons/InfoIcon.tsx` (or inline in Home components)
**Purpose**: Information tooltip trigger icon.

```tsx
<InfoIcon />
// Renders: (i) info circle icon
```

**Usage**: Typically paired with tooltips to explain projected values or data sources.

---

## Table Components

> **Correction (2026-10-11, found during MUT-36).** `DataTable` and
> `CellAmount` below describe files that do not exist —
> `src/components/tables/` is absent. Tables are page-local `<table>` markup
> styled by `src/components/ui/Table.css`. Before building a table, read an
> existing page (`ClientsPage`, `OverviewPage`) instead of these entries. The
> hosted portal (MUT-43) adds a `DecimalAmount` and a small table wrapper and
> registers them when built.

### DataTable
**Location**: `src/components/tables/DataTable.tsx`
**Purpose**: Generic data table with sorting and row click.

```tsx
<DataTable
  columns={[
    { key: 'name', header: 'Name', sortable: true },
    { key: 'amount', header: 'Amount', render: CellAmount },
    { key: 'status', header: 'Status', render: CellStatus },
  ]}
  rows={transactions}
  rowKey="id"
  onRowClick={(row) => openDrawer(row.id)}
  emptyState={<EmptyState ... />}
/>
```

**Props**:
| Prop | Type | Description |
|------|------|-------------|
| `columns` | ColumnDef[] | Column definitions |
| `rows` | T[] | Data array |
| `rowKey` | keyof T | Unique row identifier |
| `onRowClick?` | (row: T) => void | Row click handler |
| `emptyState?` | ReactNode | Empty state component |

---

### CellAmount
**Location**: `src/components/tables/CellAmount.tsx`
**Purpose**: Formatted currency cell.

```tsx
<CellAmount amountMinor={1999} currency="USD" />
// Renders: $19.99
```

---

### CellStatus
**Location**: `src/components/tables/CellStatus.tsx`
**Purpose**: Status with due date indicator.

```tsx
<CellStatus
  status="unpaid"
  dueDate="2024-01-15"
  paidAt={null}
/>
// Renders: "Unpaid" badge + "Due Jan 15" or "3 days overdue"
```

---

### CellDate
**Location**: `src/components/tables/CellDate.tsx`
**Purpose**: Formatted date cell.

```tsx
<CellDate date="2024-01-15" format="short" />
// Renders: Jan 15, 2024
```

---

## Filter Components

### DateRangeControl
**Location**: `src/components/filters/DateRangeControl.tsx`
**Purpose**: Date range picker with presets.

```tsx
<DateRangeControl
  value={{ from: dateFrom, to: dateTo }}
  onChange={({ from, to }) => setFilters({ dateFrom: from, dateTo: to })}
  presets={['this-month', 'last-month', 'this-year', 'custom']}
/>
```

**Presets**:
- `this-month`: Current calendar month
- `last-month`: Previous calendar month
- `this-year`: Jan 1 to Dec 31 current year
- `custom`: Manual date selection

---

### SearchInput
**Location**: `src/components/filters/SearchInput.tsx`
**Purpose**: Debounced search input.

```tsx
<SearchInput
  value={search}
  onChange={setSearch}
  placeholder="Search clients, projects..."
  debounceMs={200}
/>
```

---

### StatusSegment
**Location**: `src/components/filters/StatusSegment.tsx`
**Purpose**: Status filter segment control.

```tsx
<StatusSegment
  value={status}
  onChange={setStatus}
  options={['all', 'paid', 'unpaid', 'overdue']}
/>
```

---

### TypeSegment
**Location**: `src/components/filters/TypeSegment.tsx`
**Purpose**: Transaction type filter.

```tsx
<TypeSegment
  value={kind}
  onChange={setKind}
  options={['all', 'income', 'expense']}
/>
```

---

### CurrencyTabs
**Location**: `src/components/filters/CurrencyTabs.tsx`
**Purpose**: Currency selection tabs.

```tsx
<CurrencyTabs
  value={currency}
  onChange={setCurrency}
  currencies={['USD', 'ILS', 'EUR']}
  showAll={true}
/>
```

---

## Feedback Components

### Toast
**Location**: `src/components/ui/Toast.tsx`
**Store**: `src/lib/toastStore.ts`
**Purpose**: Non-blocking notifications.

```tsx
// Usage via store
import { toast } from '@/lib/toastStore';

toast.success('Transaction saved');
toast.error('Failed to delete');
toast.info('Syncing...');

// Rendered globally in AppShell
<ToastContainer />
```

---

### Modal
**Location**: `src/components/modals/Modal.tsx`
**Purpose**: Generic modal dialog.

```tsx
<Modal
  open={isOpen}
  onClose={handleClose}
  title="Confirm Action"
>
  <p>Are you sure?</p>
  <Button onClick={handleConfirm}>Confirm</Button>
</Modal>
```

---

### ConfirmModal
**Location**: `src/components/modals/ConfirmModal.tsx`
**Purpose**: Confirmation dialog with standard layout.

```tsx
<ConfirmModal
  open={isOpen}
  onClose={handleClose}
  onConfirm={handleDelete}
  title="Delete Transaction"
  description="This action cannot be undone."
  confirmLabel="Delete"
  variant="danger"
/>
```

---

## Money Components

### OwedNowSummary
**Location**: `src/components/clients/OwedNowSummary.tsx`
**Purpose**: Owed Now as the dominant figure (MUT-3): one large amount per currency — never converted, never combined — with the overdue part beneath it ("$500 overdue" in the error colour, or "Nothing overdue"), and "Nothing owed" when the list is empty. Presentational: compute the input with `summarizeOwedByCurrency(transactions, today)` (`src/db/aggregations.ts`, ADR-033) so every screen that shows Owed Now agrees. Amounts are `<bdi dir="ltr">`; the amount inside the translated overdue sentence is wrapped in U+2066/U+2069.

```tsx
const owed = useMemo(() => summarizeOwedByCurrency(receivables, today), [receivables, today]);
<OwedNowSummary owed={owed} />
```

**Use when**: showing what is owed now. Used by the client profile and, as the clients index strip (MUT-7), over `combineOwed(summaries.map((s) => s.owed))`. Home (MUT-8) uses it over every receivable in the active profile. Not for period totals (paid income, expenses): those are not "now" figures.
**Not**: `CurrencySummaryPopup`, `UnifiedAmount` or `KpiCard`, which all convert to ILS.
Tests: `src/components/clients/__tests__/OwedNowSummary.test.tsx`; the helper in `src/db/__tests__/aggregations.test.ts`.

---

### UnifiedAmount
**Location**: `src/components/ui/UnifiedAmount.tsx`
**Purpose**: Display multi-currency totals (USD + ILS + EUR) as unified ILS amount with breakdown.

```tsx
<UnifiedAmount
  usdAmountMinor={1999}
  ilsAmountMinor={5000}
  eurAmountMinor={1500}
  variant="kpi"  // 'default' | 'compact' | 'kpi' | 'table'
  type="income"  // 'income' | 'expense' | 'net' | 'neutral'
/>
// KPI variant: ₪95.50 with breakdown "USD: $19.99 + ILS: ₪50.00 + EUR: €15.00"
// Table variant: ₪95.50 with hover tooltip showing breakdown
```

**Use when**: Displaying aggregated totals from multiple currencies (summaries, KPIs).

---

### AmountWithConversion
**Location**: `src/components/ui/AmountWithConversion.tsx`
**Purpose**: Display single-currency amount with hover tooltip showing ILS conversion.

```tsx
<AmountWithConversion
  amountMinor={1999}
  currency="USD"
  type="income"
  showExpenseSign={false}
/>
// Renders: $19.99 with hover tooltip "≈ ₪73.50 ($1 = 3.67 ₪, Live)"
```

**Use when**: Displaying individual transaction amounts in tables/lists.

---

### CurrencySummaryPopup
**Location**: `src/components/ui/CurrencySummaryPopup.tsx`
**Purpose**: Display unified ILS amount with click-to-expand currency breakdown popup.

```tsx
<CurrencySummaryPopup
  usdAmountMinor={1999}
  ilsAmountMinor={5000}
  eurAmountMinor={1500}
  type="income"
/>
// Renders: ₪95.50 with info icon; click shows dropdown with per-currency amounts + FX rates
```

**Use when**: Summary statistics in page headers or table cells where space is limited.

---

### FxRateBanner
**Location**: `src/components/money/FxRateBanner.tsx`
**Purpose**: Display FX rate used for conversions.

```tsx
<FxRateBanner
  baseCurrency="USD"
  quoteCurrency="ILS"
  rate={3.67}
  effectiveDate="2024-01-15"
/>
// Renders: "1 USD = 3.67 ILS (as of Jan 15)"
```

---

### CurrencyBadge
**Location**: `src/components/money/CurrencyBadge.tsx`
**Purpose**: Small currency indicator.

```tsx
<CurrencyBadge currency="USD" />
// Renders: "$" badge
```

---

## Icon Components

**Location**: `src/components/icons/`

All icons are custom SVG components for consistency:

```tsx
import {
  PlusIcon,
  EditIcon,
  TrashIcon,
  SearchIcon,
  FilterIcon,
  DownloadIcon,
  UploadIcon,
  CheckIcon,
  CloseIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CalendarIcon,
  DollarIcon,
  UserIcon,
  FolderIcon,
  DocumentIcon,
  SettingsIcon,
  SyncIcon,
} from '@/components/icons';
```

**Usage**:
```tsx
<Button icon={<PlusIcon />}>Add</Button>
<IconButton icon={<CloseIcon />} label="Close" />
```

---

## Component Ownership

| Component | Owner | Last Updated |
|-----------|-------|--------------|
| AppShell | Core | 2024-03 |
| TransactionDrawer | Transactions | 2024-06 |
| DataTable | Core | 2024-04 |
| All filters | Core | 2024-05 |
| Document components | Documents | 2024-08 |
| Expense components | Expenses | 2024-09 |
| Retainer components | Retainers | 2024-10 |
| Home components | Home | 2026-03 |
| PredictiveKpiStrip | Home | 2026-03 |
| AttentionFeed | Home | 2026-03 |
| MonthActualsRow | Home | 2026-03 |

---

## Creating New Components

Before creating a new component:

1. **Check this registry** for existing similar components
2. **Check `src/components/`** directory structure
3. If 70%+ overlap with existing component, **extend it** instead
4. If new, **document it here** with:
   - Location
   - Purpose
   - Props
   - Usage example

---

## Hosted API modules (`server/src`) — reusable across milestones

| Module | Purpose | Reuse |
|---|---|---|
| `pagination.ts` | keyset cursor encode/decode, limit parsing, in-memory comparators | every list route and store |
| `if-match.ts` | `ifMatch()` middleware → `c.get('expectedVersion')` | every PATCH on a versioned record |
| `routes/shared.ts` | `errorResponses`, `conflictResponse`, `validationResponse`, `notFoundResponse`, `IdempotencyHeaderSchema`, `requireConnectedIntegration`, `toPageRequest`, `encodeNextCursor`, `referencesByEntity`, `versionMismatch` | all `/v1` routes |
| `import/plan.ts`, `import/preview-token.ts` | pure batch planner + preview proof | M2 import; template for M3 previews |
| `idempotency.ts`, `auth/middleware.ts` (`requireScope`) | M1 | every write / every route |
| `smoke.ts` | post-deploy checks over injected fetch | `deploy.sh`, CI |
| `dates.ts`, `vat.ts`, `preview-token.ts` | organization-timezone calendar math and payment terms; VAT math; generic preview proof | every financial route (M3+) |
| `agreements/schedule.ts`, `agreements/supplement.ts`, `agreements/status.ts`, `agreements/compose.ts`, `agreements/posting.ts`, `agreements/create.ts` | installment split; supplement distribution; item status; context/rate/treatment resolution; lazy posting (incl. healing unposted IMMEDIATE, M8); `composePreview` + `createAgreementFromPreview` + `agreementDetail` (M8: one creation path for the agreement route and the fee-proposal approve route) | agreements, installments, retainers, receivables, fee-proposals routes; M4 payments read statuses (now credit-aware) and posting |
| `retainers/schedule.ts` | chargeable months with end/cancel rules | retainers routes, reconcile |
| `payments/allocate.ts`, `payments/credit.ts`, `payments/numbering.ts`, `payments/preview-token.ts` | allocation validation + strategies + resulting balances; credit VAT split; payment numbers; balance-covering preview token | payments, receivables (credits) routes; M6 summaries will reuse `outstandingOf` and the balance shapes |
| `routes/operations.ts` | `GET /v1/operations/{key}` over `idempotency.get` | any client reconciling a lost response |
| `auth/users.ts` (MUT-37) | `normalizeEmail` (trim + NFKC + lower-case), `generateOneTimePassword` (24 base64url chars), `PasswordHasher` port + `createArgon2Hasher`, `ARGON2_MINIMUMS` (OWASP profile 1, enforced by `config.ts`) | admin user routes; MUT-38 sign-in verifies with the same hasher and normalises emails the same way |
| `routes/admin-users.ts` (MUT-37) | operator user/membership routes; `audit()` appends one ADMIN event per member organization | the only way to create or change a portal user |
| `auth/sessions.ts` (MUT-38) | `generateSessionToken`, `sessionDigest` (HMAC under the pepper), `sessionCookieName`, `clientIp` (trusted-hop X-Forwarded-For), `isSameOriginRequest` (CSRF rule), `SignInThrottle` + `SIGN_IN_POLICY` | sign-in route, `authenticate()` |
| `auth/writability.ts` (MUT-38) | `WRITABILITY_MATRIX` (brief §5 as a const), `sessionScopes()`, `sessionAccess()` | session effective scopes, `GET /v1/me`; MUT-39 adds READ_ONLY_PROFILE + the store guard on the same rows |
| `auth/middleware.ts` (MUT-38 rewrite) | `authenticate()` (one principal per request, enforces each route's OpenAPI `security`), `buildRouteAccessIndex`, `requireScope` (either principal), `keyAuth(c)` for key-only handlers, `postingActorOf(c)` for lazy posting, `AuthContext = ApiKeyAuth \| SessionAuth`, `c.get('identity')` | every /v1 route |
| `routes/sessions.ts` (MUT-38) | `POST /v1/sessions`, `DELETE /v1/sessions/current`, `GET /v1/me`; `ORGANIZATION_INDEPENDENT_ROUTES` | the portal (MUT-43) |
| `scripts/users.ts` (MUT-37) | `runUsersCommand(argv, { fetch, url, token, out, err })` behind `npm run provision:user` / `grant:user` / `revoke:user` / `rotate:password` / `disable:user` / `enable:user` | operator CLIs; tested against `app.request` as the fetch |

---

## Data access (`src/db`) — the seam every consumer goes through

### getRepositories() — `src/db/provider.ts`

**What**: The single entry point to the data layer. Returns a frozen
`{ base, synced }` registry covering 21 repositories plus 8 op-capturing
decorators. Re-exported from the `src/db` barrel.

**Use it when**: you need to read or write any entity from a hook, service or
component. Do not import a repository singleton — that bypasses the seam and
cannot be swapped or mocked consistently.

```ts
import { getRepositories } from '../db';

// Resolve inside the callback, not at module scope.
queryFn: () => getRepositories().base.transactions.list(filters)
mutationFn: (id: string) => getRepositories().synced.transactions.markPaid(id)
```

**base vs synced**: `base` is the plain Dexie repository. `synced` additionally
captures an operation in the sync op-log. Keep whichever family a call site
already used — moving a call between them changes what syncs between devices.

**Swapping**: `setRepositories(next)` for tests and future hosted sources,
`resetRepositories()` in teardown. `setRepositories` throws in production
builds. Caveat: `synced.*` does not follow a swap — see TD-013
(`gstack-shortcut(dec-5f2c2123)`).

**Conformance**: `satisfies` in `provider.ts` ties every repository to its
interface in `src/db/interfaces.ts`. Rename or delete a repository method and
`npm run typecheck` fails there.

**Tests**: `src/db/__tests__/provider.test.ts`. To fake the data layer, mock
`'../../db'` and return `getRepositories` — the barrel is the single
interception point.

**Not covered**: `planRepo`, `planAssumptionRepo`, `planScenarioRepo`,
`scheduleGenerator`, `retainerMatching`, and `moneyEventRepo`. `engagementRepo`
is gone with the module (MUT-10); `moneyEventRepo` survived MUT-11 because the
Overview page depends on it, and remains outside the seam. See TODOS.md item 2.
