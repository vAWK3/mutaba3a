import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
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

const { useSettingsMock, updateSettingsMutate, setThemeMock } = vi.hoisted(() => ({
  useSettingsMock: vi.fn(),
  updateSettingsMutate: vi.fn(),
  setThemeMock: vi.fn(),
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
  useTheme: () => ({ theme: 'light', setTheme: setThemeMock }),
  THEME_MODES: ['light', 'dark', 'system'],
}));

vi.mock('../../../lib/stores', () => ({
  useDrawerStore: () => ({ openBusinessProfileDrawer: vi.fn() }),
}));

vi.mock('../../../components/modals', () => ({
  DeleteAllDataModal: () => null,
}));

// Sections with their own tests render only their card and title here, so
// the page's order is observable without their hooks (MUT-88).
vi.mock('../AdvancedFeaturesSection', async () => {
  const { settings } = (await import('../../../lib/i18n/translations/en.json')).default;
  return { AdvancedFeaturesSection: () => <div className="settings-section"><h2 className="settings-section-title">{settings.features.title}</h2></div> };
});
vi.mock('../AboutSection', async () => {
  const { settings } = (await import('../../../lib/i18n/translations/en.json')).default;
  return { AboutSection: () => <div className="settings-section"><h2 className="settings-section-title">{settings.about.title}</h2></div> };
});
vi.mock('../YourDataSection', async () => {
  const { settings } = (await import('../../../lib/i18n/translations/en.json')).default;
  return { YourDataSection: () => <div className="settings-section"><h2 className="settings-section-title">{settings.yourData.title}</h2></div> };
});

import { SettingsPage } from '../SettingsPage';

function renderPage() {
  return render(
    <LanguageProvider>
      <SettingsPage />
    </LanguageProvider>,
  );
}

beforeEach(() => {
  // The language test below exercises the real LanguageProvider (it persists
  // to localStorage), so every test starts from a clean, English default.
  localStorage.removeItem('mutaba3a-language');
  updateSettingsMutate.mockClear();
  setThemeMock.mockClear();
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
      en.settings.preferences.title,
      en.settings.features.title,
      en.settings.about.title,
      en.settings.yourData.title,
    ]) {
      expect(screen.getByRole('heading', { level: 2, name: title })).toBeInTheDocument();
    }
    expect(screen.queryAllByRole('heading', { level: 3 })).toEqual([]);
    for (const title of container.querySelectorAll('.settings-section-title')) {
      expect(title.tagName).toBe('H2');
    }
  });

  // MUT-88 (ADR-071) replaces MUT-139's "Business Profiles first, Data last":
  // Businesses, General, Features, About, Your data, then Delete all data
  // alone, outside every card.
  it('orders the sections Businesses, General, Features, About, Your data', () => {
    const { container } = renderPage();

    const titles = Array.from(container.querySelectorAll('.settings-section-title')).map((el) => el.textContent);
    expect(titles).toEqual([
      en.settings.profile.title,
      en.settings.preferences.title,
      en.settings.features.title,
      en.settings.about.title,
      en.settings.yourData.title,
    ]);
  });

  it('sets Delete all data apart: last on the page and outside every card', () => {
    const { container } = renderPage();

    const zone = screen.getByRole('region', { name: en.settings.yourData.deleteZoneLabel });
    const sections = container.querySelectorAll('.settings-section');
    expect(zone.closest('.settings-section')).toBeNull();
    expect(sections[sections.length - 1].compareDocumentPosition(zone) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getAllByRole('button', { name: en.settings.data.deleteAllBtn })).toHaveLength(1);
  });

  it('keeps one scroll area: every section inside the column, and the scroller itself uncapped', () => {
    const { container } = renderPage();

    const scroller = container.querySelector('.page-content') as HTMLElement;
    const column = scroller.querySelector('.settings-column') as HTMLElement;
    expect(scroller.style.maxWidth).toBe('');
    for (const section of container.querySelectorAll('.settings-section, .settings-danger-zone')) {
      expect(column.contains(section)).toBe(true);
    }
  });

  it('carries no Sync row: device sync is retired (MUT-73)', () => {
    const { container } = renderPage();
    expect(container.textContent).not.toMatch(/\bsync/i);
  });

  it('keeps Language, Theme and Currency as plain text inside the General card', () => {
    renderPage();

    expect(screen.getByText(en.settings.preferences.description)).toBeInTheDocument();
    expect(screen.getByText(en.settings.language.title)).toBeInTheDocument();
    expect(screen.getByText(en.settings.theme.title)).toBeInTheDocument();
    // The "Currency" subdivider is plain text, not a heading (no h3 allowed).
    const subdivider = screen.getByText(en.settings.currency.title);
    expect(subdivider.tagName).not.toBe('H2');
    expect(subdivider.tagName).not.toBe('H3');
  });

  it('switches theme through its segmented control', () => {
    renderPage();

    const themeGroup = screen.getByRole('radiogroup', { name: en.settings.theme.title });
    fireEvent.click(within(themeGroup).getByRole('radio', { name: en.settings.theme.dark }));

    expect(setThemeMock).toHaveBeenCalledWith('dark');
  });

  it('switches language through its segmented control (real LanguageProvider)', () => {
    renderPage();

    const languageGroup = screen.getByRole('radiogroup', { name: en.settings.language.title });
    expect(within(languageGroup).getByRole('radio', { name: 'English' })).toHaveAttribute('aria-checked', 'true');

    fireEvent.click(within(languageGroup).getByRole('radio', { name: 'العربية' }));

    expect(within(languageGroup).getByRole('radio', { name: 'العربية' })).toHaveAttribute('aria-checked', 'true');
    expect(within(languageGroup).getByRole('radio', { name: 'English' })).toHaveAttribute('aria-checked', 'false');
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
