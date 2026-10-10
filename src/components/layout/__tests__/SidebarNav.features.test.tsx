/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { getRepositories, setRepositories, resetRepositories, type Repositories } from '../../../db/provider';
import { DEFAULT_SETTINGS } from '../../../db/defaultSettings';
import type { Settings } from '../../../types';
import { SidebarNav } from '../SidebarNav';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to, className, title }: { children: ReactNode; to: string; className?: string; title?: string }) => (
    <a href={to} className={className} title={title}>
      {children}
    </a>
  ),
  useLocation: () => ({ pathname: '/' }),
  useNavigate: () => vi.fn(),
}));

vi.mock('../../../lib/i18n', () => ({
  useT: () => (key: string) => key,
}));

vi.mock('../../../hooks/useCheckForUpdates', () => ({
  useCheckForUpdates: () => ({ hasUpdate: false }),
}));

vi.mock('../../../hooks/useProfileAwareAction', () => ({
  useProfileAwareAction: () => ({ execute: (fn: () => void) => fn(), showPicker: false, closePicker: vi.fn(), onPick: vi.fn() }),
}));

vi.mock('../ProfileSwitcher', () => ({ ProfileSwitcher: () => null }));
vi.mock('../../ui/ProfileQuickPicker', () => ({ ProfileQuickPicker: () => null }));

function installFakeSettings(initial: Partial<Settings> = {}) {
  let row: Settings = { ...DEFAULT_SETTINGS, ...initial };
  const settings = {
    get: vi.fn(async () => ({ ...row })),
    update: vi.fn(async (data: Partial<Settings>) => {
      row = { ...row, ...data, id: 'default' };
    }),
  };
  const real = getRepositories();
  setRepositories({ ...real, base: { ...real.base, settings } } as Repositories);
  return { settings, set: (next: Partial<Settings>) => { row = { ...row, ...next }; } };
}

function renderNav() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <SidebarNav />
    </QueryClientProvider>,
  );
  return { ...view, queryClient };
}

afterEach(() => {
  resetRepositories();
  window.localStorage.clear();
});

const optionalHeader = () => screen.queryByText('nav.sections.optional');

describe('SidebarNav optional areas (MUT-13)', () => {
  it('shows no optional section and no Documents/Retainers links while both areas are off', async () => {
    const fake = installFakeSettings();
    renderNav();
    await waitFor(() => expect(fake.settings.get).toHaveBeenCalled());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    expect(optionalHeader()).toBeNull();
    expect(screen.queryByText('nav.documents')).toBeNull();
    expect(screen.queryByText('nav.retainers')).toBeNull();
    // MUT-14: Expenses left the main section and Suppliers left workspace
    expect(screen.queryByText('nav.expenses')).toBeNull();
    expect(screen.queryByText('nav.suppliers')).toBeNull();
    // core nav untouched
    expect(screen.getByText('nav.home')).toBeInTheDocument();
    expect(screen.getByText('nav.clients')).toBeInTheDocument();
    expect(screen.getByText('nav.settings')).toBeInTheDocument();
  });

  it('shows only Documents when invoices is on', async () => {
    installFakeSettings({ features: { invoices: true } });
    renderNav();

    expect(await screen.findByText('nav.documents')).toBeInTheDocument();
    expect(optionalHeader()).toBeInTheDocument();
    expect(screen.queryByText('nav.retainers')).toBeNull();
    expect(screen.getByText('nav.documents').closest('a')).toHaveAttribute('href', '/documents');
  });

  it('shows Documents then Retainers when both are on', async () => {
    installFakeSettings({ features: { invoices: true, retainers: true } });
    renderNav();

    const docs = await screen.findByText('nav.documents');
    const ret = await screen.findByText('nav.retainers');
    expect(ret.closest('a')).toHaveAttribute('href', '/retainers');
    // order: Documents before Retainers
    expect(docs.compareDocumentPosition(ret) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('shows Expenses in the optional section, before Documents, and offers it in + Add only while on (MUT-14)', async () => {
    installFakeSettings({ features: { expenses: true, invoices: true } });
    renderNav();

    const expenses = await screen.findByText('nav.expenses');
    const docs = await screen.findByText('nav.documents');
    expect(expenses.closest('a')).toHaveAttribute('href', '/expenses');
    expect(expenses.compareDocumentPosition(docs) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    fireEvent.click(screen.getByText('nav.new'));
    expect(await screen.findByText('nav.newMenu.expense')).toBeInTheDocument();
  });

  it('hides the + Add → Expense item while expenses is off', async () => {
    const fake = installFakeSettings();
    renderNav();
    await waitFor(() => expect(fake.settings.get).toHaveBeenCalled());

    fireEvent.click(screen.getByText('nav.new'));
    expect(await screen.findByText('nav.newMenu.income')).toBeInTheDocument();
    expect(screen.queryByText('nav.newMenu.expense')).toBeNull();
  });

  it('adds an entry without a remount when the area is switched on', async () => {
    const fake = installFakeSettings();
    const { queryClient } = renderNav();
    await waitFor(() => expect(fake.settings.get).toHaveBeenCalled());
    expect(screen.queryByText('nav.retainers')).toBeNull();

    fake.set({ features: { retainers: true } });
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: ['settings'] });
    });

    expect(await screen.findByText('nav.retainers')).toBeInTheDocument();
    expect(screen.queryByText('nav.documents')).toBeNull();
  });
});
