import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { db } from '../../../db/database';
import { projectRepo, businessProfileRepo } from '../../../db/repository';
import { LanguageProvider } from '../../../lib/i18n';
import { ProjectTypeahead } from '../ProjectTypeahead';

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

function renderProjectTypeahead(props: Partial<React.ComponentProps<typeof ProjectTypeahead>> = {}) {
  const defaultProps = {
    profileId: 'test-profile',
    value: '',
    onChange: vi.fn(),
  };
  return {
    ...render(
      <TestWrapper>
        <ProjectTypeahead {...defaultProps} {...props} />
      </TestWrapper>
    ),
    onChange: props.onChange || defaultProps.onChange,
  };
}

describe('ProjectTypeahead', () => {
  let testProfileId: string;

  beforeEach(async () => {
    await db.projects.clear();
    await db.businessProfiles.clear();

    const profile = await businessProfileRepo.create({
      name: 'Test Profile',
      defaultCurrency: 'USD',
    });
    testProfileId = profile.id;
  });

  afterEach(async () => {
    await db.projects.clear();
    await db.businessProfiles.clear();
  });

  describe('rendering', () => {
    it('renders a combobox input', () => {
      renderProjectTypeahead({ profileId: testProfileId });
      expect(screen.getByRole('combobox')).toBeInTheDocument();
    });

    it('renders with placeholder', () => {
      renderProjectTypeahead({ profileId: testProfileId, placeholder: 'Pick project...' });
      expect(screen.getByPlaceholderText('Pick project...')).toBeInTheDocument();
    });
  });

  describe('showing projects', () => {
    it('shows all projects for profile when focused', async () => {
      await projectRepo.create({ name: 'Website Redesign', profileId: testProfileId });
      await projectRepo.create({ name: 'Mobile App', profileId: testProfileId });

      renderProjectTypeahead({ profileId: testProfileId });

      await waitFor(() => {
        fireEvent.focus(screen.getByRole('combobox'));
        expect(screen.getByText('Website Redesign')).toBeInTheDocument();
        expect(screen.getByText('Mobile App')).toBeInTheDocument();
      });
    });

    it('does not show projects from other profiles', async () => {
      await projectRepo.create({ name: 'My Project', profileId: testProfileId });
      await projectRepo.create({ name: 'Other Project', profileId: 'other-profile' });

      renderProjectTypeahead({ profileId: testProfileId });

      await waitFor(() => {
        fireEvent.focus(screen.getByRole('combobox'));
        expect(screen.getByText('My Project')).toBeInTheDocument();
      });
      expect(screen.queryByText('Other Project')).not.toBeInTheDocument();
    });

    it('does not show archived projects', async () => {
      await projectRepo.create({ name: 'Active', profileId: testProfileId });
      const archived = await projectRepo.create({ name: 'Archived', profileId: testProfileId });
      await projectRepo.archive(archived.id);

      renderProjectTypeahead({ profileId: testProfileId });

      await waitFor(() => {
        fireEvent.focus(screen.getByRole('combobox'));
        expect(screen.getByText('Active')).toBeInTheDocument();
      });
      expect(screen.queryByText('Archived')).not.toBeInTheDocument();
    });
  });

  describe('client filtering', () => {
    it('shows client-specific projects when clientId provided', async () => {
      await projectRepo.create({ name: 'Client A Project', profileId: testProfileId, clientId: 'client-a' });
      await projectRepo.create({ name: 'Client B Project', profileId: testProfileId, clientId: 'client-b' });

      renderProjectTypeahead({ profileId: testProfileId, clientId: 'client-a' });

      await waitFor(() => {
        fireEvent.focus(screen.getByRole('combobox'));
        expect(screen.getByText('Client A Project')).toBeInTheDocument();
      });
      expect(screen.queryByText('Client B Project')).not.toBeInTheDocument();
    });

    it('includes clientless projects when client is selected', async () => {
      await projectRepo.create({ name: 'Client A Project', profileId: testProfileId, clientId: 'client-a' });
      await projectRepo.create({ name: 'General Project', profileId: testProfileId });

      renderProjectTypeahead({ profileId: testProfileId, clientId: 'client-a' });

      await waitFor(() => {
        fireEvent.focus(screen.getByRole('combobox'));
        expect(screen.getByText('Client A Project')).toBeInTheDocument();
        expect(screen.getByText('General Project')).toBeInTheDocument();
      });
    });

    it('shows all projects when no client selected', async () => {
      await projectRepo.create({ name: 'Client A Project', profileId: testProfileId, clientId: 'client-a' });
      await projectRepo.create({ name: 'Client B Project', profileId: testProfileId, clientId: 'client-b' });
      await projectRepo.create({ name: 'General Project', profileId: testProfileId });

      renderProjectTypeahead({ profileId: testProfileId });

      await waitFor(() => {
        fireEvent.focus(screen.getByRole('combobox'));
        expect(screen.getByText('Client A Project')).toBeInTheDocument();
        expect(screen.getByText('Client B Project')).toBeInTheDocument();
        expect(screen.getByText('General Project')).toBeInTheDocument();
      });
    });
  });

  describe('substring filtering', () => {
    it('filters by substring match', async () => {
      await projectRepo.create({ name: 'Website Redesign', profileId: testProfileId });
      await projectRepo.create({ name: 'Mobile App', profileId: testProfileId });

      renderProjectTypeahead({ profileId: testProfileId });

      await waitFor(() => {
        fireEvent.focus(screen.getByRole('combobox'));
        expect(screen.getByText('Website Redesign')).toBeInTheDocument();
      });

      fireEvent.change(screen.getByRole('combobox'), { target: { value: 'mobile' } });

      await waitFor(() => {
        expect(screen.getByText('Mobile App')).toBeInTheDocument();
        expect(screen.queryByText('Website Redesign')).not.toBeInTheDocument();
      });
    });
  });

  describe('selecting a project', () => {
    it('calls onChange with projectId when selecting existing project', async () => {
      const project = await projectRepo.create({ name: 'My Project', profileId: testProfileId });
      const onChange = vi.fn();

      renderProjectTypeahead({ profileId: testProfileId, onChange });

      await waitFor(() => {
        fireEvent.focus(screen.getByRole('combobox'));
        expect(screen.getByText('My Project')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('My Project'));
      expect(onChange).toHaveBeenCalledWith(project.id);
    });

    it('displays project name in input when value is set', async () => {
      const project = await projectRepo.create({ name: 'My Project', profileId: testProfileId });

      renderProjectTypeahead({ profileId: testProfileId, value: project.id });

      await waitFor(() => {
        expect(screen.getByRole('combobox')).toHaveValue('My Project');
      });
    });
  });

  describe('creating a project', () => {
    it('shows create new option when no exact match', async () => {
      await projectRepo.create({ name: 'Existing Project', profileId: testProfileId });

      renderProjectTypeahead({ profileId: testProfileId });

      await waitFor(() => {
        fireEvent.focus(screen.getByRole('combobox'));
        expect(screen.getByText('Existing Project')).toBeInTheDocument();
      });

      fireEvent.change(screen.getByRole('combobox'), { target: { value: 'New One' } });

      await waitFor(() => {
        expect(screen.getByText('New One')).toBeInTheDocument();
      });
    });

    it('does not show create new option when exact match exists', async () => {
      await projectRepo.create({ name: 'Exact Match', profileId: testProfileId });

      renderProjectTypeahead({ profileId: testProfileId });

      await waitFor(() => {
        fireEvent.focus(screen.getByRole('combobox'));
      });

      fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Exact Match' } });

      await waitFor(() => {
        const options = screen.getAllByRole('option');
        expect(options).toHaveLength(1);
        // The one option should NOT be a "create new" option
        expect(options[0]).not.toHaveClass('is-new');
      });
    });

    it('creates project and emits ID when selecting create new', async () => {
      const onChange = vi.fn();
      renderProjectTypeahead({ profileId: testProfileId, onChange });

      fireEvent.focus(screen.getByRole('combobox'));
      fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Brand New Project' } });

      await waitFor(() => {
        const options = screen.getAllByRole('option');
        const newOption = options.find((o) => o.classList.contains('is-new'));
        expect(newOption).toBeDefined();
      });

      // Click the create new option
      const options = screen.getAllByRole('option');
      const newOption = options.find((o) => o.classList.contains('is-new'))!;
      fireEvent.click(newOption);

      await waitFor(() => {
        expect(onChange).toHaveBeenCalled();
        const calledWith = onChange.mock.calls[onChange.mock.calls.length - 1][0];
        expect(calledWith).toBeTruthy();
        expect(calledWith).not.toBe('');
      });

      // Verify project was created in DB
      const projects = await projectRepo.list({ profileId: testProfileId });
      const created = projects.find((p) => p.name === 'Brand New Project');
      expect(created).toBeDefined();
      expect(created!.profileId).toBe(testProfileId);
    });

    it('creates project with clientId when client is selected', async () => {
      const onChange = vi.fn();
      renderProjectTypeahead({ profileId: testProfileId, clientId: 'client-a', onChange });

      fireEvent.focus(screen.getByRole('combobox'));
      fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Client Project' } });

      await waitFor(() => {
        const options = screen.getAllByRole('option');
        expect(options.some((o) => o.classList.contains('is-new'))).toBe(true);
      });

      const options = screen.getAllByRole('option');
      const newOption = options.find((o) => o.classList.contains('is-new'))!;
      fireEvent.click(newOption);

      await waitFor(() => {
        expect(onChange).toHaveBeenCalled();
      });

      const projects = await projectRepo.list({ profileId: testProfileId });
      const created = projects.find((p) => p.name === 'Client Project');
      expect(created).toBeDefined();
      expect(created!.clientId).toBe('client-a');
    });
  });

  describe('clearing selection', () => {
    it('calls onChange with empty string when input is cleared', async () => {
      const project = await projectRepo.create({ name: 'My Project', profileId: testProfileId });
      const onChange = vi.fn();

      renderProjectTypeahead({ profileId: testProfileId, value: project.id, onChange });

      await waitFor(() => {
        expect(screen.getByRole('combobox')).toHaveValue('My Project');
      });

      fireEvent.change(screen.getByRole('combobox'), { target: { value: '' } });
      expect(onChange).toHaveBeenCalledWith('');
    });
  });
});
