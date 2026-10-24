import { useRef, useState, type ChangeEvent } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { Button } from '../../components/ui/Button';
import { useLanguage } from '../../lib/i18n/core';
import { formatDay } from '../format/dates';
import { useTp } from '../../lib/i18n/plural';
import { localBackend } from '../api/client';
import { saveBlobAs } from '../data/download';
import { useRestoredHome } from '../session/restoredHome';
import { isRecordsFileRefused, type PendingRestore } from '../session/localBackendContract';
import { CarryOverDetails } from '../pages/carry-over/CarryOverDetails';
import { AlertIcon } from './Icons';
import { Drawer } from './Drawer';
import { useToast } from './Toast';

/**
 * Settings › Your data (D2, MUT-286 brief §2.5, §8), signed out only: the
 * portal has no Settings page, so it is the account menu's drawer, beside
 * Change password. Download writes everything on this device, receipt files
 * included, to one versioned zip (MUT-287); Restore reads one back (or a
 * MUT-286 .json), names how many records it holds, and replaces
 * local data only after that confirm. A refused file changes nothing.
 */

type Problem = 'notAFile' | 'tooNew' | 'failed';

function problemFor(error: unknown): Problem {
  if (isRecordsFileRefused(error)) return error.reason === 'too-new' ? 'tooNew' : error.reason === 'carry-over-failed' ? 'failed' : 'notAFile';
  return 'failed';
}

function recordsFileName(today: Date): string {
  return `mtb3a-records-${today.toISOString().slice(0, 10)}.zip`;
}

export function YourDataDrawer({ onClose }: { onClose: () => void }) {
  const { t, language } = useLanguage();
  const tp = useTp();
  const toast = useToast();
  const restoredHome = useRestoredHome();
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<PendingRestore | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [busy, setBusy] = useState(false);
  // Which pick is current: a slow earlier file must not replace a later one's confirm.
  const latestPick = useRef(0);

  async function download() {
    setProblem(null);
    try {
      const backend = await localBackend();
      saveBlobAs(await backend.exportRecords(), recordsFileName(new Date()));
    } catch {
      setProblem('failed');
    }
  }

  async function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const pick = ++latestPick.current;
    setProblem(null);
    setPending(null);
    try {
      const backend = await localBackend();
      // MUT-291 (E5): the old web app's backup file is read too, through the same carry-over as its hand-off.
      const read = await backend.readRecordsFile(file, { labels: { noClient: t('hosted.carryOver.noClient'), defaultBusiness: t('hosted.carryOver.defaultBusiness') }, locale: language === 'en' ? 'en' : 'ar' });
      if (pick === latestPick.current) setPending(read);
    } catch (error) {
      if (pick === latestPick.current) setProblem(problemFor(error));
    }
  }

  async function replace() {
    if (!pending || busy) return;
    setBusy(true);
    try {
      await pending.apply();
    } catch {
      setProblem('failed');
      setBusy(false);
      return;
    }
    // From here the records are replaced: whatever happens next, the person is told so, never "nothing was changed".
    toast(t('hosted.local.data.restored'), { tone: 'info' });
    await navigate({ to: await restoredHome(), replace: true });
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
            accept="application/zip,.zip,application/json,.json"
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
            data-testid="your-data-file"
            onChange={(event) => void chooseFile(event)}
          />
        </div>

        {pending && (
          <div className="hp-card hp-your-data-confirm" role="alertdialog" aria-labelledby="your-data-confirm">
            {pending.carryOver && <CarryOverDetails summary={pending.carryOver} />}
            <p id="your-data-confirm">{tp('hosted.local.data.confirm', pending.recordCount)}</p>
            {/* MUT-325: a file from an account's Download says so, and from when */}
            {pending.exportedFromAccountAt && <p>{t('hosted.local.data.fromAccount', { date: formatDay(pending.exportedFromAccountAt.toISOString().slice(0, 10), language) })}</p>}
            {/* MUT-287 review D4: said before Replace, while the person can still cancel. */}
            {pending.missingReceiptFiles > 0 && <p className="hp-your-data-missing">{tp('hosted.local.data.missingReceipts', pending.missingReceiptFiles)}</p>}
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
