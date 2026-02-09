# TEST_PLAN.md — Testing Strategy & Coverage

> **Purpose**: Document testing approach, coverage targets, and test organization.
> **Current Coverage**: ~3% (needs significant improvement)

---

## Testing Pyramid

```
                    ┌─────────┐
                   /   E2E    \           10%
                  /  (Planned) \          Critical flows
                 /───────────────\
                /   Integration   \       20%
               /   (In Progress)   \      Component + hook tests
              /─────────────────────\
             /        Unit           \    70%
            /     (Repository +       \   Repository, utilities,
           /       Utilities)          \  pure functions
          /─────────────────────────────\
```

---

## Current Test Coverage

### Existing Test Files

| File | Type | Coverage |
|------|------|----------|
| `src/db/__tests__/repository.test.ts` | Unit | Partial |
| `src/hooks/__tests__/useFilters.test.ts` | Integration | Partial |
| `src/components/__tests__/Button.test.tsx` | Component | Partial |

### Coverage by Module

| Module | Current | Target |
|--------|---------|--------|
| `src/db/` | ~15% | 90% |
| `src/hooks/` | ~5% | 80% |
| `src/components/` | ~2% | 70% |
| `src/lib/` | ~10% | 90% |
| `src/sync/` | ~0% | 80% |
| **Overall** | **~3%** | **80%** |

---

## Test Categories

### 1. Unit Tests

**Scope**: Pure functions, utilities, repository methods.

**Files**:
```
src/
├── db/__tests__/
│   ├── repository.test.ts       # CRUD operations
│   ├── clientRepo.test.ts       # Client-specific
│   ├── transactionRepo.test.ts  # Transaction-specific
│   └── aggregations.test.ts     # Aggregation functions
├── lib/__tests__/
│   ├── utils.test.ts            # Format, parse utilities
│   ├── matchingAlgorithm.test.ts # Retainer matching
│   └── monthDetection.test.ts   # Date utilities
└── sync/core/__tests__/
    ├── hlc.test.ts              # Hybrid Logical Clock
    ├── ops-engine.test.ts       # Operation processing
    └── conflict-resolver.test.ts # Conflict detection
```

**Example**:
```typescript
// src/lib/__tests__/utils.test.ts
import { formatAmount, parseAmountToMinor, todayISO } from '../utils';

describe('formatAmount', () => {
  it('formats USD correctly', () => {
    expect(formatAmount(1999, 'USD')).toBe('$19.99');
  });

  it('formats ILS correctly', () => {
    expect(formatAmount(1999, 'ILS')).toBe('₪19.99');
  });

  it('handles zero', () => {
    expect(formatAmount(0, 'USD')).toBe('$0.00');
  });

  it('handles negative amounts', () => {
    expect(formatAmount(-1999, 'USD')).toBe('-$19.99');
  });
});

describe('parseAmountToMinor', () => {
  it('converts decimal to cents', () => {
    expect(parseAmountToMinor('19.99')).toBe(1999);
  });

  it('handles integers', () => {
    expect(parseAmountToMinor('20')).toBe(2000);
  });

  it('returns 0 for invalid input', () => {
    expect(parseAmountToMinor('abc')).toBe(0);
  });
});
```

---

### 2. Integration Tests

**Scope**: Hooks with repository, component interactions.

**Files**:
```
src/
├── hooks/__tests__/
│   ├── useQueries.test.tsx      # Query hooks
│   ├── useTransactions.test.tsx # Transaction hooks
│   └── useFilters.test.tsx      # Filter state
└── components/__tests__/
    ├── drawers/
    │   ├── TransactionDrawer.test.tsx
    │   └── ClientDrawer.test.tsx
    └── filters/
        ├── DateRangeControl.test.tsx
        └── SearchInput.test.tsx
```

