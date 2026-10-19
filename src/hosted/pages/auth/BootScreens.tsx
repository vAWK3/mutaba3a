import { useEffect, useState } from 'react';
import { useT } from '../../../lib/i18n/core';
import { Button } from '../../../components/ui/Button';
import { BrandMark } from '../../../components/brand/BrandMark';
import { BrandLoader } from '../../../components/brand/BrandLoader';
import { bootDelayMs } from '../../../components/brand/bootDelay';
import { Wordmark } from '../../components/Brand';

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

/**
 * D1 (MUT-286): another tab saved this device's records with a newer build.
 * This page's code must not read or write them, so the only way on is a reload.
 */
export function ReloadToContinue() {
  const t = useT();
  return (
    <div className="hp-center">
      <Wordmark />
      <div className="hp-card hp-boot-card" role="alert">
        <h2>{t('hosted.local.tooNew.title')}</h2>
        <p>{t('hosted.local.tooNew.body')}</p>
        <Button onClick={() => window.location.reload()}>{t('hosted.local.tooNew.reload')}</Button>
      </div>
    </div>
  );
}
