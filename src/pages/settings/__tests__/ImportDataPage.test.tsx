/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent, act, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { db } from '../../../db/database';
import { LanguageProvider } from '../../../lib/i18n';
import { ExportDataModal } from '../../../components/modals/ExportDataModal';
import * as csvUtils from '../../../utils/csv';
import type { BusinessProfile, Client, FxRate, Project, Transaction } from '../../../types';
import type { Document, DocumentSequence } from '../../../db/retained/documentSchema';
import { ImportDataPage } from '../ImportDataPage';

/**
 * Settings → Import (/settings/import), the one live import path. Ported from
 * the dead ImportDataModal's suite (MUT-145, D13) and extended for MUT-158:
 * a v2 profile export now actually imports, with every link remapped.
 */
const mockNavigate = vi.fn();
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mockNavigate,
  Link: ({ children, to }: { children: ReactNode; to: string }) => <a href={to}>{children}</a>,
}));

function TestWrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
  return (
    <QueryClientProvider client={queryClient}>
      <LanguageProvider>{children}</LanguageProvider>
    </QueryClientProvider>
  );
}

const T = '2024-01-01T00:00:00Z';

const profile: BusinessProfile = {
  id: 'profile-1',
  name: 'Test Business',
  nameEn: 'Test Business EN',
  email: 'test@business.com',
  defaultCurrency: 'USD',
  isDefault: true,
  createdAt: T,
  updatedAt: T,
};
const client: Client = { id: 'client-1', name: 'Test Client', email: 'test@client.com', profileId: 'profile-1', createdAt: T, updatedAt: T };
const project: Project = { id: 'project-1', name: 'Test Project', clientId: 'client-1', profileId: 'profile-1', createdAt: T, updatedAt: T };
const transaction: Transaction = {
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
  createdAt: T,
  updatedAt: T,
};
// A document issued before MUT-145 retired generation (retained table).
const document_: Document = {
  id: 'doc-1',
  number: 'INV-001',
  type: 'invoice',
  status: 'issued',
  businessProfileId: 'profile-1',
  clientId: 'client-1',
  linkedTransactionIds: ['tx-1'],
  totalMinor: 11800,
  createdAt: T,
  updatedAt: T,
};
const sequence: DocumentSequence = { id: 'profile-1:invoice', businessProfileId: 'profile-1', documentType: 'invoice', lastNumber: 1 };
const fxRate: FxRate = { id: 'fx-1', baseCurrency: 'USD', quoteCurrency: 'ILS', rate: 3.5, effectiveDate: '2024-01-01', source: 'manual', createdAt: T };

function v2File(overrides: Record<string, unknown> = {}) {
  return {
    version: 2,
    exportedAt: '2024-01-15T00:00:00Z',
    profileId: 'profile-1',
    profile,
    documents: [document_],
    documentSequences: [sequence],
    transactions: [transaction],
    clients: [client],
    projects: [project],
    fxRates: [fxRate],
    ...overrides,
  };
}

const TABLES = ['businessProfiles', 'clients', 'projects', 'transactions', 'documents', 'documentSequences', 'fxRates', 'settings', 'categories'];
async function clearAll() {
  await Promise.all(TABLES.map((name) => db.table(name).clear()));
}

function renderPage() {
  return render(<ImportDataPage />, { wrapper: TestWrapper });
}

// jsdom's File has no text(); the page reads files with it.
function mockFile(content: string, name: string, type = 'application/json'): File {
  const file = new File([content], name, { type });
  (file as File & { text: () => Promise<string> }).text = () => Promise.resolve(content);
  return file;
}

async function chooseFile(content: string, name: string) {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  await act(async () => {
    Object.defineProperty(input, 'files', { value: [mockFile(content, name)], configurable: true });
    fireEvent.change(input);
  });
  await screen.findByText(name);
}

/** Let React Query load the profile list before a file is chosen. */
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
}

async function importJson() {
  await userEvent.click(screen.getByRole('button', { name: /Import JSON/i }));
  await screen.findByText('Import Complete!');
}

beforeEach(async () => {
  await clearAll();
  mockNavigate.mockClear();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await clearAll();
});

