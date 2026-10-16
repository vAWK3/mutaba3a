import { describe, it, expect, vi, beforeEach } from 'vitest';
import { chooseLanguage } from '../../../test/language';
import { renderWithProviders, screen, waitFor } from '../../../test/utils';
import userEvent from '@testing-library/user-event';
import en from '../../../lib/i18n/translations/en';
import ar from '../../../lib/i18n/translations/ar';
import { QueryClient } from '@tanstack/react-query';
import { DeleteAllDataModal } from '../DeleteAllDataModal';
import { useProfileStore } from '../../../lib/profileStore';
import { useDemoStore } from '../../../demo/demoStore';
import { useOnboardingStore } from '../../../lib/onboardingStore';

/**
 * MUT-88 (ADR-072): Delete all data sits behind a real backup and a typed
 * word. Step 1 used to download three CSVs that Restore can't read; it now
 * makes the same full backup as Settings › Back up.
 */

const { backUpNow, deleteAllData } = vi.hoisted(() => ({ backUpNow: vi.fn(), deleteAllData: vi.fn() }));
vi.mock('../../../utils/backupDownload', () => ({ backUpNow }));
// getRepositories().base.dataset.wipeAllData delegates to this (MUT-47).
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

  it('refetches every query and forgets the deleted business, sample and walkthrough (MUT-164)', async () => {
    const invalidate = vi.spyOn(QueryClient.prototype, 'invalidateQueries');
    useProfileStore.getState().setActiveProfile('bp-gone');
    useDemoStore.getState().activateDemo('2026-10-01T00:00:00.000Z');
    useOnboardingStore.getState().completeStep('client', 'c-gone');
    const { onSuccess } = renderModal();
    await backUp(en);
    await userEvent.type(confirmField(en), 'DELETE');

    await userEvent.click(screen.getByRole('button', { name: copy(en).stepB.btn }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(invalidate).toHaveBeenCalledWith();
    expect(useProfileStore.getState().activeProfileId).toBe('');
    expect(useDemoStore.getState().isActive).toBe(false);
    expect(useOnboardingStore.getState().completedSteps).toEqual([]);
    invalidate.mockRestore();
  });

  it('says what it deletes and what it keeps, in both languages', () => {
    for (const locale of [en, ar]) {
      expect(copy(locale).warning).not.toBe('');
      expect(copy(locale).kept).toBeTruthy();
    }
    renderModal();
    expect(screen.getByText(copy(en).warning)).toBeInTheDocument();
    expect(screen.getByText(copy(en).kept)).toBeInTheDocument();
  });
});
