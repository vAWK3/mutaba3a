import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { db } from '../../../db/database';
import { clientRepo, businessProfileRepo } from '../../../db/repository';
import { LanguageProvider } from '../../../lib/i18n';
import { ClientTypeahead } from '../ClientTypeahead';

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

function renderClientTypeahead(props: Partial<React.ComponentProps<typeof ClientTypeahead>> = {}) {
  const defaultProps = {
    value: '',
    onChange: vi.fn(),
  };
  return {
    ...render(
      <TestWrapper>
        <ClientTypeahead {...defaultProps} {...props} />
      </TestWrapper>
    ),
    onChange: props.onChange || defaultProps.onChange,
  };
}

describe('ClientTypeahead', () => {
  let testProfileId: string;

  beforeEach(async () => {
    await db.clients.clear();
    await db.businessProfiles.clear();

    const profile = await businessProfileRepo.create({
      name: 'Test Profile',
      defaultCurrency: 'USD',
    });
    testProfileId = profile.id;
  });

  afterEach(async () => {
    await db.clients.clear();
    await db.businessProfiles.clear();
  });

  describe('rendering', () => {
    it('renders a combobox input', () => {
      renderClientTypeahead();
      expect(screen.getByRole('combobox')).toBeInTheDocument();
    });

    it('renders with placeholder', () => {
      renderClientTypeahead({ placeholder: 'Pick client...' });
      expect(screen.getByPlaceholderText('Pick client...')).toBeInTheDocument();
    });
  });

  describe('showing clients', () => {
    it('shows all clients when focused (no profile filter)', async () => {
      await clientRepo.create({ name: 'Client A', profileId: testProfileId });
      await clientRepo.create({ name: 'Client B', profileId: 'other-profile' });

      renderClientTypeahead();

      await waitFor(() => {
        fireEvent.focus(screen.getByRole('combobox'));
        expect(screen.getByText('Client A')).toBeInTheDocument();
        expect(screen.getByText('Client B')).toBeInTheDocument();
      });
    });

    it('does not show archived clients', async () => {
      await clientRepo.create({ name: 'Active Client' });
      const archived = await clientRepo.create({ name: 'Archived Client' });
      await clientRepo.archive(archived.id);

      renderClientTypeahead();

      await waitFor(() => {
        fireEvent.focus(screen.getByRole('combobox'));
        expect(screen.getByText('Active Client')).toBeInTheDocument();
      });
      expect(screen.queryByText('Archived Client')).not.toBeInTheDocument();
    });
  });

  describe('filtering', () => {
    it('filters by substring match', async () => {
      await clientRepo.create({ name: 'Acme Corporation' });
      await clientRepo.create({ name: 'Beta Labs' });

      renderClientTypeahead();

      await waitFor(() => {
        fireEvent.focus(screen.getByRole('combobox'));
        expect(screen.getByText('Acme Corporation')).toBeInTheDocument();
      });

      fireEvent.change(screen.getByRole('combobox'), { target: { value: 'beta' } });

      await waitFor(() => {
        expect(screen.getByText('Beta Labs')).toBeInTheDocument();
        expect(screen.queryByText('Acme Corporation')).not.toBeInTheDocument();
      });
    });
  });

  describe('selecting a client', () => {
    it('calls onChange with clientId when selecting existing client', async () => {
      const client = await clientRepo.create({ name: 'My Client' });
      const onChange = vi.fn();

      renderClientTypeahead({ onChange });

      await waitFor(() => {
        fireEvent.focus(screen.getByRole('combobox'));
        expect(screen.getByText('My Client')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('My Client'));
      expect(onChange).toHaveBeenCalledWith(client.id);
    });

    it('displays client name in input when value is set (prefill)', async () => {
      const client = await clientRepo.create({ name: 'Prefilled Client' });

      renderClientTypeahead({ value: client.id });

      await waitFor(() => {
        expect(screen.getByRole('combobox')).toHaveValue('Prefilled Client');
      });
    });
  });

  describe('creating a client', () => {
    it('shows create new option when no exact match', async () => {
      await clientRepo.create({ name: 'Existing Client' });

      renderClientTypeahead();

      await waitFor(() => {
        fireEvent.focus(screen.getByRole('combobox'));
        expect(screen.getByText('Existing Client')).toBeInTheDocument();
      });

      fireEvent.change(screen.getByRole('combobox'), { target: { value: 'New Client' } });

      await waitFor(() => {
        expect(screen.getByText('New Client')).toBeInTheDocument();
      });
    });

    it('does not show create new option when exact match exists', async () => {
      await clientRepo.create({ name: 'Exact Match' });

      renderClientTypeahead();

      await waitFor(() => {
        fireEvent.focus(screen.getByRole('combobox'));
      });

      fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Exact Match' } });

      await waitFor(() => {
        const options = screen.getAllByRole('option');
        expect(options).toHaveLength(1);
        expect(options[0]).not.toHaveClass('is-new');
      });
    });

    it('creates client inline with name and profileId', async () => {
      const onChange = vi.fn();
      renderClientTypeahead({ profileId: testProfileId, onChange });

      fireEvent.focus(screen.getByRole('combobox'));
      fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Brand New Client' } });

      await waitFor(() => {
        const options = screen.getAllByRole('option');
        expect(options.some((o) => o.classList.contains('is-new'))).toBe(true);
      });

      const options = screen.getAllByRole('option');
      const newOption = options.find((o) => o.classList.contains('is-new'))!;
      fireEvent.click(newOption);

      await waitFor(() => {
        expect(onChange).toHaveBeenCalled();
        const calledWith = onChange.mock.calls[onChange.mock.calls.length - 1][0];
        expect(calledWith).toBeTruthy();
        expect(calledWith).not.toBe('');
      });

      // Verify client was created in DB with the right profileId
      const clients = await db.clients.toArray();
      const created = clients.find((c) => c.name === 'Brand New Client');
      expect(created).toBeDefined();
      expect(created!.profileId).toBe(testProfileId);
    });
  });

  describe('clearing selection', () => {
    it('calls onChange with empty string when input is cleared', async () => {
      const client = await clientRepo.create({ name: 'My Client' });
      const onChange = vi.fn();

      renderClientTypeahead({ value: client.id, onChange });

      await waitFor(() => {
        expect(screen.getByRole('combobox')).toHaveValue('My Client');
      });

      fireEvent.change(screen.getByRole('combobox'), { target: { value: '' } });
      expect(onChange).toHaveBeenCalledWith('');
    });
  });
});
