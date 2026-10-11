# PATTERNS.md — Code Patterns & Conventions

> **Purpose**: Document established patterns to ensure consistency.
> **Rule**: Use existing patterns before introducing new ones.

---

## Pattern Index

| Category | Patterns |
|----------|----------|
| **Data Access** | Repository Pattern, Query Hooks, Mutations, Reconcile on read (MUT-3) |
| **State** | URL State, Zustand Stores, Form State |
| **Components** | Drawer Pattern, Filter Pattern, Table Pattern, Repair actions open in place |
| **Utilities** | Amount Formatting, Date Handling (`src/lib/dates.ts`), i18n, LTR amounts in RTL text (MUT-3) |
| **Sync** | HLC Operations, Conflict Resolution |
| **Testing** | Repository Mocking, Component Testing |

---

## Data Access Patterns

### Pattern: Repository Layer

All database access goes through repository interfaces. UI never touches Dexie directly.

**Structure**:
```typescript
// src/db/repository.ts

export const entityRepo = {
  // List with optional filters
  async list(filters?: EntityFilters): Promise<Entity[]> {
    const all = await db.entities.toArray();
    return all.filter(e => applyFilters(e, filters));
  },

  // Get single by ID
  async get(id: string): Promise<Entity | undefined> {
    return db.entities.get(id);
  },

  // Create with auto-generated ID and timestamps
  async create(data: Omit<Entity, 'id' | 'createdAt' | 'updatedAt'>): Promise<Entity> {
    const entity: Entity = {
      ...data,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await db.entities.add(entity);
    return entity;
  },

  // Update with automatic updatedAt
  async update(id: string, data: Partial<Entity>): Promise<void> {
    await db.entities.update(id, {
      ...data,
      updatedAt: new Date().toISOString(),
    });
  },

  // Soft delete (set deletedAt, not actual delete)
  async softDelete(id: string): Promise<void> {
    await db.entities.update(id, {
      deletedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  },

  // Archive (hide from lists, reversible)
  async archive(id: string): Promise<void> {
    await db.entities.update(id, {
      archivedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  },
};
```

**Usage**:
```typescript
// In hooks
const clients = await clientRepo.list();
const client = await clientRepo.get(id);
await clientRepo.update(id, { name: 'New Name' });
```

---

### Pattern: Query Hooks (TanStack Query)

Wrap repository calls in TanStack Query hooks for caching and mutation handling.

**Query Hook**:
```typescript
// src/hooks/useQueries.ts

export function useClients(filters?: ClientFilters) {
  return useQuery({
    queryKey: ['clients', filters],
    queryFn: () => clientRepo.list(filters),
  });
}

export function useClient(id: string | undefined) {
  return useQuery({
    queryKey: ['client', id],
    queryFn: () => clientRepo.get(id!),
    enabled: !!id,
  });
}
```

**Rule: a `queryFn` must never resolve to `undefined`.** TanStack Query v5
treats `undefined` data as a failed fetch: the query enters `error` state and
logs *"Query data cannot be undefined"*. Repository lookups keep their
`Promise<Entity | undefined>` contract (see Repository pattern above); the
*hook* is where the absence is normalised to `null`, and the hook's type says so:

```typescript
// Singleton lookups that legitimately have no row yet (fresh install)
export function useDefaultBusinessProfile() {
  return useQuery<BusinessProfile | null>({
    queryKey: queryKeys.defaultBusinessProfile(),
    queryFn: async () => (await repo.businessProfiles.getDefault()) ?? null,
  });
}
```

By-id lookups behind `enabled: !!id` only hit this when the id points at a
deleted row; the unguarded singleton lookups hit it on every fresh install.
As of 2026-10-10 every by-id hook in `src/hooks/*Queries.ts` follows this
(TD-028), so a new `get(id)` hook must too.
Consumers read the value through `?.` or a truthy check, which handles `null`
and `undefined` alike. Test the no-row case by asserting `isSuccess` and
`toBeNull()` — waiting on `isFetching === false` is also satisfied by a
failed query and proves nothing (see the 2026-10-10 CHANGELOG entry).

**Mutation Hook**:
```typescript
export function useCreateClient() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateClientInput) => clientRepo.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clients'] });
      toast.success('Client created');
    },
    onError: (error) => {
      toast.error('Failed to create client');
      console.error(error);
    },
  });
}

export function useUpdateClient() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Client> }) =>
      clientRepo.update(id, data),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: ['clients'] });
      queryClient.invalidateQueries({ queryKey: ['client', id] });
      toast.success('Client updated');
    },
  });
}
```

**Usage in Components**:
```typescript
function ClientList() {
  const { data: clients, isLoading } = useClients();
  const createClient = useCreateClient();

  const handleCreate = (data: CreateClientInput) => {
    createClient.mutate(data);
  };

  if (isLoading) return <Spinner />;
  return <DataTable rows={clients} ... />;
}
```

---

### Pattern: Derived Queries

For computed data (summaries, totals), use query functions that perform aggregations.

```typescript
export function useOverviewTotals(filters: { dateFrom: string; dateTo: string; currency?: Currency }) {
  return useQuery({
    queryKey: ['overview-totals', filters],
    queryFn: () => transactionRepo.getOverviewTotals(filters),
  });
}

export function useClientSummaries(filters?: ClientSummaryFilters) {
  return useQuery({
    queryKey: ['client-summaries', filters],
    queryFn: () => clientSummaryRepo.list(filters),
  });
}
```

---

## State Management Patterns

### Pattern: URL-Driven State

Use URL search params for filter state and drawer state. Enables deep linking and browser history.

**Filter State**:
```typescript
// src/hooks/useTransactionFilters.ts

export function useTransactionFilters() {
  const navigate = useNavigate();
  const { dateFrom, dateTo, currency, status, search } = useSearch({
    from: '/transactions',
  });

  const setFilters = (newFilters: Partial<TransactionFilters>) => {
    navigate({
      search: (prev) => ({
        ...prev,
        ...newFilters,
      }),
      replace: true, // Don't add to history for filter changes
    });
  };

  return {
    filters: { dateFrom, dateTo, currency, status, search },
    setFilters,
  };
}
```

**Drawer State**:
```typescript
// Open drawer
navigate({ search: { tx: transactionId } });

// Close drawer
navigate({ search: (prev) => ({ ...prev, tx: undefined }) });

// Check if drawer should be open
const { tx: editId, newTx } = useSearch({ from: '/transactions' });
const isDrawerOpen = !!editId || !!newTx;
```

---

### Pattern: Zustand Stores

Use Zustand for UI-only state that doesn't need URL persistence.

**Store Definition**:
```typescript
// src/lib/stores.ts

interface DrawerStore {
  activeDrawer: 'transaction' | 'client' | 'project' | null;
  editId: string | null;
  createType: string | null;
  openEdit: (drawer: string, id: string) => void;
  openCreate: (drawer: string, type?: string) => void;
  close: () => void;
}

export const useDrawerStore = create<DrawerStore>((set) => ({
  activeDrawer: null,
  editId: null,
  createType: null,
  openEdit: (drawer, id) => set({ activeDrawer: drawer, editId: id }),
  openCreate: (drawer, type) => set({ activeDrawer: drawer, createType: type }),
  close: () => set({ activeDrawer: null, editId: null, createType: null }),
}));
```

**Usage**:
```typescript
function Component() {
  const { openEdit, close } = useDrawerStore();

  return (
    <Button onClick={() => openEdit('transaction', id)}>
      Edit
    </Button>
  );
}
```

---

### Pattern: Form State (React Hook Form)

Use React Hook Form with Zod validation for all forms.

