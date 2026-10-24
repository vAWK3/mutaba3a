import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from '../../components/ui/Button';
import { getRepositories } from '../../db';
import { carryOverBuild } from '../../lib/carryOver/build';
import { leaveTo } from '../../lib/carryOver/leave';
import { RECEIVE_PATH, startCarryOverSend, type CarryOverResult } from '../../lib/carryOver/protocol';
import { useLanguage } from '../../lib/i18n/core';
import { useTp } from '../../lib/i18n/plural';
import { backUpNow } from '../../utils/backupDownload';
import { BootSplash } from '../../components/brand/BootSplash';
import { CarriedBanner } from './CarriedBanner';
import './carryOver.css';

/**
 * The free web app's way to the new address (MUT-291 §3.6, owner decision D1).
 * Once the domain is live, every visit to the app first asks:
 *
 *  - nothing in this browser: straight to the new address (new people don't
 *    start in an app being retired);
 *  - records never carried: this screen, with Carry my records over, Download
 *    my records file, and Keep using the old app for now (this tab only, so
 *    the next visit asks again);
 *  - records already carried: the app, under a banner saying changes made
 *    here won't follow, with Carry over again.
 *
 * Opened from a home-screen install, the popup can't answer back, so the
 * screen leads with the file (R7). Off before stage live and in the desktop
 * build (`carryOverBuild().portalOrigin` is null).
 */

const LATER_KEY = 'mtb3a-carry-over-later';

type Gate = { kind: 'checking' } | { kind: 'app'; carriedOverAt: string | null } | { kind: 'screen'; carriedOverAt: string | null };

function isInstalledApp(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches;
}

function laterThisTab(): boolean {
  try {
    return sessionStorage.getItem(LATER_KEY) === '1';
  } catch {
    return false;
  }
}

export function CarryOverGate({ children }: { children: ReactNode }) {
  const { portalOrigin } = carryOverBuild();
  const [gate, setGate] = useState<Gate>(portalOrigin ? { kind: 'checking' } : { kind: 'app', carriedOverAt: null });
  const started = useRef(false);

  useEffect(() => {
    if (!portalOrigin || started.current) return;
    started.current = true;
    const { settings, dataset } = getRepositories().base;
    void Promise.all([settings.get(), dataset.countRecords()])
      .then(([current, count]) => {
        if (current.carriedOverAt) setGate({ kind: 'app', carriedOverAt: current.carriedOverAt });
        else if (count === 0) leaveTo(portalOrigin);
        else setGate(laterThisTab() ? { kind: 'app', carriedOverAt: null } : { kind: 'screen', carriedOverAt: null });
      })
      // A device whose records can't be read is never locked out of them.
      .catch(() => setGate({ kind: 'app', carriedOverAt: null }));
  }, [portalOrigin]);

  // The same splash index.html paints, so the hand-off from HTML changes nothing on screen.
  if (gate.kind === 'checking') return <BootSplash />;
  if (gate.kind === 'screen' && portalOrigin) {
    return (
      <CarryOverScreen
        portalOrigin={portalOrigin}
        onLater={() => {
          try {
            sessionStorage.setItem(LATER_KEY, '1');
          } catch {
            // Storage blocked: this tab still opens the app; the next load asks again.
          }
          // Carried before (Carry over again, then Keep using): the banner stays.
          setGate({ kind: 'app', carriedOverAt: gate.carriedOverAt });
        }}
        onCarried={(carriedOverAt) => setGate({ kind: 'app', carriedOverAt })}
      />
    );
  }
  if (gate.kind === 'app' && gate.carriedOverAt && portalOrigin) {
    const carriedOverAt = gate.carriedOverAt;
    return (
      <div className="carry-over-carried">
        <CarriedBanner portalOrigin={portalOrigin} carriedOverAt={carriedOverAt} onCarryAgain={() => setGate({ kind: 'screen', carriedOverAt })} />
        {children}
      </div>
    );
  }
  return <>{children}</>;
}

