import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders, screen } from '../../../test/utils';
import { db } from '../../../db/database';
import { ThemeProvider } from '../../../lib/theme';
import en from '../../../lib/i18n/translations/en';

/** MUT-187: the "Hosted account" row sits in Settings › Businesses, in the web build only. */

vi.hoisted(() => {
  (globalThis as Record<string, unknown>).__APP_VERSION__ = '0.0.0-test';
});
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => vi.fn() }));
vi.mock('../../../components/layout', () => ({ TopBar: ({ title }: { title: string }) => <h1>{title}</h1> }));
vi.mock('../../../hooks/useCheckForUpdates', () => ({
  useCheckForUpdates: () => ({ latestVersion: null, hasUpdate: false, isLoading: false, error: null }),
}));

const { SettingsPage } = await import('../SettingsPage');

const renderPage = async () => {
  renderWithProviders(<ThemeProvider><SettingsPage /></ThemeProvider>);
  await screen.findByRole('heading', { name: en.settings.profile.title });
};

beforeEach(async () => {
  localStorage.clear();
  await Promise.all(db.tables.map((t) => t.clear()));
});
afterEach(() => vi.unstubAllGlobals());

describe('Settings › Businesses: Hosted account row (MUT-187)', () => {
  it('shows the row inside the Businesses section in the web build', async () => {
    vi.stubGlobal('__BUILD_MODE__', 'web');
    await renderPage();

    const row = screen.getByText(en.settings.profile.hosted.title);
    const section = screen.getByRole('heading', { name: en.settings.profile.title }).closest('.settings-section');
    expect(section).toContainElement(row);
  });

  it('renders no row in the desktop build', async () => {
    vi.stubGlobal('__BUILD_MODE__', 'desktop');
    await renderPage();

    expect(screen.queryByText(en.settings.profile.hosted.title)).not.toBeInTheDocument();
  });
});