```typescript
// Schema
const transactionSchema = z.object({
  kind: z.enum(['income', 'expense']),
  amountMinor: z.number().min(1, 'Amount is required'),
  currency: z.enum(['USD', 'ILS', 'EUR']),
  clientId: z.string().optional(),
  projectId: z.string().optional(),
  occurredAt: z.string(),
  dueDate: z.string().optional(),
  notes: z.string().optional(),
});

type TransactionFormData = z.infer<typeof transactionSchema>;

// Component
function TransactionForm({ onSubmit, defaultValues }) {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    control,
  } = useForm<TransactionFormData>({
    resolver: zodResolver(transactionSchema),
    defaultValues,
  });

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <Input
        label="Amount"
        error={errors.amountMinor?.message}
        {...register('amountMinor', { valueAsNumber: true })}
      />
      {/* ... */}
    </form>
  );
}
```

---

## Component Patterns

### Pattern: Drawer Components

All entity drawers follow this structure:

```typescript
// Controller (URL-driven)
export function TransactionDrawerController() {
  const navigate = useNavigate();
  const { tx: editId, newTx } = useSearch({ from: '/transactions' });

  const handleClose = () => {
    navigate({ search: (prev) => ({ ...prev, tx: undefined, newTx: undefined }) });
  };

  if (!editId && !newTx) return null;

  return (
    <TransactionDrawer
      open={true}
      onClose={handleClose}
      transactionId={editId}
      createType={newTx}
    />
  );
}

// Drawer Component
export function TransactionDrawer({
  open,
  onClose,
  transactionId,
  createType,
}: TransactionDrawerProps) {
  const { data: transaction } = useTransaction(transactionId);
  const createMutation = useCreateTransaction();
  const updateMutation = useUpdateTransaction();

  const isEdit = !!transactionId;
  const isLoading = createMutation.isPending || updateMutation.isPending;

  const handleSubmit = async (data: TransactionFormData) => {
    if (isEdit) {
      await updateMutation.mutateAsync({ id: transactionId, data });
    } else {
      await createMutation.mutateAsync(data);
    }
    onClose();
  };

  return (
    <Drawer open={open} onClose={onClose}>
      <Drawer.Header>
        {isEdit ? 'Edit Transaction' : 'New Transaction'}
      </Drawer.Header>
      <Drawer.Body>
        <TransactionForm
          defaultValues={transaction}
          onSubmit={handleSubmit}
          isLoading={isLoading}
        />
      </Drawer.Body>
    </Drawer>
  );
}
```

---

### Pattern: Filter Components

Filters update a single FiltersModel object and push to URL.

```typescript
// Page with filters
function TransactionsPage() {
  const { filters, setFilters } = useTransactionFilters();
  const { data: transactions } = useTransactions(filters);

  return (
    <div>
      <FilterBar>
        <DateRangeControl
          value={{ from: filters.dateFrom, to: filters.dateTo }}
          onChange={({ from, to }) => setFilters({ dateFrom: from, dateTo: to })}
        />
        <CurrencyTabs
          value={filters.currency}
          onChange={(currency) => setFilters({ currency })}
        />
        <StatusSegment
          value={filters.status}
          onChange={(status) => setFilters({ status })}
        />
        <SearchInput
          value={filters.search}
          onChange={(search) => setFilters({ search })}
        />
      </FilterBar>

      <DataTable rows={transactions} ... />
    </div>
  );
}
```

---

### Pattern: Table Components

Tables receive pre-shaped rows, not raw data that requires per-cell computation.

```typescript
// Shape data in the query/hook
const { data: transactions } = useTransactions(filters);

// Pre-shaped in repository or hook
interface TransactionRow {
  id: string;
  title: string;
  clientName: string;    // Pre-resolved
  projectName: string;   // Pre-resolved
  amountMinor: number;
  currency: Currency;
  status: TxStatus;
  dueDate?: string;
  daysOverdue?: number;  // Pre-calculated
}

// Column definitions (stable, memoized)
const columns = useMemo(() => [
  { key: 'title', header: 'Title' },
  { key: 'clientName', header: 'Client' },
  {
    key: 'amount',
    header: 'Amount',
    render: (row) => <CellAmount amountMinor={row.amountMinor} currency={row.currency} />,
  },
  {
    key: 'status',
    header: 'Status',
    render: (row) => <CellStatus status={row.status} dueDate={row.dueDate} />,
  },
], []);

// Table receives shaped data
<DataTable columns={columns} rows={transactions} rowKey="id" />
```

---

## Utility Patterns

### Pattern: Amount Formatting

Amounts stored as minor units (cents), displayed as major units.

```typescript
// src/lib/utils.ts

export function formatAmount(amountMinor: number, currency: Currency): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amountMinor / 100);
}

export function parseAmountToMinor(input: string): number {
  const parsed = parseFloat(input);
  if (isNaN(parsed)) return 0;
  return Math.round(parsed * 100);
}

// Usage
formatAmount(1999, 'USD');           // → "$19.99"
parseAmountToMinor('19.99');         // → 1999
```

---

### Pattern: Date Handling

All dates stored as ISO strings. **All date-only logic lives in
`src/lib/dates.ts`** — see ADR-022. Two invariants:

1. "Today" is the user's **local** calendar date, never `toISOString()` (which
   gives the UTC date and is the wrong day for part of every day).
2. Day arithmetic uses a `Date.UTC`-based day ordinal, so it is exact across
   DST. Subtracting local `Date`s gives 0.958 or 1.042 days on a 23- or
   25-hour day and truncates wrong.

Predicates take `today` explicitly, so they are pure and timezone-independent.
`todayLocalISO()` is the only clock read.

```typescript
// src/lib/dates.ts
import {
  todayLocalISO,          // user's local YYYY-MM-DD; the only clock read
  daysBetweenLocal,       // exact whole days, DST-safe
  daysUntilDue,           // 0 = due today, negative = past
  isOverdueReceivable,    // ADR-010: unpaid income, dueDate < today
  daysOverdue,            // whole days overdue, or undefined when not overdue
  isDueSoon,              // due within N days; excludes already-overdue
} from '../lib/dates';

// Compute `today` ONCE per render or query, not per row.
const today = todayLocalISO();
const overdue = rows.filter((tx) => isOverdueReceivable(tx, today));

// daysOverdue is undefined exactly when not overdue, so it doubles as the
// check and narrows the type in one call:
const days = daysOverdue(tx, today);
if (days !== undefined) { /* render "N days overdue" */ }
```

**Never** reimplement overdue inline. Five sites had each rolled their own and
they disagreed with each other (MUT-17). In particular:

```typescript
// WRONG — compares a date-only string against the current instant, so an item
// due today is overdue in every timezone.
new Date(tx.dueDate) < new Date()

// WRONG — forgets that overdue applies only to unpaid income, so a paid
// invoice or an expense with a past due date renders as overdue.
getDaysUntil(tx.dueDate) < 0

// WRONG — the UTC date, not the user's date.
new Date().toISOString().split('T')[0]
```

`toISOString()` is still correct for **instants** — `nowISO()`, HLC timestamps,
sync bundles, backup filenames. The rule above is about date-only values.

**Testing**: `vitest.config.ts` pins `TZ` (default `Asia/Jerusalem`, which
observes DST). Run `npm run test:tz` to exercise the suite west of UTC. Any
test asserting on dates must pin the clock with
`vi.useFakeTimers({ shouldAdvanceTime: true })` and `vi.setSystemTime(...)`;
`shouldAdvanceTime` keeps Testing Library's `waitFor` from deadlocking.

---

### Pattern: i18n

Use context-based i18n with Intl APIs for formatting.

