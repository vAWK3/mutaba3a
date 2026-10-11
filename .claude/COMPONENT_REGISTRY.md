# COMPONENT_REGISTRY.md — Reusable Components

> **Purpose**: Document all reusable components to prevent duplication.
> **Rule**: Check this registry before creating any new component.

---

## Quick Lookup

| Category | Components |
|----------|------------|
| **Layout** | AppShell, SidebarNav, TopBar, PageHeader, FeatureNoticeBanner, ClientRetainersCard |
| **Drawers** | TransactionDrawer, ClientDrawer, ProjectDrawer, ExpenseDrawer, RetainerDrawer, DocumentDrawer, BusinessProfileDrawer |
| **Forms** | Input, Select, StepperInput, DatePicker, CurrencyInput, Textarea, Switch |
| **Buttons** | Button, IconButton, RowActionsMenu, RecordPaymentButton |
| **Display** | Card, Badge, StatusBadge, EmptyState, KPICard |
| **Home** | PredictiveKpiStrip, AttentionFeed, MonthActualsRow, KpiStrip, QuickSummaries |
| **Tables** | DataTable, CellAmount, CellStatus, CellDate |
| **Filters** | DateRangeControl, SearchInput, StatusSegment, TypeSegment, CurrencyTabs |
| **Feedback** | Toast, Modal, ConfirmModal |
| **Money** | UnifiedAmount, AmountWithConversion, CurrencySummaryPopup, FxRateBanner, CurrencyBadge |
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
- **Shape (MUT-15, ADR-033):** `coreItems` (Home, Clients, Income) render first with no header and never depend on a flag; `optionalItems` render the "More" section with only the enabled areas, in the order Expenses, Documents, Retainers, Insights, Planning, Projects; `systemItems` (Settings) sit in the footer, never gated.
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

Opening (click, ArrowDown, ArrowUp) focuses the first/last `[role="menuitem"]`; arrows wrap; Home/End jump; Escape closes and refocuses the button; Tab and a mousedown outside close. Used by `SidebarNav` and `TopBar`. `RowActionsMenu` still has its own listeners (TD-029). Tests: `hooks/__tests__/useMenuButton.test.tsx`.

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

### ClientRetainersCard
**Location**: `src/components/clients/ClientRetainersCard.tsx`
**Purpose**: Retainer status for one client on the client profile's Summary tab (MUT-13): list of the client's retainers (status badge, next expected date, due now) with **New retainer** (`openRetainerDrawer({ mode: 'create', defaultClientId })`) and **View all** (`/retainers?clientId=`). The page renders it only while `useFeatureEnabled('retainers')` is true.

```tsx
{retainersEnabled && <ClientRetainersCard clientId={client.id} />}
```

Tests: `src/pages/clients/__tests__/ClientDetailPage.test.tsx` ("Advanced-feature entry points").

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

**Used by**: ClientDetailPage (receivables + transactions tabs), IncomePage,
ProjectDetailPage.
**Tests**: `src/components/ui/__tests__/RecordPaymentButton.test.tsx`

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

### KPICard
**Location**: `src/components/ui/KPICard.tsx`
**Purpose**: Key metric display on dashboard.

```tsx
<KPICard
  title="Paid Income"
  value={formatCurrency(paidIncomeMinor, currency)}
  trend={{ value: 12, direction: 'up' }}
  icon={<DollarIcon />}
/>
```

---

## Home Components

### PredictiveKpiStrip
**Location**: `src/components/home/PredictiveKpiStrip.tsx`
**Purpose**: Display predictive KPI cards showing current vs projected values for the month.

```tsx
<PredictiveKpiStrip
  className="my-strip"
/>
```

**Features**:
- Fetches guidance data for current month (USD and ILS)
- Shows KPI cards for: Income, Expenses, Net
- Each card displays current actual amount and projected amount
- Projected amounts include unpaid income and projected retainers
- Responsive: stacks on mobile (480px breakpoint)
- Currency-aware: shows both USD and ILS totals

**Sub-components**:
- `KpiCardForecast`: Individual KPI card with actual/projected display

```tsx
<KpiCardForecast
  title="Income"
  actualMinor={500000}
  projectedMinor={750000}
  currency="USD"
  locale="en-US"
  type="income"
/>
```

**Props (KpiCardForecast)**:
| Prop | Type | Description |
|------|------|-------------|
| `title` | string | Card title (i18n key result) |
| `actualMinor` | number | Current actual amount in minor units |
| `projectedMinor` | number | Projected amount in minor units |
| `currency` | Currency | 'USD' \| 'ILS' |
| `locale` | string | Locale for formatting |
| `type` | 'income' \| 'expense' \| 'net' | Affects color styling |

**Related**: `useGuidance` hook for data fetching

---

### AttentionFeed
**Location**: `src/components/home/AttentionFeed.tsx`
**Purpose**: Display severity-ordered attention items for unpaid income on the Home page.

```tsx
<AttentionFeed className="my-feed" />
```

**Features**:
- Shows unpaid income needing attention (overdue, due soon, missing due dates)
- Maximum 5 items shown
- Critical items always visible
- Warning/Info items collapse if >3 total
- "View all" links to Income page with unpaid filter
- Actions route through canonical IncomeDrawer
- Accessibility: proper list semantics, ARIA labels

**Severity Levels**:
- `critical`: Red icon (AlertCircle) - overdue items
- `warning`: Yellow icon (AlertTriangle) - due soon
- `info`: Blue icon (InfoCircle) - no due date

**Props**:
| Prop | Type | Description |
|------|------|-------------|
| `className?` | string | Additional CSS class |

**Data Source**: `useGuidance` hook with `includeUnpaidIncome: true`

**Accessibility**:
- Uses semantic `<ul>` / `<li>` elements
- `role="list"` and `role="listitem"` for screen readers
- `aria-label` on list container
- `aria-hidden="true"` on decorative icons
- `aria-expanded` on show more/less toggle

---

### MonthActualsRow
**Location**: `src/components/home/MonthActualsRow.tsx`
**Purpose**: Display actual income and expenses for the current month with currency tabs.

```tsx
<MonthActualsRow className="my-row" />
```

**Features**:
- Shows actuals for current month (not projections)
- Currency tabs to switch between USD and ILS
- Grid of KPI cards: Paid Income, Unpaid, Expenses, Net
- Responsive grid: 2 columns on mobile

**Props**:
| Prop | Type | Description |
|------|------|-------------|
| `className?` | string | Additional CSS class |

**Data Source**: `useGuidance` hook for income/expenses data

---

### QuickSummaries
**Location**: `src/components/home/QuickSummaries.tsx`
**Purpose**: Display quick summary cards for recent activity and top clients.

```tsx
<QuickSummaries className="my-summaries" />
```

**Features**:
- Recent transactions list
- Top clients by revenue
- Quick actions for common operations

---

### KpiStrip
**Location**: `src/components/home/KpiStrip.tsx`
**Purpose**: Legacy KPI strip component (superseded by PredictiveKpiStrip).

**Note**: Consider using `PredictiveKpiStrip` for new features requiring projected values.

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
