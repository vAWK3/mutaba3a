import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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

    // Fill in email (required) but leave name empty
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
      businessType: 'company',
      defaultCurrency: 'USD',
      defaultLanguage: 'en',
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

  it('should have all required form fields', () => {
    render(
      <TestWrapper>
        <BusinessProfileDrawer />
      </TestWrapper>
    );

    // Check for all key fields by label text (using getByText for labels)
    expect(screen.getByText(/business name \(arabic\)/i)).toBeInTheDocument();
    expect(screen.getByText(/business name \(english\)/i)).toBeInTheDocument();
    expect(screen.getByText('Email *')).toBeInTheDocument();
    expect(screen.getByText('Phone')).toBeInTheDocument();
    expect(screen.getByText('Business Type')).toBeInTheDocument();
    expect(screen.getByText('Tax ID')).toBeInTheDocument();
    expect(screen.getByText('Default Currency')).toBeInTheDocument();
    expect(screen.getByText('Default Language')).toBeInTheDocument();
  });

  it('should render business type options', () => {
    render(
      <TestWrapper>
        <BusinessProfileDrawer />
      </TestWrapper>
    );

    // Check that Business Type label exists
    expect(screen.getByText('Business Type')).toBeInTheDocument();

    // Check options exist in the select
    expect(screen.getByText('Individual / Freelancer')).toBeInTheDocument();
    expect(screen.getByText('Exempt Dealer')).toBeInTheDocument();
    expect(screen.getByText('Company / Corporation')).toBeInTheDocument();
  });
});
