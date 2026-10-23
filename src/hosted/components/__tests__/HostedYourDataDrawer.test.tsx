import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { ORG_A, ORG_B, emptyProfileRoutes, locationOf, me, ok, profile, renderPortal, stubApi } from '../../__tests__/harness';
import { LocalRecordsFileRefused } from '../../session/localBackendContract';
import type { ExportHostedRecordsOptions } from '../../session/recordsExportContract';

/** MUT-325: Your data, signed in — the account menu's drawer, Download my records with progress and Cancel. */

const exportHostedRecords = vi.fn<(options: ExportHostedRecordsOptions) => Promise<{ blob: Blob; missingReceipts: number }>>();
const saveBlobAs = vi.fn();
vi.mock('@mut/records-export', () => ({ exportHostedRecords: (options: ExportHostedRecordsOptions) => exportHostedRecords(options) }));
vi.mock('../../data/download', async (importOriginal) => ({ ...(await importOriginal<object>()), saveBlobAs: (...args: unknown[]) => saveBlobAs(...args) }));

const PERSONAL = profile({ id: ORG_B, name: 'Personal', isPersonalDefault: true, owned: true, type: 'PERSONAL', writerOfRecord: null });
const FIRM = profile({ id: ORG_A, name: 'Haddad & Partners' });

function portal(path: string, locale: 'en' | 'ar' = 'en') {
  stubApi({ 'GET /v1/me': () => ok(me([PERSONAL, FIRM], locale)), ...emptyProfileRoutes() });
  return renderPortal(path);
}

beforeEach(() => {
  exportHostedRecords.mockReset();
  saveBlobAs.mockReset();
});
afterEach(() => vi.useRealTimers());

describe('Your data, signed in (MUT-325)', () => {
  it('opens from the account menu through the URL, every profile ticked, and says it is an export, not a backup', async () => {
    const { user, router } = portal(`/p/${ORG_A}`);
    await user.click(await screen.findByRole('button', { name: /Account/ }));
    await user.click(screen.getByRole('menuitem', { name: 'Your data' }));

    const dialog = await screen.findByRole('dialog', { name: 'Your data' });
    expect(locationOf(router)).toBe(`/p/${ORG_A}?yourData=true`);
    expect(within(dialog).getByRole('checkbox', { name: 'Personal' })).toBeChecked();
    expect(within(dialog).getByRole('checkbox', { name: 'Haddad & Partners' })).toBeChecked();
    expect(within(dialog).getByText(/an export, not a backup/)).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Restore from file' })).not.toBeInTheDocument();
  });

  it('downloads the ticked profiles as one dated export file, showing progress on the way', async () => {
    let finish: (value: { blob: Blob; missingReceipts: number }) => void = () => {};
    exportHostedRecords.mockImplementation((options) => {
      options.onProgress?.({ phase: 'receipts', done: 37, total: 200 });
      return new Promise((resolve) => (finish = resolve));
    });
    const { user } = portal(`/p/${ORG_A}?yourData=true`);
    const dialog = await screen.findByRole('dialog', { name: 'Your data' });

    await user.click(within(dialog).getByRole('checkbox', { name: 'Haddad & Partners' }));
    await user.click(within(dialog).getByRole('button', { name: 'Download my records' }));

    expect(exportHostedRecords.mock.calls[0]![0].profileIds).toEqual([ORG_B]);
    const bar = await within(dialog).findByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '37');
    expect(bar).toHaveAttribute('aria-valuemax', '200');
    expect(within(dialog).getByText('Receipt files: 37 of 200')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Download my records' })).toBeDisabled();

    const blob = new Blob(['zip']);
    finish({ blob, missingReceipts: 0 });
    await screen.findByText('Records downloaded.');
    expect(saveBlobAs).toHaveBeenCalledWith(blob, expect.stringMatching(/^mtb3a-export-\d{4}-\d{2}-\d{2}\.zip$/));
  });

  it('can be cancelled: the export is aborted and nothing is saved', async () => {
    exportHostedRecords.mockImplementation((options) => new Promise((_resolve, reject) => options.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))));
    const { user } = portal(`/p/${ORG_A}?yourData=true`);
    const dialog = await screen.findByRole('dialog', { name: 'Your data' });

    await user.click(within(dialog).getByRole('button', { name: 'Download my records' }));
    await user.click(await within(dialog).findByRole('button', { name: 'Cancel' }));

    expect(await within(dialog).findByText('Download cancelled. Nothing was saved.')).toBeInTheDocument();
    expect(exportHostedRecords.mock.calls[0]![0].signal?.aborted).toBe(true);
    expect(saveBlobAs).not.toHaveBeenCalled();
    expect(within(dialog).getByRole('button', { name: 'Download my records' })).toBeEnabled();
  });

  it('says how many receipt files are missing from the file', async () => {
    exportHostedRecords.mockResolvedValue({ blob: new Blob(['zip']), missingReceipts: 2 });
    const { user } = portal(`/p/${ORG_A}?yourData=true`);
    const dialog = await screen.findByRole('dialog', { name: 'Your data' });

    await user.click(within(dialog).getByRole('button', { name: 'Download my records' }));

    expect(await within(dialog).findByText(/2 receipt files couldn't be downloaded/)).toBeInTheDocument();
    expect(saveBlobAs).toHaveBeenCalled();
  });

  it('asks for a reload when the server writes a newer format, and says nothing was saved on any other failure', async () => {
    exportHostedRecords.mockRejectedValueOnce(new LocalRecordsFileRefused('too-new')).mockRejectedValueOnce(new Error('boom'));
    const { user } = portal(`/p/${ORG_A}?yourData=true`);
    const dialog = await screen.findByRole('dialog', { name: 'Your data' });

    await user.click(within(dialog).getByRole('button', { name: 'Download my records' }));
    expect(await within(dialog).findByText(/Reload the page, then download again/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Download my records' }));
    expect(await within(dialog).findByText(/Couldn't download your records/)).toBeInTheDocument();
  });

  it('needs at least one profile ticked', async () => {
    const { user } = portal(`/p/${ORG_A}?yourData=true`);
    const dialog = await screen.findByRole('dialog', { name: 'Your data' });

    await user.click(within(dialog).getByRole('checkbox', { name: 'Personal' }));
    await user.click(within(dialog).getByRole('checkbox', { name: 'Haddad & Partners' }));

    expect(within(dialog).getByRole('button', { name: 'Download my records' })).toBeDisabled();
  });

  it('reads in Arabic, right to left', async () => {
    portal(`/p/${ORG_A}?yourData=true`, 'ar');
    const dialog = await screen.findByRole('dialog', { name: 'بياناتك' });
    expect(within(dialog).getByRole('button', { name: 'تنزيل سجلاتي' })).toBeInTheDocument();
    expect(document.documentElement).toHaveAttribute('dir', 'rtl');
  });
});
