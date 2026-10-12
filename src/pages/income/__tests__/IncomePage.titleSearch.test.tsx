/**
 * MUT-62 AC3: searching /income by a word in an entry's title finds it.
 *
 * The search already matched titles in `transactionRepo.list`; this pins the
 * whole path on real Dexie (fake-indexeddb) and the real `useIncome`: the URL
 * model's `q` → `resolveIncomeFilters` → the query → the repository → the row.
 * Only the router is stood in for, as in IncomePage.test.tsx (MUT-83).
 */
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import userEvent from '@testing-library/user-event';
import { renderWithProviders, screen, waitFor, within } from '../../../test/utils';
import { db } from '../../../db/database';
import { getDateRangePreset } from '../../../lib/utils';
import type { IncomeSearch } from '../../../lib/incomeSearch';
import type { Client, Transaction } from '../../../types';
import en from '../../../lib/i18n/translations/en.json';
import { IncomePage } from '../IncomePage';

const PROFILE = 'p-1';
const STAMP = '2026-10-01T00:00:00.000Z';
const ALL_TIME = getDateRangePreset('all');

const urlFilters = vi.hoisted(() => ({
  initial: {} as Record<string, unknown>,
  writes: [] as Record<string, unknown>[],
}));
vi.mock('../../../hooks/useIncomeFilters', async () => {
  const { useState, useCallback } = await import('react');
  const { mergeIncomeSearch } = await import('../../../lib/incomeSearch');
  return {
    useIncomeFilters: () => {
      const [search, setState] = useState<IncomeSearch>(() => urlFilters.initial as IncomeSearch);
      const setSearch = useCallback((patch: Partial<IncomeSearch>) => {
        urlFilters.writes.push(patch);
        setState((prev) => mergeIncomeSearch(prev, patch));
      }, []);
      return { search, setSearch };
    },
  };
});

vi.mock('../../../hooks/useActiveProfile', () => ({
  useProfileFilter: () => PROFILE,
  useActiveProfile: () => ({ activeProfileId: PROFILE, setActiveProfile: vi.fn(), profilesLoading: false }),
}));

// The top bar (FX readout, + Add menu) is not under test here
vi.mock('../../../components/layout', () => ({ TopBar: () => null }));

function client(id: string, name: string): Client {
  return { id, name, profileId: PROFILE, createdAt: STAMP, updatedAt: STAMP };
}

function income(id: string, title: string | undefined, clientId: string, occurredAt = '2026-09-15'): Transaction {
  return {
    id,
    kind: 'income',
    status: 'unpaid',
    title,
    amountMinor: 30000,
    currency: 'USD',
    clientId,
    occurredAt,
    profileId: PROFILE,
    createdAt: STAMP,
    updatedAt: STAMP,
  };
}

async function seed() {
  await db.clients.bulkAdd([client('c-acme', 'Acme Studio'), client('c-cafe', 'مقهى الياسمين')]);
  await db.transactions.bulkAdd([
    income('tx-logo', 'Logo redesign for the autumn launch', 'c-acme'),
    income('tx-audit', 'Site audit', 'c-acme'),
    income('tx-brand', 'هوية بصرية كاملة', 'c-cafe'),
    income('tx-legacy', undefined, 'c-acme'),
  ]);
}

async function clearTables() {
  await Promise.all([db.clients.clear(), db.transactions.clear()]);
}

const bodyRows = () => screen.getAllByRole('row').slice(1);
const workCells = () => bodyRows().map((row) => within(row).getAllByRole('cell')[1].textContent);

describe('IncomePage search by title, through the URL filter model (MUT-62)', () => {
  beforeEach(async () => {
    urlFilters.initial = {};
    urlFilters.writes = [];
    await clearTables();
    await seed();
  });

  afterAll(clearTables);

  it('opens a link carrying one word of a title on just that entry', async () => {
    urlFilters.initial = { q: 'autumn', ...ALL_TIME };
    renderWithProviders(<IncomePage />);

    await screen.findByRole('button', { name: 'Logo redesign for the autumn launch' });
    expect(workCells()).toEqual(['Logo redesign for the autumn launch']);
  });

  it('narrows the list as a title word is typed, writing it to the URL model', async () => {
    const user = userEvent.setup();
    urlFilters.initial = { ...ALL_TIME };
    renderWithProviders(<IncomePage />);
    await waitFor(() => expect(bodyRows()).toHaveLength(4));

    await user.type(screen.getByPlaceholderText(en.transactions.searchPlaceholder), 'AUDIT');

    await waitFor(() => expect(workCells()).toEqual(['Site audit']));
    expect(urlFilters.writes).toContainEqual({ q: 'AUDIT' });
  });

  it('finds an Arabic title by an Arabic word', async () => {
    urlFilters.initial = { q: 'بصرية', ...ALL_TIME };
    renderWithProviders(<IncomePage />);

    await screen.findByRole('button', { name: 'هوية بصرية كاملة' });
    expect(workCells()).toEqual(['هوية بصرية كاملة']);
  });

  it('still finds entries by client name, untitled ones included', async () => {
    urlFilters.initial = { q: 'Acme', ...ALL_TIME };
    renderWithProviders(<IncomePage />);

    await waitFor(() => expect(bodyRows()).toHaveLength(3));
    expect(workCells()).toContain('—');
  });
});