```typescript
// src/lib/i18n/context.tsx

export function useLanguage() {
  const { language, setLanguage } = useContext(LanguageContext);

  const t = useCallback((key: string): string => {
    return translations[language][key] ?? key;
  }, [language]);

  const direction = language === 'ar' ? 'rtl' : 'ltr';

  const formatCurrency = useCallback((amountMinor: number, currency: Currency) => {
    return new Intl.NumberFormat(language === 'ar' ? 'ar-EG' : 'en-US', {
      style: 'currency',
      currency,
    }).format(amountMinor / 100);
  }, [language]);

  const formatDate = useCallback((isoDate: string) => {
    return new Intl.DateTimeFormat(language === 'ar' ? 'ar-EG' : 'en-US', {
      dateStyle: 'medium',
    }).format(new Date(isoDate));
  }, [language]);

  return { t, direction, language, setLanguage, formatCurrency, formatDate };
}

// Usage
function Component() {
  const { t, formatCurrency, direction } = useLanguage();

  return (
    <div dir={direction}>
      <h1>{t('transactions.title')}</h1>
      <span>{formatCurrency(1999, 'USD')}</span>
    </div>
  );
}
```

---

## Sync Patterns

### Pattern: HLC Operations

All mutations create an operation in the opLog for sync.

```typescript
// src/sync/core/ops-engine.ts

export async function createOperation(
  entityType: EntityType,
  entityId: string,
  opType: OpType,
  field?: string,
  value?: unknown,
  previousValue?: unknown
): Promise<Operation> {
  const hlc = await tickHLC();
  const device = await getLocalDevice();

  const op: Operation = {
    id: crypto.randomUUID(),
    hlc: serializeHLC(hlc),
    entityType,
    entityId,
    opType,
    field,
    value,
    previousValue,
    createdBy: device.id,
    createdAt: new Date().toISOString(),
  };

  await db.opLog.add(op);
  return op;
}
```

---

### Pattern: Conflict Detection

Detect conflicts when applying remote operations.

```typescript
// src/sync/core/conflict-resolver.ts

export async function detectConflict(
  localOp: Operation,
  remoteOp: Operation
): Conflict | null {
  // Same entity, same field, different values
  if (
    localOp.entityType === remoteOp.entityType &&
    localOp.entityId === remoteOp.entityId &&
    localOp.field === remoteOp.field &&
    localOp.value !== remoteOp.value
  ) {
    // Check if operations are concurrent (neither happened-before the other)
    if (areConcurrent(localOp.hlc, remoteOp.hlc)) {
      return {
        id: crypto.randomUUID(),
        entityType: localOp.entityType,
        entityId: localOp.entityId,
        conflictType: 'profile_field',
        field: localOp.field,
        localOp,
        remoteOp,
        localValue: localOp.value,
        remoteValue: remoteOp.value,
        detectedAt: new Date().toISOString(),
        status: 'open',
      };
    }
  }

  return null;
}
```

---

## Testing Patterns

### Pattern: Repository Mocking

Mock repositories for unit tests.

```typescript
// src/db/__tests__/setup.ts
import 'fake-indexeddb/auto';

// Reset database between tests
beforeEach(async () => {
  await db.delete();
  await db.open();
});

// Test
describe('clientRepo', () => {
  it('creates a client with generated id', async () => {
    const client = await clientRepo.create({
      name: 'Test Client',
      email: 'test@example.com',
    });

    expect(client.id).toBeDefined();
    expect(client.name).toBe('Test Client');
    expect(client.createdAt).toBeDefined();
  });
});
```

---

### Pattern: Component Testing

Test components with Testing Library.

```typescript
// src/components/__tests__/Button.test.tsx
import { render, screen, fireEvent } from '@testing-library/react';

describe('Button', () => {
  it('renders with text', () => {
    render(<Button>Click me</Button>);
    expect(screen.getByText('Click me')).toBeInTheDocument();
  });

  it('calls onClick when clicked', () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Click</Button>);
    fireEvent.click(screen.getByText('Click'));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('shows loading spinner when isLoading', () => {
    render(<Button isLoading>Submit</Button>);
    expect(screen.getByRole('button')).toBeDisabled();
  });
});
```

---

### Pattern: Hook Testing

Test hooks with renderHook.

```typescript
// src/hooks/__tests__/useFilters.test.tsx
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const wrapper = ({ children }) => (
  <QueryClientProvider client={new QueryClient()}>
    {children}
  </QueryClientProvider>
);

describe('useTransactionFilters', () => {
  it('returns default filters', () => {
    const { result } = renderHook(() => useTransactionFilters(), { wrapper });

    expect(result.current.filters.currency).toBeUndefined();
    expect(result.current.filters.status).toBeUndefined();
  });

  it('updates filters', () => {
    const { result } = renderHook(() => useTransactionFilters(), { wrapper });

    act(() => {
      result.current.setFilters({ currency: 'USD' });
    });

    expect(result.current.filters.currency).toBe('USD');
  });
});
```

---

## Performance Patterns

### Pattern: Memoized Columns

Column definitions should be stable to avoid table re-renders.

```typescript
const columns = useMemo<ColumnDef<Transaction>[]>(() => [
  { key: 'title', header: 'Title' },
  { key: 'amount', header: 'Amount', render: CellAmount },
], []);  // Empty deps = stable reference
```

---

### Pattern: Debounced Search

Debounce search input to avoid excessive queries.

```typescript
function SearchInput({ value, onChange, debounceMs = 200 }) {
  const [localValue, setLocalValue] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => {
      onChange(localValue);
    }, debounceMs);

    return () => clearTimeout(timer);
  }, [localValue, debounceMs, onChange]);

  return (
    <input
      value={localValue}
      onChange={(e) => setLocalValue(e.target.value)}
    />
  );
}
```

---

### Pattern: Lazy Loading

Code-split routes and heavy components.

```typescript
// src/router.tsx
const DocumentsPage = lazy(() => import('./pages/documents/DocumentsPage'));
const InsightsPage = lazy(() => import('./pages/insights/InsightsPage'));

// Route definition
{
  path: '/documents',
  component: () => (
    <Suspense fallback={<PageSkeleton />}>
      <DocumentsPage />
    </Suspense>
  ),
}
```

---

## Error Handling Patterns

### Pattern: Repository Errors

Throw typed errors for business rule violations.

```typescript
// Custom errors
export class DocumentLockedError extends Error {
  documentId: string;
  constructor(message: string, documentId: string) {
    super(message);
    this.name = 'DocumentLockedError';
    this.documentId = documentId;
  }
}

// Throw in repository
if (document.lockedAt) {
  throw new DocumentLockedError('Document is locked', document.id);
}

// Catch in mutation
onError: (error) => {
  if (error instanceof DocumentLockedError) {
    toast.error('Cannot edit locked document');
  } else {
    toast.error('An error occurred');
  }
}
```

---

## Design Token Patterns

### Pattern: Canonical Design Tokens

**Source**: `src/styles/theme.css` is the authoritative design token file.

All new CSS must use canonical token names. Legacy tokens (`--color-*`, `--font-size-*`, `--font-weight-*`) exist in `index.css` for backwards compatibility but are deprecated.

**Quick Reference**:

| Use Case | Canonical Token | Avoid |
|----------|----------------|-------|
| Body text | `color: var(--text)` | `--color-text` |
| Secondary text | `color: var(--text-secondary)` | `--color-text-secondary` |
| Muted/hint | `color: var(--muted)` | `--color-text-muted` |
| Primary action | `background: var(--accent-solid)` | `--color-primary` |
| Primary border/link | `color: var(--accent)` | `--color-primary` |
| Background | `background: var(--bg)` | `--color-bg` |
| Card/elevated | `background: var(--surface)` | `--color-bg-elevated` |
| Success | `color: var(--success)` | `--color-success` |
| Warning | `color: var(--warning)` | `--color-warning` |
| Error/danger | `color: var(--error)` | `--color-danger` |
| Border | `border-color: var(--border)` | `--color-border` |
| Font size | `font-size: var(--text-sm)` | `--font-size-sm` |
| Font weight | `font-weight: var(--weight-medium)` | `--font-weight-medium` |
| Spacing | `padding: var(--space-4)` | Hardcoded `16px` |
| Shadow | `box-shadow: var(--shadow-2)` | `--shadow-md` |
| Focus | `box-shadow: var(--focus-ring)` | `outline: 2px solid` |

