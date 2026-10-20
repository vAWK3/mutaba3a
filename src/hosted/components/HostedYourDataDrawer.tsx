import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { useT } from '../../lib/i18n/core';
import { useTp } from '../../lib/i18n/plural';
import type { ExportProgress } from '../session/recordsExportContract';
import { recordsExportTransport } from '../data/recordsExportTransport';
import { saveBlobAs } from '../data/download';
import { useMe } from '../session/me';
import { isRecordsFileRefused } from '../session/localBackendContract';
import { AlertIcon } from './Icons';
import { Drawer } from './Drawer';
import { useToast } from './Toast';

/**
 * Settings › Your data, signed in (MUT-325, ADR-156): the account menu's
 * drawer, as signed out (MUT-286). Download my records writes the chosen
 * profiles to the records file the signed-out portal restores, receipt files
 * included. It's an export, not a backup: nothing here restores into the
 * account. Long exports show where they are and can be cancelled; closing
 * the drawer cancels too. The export code loads only on Download.
 */

type Notice = { kind: 'cancelled' | 'failed' | 'tooNew' } | { kind: 'missing'; count: number };

function exportFileName(today: Date): string {
  return `mutaba3a-export-${today.toISOString().slice(0, 10)}.zip`;
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

export function HostedYourDataDrawer({ onClose }: { onClose: () => void }) {
  const t = useT();
  const toast = useToast();
  const me = useMe();
  const ids = useId();
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set(me.profiles.map((p) => p.id)));
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [running, setRunning] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const controller = useRef<AbortController | null>(null);

  // Closing the drawer mid-export cancels it: nothing keeps downloading where the person can't see or stop it.
  useEffect(() => () => controller.current?.abort(), []);

  function toggle(id: string) {
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function download() {
    if (running || picked.size === 0) return;
    const abort = new AbortController();
    controller.current = abort;
    setRunning(true);
    setNotice(null);
    setProgress(null);
    try {
      const { exportHostedRecords } = await import('@mut/records-export');
      const profileIds = me.profiles.map((p) => p.id).filter((id) => picked.has(id));
      const { blob, missingReceipts } = await exportHostedRecords({ profileIds, transport: recordsExportTransport, signal: abort.signal, onProgress: setProgress });
      saveBlobAs(blob, exportFileName(new Date()));
      toast(t('hosted.yourData.downloaded'), { tone: 'info' });
      if (missingReceipts > 0) setNotice({ kind: 'missing', count: missingReceipts });
    } catch (error) {
      if (abort.signal.aborted || isAbort(error)) setNotice({ kind: 'cancelled' });
      else if (isRecordsFileRefused(error) && error.reason === 'too-new') setNotice({ kind: 'tooNew' });
      else setNotice({ kind: 'failed' });
    } finally {
      if (controller.current === abort) controller.current = null;
      setRunning(false);
      setProgress(null);
    }
  }

  return (
    <Drawer title={t('hosted.yourData.title')} onClose={onClose} closeLabel={t('common.close')}>
      <div className="hp-your-data">
        <p>{t('hosted.yourData.body')}</p>
        <p className="hp-your-data-note">{t('hosted.yourData.notBackup')}</p>

        {notice && <NoticeBanner notice={notice} />}

        <fieldset className="hp-your-data-profiles" disabled={running}>
          <legend>{t('hosted.yourData.profiles')}</legend>
          <ul className="hp-pick-list">
            {me.profiles.map((p) => (
              <li key={p.id}>
                <label className="hp-pick" htmlFor={`${ids}-${p.id}`}>
                  <input id={`${ids}-${p.id}`} type="checkbox" checked={picked.has(p.id)} onChange={() => toggle(p.id)} />
                  <span className="hp-pick-text">{p.name}</span>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>

        {running && <ProgressLine progress={progress} profiles={picked.size} />}

        <div className="hp-empty-actions">
          <Button onClick={() => void download()} disabled={running || picked.size === 0} aria-busy={running}>
            {t('hosted.yourData.download')}
          </Button>
          {running && (
            <Button variant="secondary" onClick={() => controller.current?.abort()}>
              {t('hosted.yourData.cancel')}
            </Button>
          )}
        </div>
      </div>
    </Drawer>
  );
}

function NoticeBanner({ notice }: { notice: Notice }) {
  const t = useT();
  const tp = useTp();
  const text = notice.kind === 'missing' ? tp('hosted.yourData.missingReceipts', notice.count) : t(`hosted.yourData.${notice.kind}`);
  const tone = notice.kind === 'cancelled' ? 'hp-banner-info' : 'hp-banner-error';
  return (
    <div className={`hp-banner ${tone}`} role={notice.kind === 'cancelled' ? 'status' : 'alert'}>
      <AlertIcon />
      <span>{text}</span>
      {notice.kind === 'tooNew' && (
        <Button variant="secondary" onClick={() => window.location.reload()}>
          {t('hosted.yourData.reload')}
        </Button>
      )}
    </div>
  );
}

/** Where the export is: which profile it is reading, then how many receipt files are in, then the zipping. */
function ProgressLine({ progress, profiles }: { progress: ExportProgress | null; profiles: number }) {
  const t = useT();
  const done = progress?.done ?? 0;
  const total = progress?.total ?? profiles;
  const label =
    !progress || progress.phase === 'records'
      ? t('hosted.yourData.readingProfile', { current: Math.min(done + 1, total), total })
      : done >= total
        ? t('hosted.yourData.zipping')
        : t('hosted.yourData.fetchingReceipts', { done, total });
  return (
    <div className="hp-your-data-progress" aria-live="polite">
      <div className="hp-progress" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}>
        <span style={{ inlineSize: `${total > 0 ? (done / total) * 100 : 0}%` }} />
      </div>
      <p>{label}</p>
    </div>
  );
}
