# PATTERNS.md — Code Patterns & Conventions

> **Purpose**: Document established patterns to ensure consistency.
> **Rule**: Use existing patterns before introducing new ones.

---

## Pattern Index

| Category | Patterns |
|----------|----------|
| **Data Access** | Repository Pattern, Query Hooks, Mutations, Reconcile on read (MUT-3), Same figure, same entries, split (MUT-83), All-or-nothing batches through `runAtomically` (MUT-87) |
| **State** | URL State (one parsed model per page, MUT-83; kept across a layout's children, MUT-84), Zustand Stores, Form State |
| **Components** | Drawer Pattern, Filter Pattern, Table Pattern, Repair actions open in place, One classification for a live line and its errors, Quiet rows open into their field (MUT-86), Prefixed classes in co-located stylesheets, One row per decision (MUT-87), One `<Drawer>` for a drawer's views (MUT-87), List and detail side by side in one tree, A width code and CSS share is a JS token (MUT-84) |
| **Utilities** | Amount Formatting, Date Handling (`src/lib/dates.ts`), i18n, LTR amounts in RTL text (MUT-3), Ungrouped amount prefills (`minorToAmountInput`, MUT-86) |
| **Sync** | HLC Operations, Conflict Resolution |
| **Testing** | Repository Mocking, Component Testing |
| **Accessibility** | Real `<label for>` for visible labels, accessible names through `t()`, dialogs named by their title, `RowActionsHeader` (TD-009), Arrow keys follow the screen; keys in a control belong to it (MUT-84) |

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

## Sync Patterns (retired)

*Retired 2026-10-12 with device sync (MUT-73, ADR-053).* The HLC-operation and
conflict-detection patterns described code that no longer exists: `src/sync`,
the op-log and its Dexie tables are gone. Do not reintroduce an op-log or an
HLC for a new feature without a new ADR. Moving data between devices is the
JSON backup's job.

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

**Source**: `src/styles/theme.css` is the one token file (ADR-018), in two layers since Brand v2 (ADR-058):
1. **Primitives** `--m-*` in `src/styles/brand/mutaba3a-theme.css`, from `mutaba3a.tokens.json`. Change a value in the JSON first, then the CSS (and the Dart in the Flutter repo); `brand.test.ts` › `drift` fails until they agree.
2. **Semantic tokens** in `theme.css`, each mapped once onto `--m-*` (or a `color-mix(in oklch, …)` over them). No colour literal goes in `theme.css`, and components use semantic tokens, never `--m-*`.

The `--color-*`, `--font-size-*` and `--font-weight-*` names are defined nowhere: a reference to one is a dead style. `brand.test.ts` › `references` fails on any new undefined `var(--x)`; the ones left are allowlisted for MUT-103 (TD-079).

**Quick Reference**:

| Use Case | Canonical Token | Avoid |
|----------|----------------|-------|
| Body text | `color: var(--text)` | `--color-text` |
| Secondary / muted text | `color: var(--text-secondary)` / `var(--muted)` (both ink2, 7:1) | `--color-text-muted`, opacity on text |
| Purple text, links, text buttons | `color: var(--accent-text)` | `color: var(--accent)` (4.77:1; a guard test fails on it) |
| Primary action (filled) | `background: var(--accent-solid); color: var(--on-accent)` | `--accent` + `white` |
| Accent fill, border, decoration | `var(--accent)` | — |
| Selected nav item | `background: var(--nav-item-active); color: var(--nav-item-active-text)` | purple text on lavender (5.52:1) |
| Any text on the lavender ground (`--accent-subtle`): chips, pills, the open row | `color: var(--on-accent-subtle)` (lavender-ink, 7:1) | `--accent-text` or `--muted` on lavender |
| Text on a filled status ink (danger/success/warning button, done step) | `background: var(--error); color: var(--on-status)` | `color: white` (1.5:1 in dark, where the inks turn light) |
| Focus on a filled control | `box-shadow: var(--focus-ring-on-fill)` | the inset `--focus-ring` (paints over the fill); `inset var(--focus-ring)` (invalid: the token is already inset) |
| Background | `background: var(--bg)` | `--color-bg` |
| Card/elevated | `background: var(--surface)` | `--color-bg-elevated` |
| Field | `background: var(--input-bg)` | `--surface` |
| Status | `color: var(--success)` (or `--warning`, `--error`, `--info`) on its `-subtle` ground | `--color-success` |
| Border | `border-color: var(--border)` | `--color-border` |
| Font size | `font-size: var(--text-body)` (or the role: label, headline, title, figure, display) | a px literal |
| Radius | `var(--radius-sm)`, `-md`, `-lg`, `-card`, `-hero`, `-pill` | a px literal |
| Spacing | `padding: var(--space-4)` | Hardcoded `16px` |
| Shadow | `box-shadow: var(--shadow-2)` | `--shadow-md` |
| Focus | `box-shadow: var(--focus-ring)` | `outline: 2px solid` |
| Motion | `transition: transform var(--duration-press) var(--ease-spring)`; scale by `var(--press-scale)` | literal ms (off-brand timing; the tokens also zero under reduced motion, and `--press-scale` goes to 1) |
| Amounts | `font-family: var(--font-mono); font-variant-numeric: tabular-nums` | the body face |

**Type scale** (brand roles; body 16 everywhere, ADR-058):
```css
--text-label: 0.8125rem;   /* 13 */
--text-body: 1rem;         /* 16 — body */
--text-headline: 1.25rem;  /* 20 */
--text-title: 2rem;        /* 32 */
--text-figure: 2.5rem;     /* 40 */
--text-display: 3.5rem;    /* 56 */
/* Legacy aliases until MUT-103 (TD-079): xs, sm → label; base, md, lg → body; xl, 2xl → headline; 3xl, 4xl → title */
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

**Font Families** (all self-hosted; never a CDN):
```css
--font-en / --font-ar: "Thmanyah Sans"                  /* body, both scripts */
--font-heading / --font-heading-ar: "Thmanyah Serif Display" /* h1–h6 at 700 */
--font-mono: "IBM Plex Mono"                            /* figures, tabular */
```
Thmanyah ships 400/500/700 and Plex Mono 400/500 here: ask for one of those weights. A 600 renders as 700 in Thmanyah and as 500 in Plex Mono, because `html` disables bold synthesis. Thmanyah has no `tnum` and no ₪, so set amounts in `--font-mono`. The faces are declared once in `src/styles/brand/fonts.css`; entries import only `theme.css`. The `.otf` files are the delivered bytes (licence: never convert or subset); `brand.test.ts` pins their sha256.

**Blends:** a `color-mix()` between colours of different hue uses `in oklab`. `in oklch` swings the hue the short way round, so lavender-grey and cream meet at pink. `brand.test.ts` refuses an oklch blend across more than 30° of hue.

**Contrast is tested on rendered rules.** `brand.test.ts` › `rendered pairs` checks every rule that sets both a `color` and an opaque `background`. Keep a control's colour and background in the same rule where you can, so the check sees them.

**Light/dark:** a token that differs by mode is a primitive that switches in the brand file, so a semantic token maps once. Only shadow strength, the overlay and `color-scheme` sit in `theme.css`'s per-mode block, in the same three selectors (`:root`; `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) }`; `:root[data-theme="dark"]`). The test evaluator refuses any other selector that declares a custom property.

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

// wrong — captures whatever was active at import time, the bug the deleted
// synced-repository.ts had (MUT-73)
const repos = getRepositories();
```

