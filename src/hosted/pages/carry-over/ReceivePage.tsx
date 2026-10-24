import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { useNavigate, useRouterState } from '@tanstack/react-router';
import { Button } from '../../../components/ui/Button';
import { carryOverBuild } from '../../../lib/carryOver/build';
import { awaitCarryOverPayload, type CarryOverReply, type CarryOverWindow } from '../../../lib/carryOver/protocol';
import { useLanguage } from '../../../lib/i18n/core';
import { useTp } from '../../../lib/i18n/plural';
import { localBackend } from '../../api/client';
import { AlertIcon, InfoIcon } from '../../components/Icons';
import { saveBlobAs } from '../../data/download';
import { isRecordsFileRefused, type CarryOverPrepareOptions, type PendingRestore } from '../../session/localBackendContract';
import { currentMode } from '../../session/mode';
import { useRestoredHome } from '../../session/restoredHome';
import { AuthLayout } from '../auth/AuthLayout';
import { CarryOverDetails } from './CarryOverDetails';

/**
 * `/carry-over/receive` on the new address (MUT-291 §3.5–§3.6). The old page
 * opens it and posts this browser's records; or the person chooses their
 * records file here. Either way the records go through the server's rules in
 * a throwaway local app first, and the summary says what arrived, what changed
 * and what didn't, before anything is saved. Saving replaces this device's
 * signed-out records (D3: with a warning, a download first, and a second
 * confirm when there are any). Signed in, the records still go to this
 * browser's signed-out space, and the page says so (E3, D10).
 */

type FileReason = 'no-opener' | 'unknown-source' | 'timeout' | 'opener-closed' | 'too-large' | 'failed' | 'declined' | 'not-a-file' | 'too-new';

type Phase =
  | { kind: 'waiting' }
  | { kind: 'checking'; done: number; total: number }
  | { kind: 'summary'; pending: PendingRestore; reply: CarryOverReply | null; fromOldAddress: boolean; confirming: boolean }
  | { kind: 'saving' }
  | { kind: 'done' }
  | { kind: 'file'; reason: FileReason };

export function ReceivePage() {
  const { t, language } = useLanguage();
  const navigate = useNavigate();
  const restoredHome = useRestoredHome();
  const [phase, setPhase] = useState<Phase>({ kind: 'waiting' });
  const started = useRef(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const from = useRouterState({ select: (state) => (state.location.search as Record<string, unknown>).from });

  const options = (): CarryOverPrepareOptions => ({
    labels: { noClient: t('hosted.carryOver.noClient'), defaultBusiness: t('hosted.carryOver.defaultBusiness') },
    locale: language === 'en' ? 'en' : 'ar',
    onProgress: (done, total) => setPhase({ kind: 'checking', done, total }),
  });

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const opener = (window.opener ?? null) as CarryOverWindow | null;
    void awaitCarryOverPayload({ sources: carryOverBuild().sources, from: typeof from === 'string' ? from : null, opener }).then(async (outcome) => {
      if (outcome.status === 'file-only') {
        setPhase({ kind: 'file', reason: outcome.reason });
        return;
      }
      setPhase({ kind: 'checking', done: 0, total: 0 });
      try {
        const pending = await (await localBackend()).prepareCarryOver(outcome.kind, outcome.payload, options());
        setPhase({ kind: 'summary', pending, reply: outcome.reply, fromOldAddress: outcome.source === 'portal', confirming: false });
      } catch (error) {
        setPhase({ kind: 'file', reason: reasonFor(error) });
      }
    });
    // Once per page: the hand-off answers one opener, once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setPhase({ kind: 'checking', done: 0, total: 0 });
    try {
      const pending = await (await localBackend()).readRecordsFile(file, options());
      setPhase({ kind: 'summary', pending, reply: null, fromOldAddress: false, confirming: false });
    } catch (error) {
      setPhase({ kind: 'file', reason: reasonFor(error) });
    }
  }

  async function save(pending: PendingRestore, reply: CarryOverReply | null) {
    setPhase({ kind: 'saving' });
    try {
      await pending.apply();
    } catch {
      setPhase({ kind: 'file', reason: 'failed' });
      return;
    }
    if (reply && pending.carryOver) reply.done({ counts: pending.carryOver.counts, totals: pending.carryOver.totals });
    setPhase({ kind: 'done' });
  }

  async function downloadExisting() {
    try {
      saveBlobAs(await (await localBackend()).exportRecords(), `mtb3a-records-${new Date().toISOString().slice(0, 10)}.zip`);
    } catch {
      setPhase({ kind: 'file', reason: 'failed' });
    }
  }

  function cancel(reply: CarryOverReply | null) {
    reply?.declined();
    setPhase({ kind: 'file', reason: 'declined' });
  }

  return (
    <AuthLayout>
      <div className="hp-card hp-carry-over" data-testid="carry-over-receive" data-phase={phase.kind}>
        {phase.kind === 'waiting' && <p role="status">{t('hosted.carryOver.receive.waiting')}</p>}
        {phase.kind === 'checking' && <p role="status">{phase.total > 0 ? t('hosted.carryOver.receive.checking', { done: phase.done, total: phase.total }) : t('hosted.carryOver.receive.waiting')}</p>}
        {phase.kind === 'saving' && <p role="status">{t('hosted.carryOver.receive.saving')}</p>}
        {phase.kind === 'summary' && (
          <Summary
            phase={phase}
            onSave={() => (phase.pending.deviceRecordCount > 0 && !phase.confirming ? setPhase({ ...phase, confirming: true }) : void save(phase.pending, phase.reply))}
            onCancel={() => cancel(phase.reply)}
            onDownloadExisting={() => void downloadExisting()}
          />
        )}
        {phase.kind === 'done' && (
          <>
            <h2>{t('hosted.carryOver.receive.done')}</h2>
            <div className="hp-empty-actions">
              <Button onClick={() => void restoredHome().then((to) => navigate({ to, replace: true }))}>{t('hosted.carryOver.receive.open')}</Button>
            </div>
          </>
        )}
        {phase.kind === 'file' && (
          <>
            <h2>{t('hosted.carryOver.receive.fileTitle')}</h2>
            <FileReasonNote reason={phase.reason} />
            <p>{t('hosted.carryOver.receive.fileLead')}</p>
            <div className="hp-empty-actions">
              <Button onClick={() => fileRef.current?.click()}>{t('hosted.carryOver.receive.choose')}</Button>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json,application/zip,.zip"
              className="sr-only"
              tabIndex={-1}
              aria-hidden="true"
              data-testid="carry-over-file"
              onChange={(event) => void chooseFile(event)}
            />
          </>
        )}
      </div>
    </AuthLayout>
  );
}