describe('ImportDataPage: choosing a file', () => {
  it('renders the drop zone', () => {
    renderPage();
    expect(screen.getByText(/Drop a .json or .csv file here/i)).toBeInTheDocument();
  });

  it('goes back to Settings', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /Back to Settings/i }));
    expect(mockNavigate).toHaveBeenCalledWith({ to: '/settings' });
  });

  it('returns to the drop zone from the preview to choose a different file', async () => {
    renderPage();
    await chooseFile(JSON.stringify(v2File()), 'backup.json');
    await userEvent.click(screen.getByRole('button', { name: /Choose Different File/i }));
    expect(screen.getByText(/Drop a .json or .csv file here/i)).toBeInTheDocument();
  });

  it('rejects a dropped file that is neither .json nor .csv', async () => {
    renderPage();
    const zone = screen.getByText(/Drop a .json or .csv file here/i).closest('.import-dropzone')!;
    await act(async () => {
      fireEvent.drop(zone, { dataTransfer: { files: [new File(['x'], 'notes.txt', { type: 'text/plain' })] } });
    });
    expect(await screen.findByText(/Please drop a .json or .csv file/i)).toBeInTheDocument();
  });

  it('handles invalid JSON gracefully', async () => {
    renderPage();
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await act(async () => {
      Object.defineProperty(input, 'files', { value: [mockFile('{ not json', 'broken.json')], configurable: true });
      fireEvent.change(input);
    });
    expect(await screen.findByText(/Failed to read file/i)).toBeInTheDocument();
  });

  it('previews a v2 file by its profile name', async () => {
    renderPage();
    await chooseFile(JSON.stringify(v2File()), 'backup.json');
    expect(screen.getByText(/Profile: Test Business/i)).toBeInTheDocument();
  });

  it('warns that a legacy (v1) file replaces all data', async () => {
    renderPage();
    await chooseFile(JSON.stringify({ clients: [client], projects: [project], transactions: [transaction] }), 'old.json');
    expect(screen.getByText(/Importing will replace all existing data/i)).toBeInTheDocument();
  });
});

describe('ImportDataPage: legacy (v1) files', () => {
  it('replaces all data and switches on the areas the data belongs to', async () => {
    await db.clients.add({ ...client, id: 'existing-client', name: 'Existing Client' });
    await db.projects.add({ ...project, id: 'existing-project', name: 'Existing Project' });
    renderPage();

    await chooseFile(
      JSON.stringify({ clients: [{ ...client, name: 'Imported Client' }], projects: [{ ...project, name: 'Imported Project' }], transactions: [transaction] }),
      'legacy-backup.json',
    );
    await importJson();

    expect((await db.clients.toArray()).map((c) => c.name)).toEqual(['Imported Client']);
    expect((await db.projects.toArray()).map((p) => p.name)).toEqual(['Imported Project']);
    const settings = await db.settings.get('default');
    expect(settings?.features?.projects).toBe(true);
    expect(settings?.featureNotice).toEqual(['projects']);
  });
});

