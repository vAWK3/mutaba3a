# COMPONENT_REGISTRY.md — Reusable Components

> **Purpose**: Document all reusable components to prevent duplication.
> **Rule**: Check this registry before creating any new component.

---

## Quick Lookup

| Category | Components |
|----------|------------|
| **Layout** | AppShell, SidebarNav, TopBar, PageHeader |
| **Drawers** | TransactionDrawer, ClientDrawer, ProjectDrawer, ExpenseDrawer, RetainerDrawer, DocumentDrawer, BusinessProfileDrawer |
| **Forms** | Input, Select, StepperInput, DatePicker, CurrencyInput, Textarea |
| **Buttons** | Button, IconButton, RowActionsMenu |
| **Display** | Card, Badge, StatusBadge, EmptyState, KPICard |
| **Tables** | DataTable, CellAmount, CellStatus, CellDate |
| **Filters** | DateRangeControl, SearchInput, StatusSegment, TypeSegment, CurrencyTabs |
| **Feedback** | Toast, Modal, ConfirmModal |
| **Money** | UnifiedAmount, FxRateBanner, CurrencyBadge |
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
- Active state highlighting
- Keyboard navigation
- RTL support
- Collapsible (future)

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
**Location**: `src/components/money/UnifiedAmount.tsx`
**Purpose**: Display amount with optional FX conversion.

```tsx
<UnifiedAmount
  amountMinor={1999}
  currency="USD"
  showConverted={true}
  baseCurrency="ILS"
/>
// Renders: $19.99 (≈ ₪73.50)
```

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