One family, `base`: the plain Dexie repositories. Until MUT-73 a second
family, `synced`, wrapped some of them to capture device-sync ops; device sync
is retired (ADR-053), so every call site uses `base` and the registry is
`{ base }`. The wrapper object stays so call sites and test overrides
(`setRepositories({ ...real, base: { ...real.base, settings } })`) keep their
shape.

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
A small panel of information plus a control or two (the top bar's exchange
rate) is the same button in dialog mode: `useMenuButton({ kind: 'dialog' })`,
with a labelled `role="dialog"` panel (MUT-79). Don't use a menu for content
that isn't a list of actions.

### Nothing floats over content (MUT-79, decision A1)
The app frame is in flow. Bars that belong to the whole app go inside `<main>`
in `AppShell`. Notices go at the top, before the page (`SampleDataBar`,
`FeatureNoticeBanner`). Offers and updates go at the bottom, after the page,
with `margin-top: auto` (`MacDownloadBanner`, `UpdateBanner`). None of them is
`position: fixed`. Settings-like controls go into the frame itself: the FX
rate in `TopBar`, the theme toggle in the sidebar footer. Only transient
overlays may cover the page: drawers, modals, menus, popovers and toasts. A
top-bar popover lives inside `<main>`, which has `overflow: hidden`, so keep
it inside with `nudgeInside`. To check by hand, sweep the visible `fixed` /
`sticky` (and outside-`absolute`) elements that intersect `<main>` at 1440,
1024, 768 and 375 px; the list should be empty.

### Retiring a feature that stored something (MUT-79)
When you delete a feature, add its localStorage keys to
`RETIRED_LOCAL_STORAGE_KEYS` (`src/lib/retiredStorage.ts`), so existing
browsers drop them at startup.

### Tests never reach the network (MUT-79)
`src/test/setup.ts` replaces `fetch` with a guard that rejects. A component
whose query calls an API (the FX rate) then takes its offline path in every
page test. A test that needs responses stubs `fetch` itself with
`vi.stubGlobal('fetch', …)`. Run the suite with Node 22, as CI does; Node 25+
hides jsdom's `localStorage` (TD-054).

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

Two refinements from MUT-58 (the money-event read side). Re-run the audit on
the branch you delete from, not the one the ticket was written against: the
ticket counted four `invalidateMoneyEventQueries` call sites and main had three.
And when the deleted code was *refreshed by write paths*, the tests that
asserted the refresh are flipped, not just deleted: they now assert that no
`money*` key is invalidated, next to a positive check that the write's own keys
still are, so the negative cannot pass vacuously. The guard
(`noDeadMoneyEventModules.test.ts`) also scans `src/` for the deleted names,
because test files are outside `tsc` and a stale `vi.mock` path would not fail
the typecheck.

A refinement from MUT-73 (device sync): **a retired subsystem's bookkeeping
tables may drop** — the one exception to "tables never go". It needs an explicit
ADR override naming the tables (ADR-053 for the eight sync tables), an argument
that no user record lives only there and no shipped screen could open them, a
migration test that upgrades a database *with* those rows (opens without error,
stores gone, every other row unchanged, a pre-upgrade JSON backup still
restores), and a guard that checks the schema. The Dexie version only declares
`null` for each table; the old version blocks stay verbatim. Remember that
Dexie will not re-run a drop on a native version it has already passed: if a
pre-drop build ever reopens the database, it recreates the stores empty, and
only a later version that re-declares the `null`s removes them again. The guard
for a cross-stack deletion also reads non-TS files: `lib.rs` for IPC commands,
`Cargo.toml` for crates, `package.json` for dependencies.

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

