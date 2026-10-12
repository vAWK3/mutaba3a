import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ReactNode } from 'react';
import { LanguageProvider } from '../../../lib/i18n';
import { DEFAULT_SETTINGS } from '../../../db/defaultSettings';
import { createMockBusinessProfile } from '../../../test/utils';
import en from '../../../lib/i18n/translations/en.json';

// Vite injects this at build time; the page reads it when the module loads
vi.hoisted(() => {
  (globalThis as Record<string, unknown>).__APP_VERSION__ = '0.0.0-test';
});

const profiles = [
  createMockBusinessProfile({ id: 'p-1', name: 'Acme Studio', isDefault: true }),
  createMockBusinessProfile({ id: 'p-2', name: 'Side Gig', isDefault: false }),
];

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  Link: ({ children }: { children: ReactNode }) => <a href="#">{children}</a>,
}));

vi.mock('../../../components/layout', () => ({
  TopBar: ({ title }: { title: string }) => <h1>{title}</h1>,
}));

vi.mock('../../../hooks/useQueries', () => ({
  useSettings: () => ({
    data: { ...DEFAULT_SETTINGS, enabledCurrencies: ['USD', 'ILS'], defaultCurrency: 'USD' },
    isLoading: false,
  }),
  useUpdateSettings: () => ({ mutate: vi.fn() }),
  useBusinessProfiles: () => ({ data: profiles }),
  useSetDefaultBusinessProfile: () => ({ mutate: vi.fn(), isPending: false }),
  useArchiveBusinessProfile: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock('../../../hooks/useCheckForUpdates', () => ({
  useCheckForUpdates: () => ({ latestVersion: null, hasUpdate: false, isLoading: false, error: null }),
}));

vi.mock('../../../lib/theme', () => ({
  useTheme: () => ({ theme: 'light', setTheme: vi.fn() }),
  THEME_MODES: ['light', 'dark', 'system'],
}));

vi.mock('../../../lib/stores', () => ({
  useDrawerStore: () => ({ openBusinessProfileDrawer: vi.fn() }),
}));

vi.mock('../../../components/modals', () => ({
  DeleteAllDataModal: () => null,
  ExportDataModal: () => null,
}));

// Sections with their own tests
vi.mock('../AdvancedFeaturesSection', () => ({ AdvancedFeaturesSection: () => null }));
vi.mock('../DataToolsSection', () => ({ DataToolsSection: () => null }));

import { SettingsPage } from '../SettingsPage';

function renderPage() {
  return render(
    <LanguageProvider>
      <SettingsPage />
    </LanguageProvider>,
  );
}

// TD-009: axe's select-name, button-name and heading-order fired on Settings
describe('SettingsPage accessibility', () => {
  it('names the default-currency select by its visible label and describes it', () => {
    renderPage();

    const select = screen.getByRole('combobox', { name: en.settings.currency.default });
    expect(select).toHaveAccessibleDescription(en.settings.currency.defaultDesc);
    // a real <label>, so the visible text names it wherever it is scrolled
    expect(screen.getByText(en.settings.currency.default).tagName).toBe('LABEL');
  });

  it("names each business profile's more button after the profile", () => {
    renderPage();

    expect(screen.getByRole('button', { name: 'Actions for Acme Studio' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Actions for Side Gig' })).toBeInTheDocument();
  });

  it('says whether the profile actions are open', () => {
    renderPage();

    const more = screen.getByRole('button', { name: 'Actions for Side Gig' });
    expect(more).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(more);
    expect(more).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: en.settings.profile.setDefault })).toBeInTheDocument();
  });

  it('puts every section title one level under the page title', () => {
    const { container } = renderPage();

    expect(screen.getByRole('heading', { level: 1, name: en.settings.title })).toBeInTheDocument();
    for (const title of [
      en.settings.language.title,
      en.settings.theme.title,
      en.settings.profile.title,
      en.settings.currency.title,
      en.settings.data.title,
      en.settings.about.title,
      en.settings.updates.title,
      en.settings.desktopApp.title,
    ]) {
      expect(screen.getByRole('heading', { level: 2, name: title })).toBeInTheDocument();
    }
    expect(screen.queryAllByRole('heading', { level: 3 })).toEqual([]);
    for (const title of container.querySelectorAll('.settings-section-title')) {
      expect(title.tagName).toBe('H2');
    }
  });
});