**Test Setup**:
```typescript
// src/test/setup.ts
import 'fake-indexeddb/auto';
import '@testing-library/jest-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LanguageProvider } from '@/lib/i18n/context';

export function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <LanguageProvider>
          {children}
        </LanguageProvider>
      </QueryClientProvider>
    );
  };
}
```

**Example**:
```typescript
// src/hooks/__tests__/useTransactions.test.tsx
import { renderHook, waitFor } from '@testing-library/react';
import { useTransactions, useCreateTransaction } from '../useQueries';
import { createWrapper } from '@/test/setup';
import { db } from '@/db/database';

beforeEach(async () => {
  await db.delete();
  await db.open();
});

describe('useTransactions', () => {
  it('returns empty array initially', async () => {
    const { result } = renderHook(() => useTransactions({}), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toEqual([]);
  });

  it('returns transactions after creation', async () => {
    const wrapper = createWrapper();

    // Create a transaction
    const { result: createResult } = renderHook(
      () => useCreateTransaction(),
      { wrapper }
    );

    await act(async () => {
      await createResult.current.mutateAsync({
        kind: 'income',
        amountMinor: 1999,
        currency: 'USD',
        status: 'paid',
        occurredAt: '2024-01-15',
      });
    });

    // Query transactions
    const { result: queryResult } = renderHook(
      () => useTransactions({}),
      { wrapper }
    );

    await waitFor(() => {
      expect(queryResult.current.data?.length).toBe(1);
    });
  });
});
```

---

### 3. Component Tests

**Scope**: UI components in isolation with mocked data.

**Files**:
```
src/components/__tests__/
├── ui/
│   ├── Button.test.tsx
│   ├── Input.test.tsx
│   ├── Badge.test.tsx
│   └── Modal.test.tsx
├── tables/
│   ├── DataTable.test.tsx
│   ├── CellAmount.test.tsx
│   └── CellStatus.test.tsx
└── layout/
    ├── SidebarNav.test.tsx
    └── TopBar.test.tsx
```

**Example**:
```typescript
// src/components/__tests__/ui/Button.test.tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { Button } from '../../ui/Button';

describe('Button', () => {
  it('renders children', () => {
    render(<Button>Click me</Button>);
    expect(screen.getByText('Click me')).toBeInTheDocument();
  });

  it('calls onClick when clicked', () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Click</Button>);
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('disables when disabled prop is true', () => {
    render(<Button disabled>Submit</Button>);
    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('shows loading spinner when isLoading', () => {
    render(<Button isLoading>Submit</Button>);
    expect(screen.getByRole('button')).toBeDisabled();
    expect(screen.getByTestId('spinner')).toBeInTheDocument();
  });

  it('applies variant classes', () => {
    render(<Button variant="danger">Delete</Button>);
    expect(screen.getByRole('button')).toHaveClass('btn-danger');
  });
});
```

---

### 4. E2E Tests (Planned)

**Scope**: Full user flows from UI to database.

**Tool**: Playwright (recommended for cross-browser)

**Files**:
```
e2e/
├── flows/
│   ├── transaction.spec.ts      # CRUD transactions
│   ├── invoice.spec.ts          # Generate invoice
│   ├── demo-mode.spec.ts        # Demo mode toggle
│   └── export-import.spec.ts    # Data backup
├── pages/
│   ├── overview.spec.ts
│   ├── transactions.spec.ts
│   └── documents.spec.ts
└── playwright.config.ts
```

**Example**:
```typescript
// e2e/flows/transaction.spec.ts
import { test, expect } from '@playwright/test';

test.describe('Transaction Management', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/app/');
  });

  test('creates a new income transaction', async ({ page }) => {
    // Open create drawer
    await page.click('text=+ Add');
    await page.click('text=Income');

    // Fill form
    await page.fill('[name="amountMinor"]', '100');
    await page.selectOption('[name="currency"]', 'USD');
    await page.fill('[name="occurredAt"]', '2024-01-15');

    // Submit
    await page.click('text=Save');

    // Verify toast
    await expect(page.locator('.toast-success')).toBeVisible();

    // Verify in list
    await page.goto('/app/transactions');
    await expect(page.locator('text=$100.00')).toBeVisible();
  });

  test('marks transaction as paid', async ({ page }) => {
    // Navigate to transactions
    await page.goto('/app/transactions');

    // Click row menu
    await page.click('[data-testid="row-actions"]');
    await page.click('text=Mark as Paid');

    // Verify status change
    await expect(page.locator('.status-badge-paid')).toBeVisible();
  });
});
```

