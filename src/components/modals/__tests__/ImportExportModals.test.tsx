import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { db } from '../../../db/database';
import { ExportDataModal } from '../ExportDataModal';
import { ImportDataModal } from '../ImportDataModal';
import { LanguageProvider } from '../../../lib/i18n';
import type { BusinessProfile, Client, Project, Transaction, Document, DocumentSequence, FxRate } from '../../../types';

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

// Test fixtures
const mockBusinessProfile: BusinessProfile = {
  id: 'profile-1',
  name: 'Test Business',
  nameEn: 'Test Business EN',
  email: 'test@business.com',
  businessType: 'company',
  defaultCurrency: 'USD',
  defaultLanguage: 'en',
  isDefault: true,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
};

const mockClient: Client = {
  id: 'client-1',
  name: 'Test Client',
  email: 'test@client.com',
  profileId: 'profile-1',
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
};

const mockProject: Project = {
  id: 'project-1',
  name: 'Test Project',
  clientId: 'client-1',
  profileId: 'profile-1',
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
};

const mockTransaction: Transaction = {
  id: 'tx-1',
  kind: 'income',
  status: 'paid',
  title: 'Test Transaction',
  clientId: 'client-1',
  projectId: 'project-1',
  amountMinor: 10000,
  currency: 'USD',
  occurredAt: '2024-01-15',
  profileId: 'profile-1',
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
};

const mockDocument: Document = {
  id: 'doc-1',
  number: 'INV-001',
  type: 'invoice',
  status: 'issued',
  businessProfileId: 'profile-1',
  clientId: 'client-1',
  items: [],
  payments: [],
  subtotalMinor: 10000,
  discountMinor: 0,
  taxMinor: 1800,
  totalMinor: 11800,
  taxRate: 0.18,
  vatEnabled: true,
  currency: 'USD',
  language: 'en',
  issueDate: '2024-01-15',
  linkedTransactionIds: ['tx-1'],
  templateId: 'template1',
  exportCount: 0,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
};

const mockDocumentSequence: DocumentSequence = {
  id: 'profile-1:invoice',
  businessProfileId: 'profile-1',
  documentType: 'invoice',
  lastNumber: 1,
  prefix: 'INV',
  prefixEnabled: true,
  updatedAt: '2024-01-01T00:00:00Z',
};

const mockFxRate: FxRate = {
  id: 'fx-1',
  baseCurrency: 'USD',
  quoteCurrency: 'ILS',
  rate: 3.5,
  effectiveDate: '2024-01-01',
  source: 'manual',
  createdAt: '2024-01-01T00:00:00Z',
};

// Helper to create a file with text() method that works in jsdom
function createMockFile(content: string, filename: string): File {
  const file = new File([content], filename, { type: 'application/json' });
  // jsdom File doesn't have text() method, so we add it
  (file as File & { text: () => Promise<string> }).text = () => Promise.resolve(content);
  return file;
}

