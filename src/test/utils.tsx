import { type ReactElement, type ReactNode } from 'react';
import { render, type RenderOptions } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LanguageProvider } from '../lib/i18n';
import type {
  BusinessProfile,
  Client,
  Project,
  Transaction,
  Category,
  FxRate,
  Currency,
  TxKind,
  TxStatus,
} from '../types';

// Create a test query client
export function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
      mutations: {
        retry: false,
      },
    },
  });
}

// Wrapper with providers
interface WrapperProps {
  children: ReactNode;
}

export function createWrapper() {
  const queryClient = createTestQueryClient();

  return function Wrapper({ children }: WrapperProps) {
    return (
      <QueryClientProvider client={queryClient}>
        <LanguageProvider>
          {children}
        </LanguageProvider>
      </QueryClientProvider>
    );
  };
}

// Custom render function with providers
export function renderWithProviders(
  ui: ReactElement,
  options?: Omit<RenderOptions, 'wrapper'>
) {
  return render(ui, { wrapper: createWrapper(), ...options });
}

// Factory functions for test data

export function createMockBusinessProfile(overrides: Partial<BusinessProfile> = {}): BusinessProfile {
  const now = new Date().toISOString();
  return {
    id: `profile-${Math.random().toString(36).substr(2, 9)}`,
    name: 'شركة اختبار',
    nameEn: 'Test Company',
    email: 'test@example.com',
    phone: '+972501234567',
    logoDataUrl: undefined,
    primaryColor: '#3b82f6',
    defaultCurrency: 'USD',
    isDefault: false,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

export function createMockClient(overrides: Partial<Client> = {}): Client {
  const now = new Date().toISOString();
  return {
    id: `client-${Math.random().toString(36).substr(2, 9)}`,
    name: 'Test Client',
    email: 'client@example.com',
    phone: '+972501234567',
    notes: '',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

// Helper to wait for async operations
export function waitForNextTick() {
  return new Promise(resolve => setTimeout(resolve, 0));
}

// Helper to generate unique IDs for tests
export function generateId(): string {
  return Math.random().toString(36).substr(2, 9);
}

// Factory function for test transactions
export function createMockTransaction(overrides: Partial<Transaction> = {}): Transaction {
  const now = new Date().toISOString();
  const today = now.split('T')[0];
  return {
    id: `tx-${generateId()}`,
    kind: 'income' as TxKind,
    status: 'paid' as TxStatus,
    title: 'Test Transaction',
    amountMinor: 10000, // $100.00
    currency: 'USD' as Currency,
    occurredAt: today,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

// Factory function for test projects
export function createMockProject(overrides: Partial<Project> = {}): Project {
  const now = new Date().toISOString();
  return {
    id: `proj-${generateId()}`,
    name: 'Test Project',
    field: 'Engineering',
    notes: 'Test project notes',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

// Factory function for test categories
export function createMockCategory(overrides: Partial<Category> = {}): Category {
  return {
    id: `cat-${generateId()}`,
    kind: 'expense' as TxKind,
    name: 'Test Category',
    ...overrides,
  };
}

// Factory function for test FX rates
export function createMockFxRate(overrides: Partial<FxRate> = {}): FxRate {
  const now = new Date().toISOString();
  const today = now.split('T')[0];
  return {
    id: `fx-${generateId()}`,
    baseCurrency: 'USD' as Currency,
    quoteCurrency: 'ILS' as Currency,
    rate: 3.65,
    effectiveDate: today,
    source: 'manual',
    createdAt: now,
    ...overrides,
  };
}

// Helper to create multiple transactions
export function createMockTransactions(count: number, overrides: Partial<Transaction> = {}): Transaction[] {
  return Array.from({ length: count }, (_, i) =>
    createMockTransaction({
      title: `Transaction ${i + 1}`,
      amountMinor: (i + 1) * 1000,
      ...overrides,
    })
  );
}

// Helper to create income transaction (receivable when unpaid)
export function createMockIncome(overrides: Partial<Transaction> = {}): Transaction {
  return createMockTransaction({
    kind: 'income',
    status: 'paid',
    ...overrides,
  });
}

// Helper to create expense transaction
export function createMockExpense(overrides: Partial<Transaction> = {}): Transaction {
  return createMockTransaction({
    kind: 'expense',
    status: 'paid',
    ...overrides,
  });
}

// Helper to create receivable (unpaid income)
export function createMockReceivable(overrides: Partial<Transaction> = {}): Transaction {
  const now = new Date();
  const dueDate = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // 30 days from now
  return createMockTransaction({
    kind: 'income',
    status: 'unpaid',
    dueDate: dueDate.toISOString().split('T')[0],
    ...overrides,
  });
}

// Helper to create overdue receivable
export function createMockOverdueReceivable(overrides: Partial<Transaction> = {}): Transaction {
  const now = new Date();
  const pastDueDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000); // 7 days ago
  return createMockTransaction({
    kind: 'income',
    status: 'unpaid',
    dueDate: pastDueDate.toISOString().split('T')[0],
    ...overrides,
  });
}

// Helper to get ISO date string for relative dates
export function getRelativeDate(daysFromToday: number): string {
  const date = new Date();
  date.setDate(date.getDate() + daysFromToday);
  return date.toISOString().split('T')[0];
}

// Helper to get ISO timestamp for relative dates
export function getRelativeTimestamp(daysFromToday: number): string {
  const date = new Date();
  date.setDate(date.getDate() + daysFromToday);
  return date.toISOString();
}

// Re-export everything from testing-library
// eslint-disable-next-line react-refresh/only-export-components
export * from '@testing-library/react';
export { default as userEvent } from '@testing-library/user-event';
