import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { renderWithProviders, screen, waitFor, within, createMockBusinessProfile } from '../../../test/utils';
import { db } from '../../../db/database';
import { useDrawerStore } from '../../../lib/stores';
import { useToastStore } from '../../../lib/toastStore';
import en from '../../../lib/i18n/translations/en.json';
import ar from '../../../lib/i18n/translations/ar.json';
import type { BusinessProfile, Client, Expense, Project, Transaction } from '../../../types';
import { OrphanedRecordsDrawer } from '../OrphanedRecordsDrawer';

const STAMP = '2026-10-01T00:00:00.000Z';
const LANGUAGE_KEY = 'mutaba3a-language';

type Dict = Record<string, unknown>;

function profile(id: string, name: string, isDefault = false): BusinessProfile {
  return createMockBusinessProfile({ id, name, isDefault, archivedAt: undefined });
}

function client(id: string, name: string, profileId?: string): Client {
  return { id, name, profileId, createdAt: STAMP, updatedAt: STAMP };
}

function project(id: string, name: string, overrides: Partial<Project> = {}): Project {
  return { id, name, createdAt: STAMP, updatedAt: STAMP, ...overrides };
}

function income(id: string, overrides: Partial<Transaction> = {}): Transaction {
  return {
    id,
    kind: 'income',
    status: 'unpaid',
    amountMinor: 10000,
    currency: 'USD',
    occurredAt: '2026-10-01',
    createdAt: STAMP,
    updatedAt: STAMP,
    ...overrides,
  };
}

function expense(id: string, overrides: Partial<Expense> = {}): Expense {
  return {
    id,
    amountMinor: 5000,
    currency: 'ILS',
    occurredAt: '2026-10-02',
    createdAt: STAMP,
    updatedAt: STAMP,
    ...overrides,
  } as Expense;
}

async function clearTables() {
  await Promise.all([
    db.clients.clear(),
    db.projects.clear(),
    db.transactions.clear(),
    db.expenses.clear(),
    db.businessProfiles.clear(),
  ]);
}

/** One unassigned record of each kind; the income and the project belong to an assigned client. */
async function seedOneOfEach(clientProfileId: string) {
  await db.clients.bulkAdd([client('c-orphan', 'Orphan Client'), client('c-owned', 'Owned Client', clientProfileId)]);
  await db.projects.add(project('pr-orphan', 'Orphan Project', { clientId: 'c-owned' }));
  await db.transactions.add(income('tx-orphan', { title: 'Logo design', clientId: 'c-owned' }));
  await db.expenses.add(expense('ex-orphan', { title: 'Hosting' }));
}

async function profileOf(table: 'clients' | 'projects' | 'transactions' | 'expenses', id: string) {
  const row = await db.table(table).get(id);
  return (row as { profileId?: string } | undefined)?.profileId;
}

function openDrawer() {
  useDrawerStore.getState().openOrphanedRecordsDrawer();
  return renderWithProviders(<OrphanedRecordsDrawer />);
}

function isOpen() {
  return useDrawerStore.getState().orphanedRecordsDrawer.isOpen;
}

beforeEach(async () => {
  localStorage.clear();
  localStorage.setItem(LANGUAGE_KEY, 'en');
  useDrawerStore.getState().closeOrphanedRecordsDrawer();
  useToastStore.setState({ toasts: [] });
  await clearTables();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await clearTables();
});

describe('drawer store', () => {
  it('opens and closes the unassigned-records drawer', () => {
    expect(isOpen()).toBe(false);
    useDrawerStore.getState().openOrphanedRecordsDrawer();
    expect(isOpen()).toBe(true);
    useDrawerStore.getState().closeOrphanedRecordsDrawer();
    expect(isOpen()).toBe(false);
  });
});

