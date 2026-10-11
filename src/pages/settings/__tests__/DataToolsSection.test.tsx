import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderWithProviders, screen, fireEvent, waitFor } from '../../../test/utils';
import type { IntegrityResult } from '../../../db/integrityCheck';
import { useToastStore, type Toast } from '../../../lib/toastStore';
import en from '../../../lib/i18n/translations/en.json';
import ar from '../../../lib/i18n/translations/ar.json';
import { DataToolsSection } from '../DataToolsSection';

const { runIntegrityCheck, exportBackup, restoreFromBackup } = vi.hoisted(() => ({
  runIntegrityCheck: vi.fn(),
  exportBackup: vi.fn(),
  restoreFromBackup: vi.fn(),
}));
vi.mock('../../../db/integrityCheck', () => ({ runIntegrityCheck }));
vi.mock('../../../db/backup', () => ({ exportBackup, restoreFromBackup }));

type Dict = Record<string, unknown>;
type Copy = Record<string, string>;

const LANGUAGE_KEY = 'mutaba3a-language';
const LOCALES = [
  ['en', en as Dict],
  ['ar', ar as Dict],
] as const;
const RAW_COPY = /\b(integrity|settings)\.[a-zA-Z]|\{(count|total|version|error)\}/;

function section(locale: Dict, name: string): Copy {
  return (locale[name] ?? {}) as Copy;
}

function fill(template: string | undefined, vars: Record<string, string | number>): string {
  expect(template, 'translation template').toEqual(expect.any(String));
  return Object.entries(vars).reduce(
    (text, [name, value]) => text.split(`{${name}}`).join(String(value)),
    template as string
  );
}

function integrityResult(orphans: number, broken: number, totalRecords: number): IntegrityResult {
  return {
    totalRecords,
    orphanedRecords: Array.from({ length: orphans }, (_, i) => ({
      id: `tx-${i}`,
      table: 'transactions',
      issue: 'missing_profileId',
    })),
    brokenReferences: Array.from({ length: broken }, (_, i) => ({
      id: `p-${i}`,
      table: 'projects',
      field: 'clientId',
      missingId: `gone-${i}`,
    })),
    isClean: orphans + broken === 0,
  };
}

async function nextToast(): Promise<Toast> {
  await waitFor(() => expect(useToastStore.getState().toasts).toHaveLength(1));
  return useToastStore.getState().toasts[0];
}

async function runCheck(settings: Copy): Promise<Toast> {
  fireEvent.click(screen.getByRole('button', { name: settings.integrityCheckRun }));
  return nextToast();
}

function integrityRow(settings: Copy): HTMLElement {
  return screen.getByText(settings.integrityCheck).closest('.settings-row') as HTMLElement;
}

/** Stands in for the OS file picker the import button opens. */
async function importBackupFile(settings: Copy): Promise<Toast> {
  let picker: HTMLInputElement | undefined;
  vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (this: HTMLInputElement) {
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- capture the detached <input> the handler creates
    picker = this;
  });
  fireEvent.click(screen.getByRole('button', { name: settings.importBackupBtn }));
  expect(picker, 'file picker opened').toBeDefined();
  // jsdom's File has no text(); restoreFromBackup is mocked, so the content is moot.
  const file = { name: 'backup.json', text: async () => '{}' };
  Object.defineProperty(picker, 'files', { value: [file] });
  fireEvent.change(picker as HTMLInputElement);
  return nextToast();
}

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  localStorage.clear();
  useToastStore.setState({ toasts: [] });
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('Translation missing'));
  vi.restoreAllMocks();
});

