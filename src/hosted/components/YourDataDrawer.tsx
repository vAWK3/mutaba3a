import { useRef, useState, type ChangeEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Button } from '../../components/ui/Button';
import { useT } from '../../lib/i18n/core';
import { useTp } from '../../lib/i18n/plural';
import { localBackend } from '../api/client';
import { isRecordsFileRefused, type PendingRestore } from '../session/localBackendContract';
import { AlertIcon } from './Icons';
import { Drawer } from './Drawer';
import { useToast } from './Toast';

/**
 * Settings › Your data (D2, MUT-286 brief §2.5, §8), signed out only: the
 * portal has no Settings page, so it is the account menu's drawer, beside
 * Change password. Download writes everything on this device to one versioned
 * file; Restore reads one back, names how many records it holds, and replaces
 * local data only after that confirm. A refused file changes nothing.
 */

type Problem = 'notAFile' | 'tooNew' | 'failed';

function problemFor(error: unknown): Problem {
  if (isRecordsFileRefused(error)) return error.reason === 'too-new' ? 'tooNew' : 'notAFile';
  return 'failed';
}

function recordsFileName(today: Date): string {
  return `mutaba3a-records-${today.toISOString().slice(0, 10)}.json`;
}

function saveBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

export function YourDataDrawer({ onClose }: { onClose: () => void }) {
  const t = useT();
  const tp = useTp();
  const toast = useToast();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<PendingRestore | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [busy, setBusy] = useState(false);

  async function download() {
    setProblem(null);
    try {
      const backend = await localBackend();
      saveBlob(backend.exportRecords(), recordsFileName(new Date()));
    } catch {
      setProblem('failed');
    }
  }

  async function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setProblem(null);
    setPending(null);
    try {
      const backend = await localBackend();
      setPending(await backend.readRecordsFile(file));
    } catch (error) {
      setProblem(problemFor(error));
    }
  }

  async function replace() {
    if (!pending || busy) return;
    setBusy(true);
    try {
      await pending.apply();
      // Profile ids may differ in the restored records: start again from `/`, with nothing cached.
      queryClient.removeQueries();
      toast(t('hosted.local.data.restored'), { tone: 'info' });
      onClose();
      void navigate({ to: '/', replace: true });
    } catch {
      setProblem('failed');
      setBusy(false);
    }
  }

  return (
    <Drawer title={t('hosted.local.data.title')} onClose={onClose} closeLabel={t('common.close')}>
      <div className="hp-your-data">
        <p>{t('hosted.local.data.body')}</p>

        {problem && (
          <div className="hp-banner hp-banner-error" role="alert">
            <AlertIcon />
            <span>{t(`hosted.local.data.${problem}`)}</span>
          </div>
        )}

        <div className="hp-empty-actions">
          <Button onClick={() => void download()}>{t('hosted.local.data.download')}</Button>
          <Button variant="secondary" onClick={() => fileRef.current?.click()} disabled={busy}>
            {t('hosted.local.data.restore')}
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
            data-testid="your-data-file"
            onChange={(event) => void chooseFile(event)}
          />
        </div>

        {pending && (
          <div className="hp-card hp-your-data-confirm" role="alertdialog" aria-labelledby="your-data-confirm">
            <p id="your-data-confirm">{tp('hosted.local.data.confirm', pending.recordCount)}</p>
            <div className="hp-empty-actions">
              <Button variant="danger" onClick={() => void replace()} disabled={busy} aria-busy={busy}>
                {t('hosted.local.data.replace')}
              </Button>
              <Button variant="secondary" onClick={() => setPending(null)} disabled={busy}>
                {t('common.cancel')}
              </Button>
            </div>
          </div>
        )}
      </div>
    </Drawer>
  );
}
