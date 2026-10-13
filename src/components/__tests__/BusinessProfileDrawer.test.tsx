import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { db } from '../../db/database';
import { businessProfileRepo } from '../../db/repository';
import { useDrawerStore } from '../../lib/stores';
import { BusinessProfileDrawer } from '../drawers/BusinessProfileDrawer';
import { LanguageProvider } from '../../lib/i18n';

// Create test query client
function createTestQueryClient() {
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

// Test wrapper
function TestWrapper({ children }: { children: ReactNode }) {
  const queryClient = createTestQueryClient();
  return (
    <QueryClientProvider client={queryClient}>
      <LanguageProvider>
        {children}
      </LanguageProvider>
    </QueryClientProvider>
  );
}

describe('BusinessProfileDrawer', () => {
  beforeEach(async () => {
    // Clear database
    await db.businessProfiles.clear();
    // Reset drawer state
    useDrawerStore.setState({
      businessProfileDrawer: {
        isOpen: true,
        mode: 'create',
      },
    });
  });

  afterEach(async () => {
    await db.businessProfiles.clear();
    useDrawerStore.setState({
      businessProfileDrawer: {
        isOpen: false,
        mode: 'create',
      },
    });
  });

  it('should render create mode form correctly', () => {
    render(
      <TestWrapper>
        <BusinessProfileDrawer />
      </TestWrapper>
    );

    expect(screen.getByText('New Business Profile')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('اسم الشركة')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Company Name')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('email@example.com')).toBeInTheDocument();
  });

  it('should show validation error when name is empty', async () => {
    const user = userEvent.setup();

    render(
      <TestWrapper>
        <BusinessProfileDrawer />
      </TestWrapper>
    );

    // Fill in email but leave name empty
    await user.type(screen.getByPlaceholderText('email@example.com'), 'test@example.com');

    // Submit the form
    const saveButton = screen.getByRole('button', { name: /save/i });
    await user.click(saveButton);

    // Should show validation error
    await waitFor(() => {
      expect(screen.getByText('Business name is required')).toBeInTheDocument();
    });
  });

  it('should have email input field', () => {
    render(
      <TestWrapper>
        <BusinessProfileDrawer />
      </TestWrapper>
    );

    const emailInput = screen.getByPlaceholderText('email@example.com');
    expect(emailInput).toBeInTheDocument();
    expect(emailInput).toHaveAttribute('type', 'email');
  });

  it('should create a new business profile on valid submission', async () => {
    const user = userEvent.setup();

    render(
      <TestWrapper>
        <BusinessProfileDrawer />
      </TestWrapper>
    );

    // Fill in required fields
    await user.type(screen.getByPlaceholderText('اسم الشركة'), 'شركة اختبار');
    await user.type(screen.getByPlaceholderText('Company Name'), 'Test Company');
    await user.type(screen.getByPlaceholderText('email@example.com'), 'test@example.com');

    // Submit
    const saveButton = screen.getByRole('button', { name: /save/i });
    await user.click(saveButton);

    // Wait for the profile to be created
    await waitFor(async () => {
      const profiles = await businessProfileRepo.list();
      expect(profiles).toHaveLength(1);
      expect(profiles[0].name).toBe('شركة اختبار');
      expect(profiles[0].nameEn).toBe('Test Company');
    });
  });

  it('should load existing profile in edit mode', async () => {
    // Create a profile first
    const profile = await businessProfileRepo.create({
      name: 'Existing Company',
      nameEn: 'Existing EN',
      email: 'existing@example.com',
      defaultCurrency: 'USD',
      isDefault: false,
    });

    // Set drawer to edit mode
    useDrawerStore.setState({
      businessProfileDrawer: {
        isOpen: true,
        mode: 'edit',
        profileId: profile.id,
      },
    });

    render(
      <TestWrapper>
        <BusinessProfileDrawer />
      </TestWrapper>
    );

    // Wait for the form to be populated
    await waitFor(() => {
      expect(screen.getByText('Edit Business Profile')).toBeInTheDocument();
    });

    await waitFor(() => {
      const nameInput = screen.getByPlaceholderText('اسم الشركة') as HTMLInputElement;
      expect(nameInput.value).toBe('Existing Company');
    });
  });

  it('should close drawer when cancel is clicked', async () => {
    const user = userEvent.setup();

    render(
      <TestWrapper>
        <BusinessProfileDrawer />
      </TestWrapper>
    );

    const cancelButton = screen.getByRole('button', { name: /cancel/i });
    await user.click(cancelButton);

    expect(useDrawerStore.getState().businessProfileDrawer.isOpen).toBe(false);
  });
});

/**
 * MUT-145 (IA review): the business profile is ledger-shaped. It holds who you
 * are (identity), the default currency for new income, and optional contact
 * details, and nothing that only an invoice letterhead needed.
 */
const now = new Date().toISOString();

function openCreate() {
  useDrawerStore.getState().openBusinessProfileDrawer({ mode: 'create' });
  return render(<BusinessProfileDrawer />, { wrapper: TestWrapper });
}

describe('BusinessProfileDrawer (MUT-145)', () => {
  beforeEach(async () => {
    await db.businessProfiles.clear();
  });

  afterEach(async () => {
    useDrawerStore.getState().closeBusinessProfileDrawer();
    await db.businessProfiles.clear();
  });

  it('groups the form as Identity, then Money, then optional Contact', async () => {
    openCreate();

    const headings = (await screen.findAllByRole('heading', { level: 3 })).map((h) => h.textContent);
    expect(headings).toEqual(['Identity', 'Money', 'Contact (optional)']);
    expect(screen.getByLabelText('Default currency')).toBeInTheDocument();
  });

  it('asks for nothing an invoice letterhead needed', async () => {
    openCreate();
    await screen.findByLabelText('Default currency');

    for (const gone of [/tax/i, /address/i, /city/i, /business type/i, /document/i, /postal/i]) {
      expect(screen.queryByText(gone)).toBeNull();
    }
  });

  it('creates a profile with a name only, no email required', async () => {
    const user = userEvent.setup();
    openCreate();

    await user.type(await screen.findByLabelText(/Business Name \(Arabic\)/), 'استوديو');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(async () => expect(await db.businessProfiles.count()).toBe(1));
    const [saved] = await db.businessProfiles.toArray();
    expect(saved.name).toBe('استوديو');
    expect(saved.email).toBeUndefined();
    expect(saved.defaultCurrency).toBe('USD');
    expect(useDrawerStore.getState().businessProfileDrawer.isOpen).toBe(false);
  });

  it('still rejects a malformed email when one is given', async () => {
    const user = userEvent.setup();
    openCreate();

    await user.type(await screen.findByLabelText(/Business Name \(Arabic\)/), 'Studio');
    await user.type(screen.getByLabelText('Email'), 'not-an-email');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Invalid email')).toBeInTheDocument();
    expect(await db.businessProfiles.count()).toBe(0);
  });

  it('edits an existing profile in place and keeps its stale letterhead fields untouched', async () => {
    await db.businessProfiles.add({
      id: 'p1',
      name: 'Studio',
      email: 'hi@studio.test',
      defaultCurrency: 'ILS',
      isDefault: true,
      taxId: '123',
      createdAt: now,
      updatedAt: now,
    } as never);
    const user = userEvent.setup();
    useDrawerStore.getState().openBusinessProfileDrawer({ mode: 'edit', profileId: 'p1' });
    render(<BusinessProfileDrawer />, { wrapper: TestWrapper });

    const name = await screen.findByDisplayValue('Studio');
    expect(screen.getByLabelText('Default currency')).toHaveValue('ILS');
    await user.clear(name);
    await user.type(name, 'Studio Two');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(async () => expect((await db.businessProfiles.get('p1'))?.name).toBe('Studio Two'));
    const saved = (await db.businessProfiles.get('p1')) as unknown as Record<string, unknown>;
    expect(saved.defaultCurrency).toBe('ILS');
    expect(saved.taxId).toBe('123');
  });
});
