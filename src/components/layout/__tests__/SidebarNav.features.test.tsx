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

let mockPathname = '/';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to, className, title, ...rest }: { children: ReactNode; to: string; className?: string; title?: string }) => (
    <a href={to} className={className} title={title} aria-current={(rest as { 'aria-current'?: 'page' })['aria-current']}>
      {children}
    </a>
  ),
  useLocation: () => ({ pathname: mockPathname }),
  useNavigate: () => vi.fn(),
}));

vi.mock('../../../lib/i18n', () => ({
  useT: () => (key: string) => key,
}));

vi.mock('../../../hooks/useCheckForUpdates', () => ({
  useCheckForUpdates: () => ({ hasUpdate: false }),
}));

vi.mock('../../../hooks/useProfileAwareAction', () => ({
  useProfileAwareAction: () => ({ trigger: vi.fn(), pickerProps: {} }),
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
  mockPathname = '/';
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

describe('SidebarNav insights, planning and projects (MUT-16)', () => {
  it('shows none of the three while all areas are off, and + Add has no Project', async () => {
    const fake = installFakeSettings();
    renderNav();
    await waitFor(() => expect(fake.settings.get).toHaveBeenCalled());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    expect(optionalHeader()).toBeNull();
    expect(screen.queryByText('nav.insights')).toBeNull();
    expect(screen.queryByText('nav.planning')).toBeNull();
    expect(screen.queryByText('nav.projects')).toBeNull();
    // the core sections are Home + Income and Clients
    expect(screen.getByText('nav.home')).toBeInTheDocument();
    expect(screen.getByText('nav.income')).toBeInTheDocument();
    expect(screen.getByText('nav.clients')).toBeInTheDocument();

    fireEvent.click(screen.getByText('nav.new'));
    expect(await screen.findByText('nav.newMenu.income')).toBeInTheDocument();
    expect(screen.queryByText('nav.newMenu.project')).toBeNull();
  });

  it('shows Projects in the optional section and offers it in + Add while projects is on', async () => {
    installFakeSettings({ features: { projects: true } });
    renderNav();

    const projects = await screen.findByText('nav.projects');
    expect(optionalHeader()).toBeInTheDocument();
    expect(projects.closest('a')).toHaveAttribute('href', '/projects');
    expect(screen.queryByText('nav.insights')).toBeNull();
    expect(screen.queryByText('nav.planning')).toBeNull();

    fireEvent.click(screen.getByText('nav.new'));
    expect(await screen.findByText('nav.newMenu.project')).toBeInTheDocument();
  });

  it('lists Insights then Planning after any earlier optional entry', async () => {
    installFakeSettings({ features: { retainers: true, insights: true, planning: true } });
    renderNav();

    const retainers = await screen.findByText('nav.retainers');
    const insights = await screen.findByText('nav.insights');
    const planning = await screen.findByText('nav.planning');
    expect(insights.closest('a')).toHaveAttribute('href', '/insights');
    expect(planning.closest('a')).toHaveAttribute('href', '/planning');
    expect(retainers.compareDocumentPosition(insights) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(insights.compareDocumentPosition(planning) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByText('nav.projects')).toBeNull();
  });
});

const ALL_ON = { invoices: true, retainers: true, expenses: true, insights: true, planning: true, projects: true };

/** The sidebar's destinations in DOM (and so Tab) order; label key, or `title` when collapsed. */
function navLinks(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll<HTMLAnchorElement>('a.nav-item')).map(
    (link) => link.querySelector('.nav-item-label')?.textContent ?? link.title,
  );
}

async function settled(fake: { settings: { get: ReturnType<typeof vi.fn> } }) {
  await waitFor(() => expect(fake.settings.get).toHaveBeenCalled());
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
}

describe('SidebarNav core shape (MUT-15)', () => {
  it('shows exactly Home, Clients, Income, Settings on a fresh install, with no core headers', async () => {
    const fake = installFakeSettings();
    const { container } = renderNav();
    await settled(fake);

    expect(navLinks(container)).toEqual(['nav.home', 'nav.clients', 'nav.income', 'nav.settings']);
    expect(screen.queryByText('nav.sections.main')).toBeNull();
    expect(screen.queryByText('nav.sections.workspace')).toBeNull();
    expect(optionalHeader()).toBeNull();
  });

  it('keeps the core three first and in order with every area on; More holds the rest; Settings last', async () => {
    installFakeSettings({ features: ALL_ON });
    const { container } = renderNav();
    await screen.findByText('nav.projects');

    expect(navLinks(container)).toEqual([
      'nav.home',
      'nav.clients',
      'nav.income',
      'nav.expenses',
      'nav.documents',
      'nav.retainers',
      'nav.insights',
      'nav.planning',
      'nav.projects',
      'nav.settings',
    ]);
    const more = optionalHeader()!.closest('.nav-section')!;
    expect(more.querySelectorAll('a.nav-item')).toHaveLength(6);
  });

  it('adds and removes an area below the core without re-creating the core entries', async () => {
    const fake = installFakeSettings();
    const { container, queryClient } = renderNav();
    await settled(fake);
    const coreBefore = Array.from(container.querySelectorAll('a.nav-item')).slice(0, 3);

    fake.set({ features: { expenses: true } });
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: ['settings'] });
    });
    expect(await screen.findByText('nav.expenses')).toBeInTheDocument();
    expect(Array.from(container.querySelectorAll('a.nav-item')).slice(0, 3)).toEqual(coreBefore);

    fake.set({ features: { expenses: false } });
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: ['settings'] });
    });
    await waitFor(() => expect(screen.queryByText('nav.expenses')).toBeNull());
    expect(optionalHeader()).toBeNull();
    const coreAfter = Array.from(container.querySelectorAll('a.nav-item')).slice(0, 3);
    coreAfter.forEach((link, index) => expect(link).toBe(coreBefore[index]));
  });

  it.each([
    ['all areas off', {}],
    ['all areas on', ALL_ON],
  ])('pins Settings in the footer with %s', async (_label, features) => {
    const fake = installFakeSettings({ features });
    const { container } = renderNav();
    await settled(fake);

    const settings = screen.getByText('nav.settings').closest('a')!;
    expect(container.querySelector('.sidebar-footer')).toContainElement(settings);
    expect(container.querySelector('.sidebar-nav')).not.toContainElement(settings);
  });
});

