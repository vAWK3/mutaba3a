import { useEffect, useState } from 'react';
import { useT } from '../../../lib/i18n/core';
import { Button } from '../../../components/ui/Button';
import { BrandMark } from '../../../components/brand/BrandMark';
import { BrandLoader } from '../../../components/brand/BrandLoader';
import { bootDelayMs } from '../../../components/brand/bootDelay';
import { Wordmark } from '../../components/Brand';
import { useFocusOnMount } from '../../components/focusOnMount';

/**
 * S1, "the mark becomes the loader" (MUT-207 D4, eng review R1): the boot
 * splash's 80 px mark, in the same spot, until the check has taken
 * `LOADER_DELAY_MS` from page start (DR9); then the bloom loader (96, whose
 * frame 0 is that mark) blooms in place, with no fade, and says what it is
 * doing (DR14: no aria-hidden here, unlike the static splash). No wordmark
 * text: before JS neither the font nor the language is known, so the splash
 * can't draw it, and the lockup would jump. "Still connecting…" from 3 s
 * (DR5); `meQuery` gives up at 15 s and BootUnreachable takes over (DR6).
 * `label` says what else is being checked (`/setup`: the link, MUT-236).
 */
export function CheckingSession({ label }: { label?: string } = {}) {
  const t = useT();
  const [blooming, setBlooming] = useState(() => bootDelayMs() === 0);

  useEffect(() => {
    if (blooming) return;
    const timer = setTimeout(() => setBlooming(true), bootDelayMs());
    return () => clearTimeout(timer);
  }, [blooming]);

  return (
    <div className="boot-splash">
      {blooming ? (
        <BrandLoader size={96} delay={0} label={label ?? t('hosted.auth.checking')} slowCaption={t('hosted.auth.connectingSlow')} />
      ) : (
        <BrandMark size={80} className="boot-splash-mark" />
      )}
    </div>
  );
}

/** S2: the server couldn't be reached before we knew whether anyone is signed in. */
export function BootUnreachable({ onRetry, retrying }: { onRetry: () => void; retrying: boolean }) {
  const t = useT();
  return (
    <div className="hp-center">
      <Wordmark />
      <div className="hp-card hp-boot-card" role="alert">
        <h2>{t('hosted.auth.boot.title')}</h2>
        <p>{t('hosted.auth.boot.body')}</p>
        <Button variant="secondary" onClick={onRetry} disabled={retrying}>
          {t('hosted.auth.boot.retry')}
        </Button>
      </div>
    </div>
  );
}

/** Which stop: another tab saved a newer format (D1), or the browser refused a save (storage full). */
export type LocalStop = 'LOCAL_FORMAT_TOO_NEW' | 'LOCAL_SAVE_FAILED';
/** A stop that only a reload gets past: the local backend's two, or the portal itself crashed (MUT-149). */
export type ReloadStop = LocalStop | 'CRASH';

const STOP_COPY: Record<ReloadStop, { text: string; reload: string }> = {
  LOCAL_FORMAT_TOO_NEW: { text: 'hosted.local.tooNew', reload: 'hosted.local.reload' },
  LOCAL_SAVE_FAILED: { text: 'hosted.local.saveFailed', reload: 'hosted.local.reload' },
  CRASH: { text: 'hosted.crash', reload: 'hosted.crash.reload' },
};

/**
 * MUT-286: the local backend stopped, and this page's code must not read or
 * write the device's records again, so the only way on is a reload. At boot
 * AuthGate shows it; mid-use the root layout shows it in place of the route.
 * MUT-149: also the full-page crash screen, when the frame itself crashed; it
 * never shows the error's own text. The title takes focus (design D7).
 */
export function ReloadToContinue({ stop = 'LOCAL_FORMAT_TOO_NEW' }: { stop?: ReloadStop }) {
  const t = useT();
  const title = useFocusOnMount<HTMLHeadingElement>();
  const copy = STOP_COPY[stop];
  return (
    <div className="hp-center">
      <Wordmark />
      <div className="hp-card hp-boot-card" role="alert">
        <h2 ref={title} tabIndex={-1}>
          {t(`${copy.text}.title`)}
        </h2>
        <p>{t(`${copy.text}.body`)}</p>
        <Button onClick={() => window.location.reload()}>{t(copy.reload)}</Button>
      </div>
    </div>
  );
}

/**
 * MUT-286: signed out, the local backend can't run in this browser (storage
 * blocked, private browsing). Not "can't reach the server": nothing was sent.
 */
export function LocalUnavailable({ onRetry, onSignIn }: { onRetry: () => void; onSignIn: () => void }) {
  const t = useT();
  return (
    <div className="hp-center">
      <Wordmark />
      <div className="hp-card hp-boot-card" role="alert">
        <h2>{t('hosted.local.unavailable.title')}</h2>
        <p>{t('hosted.local.unavailable.body')}</p>
        <div className="hp-empty-actions">
          <Button variant="secondary" onClick={onRetry}>
            {t('hosted.local.unavailable.retry')}
          </Button>
          <Button onClick={onSignIn}>{t('hosted.local.signIn')}</Button>
        </div>
      </div>
    </div>
  );
}
