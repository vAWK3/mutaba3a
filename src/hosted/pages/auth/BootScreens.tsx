import { useEffect, useState } from 'react';
import { useT } from '../../../lib/i18n/core';
import { Button } from '../../../components/ui/Button';
import { Wordmark } from '../../components/Brand';

/** S1: the wordmark, and a spinner only once the check has taken a noticeable time. */
const SPINNER_DELAY_MS = 400;

export function CheckingSession() {
  const t = useT();
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), SPINNER_DELAY_MS);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="hp-center">
      <Wordmark />
      {slow && <span className="hp-spinner" role="status" aria-label={t('hosted.auth.checking')} />}
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
