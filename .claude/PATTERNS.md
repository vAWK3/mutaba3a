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
// Illustrative. The living example is useIncomeFilters (/income); the old
// src/hooks/useTransactionFilters.ts and CurrencyTabs were deleted (TD-143).

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

A test about "today" passes in daytime whether the code reads the local or the
UTC date. Pin an instant where the two differ instead: `atInstantIn(timeZone,
instant, fn)` (`src/test/atInstantIn.ts`, data-layer tests without `waitFor`)
sets `TZ` and fakes only `Date`, e.g. `atInstantIn('Asia/Jerusalem',
'2026-10-13T22:30:00.000Z', …)` is 01:30 on the 14th locally and the 13th in
UTC. `paymentRecords.test.ts` uses it.

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
const InsightsPage = lazy(() => import('./pages/insights/InsightsPage'));

// Route definition
{
  path: '/insights',
  component: () => (
    <Suspense fallback={<PageSkeleton />}>
      <InsightsPage />
    </Suspense>
  ),
}
```

---

## Error Handling Patterns

### Pattern: Repository Errors

Throw typed errors for business rule violations.

```typescript
// Custom error (src/db/repository.ts)
export class PaymentRecordError extends Error {
  paymentRecordId?: string;
  transactionId?: string;
  constructor(message: string, opts?: { paymentRecordId?: string; transactionId?: string }) {
    super(message);
    this.name = 'PaymentRecordError';
    this.paymentRecordId = opts?.paymentRecordId;
    this.transactionId = opts?.transactionId;
  }
}

// Throw in repository (paymentRecordRepo.create: overpayment, ADR-030)
if (otherPaymentsMinor + data.amountMinor > tx.amountMinor) {
  throw new PaymentRecordError('Payment exceeds the remaining balance', { transactionId: tx.id });
}

// Catch where the save happens (IncomeDrawer)
const message = name === 'PaymentRecordError' ? t('drawer.income.savePaymentsChanged') : t('drawer.income.saveFailed');
```

---

## Design Token Patterns

### Pattern: Canonical Design Tokens

**Source**: `src/styles/theme.css` is the one token file (ADR-018), in two layers since Brand v2 (ADR-058):
1. **Primitives** `--m-*` in `src/styles/brand/mutaba3a-theme.css`, from `mutaba3a.tokens.json`. Change a value in the JSON first, then the CSS (and the Dart in the Flutter repo); `brand.test.ts` › `drift` fails until they agree.
2. **Semantic tokens** in `theme.css`, each mapped once onto `--m-*` (or a `color-mix(in oklch, …)` over them). No colour literal goes in `theme.css`, and components use semantic tokens, never `--m-*`.

The `--color-*`, `--font-size-*` and `--font-weight-*` names are defined nowhere: a reference to one is a dead style. `brand.test.ts` › `references` fails on any new undefined `var(--x)`; MUT-103 emptied the dead-reference allowlist that used to sit here, and the test now simply fails on any new one.

### Pattern: No Literal Colour, Radius, Font Size or Spacing Outside `src/styles` (MUT-103, MUT-165)

Every colour, px radius, px/rem font size and px/rem spacing outside `src/styles/` comes from a token — never a hex, `rgb()`/`hsl()`/`oklch()` function call, `white`/`black`, or a literal px/rem. `brand.test.ts` › `literals` (`cssLiterals`/`scriptLiterals` in `src/test/css/brandCss.ts`) enforces this on every `.css`/`.ts`/`.tsx` file; `KNOWN_LITERALS` is the shrink-only escape hatch while a surface is mid-sweep (empty since MUT-165 finished).

- **Spacing (MUT-165, ADR-089)**: `padding*`, `margin*` (physical and logical), `gap`, `row-gap`, `column-gap` take a `--space-*` step, `0`, `auto`, `%`, `em`, or `calc()` over tokens. A negative is `calc(var(--space-2) * -1)`; a hairline is `var(--space-px)`; a token never carries a px fallback (`var(--space-4, 16px)` fails). In a TSX style object, write `gap: 'var(--space-2)'`, never `gap: 8`. A size past the scale that one surface needs (a banner's height and the offset that clears it, the landing's section rhythm) is a named token in `theme.css`'s Layout block (`--demo-banner-height`, `--checkbox-size`, `--landing-*`), used for both the size and the offset — not a new scale step, and not `calc()` arithmetic that hides what it means.
- **No local length variables for spacing**: `--pad: 8px; padding: var(--pad)` fails (the guard follows one `var()` hop). A component custom property read by spacing is set from a token (`--pad: var(--space-2)`).
- **The scale lives in the brand JSON first** (`space`, mirrored as `--m-space-<n>`; `--space-N` = N × 4px). Adding a step means the JSON, then `mutaba3a-theme.css`, then `theme.css` (the drift tests fail otherwise).

- **The only allowed literals are user data**: a business's or expense category's own colour (`ALLOWED_LITERAL_FILES`, each with a reason — e.g. `src/components/ui/profileAvatarStyle.ts`'s `DEFAULT_BUSINESS_COLOR`). Nothing else is exempt.
- **No `<style>` element in TSX.** An inline stylesheet is invisible to the CSS guard; move it to a co-located `.css` file (e.g. `RecurringMarkPaidDrawer.css`).
- **A fluid `clamp()` still takes tokens for its floor and ceiling** — `font-size: clamp(var(--text-title), 4vw, var(--text-figure))`, never a raw rem on either end; only the `vw` middle term is a literal.
- **A one-off formula with a dynamic input** (e.g. a per-item hue) is a primitive in `mutaba3a-theme.css` (`--m-*`, with a `var(--x, fallback)` for the part a component sets inline), mapped once onto a `theme.css` role — not a literal colour function in a component stylesheet. See `--m-avatar-mock-fill` / `--landing-mock-avatar-fill` (the landing business-switcher mock).
- **A mono amount never carries `--weight-semibold`/`--weight-bold`.** Plex Mono ships only 400/500; `font-weight: var(--weight-medium)` is the heaviest a `--font-mono` rule may ask for in the same rule, or the browser synthesizes a fake bold. `brand.test.ts` checks this per-rule (same declaration block only — a child selector that bumps weight without redeclaring `font-family` isn't caught, so check by eye too).
- **`tabular-nums` without `--font-mono` in the same rule does nothing** (Thmanyah has no `tnum`); `KNOWN_TABULAR_WITHOUT_MONO` is the shrink-only list (empty since MUT-103).

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
| Radius | `var(--radius-xs)`, `-sm`, `-md`, `-lg`, `-card`, `-hero`, `-pill` | a px literal |
| Spacing | `padding: var(--space-4)`; inline `style={{ gap: 'var(--space-2)' }}`; negative `calc(var(--space-2) * -1)` | `16px`, `1rem`, `gap: 8`, `var(--space-4, 16px)` (the guard fails on each) |
| Shadow | `box-shadow: var(--shadow-2)` | `--shadow-md` |
| Focus | `box-shadow: var(--focus-ring)` | `outline: 2px solid` |
| Motion | `transition: transform var(--duration-press) var(--ease-spring)`; scale by `var(--press-scale)` | literal ms (off-brand timing; the tokens also zero under reduced motion, and `--press-scale` goes to 1) |
| Amounts | `font-family: var(--font-mono); font-variant-numeric: tabular-nums` | the body face |

**Type scale** (brand roles; body 16 everywhere, ADR-058; `--text-micro`/`--radius-xs` added by MUT-103's D1):
```css
--text-micro: 0.6875rem;   /* 11 — the smallest a figure or label ever goes */
--text-label: 0.8125rem;   /* 13 */
--text-body: 1rem;         /* 16 — body */
--text-headline: 1.25rem;  /* 20 */
--text-title: 2rem;        /* 32 */
--text-figure: 2.5rem;     /* 40 */
--text-display: 3.5rem;    /* 56 */
```
No alias names remain (`--text-xs/sm/base/md/lg/xl/2xl/3xl/4xl`, `--radius-xl/2xl/full`): MUT-103 migrated every call site onto the roles above and deleted them from `theme.css` and `FROZEN_THEME_NAMES`.

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

### Pattern: Select Styling

Dropdowns use the shared `Select` component (`src/components/ui/Input.tsx`, exported from the `src/components/ui` barrel) with CSS from `Input.css`. It wraps a native `<select>` with brand tokens (`--input-*`, `--radius-md`, 16px body text) and a custom chevron — a raw `<select className="select">` no longer carries any styling of its own (the stale global rule in `index.css` was removed, MUT-103 dropdown sweep).

**Never render a raw `<select>` in app/portal screens.** Use the component:

```tsx
<Select label="Currency" {...register('currency')}>
  <option value="USD">USD</option>
  <option value="ILS">ILS</option>
</Select>
```

Takes `<option>` children like a native select, not an `options` array. For `react-hook-form` + `Controller` call sites that already render their own `<p className="form-error">` next to the field, use `invalid` for a style-only error border instead of `error` (which would also render a second, duplicate message):

```tsx
<Controller
  name="profileId"
  control={form.control}
  render={({ field }) => (
    <Select invalid={Boolean(form.formState.errors.profileId)} {...field}>
      ...
    </Select>
  )}
