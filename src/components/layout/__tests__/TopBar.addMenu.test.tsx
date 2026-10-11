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
import { TopBar } from '../TopBar';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to }: { children: ReactNode; to: string }) => <a href={to}>{children}</a>,
}));

vi.mock('../../../lib/i18n', () => ({
  useT: () => (key: string) => key,
  useDirection: () => 'ltr',
}));

const trigger = vi.fn();
vi.mock('../../../hooks/useProfileAwareAction', () => ({
  useProfileAwareAction: () => ({ trigger, pickerProps: {} }),
}));

vi.mock('../../../hooks/useActiveProfile', () => ({
  useActiveProfile: () => ({ activeProfile: null, profiles: [] }),
}));

vi.mock('../../ui/ProfileQuickPicker', () => ({ ProfileQuickPicker: () => null }));

function installFakeSettings(initial: Partial<Settings> = {}) {
  const row: Settings = { ...DEFAULT_SETTINGS, ...initial };
  const settings = { get: vi.fn(async () => ({ ...row })), update: vi.fn(async () => {}) };
  const real = getRepositories();
  setRepositories({ ...real, base: { ...real.base, settings } } as Repositories);
  return settings;
}

async function renderTopBar(props: { hideAddMenu?: boolean } = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(
    <QueryClientProvider client={queryClient}>
      <TopBar title="Page" {...props} />
    </QueryClientProvider>,
  );
  if (props.hideAddMenu) return;
  await waitFor(() => expect(queryClient.getQueryState(['settings'])?.status).toBe('success'));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

const addButton = () => screen.getByRole('button', { name: /common\.add/ });
const menuItems = () => screen.getAllByRole('menuitem').map((item) => item.textContent);

afterEach(() => {
  resetRepositories();
  trigger.mockClear();
});

describe('TopBar Add menu (MUT-15)', () => {
  it('offers Income then Client while every area is off', async () => {
    installFakeSettings();
    await renderTopBar();

    fireEvent.click(addButton());
    expect(menuItems()).toEqual(['addMenu.income', 'addMenu.client']);
  });

  it('appends Expense and Project after the core two while their areas are on', async () => {
    installFakeSettings({ features: { expenses: true, projects: true } });
    await renderTopBar();

    fireEvent.click(addButton());
    expect(menuItems()).toEqual(['addMenu.income', 'addMenu.client', 'addMenu.expense', 'addMenu.project']);
  });

  it('runs the picked action and closes', async () => {
    installFakeSettings();
    await renderTopBar();

    fireEvent.click(addButton());
    fireEvent.click(screen.getByRole('menuitem', { name: /addMenu\.client/ }));
    expect(trigger).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('is keyboard operable: opens on the first item, arrows move, Escape returns to the button', async () => {
    installFakeSettings();
    await renderTopBar();

    fireEvent.keyDown(addButton(), { key: 'ArrowDown' });
    const [income, client] = screen.getAllByRole('menuitem');
    expect(income).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'End' });
    expect(client).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(addButton()).toHaveFocus();
  });

  it('renders no Add button when the page hides it', async () => {
    installFakeSettings();
    await renderTopBar({ hideAddMenu: true });
    expect(screen.queryByRole('button', { name: /common\.add/ })).toBeNull();
  });
});