describe('OrphanedRecordsDrawer', () => {
  it('groups the unassigned records by kind with counts and hides empty groups', async () => {
    await db.businessProfiles.add(profile('p-main', 'Main', true));
    await db.clients.bulkAdd([client('c-1', 'Acme'), client('c-2', 'Beta')]);
    await db.transactions.add(income('tx-1', { clientId: 'c-1' }));

    openDrawer();

    expect(await screen.findByRole('heading', { name: 'Clients (2)' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Income (1)' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /^Projects/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /^Expenses/ })).not.toBeInTheDocument();
    expect(screen.getByText('Beta')).toBeInTheDocument();
    // An income entry without a title is named after its client, with its date and amount
    const incomeRow = screen.getByTestId('orphan-row-tx-1');
    expect(incomeRow).toHaveTextContent('Acme');
    expect(incomeRow).toHaveTextContent('Oct 1, 2026');
    expect(incomeRow).toHaveTextContent('$100');
  });

  describe('with one profile', () => {
    it('lists rows without pickers and assigns everything to that profile', async () => {
      await db.businessProfiles.add(profile('p-main', 'Main', true));
      await seedOneOfEach('p-main');
      const user = userEvent.setup();

      openDrawer();

      await screen.findByText('Orphan Client');
      expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Assign all to Main' }));

      await waitFor(() => expect(isOpen()).toBe(false));
      expect(await profileOf('clients', 'c-orphan')).toBe('p-main');
      expect(await profileOf('projects', 'pr-orphan')).toBe('p-main');
      expect(await profileOf('transactions', 'tx-orphan')).toBe('p-main');
      expect(await profileOf('expenses', 'ex-orphan')).toBe('p-main');
      expect(useToastStore.getState().toasts.map((t) => t.message)).toContain('4 records assigned.');
    });
  });

  describe('with several profiles', () => {
    beforeEach(async () => {
      await db.businessProfiles.bulkAdd([profile('p-main', 'Main', true), profile('p-side', 'Side')]);
      await seedOneOfEach('p-side');
    });

    it("starts each row on its linked client's profile, else the default", async () => {
      openDrawer();

      expect(await screen.findByRole('combobox', { name: 'Profile for Orphan Client' })).toHaveValue('p-main');
      expect(screen.getByRole('combobox', { name: 'Profile for Orphan Project' })).toHaveValue('p-side');
      expect(screen.getByRole('combobox', { name: 'Profile for Logo design' })).toHaveValue('p-side');
      expect(screen.getByRole('combobox', { name: 'Profile for Hosting' })).toHaveValue('p-main');
    });

    it("saves each row's own choice", async () => {
      const user = userEvent.setup();
      openDrawer();

      const clientPicker = await screen.findByRole('combobox', { name: 'Profile for Orphan Client' });
      await user.selectOptions(clientPicker, 'p-side');
      await user.click(screen.getByRole('button', { name: 'Save' }));

      await waitFor(() => expect(isOpen()).toBe(false));
      expect(await profileOf('clients', 'c-orphan')).toBe('p-side');
      expect(await profileOf('projects', 'pr-orphan')).toBe('p-side');
      expect(await profileOf('transactions', 'tx-orphan')).toBe('p-side');
      expect(await profileOf('expenses', 'ex-orphan')).toBe('p-main');
    });

    it('assigns everything to the default profile from the quick action, ignoring the pickers', async () => {
      const user = userEvent.setup();
      openDrawer();

      await user.click(await screen.findByRole('button', { name: 'Assign all to Main' }));

      await waitFor(() => expect(isOpen()).toBe(false));
      for (const [table, id] of [
        ['clients', 'c-orphan'],
        ['projects', 'pr-orphan'],
        ['transactions', 'tx-orphan'],
        ['expenses', 'ex-orphan'],
      ] as const) {
        expect(await profileOf(table, id), `${table}:${id}`).toBe('p-main');
      }
    });
  });

  it('saves the other rows and keeps a locked income entry listed when it cannot be assigned', async () => {
    await db.businessProfiles.add(profile('p-main', 'Main', true));
    await db.clients.add(client('c-orphan', 'Orphan Client'));
    await db.transactions.add(
      income('tx-locked', { title: 'Invoiced work', lockedAt: STAMP, lockedByDocumentId: 'doc-1' }),
    );
    const user = userEvent.setup();
    vi.spyOn(console, 'error').mockImplementation(() => {});

    openDrawer();
    await user.click(await screen.findByRole('button', { name: 'Assign all to Main' }));

    expect(await screen.findByRole('alert')).toHaveTextContent("1 record couldn't be assigned.");
    expect(isOpen()).toBe(true);
    expect(await profileOf('clients', 'c-orphan')).toBe('p-main');
    expect(await profileOf('transactions', 'tx-locked')).toBeUndefined();
    await waitFor(() => expect(screen.queryByText('Orphan Client')).not.toBeInTheDocument());
    expect(screen.getByText('Invoiced work')).toBeInTheDocument();
  });

  it('asks for a business profile first when there is none', async () => {
    await db.clients.add(client('c-orphan', 'Orphan Client'));

    openDrawer();

    expect(await screen.findByText('Add a business profile first, then assign these records to it.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Assign all/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
  });

  it('says so when nothing is left to assign', async () => {
    await db.businessProfiles.add(profile('p-main', 'Main', true));

    openDrawer();

    expect(await screen.findByText('Every record belongs to a profile.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Assign all/ })).not.toBeInTheDocument();
  });

  it('closes on Cancel without writing anything', async () => {
    await db.businessProfiles.add(profile('p-main', 'Main', true));
    await db.clients.add(client('c-orphan', 'Orphan Client'));
    const user = userEvent.setup();

    openDrawer();
    await screen.findByText('Orphan Client');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(isOpen()).toBe(false);
    expect(await profileOf('clients', 'c-orphan')).toBeUndefined();
  });

  it('renders Arabic copy, not i18n keys', async () => {
    localStorage.setItem(LANGUAGE_KEY, 'ar');
    await db.businessProfiles.add(profile('p-main', 'الرئيسي', true));
    await db.clients.add(client('c-orphan', 'عميل'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const copy = (ar as Dict).orphanedRecords as Record<string, string>;

    openDrawer();

    await screen.findByText('عميل');
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent(copy.title);
    expect(within(dialog).getByRole('button', { name: copy.assignAllTo.replace('{profile}', 'الرئيسي') })).toBeInTheDocument();
    expect(dialog.textContent).not.toMatch(/orphanedRecords\.|\{count\}|\{profile\}/);
    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('Translation missing'));
  });
});

describe('orphanedRecords copy', () => {
  function keys(value: unknown, prefix = ''): string[] {
    if (typeof value !== 'object' || value === null) return [prefix];
    return Object.entries(value as Dict).flatMap(([k, v]) => keys(v, prefix ? `${prefix}.${k}` : k));
  }

  it('has the same keys in en and ar', () => {
    expect(keys((ar as Dict).orphanedRecords).sort()).toEqual(keys((en as Dict).orphanedRecords).sort());
  });

  it.each([
    ['en', en as Dict],
    ['ar', ar as Dict],
  ])('%s carries the placeholders the drawer fills', (_name, locale) => {
    const copy = locale.orphanedRecords as Dict;
    const groups = copy.groups as Record<string, string>;
    expect(String(copy.assignAllTo)).toContain('{profile}');
    expect(String(copy.profileFor)).toContain('{record}');
    expect(String(copy.assignedPlural)).toContain('{count}');
    expect(String(copy.partialFailurePlural)).toContain('{count}');
    for (const group of ['clients', 'projects', 'transactions', 'expenses']) {
      expect(groups[group], group).toContain('{count}');
    }
  });
});