---

## Critical Test Scenarios

### Must-Have Coverage

| Scenario | Type | Priority |
|----------|------|----------|
| Create transaction | Integration | P0 |
| Mark transaction paid | Integration | P0 |
| Create client | Integration | P0 |
| Create project | Integration | P0 |
| Generate invoice PDF | E2E | P0 |
| Lock document on export | Integration | P0 |
| Demo mode toggle | E2E | P1 |
| Data export | E2E | P1 |
| Data import | E2E | P1 |
| Filter transactions | Integration | P1 |
| Multi-currency totals | Unit | P1 |
| Overdue calculation | Unit | P1 |

### Edge Cases

| Case | Test Type |
|------|-----------|
| Empty state (no data) | Component |
| Large dataset (1000+ rows) | Performance |
| Concurrent edits (sync) | Integration |
| Invalid form input | Component |
| Network offline | E2E |
| Browser back/forward | E2E |
| RTL layout (Arabic) | Visual |

---

## Running Tests

### Commands

```bash
# Watch mode (development)
npm run test

# Single run
npm run test:run

# With coverage
npm run test:coverage

# Specific file
npm run test -- src/db/__tests__/repository.test.ts

# Pattern match
npm run test -- -t "creates a transaction"

# E2E (when implemented)
npm run test:e2e
```

### CI Configuration

```yaml
# .github/workflows/ci.yml
test:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-node@v4
    - run: npm ci
    - run: npm run test:coverage
    - uses: codecov/codecov-action@v3
```

---

## Coverage Goals by Phase

### Phase 1 (Immediate)
- [ ] Repository tests: 90% coverage
- [ ] Utility tests: 90% coverage
- Target: 50% overall

### Phase 2 (Short-term)
- [ ] Hook tests: 80% coverage
- [ ] Core component tests
- Target: 70% overall

### Phase 3 (Medium-term)
- [ ] E2E setup with Playwright
- [ ] Critical flow tests
- Target: 80% overall

### Phase 4 (Ongoing)
- [ ] Visual regression tests
- [ ] Performance benchmarks
- Target: Maintain 80%+

---

## Test Data Fixtures

### Location
```
src/test/
├── fixtures/
│   ├── clients.ts       # Sample clients
│   ├── projects.ts      # Sample projects
│   ├── transactions.ts  # Sample transactions
│   └── documents.ts     # Sample documents
└── factories/
    ├── clientFactory.ts
    ├── transactionFactory.ts
    └── documentFactory.ts
```

### Example Factory
```typescript
// src/test/factories/transactionFactory.ts
import type { Transaction } from '@/types';

let idCounter = 0;

export function createTransaction(
  overrides: Partial<Transaction> = {}
): Transaction {
  const now = new Date().toISOString();
  return {
    id: `test-tx-${++idCounter}`,
    kind: 'income',
    status: 'paid',
    amountMinor: 10000,
    currency: 'USD',
    occurredAt: now.split('T')[0],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

export function createTransactions(count: number): Transaction[] {
  return Array.from({ length: count }, () => createTransaction());
}
```

---

## Best Practices

### Do
- Use `fake-indexeddb` for database tests
- Mock external dependencies (PDF generation)
- Test error states and edge cases
- Use factories for test data
- Keep tests focused and fast

### Don't
- Don't test implementation details
- Don't mock React Query internals
- Don't write flaky async tests
- Don't depend on test order
- Don't test third-party libraries