describe('SidebarNav active state (MUT-15)', () => {
  it.each([
    ['/', 'nav.home'],
    ['/clients', 'nav.clients'],
    ['/clients/c1', 'nav.clients'],
    ['/income', 'nav.income'],
    ['/expenses', 'nav.expenses'],
    ['/documents/d1/edit', 'nav.documents'],
    ['/retainers', 'nav.retainers'],
    ['/insights', 'nav.insights'],
    ['/planning', 'nav.planning'],
    ['/projects/p1', 'nav.projects'],
    ['/settings/profiles/p1', 'nav.settings'],
    ['/settings/import', 'nav.settings'],
  ])('on %s only %s is active', async (pathname, expected) => {
    mockPathname = pathname;
    installFakeSettings({ features: ALL_ON });
    const { container } = renderNav();
    await screen.findByText('nav.projects');

    const active = Array.from(container.querySelectorAll<HTMLAnchorElement>('a.nav-item.active'));
    expect(active).toHaveLength(1);
    expect(active[0]).toHaveTextContent(expected);
    expect(active[0]).toHaveAttribute('aria-current', 'page');
    expect(container.querySelectorAll('a.nav-item[aria-current="page"]')).toHaveLength(1);
  });

  it('marks nothing active on a page outside the nav', async () => {
    mockPathname = '/theme-demo';
    const fake = installFakeSettings();
    const { container } = renderNav();
    await settled(fake);
    expect(container.querySelectorAll('a.nav-item.active')).toHaveLength(0);
  });
});

describe('SidebarNav collapsed mode (MUT-15)', () => {
  it('keeps the four entries as icon links titled with their labels, and hides headers', async () => {
    window.localStorage.setItem('sidebarCollapsed', '1');
    const fake = installFakeSettings({ features: { expenses: true } });
    const { container } = renderNav();
    await settled(fake);

    expect(container.querySelector('.sidebar')).toHaveClass('collapsed');
    expect(container.querySelectorAll('.nav-item-label')).toHaveLength(0);
    expect(navLinks(container)).toEqual(['nav.home', 'nav.clients', 'nav.income', 'nav.expenses', 'nav.settings']);
    expect(container.querySelectorAll('.nav-section-header')).toHaveLength(0);
    expect(screen.getAllByLabelText('nav.expand').length).toBeGreaterThan(0);
  });

  it('collapses and expands from the toggle and remembers the choice', async () => {
    const fake = installFakeSettings();
    const { container } = renderNav();
    await settled(fake);

    fireEvent.click(screen.getByLabelText('nav.collapse'));
    expect(container.querySelector('.sidebar')).toHaveClass('collapsed');
    expect(window.localStorage.getItem('sidebarCollapsed')).toBe('1');
    expect(screen.queryByText('nav.home')).toBeNull();

    fireEvent.click(screen.getAllByLabelText('nav.expand')[0]);
    expect(container.querySelector('.sidebar')).not.toHaveClass('collapsed');
    expect(window.localStorage.getItem('sidebarCollapsed')).toBe('0');
    expect(screen.getByText('nav.home')).toBeInTheDocument();
  });
});

describe('SidebarNav + New menu (MUT-15)', () => {
  const menuItems = () => screen.getAllByRole('menuitem').map((item) => item.textContent);

  it('offers Add Income then Add Client while every area is off', async () => {
    const fake = installFakeSettings();
    renderNav();
    await settled(fake);

    fireEvent.click(screen.getByText('nav.new'));
    expect(menuItems()).toEqual(['nav.newMenu.income', 'nav.newMenu.client']);
  });

  it('appends Add Expense and Add Project, after the core two, while their areas are on', async () => {
    installFakeSettings({ features: { expenses: true, projects: true } });
    renderNav();
    await screen.findByText('nav.projects');

    fireEvent.click(screen.getByText('nav.new'));
    expect(menuItems()).toEqual([
      'nav.newMenu.income',
      'nav.newMenu.client',
      'nav.newMenu.expense',
      'nav.newMenu.project',
    ]);
  });

  it('is keyboard operable: opens on the first item, arrows move, Escape returns to the button', async () => {
    const fake = installFakeSettings();
    renderNav();
    await settled(fake);
    const button = screen.getByText('nav.new').closest('button')!;

    fireEvent.keyDown(button, { key: 'ArrowDown' });
    const [income, client] = screen.getAllByRole('menuitem');
    expect(income).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowDown' });
    expect(client).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(button).toHaveFocus();
  });
});