function Summary({ phase, onSave, onCancel, onDownloadExisting }: { phase: Extract<Phase, { kind: 'summary' }>; onSave: () => void; onCancel: () => void; onDownloadExisting: () => void }) {
  const { t } = useLanguage();
  const tp = useTp();
  const { pending, fromOldAddress, confirming } = phase;
  const existing = pending.deviceRecordCount;
  return (
    <>
      <h2>{t(fromOldAddress ? 'hosted.carryOver.receive.titleOldAddress' : 'hosted.carryOver.receive.titleFreeApp')}</h2>
      <p>{t('hosted.carryOver.receive.lead')}</p>
      {pending.carryOver && <CarryOverDetails summary={pending.carryOver} />}
      {currentMode() === 'remote' && (
        <div className="hp-banner hp-banner-info" role="note" data-testid="carry-over-signed-in">
          <InfoIcon />
          <span>{t('hosted.carryOver.receive.signedIn')}</span>
        </div>
      )}
      {existing > 0 && (
        <div className="hp-banner hp-banner-error" role="alert" data-testid="carry-over-existing">
          <AlertIcon />
          <span>{tp('hosted.carryOver.receive.existing', existing)}</span>
        </div>
      )}
      {confirming && <p data-testid="carry-over-replace-confirm">{t('hosted.carryOver.receive.replaceConfirm')}</p>}
      <div className="hp-empty-actions">
        {existing > 0 && (
          <Button variant="secondary" onClick={onDownloadExisting}>
            {t('hosted.carryOver.receive.downloadFirst')}
          </Button>
        )}
        <Button variant={existing > 0 ? 'danger' : 'primary'} onClick={onSave}>
          {t(existing > 0 ? 'hosted.carryOver.receive.replace' : 'hosted.carryOver.receive.save')}
        </Button>
        <Button variant="secondary" onClick={onCancel}>
          {t('common.cancel')}
        </Button>
      </div>
    </>
  );
}

function FileReasonNote({ reason }: { reason: FileReason }) {
  const { t } = useLanguage();
  const key: Partial<Record<FileReason, string>> = {
    timeout: 'hosted.carryOver.receive.fileClosed',
    'opener-closed': 'hosted.carryOver.receive.fileClosed',
    failed: 'hosted.carryOver.receive.failed',
    'too-large': 'hosted.carryOver.receive.failed',
    declined: 'hosted.carryOver.receive.cancelled',
    'not-a-file': 'hosted.local.data.notAFile',
    'too-new': 'hosted.local.data.tooNew',
  };
  const message = key[reason];
  if (!message) return null;
  const isError = reason !== 'declined';
  return (
    <div className={`hp-banner ${isError ? 'hp-banner-error' : 'hp-banner-info'}`} role={isError ? 'alert' : 'status'} data-testid="carry-over-file-reason" data-reason={reason}>
      {isError ? <AlertIcon /> : <InfoIcon />}
      <span>{t(message)}</span>
    </div>
  );
}

function reasonFor(error: unknown): FileReason {
  if (isRecordsFileRefused(error)) return error.reason === 'too-new' ? 'too-new' : error.reason === 'carry-over-failed' ? 'failed' : 'not-a-file';
  return 'failed';
}
