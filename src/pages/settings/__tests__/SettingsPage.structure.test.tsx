import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderWithProviders, screen } from '../../../test/utils';
import { db } from '../../../db/database';
import { ThemeProvider } from '../../../lib/theme';
import en from '../../../lib/i18n/translations/en.json';

/**
 * MUT-88 (ADR-072), AC "each action exists exactly once": the whole Settings
 * page, with its real sections, offers every data action once. Before, Export
 * Data and Export Backup were two exports, and Import Data and Import Backup
 * two restores.
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

describe('Settings page: one home per action', () => {
  it('offers each data action exactly once', async () => {
    renderWithProviders(<ThemeProvider><SettingsPage /></ThemeProvider>);
    await screen.findByRole('heading', { name: en.settings.yourData.title });

    const { yourData, data } = en.settings;
    for (const name of [
      yourData.backUpBtn,
      yourData.restoreBtn,
      yourData.exportBusinessBtn,
      en.settings.exportReceiptsBtn,
      en.settings.integrityCheckRun,
      data.deleteAllBtn,
    ]) {
      expect(screen.getAllByRole('button', { name }), name).toHaveLength(1);
    }
  });

  it('no longer offers the old duplicate exports and restores', async () => {
    renderWithProviders(<ThemeProvider><SettingsPage /></ThemeProvider>);
    await screen.findByRole('heading', { name: en.settings.yourData.title });

    for (const name of [/Export JSON/i, /Export Backup/i, /Import Data/i, /Import Backup/i]) {
      expect(screen.queryByRole('button', { name })).toBeNull();
    }
    expect(screen.queryByRole('heading', { name: /Data Tools/i })).toBeNull();
  });
});
