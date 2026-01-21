import { type ReactElement, type ReactNode } from 'react';
import { render, type RenderOptions } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LanguageProvider } from '../lib/i18n';
import type { BusinessProfile, Document, Client, DocumentItem } from '../types';

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
    taxId: '123456789',
    businessType: 'company',
    address1: 'شارع الاختبار 123',
    address1En: '123 Test Street',
    city: 'القدس',
    cityEn: 'Jerusalem',
    country: 'فلسطين',
    countryEn: 'Palestine',
    postalCode: '12345',
    logoDataUrl: undefined,
    primaryColor: '#3b82f6',
    defaultCurrency: 'USD',
    defaultLanguage: 'en',
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

export function createMockDocumentItem(overrides: Partial<DocumentItem> = {}): DocumentItem {
  return {
    name: 'Test Item',
    quantity: 1,
    rateMinor: 10000, // $100.00
    rateVatMinor: 11700, // $117.00 with 17% VAT
    discountMinor: 0,
    taxExempt: false,
    ...overrides,
  };
}

export function createMockDocument(overrides: Partial<Document> = {}): Document {
  const now = new Date().toISOString();
  const items = overrides.items || [createMockDocumentItem()];

  // Calculate totals
  const subtotalMinor = items.reduce((sum, item) =>
    sum + (item.quantity * item.rateMinor - item.discountMinor), 0);
  const taxMinor = items.reduce((sum, item) => {
    if (item.taxExempt) return sum;
    const itemTotal = item.quantity * item.rateMinor - item.discountMinor;
    return sum + Math.round(itemTotal * 0.17);
  }, 0);
  const totalMinor = subtotalMinor + taxMinor;

  return {
    id: `doc-${Math.random().toString(36).substr(2, 9)}`,
    number: 'INV-0001',
    type: 'invoice',
    status: 'draft',
    businessProfileId: 'profile-1',
    clientId: 'client-1',
    subject: 'Test Invoice',
    brief: 'Test brief description',
    notes: 'Test notes',
    items,
    payments: [],
    subtotalMinor,
    discountMinor: 0,
    taxMinor,
    totalMinor,
    taxRate: 0.17,
    vatEnabled: true,
    currency: 'USD',
    language: 'en',
    issueDate: now,
    dueDate: undefined,
    paidAt: undefined,
    refDocumentId: undefined,
    linkedTransactionIds: [],
    templateId: 'template1',
    exportCount: 0,
    createdAt: now,
    updatedAt: now,
    deletedAt: undefined,
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

// Re-export everything from testing-library
export * from '@testing-library/react';
export { default as userEvent } from '@testing-library/user-event';