**Typography Scale**:
```css
--text-xs: 0.6875rem;   /* 11px */
--text-sm: 0.75rem;     /* 12px */
--text-base: 0.8125rem; /* 13px - default body */
--text-md: 0.875rem;    /* 14px */
--text-lg: 1rem;        /* 16px */
--text-xl: 1.125rem;    /* 18px */
--text-2xl: 1.25rem;    /* 20px */
--text-3xl: 1.5rem;     /* 24px */
--text-4xl: 1.875rem;   /* 30px */
```

**Spacing Scale** (8px base):
```css
--space-1: 0.25rem;   /* 4px */
--space-2: 0.5rem;    /* 8px */
--space-3: 0.75rem;   /* 12px */
--space-4: 1rem;      /* 16px */
--space-5: 1.25rem;   /* 20px */
--space-6: 1.5rem;    /* 24px */
--space-8: 2rem;      /* 32px */
```

**Font Families**:
```css
--font-en: "Inter Variable"       /* English body */
--font-ar: "IBM Plex Sans Arabic" /* Arabic body */
--font-heading: "Source Serif 4"  /* Headings (serif) */
--font-mono: "IBM Plex Mono"      /* Numbers, code */
```

---

### Pattern: Button Styling

Buttons use the shared `Button` component (`src/components/ui/Button.tsx`) with CSS from `Button.css`.

**Never create custom button classes**. Use the component or import the CSS.

```tsx
// In React components
import { Button } from '@/components/ui/Button';

<Button variant="primary" size="md">Save</Button>
<Button variant="secondary">Cancel</Button>
<Button variant="danger" isLoading>Delete</Button>
```

**Variants**: `primary`, `secondary`, `ghost`, `danger`
**Sizes**: `sm` (32px), `md` (40px), `lg` (44px)

**For landing page or non-React contexts**, import Button.css and use classes:
```html
<button class="btn btn-primary btn-md">Save</button>
```

---

### Pattern: Focus Styles

Use `box-shadow` with `--focus-ring` token for focus states. Do not use `outline`.

```css
/* Correct */
.interactive:focus-visible {
  box-shadow: var(--focus-ring);
}

/* Avoid */
.interactive:focus-visible {
  outline: 2px solid var(--color-primary);
}
```

The focus ring uses the accent color at 40% opacity for a subtle glow effect that works in both light and dark modes.

---

### Pattern: Dark Mode Support

Dark mode is handled automatically via CSS variables. **No JavaScript needed**.

1. `prefers-color-scheme: dark` media query handles system preference
2. `[data-theme="dark"]` selector handles manual override
3. All tokens automatically update

**To add dark mode to new components**:
1. Use canonical tokens (they already have dark variants)
2. Never hardcode colors
3. Test in both modes

```css
/* This automatically works in dark mode */
.my-component {
  background: var(--surface);
  color: var(--text);
  border: 1px solid var(--border);
}

/* For dark-mode-only styles (rare) */
@media (prefers-color-scheme: dark) {
  .my-component {
    /* Dark-specific overrides */
  }
}
```

---

## Adding New Patterns

Before adding a new pattern:

1. **Check this file** for existing similar patterns
2. **Check the codebase** for established conventions
3. If new pattern is needed, **document it here** with:
   - Name
   - Purpose
   - Code example
   - When to use

---

## Hosted API (`server/`) patterns — added 2026-10-08 (Money v1 M2)

### Migrations are append-only once merged (MUT-59)
Never edit a migration file after it reaches `main`, even when "nothing was
deployed". Check `DEPLOYMENT.md` §7 (or `gcloud run revisions list`) first:
`deploy.sh` migrates on every roll, and `prisma migrate deploy` silently keeps
a recorded migration's original effect.
- **A wrong schema gets a forward migration.** It must:
  - be guarded so it is a no-op where the schema is already right;
  - audit what it changes (`SYSTEM`, metadata with the old values);
  - `RAISE EXCEPTION` on data it cannot map, all in one `DO $$ … $$` block,
    so a refusal changes nothing.
- **Test it on a database built the way production got its schema.** Keep a
  fixture copy of the old migration (`migration-mut59.test.ts` builds scratch
  databases with `prisma db execute`), and check for no drift against
  `schema.prisma`.

### Plan-then-execute for batch writes
`src/import/plan.ts` is a pure function `(rows, currentState) → PlanRow[]`;
`POST /v1/import/preview` returns the plan, `POST /v1/import/commit` recomputes
it and executes it row by row. One decision table, two callers, so preview and
commit can never disagree. Use it for any future "show me what will happen,
then do it" surface (M3 agreement previews follow the same shape with a
`previewToken`).

### Preview token = proof of "same rows", not "same world"
`sha256(organization | provider | canonical rows)`, verified by recomputation
in constant time, never stored. It stops a client committing rows it did not
preview; it does not freeze state — commit re-plans. A token that must freeze
state (M3 `PREVIEW_STALE` on prices) needs a stored token with an expiry.

### Keyset pagination
Every list orders by `(createdAt, id)` and returns an opaque cursor
(`src/pagination.ts`). Stores take a decoded `PageCursor` and return one;
routes encode. Never offset pagination.

### Optimistic concurrency via If-Match
Mutable records carry `version`; `PATCH` requires `If-Match: <version>`
(`src/if-match.ts`), the store applies `updateMany … where version = expected`
and reports `updated | stale | not_found`; stale → 409 `VERSION_MISMATCH`
with `currentVersion`.

### Idempotent create by external reference
`POST` with `externalReference` looks the reference up first (200 existing),
creates entity + reference atomically otherwise, and treats a `UniqueViolation`
on create as "someone else won the race" (re-lookup, 200). The reference lives
in its own table keyed by `(organization, provider, entityType, externalId)`.

### Money math is pure and tabular (M3)
`vat.ts`, `agreements/schedule.ts`, `agreements/status.ts`, `retainers/schedule.ts`
take plain inputs and return plain results or structured errors; no store, no
clock, no `number` for an amount. Their tests are tables; a new rule is a new
row. Routes only compose them.

### Lazy posting instead of a scheduler (M3)
Anything that "happens on a date" (a dated installment, a monthly charge) is
materialised by `postDueItems` at the start of every read that would show it,
and by `POST /v1/retainers/reconcile`. Correctness rests on the store making
the operation idempotent (receivable + marker in one transaction; unique charge
per month), not on running exactly once. A timer (M5) will call the same
function.

### Calendar dates are strings, instants are Dates
`YYYY-MM-DD` / `YYYY-MM` strings in `VarChar` columns for anything the firm
reads off a calendar (agreement date, due date, service month), with "today"
computed in the organization's timezone; `DateTime` only for instants (posted
at, created at). Lexicographic order is chronological, so no timezone can shift
a due date.

### Preview token = proof of "same balances" where the review shows balances (M4)
The agreement/import tokens prove "same rows". A payment review shows what
each receivable, matter and client will owe afterwards, so its token also hashes
the `(id, version)` of every receivable the allocation could have touched
(`payments/preview-token.ts`). Any payment or credit in between bumps a version
and the post is refused as `PREVIEW_STALE`; the client previews again. The
store adds a second line of defence: capacity is re-checked under row locks and
a race surfaces as `InsufficientCapacity` → the same `PREVIEW_STALE`.