type Phase = { kind: 'offer'; declined: boolean } | { kind: 'sending' } | { kind: 'done'; result: CarryOverResult; carriedOverAt: string } | { kind: 'fallback'; failed: boolean };

function CarryOverScreen({ portalOrigin, onLater, onCarried }: { portalOrigin: string; onLater: () => void; onCarried: (carriedOverAt: string) => void }) {
  const { t } = useLanguage();
  const tp = useTp();
  const [count, setCount] = useState<number | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: 'offer', declined: false });
  const installed = isInstalledApp();
  const address = new URL(portalOrigin).host;
  const { dataset, settings } = getRepositories().base;

  useEffect(() => {
    void dataset.countRecords().then(setCount, () => setCount(null));
  }, [dataset]);

  function carry() {
    setPhase({ kind: 'sending' });
    // From the click itself: the popup opens before anything is awaited (R2).
    // Strict: a table that can't be read fails the carry-over instead of arriving empty.
    void startCarryOverSend({ portalOrigin, source: 'web', read: async () => new Blob([JSON.stringify(await dataset.serializeBackup({ strict: true }))], { type: 'application/json' }) }).then(async (outcome) => {
      if (outcome.status === 'done') {
        const carriedOverAt = new Date().toISOString();
        try {
          await settings.update({ carriedOverAt });
        } catch {
          // The records are on the new address either way; this device just asks again next time.
        }
        setPhase({ kind: 'done', result: outcome, carriedOverAt });
      } else if (outcome.status === 'declined') setPhase({ kind: 'offer', declined: true });
      else setPhase({ kind: 'fallback', failed: outcome.reason === 'failed' });
    });
  }

  return (
    <main className="carry-over-screen" data-testid="carry-over-screen" data-phase={phase.kind}>
      <div className="carry-over-card">
        <h1>{t('carryOver.title')}</h1>
        {count !== null && <p>{tp('carryOver.lead', count)}</p>}

        {installed && phase.kind !== 'done' && <p data-testid="carry-over-installed">{t('carryOver.installedLead', { address })}</p>}
        {phase.kind === 'offer' && phase.declined && <p role="status">{t('carryOver.declined')}</p>}
        {phase.kind === 'sending' && <p role="status">{t('carryOver.waiting')}</p>}
        {phase.kind === 'fallback' && (
          <p role="alert" className="carry-over-alert">
            {t(phase.failed ? 'carryOver.failed' : 'carryOver.fallback', { address })}
          </p>
        )}
        {phase.kind === 'done' && (
          <>
            <p role="status">{t('carryOver.done')}</p>
            <p data-testid="carry-over-arrived">{t('carryOver.arrived', { clients: phase.result.counts.clients ?? 0, income: phase.result.counts.income ?? 0, expenses: phase.result.counts.expenses ?? 0 })}</p>
          </>
        )}

        <div className="carry-over-actions">
          {phase.kind === 'done' ? (
            <>
              <a className="btn btn-primary btn-md" href={portalOrigin}>
                {t('carryOver.openNew')}
              </a>
              <Button variant="secondary" onClick={() => onCarried(phase.carriedOverAt)}>
                {t('carryOver.later')}
              </Button>
            </>
          ) : (
            <>
              {!installed && phase.kind !== 'fallback' && (
                <Button onClick={carry} disabled={phase.kind === 'sending'}>
                  {t('carryOver.carry')}
                </Button>
              )}
              <Button variant={installed || phase.kind === 'fallback' ? 'primary' : 'secondary'} onClick={() => void backUpNow()}>
                {t('carryOver.download')}
              </Button>
              {(installed || phase.kind === 'fallback') && (
                <a className="btn btn-secondary btn-md" href={`${portalOrigin}${RECEIVE_PATH}`}>
                  {t('carryOver.openNew')}
                </a>
              )}
              <Button variant="ghost" onClick={onLater}>
                {t('carryOver.later')}
              </Button>
            </>
          )}
        </div>
        <p className="carry-over-note">{t('carryOver.laterNote')}</p>
      </div>
    </main>
  );
}
