import { useEffect, useRef, useState } from 'react';
import { useRouterState } from '@tanstack/react-router';
import { Button } from '../../../components/ui/Button';
import { carryOverBuild } from '../../../lib/carryOver/build';
import { startCarryOverSend } from '../../../lib/carryOver/protocol';
import { useLanguage } from '../../../lib/i18n/core';
import { localBackend, localRecordCount } from '../../api/client';
import { AlertIcon } from '../../components/Icons';
import { saveBlobAs } from '../../data/download';
import { safeNext } from '../../session/safeNext';
import { AuthLayout } from '../auth/AuthLayout';
import { CheckingSession } from '../auth/BootScreens';
import { leaveTo } from './leave';

/**
 * `/carry-over?next=…` on the old address (MUT-291 move B, §3.6). At stage
 * `redirect` the server sends every portal page visit on the old host here
 * first (server/src/app.ts, LEGACY_CARRY_OVER_PATH). With no signed-out
 * records in this browser it goes straight on to the new address; with some,
 * it offers to carry them over before anyone is stranded. On the new address
 * itself it only goes on to `next`.
 */

type Phase = { kind: 'checking' } | { kind: 'offer' } | { kind: 'sending' } | { kind: 'done' } | { kind: 'fallback' };

/** `next`, kept on this origin and never back here. */
function nextPath(raw: unknown): string {
  const next = safeNext(typeof raw === 'string' ? raw : null);
  return next.startsWith('/carry-over') ? '/' : next;
}

export function CarryOverPage() {
  const { t } = useLanguage();
  const [phase, setPhase] = useState<Phase>({ kind: 'checking' });
  const started = useRef(false);
  const { portalOrigin } = carryOverBuild();
  const next = nextPath(useRouterState({ select: (state) => (state.location.search as Record<string, unknown>).next }));
  const newAddress = portalOrigin ? `${portalOrigin}${next}` : next;

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (!portalOrigin || window.location.origin === portalOrigin) {
      leaveTo(next);
      return;
    }
    void localRecordCount()
      .catch(() => 0)
      .then((count) => (count > 0 ? setPhase({ kind: 'offer' }) : leaveTo(newAddress)));
    // Once per page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function carry() {
    if (!portalOrigin) return;
    setPhase({ kind: 'sending' });
    // Synchronously from the click: the popup opens before anything is awaited (R2).
    void startCarryOverSend({ portalOrigin, source: 'portal', read: async () => (await localBackend()).exportRecords() }).then((outcome) => {
      if (outcome.status === 'done') {
        setPhase({ kind: 'done' });
        leaveTo(newAddress);
      } else if (outcome.status === 'declined') setPhase({ kind: 'offer' });
      else setPhase({ kind: 'fallback' });
    });
  }

  async function download() {
    saveBlobAs(await (await localBackend()).exportRecords(), `mtb3a-records-${new Date().toISOString().slice(0, 10)}.zip`);
  }

  if (phase.kind === 'checking') return <CheckingSession />;

  return (
    <AuthLayout>
      <div className="hp-card hp-carry-over" data-testid="carry-over-send" data-phase={phase.kind}>
        <h2>{t('hosted.carryOver.send.title')}</h2>
        <p>{t('hosted.carryOver.send.lead')}</p>
        {phase.kind === 'sending' && <p role="status">{t('hosted.carryOver.send.waiting')}</p>}
        {phase.kind === 'done' && <p role="status">{t('hosted.carryOver.send.done')}</p>}
        {phase.kind === 'fallback' && (
          <div className="hp-banner hp-banner-error" role="alert">
            <AlertIcon />
            <span>{t('hosted.carryOver.send.fallback')}</span>
          </div>
        )}
        <div className="hp-empty-actions">
          {phase.kind !== 'fallback' && (
            <Button onClick={carry} disabled={phase.kind !== 'offer'}>
              {t('hosted.carryOver.send.carry')}
            </Button>
          )}
          <Button variant={phase.kind === 'fallback' ? 'primary' : 'secondary'} onClick={() => void download()}>
            {t('hosted.carryOver.send.download')}
          </Button>
          {phase.kind === 'fallback' && (
            <a className="btn btn-secondary btn-md" href={newAddress}>
              {t('hosted.carryOver.send.openNew')}
            </a>
          )}
        </div>
      </div>
    </AuthLayout>
  );
}