describe('ExportDataModal', () => {
  const mockOnClose = vi.fn();

  beforeEach(async () => {
    // Clear all tables
    await db.businessProfiles.clear();
    await db.clients.clear();
    await db.projects.clear();
    await db.transactions.clear();
    await db.documents.clear();
    await db.documentSequences.clear();
    await db.fxRates.clear();

    mockOnClose.mockClear();
  });

  afterEach(async () => {
    await db.businessProfiles.clear();
    await db.clients.clear();
    await db.projects.clear();
    await db.transactions.clear();
    await db.documents.clear();
    await db.documentSequences.clear();
    await db.fxRates.clear();
    vi.restoreAllMocks();
  });

  it('should render with title', async () => {
    await db.businessProfiles.add(mockBusinessProfile);

    render(
      <TestWrapper>
        <ExportDataModal onClose={mockOnClose} />
      </TestWrapper>
    );

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
  });

  it('should show "no profiles" message when no profiles exist', async () => {
    render(
      <TestWrapper>
        <ExportDataModal onClose={mockOnClose} />
      </TestWrapper>
    );

    await waitFor(() => {
      expect(screen.getByText(/No business profiles found/i)).toBeInTheDocument();
    });
  });

  it('should display business profiles for selection', async () => {
    await db.businessProfiles.add(mockBusinessProfile);

    render(
      <TestWrapper>
        <ExportDataModal onClose={mockOnClose} />
      </TestWrapper>
    );

    await waitFor(() => {
      expect(screen.getByText('Test Business')).toBeInTheDocument();
      expect(screen.getByText('(Test Business EN)')).toBeInTheDocument();
    });
  });

  it('should auto-select the only profile when there is only one', async () => {
    await db.businessProfiles.add(mockBusinessProfile);

    render(
      <TestWrapper>
        <ExportDataModal onClose={mockOnClose} />
      </TestWrapper>
    );

    await waitFor(() => {
      const exportButton = screen.getByRole('button', { name: /Export Test Business/i });
      expect(exportButton).not.toBeDisabled();
    });
  });

  it('should close when cancel is clicked', async () => {
    await db.businessProfiles.add(mockBusinessProfile);

    render(
      <TestWrapper>
        <ExportDataModal onClose={mockOnClose} />
      </TestWrapper>
    );

    const cancelButton = screen.getByRole('button', { name: /cancel/i });
    await userEvent.click(cancelButton);

    expect(mockOnClose).toHaveBeenCalled();
  });

  it('should close when escape key is pressed', async () => {
    await db.businessProfiles.add(mockBusinessProfile);

    render(
      <TestWrapper>
        <ExportDataModal onClose={mockOnClose} />
      </TestWrapper>
    );

    fireEvent.keyDown(document, { key: 'Escape' });

    await waitFor(() => {
      expect(mockOnClose).toHaveBeenCalled();
    });
  });

  it('should export data as JSON file when export button is clicked', async () => {
    // Set up data
    await db.businessProfiles.add(mockBusinessProfile);
    await db.clients.add(mockClient);
    await db.projects.add(mockProject);
    await db.transactions.add(mockTransaction);
    await db.documents.add(mockDocument);
    await db.documentSequences.add(mockDocumentSequence);
    await db.fxRates.add(mockFxRate);

    // Store original createElement
    const originalCreateElement = document.createElement.bind(document);

    // Mock anchor element
    const mockClick = vi.fn();
    let capturedDownloadName = '';

    vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
      if (tagName === 'a') {
        const mockAnchor = {
          _href: '',
          download: '',
          click: mockClick,
        };
        Object.defineProperty(mockAnchor, 'href', {
          set(val: string) { mockAnchor._href = val; },
          get() { return mockAnchor._href || ''; },
        });
        // Track download name
        Object.defineProperty(mockAnchor, 'download', {
          set(val: string) { capturedDownloadName = val; },
          get() { return capturedDownloadName; },
        });
        return mockAnchor as unknown as HTMLAnchorElement;
      }
      return originalCreateElement(tagName);
    });

    render(
      <TestWrapper>
        <ExportDataModal onClose={mockOnClose} />
      </TestWrapper>
    );

    await waitFor(() => {
      expect(screen.getByText('Test Business')).toBeInTheDocument();
    });

    const exportButton = screen.getByRole('button', { name: /Export Test Business/i });
    await userEvent.click(exportButton);

    await waitFor(() => {
      expect(mockClick).toHaveBeenCalled();
    });

    // Verify download filename pattern
    expect(capturedDownloadName).toMatch(/^mutaba3a-Test-Business-EN-\d{4}-\d{2}-\d{2}\.json$/);
  });

  it('should show success message after export', async () => {
    await db.businessProfiles.add(mockBusinessProfile);

    // Store original createElement
    const originalCreateElement = document.createElement.bind(document);

    vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
      if (tagName === 'a') {
        return { href: '', download: '', click: vi.fn() } as unknown as HTMLAnchorElement;
      }
      return originalCreateElement(tagName);
    });

    render(
      <TestWrapper>
        <ExportDataModal onClose={mockOnClose} />
      </TestWrapper>
    );

    await waitFor(() => {
      expect(screen.getByText('Test Business')).toBeInTheDocument();
    });

    const exportButton = screen.getByRole('button', { name: /Export Test Business/i });
    await userEvent.click(exportButton);

    await waitFor(() => {
      expect(screen.getByText('Export Complete')).toBeInTheDocument();
    });
  });
});

