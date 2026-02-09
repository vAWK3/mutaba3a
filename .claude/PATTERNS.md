# PATTERNS.md — Code Patterns & Conventions

> **Purpose**: Document established patterns to ensure consistency.
> **Rule**: Use existing patterns before introducing new ones.

---

## Pattern Index

| Category | Patterns |
|----------|----------|
| **Data Access** | Repository Pattern, Query Hooks, Mutations |
| **State** | URL State, Zustand Stores, Form State |
| **Components** | Drawer Pattern, Filter Pattern, Table Pattern |
| **Utilities** | Amount Formatting, Date Handling, i18n |
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

All dates stored as ISO strings. Use helpers for display and calculations.

```typescript
// src/lib/utils.ts

export function formatDate(isoDate: string, format: 'short' | 'long' = 'short'): string {
  const date = new Date(isoDate);
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: format === 'short' ? 'medium' : 'long',
  }).format(date);
}

export function todayISO(): string {
  return new Date().toISOString().split('T')[0];
}

export function nowISO(): string {
  return new Date().toISOString();
}

export function daysBetween(date1: string, date2: string): number {
  const d1 = new Date(date1);
  const d2 = new Date(date2);
  return Math.floor((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24));
}

export function isOverdue(dueDate: string): boolean {
  return dueDate < todayISO();
}

// Month range helpers
export function getMonthRange(monthOffset = 0): { from: string; to: string } {
  const now = new Date();
  const targetMonth = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1);
  const from = targetMonth.toISOString().split('T')[0];
  const lastDay = new Date(targetMonth.getFullYear(), targetMonth.getMonth() + 1, 0);
  const to = lastDay.toISOString().split('T')[0];
  return { from, to };
}
```

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
const EngagementsPage = lazy(() => import('./pages/engagements/EngagementsPage'));

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