### Denormalised sums live with the rows that justify them (M4)
`receivables.paidMinor` / `creditedMinor` and `payments.allocatedMinor` are
written in the same transaction as the allocation or credit row, and `status`
is recomputed from the sums right there (`settleReceivable`). The contract test
replays a sequence and asserts sums equal their rows. Nothing is ever edited or
deleted: a reversal subtracts, a credit appends.

### Credits are rows, not edits (M4)
A posted receivable's `gross / net / vat` never change. What a firm forgives
is a `receivable_credits` row with its own VAT split at the frozen rate;
`outstanding = gross − paid − credited`. Credits count towards settlement
(`PAID` at zero) but are not payments (`PARTIALLY_PAID` needs `paid > 0`).

### Data access resolves through a registry, not imports (MUT-35)
No hook, service or component imports a repository singleton. Every read and
write goes through `getRepositories()` in `src/db/provider.ts`, re-exported from
the `src/db` barrel. The registry is a frozen module-scoped object, not a React
context: Dexie migrations run inside `db.open()` before React mounts, so
resolution must not depend on a mounted tree (see TD-013 and the
`dexie-migration-timing` learning).

Resolve **inside** the callback, never at module scope:

```ts
// right — a later swap takes effect
queryFn: () => getRepositories().base.transactions.list(filters)

// wrong — captures whatever was active at import time, which is the exact bug
// synced-repository.ts has today
const repos = getRepositories();
```

Two families are exposed on purpose. `base` is the plain Dexie repository;
`synced` is the decorator that also captures an op in the sync log. Call sites
state which one they use, so the (pre-existing, uneven) split is visible rather
than hidden — see TODOS.md item 1.

`satisfies` on both registries is the conformance check: deleting or renaming a
repository method fails `npm run typecheck` at `provider.ts`. Verified by
temporarily renaming `fxRateRepo.getLatest`, which produced
`Property 'getLatest' is missing in type … but required in type 'IFxRateRepository'`.

**Testing.** The barrel is the single interception point. A test that fakes the
data layer mocks `'../../db'` and returns `getRepositories`; it never mocks a
repository module directly. Share one set of fakes across mocks with
`vi.hoisted()` when a test asserts through both paths.

### Optional areas are read through one hook and written through one map (MUT-12)
`src/lib/features/features.ts` owns the vocabulary (`FEATURE_KEYS`), the
tolerant resolver and the data probes; `src/lib/features/useFeatures.ts` owns
the read/write paths. **Components call `useFeatureEnabled(key)` or
`useFeatureFlags()`; router `beforeLoad` guards call `readFeatureFlags()`.
Nothing else reads `settings.features`.** Writers always store the *full*
resolved map (`withFeature(current, key, enabled)`) because `settingsRepo.update`
replaces top-level fields, it does not merge nested objects. Data presence only
ever switches an area on (`reconcileFeaturesWithData`); every code path that
bulk-writes rows after the v20 upgrade (restore, import, demo, sync) calls the
swallowing `reconcileFeaturesAfterDataLoad(source, db)` and then invalidates
`['settings']` or reloads. Adding an area: one key in `FeatureKey` +
`FEATURE_KEYS`, its probe list, and `settings.features.items.<key>` in both
locales — the snapshot and parity tests fail until all four agree.

