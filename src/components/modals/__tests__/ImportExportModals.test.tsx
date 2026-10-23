import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { db } from '../../../db/database';
import { ExportDataModal } from '../ExportDataModal';
import { LanguageProvider } from '../../../lib/i18n';
import * as csvUtils from '../../../utils/csv';
import type { BusinessProfile, Client, Project, Transaction, FxRate } from '../../../types';
import type { Document, DocumentSequence } from '../../../db/retained/documentSchema';

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
  defaultCurrency: 'USD',
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

    // Select JSON format (CSV is default)
    const jsonFormatButton = screen.getByRole('button', { name: /JSON/i });
    await userEvent.click(jsonFormatButton);

    const exportButton = screen.getByRole('button', { name: /Export Test Business/i });
    await userEvent.click(exportButton);

    await waitFor(() => {
      expect(mockClick).toHaveBeenCalled();
    });

    // Verify download filename pattern
    expect(capturedDownloadName).toMatch(/^mtb3a-Test-Business-EN-\d{4}-\d{2}-\d{2}\.json$/);
  });

  it('should export profile transactions in CSV even when not linked to documents', async () => {
    await db.businessProfiles.add(mockBusinessProfile);
    await db.clients.add(mockClient);
    await db.projects.add(mockProject);
    await db.transactions.add(mockTransaction);

    const downloadSpy = vi.spyOn(csvUtils, 'downloadTextFile').mockImplementation(() => {});

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
      expect(downloadSpy).toHaveBeenCalled();
    });

    const [fileName, csvContent] = downloadSpy.mock.calls[0];
    // The name people see in Downloads says the product in lower case, like the domain (MUT-402 D6)
    expect(fileName).toMatch(/^mtb3a-Test-Business-EN-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(typeof csvContent).toBe('string');
    expect(csvContent).toContain('income');
    expect(csvContent).toContain('Test Transaction');
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