describe('DataToolsSection', () => {
  describe.each(LOCALES)('in %s', (language, locale) => {
    const settings = section(locale, 'settings');
    const integrity = section(locale, 'integrity');

    beforeEach(() => {
      localStorage.setItem(LANGUAGE_KEY, language);
    });

    it('labels the section, the check and its button in this language', () => {
      renderWithProviders(<DataToolsSection />);

      expect(screen.getByRole('heading', { name: settings.dataTools })).toBeInTheDocument();
      expect(integrityRow(settings)).toHaveTextContent(settings.integrityCheckDesc);
      expect(screen.getByRole('button', { name: settings.integrityCheckRun })).toBeInTheDocument();
    });

    it('reports a clean database with the number of records checked', async () => {
      runIntegrityCheck.mockResolvedValue(integrityResult(0, 0, 42));
      renderWithProviders(<DataToolsSection />);

      const toast = await runCheck(settings);

      expect(toast).toMatchObject({ type: 'success', message: fill(integrity.toastClean, {}) });
      expect(integrityRow(settings)).toHaveTextContent(fill(integrity.checkClean, { total: 42 }));
      expect(integrityRow(settings).textContent).not.toMatch(RAW_COPY);
      expect(toast.message).not.toMatch(RAW_COPY);
    });

    it.each([
      [1, 0, 1],
      [2, 1, 30],
      [8, 4, 120],
    ])('reports %i orphaned + %i broken references across %i records', async (orphans, broken, total) => {
      const count = orphans + broken;
      const plurality = count === 1 ? 'Singular' : 'Plural';
      runIntegrityCheck.mockResolvedValue(integrityResult(orphans, broken, total));
      renderWithProviders(<DataToolsSection />);

      const toast = await runCheck(settings);

      expect(toast).toMatchObject({
        type: 'error',
        message: fill(integrity[`toastIssues${plurality}`], { count }),
      });
      expect(integrityRow(settings)).toHaveTextContent(
        fill(integrity[`checkIssues${plurality}`], { count, total })
      );
      expect(integrityRow(settings).textContent).not.toMatch(RAW_COPY);
      expect(toast.message).not.toMatch(RAW_COPY);
    });

    it.each([
      ['returns an error', () => runIntegrityCheck.mockResolvedValue({ ...integrityResult(0, 0, 3), error: 'IDB closed' })],
      ['throws', () => runIntegrityCheck.mockRejectedValue(new Error('IDB closed'))],
    ])('says the check failed when it %s, not "0 issues"', async (_, arrange) => {
      arrange();
      renderWithProviders(<DataToolsSection />);

      const toast = await runCheck(settings);

      expect(toast).toMatchObject({ type: 'error', message: fill(integrity.checkFailed, {}) });
      expect(integrityRow(settings)).toHaveTextContent(settings.integrityCheckDesc);
    });

    it('confirms a backup download, or says it failed', async () => {
      exportBackup.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('quota'));
      renderWithProviders(<DataToolsSection />);
      const button = screen.getByRole('button', { name: settings.backupExport });

      fireEvent.click(button);
      expect(await nextToast()).toMatchObject({ type: 'success', message: fill(settings.backupDone, {}) });

      useToastStore.setState({ toasts: [] });
      fireEvent.click(button);
      expect(await nextToast()).toMatchObject({ type: 'error', message: fill(settings.backupFailed, {}) });
    });

    it.each([1, 57])('confirms a restore of %i record(s) with the backup version', async (count) => {
      restoreFromBackup.mockResolvedValue({ recordsRestored: count, backupVersion: 20 });
      // The reload that follows makes jsdom print "Not implemented: navigation";
      // Location.reload is non-configurable there, so it can't be stubbed.
      renderWithProviders(<DataToolsSection />);

      const toast = await importBackupFile(settings);

      const key = count === 1 ? 'importBackupDoneSingular' : 'importBackupDonePlural';
      expect(toast).toMatchObject({ type: 'success', message: fill(settings[key], { count, version: 20 }) });
      expect(toast.message).not.toMatch(RAW_COPY);
    });

    it('wraps a failed restore in this language', async () => {
      restoreFromBackup.mockRejectedValue(new Error('Invalid backup file: missing version or tables'));
      renderWithProviders(<DataToolsSection />);

      const toast = await importBackupFile(settings);

      const data = (settings as unknown as { data: Copy }).data;
      expect(toast).toMatchObject({
        type: 'error',
        message: fill(data.importFailed, { error: 'Invalid backup file: missing version or tables' }),
      });
    });
  });

  it('reads naturally in English for one issue, many issues and a clean run', async () => {
    localStorage.setItem(LANGUAGE_KEY, 'en');
    runIntegrityCheck
      .mockResolvedValueOnce(integrityResult(0, 0, 42))
      .mockResolvedValueOnce(integrityResult(1, 0, 1))
      .mockResolvedValueOnce(integrityResult(2, 1, 30));
    renderWithProviders(<DataToolsSection />);
    const enSettings = section(en as Dict, 'settings');
    const expected = [
      ['No issues found. Records checked: 42.', 'Data integrity check passed'],
      ['Found 1 issue. Records checked: 1.', '1 data integrity issue found'],
      ['Found 3 issues. Records checked: 30.', '3 data integrity issues found'],
    ];

    for (const [description, toast] of expected) {
      useToastStore.setState({ toasts: [] });
      expect((await runCheck(enSettings)).message).toBe(toast);
      expect(integrityRow(enSettings)).toHaveTextContent(description);
    }
  });

  it('phrases Arabic plurals as "label: {count}", which reads right for 2, 3–10 and 11+', () => {
    const arIntegrity = section(ar as Dict, 'integrity');
    const arSettings = section(ar as Dict, 'settings');

    for (const template of [
      arIntegrity.checkIssuesPlural,
      arIntegrity.toastIssuesPlural,
      arSettings.importBackupDonePlural,
    ]) {
      expect(template).toMatch(/:\s*\{count\}/);
    }
  });
});
