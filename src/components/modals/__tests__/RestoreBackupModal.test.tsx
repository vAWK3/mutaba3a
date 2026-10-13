import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '../../../lib/i18n';
import { RestoreBackupModal } from '../RestoreBackupModal';

/**
 * MUT-88 (ADR-072): Restore with a full backup replaces everything on the
 * device, so it asks first and says which backup and how much it holds.
 */

const { restoreFromBackup } = vi.hoisted(() => ({ restoreFromBackup: vi.fn() }));
// dataset.ts (MUT-47) imports serializeAllTables alongside restoreFromBackup;
// the mock factory must still provide it even though this modal never calls it.
vi.mock('../../../db/backup', () => ({ serializeAllTables: vi.fn(), restoreFromBackup }));

const summary = { kind: 'fullBackup' as const, timestamp: '2026-09-01T08:00:00.000Z', version: 21, records: 42 };

function renderModal(props: Partial<Parameters<typeof RestoreBackupModal>[0]> = {}) {
  const onClose = vi.fn();
  const onRestored = vi.fn();
  render(
    <LanguageProvider>
      <RestoreBackupModal backupJson="{}" summary={summary} onClose={onClose} onRestored={onRestored} {...props} />
    </LanguageProvider>,
  );
  return { onClose, onRestored };
}

beforeEach(() => {
  localStorage.removeItem('mutaba3a-language');
  restoreFromBackup.mockReset();
});

describe('RestoreBackupModal', () => {
  it('names the backup by its date and says how many records it holds', () => {
    renderModal();

    const dialog = screen.getByRole('dialog', { name: /replace everything/i });
    expect(dialog).toHaveTextContent('Sep 1, 2026');
    expect(dialog).toHaveTextContent('42 records');
  });

  it('says "1 record" for a single record', () => {
    renderModal({ summary: { ...summary, records: 1 } });
    expect(screen.getByRole('dialog')).toHaveTextContent('1 record');
    expect(screen.getByRole('dialog')).not.toHaveTextContent('1 records');
  });

  it('changes nothing on Cancel', async () => {
    const { onClose, onRestored } = renderModal();

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onClose).toHaveBeenCalled();
    expect(restoreFromBackup).not.toHaveBeenCalled();
    expect(onRestored).not.toHaveBeenCalled();
  });

  it('restores the file it was given and reports how many records came back', async () => {
    restoreFromBackup.mockResolvedValue({ recordsRestored: 42, backupVersion: 21 });
    const { onRestored } = renderModal({ backupJson: '{"version":21}' });

    await userEvent.click(screen.getByRole('button', { name: /replace everything/i }));

    expect(restoreFromBackup).toHaveBeenCalledWith('{"version":21}');
    await waitFor(() => expect(onRestored).toHaveBeenCalledWith({ recordsRestored: 42, backupVersion: 21 }));
  });

  it('shows why a restore failed, in this language, and stays open', async () => {
    restoreFromBackup.mockRejectedValue(new Error('Backup is from a newer version'));
    const { onRestored, onClose } = renderModal();

    await userEvent.click(screen.getByRole('button', { name: /replace everything/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Import failed: Backup is from a newer version');
    expect(onRestored).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /replace everything/i })).toBeEnabled();
  });
});