describe('ImportDataModal', () => {
  const mockOnClose = vi.fn();
  const mockOnSuccess = vi.fn();

  beforeEach(async () => {
    // Clear all tables
    await db.businessProfiles.clear();
    await db.clients.clear();
    await db.projects.clear();
    await db.transactions.clear();
    await db.documents.clear();
    await db.documentSequences.clear();
    await db.fxRates.clear();
    await db.settings.clear();
    await db.categories.clear();

    mockOnClose.mockClear();
    mockOnSuccess.mockClear();
  });

  afterEach(async () => {
    await db.businessProfiles.clear();
    await db.clients.clear();
    await db.projects.clear();
    await db.transactions.clear();
    await db.documents.clear();
    await db.documentSequences.clear();
    await db.fxRates.clear();
    await db.settings.clear();
    await db.categories.clear();
  });

  it('should render with file drop zone', () => {
    render(
      <TestWrapper>
        <ImportDataModal onClose={mockOnClose} />
      </TestWrapper>
    );

    expect(screen.getByText(/Drop a .json file here/i)).toBeInTheDocument();
  });

  it('should close when cancel is clicked', async () => {
    render(
      <TestWrapper>
        <ImportDataModal onClose={mockOnClose} />
      </TestWrapper>
    );

    const cancelButton = screen.getByRole('button', { name: /cancel/i });
    await userEvent.click(cancelButton);

    expect(mockOnClose).toHaveBeenCalled();
  });

  it('should close when escape key is pressed', async () => {
    render(
      <TestWrapper>
        <ImportDataModal onClose={mockOnClose} />
      </TestWrapper>
    );

    await act(async () => {
      fireEvent.keyDown(document, { key: 'Escape' });
    });

    await waitFor(() => {
      expect(mockOnClose).toHaveBeenCalled();
    });
  });

  it('should show error for non-json files via drop', async () => {
    render(
      <TestWrapper>
        <ImportDataModal onClose={mockOnClose} />
      </TestWrapper>
    );

    const dropZone = screen.getByText(/Drop a .json file here/i).parentElement;
    expect(dropZone).toBeInTheDocument();

    // Create a non-JSON file
    const file = new File(['test'], 'test.txt', { type: 'text/plain' });

    await act(async () => {
      fireEvent.drop(dropZone!, {
        dataTransfer: { files: [file] },
        preventDefault: () => {},
      });
    });

    await waitFor(() => {
      expect(screen.getByText(/Please drop a .json file/i)).toBeInTheDocument();
    });
  });

  it('should handle file input selection for v2 format', async () => {
    const v2ExportData = {
      version: 2,
      exportedAt: '2024-01-15T00:00:00Z',
      profileId: 'profile-1',
      profile: mockBusinessProfile,
      documents: [mockDocument],
      documentSequences: [mockDocumentSequence],
      transactions: [mockTransaction],
      clients: [mockClient],
      projects: [mockProject],
      fxRates: [mockFxRate],
    };

    render(
      <TestWrapper>
        <ImportDataModal onClose={mockOnClose} />
      </TestWrapper>
    );

    // Get the hidden file input
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(fileInput).toBeInTheDocument();

    // Create and set file
    const file = createMockFile(JSON.stringify(v2ExportData), 'backup.json');

    await act(async () => {
      // Simulate file selection
      Object.defineProperty(fileInput, 'files', {
        value: [file],
        writable: false,
      });
      fireEvent.change(fileInput);
    });

    await waitFor(() => {
      expect(screen.getByText('backup.json')).toBeInTheDocument();
    });

    // Check profile name is shown
    expect(screen.getByText(/Profile: Test Business/i)).toBeInTheDocument();
  });

  it('should show legacy format warning for v1 files', async () => {
    const v1ExportData = {
      clients: [mockClient],
      projects: [mockProject],
      transactions: [mockTransaction],
    };

    render(
      <TestWrapper>
        <ImportDataModal onClose={mockOnClose} />
      </TestWrapper>
    );

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = createMockFile(JSON.stringify(v1ExportData), 'legacy-backup.json');

    await act(async () => {
      Object.defineProperty(fileInput, 'files', {
        value: [file],
        writable: false,
      });
      fireEvent.change(fileInput);
    });

    await waitFor(() => {
      expect(screen.getByText(/Legacy format/i)).toBeInTheDocument();
      expect(screen.getByText(/Importing will replace all existing data/i)).toBeInTheDocument();
    });
  });

  it('should import v2 format with create new profile mode', async () => {
    const v2ExportData = {
      version: 2,
      exportedAt: '2024-01-15T00:00:00Z',
      profileId: 'profile-1',
      profile: mockBusinessProfile,
      documents: [mockDocument],
      documentSequences: [mockDocumentSequence],
      transactions: [mockTransaction],
      clients: [mockClient],
      projects: [mockProject],
      fxRates: [mockFxRate],
    };

    render(
      <TestWrapper>
        <ImportDataModal onClose={mockOnClose} onSuccess={mockOnSuccess} />
      </TestWrapper>
    );

    // Upload file via input
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = createMockFile(JSON.stringify(v2ExportData), 'backup.json');

    await act(async () => {
      Object.defineProperty(fileInput, 'files', {
        value: [file],
        writable: false,
      });
      fireEvent.change(fileInput);
    });

    await waitFor(() => {
      expect(screen.getByText('backup.json')).toBeInTheDocument();
    });

    // Verify "Create new profile" option is selected by default
    const createNewOption = screen.getByLabelText(/Create new profile/i);
    expect(createNewOption).toBeChecked();

    // Click import button
    const importButton = screen.getByRole('button', { name: /^Import$/i });
    await userEvent.click(importButton);

    // Wait for import to complete
    await waitFor(() => {
      expect(screen.getByText('Import Complete')).toBeInTheDocument();
    });

    // Verify data was imported
    const profiles = await db.businessProfiles.toArray();
    expect(profiles).toHaveLength(1);
    // ID should be new (different from original)
    expect(profiles[0].id).not.toBe('profile-1');
    expect(profiles[0].name).toBe('Test Business');

    // Verify transactions were imported with new IDs
    const transactions = await db.transactions.toArray();
    expect(transactions).toHaveLength(1);
    expect(transactions[0].id).not.toBe('tx-1');
    expect(transactions[0].title).toBe('Test Transaction');
  });

  it('should import legacy format and replace all data', async () => {
    // Pre-populate database with existing data
    await db.clients.add({ ...mockClient, id: 'existing-client', name: 'Existing Client' });
    await db.projects.add({ ...mockProject, id: 'existing-project', name: 'Existing Project' });

    const v1ExportData = {
      clients: [{ ...mockClient, name: 'Imported Client' }],
      projects: [{ ...mockProject, name: 'Imported Project' }],
      transactions: [mockTransaction],
    };

    render(
      <TestWrapper>
        <ImportDataModal onClose={mockOnClose} onSuccess={mockOnSuccess} />
      </TestWrapper>
    );

    // Upload file
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = createMockFile(JSON.stringify(v1ExportData), 'legacy-backup.json');

    await act(async () => {
      Object.defineProperty(fileInput, 'files', {
        value: [file],
        writable: false,
      });
      fireEvent.change(fileInput);
    });

    await waitFor(() => {
      expect(screen.getByText('legacy-backup.json')).toBeInTheDocument();
    });

    // Click import button
    const importButton = screen.getByRole('button', { name: /^Import$/i });
    await userEvent.click(importButton);

    // Wait for import to complete
    await waitFor(() => {
      expect(screen.getByText('Import Complete')).toBeInTheDocument();
    });

    // Verify existing data was replaced
    const clients = await db.clients.toArray();
    expect(clients).toHaveLength(1);
    expect(clients[0].name).toBe('Imported Client');

    const projects = await db.projects.toArray();
    expect(projects).toHaveLength(1);
    expect(projects[0].name).toBe('Imported Project');
  });

  it('should show merge option when profile exists', async () => {
    // Add existing profile
    await db.businessProfiles.add(mockBusinessProfile);

    const v2ExportData = {
      version: 2,
      exportedAt: '2024-01-15T00:00:00Z',
      profileId: 'profile-1',
      profile: mockBusinessProfile,
      documents: [mockDocument],
      transactions: [mockTransaction],
      clients: [mockClient],
      projects: [mockProject],
      fxRates: [],
    };

    render(
      <TestWrapper>
        <ImportDataModal onClose={mockOnClose} />
      </TestWrapper>
    );

    // Upload file
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = createMockFile(JSON.stringify(v2ExportData), 'backup.json');

    await act(async () => {
      Object.defineProperty(fileInput, 'files', {
        value: [file],
        writable: false,
      });
      fireEvent.change(fileInput);
    });

    await waitFor(() => {
      expect(screen.getByText('backup.json')).toBeInTheDocument();
    });

    // Verify merge option is available
    await waitFor(() => {
      expect(screen.getByLabelText(/Merge into existing profile/i)).toBeInTheDocument();
    });
  });

  it('should auto-select merge mode when profile already exists', async () => {
    // Add existing profile with same email
    await db.businessProfiles.add(mockBusinessProfile);

    const v2ExportData = {
      version: 2,
      exportedAt: '2024-01-15T00:00:00Z',
      profileId: 'profile-1',
      profile: mockBusinessProfile,
      documents: [],
      transactions: [],
      clients: [],
      projects: [],
      fxRates: [],
    };

    render(
      <TestWrapper>
        <ImportDataModal onClose={mockOnClose} />
      </TestWrapper>
    );

    // Wait for the profiles to be loaded by React Query
    // The modal needs time to fetch existing profiles before we can select a file
    await act(async () => {
      // Small delay to let React Query fetch the profiles
      await new Promise(resolve => setTimeout(resolve, 100));
    });

    // Upload file
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = createMockFile(JSON.stringify(v2ExportData), 'backup.json');

    await act(async () => {
      Object.defineProperty(fileInput, 'files', {
        value: [file],
        writable: false,
      });
      fireEvent.change(fileInput);
    });

    await waitFor(() => {
      const mergeOption = screen.getByLabelText(/Merge into existing profile/i);
      expect(mergeOption).toBeChecked();
    });
  });

  it('should merge data into existing profile', async () => {
    // Add existing profile
    await db.businessProfiles.add(mockBusinessProfile);

    // Add existing transaction
    await db.transactions.add({ ...mockTransaction, id: 'existing-tx', title: 'Existing Transaction' });

    const v2ExportData = {
      version: 2,
      exportedAt: '2024-01-15T00:00:00Z',
      profileId: 'profile-1',
      profile: mockBusinessProfile,
      documents: [],
      documentSequences: [],
      transactions: [{ ...mockTransaction, id: 'new-tx', title: 'New Transaction' }],
      clients: [],
      projects: [],
      fxRates: [],
    };

    render(
      <TestWrapper>
        <ImportDataModal onClose={mockOnClose} onSuccess={mockOnSuccess} />
      </TestWrapper>
    );

    // Wait for the profiles to be loaded by React Query
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 100));
    });

    // Upload file
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = createMockFile(JSON.stringify(v2ExportData), 'backup.json');

    await act(async () => {
      Object.defineProperty(fileInput, 'files', {
        value: [file],
        writable: false,
      });
      fireEvent.change(fileInput);
    });

    await waitFor(() => {
      expect(screen.getByText('backup.json')).toBeInTheDocument();
    });

    // Verify merge is auto-selected
    await waitFor(() => {
      const mergeOption = screen.getByLabelText(/Merge into existing profile/i);
      expect(mergeOption).toBeChecked();
    });

    // Click import button
    const importButton = screen.getByRole('button', { name: /^Import$/i });
    await userEvent.click(importButton);

    // Wait for import to complete
    await waitFor(() => {
      expect(screen.getByText('Import Complete')).toBeInTheDocument();
    });

    // Verify both transactions exist (merge adds, doesn't replace)
    const transactions = await db.transactions.toArray();
    expect(transactions).toHaveLength(2);
    const titles = transactions.map(t => t.title);
    expect(titles).toContain('Existing Transaction');
    expect(titles).toContain('New Transaction');
  });

  it('should handle invalid JSON gracefully', async () => {
    render(
      <TestWrapper>
        <ImportDataModal onClose={mockOnClose} />
      </TestWrapper>
    );

    // Upload invalid JSON file
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = createMockFile('not valid json {{{', 'invalid.json');

    await act(async () => {
      Object.defineProperty(fileInput, 'files', {
        value: [file],
        writable: false,
      });
      fireEvent.change(fileInput);
    });

    await waitFor(() => {
      expect(screen.getByText(/Failed to read file/i)).toBeInTheDocument();
    });
  });

  it('should call onSuccess callback after successful import', async () => {
    const v2ExportData = {
      version: 2,
      exportedAt: '2024-01-15T00:00:00Z',
      profileId: 'profile-1',
      profile: mockBusinessProfile,
      documents: [],
      transactions: [],
      clients: [],
      projects: [],
      fxRates: [],
    };

    render(
      <TestWrapper>
        <ImportDataModal onClose={mockOnClose} onSuccess={mockOnSuccess} />
      </TestWrapper>
    );

    // Upload file
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = createMockFile(JSON.stringify(v2ExportData), 'backup.json');

    await act(async () => {
      Object.defineProperty(fileInput, 'files', {
        value: [file],
        writable: false,
      });
      fireEvent.change(fileInput);
    });

    await waitFor(() => {
      expect(screen.getByText('backup.json')).toBeInTheDocument();
    });

    // Click import button
    const importButton = screen.getByRole('button', { name: /^Import$/i });
    await userEvent.click(importButton);

    await waitFor(() => {
      expect(mockOnSuccess).toHaveBeenCalled();
    });
  });

  it('should handle duplicate client detection by email', async () => {
    // Add existing client with same email
    await db.clients.add(mockClient);

    const v2ExportData = {
      version: 2,
      exportedAt: '2024-01-15T00:00:00Z',
      profileId: 'profile-new',
      profile: { ...mockBusinessProfile, id: 'profile-new', email: 'new@business.com' },
      documents: [],
      transactions: [],
      clients: [{ ...mockClient, id: 'imported-client', name: 'Imported Client with Same Email' }],
      projects: [],
      fxRates: [],
    };

    render(
      <TestWrapper>
        <ImportDataModal onClose={mockOnClose} onSuccess={mockOnSuccess} />
      </TestWrapper>
    );

    // Upload file
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = createMockFile(JSON.stringify(v2ExportData), 'backup.json');

    await act(async () => {
      Object.defineProperty(fileInput, 'files', {
        value: [file],
        writable: false,
      });
      fireEvent.change(fileInput);
    });

    await waitFor(() => {
      expect(screen.getByText('backup.json')).toBeInTheDocument();
    });

    // Click import button
    const importButton = screen.getByRole('button', { name: /^Import$/i });
    await userEvent.click(importButton);

    await waitFor(() => {
      expect(screen.getByText('Import Complete')).toBeInTheDocument();
    });

    // Should NOT add duplicate client (skipped due to email match)
    const clients = await db.clients.toArray();
    expect(clients).toHaveLength(1);
    expect(clients[0].name).toBe('Test Client'); // Original, not imported
  });

  it('should handle duplicate project detection by name', async () => {
    // Add existing project with same name
    await db.projects.add(mockProject);

    const v2ExportData = {
      version: 2,
      exportedAt: '2024-01-15T00:00:00Z',
      profileId: 'profile-new',
      profile: { ...mockBusinessProfile, id: 'profile-new', email: 'new@business.com' },
      documents: [],
      transactions: [],
      clients: [],
      projects: [{ ...mockProject, id: 'imported-project', notes: 'Imported version' }],
      fxRates: [],
    };

    render(
      <TestWrapper>
        <ImportDataModal onClose={mockOnClose} onSuccess={mockOnSuccess} />
      </TestWrapper>
    );

    // Upload file
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = createMockFile(JSON.stringify(v2ExportData), 'backup.json');

    await act(async () => {
      Object.defineProperty(fileInput, 'files', {
        value: [file],
        writable: false,
      });
      fireEvent.change(fileInput);
    });

    await waitFor(() => {
      expect(screen.getByText('backup.json')).toBeInTheDocument();
    });

    // Click import button
    const importButton = screen.getByRole('button', { name: /^Import$/i });
    await userEvent.click(importButton);

    await waitFor(() => {
      expect(screen.getByText('Import Complete')).toBeInTheDocument();
    });

    // Should NOT add duplicate project (skipped due to name match)
    const projects = await db.projects.toArray();
    expect(projects).toHaveLength(1);
    expect(projects[0].notes).toBeUndefined(); // Original, not imported
  });

  it('should display import statistics after successful import', async () => {
    const v2ExportData = {
      version: 2,
      exportedAt: '2024-01-15T00:00:00Z',
      profileId: 'profile-1',
      profile: mockBusinessProfile,
      documents: [mockDocument],
      transactions: [mockTransaction],
      clients: [mockClient],
      projects: [mockProject],
      fxRates: [],
    };

    render(
      <TestWrapper>
        <ImportDataModal onClose={mockOnClose} />
      </TestWrapper>
    );

    // Upload file
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = createMockFile(JSON.stringify(v2ExportData), 'backup.json');

    await act(async () => {
      Object.defineProperty(fileInput, 'files', {
        value: [file],
        writable: false,
      });
      fireEvent.change(fileInput);
    });

    await waitFor(() => {
      expect(screen.getByText('backup.json')).toBeInTheDocument();
    });

    // Click import button
    const importButton = screen.getByRole('button', { name: /^Import$/i });
    await userEvent.click(importButton);

    await waitFor(() => {
      expect(screen.getByText('Import Complete')).toBeInTheDocument();
    });

    // Verify statistics are shown
    expect(screen.getByText(/1 profile/i)).toBeInTheDocument();
    expect(screen.getByText(/1 documents/i)).toBeInTheDocument();
    expect(screen.getByText(/1 transactions/i)).toBeInTheDocument();
  });
});

