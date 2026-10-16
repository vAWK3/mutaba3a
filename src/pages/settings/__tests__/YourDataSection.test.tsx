import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { chooseLanguage } from '../../../test/language';
import { renderWithProviders, screen, fireEvent, waitFor } from '../../../test/utils';
import type { IntegrityResult } from '../../../db/integrityCheck';
import { db } from '../../../db/database';
import { settingsRepo } from '../../../db/repository';
import { takePendingImport } from '../../../lib/dataFiles';
import { useToastStore, type Toast } from '../../../lib/toastStore';
import en from '../../../lib/i18n/translations/en';
import ar from '../../../lib/i18n/translations/ar';
import { YourDataSection } from '../YourDataSection';

/**
 * Settings › Your data (MUT-88, ADR-072): Back up, Restore, Export a
 * business, Export receipts and Check data, each once. Ported case for case
 * from the deleted DataToolsSection suite (review D3); the intended changes
 * are the heading, Back up's "Last backed up" line, and Restore asking before
 * it replaces everything (its failure now shows in that dialog).
 */

// The section reaches most of these through getRepositories().base.dataset
// (MUT-47); the Dexie dataset delegates to these modules, so mocking them
// still stubs the storage. backUpNow is the browser-only orchestration that
// wraps dataset.serializeBackup + the download + the lastBackupAt stamp.
const { runIntegrityCheck, serializeAllTables, restoreFromBackup, backUpNow, navigate } = vi.hoisted(() => ({
  runIntegrityCheck: vi.fn(),
  serializeAllTables: vi.fn(),
  restoreFromBackup: vi.fn(),
  backUpNow: vi.fn(),
  navigate: vi.fn(),
}));
vi.mock('../../../db/integrityCheck', () => ({ runIntegrityCheck }));
vi.mock('../../../db/backup', () => ({ serializeAllTables, restoreFromBackup }));
vi.mock('../../../utils/backupDownload', () => ({ backUpNow }));
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate }));
vi.mock('../../../components/modals/ExportDataModal', () => ({
  ExportDataModal: () => <div role="dialog" aria-label="export a business" />,
}));

type Dict = Record<string, unknown>;
type Copy = Record<string, string>;

const LOCALES = [
  ['en', en as Dict],
  ['ar', ar as Dict],
] as const;
const RAW_COPY = /\b(integrity|settings)\.[a-zA-Z]|\{(count|total|version|error|date)\}/;

function section(locale: Dict, name: string): Copy {
  return (locale[name] ?? {}) as Copy;
}

function sub(copy: Copy, name: string): Copy {
  return (copy as unknown as Record<string, Copy>)[name];
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

function rowOf(label: string): HTMLElement {
  return screen.getByText(label).closest('.settings-row') as HTMLElement;
}

const FULL_BACKUP = JSON.stringify({
  version: 21,
  timestamp: '2026-09-01T08:00:00.000Z',
  tables: { clients: [{ id: 'c1' }], transactions: [{ id: 't1' }, { id: 't2' }] },
});

/** Stands in for the OS file picker the Restore button opens. */
async function pickForRestore(settings: Copy, name: string, text: string) {
  let picker: HTMLInputElement | undefined;
  vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (this: HTMLInputElement) {
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- capture the detached <input> the handler creates
    picker = this;
  });
  fireEvent.click(screen.getByRole('button', { name: sub(settings, 'yourData').restoreBtn }));
  expect(picker, 'file picker opened').toBeDefined();
  // jsdom's File has no text().
  const file = { name, text: async () => text };
  Object.defineProperty(picker, 'files', { value: [file] });
  fireEvent.change(picker as HTMLInputElement);
}

/** Restore a full backup through the confirmation dialog. */
async function restoreFullBackup(settings: Copy) {
  await pickForRestore(settings, 'mutaba3a-backup-v21.json', FULL_BACKUP);
  fireEvent.click(await screen.findByRole('button', { name: sub(settings, 'restore').replace }));
}

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  localStorage.clear();
  useToastStore.setState({ toasts: [] });
  await db.settings.clear();
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('Translation missing'));
  takePendingImport();
  vi.restoreAllMocks();
  navigate.mockReset();
});

