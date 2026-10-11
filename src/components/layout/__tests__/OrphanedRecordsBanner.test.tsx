import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderWithProviders, screen, userEvent } from '../../../test/utils';
import type { IntegrityResult } from '../../../db/integrityCheck';
import { useDrawerStore } from '../../../lib/stores';
import en from '../../../lib/i18n/translations/en.json';
import ar from '../../../lib/i18n/translations/ar.json';
import { OrphanedRecordsBanner } from '../OrphanedRecordsBanner';

const { runIntegrityCheck } = vi.hoisted(() => ({ runIntegrityCheck: vi.fn() }));
vi.mock('../../../db/integrityCheck', () => ({ runIntegrityCheck }));

type Dict = Record<string, unknown>;

const LANGUAGE_KEY = 'mutaba3a-language';
const LOCALES = [
  ['en', en as Dict],
  ['ar', ar as Dict],
] as const;

function integrityCopy(locale: Dict): Record<string, string> {
  return (locale.integrity ?? {}) as Record<string, string>;
}

function orphans(count: number): IntegrityResult {
  const orphanedRecords = Array.from({ length: count }, (_, i) => ({
    id: `tx-${i}`,
    table: 'transactions',
    issue: 'missing_profileId',
  }));
  return { totalRecords: count, orphanedRecords, brokenReferences: [], isClean: false };
}

beforeEach(() => {
  localStorage.clear();
  useDrawerStore.getState().closeOrphanedRecordsDrawer();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('OrphanedRecordsBanner', () => {
  describe.each(LOCALES)('in %s', (language, locale) => {
    it.each([1, 8])('renders translated copy, not i18n keys, for %i orphaned record(s)', async (count) => {
      localStorage.setItem(LANGUAGE_KEY, language);
      runIntegrityCheck.mockResolvedValue(orphans(count));
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const copy = integrityCopy(locale);
      const message = count === 1 ? copy.orphanedRecordSingular : copy.orphanedRecordPlural;

      renderWithProviders(<OrphanedRecordsBanner />);

      const banner = await screen.findByRole('alert');
      expect(message, `integrity copy for ${count}`).toEqual(expect.any(String));
      expect(banner).toHaveTextContent(message.replace('{count}', String(count)));
      expect(banner.textContent).not.toMatch(/integrity\.|\{count\}/);
      if (count > 1) expect(banner).toHaveTextContent(String(count));
      expect(screen.getByRole('button', { name: copy.reviewNow })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: copy.dismiss })).toBeInTheDocument();
      expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('Translation missing'));
    });
  });

  it('reads naturally in English for one record and for many', async () => {
    runIntegrityCheck.mockResolvedValue(orphans(8));
    localStorage.setItem(LANGUAGE_KEY, 'en');

    const { unmount } = renderWithProviders(<OrphanedRecordsBanner />);
    expect(await screen.findByRole('alert')).toHaveTextContent("8 records aren't assigned to any profile.");
    unmount();

    runIntegrityCheck.mockResolvedValue(orphans(1));
    renderWithProviders(<OrphanedRecordsBanner />);
    expect(await screen.findByRole('alert')).toHaveTextContent("1 record isn't assigned to any profile.");
  });

  describe('Review now', () => {
    beforeEach(() => {
      localStorage.setItem(LANGUAGE_KEY, 'en');
    });

    it('is a button, and the banner has no link to navigate away with', async () => {
      runIntegrityCheck.mockResolvedValue(orphans(3));

      renderWithProviders(<OrphanedRecordsBanner />);

      const banner = await screen.findByRole('alert');
      expect(screen.getByRole('button', { name: 'Review now' })).toHaveAttribute('type', 'button');
      expect(screen.queryByRole('link')).not.toBeInTheDocument();
      expect(banner.querySelector('a[href]')).toBeNull();
    });

    it('opens the unassigned-records drawer in place, without changing the URL', async () => {
      runIntegrityCheck.mockResolvedValue(orphans(3));
      const before = window.location.href;
      const user = userEvent.setup();

      renderWithProviders(<OrphanedRecordsBanner />);
      await user.click(await screen.findByRole('button', { name: 'Review now' }));

      expect(useDrawerStore.getState().orphanedRecordsDrawer.isOpen).toBe(true);
      expect(window.location.href).toBe(before);
    });
  });
});