describe('Import/Export Round Trip', () => {
  beforeEach(async () => {
    await db.businessProfiles.clear();
    await db.clients.clear();
    await db.projects.clear();
    await db.transactions.clear();
    await db.documents.clear();
    await db.documentSequences.clear();
    await db.fxRates.clear();
    await db.settings.clear();
  });

  afterEach(async () => {
    await db.businessProfiles.clear();
    await db.clients.clear();
    await db.projects.clear();
    await db.transactions.clear();
    await db.documents.clear();
    await db.documentSequences.clear();
    await db.fxRates.clear();
    await db.settings.clear();
  });

  it('should export and re-import data maintaining integrity', async () => {
    // Step 1: Set up initial data
    await db.businessProfiles.add(mockBusinessProfile);
    await db.clients.add(mockClient);
    await db.projects.add(mockProject);
    await db.transactions.add(mockTransaction);
    await db.documents.add(mockDocument);
    await db.documentSequences.add(mockDocumentSequence);
    await db.fxRates.add(mockFxRate);

    // Step 2: Create export data structure (simulating what ExportDataModal does)
    const profile = await db.businessProfiles.get('profile-1');
    const documents = await db.documents.filter(d => d.businessProfileId === 'profile-1').toArray();
    const documentSequences = await db.documentSequences.filter(s => s.businessProfileId === 'profile-1').toArray();

    const clientIds = new Set<string>();
    const transactionIds = new Set<string>();
    documents.forEach(doc => {
      if (doc.clientId) clientIds.add(doc.clientId);
      if (doc.linkedTransactionIds) {
        doc.linkedTransactionIds.forEach(id => transactionIds.add(id));
      }
    });

    const clients = await db.clients.filter(c => clientIds.has(c.id)).toArray();
    const projects = await db.projects.filter(p => p.clientId && clientIds.has(p.clientId)).toArray();
    const transactions = await db.transactions.filter(t => transactionIds.has(t.id)).toArray();
    const fxRates = await db.fxRates.toArray();

    const exportData = {
      version: 2,
      exportedAt: new Date().toISOString(),
      profileId: 'profile-1',
      profile,
      documentSequences,
      documents,
      transactions,
      clients,
      projects,
      fxRates,
    };

    // Step 3: Clear database
    await db.businessProfiles.clear();
    await db.clients.clear();
    await db.projects.clear();
    await db.transactions.clear();
    await db.documents.clear();
    await db.documentSequences.clear();
    await db.fxRates.clear();

    // Verify database is empty
    expect(await db.businessProfiles.count()).toBe(0);
    expect(await db.transactions.count()).toBe(0);

    // Step 4: Import the exported data
    const mockOnClose = vi.fn();

    render(
      <TestWrapper>
        <ImportDataModal onClose={mockOnClose} />
      </TestWrapper>
    );

    // Upload the export file
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = createMockFile(JSON.stringify(exportData), 'backup.json');

    await act(async () => {
      Object.defineProperty(fileInput, 'files', {
        value: [file],
        writable: false,
      });
      fireEvent.change(fileInput);
    });

    await waitFor(() => {
      expect(screen.getByText('backup.json')).toBeInTheDocument();
    });

    // Click import button
    const importButton = screen.getByRole('button', { name: /^Import$/i });
    await userEvent.click(importButton);

    await waitFor(() => {
      expect(screen.getByText('Import Complete')).toBeInTheDocument();
    });

    // Step 5: Verify data was restored correctly
    const restoredProfiles = await db.businessProfiles.toArray();
    expect(restoredProfiles).toHaveLength(1);
    expect(restoredProfiles[0].name).toBe('Test Business');
    expect(restoredProfiles[0].email).toBe('test@business.com');

    const restoredClients = await db.clients.toArray();
    expect(restoredClients).toHaveLength(1);
    expect(restoredClients[0].name).toBe('Test Client');

    const restoredProjects = await db.projects.toArray();
    expect(restoredProjects).toHaveLength(1);
    expect(restoredProjects[0].name).toBe('Test Project');

    const restoredTransactions = await db.transactions.toArray();
    expect(restoredTransactions).toHaveLength(1);
    expect(restoredTransactions[0].title).toBe('Test Transaction');
    expect(restoredTransactions[0].amountMinor).toBe(10000);
    expect(restoredTransactions[0].currency).toBe('USD');

    const restoredDocuments = await db.documents.toArray();
    expect(restoredDocuments).toHaveLength(1);
    expect(restoredDocuments[0].number).toBe('INV-001');
    expect(restoredDocuments[0].totalMinor).toBe(11800);

    const restoredFxRates = await db.fxRates.toArray();
    expect(restoredFxRates).toHaveLength(1);
    expect(restoredFxRates[0].rate).toBe(3.5);
  });
});
