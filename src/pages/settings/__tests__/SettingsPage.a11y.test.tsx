import { describe, it, expect, vi, beforeEach } from 'vitest';
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

const { useSettingsMock, updateSettingsMutate } = vi.hoisted(() => ({
  useSettingsMock: vi.fn(),
  updateSettingsMutate: vi.fn(),
}));

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  Link: ({ children }: { children: ReactNode }) => <a href="#">{children}</a>,
}));

vi.mock('../../../components/layout', () => ({
  TopBar: ({ title }: { title: string }) => <h1>{title}</h1>,
}));

vi.mock('../../../hooks/useQueries', () => ({
  useSettings: useSettingsMock,
  useUpdateSettings: () => ({ mutate: updateSettingsMutate }),
  useBusinessProfiles: () => ({ data: profiles }),
  useSetDefaultBusinessProfile: () => ({ mutate: vi.fn(), isPending: false }),
  useArchiveBusinessProfile: () => ({ mutate: vi.fn(), isPending: false }),
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
vi.mock('../AboutSection', () => ({ AboutSection: () => null }));

import { SettingsPage } from '../SettingsPage';

function renderPage() {
  return render(
    <LanguageProvider>
      <SettingsPage />
    </LanguageProvider>,
  );
}

beforeEach(() => {
  updateSettingsMutate.mockClear();
  useSettingsMock.mockReset();
  useSettingsMock.mockReturnValue({
    data: { ...DEFAULT_SETTINGS, enabledCurrencies: ['USD', 'ILS'], defaultCurrency: 'USD' },
    isLoading: false,
  });
});

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
      en.settings.profile.title,
      en.settings.language.title,
      en.settings.theme.title,
      en.settings.currency.title,
      en.settings.data.title,
    ]) {
      expect(screen.getByRole('heading', { level: 2, name: title })).toBeInTheDocument();
    }
    expect(screen.queryAllByRole('heading', { level: 3 })).toEqual([]);
    for (const title of container.querySelectorAll('.settings-section-title')) {
      expect(title.tagName).toBe('H2');
    }
  });

  it('puts Business Profiles first and Data last, among the sections rendered inline', () => {
    // Advanced Features, About and Data Tools are mocked to null here (they
    // have their own placement/heading tests) so only these five sections'
    // h2s are observable in this render.
    const { container } = renderPage();

    const titles = Array.from(container.querySelectorAll('.settings-section-title')).map((el) => el.textContent);
    expect(titles).toEqual([
      en.settings.profile.title,
      en.settings.language.title,
      en.settings.theme.title,
      en.settings.currency.title,
      en.settings.data.title,
    ]);
  });

  describe('enabled currencies', () => {
    it('toggles a currency off and updates enabledCurrencies', () => {
      renderPage();

      fireEvent.click(screen.getByRole('button', { name: 'ILS' }));

      expect(updateSettingsMutate).toHaveBeenCalledWith({ enabledCurrencies: ['USD'] });
    });

    it('toggles a disabled currency back on', () => {
      useSettingsMock.mockReturnValue({
        data: { ...DEFAULT_SETTINGS, enabledCurrencies: ['USD'], defaultCurrency: 'USD' },
        isLoading: false,
      });
      renderPage();

      fireEvent.click(screen.getByRole('button', { name: 'ILS' }));

      expect(updateSettingsMutate).toHaveBeenCalledWith({ enabledCurrencies: ['USD', 'ILS'] });
    });

    it('refuses to disable the last remaining currency', () => {
      useSettingsMock.mockReturnValue({
        data: { ...DEFAULT_SETTINGS, enabledCurrencies: ['USD'], defaultCurrency: 'USD' },
        isLoading: false,
      });
      renderPage();

      fireEvent.click(screen.getByRole('button', { name: 'USD' }));

      expect(updateSettingsMutate).not.toHaveBeenCalled();
    });
  });
});
