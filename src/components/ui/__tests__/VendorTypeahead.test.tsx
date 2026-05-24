import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { db } from '../../../db/database';
import { vendorRepo } from '../../../db/expenseRepository';
import { businessProfileRepo } from '../../../db/repository';
import { LanguageProvider } from '../../../lib/i18n';
import { VendorTypeahead } from '../VendorTypeahead';

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

function TestWrapper({ children }: { children: ReactNode }) {
  const queryClient = createTestQueryClient();
  return (
    <QueryClientProvider client={queryClient}>
      <LanguageProvider>{children}</LanguageProvider>
    </QueryClientProvider>
  );
}

function renderVendorTypeahead(props: Partial<React.ComponentProps<typeof VendorTypeahead>> = {}) {
  const defaultProps = {
    profileId: 'test-profile',
    value: '',
    onChange: vi.fn(),
  };
  return {
    ...render(
      <TestWrapper>
        <VendorTypeahead {...defaultProps} {...props} />
      </TestWrapper>
    ),
    onChange: props.onChange || defaultProps.onChange,
  };
}

describe('VendorTypeahead (regression)', () => {
  let testProfileId: string;

  beforeEach(async () => {
    await db.vendors?.clear();
    await db.businessProfiles.clear();

    const profile = await businessProfileRepo.create({
      name: 'Test Profile',
      defaultCurrency: 'USD',
    });
    testProfileId = profile.id;
  });

  afterEach(async () => {
    await db.vendors?.clear();
    await db.businessProfiles.clear();
  });

  describe('rendering', () => {
    it('renders a combobox input', () => {
      renderVendorTypeahead({ profileId: testProfileId });
      expect(screen.getByRole('combobox')).toBeInTheDocument();
    });

    it('renders with ARIA attributes', () => {
      renderVendorTypeahead({ profileId: testProfileId });
      const input = screen.getByRole('combobox');
      expect(input).toHaveAttribute('aria-haspopup', 'listbox');
      expect(input).toHaveAttribute('aria-autocomplete', 'list');
    });
  });

  describe('showing vendors', () => {
    it('shows all vendors on focus', async () => {
      await vendorRepo.create({
        profileId: testProfileId,
        canonicalName: 'Acme Corp',
        aliases: [],
      });
      await vendorRepo.create({
        profileId: testProfileId,
        canonicalName: 'Beta LLC',
        aliases: [],
      });

      renderVendorTypeahead({ profileId: testProfileId });

      await waitFor(() => {
        fireEvent.focus(screen.getByRole('combobox'));
        expect(screen.getByText('Acme Corp')).toBeInTheDocument();
        expect(screen.getByText('Beta LLC')).toBeInTheDocument();
      });
    });
  });

  describe('selecting a vendor', () => {
    it('calls onChange with name and vendorId when selecting existing vendor', async () => {
      const vendor = await vendorRepo.create({
        profileId: testProfileId,
        canonicalName: 'Acme Corp',
        aliases: [],
      });
      const onChange = vi.fn();

      renderVendorTypeahead({ profileId: testProfileId, onChange });

      await waitFor(() => {
        fireEvent.focus(screen.getByRole('combobox'));
        expect(screen.getByText('Acme Corp')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('Acme Corp'));
      expect(onChange).toHaveBeenCalledWith('Acme Corp', vendor.id);
    });
  });

  describe('creating a vendor', () => {
    it('shows create new option when typing non-matching text', async () => {
      await vendorRepo.create({
        profileId: testProfileId,
        canonicalName: 'Existing Vendor',
        aliases: [],
      });

      renderVendorTypeahead({ profileId: testProfileId });

      await waitFor(() => {
        fireEvent.focus(screen.getByRole('combobox'));
      });

      fireEvent.change(screen.getByRole('combobox'), { target: { value: 'New Vendor' } });

      await waitFor(() => {
        const options = screen.getAllByRole('option');
        expect(options.some((o) => o.classList.contains('is-new'))).toBe(true);
      });
    });

    it('creates vendor and emits name + id on create new selection', async () => {
      const onChange = vi.fn();
      renderVendorTypeahead({ profileId: testProfileId, onChange });

      fireEvent.focus(screen.getByRole('combobox'));
      fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Brand New Vendor' } });

      await waitFor(() => {
        const options = screen.getAllByRole('option');
        expect(options.some((o) => o.classList.contains('is-new'))).toBe(true);
      });

      const options = screen.getAllByRole('option');
      const newOption = options.find((o) => o.classList.contains('is-new'))!;
      fireEvent.click(newOption);

      await waitFor(() => {
        expect(onChange).toHaveBeenCalled();
        const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1];
        // Should be called with (name, vendorId)
        expect(lastCall[0]).toBeTruthy(); // name
        expect(lastCall[1]).toBeTruthy(); // vendorId
      });
    });
  });

  describe('keyboard navigation', () => {
    it('supports ArrowDown/ArrowUp/Enter/Escape after refactor', async () => {
      await vendorRepo.create({
        profileId: testProfileId,
        canonicalName: 'Vendor A',
        aliases: [],
      });
      await vendorRepo.create({
        profileId: testProfileId,
        canonicalName: 'Vendor B',
        aliases: [],
      });
      const onChange = vi.fn();

      renderVendorTypeahead({ profileId: testProfileId, onChange });

      await waitFor(() => {
        fireEvent.focus(screen.getByRole('combobox'));
        expect(screen.getByText('Vendor A')).toBeInTheDocument();
      });

      const input = screen.getByRole('combobox');

      // ArrowDown highlights first option
      fireEvent.keyDown(input, { key: 'ArrowDown' });
      let options = screen.getAllByRole('option');
      expect(options[0]).toHaveAttribute('aria-selected', 'true');

      // ArrowDown again highlights second option
      fireEvent.keyDown(input, { key: 'ArrowDown' });
      options = screen.getAllByRole('option');
      expect(options[1]).toHaveAttribute('aria-selected', 'true');

      // ArrowUp goes back to first
      fireEvent.keyDown(input, { key: 'ArrowUp' });
      options = screen.getAllByRole('option');
      expect(options[0]).toHaveAttribute('aria-selected', 'true');

      // Enter selects
      fireEvent.keyDown(input, { key: 'Enter' });
      expect(onChange).toHaveBeenCalledWith('Vendor A', expect.any(String));

      // Re-open and test Escape
      fireEvent.focus(input);
      await waitFor(() => {
        expect(screen.getByRole('listbox')).toBeInTheDocument();
      });
      fireEvent.keyDown(input, { key: 'Escape' });
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });
  });

  describe('input sync', () => {
    it('updates input when value prop changes', () => {
      const { rerender } = render(
        <TestWrapper>
          <VendorTypeahead profileId={testProfileId} value="Initial" onChange={vi.fn()} />
        </TestWrapper>
      );

      expect(screen.getByRole('combobox')).toHaveValue('Initial');

      rerender(
        <TestWrapper>
          <VendorTypeahead profileId={testProfileId} value="Updated" onChange={vi.fn()} />
        </TestWrapper>
      );

      expect(screen.getByRole('combobox')).toHaveValue('Updated');
    });
  });
});