describe('ImportDataPage: v2 profile files (MUT-158)', () => {
  it('defaults to creating a new profile and imports it with fresh IDs and intact links', async () => {
    renderPage();
    await chooseFile(JSON.stringify(v2File()), 'backup.json');
    expect(screen.getByLabelText(/Create a new profile/i)).toBeChecked();

    await importJson();

    const [p] = await db.businessProfiles.toArray();
    const [c] = await db.clients.toArray();
    const [pr] = await db.projects.toArray();
    const [tx] = await db.transactions.toArray();
    const [doc] = await db.documents.toArray();
    expect(p).toMatchObject({ name: 'Test Business', isDefault: true });
    expect(p.id).not.toBe('profile-1');
    expect(tx).toMatchObject({ title: 'Test Transaction', profileId: p.id, clientId: c.id, projectId: pr.id });
    expect(tx.id).not.toBe('tx-1');
    expect(doc).toMatchObject({ number: 'INV-001', businessProfileId: p.id, linkedTransactionIds: [tx.id] });
  });

  it('offers merging when a matching profile exists, and picks it by default', async () => {
    await db.businessProfiles.add(profile);
    renderPage();
    await settle();
    await chooseFile(JSON.stringify(v2File()), 'backup.json');

    expect(screen.getByLabelText(/Merge into an existing profile/i)).toBeChecked();
    expect(screen.getByLabelText(/Choose a profile/i)).toHaveValue('profile-1');
  });

  it('does not offer merging when there is no profile to merge into', async () => {
    renderPage();
    await chooseFile(JSON.stringify(v2File()), 'backup.json');
    expect(screen.queryByLabelText(/Merge into an existing profile/i)).toBeNull();
  });

  it('merges into the existing profile: adds the entries, keeps the old ones', async () => {
    await db.businessProfiles.add(profile);
    await db.transactions.add({ ...transaction, id: 'existing-tx', title: 'Existing Transaction' });
    renderPage();
    await settle();
    await chooseFile(JSON.stringify(v2File({ documents: [], documentSequences: [], clients: [], projects: [], fxRates: [], transactions: [{ ...transaction, id: 'new-tx', title: 'New Transaction' }] })), 'backup.json');

    await importJson();

    expect((await db.transactions.toArray()).map((t) => t.title).sort()).toEqual(['Existing Transaction', 'New Transaction']);
    expect(await db.businessProfiles.count()).toBe(1);
  });

  it('can create a new profile even when a matching one exists', async () => {
    await db.businessProfiles.add(profile);
    renderPage();
    await settle();
    await chooseFile(JSON.stringify(v2File()), 'backup.json');

    await userEvent.click(screen.getByLabelText(/Create a new profile/i));
    await importJson();

    expect(await db.businessProfiles.count()).toBe(2);
    const created = (await db.businessProfiles.toArray()).find((p) => p.id !== 'profile-1')!;
    expect(created.isDefault).toBe(false);
  });

  it('reuses the target profile\'s own client with the same email when merging', async () => {
    await db.businessProfiles.add(profile);
    await db.clients.add(client);
    renderPage();
    await settle();
    await chooseFile(
      JSON.stringify(
        v2File({
          clients: [{ ...client, id: 'imported-client', name: 'Same email, other name' }],
          transactions: [{ ...transaction, clientId: 'imported-client', projectId: undefined }],
          projects: [],
          documents: [],
          documentSequences: [],
        }),
      ),
      'backup.json',
    );

    await importJson();

    const clients = await db.clients.toArray();
    expect(clients).toHaveLength(1);
    expect(clients[0].name).toBe('Test Client');
    expect((await db.transactions.toArray())[0].clientId).toBe('client-1');
  });

  it('reuses the target profile\'s own project with the same name when merging', async () => {
    await db.businessProfiles.add(profile);
    await db.projects.add(project);
    renderPage();
    await settle();
    await chooseFile(JSON.stringify(v2File({ projects: [{ ...project, id: 'imported-project', notes: 'Imported version' }], clients: [], documents: [], documentSequences: [] })), 'backup.json');

    await importJson();

    const projects = await db.projects.toArray();
    expect(projects).toHaveLength(1);
    expect(projects[0].notes).toBeUndefined();
  });

  it('reports what it imported, without naming documents', async () => {
    renderPage();
    await chooseFile(JSON.stringify(v2File()), 'backup.json');
    await importJson();

    expect(screen.getByText(/1 profile/i)).toBeInTheDocument();
    expect(screen.getByText(/1 transactions/i)).toBeInTheDocument();
    expect(screen.queryByText(/document/i)).toBeNull();
  });

  it('finishes back on Settings', async () => {
    renderPage();
    await chooseFile(JSON.stringify(v2File()), 'backup.json');
    await importJson();

    const done = document.querySelector('.import-step-done') as HTMLElement;
    await userEvent.click(within(done).getByRole('button', { name: /Back to Settings/i }));
    expect(mockNavigate).toHaveBeenCalledWith({ to: '/settings' });
  });
});

describe('Export → Import round trip (MUT-158)', () => {
  it('restores what Settings → Export wrote, with every link intact', async () => {
    await db.businessProfiles.add(profile);
    await db.clients.add(client);
    await db.projects.add(project);
    await db.transactions.add(transaction);
    await db.documents.add(document_);
    await db.documentSequences.add(sequence);
    await db.fxRates.add(fxRate);

    let exported = '';
    vi.spyOn(csvUtils, 'downloadTextFile').mockImplementation((_name: string, content: string) => {
      exported = content;
    });
    const exportView = render(<ExportDataModal onClose={() => {}} />, { wrapper: TestWrapper });
    await screen.findByText('Test Business');
    await userEvent.click(screen.getByRole('button', { name: /JSON/i }));
    await userEvent.click(screen.getByRole('button', { name: /Export Test Business/i }));
    await waitFor(() => expect(exported).not.toBe(''));
    exportView.unmount();

    await clearAll();
    renderPage();
    await chooseFile(exported, 'backup.json');
    await importJson();

    const [p] = await db.businessProfiles.toArray();
    const [c] = await db.clients.toArray();
    const [pr] = await db.projects.toArray();
    const [tx] = await db.transactions.toArray();
    const [doc] = await db.documents.toArray();
    expect(p).toMatchObject({ name: 'Test Business', email: 'test@business.com' });
    expect(c).toMatchObject({ name: 'Test Client', profileId: p.id });
    expect(pr).toMatchObject({ name: 'Test Project', clientId: c.id, profileId: p.id });
    expect(tx).toMatchObject({ title: 'Test Transaction', amountMinor: 10000, currency: 'USD', clientId: c.id, projectId: pr.id, profileId: p.id });
    expect(doc).toMatchObject({ number: 'INV-001', totalMinor: 11800, businessProfileId: p.id, clientId: c.id, linkedTransactionIds: [tx.id] });
    expect((await db.fxRates.toArray())[0].rate).toBe(3.5);
  });
});