describe('YourDataSection', () => {
  describe.each(LOCALES)('in %s', (language, locale) => {
    const settings = section(locale, 'settings');
    const integrity = section(locale, 'integrity');
    const yourData = sub(settings, 'yourData');

    beforeEach(() => {
      chooseLanguage(language);
    });

    it('labels the section, the check and its button in this language', () => {
      renderWithProviders(<YourDataSection />);

      expect(screen.getByRole('heading', { name: yourData.title })).toBeInTheDocument();
      expect(rowOf(settings.integrityCheck)).toHaveTextContent(settings.integrityCheckDesc);
      expect(screen.getByRole('button', { name: settings.integrityCheckRun })).toBeInTheDocument();
    });

    it('lists Back up, Restore, Export a business, Export receipts and Check data, in that order, once each', () => {
      renderWithProviders(<YourDataSection />);

      const labels = [yourData.backUp, yourData.restore, yourData.exportBusiness, settings.exportReceipts, settings.integrityCheck];
      const rows = labels.map(rowOf);
      rows.forEach((row, i) => {
        if (i > 0) expect(rows[i - 1].compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      });
      for (const name of [yourData.backUpBtn, yourData.restoreBtn, yourData.exportBusinessBtn, settings.exportReceiptsBtn, settings.integrityCheckRun]) {
        expect(screen.getAllByRole('button', { name })).toHaveLength(1);
      }
    });

    it('reports a clean database with the number of records checked', async () => {
      runIntegrityCheck.mockResolvedValue(integrityResult(0, 0, 42));
      renderWithProviders(<YourDataSection />);

      const toast = await runCheck(settings);

      expect(toast).toMatchObject({ type: 'success', message: fill(integrity.toastClean, {}) });
      expect(rowOf(settings.integrityCheck)).toHaveTextContent(fill(integrity.checkClean, { total: 42 }));
      expect(rowOf(settings.integrityCheck).textContent).not.toMatch(RAW_COPY);
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
      renderWithProviders(<YourDataSection />);

      const toast = await runCheck(settings);

      expect(toast).toMatchObject({
        type: 'error',
        message: fill(integrity[`toastIssues${plurality}`], { count }),
      });
      expect(rowOf(settings.integrityCheck)).toHaveTextContent(
        fill(integrity[`checkIssues${plurality}`], { count, total })
      );
      expect(rowOf(settings.integrityCheck).textContent).not.toMatch(RAW_COPY);
      expect(toast.message).not.toMatch(RAW_COPY);
    });

    it.each([
      ['returns an error', () => runIntegrityCheck.mockResolvedValue({ ...integrityResult(0, 0, 3), error: 'IDB closed' })],
      ['throws', () => runIntegrityCheck.mockRejectedValue(new Error('IDB closed'))],
    ])('says the check failed when it %s, not "0 issues"', async (_, arrange) => {
      arrange();
      renderWithProviders(<YourDataSection />);

      const toast = await runCheck(settings);

      expect(toast).toMatchObject({ type: 'error', message: fill(integrity.checkFailed, {}) });
      expect(rowOf(settings.integrityCheck)).toHaveTextContent(settings.integrityCheckDesc);
    });

    it('confirms a backup download, or says it failed', async () => {
      backUpNow.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('quota'));
      renderWithProviders(<YourDataSection />);
      const button = screen.getByRole('button', { name: yourData.backUpBtn });

      fireEvent.click(button);
      expect(await nextToast()).toMatchObject({ type: 'success', message: fill(settings.backupDone, {}) });

      useToastStore.setState({ toasts: [] });
      await waitFor(() => expect(button).toBeEnabled());
      fireEvent.click(button);
      expect(await nextToast()).toMatchObject({ type: 'error', message: fill(settings.backupFailed, {}) });
    });

    it('says when the last backup was made, or that there has been none', async () => {
      const { unmount } = renderWithProviders(<YourDataSection />);
      expect(await screen.findByText(yourData.never)).toBeInTheDocument();
      unmount();

      await settingsRepo.update({ lastBackupAt: '2026-10-13T09:12:00.000Z' });
      renderWithProviders(<YourDataSection />);

      const row = rowOf(yourData.backUp);
      const date = new Date('2026-10-13T09:12:00.000Z').toLocaleDateString(language === 'ar' ? 'ar' : 'en-US', {
        month: 'short', day: 'numeric', year: 'numeric',
      });
      await waitFor(() => expect(row).toHaveTextContent(fill(yourData.lastBackup, { date })));
      expect(row.textContent).not.toMatch(RAW_COPY);
    });

    it.each([1, 57])('confirms a restore of %i record(s) with the backup version', async (count) => {
      restoreFromBackup.mockResolvedValue({ recordsRestored: count, backupVersion: 20 });
      // The reload that follows makes jsdom print "Not implemented: navigation";
      // Location.reload is non-configurable there, so it can't be stubbed.
      renderWithProviders(<YourDataSection />);

      await restoreFullBackup(settings);
      const toast = await nextToast();

      const key = count === 1 ? 'importBackupDoneSingular' : 'importBackupDonePlural';
      expect(restoreFromBackup).toHaveBeenCalledWith(FULL_BACKUP);
      expect(toast).toMatchObject({ type: 'success', message: fill(settings[key], { count, version: 20 }) });
      expect(toast.message).not.toMatch(RAW_COPY);
    });

    it('wraps a failed restore in this language', async () => {
      restoreFromBackup.mockRejectedValue(new Error('Invalid backup file: missing version or tables'));
      renderWithProviders(<YourDataSection />);

      await restoreFullBackup(settings);

      const data = (settings as unknown as { data: Copy }).data;
      expect(await screen.findByRole('alert')).toHaveTextContent(
        fill(data.importFailed, { error: 'Invalid backup file: missing version or tables' })
      );
    });

    it('asks before a full backup replaces anything, and Cancel changes nothing', async () => {
      renderWithProviders(<YourDataSection />);

      await pickForRestore(settings, 'mutaba3a-backup-v21.json', FULL_BACKUP);
      fireEvent.click(await screen.findByRole('button', { name: (locale.common as Copy).cancel }));

      expect(restoreFromBackup).not.toHaveBeenCalled();
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    it.each([
      ['a CSV', 'ledger.csv', 'type,name\nclient,Acme'],
      ['a one-business export', 'studio.json', JSON.stringify({ version: 2, profile: { id: 'p' }, clients: [] })],
    ])('hands %s to the import page instead of restoring it', async (_, name, text) => {
      renderWithProviders(<YourDataSection />);

      await pickForRestore(settings, name, text);

      await waitFor(() => expect(navigate).toHaveBeenCalledWith({ to: '/settings/import' }));
      expect(takePendingImport()?.name).toBe(name);
      expect(restoreFromBackup).not.toHaveBeenCalled();
    });

    it('turns away a file that is neither a backup, an export nor a CSV', async () => {
      renderWithProviders(<YourDataSection />);

      await pickForRestore(settings, 'notes.json', '{"hello":1}');

      expect(await nextToast()).toMatchObject({ type: 'error', message: yourData.unknownFile });
      expect(navigate).not.toHaveBeenCalled();
      expect(restoreFromBackup).not.toHaveBeenCalled();
    });

    it('says the file could not be used when it cannot even be read', async () => {
      renderWithProviders(<YourDataSection />);
      let picker: HTMLInputElement | undefined;
      vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (this: HTMLInputElement) {
        // eslint-disable-next-line @typescript-eslint/no-this-alias -- capture the detached <input> the handler creates
        picker = this;
      });
      fireEvent.click(screen.getByRole('button', { name: yourData.restoreBtn }));
      Object.defineProperty(picker, 'files', { value: [{ name: 'gone.json', text: async () => { throw new Error('NotReadableError'); } }] });
      fireEvent.change(picker as HTMLInputElement);

      expect(await nextToast()).toMatchObject({ type: 'error', message: yourData.unknownFile });
    });

    it('opens the business export from Export a business', () => {
      renderWithProviders(<YourDataSection />);

      fireEvent.click(screen.getByRole('button', { name: yourData.exportBusinessBtn }));

      expect(screen.getByRole('dialog', { name: 'export a business' })).toBeInTheDocument();
    });
  });

  it('reads naturally in English for one issue, many issues and a clean run', async () => {
    chooseLanguage('en');
    runIntegrityCheck
      .mockResolvedValueOnce(integrityResult(0, 0, 42))
      .mockResolvedValueOnce(integrityResult(1, 0, 1))
      .mockResolvedValueOnce(integrityResult(2, 1, 30));
    renderWithProviders(<YourDataSection />);
    const enSettings = section(en as Dict, 'settings');
    const expected = [
      ['No issues found. Records checked: 42.', 'Data integrity check passed'],
      ['Found 1 issue. Records checked: 1.', '1 data integrity issue found'],
      ['Found 3 issues. Records checked: 30.', '3 data integrity issues found'],
    ];

    for (const [description, toast] of expected) {
      useToastStore.setState({ toasts: [] });
      expect((await runCheck(enSettings)).message).toBe(toast);
      expect(rowOf(enSettings.integrityCheck)).toHaveTextContent(description);
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
