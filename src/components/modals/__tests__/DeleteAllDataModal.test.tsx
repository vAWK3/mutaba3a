import { describe, it, expect, vi, beforeEach } from 'vitest';
import { chooseLanguage } from '../../../test/language';
import { renderWithProviders, screen, waitFor } from '../../../test/utils';
import userEvent from '@testing-library/user-event';
import en from '../../../lib/i18n/translations/en.json';
import ar from '../../../lib/i18n/translations/ar.json';
import { DeleteAllDataModal } from '../DeleteAllDataModal';

/**
 * MUT-88 (ADR-072): Delete all data sits behind a real backup and a typed
 * word. Step 1 used to download three CSVs that Restore can't read; it now
 * makes the same full backup as Settings › Back up.
 */

const { backUpNow, deleteAllData } = vi.hoisted(() => ({ backUpNow: vi.fn(), deleteAllData: vi.fn() }));
vi.mock('../../../utils/backupDownload', () => ({ backUpNow }));
// getRepositories().base.dataset.wipeCoreData delegates to this (MUT-47).
vi.mock('../../../db/seed', () => ({ deleteAllData }));

const copy = (locale: typeof en) => locale.settings.data.deleteModal;

function renderModal() {
  const onClose = vi.fn();
  const onSuccess = vi.fn();
  renderWithProviders(<DeleteAllDataModal onClose={onClose} onSuccess={onSuccess} />);
  return { onClose, onSuccess };
}

function confirmField(locale: typeof en) {
  const { stepB } = copy(locale);
  return screen.getByLabelText(stepB.confirmLabel.replace('{word}', stepB.confirmWord));
}

async function backUp(locale: typeof en) {
  await userEvent.click(screen.getByRole('button', { name: copy(locale).stepA.btn }));
  await screen.findByText(copy(locale).stepA.done);
}

beforeEach(() => {
  localStorage.clear();
  backUpNow.mockReset().mockResolvedValue(undefined);
  deleteAllData.mockReset().mockResolvedValue(undefined);
});

describe('DeleteAllDataModal', () => {
  it('keeps Delete locked until a backup is made and the word is typed', async () => {
    renderModal();
    const del = screen.getByRole('button', { name: copy(en).stepB.btn });

    expect(del).toBeDisabled();
    expect(confirmField(en)).toBeDisabled();

    await backUp(en);
    expect(del).toBeDisabled();

    await userEvent.type(confirmField(en), 'DELET');
    expect(del).toBeDisabled();

    await userEvent.type(confirmField(en), 'E');
    expect(del).toBeEnabled();
  });

  it('makes the same full backup as Settings › Back up, not a CSV download', async () => {
    renderModal();

    await backUp(en);

    expect(backUpNow).toHaveBeenCalledTimes(1);
  });

  it('accepts the word in any letter case, with stray spaces', async () => {
    renderModal();
    await backUp(en);

    await userEvent.type(confirmField(en), '  delete ');

    expect(screen.getByRole('button', { name: copy(en).stepB.btn })).toBeEnabled();
  });

  it('asks for the Arabic word in Arabic', async () => {
    chooseLanguage('ar');
    renderModal();
    await backUp(ar as typeof en);

    await userEvent.type(confirmField(ar as typeof en), 'DELETE');
    expect(screen.getByRole('button', { name: copy(ar as typeof en).stepB.btn })).toBeDisabled();

    await userEvent.clear(confirmField(ar as typeof en));
    await userEvent.type(confirmField(ar as typeof en), 'حذف');
    expect(screen.getByRole('button', { name: copy(ar as typeof en).stepB.btn })).toBeEnabled();
  });

  it('keeps step 2 locked and says so when the backup fails', async () => {
    backUpNow.mockRejectedValue(new Error('blocked'));
    renderModal();

    await userEvent.click(screen.getByRole('button', { name: copy(en).stepA.btn }));

    expect(await screen.findByText(copy(en).stepA.error)).toBeInTheDocument();
    expect(confirmField(en)).toBeDisabled();
  });

  it('deletes and reports success once confirmed', async () => {
    const { onSuccess } = renderModal();
    await backUp(en);
    await userEvent.type(confirmField(en), 'DELETE');

    await userEvent.click(screen.getByRole('button', { name: copy(en).stepB.btn }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(deleteAllData).toHaveBeenCalledTimes(1);
  });
});