### Gating an optional area (MUT-13)
Three places, always together: the **route** gets `beforeLoad: requireFeature('<key>')`
(`src/lib/features/routeGuard.ts`; redirects home before the lazy chunk loads);
the **sidebar entry** goes into `optionalItems` in `SidebarNav.tsx` with its
`feature` key (the "More" section renders only enabled items); **entry points**
on other pages read `useFeatureEnabled('<key>')` and render nothing while off.
Data and repository guards never read a flag: a document lock, a sequence or a
retainer behaves identically whether the area is on or off, and the UI only
changes how it *explains* the data (the locked income notice links to the
document when invoices is on and points at Settings when it is off). Deep links
into a gated area from other surfaces (home attention items, legacy menus) are
either removed while the area is off or left to bounce via the guard; prefer
removing when the item's only action is the deep link.
Two extensions from MUT-16: an optional **field** inside a core form (the
project tag on income/expense) is *not rendered* while the area is off but its
form value is kept, so an edit never strips data the user cannot see; and a
guided **flow** that has a step for the area (onboarding's project step)
adapts in the component with an effect that completes the step, not in the
store, so persisted state needs no migration and the flow is unchanged when
the area is on. Hiding may read `useFeatureEnabled` as-is (`false` while
loading just delays the entry); **acting** on "off" — completing a step,
clearing a value, redirecting inside React — must also check
`useFeaturesLoaded()`, or the first render treats "not read yet" as "off".

### Core first, optional appended (MUT-15)
Any list that mixes core entries with optional-area entries (the sidebar, both
`+ Add` menus) puts the core entries first as a **constant** and appends the
optional ones after, filtered by the flags. A switch (or the flags reading
`false` while settings load) can then only add or remove rows *below* the
core, so nothing the user already reaches for moves and there is no layout
shift. One list per concern: `coreItems`/`optionalItems` for the sidebar,
`visibleAddMenuActions(flags)` for both menus; a menu only maps an action to
its own label, icon and click handler.

### Leaving an area that was switched off (MUT-15)
Do not add a second table of which route belongs to which area. The router
already knows: every gated route has `requireFeature(key)`. When an area goes
from on to off, `useLeaveDisabledArea()` (mounted once in `AppShell`) calls
`router.invalidate()`, which re-runs the open route's `beforeLoad`; the gate
then redirects home with `replace`, exactly as a deep link would. The hook
compares the previous resolved map with the new one (`featuresTurnedOff`) and
ignores the first load and switch-ons, so unrelated settings writes never
touch the router. Test it with a real memory-history router and the real
guard (`leaveDisabledArea.test.tsx`), not a mocked `useNavigate`.

### Menu buttons (MUT-15)
A button that opens a list of actions uses `useMenuButton()` and spreads
`buttonProps` / `menuProps`; items are `role="menuitem"` with `tabIndex={-1}`
and call `menu.close()` before running their action. The hook owns focus on
open, arrow/Home/End movement, Escape (refocus the button), Tab and
outside-click closing; do not add per-menu document listeners.

### Pruning after a UI deletion (MUT-14)
Run the consumer audit (exports and repository methods with zero references
outside their own file and tests), then make a **reachability pass** before
deleting: a candidate whose only *entry point* was on a deleted page may still
be a live feature (the category seeder: its button was deleted, its rows are
what the surviving ledger groups by) → re-home the entry point instead of
deleting. Conversely a chain kept alive only by a surviving consumer with no
remaining *producer* (the `linkReceiptId` drawer option, produced only by the
deleted receipts page) is dead even though the script shows references. Tables
never go (ADR-029); their row types move to `src/db/retained/` with a
retention test, and user *files* get a plain export before their viewer goes
(ADR-029 addendum).

---

### Reconcile on read when a write path skips a derived record (MUT-3, ADR-033)
When one write path leaves out a row other readers depend on — income saved as
Received writes no `PaymentRecord` — and fixing the write needs its own design,
the **reader** derives the missing rows from the source of truth instead of a
backfill migration. `paymentRecordRepo.listByClient` adds one `source: 'entry'`
row for the amount an income says was received but its records do not cover;
real rows carry `source: 'record'`. Rules: the derived row is computed from the
gap (`effectiveReceived − Σrecords`), never in addition to records, so the day
the write path is fixed the derived rows vanish with no reader change; give it
a distinct, stable id (`entry:<txId>`) and a `source` so the UI can route a
click to whatever owns it; record the write-side fix as debt (TD-029). Do not
use this to paper over a write path you are already touching.

### One definition per money question (MUT-3)
A figure that more than one screen shows — Owed Now today — is one pure
function over rows (`summarizeOwedByCurrency(transactions, today)` in
`src/db/aggregations.ts`) that every screen calls, not a per-page reduce or a
second repository method. It takes `today` explicitly (ADR-022), returns one
entry per currency in a fixed order and never converts. The overdue counts that
disagreed across five screens before MUT-17 are the reason.

The same goes for a record state that one screen counts and another fixes.
"Unassigned" is `isOrphaned.{clients,projects,transactions,expenses}` in
`src/db/orphanedRecords.ts`; the banner's count (`runIntegrityCheck`) and the
drawer's rows (`findOrphanedRecords`) both filter with it, and a test asserts
the two return the same ids.

### Repair actions open in place (2026-10-11)
A banner or notice that points at a problem fixes it where the user is: its
action is a `<button type="button">` that opens a drawer through
`useDrawerStore`, mounted in `AppShell` like the entity drawers. Never a raw
`<a href>`: on the web build the router's `basepath: '/app'` doesn't apply to
it, so it leaves the PWA scope and reloads the app. When a banner only needs
to *navigate*, it uses the router's `Link` (`FeatureNoticeBanner`).

### Decide "new user" only after the data has answered (MUT-8)
A screen that branches on "no data yet" (onboarding, an empty state with a
first action) must not treat a query that is still loading as empty. Dexie
reads are fast but asynchronous, so `data = []` defaults make every load look
like a fresh install for a frame or two. That made onboarding flash on Home.
Branch on `!isLoading && list.length === 0` for every query involved, and
render a spinner, not the populated layout with zeroes, until they have all
answered.

### Ordering across currencies (MUT-7, ADR-035)
Never compare or add raw minor units of different currencies. To order a list
by money owed in several currencies, rank by a tuple: [the ILS-converted
total over the currencies that have a rate today, then each unrated
currency's raw amount, in USD → ILS → EUR order] (`owedRank`). Compute it once
per row while shaping, not inside the comparator. Show every amount in its
own currency, and say on the header that the order uses today's rate. Columns
that can compare something currency-free (days late, dates, names) do that
instead. Every comparator ends with a name-then-id tie-break so equal rows
never reshuffle.

### Amounts stay LTR inside RTL text (MUT-3)
A standalone amount renders in `<bdi dir="ltr">` (or a cell the RTL rules
already isolate, like `.amount-cell`). An amount *inside a translated sentence*
("{amount} overdue") is passed to `t()` wrapped in U+2066 … U+2069 (LEFT-TO-RIGHT
ISOLATE … POP DIRECTIONAL ISOLATE), so translators keep control of word order
and the number still reads left to right in Arabic. Tests that assert the
sentence strip `[\u2066-\u2069]` first. Phone numbers and e-mail addresses in
an RTL header get the same `<bdi dir="ltr">`.

### Operator CLIs are functions over an injected fetch (MUT-37)
`smoke.ts` started it; `scripts/users.ts` makes it the rule. The script exports
`run…(argv, { fetch, url, token, out, err }) → exit code` and only the
`import.meta.url === argv[1]` guard at the bottom touches `process`. Tests pass
`app.request` as the fetch, so the CLI is exercised against the real routes
in-process — argument parsing, error surfacing and "the secret prints exactly
once" are all asserted, with no server running. Secrets come from the
environment, never a flag.

### A route's principals live in its OpenAPI `security` (MUT-38)
`security: [{ apiKey: [] }]`, `[{ session: [] }]`, both, or `[]` (public) is
the declaration; `authenticate()` builds an index from the OpenAPI registry
and enforces it, so the published contract and the behaviour cannot drift.
`route-security.test.ts` sweeps every operation both ways. Handlers of
key-only routes read `keyAuth(c)` (narrows the union and refuses a session a
second time); session-reachable handlers read `c.get('auth').organization` and
post due items with `const posting = lazyPostingOf(c, store)` →
`postDueItems(posting.store, …, posting.actor)` (SYSTEM on the unguarded store
for a session; MUT-39). Never read `auth.apiKey` directly, and never call
`unguarded()` anywhere else — a test pins its one caller.

### Store access is classified once; the guard lives in the store (MUT-39)
Every `LedgerStore` repository method has an entry in `STORE_ACCESS`
(`auth/store-guard.ts`): `read`, `control` (bookkeeping any request needs —
audit, idempotency, last-used), `operator` (provisioning; refused under any
guard) or `{ write: Domain }` (a writability-matrix row). The map is typed over
`LedgerStore`, so **adding a store method means classifying it here** or the
build fails. Route factories receive `requestScopedStore(store)`; the guard is
per request (Hono `contextStorage`), set by `authenticate()` from the matrix
column of the principal. Code outside a request (scripts, reconcile) and
`/admin` run unguarded by construction. A refused write is `writeRefusal()` —
READ_ONLY_PROFILE on a Malafat row, PRINCIPAL_NOT_ACCEPTED elsewhere — never a
bare 403. Route scopes are read from tagged `requireScope` middleware, so tests
and `authenticate()` derive expectations from `route × matrix` rather than a
hand-kept list. A domain a principal must not even read (the API key on
`expenses`) classifies its reads `{ read: Domain }` too (MUT-42).

### A domain one principal must never see is closed at every door (MUT-42)
Declaring routes `[{ session: [] }]` is not enough. Check each shared path an
API key can read:
1. routes (`security`);
2. store reads (`{ read: Domain }`);
3. the audit listing (`excludeEntityTypes`);
4. the idempotency lookup (`claimKeyFor` namespaces session keys);
5. any table a key-readable route lists (give the domain its own table rather
   than filtering a shared one).

Then prove it with a **canary sweep**, generated from the published document:
1. a session writes distinctive values;
2. the key calls every key-readable operation, with every canary id in every
   path slot;
3. no response body may contain a canary (`expenses-invisible.test.ts`).

### A writability-matrix row can depend on the profile, not just the principal (MUT-65)
Most rows are a constant per principal (`WRITABILITY_MATRIX[i].session`). Three
rows (`customers`, `projects`, `payments`) are not: a personal profile
(`profileWriter === null`) may write them through its own session; a
Malafat-fed one may not, unchanged from before. The matrix itself stays
unedited — a `sessionAccessFor(domain, profileWriter)` wrapper layers the
per-profile branch on top for exactly `PROFILE_DEPENDENT_DOMAINS`, and falls
through to the static `matrixRow(domain).session` for everything else.
`sessionScopesFor`/`mayWriteFor` are the profile-aware counterparts of
`sessionScopes`/`mayWrite`, used at the two points that actually decide
access (`selectProfile()`, `store-guard.ts`'s `storeRefusal`); the static
originals are kept, since other call sites (e.g. the API-key column) never
needed to change. The brief's matrix cell for such a row gets a fixed,
**literal suffix** (`` `read; read-write on a personal profile` ``) rather than
a richer cell grammar — keep the table one `Access` value per cell plus a
pinned string, not a format a drift test has to parse.

### A view in error renders no data (MUT-43)
After a failed refetch, TanStack Query keeps the last `data`. A portal view
ignores it while any of its queries is in error and shows the unreachable card
(`QueryView`). A figure on screen is always one the server just confirmed. There
is no `placeholderData`, no persister and no service worker.

### Portal figures are keyed by profile (MUT-43)
Every portal query key starts `['p', profileId, …]` (`profileKey`). Switching
profile can't show another profile's numbers, and the views remount under a
keyed fragment. Sign-out drops everything with one `queryClient.clear()`, made
*before* navigating to sign-in (`endSession`).

### Plurals go through `tp()` (MUT-43, ADR-019)
A plural string is an object of CLDR forms (`zero|one|two|few|many|other`);
`tp(key, count, vars)` picks the form `Intl.PluralRules` names, falling back to
`other`, with `{count}` always available. English needs `one` + `other`; Arabic
all six (parity-tested in `src/hosted/i18n`).

### One broadcast channel per tab (MUT-43)
A tab that announces something to its other tabs must use the same
`BroadcastChannel` object it listens on: the browser never delivers a message to
the object that posted it. A fresh channel per post makes the tab hear itself.

### A build target that must stay apart is proven on the built output (MUT-43)
Claims like "the local app contains no portal code" are checked against the
built bundles (`npm run test:bundles` with `scripts/bundle-rules.ts`), not
argued from imports. New external origins fail until they are reviewed and added
to `scripts/bundle-origins.json`.

### Log redaction is spelled out per depth (MUT-38, TD-039)
pino's `*.x` matches one level only. `logger.ts` generates every sensitive key
at depths 0–3; add a key to `SENSITIVE_KEYS`, never a one-off path, and the
logger test covers it automatically.

### Account changes are audited on every member organization (MUT-37)
A user is not organization-scoped but `audit_events` is. An account change is
appended once per organization the user belongs to after the change (a removed
membership on the organization it removed), actor `ADMIN`, entity `user`. A
user with no memberships is logged at info with the user id only. Idempotent
no-ops (a second disable, an existing grant) are not audited.

### A shared form takes field-identical props and host-specific slots (MUT-44)
`ExpenseFormFields` holds the fields genuinely identical between the local app
and the portal (amount/currency/date/title/category/notes); client/project/
vendor are `ReactNode` props the host fills in, because those three differ in
kind, not just styling, between hosts (Dexie-backed and create-capable locally;
a read-only directory lookup on the portal, with no server-side vendor concept
at all there). Where one *attribute* differs for a real reason — the amount
input's `type`/`dir` (local keeps `type="number"`; the portal's lint bans
`Number()`/`parseFloat` outright, so it needs a `dir="ltr"` text input) — that
becomes an explicit mode prop (`amountInputMode`), not two components. A
manually-set error (`setError(field, {type: 'manual', message})`) is
distinguished from the component's own generic validation text by `.type`, so
a host can hand back a server-specific message without the component having to
know what produced it.

### A cross-origin write bypasses the house HTTP client on purpose (MUT-44)
`api/client.ts`'s `request()` assumes same-origin credentials and a `/v1/*`
path — correct for every other call, wrong for a signed-URL upload to a
storage bucket on a different origin entirely. `putToSignedUrl` is a separate,
small `fetch` with `credentials: 'omit'` instead of forcing the shared
client to grow an escape hatch for one caller. The CSP implication (the
bucket origin must be in `connect-src`) is the kind of cross-cutting
consequence that belongs on the ticket that owns CSP, not solved locally.

---

## Verification patterns — added 2026-10-10 (MUT-49)

### Contract test over a shipped config artifact

**Purpose**: Some files are not code but still ship and still break users when
they drift: `public/.well-known/oauth-client.json` (Malafat validates it
byte-for-byte) and `src-tauri/tauri.conf.json` (the updater public key is
compiled into every build). A vitest file reads the artifact from disk with
`node:fs` and asserts the invariant another system enforces, so `npm test`
fails before a release does.

**Instances**: `src/sync/transport/__tests__/cimd-document.test.ts` (re-states
Malafat's CIMD rules), `src/lib/__tests__/updater-config.test.ts` (pins the
updater pubkey to ADR-031's canonical key).

**Rules**:
- Resolve the path from `process.cwd()` so the test runs from any worktree.
- Assert the exact bytes or string when the artifact's identity is the string
  itself (a key, a client id); decode only to produce a readable message.
- State in the test header which external system or release step depends on
  the invariant, and which ADR or ticket owns a deliberate change.
- Do not reach for a parsing library when string equality has the same
  regression power.

**When to use**: any committed file whose contents a build, a signer, a remote
validator or an installed client depends on verbatim.

---

## Serving patterns — added 2026-10-11 (MUT-45)

### Optional-feature dependency wiring: `{ ... } | null`, not a second app factory

**Purpose**: `createApp()` already had this shape for attachments
(`attachments?: AttachmentStorage | null` — absent/null means the routes
answer 503, not that they don't exist) and sessions. The portal follows it:
`portal?: { distDir: string } | null`. When unset, every existing route and
every existing test is byte-for-byte unaffected — no second code path to
maintain, no flag threaded through callers, no behavior change for the ~60
test files that never pass `portal` at all.

**Instances**: `server/src/app.ts` (`AppDependencies.portal`), wired from
`server/src/index.ts` via `config.PORTAL_DIST_DIR` (optional, Dockerfile-set).

**Rules**:
- Register the optional feature's routes/middleware *after* every required
  route, guarded by a single `if (deps.optionalThing) { ... }` block — never
  scatter `if` checks through the rest of `createApp()`.
- The dependency's shape should make "disabled" the natural default (`null`
  or `undefined`), not a boolean flag plus a separately-optional config value.
- A fixture-based test (temp dir, temp store, etc.) proves the enabled path;
  the disabled path is already proven by every other test file in the suite
  not regressing.

**When to use**: a feature that an operator may or may not configure for a
given deployment (attachments bucket, portal build, future: a search index,
an email sender), where "not configured" must be indistinguishable from
"before this feature existed."

### CSP `connect-src` must be audited against every non-house `fetch`, not just the obvious ones

**Purpose**: MUT-44's receipt upload bypasses the shared API client on purpose
(`putToSignedUrl`, a bare cross-origin `fetch` to a GCS signed URL) — exactly
the kind of call a CSP review can miss if it only looks at the "normal" data
layer (`api/client.ts`'s `request()`, which is same-origin and already
covered by `'self'`). The MUT-44 amendment to ADR-037 flagged this by name;
MUT-45's CSP (`server/src/app.ts`) adds `https://storage.googleapis.com` to
`connect-src` to close it, verified against `@google-cloud/storage`'s actual
`PATH_STYLED_HOST` constant rather than assumed.

**Rule**: before locking a CSP, grep the frontend for every `fetch(`/`XHR`/
`WebSocket` call outside the house HTTP client, and name the host each one
actually hits. A CSP written from the data-layer's abstraction instead of the
network tab will miss exactly this class of call.

### `@hono/node-server`'s `serveStatic` `onFound`/`onNotFound` cannot set response headers

**Pitfall** (found during MUT-45's `/qa-reconcile`, by probing actual behavior,
not assumed): `serveStatic`'s internal flow calls `c.body(...)` to build its
Response, and only *afterward* calls `onFound`/`onNotFound`. By then, `c.body()`
has already copied the context's prepared headers into the new `Response`'s own
`Headers` object; a `c.header()` call inside `onFound` writes to the context's
headers going forward, which nothing reads again — the already-built `Response`
silently keeps its old value. Empirically confirmed: setting `Cache-Control`
inside `onFound` had zero effect on the actual response.

**Fix**: capture the `Response` returned by calling the `serveStatic` middleware
directly (`const result = await serveStatic(opts)(c, next)`), set a flag inside
`onFound` instead of a header, then after the call mutate `result.headers` (the
Web `Headers` API) directly when the flag is set, and `return result`.
`server/src/app.ts`'s `/assets/*` immutable-caching logic is the instance.

**The bug this caused before the fix**: the original code set `Cache-Control:
immutable` in a middleware keyed on the URL *prefix* (`/assets/*`), before
checking whether the file existed. A stale/rotated asset filename (after a
deploy) fell through to the SPA shell but kept the immutable header — a
browser or CDN would then cache that broken response for a year. The fix
above only sets the header when `onFound` actually fired for that request.

---

## App patterns added by MUT-5 (2026-10-11)

### Payment records own payment state (ADR-039)
An income entry's `status`, `paidAt` and `receivedAmountMinor` are derived from its live `PaymentRecord`s whenever it has any (`recalculateReceivedAmount`).
- **The repository is the gate.** `transactionRepo.update` strips those three fields from any update of a record-backed entry and re-derives them. It also rejects a currency change, and rejects an amount *change* below the recorded total (ADR-030).
- **A form waits for the records** (`usePaymentRecords(...).isSuccess`) before it lets the user touch payment state or save. It shows status and currency read-only once records exist, and pre-checks only to give a translated field error.
- **A refusal is still shown:** map the repository error name (`PaymentRecordError`, `TransactionLockedError`) to a toast, never just `console.error`.

### Partial updates leave keys out; they never set them to `undefined`
Dexie's `table.update(id, changes)` deletes a key whose value is `undefined`, and `captureUpdateOps` would turn it into an op too. A write that should leave a field alone must not contain the key. Build the change object conditionally (`buildIncomeUpdate`) and assert absence in tests with `expect('paidAt' in write).toBe(false)`, not `toBeUndefined()`.

### A drawer's Enter-to-save is proven in a browser, not with user-event
`Drawer` renders Save in its footer, outside the `<form>`, linked by `form="…"`.
- Browsers submit implicitly through that button.
- `@testing-library/user-event` (14.6.1, `keypress.js`) only looks for submit buttons inside the form, so a unit test can't press Enter to save.
- Unit-test the contract instead: Enter is not `defaultPrevented`.
- Cover the real path with a Playwright spec (`e2e/income-fast-path.spec.ts`).

### Amounts stay left-to-right inside Arabic; set it in CSS, not only with `dir`
theme.css sets `:lang(ar) { direction: rtl }` on every element, which out-ranks a `dir="ltr"` attribute. An LTR island (an amount with its currency prefix) needs `direction: ltr` from a selector that out-ranks `:lang(ar)` (`div.input-with-prefix`, `.input-with-prefix > .input`; see also `.num-input`). A summary line that mixes LTR codes and Arabic text wraps each part in `<bdi>`.

### Typeahead Enter: pick, hold, or submit (MUT-5)
In `EntityTypeahead`, Enter does one of three things:
- **Picks** the highlighted option. Typing highlights the first *prefix* match, else the create option, else the only option of a select-only list. A substring match is never highlighted.
- **Is held** (prevented):
  - while an async `onSelect` is still running (the input reports `aria-busy`). Once the pick is saved, the held Enter submits the form (`input.form.requestSubmit()`), if the field still has focus and nothing was typed in between;
  - while typed text no pick has resolved; the list reopens on the auto highlight instead.
- **Reaches the form** when the field is empty or shows a picked/prefilled value.

A consumer's `onSelect` returns its promise when the pick creates a record, and resolves it to `false` when the pick failed: the held Enter is dropped and the typed text is unpicked again, so Enter retries. Keep the typed name in the box after a failed create only when the form refuses to save unpicked text (the client picker's `onPendingTextChange`); otherwise empty it (the project picker). An empty box highlights nothing. A consumer whose options are scored passes `autoHighlight` (default rule: `defaultAutoHighlight` in `typeaheadHighlight.ts`). Escape on an open list stays in the list (`stopPropagation`).

### No literal invisible characters in source
Bidi marks (LRM/RLM/ALM), NBSPs and isolates are written as `\uXXXX` escapes, in regexes and string literals, and in tests too. Literal ones are invisible in review and diffs, and they are a Trojan-Source-style hazard. Check with `perl -CSD -ne 'print "$ARGV:$.\n" if /[\x{200E}\x{200F}\x{061C}\x{00A0}\x{202F}\x{202A}-\x{202E}\x{2066}-\x{2069}]/' <files>`. Isolate an interpolated amount with FSI (U+2068) … PDI (U+2069), which takes the direction of the amount itself.

### A save that arrives during an async pick waits for it
When a picker's choice needs an async write first (creating a client), the picker reports it (`onCreatingChange`). The form holds a submit that arrives meanwhile and runs it once the pick has settled. It neither drops the Enter nor saves without the choice.

### A typed currency must match the entry's currency
`parseAmountInput` accepts one currency symbol or code (USD/ILS/EUR forms only) before or after the number; `amountInputCurrency` says which currency it named. A form compares that with its currency field and refuses a mismatch with a field error naming both, rather than dropping the symbol and saving "€100" as $100. Parsing refuses inputs over 64 characters before any pattern runs, and no pattern may start with an unanchored `\s*` (trim instead).

### Local work runs offline; network work opts in (ADR-040)
The main app's `QueryClient` (`createAppQueryClient`) uses `networkMode: 'always'`, because its queries and mutations hit IndexedDB. A hook that calls the network sets `networkMode: 'online'` itself and gives the user something meanwhile (the FX rate's cached `placeholderData`). Test offline behaviour with `onlineManager.setOnline(false)` and a settle timeout: a paused query never settles.

### A synced write logs what was stored
When a repository may refuse or derive fields (transactions with payment records, ADR-039), the synced wrapper re-reads the entity after the write and logs the stored values: refused fields are not logged, derived changes are. Logging the request instead puts state in the op log that the local database never had.

### One invalidation list per entity family
Hooks for one table that live in two modules (`useQueries` and `useIncomeQueries`) share one exported invalidation function (`invalidateTransactionQueries`) covering both modules' keys. Two hand-copied lists drift, and a save from one module then never refreshes screens built on the other.

---

## Marketing-copy patterns — added 2026-10-11 (MUT-75)

### A claim the page makes about the product is derived from the code that makes it true

**Purpose**: the old landing page drifted from the product (a price with no checkout, a "Universal" build that was arm64-only, two different currency lists). Where code is the source of truth, the copy reads from it:
- an exhaustive `Record<Currency, string>` of name keys, joined with `Intl.ListFormat`, for "which currencies" — adding a currency without naming it fails to compile;
- downloads gated on `useLatestRelease()` (`hasWindowsBuild`), with a plain note instead of a dead link;
- product mock-ups built from the app's own i18n keys, so renaming a button renames the picture of it.

Copy that isn't backed by code (the story, the FAQ prose) stays in i18n, and a test pins the claims that must never appear (`LandingPage.test.tsx`, "honesty").

### A count-up never moves the layout (MUT-76)

Animate the digits on top of the final value, which is laid out with `visibility: hidden` in the same grid cell (`display: inline-grid`, both children `grid-area: 1 / 1`). The box is the final value's size from the first frame, so nothing around it shifts while the number grows. The animating span is `aria-hidden`; a `.sr-only` span carries the final value for screen readers. See `CountUpAmount`.

### Reduced motion in JS is a subscription, not an effect (MUT-76)

Read `prefers-reduced-motion` with `useSyncExternalStore` (`usePrefersReducedMotion`), not `useState` + `useEffect` + `setState` — the React lint rules reject synchronous `setState` in an effect, and the external-store form stays in step with the OS setting for free. Likewise, an animation hook that must "restart" on a new target derives its value (`frame.target === target ? frame.value : 0`) instead of resetting state inside the effect (`useCountUp`).

### A one-shot effect keyed on a URL parameter doesn't cancel on cleanup (MUT-78)

When an effect consumes a URL parameter (reads it, strips it with `replaceState`, then does async work), StrictMode's dev double-mount runs it, cleans it up, and runs it again — and the second run no longer sees the parameter. A `cancelled` flag set in the cleanup then strands the work (the sample stayed "preparing" for good). If the async work only writes to global stores, let it finish; don't cancel. Pin it with a `renderHook` test wrapped in `<StrictMode>` (`useVisitorSample.test.tsx`).

### "Added during the session" is `createdAt >= startedAt` on a database that started empty (MUT-78)

To undo a session without tracking every write, record when it started, and only start it on a database with none of the person's data. Leaving then removes the session's seeded rows by prefix and everything else by `createdAt >= startedAt`; imported or restored rows keep their older `createdAt` and survive (ADR-042).