/>
{form.formState.errors.profileId && <p className="form-error">...</p>}
```

**Shared code that both the app and the hosted portal import must not use the `components/ui` barrel import** (`import { Select } from '../ui'`) — the barrel re-exports `ProfileQuickPicker`, which pulls in `useActiveProfile`, which reads a `staticData.owedLens` route field the app's `router.tsx` declares via global module augmentation. `tsconfig.hosted.json` deliberately excludes `router.tsx` (hosted has its own routing), so anything that drags that hook into the hosted TS program fails to compile. Import `Select` from the concrete file instead: `import { Select } from '../ui/Input'` (or `'../../components/ui/Input'` from `src/hosted/`) — this is already how hosted imports `Button`.

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

**The seam is complete and linted (MUT-47, ADR-071).** Outside `src/db`
nothing imports `db`, a repository object or a storage helper module;
`eslint.config.js` rejects it, and `initDatabase()` in `main.tsx` is the one
commented exception. When a feature needs a new kind of read or write:
- one entity → a method on that entity's slot (`paymentRecords.listByClient`,
  `transactions.listNeedsReview`), declared in `interfaces.ts`;
- the whole database → a method on `dataset`; sample data → `demoData`;
- a new storage module in `src/db` → add it to the lint pattern list in
  `eslint.config.js` (the rule only knows the modules it names).
Browser-only halves stay outside (`utils/backupDownload.ts` downloads what
`dataset.serializeBackup()` returns).

**Inside `src/db`, never call back out.** Dexie implementation code calls other
Dexie code directly (`expenseRepo` → the recurring-rule repos). Resolving storage
through `getRepositories()` from inside an implementation would send a Dexie
write to whatever source is injected. Write such duties on the interface
instead ("`create` also maintains the projected schedule").

**Moving storage code: characterize first.** Write the test against the old
call path, see it pass, then move the code and keep it green. When a mock in an
existing test targets a moved module (`vi.mock('../../db/integrityCheck')`),
have the slot method delegate to that module's function (call it through the
module binding, not a captured reference) so the mock still applies.

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
Data and repository guards never read a flag: a project or a vendor behaves
identically whether its area is on or off; the UI only changes what it shows.
(A retired area, like invoices since MUT-145, loses its key entirely: a stored
flag or notice entry for it is filtered out on read, ADR-067.) Deep links
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
with `margin-top: auto` (`UpdateBanner`). None of them is
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

### Amounts stay LTR inside RTL text (MUT-3; standalone amounts amended by MUT-109)
A standalone locale-formatted amount renders in a **plain `<bdi>`** (MUT-109,
ADR-101): the Arabic `Intl` string starts with RLM, so `dir=auto` resolves it
right to left, the order Arabic amounts have always had on screen
(`$US 1,300`). Never `<bdi dir="ltr">` around `formatAmount`/`formatDecimal`;
`direction.test.ts` refuses it. An amount *inside a translated sentence*
("{amount} overdue") is passed to `t()` wrapped in U+2066 … U+2069 (LEFT-TO-RIGHT
ISOLATE … POP DIRECTIONAL ISOLATE), so translators keep control of word order
and the number still reads left to right in Arabic. Tests that assert the
sentence strip `[\u2066-\u2069]` first. Phone numbers, e-mail addresses,
version and invoice numbers get `<bdi dir="ltr">`: text that reads left to
right in any language.

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

**The count's placeholder is `{count}`, never `{days}` or `{n}` (MUT-179).** Arabic
`one`/`two` name the count in words ("يوم واحد", "يومان") and drop the digit; `few`
(3–10) takes the plural ("أيام"), `many` (11–99) the accusative singular ("يومًا").
No `count === 1 ? …Singular : …Plural` ternaries and no `…One` keys: one plural
object per string. **Tests:** a test that mocks `lib/i18n` or `lib/i18n/core`
must also mock `lib/i18n/plural` (route `useTp` through its mocked `t`), or
`useTp` reaches the real `useLanguage` and the render throws.

### Relative time goes through `Intl.RelativeTimeFormat` (MUT-92, ADR-019)
"3 days ago", "1 week ago" come from `formatRelativeDate(iso, t, locale)`
(`src/lib/utils.ts`), which hands the count to `Intl.RelativeTimeFormat` with
`numeric: 'always'`, so the plural form is CLDR's, not a `{n} weeks ago`
template. Only Today and Yesterday are translation keys (`time.today`,
`time.yesterday`), to keep their capitalisation. Pass `getLocale(language)`.
Any other count in a string goes through `tp()` above.

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

### Direction comes from `<html dir>` and the `dir` attribute (MUT-109, ADR-101)
No CSS rule sets `direction` on `:lang()`: such a rule matches every element and beats the `dir` attribute (TD-048, how every `dir="ltr"` came to be ignored in Arabic). `I18nProvider` sets `<html lang dir>`; every element inherits it. Use the attribute for intent: `dir="ltr"` on an LTR island (an amount input or its currency-prefix group, an email, a password, a date), `dir="auto"` for user text, a plain `<bdi>` for a locale-formatted amount (above). A `dir="ltr"` input or select in the Arabic UI keeps its text on the right (`:where([dir="rtl"]) :is(input, select)[dir="ltr"]` in index.css), so only typing order differs. A new `dir` site must be classified in `src/styles/__tests__/direction.test.ts` (`DIR_SITES`). A summary line that mixes LTR codes and Arabic text wraps each part in `<bdi>`. Rendering is proved in a browser (`qa/support/bidi.ts` `readBidi`/`readField`), never in jsdom, which runs no cascade.

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
- **Bootstrap applies run once, reconciliation runs every time.** deploy.sh step 0 applies its `-target`s only while one of them is missing from state (`scripts/lib/tf-bootstrap.sh`, ADR-161). A targeted plan refuses any pending `moved` block, so a per-release targeted apply turns every merged Terraform rename into a dead release. Renames are walked by the operator step that introduced them or by the full, untargeted apply.
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
`index.css` still has short global names with fixed sizes from older screens (`.payment-row`, `.payment-amount { width: 120px }`, from the retired document forms). A component's own stylesheet uses a prefix (`pay-drawer-…`) so that it can't pick those rules up. Grep `src/**/*.css` for a class name before using it.

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
When a save needs to be found again by any one of several lists that might render it (a client profile's entry row and its payment row; a page that might or might not currently show it), give every list a `useSavedFlashRows(listId, ids, queryResult)` call that registers itself and reports `settled = !isLoading && !isFetching` on its own render. A shared store resolves "claimed" the instant any registered list's settled ids intersect the pending save, and "not claimed" only once **every** registered list has reported settled with no match. Watching a single global `useIsFetching()` for 1→0 looks simpler but is wrong: it counts every unrelated query on the page, and TanStack Query has a documented case where invalidating during an in-flight initial fetch reuses that fetch's promise and settles with no trailing refetch, so the global counter can hit zero while a list still holds pre-save data. Derive `settled` inside the hook, not from a value the caller passes in, so no list can get it wrong by using `!isLoading` alone. See `src/lib/savedFlashStore.ts`, `src/lib/useSavedFlash.ts` (ADR-057; moved from `hooks/` by MUT-91 so the portal can import it).

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

### A loader only when there is nothing to show (MUT-206 DR8)
Show `BrandLoader` only while there is no data yet: TanStack `isPending`/`isLoading` (both false once data exists), or a Dexie live query's `undefined`. A background refetch (`isFetching` with data) keeps the content on screen. Never key a loader on `isFetching`. Test: `ClientsPage.test.tsx` › keeps the rows through a background refetch.

### A blank id must not mean "everything" while it loads: gate at the root
Repository reads treat a falsy business as "every record". Rather than guarding each page, `BusinessesGate` in AppShell mounts the routed page only once the businesses have loaded, the way AppShell already holds it while the visitor sample is prepared. New pages inherit the guard.

### Pick and repair are different setters
When a store value can change because the user chose it or because the app repaired it (a deleted working business), give each its own setter. `setActiveProfile` (a pick) turns All businesses off; `setWorkingProfile` (a repair or a drill-down) keeps it. A background fix must never undo a choice the user made.

### A flag derived from the route does not belong in a persisted store
zustand's `persist` writes the partialized state to localStorage on every `set`, whatever `partialize` keeps. A value that changes on navigation (the owed-screen flag) would rewrite the saved choice on every route change, and overwrite a choice another tab just saved. Keep derived, per-tab state in its own unsaved store (`useOwedScreenStore`) next to the persisted one.

### A popover opened from a menu item remembers where the item was
A menu closes (and unmounts its items) as soon as an item is chosen. A follow-up popover anchored to that item must capture the item's rectangle when it opens, never re-measure it. It also needs to take focus itself and know which mounted element to give focus back to (the menu's button), because the item it would return to is gone (`useProfileAwareAction.trigger(event, returnFocus)`).

## Hosted API patterns added by MUT-61 (2026-10-12)

### Open a narrow write with its own matrix row, never by widening a shared one
When a principal needs one more operation in a domain it may only read (a session recording Received on a Malafat-fed profile), add a row whose scope covers exactly the new store methods (`capture` → `payments.capture`, `payments.undoCapture`) instead of making the existing row profile-dependent. Widening `payments` would have opened settle, Owed, credits, allocations, `reverse` and inbox filing at the same time. The store guard then enforces the narrow door below the routes for free. Pin the matrix's domain list in a test so the next row is a decision, not an accident.

### Check-then-act on money is one conditional write
"Undo unless something landed on it" is a single `updateMany` whose `WHERE` carries the guard (`allocatedMinor = 0`, `status = POSTED`, owner), followed by a re-read only to classify why nothing matched. The competing writer (`allocate`) holds `FOR UPDATE` on the same row, and Postgres re-checks the `WHERE` after the lock wait, so exactly one wins. Prove it at the route with `h.interleave` firing the competing write immediately before the store call. (Owed's twin: e12a5c2.)

### OR-shaped Prisma conditions go in `AND`, never side by side
Spreading `{ OR: … }` from two helpers into one `where` keeps only the last — `payments.list`'s project filter silently vanished whenever a cursor was present. Put every OR-shaped condition (filters, `cursorWhere(page)`) in an `AND: [...]` array, as `expenseCursorWhere` already did. Test the filter on page 2, not only page 1.

### Publish the rules the route enforces, from the same function
When what a write accepts depends on the profile, compute it in one pure function (`incomeCaptureRulesFor(writer)`) that both the route and `GET /v1/me` call, so a client reads the rules instead of re-deriving them from `writerOfRecord` and the two can never disagree.

### An invariant lives in a unique index; every door refuses with one helper
MUT-120's "one personal profile per user, never anyone else's" is enforced twice. The database holds the hard guarantee: `organizations.personalOwnerUserId` is `@unique`, and the memory store mirrors it as a `UniqueViolation`, so no code path can create a second one. Each door that could break the softer rules (granting, creating a user inside it, issuing a key, binding) refuses through the same `personalProfileConflict()`, so the wire shape is identical everywhere and a new door has one obvious call. The refusal reuses an existing error code with a `details.reason`, because a new code would be a contract change the API's consumers map.

## Hosted API patterns added by MUT-100 (2026-10-13)

### A bill that is known only later is an installment with a DATE trigger
A contingency commission is unknown until the outcome, so it is not a field on the agreement but an installment added when the outcome is recorded (`isCommission`), DATE-triggered on the outcome date and posted at once. Everything downstream — receivables, payments, credits, statuses, and `listUnpostedDue` healing a crash between the write and the post, with the right posting date — comes for free. Reach for this before writing a receivable outside the installment model.

### When a figure depends on ledger state, the preview token covers the figure
An agreement token covers body + rate because its figures are a function of those. The outcome's bill also depends on credits on the upfront and, for a correction, the replaced receivable, which do not move the agreement's version. Hash the computed figures (counted upfront, commission, billable) and the replaced receivable's version into the token, so any credit or payment in between is 409 `PREVIEW_STALE` and what posts is always what was shown (`agreements/outcome.ts`).

### Read issued splits from the stored rows, never re-split a sum
"Upfront less its credits" sums each `CreditRecord.netMinor` (or `amountMinor` when VAT is included) as stored; splitting the summed gross again can round an agora away from the credit notes the firm issued.

### A refusal re-checked inside the transaction returns a typed result, never an exception that escapes as 500
`correctOutcome` locks the replaced commission's receivable before writing anything and returns `{ kind: 'has_payments' }` when money landed on it; the route maps it to 409 `OUTCOME_HAS_PAYMENTS`. Same shape as `UpdateResult`'s `stale`.

### A new enum value gets its own migration; migration tests apply history one file per transaction
Postgres refuses a new enum value inside the transaction that added it, so `ALTER TYPE … ADD VALUE` sits alone and everything that names the value comes in the next migration. A test that rebuilds a database from history must apply each file in its own transaction (`BEGIN; … COMMIT;` per file), as `prisma migrate deploy` does; one pasted script is one implicit transaction. A test that diffs a partial history against `schema.prisma` applies the rest of the history first.

### Audit metadata is JSON by type
`AuditEventInput.metadata` is `JsonObject`: a `bigint` or `Date` is a compile error, not a Prisma 500 after the write it describes (the memory store would have stored it happily). Money goes in as `formatMoney` strings, rates as integers. Widen to `Record<string, unknown>` only at the wire serializer, where the recursive type exhausts the route type checker.

### A void and a post race: the posting write refuses a voided line, and the void is conditional
Two writers can meet on one unposted installment: a lazy read posting it and a cancel or correction voiding it. `postInstallment`'s winning write carries `receivableId IS NULL AND voidedAt IS NULL`; a correction's void carries the `receivableId` it read and `voidedAt IS NULL`. Whichever commits second matches no row and stands down (`null` / `stale`), so a line is never both voided and billed. Prove the store-level guard with a contract row, not only a route test.

### Serialize writes to one aggregate on its row lock, then read
`correctOutcome` starts with `SELECT … FROM agreements … FOR UPDATE` and only then reads the version. A concurrent correction waits, then sees the new version and is `stale`; without the lock it got past the version check and failed later with a misleading reason. A Postgres contract test racing two calls with `Promise.allSettled` catches the difference (it failed 2 of 3 runs with the lock removed).

---

### Pattern: An import re-mints every ID and remaps every reference (MUT-158)

**When**: bringing exported rows back into a database that may already hold
rows, possibly under a different profile.

**How**: `src/db/profileImport.ts`. Mint the new IDs up front, one map per
table (old → new), so rows that point at each other (transactions ↔
retained documents) can be written in any order. Write every row with its
references rewritten through those maps. A reference to a row the file
doesn't carry is dropped, never left dangling. Run it all in one Dexie
`rw` transaction so a failure leaves nothing half-imported. Find
duplicates only inside the target profile (clients by a non-empty email,
projects by name), because clients belong to one business (ADR-049).

**Never**: give rows new IDs while copying their foreign keys verbatim.
The deleted `ImportDataModal` did that, and every imported entry pointed at
clients that did not exist.

**Instances**: `importProfileFile` (tests: `profileImport.test.ts`, and the
Export → Import round trip in `ImportDataPage.test.tsx`).

### Pattern: One rule settles an invariant inside every writer's transaction (MUT-88)

**When**: a table-wide invariant ("exactly one default business") can be broken by more than one write path, some outside the repo (seed, import, restore, migration).

**How**:
- Write one pure picker (`pickDefaultProfileId`) and one enforcer that takes a Dexie `Table` (`enforceSingleDefaultProfile`).
- Call the enforcer *inside* each writer's own transaction, so the repair commits with the write that needed it.
- A writer that means "make this one" flags its row first and passes its id as the preference.
- Repair existing devices once in a `version(n).upgrade(tx)` that logs, never throws.

**Never**: read the invariant's state before a transaction and write it inside (the seed's old `existingDefault` read raced the welcome modal), or rely on every caller remembering to clear the others.

**Instances**: `src/db/profileDefault.ts` (repo, `seedDemoData`, `importProfileFile`, `restoreFromBackup`, Dexie v22).

### Pattern: A one-slot hand-off carries a File across a route change (MUT-88)

**When**: one screen picks a file and another screen owns what happens to it (Settings › Restore → `/settings/import`).

**How**: a module-level slot (`setPendingImport` / `takePendingImport` in `src/lib/dataFiles.ts`), taken once. The receiving page takes it in an effect gated on the data it needs (the profiles query), so it decides against real data. Take-once means a remount or a later visit never re-imports. StrictMode is safe: the async state lands on the preserved fiber.

**Never**: put file contents in the URL or history state, or ask the person to pick the same file twice.

---

### Pattern: Press feedback is `Button` or `.press`, with `scale`, never `transform` (MUT-91, ADR-074)

A control that should respond to a tap is a `Button` (`.btn`) or carries `.press`; one rule in `src/index.css` scales both to `--press-scale` on `:active`. Use the individual `scale` property: `transform` would replace a control's own positioning transform, and a positioned control would jump on press. Never write a per-component `:active` transform or a literal 0.97; reduced motion is handled by the tokens. Tabs and text links don't press.

### Pattern: A list can start AT a record: `anchor` = inclusive keyset start (MUT-91, ADR-074)

To land on a record that may sit past the first page, pass `anchor=<id>` instead of a cursor. The server reads it through the tenant-scoped getter (404 otherwise) and starts the page at it with an `inclusive` keyset cursor; filters still apply and `nextCursor` continues as normal. On the portal the anchor is a URL search param on the list (`ExpenseFilters.anchor`), sent on the first page only.

### Pattern: Re-arm an after-save only once the page shows the new filters (MUT-91)

When Show changes the same page's filters instead of navigating, re-arm the saved flash in an effect that sees the new filter value, not in the click handler. Otherwise the list's next render, still on its old filters, reports "settled, not here" and resolves the save as unclaimed. See `SavedNotice` (`src/hosted/components/SavedNotice.tsx`).

### Pattern: A clickable table row is reachable by keyboard through a button in its first cell (MUT-194, D8/D11)

When a portal list opens something on a row click, give `HostedTable` an `onRowClick`; it wraps the first column's content in a native `<button class="row-link press">` that calls the same handler with `stopPropagation`. Keep the `<tr>`'s mouse click for clicks anywhere on the row. **Never** put `role="button"`, `tabIndex` or an `aria-label` on a `<tr>`: it drops the row's cell semantics or isn't announced as actionable. Same idea as ClientsPage's `<Link>` in the name cell.

### Pattern: An edit drawer refills only on a new version, and a 409 is what brings it (MUT-194, D6)

`ConversionDrawer`'s edit mode resets the form in an effect keyed on `[existing.id, existing.version]`, not on the object, so a background refetch of the same version never wipes typing. On a 409 it invalidates the entity's query; the refetch brings the newer version, the effect refills the form, and the conflict toast's "showing the latest version" becomes true while the drawer stays open. This narrows MUT-133's "never key a form by an entity's version" for a drawer whose save sends the whole record: once a newer version exists, the typed values can only 409, so showing the latest is the honest state.

### Pattern: Visibility from IntersectionObserver, never from scroll listeners (MUT-77)

**When**: UI reacts to whether something is on screen. Examples: a header button that appears once the hero's has scrolled away, a scroll-edge fade, a reveal on entry.

**How**:
- Use `useInView(ref)` and decide what `null` (unknown) means for your case.
  - Where showing something is optional, unknown means "don't show".
  - Where hiding content is the risky side, unknown means "show".
- For "has the page scrolled", observe a 1px sentinel at the very top of the page.
- When a sticky bar covers the top of the viewport, give the observer a negative top `rootMargin` of at least the bar's height. Otherwise an element under the bar still counts as on screen.
- For a reveal, set the hidden state only when all of these hold: the element starts below the fold, motion is allowed, and an observer exists to bring it back. Set it as a DOM attribute in a layout effect, not React state, because it needs layout and must never re-hide.

**Never**: attach `scroll` listeners, or hide content before you know something will un-hide it.

**Instances**: `LandingHeader` (sentinel + `showCta`), `LandingPage` (hero button), `ChapterSection` (reveal).

### Pattern: Press feedback comes from the motion tokens; text links dim instead (MUT-77)

**How**:
- Buttons and button-like links add `scale var(--duration-press) var(--ease-spring)` to their own `transition` list and `:active { scale: var(--press-scale) }`: the `scale` property, never `transform` (ADR-074; moved off `transform` when MUT-91 merged). In the app and portal, a `Button` or `.press` gets this from `src/index.css`; the landing keeps its own selectors because its controls are not `Button`s.
- The tokens zero under reduced motion, so a rule needs no reduced-motion override.
- Text links and full-width rows (the FAQ questions) use `:active { opacity: var(--landing-press-dim) }`. Scaling a line of text, or a row whose text is start-aligned, reads as a glitch.
- On iOS, `:active` needs a touch listener on the page: a passive no-op `touchstart` on `document`.
- A classed link that looks like a control must also set its own `:hover` colour and `text-decoration`, because the global `a:hover` out-ranks one class (TD-122).

**Instances**: the landing page (`HeroSection.css`, `LandingPage.css`, `FAQSection.css`), guarded by `landingCss.test.ts` and `@web.landing.press`.

### Pattern: A classed link owns its hover (TD-122)

**When**: you write an `<a>` or `<Link>` with a `className`.

**How**: the global link hover (`--link-hover` plus an underline) applies only to `a:not([class])`, like `:visited`. A class makes the link one of two kinds:
- **Control** (a button, card, pill, nav or menu item, or row action): set `text-decoration: none`. Its label keeps its colour on hover unless its own `:hover` sets one (`.btn-ghost` goes to `--text`).
- **Inline text link** (a breadcrumb, a name in a table, a back link, a footer or download link): declare `color: var(--link-hover)` (or the colour it wants) and `text-decoration: underline` on its own `:hover`. Add it to `TEXT_LINKS` in `brand.test.ts`.

**Never**: write a bare `a:hover` or `a:visited`. At (0,1,1) it beats every single-class colour, and `brand.test.ts` fails on it.

**Instances**: `theme.css`, `index.css`. Text links: `.breadcrumb-link`, `.client-index-name`, `.feature-notice-banner-action`, `.hp-back`, `.hero-cta-alt`, `.privacy-policy-back`, `.download-link`, `.download-alt-link`.

### Pattern: Marketing pages render only landing chrome, and are tested under `LandingProviders` (2026-10-14)
`/`, `/download` and `/privacy` mount in `src/main.tsx` outside the router and `QueryClientProvider`, and never open the database. So they use `LandingHeader`/`LandingFooter`, never app layout (`TopBar`, `SidebarNav`, anything calling `useQuery`, router hooks or `getRepositories()`). Their component tests render through `LandingProviders`, the same wrapper `main.tsx` uses, and never mock app layout away: that mock is how `/download`'s crash went unnoticed.
**Instances**: `PrivacyPolicyPage`, `DownloadPage`, `HostedOfferPage` (MUT-186); guarded by `DownloadPage.test.tsx`, `HostedOfferPage.test.tsx`, `@web.landing.download` and `@web.landing.hosted`.
### Pattern: Netlify Forms in a shared-index SPA — a build-emitted static twin, posted to by path (MUT-186)
Netlify registers only forms it finds in deployed HTML, and a React form isn't there. The web and desktop builds share `index.html` and `public/`, so the hidden twin can't go in either. Instead:
- One module (`src/pages/landing/hostedRequest.ts`) owns the form name, the field list and the honeypot, with no React or DOM imports.
- A web-only Vite plugin (`netlifyForms()` in `vite.config.ts`) emits `__forms.html` from those constants in `generateBundle`, marked `noindex` and added to `PWA_WORKBOX.globIgnores`.
- The page POSTs `application/x-www-form-urlencoded` (Netlify takes no JSON) to `/__forms.html`, a real file, so no SPA rewrite catches the POST.
- Netlify UI steps (form detection, notifications) are recorded in INFRA §1, because `netlify.toml` can't set them.
**Instances**: the `/hosted` request form; guarded by `vite-config.test.ts` (the twin names exactly `HOSTED_REQUEST_FIELDS`) and `hostedRequest.test.ts`.
**Honeypot**: name it `bot-field` and hide it with `hidden` (display: none). A contact-looking name (`company-website`) that is merely off-screen gets autofilled for real visitors, and Netlify then drops their request without a word while the page shows success.
**Per-page link previews**: crawlers run no JavaScript, so a marketing page that will be shared needs its own HTML copy. `hostedOfferHtml()` derives `hosted-offer.html` from the built `index.html` with `withPageMeta()` (new card tags and title, the scripts untouched). `netlify.toml` serves it at the page's path, above the `/*` fallback, and it stays out of the SW precache.
**Gotcha**: in dev, Vite's HTML fallback serves `/<name>` from a root `<name>.html`. `/hosted` hit the portal's `hosted.html`, so `hostedOfferDevRoute()` rewrites it to the app shell. Check for a same-named root HTML file before adding a marketing route.


## Hosted portal patterns added by MUT-133 (2026-10-14)

- **Idempotency-Key per save attempt, not per click** (`src/hosted/data/attemptKey.ts`). `useAttemptKey()` returns `keyFor(body)` and `succeeded()`: the same key while the serialized body is unchanged (a retry after a timeout that landed replays the first result), a new key when the body changes (the server refuses a reused key with a different body) or after success. Every portal create uses it: income, settle, expenses, conversions. Never mint `crypto.randomUUID()` inside a `mutationFn`.
- **Pages own drawers; lists report picks.** A page parses its drawer params beside its list filters (`splitIncomeDrawer`) and mounts the drawer itself; the list takes a callback (`onRecordPayment(id)`) and an empty-state action. Drawer params must never enter a list's filters object, because `useCursorList` keys on it.
- **A client date default or `max` that predicts a server date check uses the profile's zone**: `todayInZone(profile.timezone)` (`src/hosted/format/dates.ts`), never the browser calendar.
- **Money input: lenient in, canonical out.** `parseIncomeAmount(text, currency)` (`src/hosted/components/incomeForm.ts`) reads commas, a matching symbol and Arabic-Indic digits via `parseAmountInput`, refuses a different typed currency, and produces a canonical decimal with exactly the currency's digits. Live feedback, validation and the request body all use the same parse.
- **Focus after an action that removes its own trigger**: move focus to the replacement target *before* closing the drawer (`focusAfterSettle`), because `useDrawerFocus` restores the trigger on unmount unless focus is already outside the panel (ADR-055 §6 in the portal).
- **Never key a form by an entity's version.** A refetch that bumps it (a race re-read, a focus refetch) remounts the form and throws away what was typed and any inline server error. Key by id, keep user-typed state above the remount boundary, and re-judge it against the fresh entity (`RecordPaymentDrawer`).
- **A pending submit button is `aria-disabled`, not `disabled`, inside a drawer.** Disabling the focused button blurs it in Chromium, and `useDrawerFocus` then can't hand focus back; guard the handler instead.
- **A polite status that must be announced lives in a region rendered from the start** (`aria-live="polite"`, filled later). It carries no `role="status"` while empty, so it isn't a landmark when there's nothing to say.

## Hosted portal patterns added by MUT-183 (2026-10-14)

- **Shell-global drawers use URL keys stripped at the page boundary, both directions.** `?newProfile=`/`?manageProfiles=`/`?editProfile=<id>` are read with `omitShellOverlay(search)` before any page ever sees its filters (ADR-008; the MUT-44 e0ed4fd lesson, applied shell-wide via `src/hosted/data/filters.ts`). The direction that's easy to miss: a page rewriting its *own* filters (`useReplaceSearch`, `router.tsx`) must merge the shell's keys back in with `pickShellOverlay(prev)` rather than replacing the whole search — otherwise a background filter change (an anchored list's stale-anchor refetch, `anchoredList.ts`) silently closes whatever drawer the shell had open. `ProfileDrawers.go()` already did this (`{ ...omitShellOverlay(prev), ...next }`); `useReplaceSearch` didn't, until a qa-reconcile pass on MUT-183 caught it. A second shell-global drawer controller, `AccountDrawers` (MUT-237, `?changePassword=`), follows the same `go()` shape and shares the one `ProfileDrawerSearch`/`SHELL_OVERLAY_KEYS` registry rather than inventing a parallel one — a sibling *component* for an unrelated concern (account, not profiles), but the same URL-key infrastructure every page's filter replace already depends on.
- **An edit form snapshots `version` at open, not at save time.** `ProfileEditForm` captures `profile.version` when the drawer opens and sends it as `If-Match` on every PATCH during that session, even if a background `me` refetch bumps the row underneath (MG4). A 409 is the only path that re-reads it. Same contract as the conversion/expense edit drawers (ADR-074/075) — never re-read a version just before sending a write; that's exactly the race the lock is for.

## Server patterns added by MUT-182 (2026-10-14)

- **A destructive replace and a lazy create of the same rows hold the same parent row.** `expenseCategories.seed`, `create`, `update` and `organizations.updateOwned` all start with `SELECT id FROM organizations WHERE id = $1 FOR NO KEY UPDATE` (`lockOrganization`). NO KEY UPDATE, not FOR UPDATE: it serializes those writers but never blocks the foreign-key `KEY SHARE` every child insert takes on the parent. `skipDuplicates` only dedups identical names; two *different* presets racing need the lock, or a profile keeps a mixed set forever.
- **A capped create counts under a lock on the owner's row** (`organizations.createOwned`: `SELECT … FROM users … FOR UPDATE`, then `count`, then insert), so two concurrent requests can't both pass the cap. The memory store needs nothing (single-threaded).
- **One versioned store call per PATCH**, even when the body spans several concerns (name, currency, a type change that rewrites child rows): one transaction, one version bump. Two calls sharing one `If-Match` half-apply and then report a stale version.
- **A foreign key that a concurrent destructive write can trip maps to the validator's own 422** (`withCategoryForeignKey` in `expenses/compose.ts`), so the race answers exactly like the up-front check. The memory store mirrors the FK so the route test runs without Postgres.
- **Migration tests write `organizations` and `users` as raw rows** (`repositories/__tests__/fixtures/raw-rows.ts`) on a database built from the migrations before the one under test: today's Prisma client selects every column the current schema declares and fails on an older one. Replay earlier migrations one transaction per file (MUT-100 adds an enum value its next file uses).
- **One builder for a published shape** reached by several routes (`hostedProfileFor` in `serializers.ts`, used by `/v1/me`, POST and PATCH `/v1/profiles`).
- **Lock child rows in the order their own writers do.** A type change locks the categorised expense rows (`FOR NO KEY UPDATE`), then the categories (`FOR UPDATE`): an expense PATCH locks its row, then (foreign key) its category, so the reverse order deadlocks.
- **Audit inside the transaction when a retry could duplicate.** A create guarded by an idempotency key that releases on 5xx must commit its audit rows with the record (`auditRows` in `prisma.ts`, distinct milliseconds so `(createdAt, id)` order is stable), or a failed append turns the client's retry into a second record.
- **A new NOT-NULL-ish invariant on a column the old revision doesn't write**: make the CHECK tolerate the old shape explicitly (`… OR "ownerUserId" IS NULL OR …`), read through one helper that falls back to the old column (`profileOwnerOf`), and stamp the stragglers in post-roll. Never a CHECK the previous image can't satisfy: migrations run before the roll.


## App patterns added by MUT-187 (2026-10-14)

### Pattern: A link out of the `/app` basepath is a plain anchor
The web router's basepath is `/app`, so `<Link to="/hosted">` resolves to `/app/hosted`. Links to marketing pages (`/hosted`, `/download`, `/privacy`) or another origin (the portal) are `<a href=… target="_blank" rel="noopener noreferrer">`, with a `.sr-only` "(opens in a new tab)" (`common.opensInNewTab`) after a JSX space (the i18n strings carry no leading space). Give the row holding such a link `position: relative` (or make sure it never outgrows its column): `.sr-only` is absolutely positioned, and without a positioned ancestor it escapes `.page-content`'s clipping and scrolls the page sideways at phone width (see `HostedAccountEntry.css`, TD-141). A `.btn` there that may meet a narrow column needs `white-space: normal; block-size: auto`, since `.btn` is nowrap at a fixed height.

### Pattern: Read a Vite build constant through a typeof guard at render time
Vitest defines no `__BUILD_MODE__` / `__PORTAL_URL__`; a component that reads one bare throws in every existing test that renders it. Read it in a function called at render (`goHostedEnabled()`, `hostedPortalUrl()` in `src/lib/goHosted.ts`) with `typeof X !== 'undefined'`, and stub it per test with `vi.stubGlobal`. The cost: Rollup won't fold the call, so the other build keeps the dead branch (TD-134). Module-scope reads (`router.tsx`, `main.tsx`) still need the stub before import. The portal uses the same shape for `__HOSTED_OFFER_URL__` (`hostedOfferHref()` inside `SignInPage.tsx`, MUT-188): a module-level `const` would be evaluated before any test's `vi.stubGlobal`, so the read must sit in a function called at render.

### Pattern: A dismissible suggestion snoozes in localStorage and fails open
A "hide for N days" timestamp lives in localStorage (a UI preference, never in backups). Unparseable, missing or future values count as due, so a skewed clock or a hand edit can't hide it forever; a storage that throws shows the suggestion and the dismissal holds for the tab.

## Patterns added by MUT-206 (2026-10-15)

### Pattern: Waits use BrandLoader; inline button spinners and skeletons don't
A page, section or drawer waiting for its data shows `BrandLoader` in a `.loading` box: 64 with `slowCaption={t('common.loadingSlow')}` for a full page (centred, 50vh), 40 in `.loading loading--section` for a section or drawer body (top-aligned). The route fallback (`PageLoader`) is the same 64 loader in the same box, so code download plus data load read as one wait (a loader mounting within 100 ms of a shown one skips its delay). Keep: the 16 px button spinners (`Button isLoading`, `.hp-inline-spinner`), the portal `Skeleton`s (they reserve layout), blank root gates. Never add a CSS ring spinner. Content replacing a loader may take `.content-enter` (a 150 ms fade). A site with its own visible text beside the loader (the import step, the demo seed modal) hides the loader's reduced-motion caption visually so the two don't overlap.
**Instances**: every site listed in `mut-206-brand-loader.md` D6. Guard: `BrandLoader.test.tsx` › old spinners are gone.

### Pattern: A status that is there before it speaks
A live region must exist before its text changes, or some screen readers never announce it. `BrandLoader` renders its `role="status"` span from mount, empty, and sets its text (never an `aria-label`: a status takes its name from the author, not the content) when the wait becomes worth announcing. Tests read it with `findByRole('status')` + `toHaveTextContent`, not `toHaveAccessibleName`.

### Pattern: Shared chrome reads i18n without throwing
A component that renders on every surface (app, landing, portal) imports from `lib/i18n/core` (the portal must not bundle the app dictionaries) and, when a missing provider must not crash it (page tests mock the app's `lib/i18n` module and mount no core provider), uses `useOptionalT()`: `t` or `null`. Page tests that assert such a component's text wrap the page in `LoaderI18n` (`src/test/loaderI18n.tsx`).

## Patterns added by MUT-207 (2026-10-15)

### Pattern: First paint is the boot splash; keep `BootSplash.tsx` and the HTML in step
Both entry HTML files ship the boot splash inside `#root` (markup and a linked `boot-splash.css`, never inline style or script: the portal CSP), and React's first render replaces it. Anything React shows first on a boot path draws the same picture in the same place: the landing's Suspense fallback is `BootSplash` (first render = the HTML splash), the portal's session check is `.boot-splash` + `BrandMark` 80 then `BrandLoader` 96 (whose frame 0 is that mark). Change the HTML and `BootSplash.tsx` together; `brand-head.test.ts` compares them and `check-bundles` proves the built splash's files ship. The splash has no text (the language and font are unknown before JS) and follows the OS scheme until ThemeProvider sets `data-theme`.

### Pattern: A boot screen times its still mark from page start
A boot screen's 400 ms grace counts from `performance.now()` (page start), not from mount: `bootDelayMs()`. On a slow load the page has already waited, so the mark blooms the moment React mounts. In-content loaders keep their 400 ms from mount. Tests set the page clock with `pageStartsNow(offset)` (`src/test/pageStart.ts`).

### Pattern: A boot request has a deadline
A request a whole screen waits on (the portal's `/v1/me`) aborts after a deadline (`AbortSignal.any([signal, AbortSignal.timeout(ME_TIMEOUT_MS)])`), and the client maps the `TimeoutError` to a network `ApiError`, so the existing unreachable screen with Retry takes over instead of a loader that never ends. Keep TanStack's `signal` in the mix so a cancelled query still aborts.

## Patterns added by MUT-202 (2026-10-14)

### Pattern: A surface's default is not a stored preference
When one surface needs a different default from another that shares a stored setting (the marketing site opens in Arabic; the app follows the system), pass the default into the shared provider (`LanguageProvider defaultLanguage`) and store nothing until the person chooses. Storing the default would silently change the other surface. A value a surface stored by detection is not a choice: mark real choices separately (`mutaba3a-language-chosen`) and let the default yield only to a marked value. Order: a marked choice → the surface's default → the system's. Tests seed a choice with `chooseLanguage()` (`src/test/language.ts`) and QA with `chooseLanguageScript` (`qa/support/i18n.ts`).
**Instances**: `LandingProviders` (ADR-077). Tests: `core.test.tsx` › defaultLanguage, `LandingProviders.test.tsx`, `@web.landing.arabic-default`.

## Patterns added by MUT-191 (2026-10-15)

### A per-user preference in the portal lives on the server, changed by a merging PATCH
The portal stores nothing in the browser but the language. A preference that must survive reloads and follow the account (Malafat suggestions) is a nullable JSON column on `User`, read resolved through `/v1/me` and changed with a PATCH that names only what changes (`{ off?, dismiss? }`): set-like fields are unioned server-side under a row lock (`SELECT … FOR UPDATE` in a transaction), scalars are last-write-wins. The portal hook writes the response into the `ME_KEY` cache. No audit row for a preference that would read as a click log.

### "Show once on arrival" without a timer
A one-time note on the page a flow lands on (C1 after creating a business profile): the flow marks the target id in a session store; the note reads the mark once in a `useState` initializer, consumes it in an effect, and keys itself by the target id so a different page re-reads. StrictMode's dev remount keeps the state, so the note stays; leaving and returning shows nothing. Never clear in an effect cleanup (StrictMode runs it on mount) or on a timer (a stray timer clears a newer mark).

## Patterns added by MUT-190 (2026-10-14)

### Pattern: A permanent dismissal lives on the settings row; a snooze lives in localStorage
A suggestion the person retires for good (Malafat suggestions) is a product preference: store it on the Dexie settings row next to the optional-area switches, so it travels with a backup. A "hide for N days" snooze (Go hosted) is a per-browser convenience and stays in localStorage. Either way, write by reading the fresh row and writing the whole nested field: `settingsRepo.update` replaces nested objects.
**Instances**: `useMalafatSuggestions.ts` (ADR-078), `useFeatures.ts`, `goHosted.ts`.

### Pattern: One upsell on screen
Every in-product suggestion claims a slot while mounted (`useMalafatMomentStore.claimSlot()` in an effect); other upsells read `suggestionsShown > 0` and render nothing. A suggestion hides itself at once on dismiss or click (local state) and hands focus to a named target before it goes.
**Instances**: `MalafatSuggestionCard` → `GoHostedCard`.

## Retiring an optional area (MUT-145, MUT-226)

When an optional area leaves the product:
- **Code**: delete the pages, drawers, hooks, repositories, store slices, types, i18n keys (both locales) and CSS. Drop the key from `FEATURE_KEYS` and the `FeatureKey` union, and drop its probe. A stored switch is then inert, because `resolveFeatures` drops unknown keys and `useFeatureNotice` filters through `FEATURE_KEYS`.
- **CSS**: before deleting a stylesheet, check how it's loaded. One imported by an eagerly loaded module (a drawer mounted in AppShell) is global, and its unscoped rules may be styling live screens (MUT-226: `.segment-control`). Move any rule a live component depends on into its base stylesheet.
- **URLs**: replace the route with an unconditional `beforeLoad` redirect home. The router has no not-found component, and a bookmark must land somewhere real.
- **Guards**: add a `src/__tests__/noDead<Area>Modules.test.ts` covering deleted paths, deleted names and retired i18n keys.
- **Data**: the default is ADR-029, so the tables stay. Their row types go in `src/db/retained/`, with a retention test (MUT-145).
  - Only an explicit owner decision drops them. It needs a new Dexie version with `null` stores, an override log in the ADR (ADR-053, ADR-082), and a `migration-vN.test.ts` that upgrades a seeded previous-version database.
  - That test proves the stores are gone, every other row is unchanged, and a pre-upgrade backup still restores.
  - Strip any link field the area wrote onto core rows in that version's upgrade, and log a failure rather than throwing it.

## Patterns added by MUT-223 (2026-10-15)

### Pattern: Hide a session's own edits from Malafat's audit feed by action when the entity type is shared
Expenses and conversions are hidden by entity type (`SESSION_ONLY_ENTITY_TYPES`) because Malafat reads none of them. Receivables and payments are Malafat's to read, so a person's own edits on them are hidden by action instead: list the action in `SESSION_ONLY_ACTIONS` (routes/audit.ts), which `GET /v1/audit` passes as `excludeActions`.
**Instances**: `income.owed.redated`, `payment.redated`.

### Pattern: An owner-scoped If-Match write checks the version on its read, then re-asserts everything in one conditional WHERE
Read the row, refuse 404 unless it is the person's own, compare its `version` with If-Match (409 with `currentVersion`), then write with the ownership predicate and `version` in the WHERE and re-read under the same predicate (`not_found` vs `stale`). The read gives the exact old value for the audit row; the predicate in the re-read means a stale answer never reveals a row the person may not touch.
**Instances**: `receivables.redateAdjustment`, `payments.redateCapture`, `routes/income.ts` PATCH, `redateOwnCapture` in `routes/payments.ts`.

## Lock Receivables in Id Order (MUT-130)

Every write that locks more than one receivable takes the row locks in ascending id order before it changes anything: `lockReceivablesInIdOrder` in `server/src/repositories/prisma.ts` for payments, and `upfrontMoved` for the contingency outcome writes. Two writes that lock in the same order can't deadlock. The write then works in its own order on rows it already holds, so allocation rows keep the request's order.

A lock conflict that still happens (40P01 / 40001) is turned into `LockConflict` (`repositories/memory.ts`) by `asLockConflict`, and the route answers 409, never 500. Postgres rolled the transaction back, so nothing was written. A new multi-receivable write uses the same helper and the same mapping.

## Patterns added by MUT-224 (2026-10-15)

### Pattern: A row whose first cell holds a button links from another cell
When a clickable `HostedTable` row already has a button in its first cell (the Payments expander), put the row-link in another cell with `linkColumn`, gate rows with `canOpen`, and have every inner button `stopPropagation` so it never opens the row too. Never nest the row-link around a button.
**Instances**: `PaymentsList` (`linkColumn="received"`), `ReceivablesList` (Record payment stops propagation).

### Pattern: One drawer for two record kinds calls both reads unconditionally
`RedateDrawer` calls `useReceivable(…, kind === 'owed')` and `usePayment(…, kind === 'payment')` every render and picks one, so hooks never run conditionally. A new version refills the form through a render-time adjustment, not an effect, and only after a 409's re-read or when the field is untouched: a background refetch never replaces typed input. The drawer also re-checks the gate (`canRedate…`) on the record it loaded, since a GET can succeed where the PATCH would 404, and a save that answers after unmount neither closes nor toasts.
**Instances**: `RedateDrawer`.

## Patterns added by MUT-227 (2026-10-15)

### Pattern: A money date goes through one composite check, never hand-paired checks
An income-like date (income, settle, re-date, conversion, income filing) is parsed with `pastMoneyDate(raw, today, field)` from `server/src/income/compose.ts`: valid, not later than `today`, not more than `DAYS_IN_PAST_LIMIT` days back. An expense date uses `expenseOccurredOn` (floor, no future check). `today` is always `todayFor(organization, now)`. A query filter (`from`/`to`) uses the plain iso parser instead, so it can still reach old rows.
**Instances**: `routes/{income,receivables,conversions,inbox}.ts`, `redateTo`, `expensePatch`.

### Pattern: A range refusal names its bound
A `DATE_INVALID` raised by a range check carries `details.bound: 'past' | 'future'` (`DateBound`). A client branches on `bound` for its message and never redoes the date arithmetic; with no `bound` (an older server) it keeps its old message.
**Instances**: `assertNotTooOld`, `assertNotFuture`, `assertNotAbsurdDate`; the portal reads it once with `apiErrorBound` (`src/hosted/api/client.ts`) in the income, expense and conversion mappers.

### Pattern: An edit re-checks a date only when it changes
A PATCH that accepts a date compares it with the stored one first and validates only a changed value. Clients (the portal's drawers) resend every field, and a row stored before a rule existed must stay editable.
**Instances**: `expensePatch`, the conversion and inbox PATCH routes (MUT-227).

## Patterns added by MUT-236 (2026-10-16)

### Pattern: A secret in the URL fragment is read once and stripped before anything else
`SetupPage` takes the token from `useLocation().hash` into state, then `navigate({ to: <path>, replace: true })` in a mount effect (TanStack drops the hash when `dest.hash` is unset; `replace` is `history.replaceState`). The token lives only in component state and request bodies, never in storage, a query string or a log. A newer token arriving by a same-tab hash change is adopted with a render-time adjustment and a keyed remount; a reload after the strip is an honest "incomplete link".

### Pattern: A one-shot check runs as a query that never refetches
A POST that answers "what is this link" is a `useQuery` with `staleTime: Infinity`, `gcTime: 0`, `retry: false` and no refetch on focus or reconnect, keyed by the token: the answer changes once the page acts on it, so a refocus must not re-ask.

## Patterns added by MUT-235 (2026-10-16)

### Pattern: A single-use link token is an HMAC digest claimed inside the side-effect transaction
A one-time link carries 256 random bits in the URL **fragment** (never sent to a server, so never in a log or Referer). The store keeps only `sessionDigest(pepper, token)`, the same digest sessions use. Redeeming claims the row with a conditional update (`usedAt IS NULL AND cancelledAt IS NULL AND expiresAt > at`) inside the transaction that performs the effect, after locking the owner's row (`FOR NO KEY UPDATE`). A lost claim writes nothing, and of two concurrent redeems exactly one wins. Issuing a new one cancels the owner's open ones under the same lock.
**Instances**: `AccountSetupRepository.issue` / `redeem` (memory + Prisma), `routes/account-setup.ts`.

### Pattern: A session is created only for the credential that was verified
Sign-in passes `verifiedPasswordHash` to `sessions.create`; the store re-reads the person's hash and status under `FOR SHARE`, which conflicts with the `FOR NO KEY UPDATE` that a credential change (setup-link lock or redeem) holds until it commits. A sign-in that verified a password the operator has just revoked is refused with the ordinary `INVALID_CREDENTIALS` instead of slipping a session in after the revocation. Any future credential change (MUT-237) takes the same row lock.
**Instances**: `auth/sign-in.ts`, `SessionRepository.create` (memory + Prisma).

### Pattern: Tests provision a person the way the person would
A route test that needs a signed-in person calls `provisionUser(app, body)` from `server/src/__tests__/helpers/provision.ts`: admin create, then the setup link redeemed with a known password. No test reaches into the store to set a password, so the setup flow is exercised by every suite that signs in.
**Instances**: ~20 route suites, `routes-users.test.ts`.

## Patterns added by MUT-24 §C (2026-10-16)

### Pattern: A Dexie upgrade is tested from the shape the version before it left on disk
Build the old database with `createDatabaseAt(name, n - 1, rows)` from `src/test/legacyDexie.ts`. `schemaAt(n)` merges every `stores()` call up to n from `database.ts` itself, so no test copies a schema block. Seed rows the way that version stored them, open `new MiniCrmDatabase(name)` over the database, and assert the result at the current version. A new Dexie version adds its case to `migration-history.test.ts`, or to its own `migration-vN.test.ts`, with the happy path, each branch, and the log-instead-of-throw fallback when the upgrade has one.

### Pattern: Coverage floors only ratchet up
`COVERAGE_THRESHOLDS` in `vitest.config.ts` holds the global floors (the last measured run, floored to a whole percent) and per-file floors for the risk files (100 when the logic is pure, 95 otherwise). When a change raises coverage, raise the floor in the same change. A change that would drop below a floor adds tests; it never edits the number down. A test that crosses 5 s only under instrumentation takes `SLOW_UNDER_COVERAGE` as a per-test option, never a raised global timeout.

## Patterns added by MUT-24 (2026-10-16)

### Pattern: One locale file per feature, composed per language
App strings live in `src/lib/i18n/translations/<lang>/<feature>.json`. Each file holds whole top-level namespaces, so a key path never says which file it is in. A new file is added to that language's `PARTS` in `index.ts`, in both languages. `composeDictionary` throws on a namespace defined twice, and `translations.test.ts` fails on a file left out of `PARTS` or on en/ar files holding different namespaces. Never re-create a monolithic `en.json`/`ar.json`. Tests import the barrel (`translations/en`), and `qa/support/i18n.ts` composes the files the same way.

### Pattern: Every key is reachable and every asked-for key exists
`scripts/i18n-keys.ts` (in `test:run`) fails on both:
- **Missing**: `t`/`tp`/`has` called with a literal key that is not defined.
- **Orphaned**: a defined key no literal or dynamic key reaches.

A key held in data counts (`labelKey: 'nav.home'`). Build dynamic keys in a shape the check can see:
- a template literal with a dot before its first `${`: `` `settings.items.${k}` ``;
- a concatenation onto a dotted literal: `'nav.' + id`;
- a dotted namespace constant: `const T = 'landing.hostedOffer'`.

Never `t(someVar)` built from an undotted variable. Deleting a screen means deleting its keys from both languages; the check names them.

### Pattern: `t()` never needs a fallback
`t()` returns the key itself on a miss, so `t('x') || 'Default'` never shows the default. The key check guarantees the key exists, so write `t('x')` alone.

### Pattern: A build-time constant has one module
A Vite `define` is read through one tiny module (`src/lib/appVersion.ts` for `__APP_VERSION__`), so tests mock the module (a getter, for per-test values) instead of stubbing globals.

## Patterns added by MUT-154 (2026-10-17, ADR-090)

### Pattern: Every analytics event leaves through the contract guard
- **One guard.** No surface sends to PostHog except through `src/lib/analytics/guard.ts`
  (`guardEvent`), wired as posthog-js `before_send` by `posthogInitOptions()`.
- **What the guard does.**
  - It drops any event the contract (`docs/analytics/events.json`) doesn't list for the surface.
  - It keeps only valid contract properties plus the surface's `$` allowance.
  - It stamps `surface`, `app_version`, `locale` and `$geoip_disable`.
- **Calling code never pre-filters.** Call `capture(name, props)` with what you mean, and let the
  guard enforce it.
- **A new event or property is a contract change**: bump `events.json` and add its sha256 pin.

### Pattern: A third-party SDK the local app must not carry loads in a lazy chunk, behind a lint rule and a bundle check
- **Load it lazily.** posthog-js is `import()`ed from a module only lazy page chunks use (the
  landing pages), after idle, and only with a key.
- **Lint rule.** ESLint `no-restricted-imports` names the only files allowed to import it.
- **Bundle check.** `check-bundles.ts` proves the SDK isn't statically reachable from the web
  entry (`posthogInEntryGraph`) and is absent from desktop.
- **Reuse it.** Follow the same three steps for any SDK the free app must never ship (ADR-024).
- **When it must also wait for sign-in** (MUT-149, Sentry in the portal): a small gate in the entry
  imports no SDK, follows `subscribeMode`, and `import()`s the chunk only in `remote` mode. It holds
  the few errors that happen before the chunk arrives and drops them on sign-out. A boolean define
  (`__SENTRY_ENABLED__`) guards the `import()`, so a build without the key emits no chunk at all;
  only the chunk reads the key itself, so the key's text never lands in the entry.
- **When it must stay on some routes of a shared bundle** (MUT-150, Sentry on the landing): the
  gate runs only where `landingRoute()` names a website page and drops anything sent once the page
  isn't one. Name the SDK's `manualChunks` entry only when the key is set (naming it emits the chunk
  even unimported), add both chunks to the precache ignores, and scope any origin the chunk needs
  to those chunk names (`PATTERN_SCOPED_ORIGINS`), never to the bundle-wide allowlist.

### Pattern: Release-QA answers third-party traffic locally
- **The fixture.** `qa/support/qa.ts` gives every spec an `analytics` fixture
  (`qa/support/posthog.ts`) that answers PostHog requests and records what would have been sent.
  QA builds carry a dummy `phc_` key. MUT-149 adds `crashReports` (`qa/support/sentry.ts`), the same
  for every Sentry host, with a dummy DSN on the org's ingest host in the portal's QA build.
- **Bot filter.** Specs that read events call `actAsPerson(page)`, because posthog-js drops events
  from automated browsers.

## Patterns added by MUT-147 (2026-10-17)

### Pattern: Terraform guards are tested offline with a mocked provider
A setting that protects cost, privacy or abuse (a rate limit, an origin allow-list, `default_key = false`, spike protection) gets an assertion in `<module>/tests/*.tftest.hcl` that runs against `mock_provider` with `command = apply`, so CI needs no token, account or network. Give a mocked map or object attribute that outputs read a value in `mock_resource … defaults`. Variable validations get an `expect_failures` run. server-ci runs `terraform test` beside `fmt` and `validate`. First instance: `server/infrastructure/sentry/tests/sentry.tftest.hcl`.

### Pattern: A cross-surface contract splits runtime rules from test-only fixtures
When several surfaces (TypeScript, Dart, the server image) must apply the same rules, the rules live in one JSON that a web bundle may import, and the dirty-in/clean-out fixtures live in a second JSON that only tests read. Both are sha-pinned per version, and the fixtures carry a marker string that `check-bundles` refuses. Surfaces that can't read the repo at runtime (the server image, Flutter) embed the lists and assert equality with the JSON in a test. First instance: `docs/observability/sentry-rules.json` + `sentry-fixtures.json` (ADR-091), after the single-file `docs/analytics/events.json` (ADR-090).

### Pattern: A terraform test that overrides a resource's values runs in its own test file
Runs in one `.tftest.hcl` share state. Once an earlier `command = apply` run has created a resource, a later run's `override_resource` no longer reaches it, because nothing is re-created. So an expected-failure run that depends on an override (for example a postcondition fed a wrong value) goes in its own file with its own `mock_provider` block. First instance: `server/infrastructure/sentry/tests/eu_region.tftest.hcl` (MUT-147 review).

## Patterns added by MUT-270 (2026-10-18, ADR-093)

### Pattern: A query's index use is pinned by an EXPLAIN test, not assumed
A list that promises "no full scan" gets a test:db test that captures the SQL Prisma actually sends (`log: [{ emit: 'event', level: 'query' }]`), inlines the bound values, and EXPLAINs it inside a transaction with `enable_seqscan`, `enable_bitmapscan` and `enable_sort` off. The plan must name the intended index and contain no Seq Scan, Bitmap or Sort; seed realistic skew (and `ANALYZE`) where a wider index competes. Prove it by dropping the index once and watching it fail. First instance: `server/src/repositories/__tests__/store-prisma-entries-plan.test.ts`.

### Pattern: A descending keyset cursor leads with a range condition
`(createdAt < t) OR (createdAt = t AND id < i)` is correct but Postgres cannot turn it into an index range, so it sorts the organization's rows. Write it as `createdAt <= t AND (createdAt < t OR id < i)`: the first conjunct becomes the index range and the OR only filters rows at the same instant. First instance: `feedCursorWhere` in `server/src/repositories/prisma.ts`.

### Pattern: The GCP Terraform module's guards are tested with mocked Google and random providers
Same as the Sentry module's pattern above, now for `server/infrastructure/terraform/tests/`. A mocked string is random, so give IAM-checked attributes (a service account's `name` and `email`) well-formed `mock_resource` defaults. First instance: `tests/database_pool.tftest.hcl`.

## Patterns added by MUT-268 (2026-10-18, ADR-095)

### Pattern: An optimistic change yields to the next load, counted, not timed
Show a write at once as a pending overlay on the cached reads; record each read's `dataUpdateCount` when the request settles; keep applying the overlay to a read only while its count has not moved past that. Never compare `dataUpdatedAt` with `Date.now()`: equal milliseconds (fast fakes, frozen clocks) drop or double the change. Overlays that are idempotent (row moves) may apply to several reads at once; arithmetic ones (totals) are tied to their own read. First instance: `useGroupMarks` (`src/hosted/data/expenseGroupQueries.ts`).

### Pattern: Per-entity write chains for last-write-wins endpoints
When an endpoint has no If-Match and the last arrival wins, chain each entity's writes (`sendMark`'s per-`groupId:expenseId` promise queue) so an action and its Undo can't race; a failure doesn't block the next one.

### Pattern: Batches save one at a time and refetch once
`runSequential(items, save)` returns `{ done, failed }`; the UI moves every item at once, suppresses per-save invalidation while the batch runs, refetches at the end, and offers Retry for `failed` only.

## Patterns added by MUT-286 (2026-10-19, ADR-097, ADR-100)

### Pattern: A lazy chunk the main program can't type-check is reached through a module alias with a contract file
When a lazily loaded module can't live in the importer's TypeScript program (the portal can't check `server/src`'s route modules), give it one alias (`@mut/local-backend`). The importer's tsconfig `paths` maps the alias to a small contract file of types plus a `declare const` for the entry. The bundler (and Vitest) maps it to the real module, which implements the same contract type under its own program. ESLint forbids a static import of the alias, so the chunk stays lazy. First instance: `src/hosted/session/localBackendContract.ts`.

### Pattern: After replacing who the person is, navigate to an explicit target read from a fresh answer
A redirect (`/` → first profile) decides once, from whatever the observer last rendered, and a cache reset reaches observers a tick later. After swapping identity data (Restore), `fetchQuery` the new `/v1/me` and navigate straight to its first profile; pages that read `/v1/me` on every render correct themselves, a redirect doesn't. First instance: `YourDataDrawer.replace`.

## Patterns added by MUT-318 (2026-10-19, ADR-100 decision 10)

### Pattern: A typeahead saving a pick is read-only, never disabled
A focused input that becomes `disabled` loses focus (HTML focus fixup): the keyboard drops to `<body>` and anything that checks `activeElement` (EntityTypeahead's "Enter held while saving submits once saved") silently stops working. While an async `onSelect` runs, EntityTypeahead sets `readOnly` beside `aria-busy`; callers must not pass their mutation's `isPending` into `disabled`. First instance: `EntityTypeahead` (`selecting`), ClientPicker/ProjectPicker.

### Pattern: One-shot field cues are a class toggled on the DOM, restarted by a signal
A cue (a field filled by another, a record just created) is a class on the typeahead root: removed, reflowed, re-added, and taken off by a timer after its span, so it never touches React state and a reduced-motion still tint (which fires no `animationend`) still ends. Callers bump a number (`flashSignal`) to play it; never on mount. Durations live beside the keyframes (`CASCADE_FLASH_MS`/`CREATE_SUCCESS_MS` ↔ the CSS vars). First instance: `EntityTypeahead` `playCue`.

### Pattern: A form-only hook both apps need lives in `src/lib/forms/`
The portal's lint bans `src/hooks/` (Dexie-backed hooks live there). A hook that only reads a react-hook-form `form` and plain arrays moves to `src/lib/forms/` and takes the app-specific shape through options (`ownerOf`), so the local app and the portal run one rule. First instance: `useClientProjectCascade` (local drawers; portal via `src/hosted/components/useMatterCascade.ts`).

### Pattern: A conditional field hint is an always-mounted polite region the input describes
A hint that appears while typing ("Choose a client first to add a matter.") is rendered always, empty when it doesn't apply, with `aria-live="polite"` and the input's `aria-describedby` (EntityTypeahead `describedBy`): a live region must exist before its text changes to be announced, and the description is read on focus. Collapse its margin while empty. First instance: ProjectPicker.

### Pattern: A drawer holds Save while a picker is still adding (MUT-318 reconcile)
A picker that creates on pick (Add «name») reports `onCreatingChange(true/false)` around its mutation (`finally`). The drawer's `usePendingPicks()` counts them: `pending` drives Save's look, `guard(handleSubmit(onSubmit))` drops a submit while any is in flight, before validation. The guard reads a ref, not state, because the picker reports done just before EntityTypeahead submits for an Enter held during the save, ahead of React's re-render. First instance: the hosted IncomeCaptureDrawer and ExpenseDrawer; the local IncomeDrawer's `clientCreating` is the same idea.

## Patterns added by MUT-324 (2026-10-19, ADR-102)

### Pattern: A legal text people accept is a frozen, versioned file, fingerprinted where it's accepted
Each version is its own content file, never edited once released. The side that records acceptance (the server) pins the version and the sha256 of each language's file, and stores the hash with every acceptance. A root test keeps the pin and the files in step, so a changed text that kept its version fails CI.

### Pattern: Prove a static file is live with a build-emitted manifest, not a page fetch
Netlify's SPA fallback answers 200 for every path, so a release guard can't fetch a page to learn whether it exists. The web build emits a small JSON manifest (`legal/terms-versions.json`), like `__forms.html`. The guard (`server/src/scripts/check-terms-live.ts`, run by `scripts/preflight.sh server` before the version bump and again by `deploy.sh`) reads that file and compares it to what the release is about to name.
## Patterns added by MUT-287 (2026-10-19, ADR-100 decision 11)

### Pattern: Two local databases are kept consistent by order, not by one transaction
When records (`mut-local`) and their files (`mut-local-blobs`) live apart, never delete a file before the records that stop naming it are saved: stage removals during the request and flush them inside the same lock right after the save; on Restore add the new files, save, then sweep files no live record names; sweep on boot for whatever a crash left. A crash at any step leaves records whose files all exist. First instance: `LocalAttachmentStorage` + `transport.ts`, `restore.ts` `applyRestore`.

### Pattern: A Node stand-in for server modules is bound per module, never on `globalThis`
Server code that runs in the page (`server/src` in the local chunk) gets its Node globals as module bindings injected at build time (`scopeServerBufferShim`, like the `node:crypto` alias), not as a global: libraries sniff `typeof Buffer` and take a Node path a partial stand-in can't serve (jszip did). Verify such paths in a real browser (release-QA): unit tests run on Node's real globals and can't see the difference.

### Pattern: Every local IndexedDB database opens through `LocalDatabase` (MUT-287 review D12)
A database the page owns must let go when a newer build upgrades it (`onversionchange`: close, then refuse further use so the reload screen shows) and must not hang when an older tab won't (`onblocked` rejects). Both rules live in `src/hosted/local/idb.ts`; `persistence.ts` and `blobStore.ts` use it, and so must any later local database. Tabs running a build are the old tabs of the next one.

## Patterns added by MUT-336 (2026-10-19)

### Pattern: Generated output is pure logic + a thin fs wrapper, named `<name>.ts` / `check-<name>.ts`
Following `scripts/i18n-keys.ts` + `scripts/check-i18n-keys.ts`: the logic (parsing, naming, codegen, drift-detection) takes and returns plain data — strings, `Record<string, string>` — never touches `node:fs` itself, so `scripts/__tests__/*.test.ts` exercises the exact logic the real run uses, with vitest picking the test up automatically (it only globs `scripts/**/*.test.ts`, not `.mjs` — `validate_illustrations.mjs`'s sibling `.test.mjs` predates this and isn't wired into any script, a pre-existing gap, not a convention to copy). The CLI file does only `readdirSync`/`readFileSync`/`writeFileSync` and exits non-zero on error. First instance: `scripts/icon-set.ts` + `scripts/generate-icons.ts` / `scripts/validate-icon-set.ts` (MUT-336).

### Pattern: A generated directory is wholly owned — nothing in it is hand-edited, ever
`src/components/icons/generated/` (barrel, shared types module, every component) is rewritten in full by its generator every run; the validator (`icons:check`) regenerates each source in memory and diffs it against what's on disk to catch hand-edited-then-forgotten-to-regenerate drift, plus orphaned generated files with no matching source. The generator itself computes and validates everything before writing anything — one bad input fails the whole run with nothing written, never a silent partial regenerate. First instance: MUT-336's icon codegen.

### Pattern: A named sub-part survives codegen as `data-part`, never a raw `id`
A source asset's named sub-element (`id="nuqta"`) exists for something downstream to target one part of it later (an animation runtime, in this case). Emitting it as a raw DOM `id` breaks the instant the same generated component renders twice on one page — two elements can't share an `id`, and a global `id` selector would just find the first. Emit `data-part="<name>"` instead and scope the lookup to one instance's root (`rootRef.current.querySelector('[data-part="nuqta"]')`). First instance: the icon codegen pipeline (MUT-336); applies to any future SVG/asset codegen with named internal parts.

## Patterns added by MUT-337 (2026-10-19)

### Pattern: A playful/restrained split is one transform through one of two named curves, never two engines
When a feature needs a "playful" and a "restrained" version of the same motion, don't reach for two different animation mechanisms (e.g. a bounce library for one, CSS for the other) — play the identical transform through a different easing curve. `ICON_OVERSHOOT_EASE`/`ICON_RESTRAINED_EASE` (`src/lib/motion/iconMotion.ts`) are the exact four control points as Flutter's `MMotion.overshoot`/`.spring` (`mutaba3a_theme.dart:74-76`) — a cubic-bezier with y > 1 overshoots before settling (playful); one that stays within [0,1] doesn't (restrained). Proven in `iconMotion.test.ts`: the playful preset's live value is asserted `> 1` at some point mid-flight, not just "which constant was passed." First instance: MUT-337's icon save-feedback prototype.

### Pattern: Before adding a dependency, check if this app already rejected its category (ADR search)
MUT-337 almost evaluated Rive from scratch; `.claude/DECISIONS.md`'s ADR-079/080 had already rejected `lottie-web` for the same shape of reason (new runtime, new CSP grant, new asset pipeline, to buy capability a simpler existing tool already covers) — the comparison this time started from "does our existing CSP-proven, zero-new-dependency motion tooling (`motion`, ADR-044) already cover this" instead of re-litigating general-purpose-engine tradeoffs. Search `DECISIONS.md` for the capability category (not the specific library name) before comparing candidates for anything animation/media/rendering-runtime shaped.


## Patterns added by MUT-325 (2026-10-20, ADR-156)

### Pattern: A large download is pulled a page at a time, never built whole
`GET /v1/records-export` returns a `ReadableStream` whose `pull()` asks an async generator for the next chunk (`recordsFileChunks` over `profileExportPages`): each page is one 500-row query, read only when the reader wants more, so a slow client slows the reads and the server holds one page. A failure mid-stream calls `controller.error()`, cutting the response off (and logging it) instead of ending it as if whole; the portal decodes before saving, so a cut file is refused.

### Pattern: A Prisma read that must match a record exactly selects `Columns<R>`
`prisma-records-export.ts` types each `select` as exactly the record's keys (`cols<R>()({...})`: every key, nothing extra), so a column the record lacks never leaks and a field it has is never dropped. Prisma can't check a select passed through a shared delegate, so `prisma-records-export-columns.test.ts` holds every selected column to `Prisma.dmmf` without a database.

### Pattern: Code that runs server modules in the page is a lazy alias with a contract file
Like `@mut/local-backend`: `@mut/records-export` maps to `session/recordsExportContract.ts` for the portal's types (tsconfig.hosted.json) and to `src/hosted/local/hostedExport.ts` for code (vite/vitest), so the portal program never type-checks server files and the chunk loads on click. Dependencies the chunk can't import (the portal's `send()`) are injected (`RecordsExportTransport`).

## Patterns added by MUT-326 (2026-10-20, ADR-155)

### Pattern: A public host is read from `config/hosts.json`, never written down
Our own hosts (landing, portal/API, legacy and new) live only in `config/hosts.json`. TypeScript reads `HOSTS` from `config/hosts.ts`; shell scripts read `npm run --silent hosts -- get <landingOrigin|portalOrigin|domain>`; Terraform reads the file with `jsondecode(file("${path.module}/${var.hosts_file}"))` (tests point `hosts_file` at `config/fixtures/`). `scripts/__tests__/no-hardcoded-hosts.test.ts` fails otherwise. Tests and examples that need *an* origin use neutral ones (`example.com`, `*.example.test`), never ours. The Malafat CIMD client id is the one deliberate exception: a fixed literal on `mtb3a.com` in three files (MUT-387). Tests import `CIMD_CLIENT_ID` rather than spelling it. Hosts we never owned go in the guard's `RETIRED_HOSTS` and may not appear even in those files.

### Pattern: An origin one shipped file needs is scoped to that file (MUT-387)
When a single dist file must name a host the rest of the bundle may not (the OAuth client document), list it in `FILE_SCOPED_ORIGINS` (`scripts/bundle-rules.ts`, keyed by dist path), never in `bundle-origins.json`. `originsNeedingReview` drops it for that file only.

### Pattern: A file an outside system fetches is checked live after the release (MUT-387)
When another service reads a document we publish (Malafat reads the CIMD document), the release waits for the deploy and checks the served copy the way that service will (`scripts/oauth-client-live.ts` pure + injected fetch/clock, `scripts/check-oauth-client.ts` CLI, run by `make release web`). Unit tests cover every refusal; the live run is the proof.

### Pattern: A move that needs DNS is staged in config, not in branches
"The value is known" and "the value is live" are separate fields (`domain` vs `stage`). Infrastructure keys on the first; builds and links key on the second, so a commit can name the domain without the next release pointing anyone at a host that doesn't resolve yet. `npm run domain:plan -- --stage <s>` shows each stage's effect before it's committed.

### Pattern: A second path to the service proves itself with a token, not a hop count
When the same service is reached both directly and through a proxy, don't raise `TRUSTED_PROXY_HOPS`: that trusts a forged `X-Forwarded-For` entry on the direct path. The proxy sends a shared secret (Secret Manager, a `secret_text` binding) plus the client IP it read. The server uses those only when the secret matches (digest + `timingSafeEqual`) and otherwise keeps its old rules (`auth/sessions.ts` `requestClientIp`, `isSamePortalOrigin`).

## Patterns added by MUT-373 (2026-10-21, ADR-163)

### Pattern: Ownership is one function, and the role only counts where it can
`ownsProfile(org, userId, role)` is the only "does this person own this profile" check, on the server and in SQL (`coOwnedBy` mirrors its second branch). Never compare `ownerUserId`, `personalOwnerUserId` or `Membership.role` at a call site. A role that has a default (OWNER) must be gated by a structural condition (`canCoOwn`) before it grants anything, or every defaulted row gains the right.

### Pattern: Decide under the lock in a shared rules module, write in each store
Co-owner grants and removals take the organization row lock, read the rows, and ask a pure function in `co-owners.ts` (`grantOwnerRefusal`, `removeOwnerDecision`) what to do — the `firm.ts` pattern — so the memory store and Postgres refuse identically and the contract test pins both.

### Pattern: A removal animates first, then the cache forgets
When a server answer would unmount the row that should animate out, keep the id in local "exiting" state, collapse it, and write the cache on `transitionend` or a fallback timer (motion tokens are 0ms under reduced motion, so there is no transition to wait for). Focus goes to the next row, else the previous, else the section heading.

### Pattern: Navigate away before forgetting the open profile
Leaving the open profile navigates to the personal profile first and only then drops it from `ME_KEY` and `removeQueries(['p', id])`, so nothing renders "This profile isn't available" in between. A profile lost involuntarily is noticed by ProfileLayout (the `lostAccess` store remembers the open one) and gets a named banner instead.

## Patterns added by MUT-360 (2026-10-21, ADR-165)

### Pattern: A public webhook that verifies a raw body
The sender's signature covers the exact bytes it sent, so the route declares no zod body (which would parse it first) and reads `await c.req.text()` before verifying. It sets `security: []` and lives outside `PORTAL_ROUTES`. It gets its own `bodyLimit` (`hono/body-limit`, 413 `PAYLOAD_TOO_LARGE`) on that path only, and its own per-IP `SlidingWindowRateLimiter`, built in `index.ts` so the prune timer covers it. A bad signature is 400 and stores nothing. Add the operation to `PUBLIC_OPERATIONS` (`route-security.test.ts`) and to `no-self-registration.test.ts`'s list, with a comment saying it creates no account. Example: `routes/stripe-billing.ts`.

### Pattern: An optional shared-secret token
A token the server may run without (`MUTABA3A_JOB_TOKEN`) refuses every request with 503 when it is unset, before any compare. Never let it fall back to an empty string: `timingSafeEqual` on two empty buffers is true, so an empty header would pass. Compare lengths first, then `timingSafeEqual`. One token opens one prefix; another token doesn't open it (`jobAuth` on `/jobs/*`, `adminAuth` on `/admin/*`, both in `routes/admin.ts`).

### Pattern: Third-party SDK errors never reach a logger
An SDK error object can carry the request, its headers and the body. Wrap every call in the adapter and rethrow a typed error with only safe fields (`StripeGatewayError { code, type, requestId, transient }`, `billing/stripe/gateway.ts`). Anything that isn't the SDK's own error becomes the same type with nothing copied. Callers log those fields, never `err`, and a route test throws a raw SDK error and checks the log line holds no key or body.

### Pattern: Hono typed JSON needs type aliases, not interfaces
A value passed to `c.json(...)` on an OpenAPI route must be a `type` alias, not an `interface`: Hono's typed JSON responses need the implicit index signature that only type aliases get. Declare response shapes as `export type X = { ... }` (`ReconcileSummary` in `billing/stripe/sync.ts`).

### Pattern: Newer read wins for mirrored third-party state
When the source object has no updated time of its own, stamp each read with the time the request was **sent** (a list's page time, never the moment each item is processed). The write locks the row (`SELECT … FOR UPDATE`), and when the stored stamp is later it returns `stale` and writes nothing. Re-fetching on every event plus this guard makes out-of-order and duplicate deliveries harmless. The change audit is built inside the same transaction after the compare, so `from` is the row actually replaced (`billing.saveSubscription`, `repositories/billing-audit.ts`).

### Mirrored third-party state never freezes "paid" (MUT-360 review)
A sync that can't map an object must still write the fields that end access (status, period, cancel-at-period-end) on
the values already stored, and the reader should stop trusting a covering state past its period plus a grace
(`PERIOD_GRACE_DAYS` in `billing/entitlement.ts`). Fail closed after the period, not open for ever.

### Lock order for rows two writers share (MUT-360 review)
When two paths both decide from a row and write it (`saveAccount` and `linkAccount`), lock it `FOR UPDATE` first, then
any second row, in the same order on both paths; re-read after locking, and write only the fields this call decided.
Never write back a value read before the lock. Pin it with a `Promise.all` contract test that runs on Postgres.

### Error reports go through an injected `ErrorReporter`, never the SDK (MUT-148)
Server code that reports takes an `ErrorReporter` (`server/src/observability/reporter.ts`), defaulting to
`NOOP_REPORTER`; only `index.ts` and the operator scripts build the real one (`sentry-node.ts`). Report exactly
where you already log at error level, never more. Shared server code is bundled into the portal's local mode,
which must send nothing (ADR-024), and `sentry-local-boundary.test.ts` fails if its import graph reaches `@sentry/`.

## Patterns added by MUT-390 (2026-10-22, ADR-168)

### Pattern: A list filter is allowed only with the order whose index bounds it
A filter that the chosen index cannot use as a range is a residual filter: when few rows match, the last page walks
the organization's whole history before it can say "no more". Refuse such combinations with a 422 naming the field,
and pin each allowed one with an EXPLAIN case that finds the bound in `Index Cond`. First instance: `GET /v1/entries`
(`server/src/routes/entries.ts`, `store-prisma-entries-plan.test.ts`).

### Pattern: Keyset bounds go in separate AND entries
A cursor and a filter on the same column (`createdAt <= t` and `createdAt >= since`) overwrite each other when spread
into one Prisma `where` object. Push each bound as its own `AND` entry, and test a filter and a cursor together across
pages. First instance: `feedBounds` in `server/src/repositories/prisma.ts`.

## Patterns added by MUT-359 (2026-10-23, ADR-174)

### Pattern: A webhook on a shared provider account acts only on its own traffic
When the provider account is shared (Resend with Malafat), its webhooks deliver the other product's events too. After
verifying the signature, filter on a field that names us (the sender's domain) before writing anything, and test an
event from the other product. First instance: `suppressionsFrom` in `server/src/email/resend-webhook.ts`.

### Pattern: Abuse caps and idempotency in a digest-only log
Counts that must survive restarts live in Postgres, but the table stores sha256 digests of the key and the recipient,
never the address or the content. Claim before the side effect, finish after; a FAILED, UNCERTAIN (timed out) or
long-PENDING claim may be re-claimed, and UNCERTAIN keeps counting. A count-then-insert spans awaits, so serialize
claims (in process while there is one instance). Keep a reserve of the global cap for traffic that must never be
starved (recovery mail), and keep it away from anything a user can trigger at will. First instance:
`email_deliveries` and `createMailer`.

### Pattern: A post-commit notice never changes the answer
A side effect after the commit (a notice mail) is awaited with a bounded timeout, wrapped so it can't throw, and keyed
by the request id so a retry can't double it. First instance: `sendPasswordNotice` in the setup-link redeem and
`POST /v1/me/password`.

## Patterns added by MUT-366 (2026-10-23, ADR-175)

### Pattern: A public route that must not reveal an account answers on a floor
Every branch (account, no account, suppressed) returns the same status and body, and waits until a fixed time after
the request began, measured on a monotonic clock (never the injectable `now`). Do the branch's work, side effects
included, before the floor; log when it overshoots. Refuse early only for what depends on the request alone (switch,
origin, client budget, body, bot check, the address's budget). First instance: `routes/self-service.ts` with
`answerNoEarlierThan`.

### Pattern: A bot check verified by the server, failing closed, with offline test secrets
The server calls the provider itself with a timeout, and anything but an explicit pass is a refusal. The provider's
published test secrets are recognised and answered locally, so tests and QA never reach it, and production config
refuses them. First instance: `server/src/auth/turnstile.ts`.

### Pattern: A link bound to an address, serialised by an advisory lock
When a row must not exist until a link is redeemed (no user yet), lock on the natural key with
`pg_advisory_xact_lock(<namespace>, hashtext(key))` in both the issue and the redeem, and re-check "nobody holds it"
inside the redeem's transaction; also catch the unique violation a writer that doesn't take the lock can cause.
First instance: `accountSetup.issueSignup` / `redeemSignup`.

## Patterns added by MUT-367 (2026-10-23, ADR-178)

### Pattern: An outside lookup behind a port, with a fixture adapter that production config refuses
- **The port and its adapters:** a check that would reach the internet (DNS, RDAP) sits behind a port.
  - The real adapter runs every lookup under one total budget and cancels the rest.
  - The real adapter maps only definite "no record" answers to absence; any other error is `unknown`, never a refusal.
  - A fixture adapter answers from a fixed table of reserved `.example` domains.
- **Selection:** config chooses the adapter (`EMAIL_DOMAIN_CHECKER`), defaults to the fixture outside production, and refuses it in production.
- **Tests and QA** inject or default to the fixture, so nothing in CI asks the network.
- **First instance:** `server/src/email/domains/`.

### Pattern: A hard delete that relies on RESTRICT foreign keys to prove the account is empty
- Delete inside one transaction, under a row lock.
- First remove the rows that are known parts of the shell.
- Check explicitly for anything that would *cascade* away silently (grants) or has no foreign key (billing account).
- Let RESTRICT foreign keys refuse anything else. Map that error, and the explicit check, to `not_empty`, and roll back.
- The memory store mirrors it by scanning its maps.
- **First instance:** `signupReviews.decline`.


## Patterns added by MUT-368 (2026-10-24, ADR-179)

### Pattern: The server names the doors a page may show
- A public, read-only endpoint (`GET /v1/self-service`) says which self-service actions this server can really complete, derived from its configuration.
- The page shows a door only when it is open, and treats no answer as closed. A build flag would drift from the server; showing every door would leave dead ones while mail is off.
- **First instance:** sign-in's "Forgot your password?" / "Create an account".
- **Second instance (MUT-369, ADR-186):** the landing, on another origin, reads the same endpoint (CORS-simple GET, `Access-Control-Allow-Origin: *` on that route only) to show "Create an account". Keep the request free of custom headers, or the browser preflights and the door reads closed.

### Pattern: A link names its language; the target reads it once and never stores it
- `?lang=en|ar` on a link (`/privacy`, `/terms`, the portal's `/signup`) is the language of the page the person came from. `linkedLanguageOf` reads it; a legal page uses it for the text only, and the portal (MUT-369) starts in it, takes it off the address before the router starts (`takeLinkedLanguage`), and never stores it, so a reload keeps the person's own switch.

### Pattern: A third-party widget in QA is a page-routed stand-in on the real origin
- QA never calls a third party. The spec answers the widget's script URL (and the frame it mounts) with `page.route`, on the third party's own origin.
- The page's real CSP still decides whether the script and frame may load, and the stand-in mimics the vendor's published test keys (pass, fail).
- The live check of the real widget is an operator step at go-live (TD-216).
- **First instance:** `qa/support/turnstile.ts`.

### Pattern: A live-API QA app serves the built portal itself
- When a flow needs real mail, real tokens or an operator action, the QA app runs the API with test adapters (the memory mailer, fixture checkers, test secrets) on a per-launch database. The API serves `vite build --mode hosted` from `PORTAL_DIST_DIR`, so production's CSP and hashed assets are what the specs see.
- Each test sends its own `X-Forwarded-For` (`playwright.clientIpHeader`) so per-IP budgets don't add up.
- **First instance:** `qa/support/selfservice-live.mjs` (the `portal-selfservice` app).

## Patterns added by MUT-175 (2026-10-24, ADR-189)

### Pattern: Staged insights from data, not from settings
A screen that gets smarter with history derives its stage from the records themselves (complete months by a cutoff day), computes insights as pure, deterministic rules with named thresholds over the latest complete periods only, and ranks them changed-fact first, then by kind, then by size, capped. What unlocks next is said in one teaser with a date, never hidden. Insights never move with the period on screen. No LLM.

### Pattern: Per-profile server reads, combined and converted in the portal
The server answers one profile, per currency (ADR-004). A cross-profile view fans out one query per profile, each with its own status, adds per currency, then converts once at today's rate. A failed profile is named with its own Retry and the rest renders; only "nothing loaded" is a page error.

## Patterns added by MUT-291 (2026-10-24, ADR-185)

### Pattern: Replay untrusted records through the server's own routes in a throwaway app, then land them in one write
Imported data is never written field by field into the live store. It is mapped to requests and sent through `createLocalApp` over a fresh `MemoryLedgerStore`, with no persistence and no rate limit, so every route rule checks it. Its snapshot is then checked against the source and written once with `applyRestore`. A 4xx is the record's answer and gets listed; a 5xx aborts.

### Pattern: A cross-origin hand-off is a popup opened from the click, with origins baked at build time
`window.open` runs synchronously in the click handler (Safari and Firefox drop the permission across an await), without `noopener`. Both sides check `event.origin` and `event.source` against build-time origins, never against a URL parameter, and each side has its own timeout. Neither page may send COOP `same-origin`; a test pins that.

### Pattern: A plan-dependent write is refused once, at the door, and the portal only mirrors it (MUT-361)
- The server decides in one pure module (`server/src/billing/gate.ts`) applied once in `authenticate()`, before any route work: method + endpoint class, never per route. Every organization-independent endpoint is classified in one table, and a test fails on an unclassified one.
- `/v1/me` publishes the verdict (`billing.state` per profile, `billingStanding` for the person), so clients branch on it instead of re-deriving the rules.
- In the portal every write affordance takes `writable` (`useWriteGate()`); a write drawer stays openable view-only (`Drawer readOnly` + `ReadOnlyFields`), keeping reads like a receipt's Download. A late refusal re-reads `/v1/me` through the query client's caches.
- **First instance:** the lapse gate (ADR-181).


### Pattern: An irreversible job claims under the row lock, calls out, commits, then cleans up from a queue (MUT-333)
- A destructive per-row job first commits a claim (`purgeStartedAt`) under the same row lock the user's own "undo" takes, and the undo is a conditional update that refuses once claimed: the two serialize, whatever the instances' clocks say.
- External, idempotent deletes that must not outlive the row (Stripe) run after the claim and before the transaction; a failure leaves the claim and retries next run.
- Deletes that must follow the decision (bucket objects) are queued inside the transaction (`storage_purges`) and drained after the commit and at the start of every run, so a crash loses nothing and a decision that changed in the window never deletes the wrong files.
- **First instance:** `server/src/accounts/purge-run.ts` (ADR-188).

### Pattern: Prove a delete is complete against the database's own catalog (MUT-333)
- List every table the delete knows in one module (`prisma-purge-tables.ts`); a test:db reads `information_schema`/`pg_constraint` and fails on a table or foreign key it doesn't classify, so a new table can't be forgotten.
- After a seeded delete, scan every text, uuid, JSON and array column of every table for the subject's id, email and name, with named exemptions only (the audit tombstone). Keys alone miss columns with no foreign key.
- **First instance:** `server/src/repositories/__tests__/prisma-account-purge-catalog.test.ts`.

### Pattern: Test WebAuthn with a real soft authenticator, never a mocked verifier (MUT-115)
- Server: `SoftAuthenticator` makes attestation-`none` credentials and ES256 assertions for any origin on node:crypto, so `@simplewebauthn/server`'s real checks run; knobs flip one fact to refuse (no UV, wrong RP ID, counter, user handle).
- Browser QA: Chromium's virtual authenticator over CDP (`qa/support/passkeys.ts`) against the live API on `localhost` (an IP can't be an RP ID). It answers conditional mediation at once, so a spec turns presence off while signing out.
- **First instances:** `server/src/__tests__/routes-passkeys.test.ts`, `qa/specs/portal-selfservice/passkeys.spec.ts`.

### Pattern: Glass chrome over a scrolling document (MUT-426)
- Floating chrome is `position: fixed` over a page that still scrolls the document (no inner scroller), so scroll restoration, `scrollIntoView` and drawers keep working; the page reserves the chrome's space, so at rest nothing sits under it.
- Glass is one class (`.hp-glass`: translucent `--surface`, `backdrop-filter`, a lift) with a solid fallback under `prefers-reduced-transparency` and without `backdrop-filter`. The fade where content meets it is a fixed `--bg` gradient band, never a mask (the document, not an element, scrolls).
- **First instance:** `src/hosted/shell/HostedShell.tsx`, `src/hosted/hosted.css` (ADR-195).

### Pattern: Page motion by depth, as typed view transitions (MUT-426)
- A pure rule names each navigation's motion from the two pathnames (`pageMotionOf`, first match wins); the router hands it to `document.startViewTransition({ types })`, and CSS draws each type on `::view-transition-old/new(root)` with RTL picking mirrored keyframes by name. Direction comes from depth, not history, so browser Back and a back link agree.
- Gate it on view-transition types (both our check and the router's): the router otherwise starts untyped transitions on every navigation, search-only ones included. Search-only changes return `false`; the chrome gets its own `view-transition-name` and holds still.
- Prove it in a real browser by wrapping `document.startViewTransition` in an init script and reading `getAnimations()` on `::view-transition-new(root)` after `ready`.
- **First instances:** `src/hosted/shell/pageMotion.ts`, `qa/specs/portal/shell.spec.ts` (`portal.shell.page-motion`).

### Pattern: A 401 for a credential the client no longer holds is not a sign-out (MUT-208, MUT-262)
- When a client swaps its own credential (a password change rotates the token), requests already sent with the old one can come back 401 after the swap. Judge each 401 by the credential it was sent with, not by when it arrived.
- Portal: `src/hosted/api/client.ts` stamps each request with a credential generation; the swapping call bumps it on success; a 401 first waits for any swap in flight, then reaches the unauthorised handler only if its generation is still current. The swapping call itself never waits on itself.
- Phone: `ApiClient.rotating(...)` holds a refused-session check until the new token is in the Keychain; the check then compares against the stored token.
- **First instances:** the phone's MUT-208 refused-session check; `rotatingCredential` in the portal client (ADR-194).

### Pattern: A step that must be answered mid-session goes above the app, never in place of it (MUT-346)
- Swapping the routed content for a gate unmounts whatever the person had open (a drawer's draft). Once the app has been shown this visit, a gate that appears later renders as a `BlockingDialog` (`src/components/ui/BlockingDialog.tsx`) above the still-mounted app; before that (boot, sign-in) it stays the full page, with nothing loading behind it.
- `BlockingDialog` portals to `<body>` and opens on one shared layer (`blockingLayer.ts`): every `<body>` child but the newest dialog is `inert` + `aria-hidden` (the app root, so toasts too; children that join later too, via a MutationObserver), dialogs close in any order, the page doesn't scroll behind (`<html>` overflow hidden, scrollbar room kept), and without native `inert` (iOS < 15.5) a focus guard brings focus back to the top dialog. It swallows Escape in the window capture phase so a drawer's document listener never closes, reuses `useDrawerFocus` for focus in and Tab wrap, and returns focus itself once the app is reachable again, whenever nothing else holds it (its own button disables itself while saving, and the browser drops focus to `<body>` before the dialog goes). It sets the attributes, not the `inert` property (jsdom doesn't reflect it).
- jsdom has no `inert` behaviour: unit tests assert the attributes; reachability and focus return are proven in Playwright.
- **First instance:** the Updated-terms step (`TermsUpdateDialog`, AuthGate).

### Pattern: A new credential principal starts with a fail-closed store guard (MUT-434)
- A new kind of caller (an MCP agent's OAuth token) gets its own guard that refuses every store method except `read`-class ones (`agentStoreGuard`, `server/src/auth/store-guard.ts`), instead of borrowing the session's. Each feature that needs data opens the exact methods it uses, with tests, in its own ticket.
- Its authentication reads the raw store (like `authenticate()` reads sessions) and re-checks the flag, the account's status and closure on every request: no cached decision outlives a revoke.
- **First instance:** `authenticateAgent` on `/mcp` (MUT-434); MUT-435/436 widen it per tool.
- **Since MUT-435:** the guard is an explicit allow-list of `repo.method` names (`AGENT_STORE_METHODS`), pinned by a test; a method's class alone opens nothing.

### Pattern: A retried single-use credential returns the same answer, derived, not stored (MUT-434)
- When a once-only exchange (a refresh rotation) can be retried by an honest client (a lost response, parallel calls), make the successor a deterministic function of the presented secret and a recorded id — `HMAC(key, parent ∥ successorId)` — so any re-presentation inside a short window re-derives the identical answer without storing plaintext. Outside the window, re-presentation is the theft signal.
- Pair it with a conditional claim (`UPDATE … WHERE rotatedAt IS NULL`, proceed on one changed row) so exactly one request records the successor id.
- **First instance:** `OAuthService.refresh` (`server/src/oauth/service.ts`, D19).

### Pattern: An MCP tool is context → agentProfile → compose/store → runTool (MUT-435)
- Register tools in `server/src/mcp/*-tools.ts` with a Zod input and output schema; the handler is `runTool(ctx, async () => …)`, which returns structured content (plus a text copy) or a tool error the agent can read (`CODE: message`; anything unexpected to Sentry as a plain retry message).
- A tool that names a profile resolves it with `agentProfile(ctx, profileId)` first; reuse the REST layer's compose helpers and serializers, never the routes over HTTP.
- Test it through the real `/mcp` with an OAuth token (`__tests__/helpers/oauth-agent.ts`), so the agent store guard applies; the guard is read from the request context and lets everything through outside one.
- **First instance:** `server/src/mcp/read-tools.ts`.

### Pattern: One idempotency state machine for every door (MUT-436)
- `runIdempotent(ops, { key, operation, fingerprints, now }, run)` in `server/src/idempotency.ts` is the claim → run → complete-or-fail machine; `run` returns `{ status, body }`. 5xx/429 release the key; any other status is stored and replays. HTTP middlewares adapt Hono to it; MCP tools call it through `withToolIdempotency` (a 4xx `ApiError` becomes a stored outcome and is rethrown on replay).
- Partition by the principal's namespace: sessions `s:<sha256>`, agents `a:<sha256(user, key)>`, API keys bare.

### Pattern: Upload rules live in a compose module, not a route (MUT-436)
- `server/src/expenses/receipts-compose.ts` owns start/complete for receipts (checks in order, the audit row via an injected writer). Routes and MCP tools call it; a new door adds no copy of the rules, and a new rule (MUT-56's scan) lands once.

### Pattern: Check before an agent writes: validate → look-alikes → write, answered as a result (MUT-437)
- An agent expense write runs `guardedWrite` (`server/src/mcp/write-tools.ts`): the person's `agentWriteLock` around `withToolIdempotency`, whose work validates with no writes, calls `assertNoLookAlikes` (`findLookAlikes`, the one rule), then writes. A look-alike throws the internal `LookAlikesFound` (not an `ApiError`, so the key is released) and becomes `{ outcome: 'matched', candidates }`. The person's answer (`notDuplicateOf`) stays out of the fingerprint. A new agent write that creates an expense goes through `guardedWrite`.

### Pattern: Two-step relational compose, so a caller can check between (MUT-437)
- `server/src/inbox/file-expense.ts`: `prepare…` runs every rule and writes nothing; `commit…` writes and audits. The route calls both back to back; the agent puts its look-alike check between them. Pure capture rules stay in `inbox/compose.ts`.

## Pattern: a person-level read that answers partially (MUT-447)

A read across a person's profiles (`GET /v1/summaries/verdict`, like `GET /v1/entries`) never fails as a whole because one profile does: it drops LOCKED profiles first (from `personEntitlements`), reads the rest with `Promise.allSettled`, and lists each left-out profile in `unavailable` with a code. A failure that isn't an `ApiError` is our bug: report it with `c.get('reportError')(err)` (set by `createApiShell`, the same reporter and tags as an unhandled error) so a partial answer is never silent in Sentry.

## Pattern: one operator action, two doors (MUT-459)

An operator action lives once in `server/src/operator/actions/<area>.ts`, taking an `ActionContext` with an `OperatorActor` (`server/src/operator/actor.ts`): `TOKEN_ACTOR` from `/admin/v1/*` (the CLI) or `{ kind: 'operator', userId }` from `/v1/operator/*` (the portal). The two route files are thin adapters, so the console's results are the CLI's by construction. `auditActorIdOf` and `byLabelOf` are the only places the doors differ: the token keeps `actorId: null` and its old labels (`admin-token`, `admin`); an operator writes its id and `operator:<id>`. Moving an existing admin handler into an action keeps that route's test file unchanged as the regression proof.

## Pattern: a mail's look is data; the frame draws it (MUT-468)
**Where**: `server/src/email/templates/look.ts` (`LOOK: Record<CustomerTemplateId, Look>`), `layout.ts` (`renderLayout(locale, body, look, frame)`).
**Rule**: a new customer mail adds one `LOOK` row (mood, header art, chip) and its copy with `headline` and `preheader`; the types fail the build without them. Pictures come only from `look.ts` file names under `<artOrigin>/mail/v1/`; new art goes in a new versioned folder, never over `v1`. Text on a mood tint is the ink only (`TEXT_PAIRS`, contrast test).

## Pattern: classify a receivable once (MUT-482)
**Where**: `server/src/summaries/compute.ts` `dayBucketOf(r, today)`.
**Rule**: anything that depends on whether a receivable is overdue, due today or not yet due (an amount, a date, a count, a status) reads `dayBucketOf`, never its own `dueDate < today` check. It already applies OPEN, `countsOn` (MUT-392) and "something outstanding".
