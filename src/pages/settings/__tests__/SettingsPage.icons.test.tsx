import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderWithProviders, screen } from '../../../test/utils';
import { db } from '../../../db/database';
import { ThemeProvider } from '../../../lib/theme';
import en from '../../../lib/i18n/translations/en';

/**
 * MUT-336 pilot: the codegen'd `LanguageIcon` (assets/icons/source/language.svg
 * -> src/components/icons/generated/LanguageIcon.tsx) renders statically next
 * to the language setting, proving the generate-icons.ts pipeline end to end
 * (AC #3). Not a migration of any other call site.
 */

vi.hoisted(() => {
  (globalThis as Record<string, unknown>).__APP_VERSION__ = '0.0.0-test';
});
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => vi.fn() }));
vi.mock('../../../components/layout', () => ({ TopBar: ({ title }: { title: string }) => <h1>{title}</h1> }));
vi.mock('../../../hooks/useCheckForUpdates', () => ({
  useCheckForUpdates: () => ({ latestVersion: null, hasUpdate: false, isLoading: false, error: null }),
}));

const { SettingsPage } = await import('../SettingsPage');

beforeEach(async () => {
  localStorage.clear();
  await Promise.all(db.tables.map((t) => t.clear()));
});

describe('Settings page: generated icon pilot', () => {
  it('renders the generated LanguageIcon next to the language setting', async () => {
    renderWithProviders(<ThemeProvider><SettingsPage /></ThemeProvider>);
    const label = await screen.findByText(en.settings.language.title);

    const icon = label.querySelector('svg circle[data-part="nuqta"]');
    expect(icon).not.toBeNull();
  });
});