### Two bearer-token kinds are told apart by a distinct prefix, never by trying one then the other (MUT-64)
An API key (`mut_<env>_<prefix>_<secret>`) and a device session
(`mds_<secret>`) both arrive as `Authorization: Bearer <token>`.
`authenticate()` branches on `isDeviceSessionToken(token)` (a prefix check)
*before* attempting either verifier — never "try as a key, fall back to a
session" — so a malformed or wrong-kind token gets the right error without a
second, wasted lookup, and the two verifiers can't be confused with each
other (a pinned test runs each token shape through the other's parser).
Once verified, a device session is the exact same `'session'` `Principal` a
cookie session is (same `writability.ts`/`store-guard.ts`, no new literal) —
only the *transport* is new, not the authorization model. The two share a
`validateSessionRecord` core in `middleware.ts` (digest lookup, expiry, user
validity, touch) parameterized by idle window and rate-limit key prefix, and
a `finishSessionAuth` tail (identity, profile selection, store guard) that
both the cookie and device-bearer paths call — only the cookie-specific CSRF
check sits outside it, since a device bearer has no comparable signal.

### A shared credential-verification core beats two copies (MUT-64)
The portal's cookie sign-in and the native app's device-session sign-in need
the *identical* throttle/lockout/dummy-hash-timing/audit flow — the kind of
"common behavior, not just similar-looking code" worth extracting on its own,
let alone being the highest-risk logic in the ticket. `auth/sign-in.ts`'s
`signIn()` takes the one real difference (`SessionKind`, and the lifetime to
stamp) as parameters; both route files call it and do only their own
transport-specific finish (set a cookie vs. return a token in the body). The
existing route's test suite passing unmodified after the extraction is the
regression proof it didn't change behavior.

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

**Instances**: `src/services/oauth/__tests__/cimd-document.test.ts` (re-states
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
- Cover the real path with a Playwright spec (`qa/specs/web/income.spec.ts`, `@web.income.fast-path`).

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

### ~~A synced write logs what was stored~~ (retired, MUT-73)
The synced wrapper and its op log were deleted with device sync (ADR-053). The underlying lesson still holds for any future audit trail: record what the repository stored, not what was requested.

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


## E2E patterns — added 2026-10-12 (TD-004); moved from `e2e/` to `qa/` 2026-10-12 (MUT-97)

The standalone `e2e/` Playwright suite was retired in favor of the `qa/` release-qa
kit (MUT-97, companion to Malafat's MAL-1007): a feature catalog
(`qa/features/web/*.yaml`) plus one spec per feature, tagged `@web.<area>.<id>`
and run with `release-qa` (`~/Work/tools/release-qa`, `make check-e2e`). The
patterns below are unchanged — only the paths moved.

### A spec starts from a fresh install with `openFreshApp`

Every Playwright test gets an empty IndexedDB, so the Welcome dialog always opens once the profile query answers. `openFreshApp(page, path)` (`qa/support/app.ts`) goes to `/app${path}`, clicks the dialog's "Skip for now" (which creates the default USD profile) and waits for the dialog to close. Never guard the skip with a one-off `isVisible()`: under parallel load the dialog can mount after the check and swallow the next click. Open the drawer from the top bar's "+ Add" › Income (`openNewIncomeDrawer`), which every page has; the empty-state "Add Income" button disappears once there is data. Scope buttons to `main` when the FX banner has one with the same name ("System").

### Axe checks fail on new rules, not on known ones

`expectOnlyKnownAxeViolations(page, surface)` (`qa/support/axe.ts`) runs axe and fails on any rule not listed for that surface in `KNOWN_AXE_VIOLATIONS`. Each listed rule is described in TD-009. A new kind of violation is caught at once, and the existing ones don't hide it or block the suite. When a fix lands, delete its rule from the list. The helper adds an `axe-known-violation-gone` annotation for a listed rule that no longer fires, so the list only shrinks. Check pages with one entry logged (`logIncome`), so the real content renders, not an empty state.

### Exit motion is traced frame by frame with `traceExit`

jsdom has no layout, so a slide-out is proven in the browser. `traceExit(page, selector)` (`qa/support/motion.ts`) follows the next element matching `selector` that is added to the page, frame by frame (`MutationObserver` + rAF), until it leaves; `readExitTrace(page)` returns `{ added, removed, minX, maxX, minOpacity }`. Start the trace before the action, poll until `added` and `removed` are both true, then assert the range: past 100 px toward the inline end, negative in Arabic, x stuck at 0 under `page.emulateMedia({ reducedMotion: 'reduce' })`. The selector names the inert copy the app animates (`.drawer[aria-hidden="true"]` for a drawer's snapshot, `.row-exit` for a list row). That is a probe, not a locator, so it is the one place a spec may use a class. Used by `drawer-motion.spec.ts` (MUT-80) and `home.spec.ts` (MUT-82).

### An Arabic spec switches from Settings and finds controls by the app's own copy

Log the data in English first (`logIncome` uses the English labels), then `switchToArabic(page)` (`qa/support/app.ts`): it opens Settings, clicks العربية and waits for `dir="rtl"`. To find a translated control, read its name from `ar` (`qa/support/i18n.ts`, which loads `src/lib/i18n/translations/ar.json`), as in `ar.clients.split.profile`, so a copy change never breaks a spec. Load it through that module and don't import the JSON in a spec: the root package is ESM, and Node refuses a JSON import that has no `with { type: 'json' }`. User data such as client names stays as typed.

## Accessibility patterns — added 2026-10-12 (TD-009)

### A control with a visible label gets a real `<label for>`
A select or input that has visible label text beside it is named by a `<label htmlFor={id}>`, with the id from `useId()`. A description underneath goes in `aria-describedby`. Don't use `aria-labelledby` for this. Axe's best-practice `label-title-only` checks a labelledby target's *on-screen* visibility, and the app shell clips at `.main-content`/`.app-shell` (`overflow: hidden`). So a label scrolled below the fold reads as hidden, and the rule fails. A `<label for>` is checked for screen-reader visibility only. Settings' rows style it with `.settings-label`, which is `display: block`. A control with no visible label, such as the top bar's period filter, takes an i18n'd `aria-label`.

### Every accessible name goes through `t()`
`aria-label`, visually hidden text and dialog titles are user-facing strings, so they live in `en.json` and `ar.json` like any other copy. For an icon-only button in a list, put the row's subject in the name with a variable ("Actions for {name}"), so a screen reader's button list tells the rows apart. Add new keys to `src/lib/i18n/__tests__/a11yKeys.test.ts`, which checks both locales.

### Dialogs are named by their visible title
A `role="dialog"` points `aria-labelledby` at its heading, using a `useId()` id, never a fixed string: two drawers can be open at once, such as Income with Record payment over it. `Drawer` does this for every drawer.

### A column without a visible title still has a header
The row-actions column uses `RowActionsHeader` (a visually hidden "Actions"), never an empty `<th>`. Axe's `empty-table-header` flags an empty one, and a screen reader announces a nameless column.

---

## Release patterns — added 2026-10-12 (ADR-043)

### Gate before you build, confirm before you commit

A release target runs in a fixed order, and the order is the point:

```
preflight  →  gates  →  version prompt  →  build  →  confirm  →  commit/push/roll
```

- **Preflight is cheap and first.** Every reason a release should not happen — wrong branch, dirty tree, unmerged branch, parked worktree, behind `origin`, wrong `node`, stale `node_modules`, a missing tool or credential — is found in under a second, before anything spends minutes building. `scripts/preflight.sh` reports *every* failure and exits once, rather than dying on the first; an operator fixes the whole list in one pass.
- **Gates that cannot fail the build run before the version bump**, so a failure leaves the working tree exactly as it was. The build runs *after*, because the version is compiled into the bundle (`__APP_VERSION__`).
- **The irreversible step is last and asks.** `scripts/confirm.sh` defaults to no and fails closed when there is no terminal: a release never proceeds because a prompt could not be shown. `AUTO=1` is the only way past it.

### Every override is a named variable

A check that can be bypassed silently is not a check. Preflight's escape hatches are `ALLOW_DIRTY`, `ALLOW_UNMERGED`, `ALLOW_WORKTREES`, `ALLOW_NODE_MAJOR`, `SKIP_REMOTE` — each downgrades exactly one check to a warning and prints why it was downgraded. There is no blanket `--force`.

### Derive configuration, then verify it

Do not ask an operator for a value the repository already knows. `GCP_PROJECT_ID` is read from `project_id` in `<environment>.tfvars`, `TF_STATE_BUCKET` from the backend of the last `terraform init`. Because a derived value could be wrong, preflight re-derives both independently and **fails on a mismatch** — a project that disagrees with the tfvars would push an image to one project and apply infrastructure in another. Derivation removes setup friction; verification is what makes it safe.

### Prompt output goes to stderr

Anything read back by `$(...)` must print its UI to stderr and only the answer to stdout — otherwise the menu is captured instead of shown, and the caller receives the menu text as the answer. Read from `/dev/tty` where there is one, falling back to stdin, and probe the terminal by *opening* it (`exec 3</dev/tty`) rather than testing the path: `/dev/tty` can exist and still refuse to open.

### A release commit names only the release

`git add` lists the version files explicitly — never `git add .`, which sweeps whatever was dirty into a commit labelled as a release. Preflight's clean-tree check is what makes an explicit list sufficient.

### Reuse the rollout, own only the order

`make` does not reimplement a deploy. The server roll stays `server/scripts/deploy.sh`; the app-version write is `deploy.sh`'s `update_version`, sourced rather than copied, so the list of files carrying the version has one definition. When sourcing a script that also runs interactively, guard its entry point (`[[ "${BASH_SOURCE[0]}" == "${0}" ]]`) and namespace your own variables — `deploy.sh` defines `$GREEN` and friends as literal `\033` strings for `echo -e`, which silently corrupts a `printf '%s'` caller that uses the same names.
## Motion patterns — added 2026-10-12 (MUT-80, ADR-044)

### A close is immediate; the exit is presentation
Never delay a state change for an animation. A drawer's `onClose` runs at once and its owner unmounts it. The exit is played by an inert, `aria-hidden` clone of the last frame (`captureExitSnapshot`), so it can't show reset or reloading content and can't be clicked. Only a motion the component commits itself (a drag dismiss) runs live and calls back at the end, which is what makes it catchable.

### Animate from a motion value; write styles yourself; clear them at rest
Drive `transform`/`opacity` from `motionValue`s with `.on('change', paint)`, not React state; React never renders per frame. At rest, clear the inline transform (and opacity at 1): a transform makes the element the containing block for `position: fixed` descendants. To interrupt, `stop()` the controls and read `value.get()`, which is the presentation value. Read `getVelocity()` *before* `stop()`. A stopped animation never fires `onComplete`, so a cancelled exit can't call back.

### Gesture rules are pure; physics is shared
Thresholds, release decisions, rubber-banding and opacity mapping are pure functions (`drawerGesture.ts`) with unit tests. Physics that any draggable thing reuses lives in `src/lib/motion/physics.ts`. Push a sample at `pointerup`, so a pause before release reads as zero velocity. On `pointercancel` use zero velocity: its coordinates are unreliable.

### No layout, no motion
A motion that needs a measured size (`offsetWidth`) skips itself when the size is 0. That keeps jsdom component tests synchronous without a test-only branch. Tests that exercise motion stub `offsetWidth` for the element (`DrawerFrame.test.tsx`).

### Telling a real unmount from StrictMode's rehearsal
In a layout-effect cleanup, capture what you need while the DOM still exists, then decide in a `queueMicrotask`: if the node is still `isConnected`, it was StrictMode's simulated unmount, so do nothing. Focus return uses the same check.

### Hidden documents pause motion
`requestAnimationFrame` doesn't run while the document is hidden (a backgrounded window, or the hidden preview pane). Measure motion in Playwright (`traceExit` in `qa/support/motion.ts`, a `MutationObserver` + rAF), not in a hidden pane.

---

## App patterns added by MUT-86 (2026-10-12)

### A live line and its errors read one classification
When a field shows a live answer under it (the payment drawer's "Paid in full" or "₪1,775 still owed"), classify the typed text once, with a pure function that returns a tagged union (`describePaymentAmount`). The live line and the submit check both switch on that one result, so the line can never promise what the button then refuses. Show answers and definitive problems (an overpayment) live. Show states a valid value passes through while it is being typed (an unreadable "1,2" on the way to "1,200", an empty field) only after submit, and clear them on the next change.

### A quiet row opens into its field in place
A secondary field with a sensible default (the payment date, "Today ›") or one that is usually empty ("+ Add note") is a quiet button that is replaced by the labelled field when pressed. Focus moves to the field only when the user opened it: set a `focusTarget` state in the click handler and focus it in an effect keyed on that state. A field open from the start, such as an edited record's notes, never steals focus from the main field. Mirror chevrons in RTL with `[dir="rtl"] … { transform: scaleX(-1) }`.

### Prefill an amount ungrouped, with cents as two digits
Under MUT-5's strict grammar, deleting a digit from a prefilled "3,550" leaves "3,55", which can't be read. Prefill amount fields with `minorToAmountInput`: "3550" or "887.50". It uses integer arithmetic, never `String(minor / 100)`, which gives "887.5".

### A co-located stylesheet prefixes its classes with the component
`index.css` still has short global names with fixed sizes from older screens (`.payment-row`, `.payment-amount { width: 120px }`, used by the document forms). A component's own stylesheet uses a prefix (`pay-drawer-…`) so that it can't pick those rules up. Grep `src/**/*.css` for a class name before using it.

---

## Inbox patterns — added 2026-10-12 (MUT-66)

### A user-owned resource, where everything else is organization-owned

`InboxEntry` is the first server-side row that belongs to a person rather than to an organization. The shape to copy, if there is ever a second:

- **Every repository method takes `userId` first**, exactly where the ledger's take `organizationId`. Cross-user reads are then impossible by construction, not by a filter someone has to remember — the same guarantee ADR-025 point 2 gives the ledger, one ownership axis over.
- **No FK to `Organization` or `Membership` at all.** This is what makes "survives losing every membership" a structural fact instead of a guard or a cleanup job. Guard it with a DMMF test (`inbox-ownership.test.ts`), so a later edit that adds an innocent-looking `organizationId` fails immediately rather than surfacing as a support ticket about vanished rows.
- **Its routes send no `X-Mutaba3a-Profile` and declare no scope**, following `GET /v1/me`, and join the organization-independent set through their own exported module rather than editing `routes/sessions.ts`.
- **In the store guard it is `'sessionOnly'`** — neither `control` ("any principal": an API key has no person behind it, so no inbox) nor a matrix `Domain` (which is per-organization by construction).

### Claim-then-write: a cross-repository transaction that cannot double-write

When one call must create a record *and* consume the thing it came from, do not check-then-act. Delete the source row **inside** the transaction first, and let the delete be the check:

```ts
const { count } = await tx.inboxEntry.deleteMany({ where: { id, userId, kind } });
if (count !== 1) return { kind: 'not_found' };          // unknown, foreign, wrong kind, or already filed
return { kind: 'filed', expense: await createExpenseRow(tx, input, at) };
```

The delete proves ownership and holds the row lock until commit, so of two concurrent calls exactly one proceeds; and because the financial insert is in the same transaction, a failure rolls the delete back with it. One shape gives both "exactly once" and "on failure it stays untouched".

The in-memory store simulates it by removing the entry **synchronously, before any await** (so two concurrent calls cannot both see it) and restoring it in a `catch`.

### Splitting a repository create so it can be composed

To let an existing create participate in a larger transaction, extract its row insert to take an explicit handle and leave the public method as the one-statement caller:

```ts
create: (input, at) => createExpenseRow(this.prisma, input, at),   // implicit transaction
// filing: createExpenseRow(tx, input, at) inside its own $transaction
```

Behaviour is unchanged and no rule is duplicated — only the transaction boundary moves outward. `settleReceivable(tx, …)`, `createPaymentTx` and `createAdjustmentTx` are the existing instances of this idiom.

### Validate everything before the transaction opens

All destination-side validation — writability, link resolution, category/customer/project existence, future dates — runs in the route, before the repository method that would consume the source row is called at all. "On failure it stays untouched" is then structural: a refusal never reaches the code that could delete it, and `READ_ONLY_PROFILE`/`INSUFFICIENT_SCOPE` are refused in middleware before the handler runs. Assert it with a spy proving zero store calls, not only by observing the row afterwards.

### Prove an isolation claim structurally, not just behaviourally

"Unsorted entries never change any summary" is asserted twice: once by comparing whole summary responses before and after filling an inbox, and once by reading the summary sources — enumerated from the directory so a module added later is covered — and finding no reference to the table. The second keeps the first from being a coincidence that a future query could quietly break.

---

## App patterns added by MUT-87 (2026-10-12)

### A batch of writes is all or nothing, through the repository
When one user action writes several rows (marking three months paid writes three expenses and three occurrences), run it in one storage transaction so a failure leaves nothing half done. Services can't open one themselves: they reach storage only through `getRepositories()` (ADR-002). The repository offers a unit of work instead, `recurringOccurrences.runAtomically(work)`, and the service loops over the **existing** single-row functions inside it (`confirmPayments` → `confirmPayment`), so the rules for one row are written once. The Dexie implementation is `db.transaction('rw', [every table the work touches, reads included], work)`; repository calls inside join it through Dexie's zone. `work` may await only repository calls: a timer or a `fetch` inside commits the transaction early. Test it with fake-indexeddb by making the second write reject (`vi.spyOn(repo, 'create').mockImplementationOnce(original).mockRejectedValueOnce(...)`) and asserting the tables are empty (ADR-052).

### One row per decision, not one card per item
A list that asks the user to act should show one row per thing they decide about, not one card per underlying record. The Expenses Needs attention list groups a rule's missed payments into one row ("Aug, Sep, Oct not marked · $240") with one primary action; the less common actions go in a ⋯ menu (`useMenuButton`) and apply to the whole group; per-item choices live in the drawer the primary action opens. The grouping is a pure, tested function the page calls in `useMemo` (`groupOccurrencesByRule`), and the drawer looks its group up live by key, so an item resolved inside it drops out.

### One `<Drawer>` for a drawer's views
A drawer with a second step (the mark-paid drawer's snooze view) renders a single `<Drawer>` and swaps its body and footer by state. Returning a different component that each renders its own `<Drawer>` remounts the shell, which replays the open animation and loses state the first view held (checks, typed amounts). Keep that state in the component that owns the `<Drawer>`.

---

## App patterns added by MUT-83 (2026-10-12)

### Two screens that show the same figure read the same entries, then split them
When two screens show the same money figure, such as Home's and the Clients list's Owed now (ADR-049), both read the same set of entries through the same repository call. A screen that breaks the figure down does so with a pure partition of that set: `partitionOwedNow(entries, clients, today)` puts every entry in exactly one part. Its total is the one helper (`summarizeOwedByCurrency`) over the whole set, so it equals the other screen's figure by construction, and the parts add up to it. Never compute the total by adding up the parts from a second query, and never filter the set differently on one screen. A parity test seeds a fixture with every kind of row that could fall between the screens (no client, gone client, archived client, archived entry, another business's entries) and asserts both reads are equal. Pass the partition entries and clients, not a business id, so a multi-business lens can reuse it.

### A row that isn't a record says so, and never sorts with the records
Debts that belong to no listed client are muted rows ("No client · N", "Archived clients · N"), shown only when non-zero. They are appended after the sorted records by a function that returns tagged items (`orderClientIndex` → `{ type: 'client' | 'bucket' }`). A big bucket can't rank above a client, and the column sort never sees it. Each one opens the list of the entries behind it.

### A page's filters are one URL model with a pure parser
A main-app page whose filters a link must be able to set keeps them as one object in the URL:
- **A pure module** (`src/lib/incomeSearch.ts`) holds the type, the parser (`parseIncomeSearch`, also the route's `validateSearch`), the merge that drops cleared fields, and the resolver that fills in defaults.
- **A small hook** (`useIncomeFilters`) reads with `useSearch({ strict: false })` and writes with `navigate({ search: prev => merge(prev, patch), replace: true })`.

Rules:
- With no parameters the page must behave exactly as before.
- The parser drops unknown values instead of throwing. The router parses `?q=2026` as a number, so read it back as text.
- Write only the fields that differ from the defaults.
- Test the hook once on a real memory router. In page tests, stand in for it with an in-memory `useState`, so the page's existing interaction tests keep working without a router.

---

## App patterns added by MUT-62 (2026-10-12)

### A row's title is a button that opens the row
A clickable table row (`tr.clickable` with `onClick`) can't be reached from the keyboard. Put the row's title in `TruncatedTitle`, whose button opens the same record. Its click stops propagation, so the record opens once. The clients index does the same with a `<Link>` on the name. An untitled row shows `EMPTY_CELL` as plain text; it has no button yet (TD-076).

### A cut cell shows its full text on hover and on focus
A `title=""` attribute only shows on hover, so a keyboard user never sees the rest of a cut cell. Use `TruncatedTitle`. It measures whether the text is actually cut and only then shows a tooltip portalled to `<body>` (`.data-table` scrolls and would clip it). The tooltip is hoverable, Escape dismisses it, and it is `aria-hidden` because the button's name already holds the full text. The cell is `td.work-cell` (`width: 40%; max-width: 0`), so it takes the spare width instead of widening the table. A date beside it is `td.date-cell` (`nowrap`).

### Text the user typed takes its own direction
Titles, names and notes may be Arabic in the English UI or English in the Arabic one. Give the element `dir="auto"` **and** `unicode-bidi: plaintext`. The attribute alone loses to theme.css's `:lang(ar) { direction: rtl }` (TD-048): an English title in the Arabic UI then shows its end, cut at the front. `plaintext` takes the paragraph direction from the first strong letter whatever `direction` says, so the ellipsis lands at the text's real end.

### A hand-written table renders its header and cells from one column list
The main app has no `DataTable` (see the registry's correction). A page-local table that hides columns by width keeps one module-level column list: key, i18n header key, header and cell classes, `wideOnly`. The page picks the wide or compact array, and the header and every row map over it, with a `renderCell(key, row)` switch for the cells. Precompute both arrays at module level, so they are the same objects on every render (stronger than `useMemo([])`). Shape the rows in `useMemo([result])` with a pure `toXRow`. See `src/pages/income/incomeRows.ts`.

---

## Desktop patterns added by MUT-73 (2026-10-12)

### Smoke a desktop debug build without touching the owner's data (MUT-73)

A debug build of the Tauri app shares the installed app's config directory (keyed by the identifier) and, when unbundled, a WebView data directory keyed by the executable name (`~/Library/WebKit/app` is the owner's `tauri dev` data). So:
- build with an overridden identifier: `npx tauri build --debug --no-bundle --config '{"identifier":"com.elmokhtbr.mutaba3a.mut73"}'` (add `"build":{"beforeBuildCommand":""}` to embed a hand-patched `dist-desktop`);
- copy the binary to a unique name before launching, so WebKit writes to `~/Library/WebKit/<that name>`;
- record the mtimes of the real and dev WebKit directories before launch and compare after;
- with no way to drive the webview, let an injected throwaway script report through the app itself: each outcome binds a different loopback port with `bind_oauth_callback`, and the shell reads `lsof -iTCP -sTCP:LISTEN`. Avoid `setTimeout` in that script: an occluded WKWebView throttles timers until they effectively stop;
- a capability for the smoke only goes inline in the same `--config` (`app.security.capabilities: ["default", {...}]`), never in `capabilities/`;
- delete the isolated config, WebKit, cache and log directories afterwards.

---

## App patterns added by MUT-84 (2026-10-12)

### List and detail side by side in one tree
A page that shows a record beside its list on a wide window and alone on a narrow one is a layout route whose component always renders the same panes, in the same order: list, then `<Outlet />`. Width and selection change only a `data-layout` attribute and the panes' `hidden`. Never return a different tree per width (`if (wide) return <Split/>`): a resize would remount the record and lose what was typed in it. A pane's own `display` rule beats `[hidden]`, so the stylesheet restores it (`.clients-split > [hidden] { display: none }`). Give the detail route `remountDeps` keyed on its id when each record should start fresh. That remounts on a record switch and never on a resize. Test the no-remount promise with a stub that counts mounts and holds a typed value across a simulated `matchMedia` change (`ClientsLayout.test.tsx`).

### A width that code and CSS share is a JS token
CSS media queries can't read custom properties, so a breakpoint that changes behaviour (keyboard handling, history) as well as layout lives in `src/lib/breakpoints.ts`. A hook reads it through `matchMedia` (`useIsSplitView`), and the component sets a data attribute that the stylesheet keys off. Don't write the same number into a media query too. Measure the number in the browser with the content that has to fit, and say in the comment what fits.

### Arrow keys follow the screen; keys in a control belong to the control
When ← and → move between columns, map them by where things are on the screen: in Arabic the columns mirror, so the key toward the detail is ←. Keep the mapping in a pure function of `(key, direction)`. A pane-level key handler leaves alone:
- any key whose target is a text field, a select or contenteditable;
- anything inside an open menu, listbox, dialog, tablist, radiogroup or combobox;
- a button with `aria-expanded="true"`;
- an event already `defaultPrevented`;
- any held modifier (Alt+← is the browser's Back).

`keyBelongsToControl` and `hasModifier` (`clientsSplitView.ts`) are that check. A React handler on a pane also sees keys from portals rendered by its children (the ⋯ menu), which is why the role check matters.

### Walking replaces history; opening pushes
Keyboard selection that the detail follows (↑/↓ through a list) writes the URL with `replace`, except for the first open from no selection, which pushes. Back then closes the detail instead of replaying every step. A click on a row's link stays a link and pushes. Carry the list's URL model along (`search: true`) on every link and walk, so switching records never resets the list.

---

## App patterns added by MUT-82 (2026-10-12)

### Two blocks that must change together read one query
When a save has to change two parts of a screen in the same frame (Home's Owed now and the Needs attention row), give both the same query and derive each part with a pure selector (`selectAttentionReceivables`). One refetch notifies every observer of a query in one batch, so React commits both changes together. Two queries resolve in separate tasks and can paint a frame apart. If the repository already had the rule (`getAttentionReceivables`), move it into the selector and have the repository call it, so it stays defined once. Prove it with a `MutationObserver` that records every DOM batch and asserts no batch shows one change without the other (`HomeNeedsAttention.test.tsx`).

### A drawer tells its opener what it saved
An app-wide drawer that a screen opens can report back through an optional callback in its open options (`openPartialPaymentDrawer({ transactionId, onRecorded })`). The store carries it, `AppShell` passes it as a prop, and the drawer calls it with the saved record **before** it closes, so the opener can act while focus is still in the drawer. Keep it optional: every other opener behaves as before. Report creations only, not edits or deletes, unless the opener needs them.

### Undo deletes what the save created, through the repository
For a record that owns derived state (payment records own an entry's status, remaining and paidAt), Undo deletes that record through the repository path that recalculates, rather than snapshotting and writing the old fields back. Offer it in a toast with a `group`, so a newer Undo replaces an older one, and make the action need only the record's id, so it still works after the screen that offered it is gone (`usePaymentUndo`).

### A row leaving a list is a snapshot over its container
The ADR-044 rule for rows: the data change is immediate and the exit is presentation. The row component hands its element to the list from a layout-effect cleanup, while it is still in the document (`onLeave`), and the list captures it with `captureRowExit(row, container)` only when its own action caused the departure. In a microtask: if the row is still connected it was StrictMode's rehearsal; otherwise `play`. The copy is laid over the container, not put back in the table, so the list can switch to its empty state at once. Copies strip their ids, and so do drawer snapshots: an id in a copy can capture a `form=` or `for=` meant for the live element.

### Hand focus on before the element holding it goes
When an action removes the element that will hold focus (the drawer returns focus to the row's button, and the row is about to leave), move focus to its successor at the moment the action succeeds (the next row's button, else the previous one's, else the section heading with `tabIndex={-1}`). Waiting for the removal is order-dependent: if the row leaves before the drawer closes, the drawer finds its trigger gone and focus falls to the page. When Undo brings an element back and focus was lost with the toast, give it back to the restored element on mount.

### A card that gets narrow reflows by container query
A list inside a card that is narrow on a phone and also in a two-column layout on a small window (Home's cards) reflows with `container-type: inline-size` on the card and `@container (max-width: …)`, not a viewport media query. For a table, switch `table`/`tbody` to `display: block` and each `tr` to a grid, move the borders from cells to rows, and give the action cell `grid-column: 1 / -1`.

---

## App patterns added by MUT-81 (2026-10-12)

### A save is claimed by whichever list renders it, resolved from what the lists report -- never a global fetch counter
When a save needs to be found again by any one of several lists that might render it (a client profile's entry row and its payment row; a page that might or might not currently show it), give every list a `useSavedFlashRows(listId, ids, queryResult)` call that registers itself and reports `settled = !isLoading && !isFetching` on its own render. A shared store resolves "claimed" the instant any registered list's settled ids intersect the pending save, and "not claimed" only once **every** registered list has reported settled with no match. Watching a single global `useIsFetching()` for 1→0 looks simpler but is wrong: it counts every unrelated query on the page, and TanStack Query has a documented case where invalidating during an in-flight initial fetch reuses that fetch's promise and settles with no trailing refetch, so the global counter can hit zero while a list still holds pre-save data. Derive `settled` inside the hook, not from a value the caller passes in, so no list can get it wrong by using `!isLoading` alone. See `src/lib/savedFlashStore.ts`, `src/hooks/useSavedFlash.ts` (ADR-057).

### An unconditional drawer call covers callers that pass no opt-in callback
Some callers of a shared drawer pass an optional callback for a side effect (Home's `onRecorded`, for Undo); others pass none at all. If a second feature needs the same "a save happened" signal for every caller, it cannot ride the optional callback -- it must call from inside the drawer itself, unconditionally, after the mutation resolves. A caller that needs to suppress that signal for one specific case (Home's full-payment row, which already has complete feedback from its own slide-out) does so by undoing the effect synchronously in its own optional callback, which runs in the same tick right after -- not by asking the drawer to skip the call in the first place. Confirm which callers actually pass the optional callback with a grep before assuming it is a universal hook point (MUT-81 eng review: `ClientWorkSection` and `IncomePage` pass none).

### A background wash needs a second channel when the app already uses that token for "selected"
A transient "this just changed" highlight that reuses an existing subtle-background token (`--accent-subtle`) will look identical to every other place that token already means "selected" or "active" -- and a flat wash is easy to miss if the eye is not already on the row. Add a second, cheap signal that reads in peripheral vision: a 3px leading rail on the logical inline-start edge (`box-shadow: inset 3px 0 0 var(--accent)`), so it mirrors correctly under `dir="rtl"` for free.

---

## App patterns added by MUT-89 (2026-10-12)

### A view that applies to some routes only: tag the routes, sync one flag, keep data off it
When a mode belongs to a few screens ("All businesses" on Home and Clients):
1. Tag those routes with TanStack Router's `staticData` (typed by augmenting `StaticDataRouteOption`). A layout route's tag covers its children.
2. One hook in AppShell reads `useMatches()` and writes a store flag in a layout effect, so the chrome (switcher, top bar, drawers) never paints a stale state.
3. Hooks and drawers read the store, not the router, so they stay testable without one.
4. **The tagged screens' own data must not wait for the flag:** it is set after the first render, and waiting would double-read and flash. They know what they are, so give them their own hook (`useOwedLens`).

### A query that waits is pending, not loading
In TanStack Query 5, `isLoading` is `isPending && isFetching`, so a query with `enabled: false` reports `isLoading: false`. A page that decides an empty or new-user state from `isLoading` will flash it while the query waits. Decide on `isPending`, or on the value the query waits for (`scope === undefined`).

### A blank id must not mean "everything" while it loads: gate at the root
Repository reads treat a falsy business as "every record". Rather than guarding each page, `BusinessesGate` in AppShell mounts the routed page only once the businesses have loaded, the way AppShell already holds it while the visitor sample is prepared. New pages inherit the guard.

### Pick and repair are different setters
When a store value can change because the user chose it or because the app repaired it (a deleted working business), give each its own setter. `setActiveProfile` (a pick) turns All businesses off; `setWorkingProfile` (a repair or a drill-down) keeps it. A background fix must never undo a choice the user made.

### A flag derived from the route does not belong in a persisted store
zustand's `persist` writes the partialized state to localStorage on every `set`, whatever `partialize` keeps. A value that changes on navigation (the owed-screen flag) would rewrite the saved choice on every route change, and overwrite a choice another tab just saved. Keep derived, per-tab state in its own unsaved store (`useOwedScreenStore`) next to the persisted one.

### A popover opened from a menu item remembers where the item was
A menu closes (and unmounts its items) as soon as an item is chosen. A follow-up popover anchored to that item must capture the item's rectangle when it opens, never re-measure it. It also needs to take focus itself and know which mounted element to give focus back to (the menu's button), because the item it would return to is gone (`useProfileAwareAction.trigger(event, returnFocus)`).

