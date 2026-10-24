import { useEffect, useState, type ReactNode } from 'react';
import { useT } from '../../../lib/i18n/core';
import { useTp } from '../../../lib/i18n/plural';
import { SEND_AGAIN_COOLDOWN_MS } from './selfService';

/**
 * "Check your email" (MUT-368): the one screen every accepted request ends on, whatever the address (ADR-037 §4).
 * "Send again" waits out the server's one-a-minute budget, then goes back to the form with the email kept, because a
 * new link needs a new check (D8).
 */
export function CheckEmailNotice({
  title,
  body,
  sentAt,
  onSendAgain,
  children,
}: {
  title: string;
  body: ReactNode;
  sentAt: number;
  onSendAgain: () => void;
  children?: ReactNode;
}) {
  const t = useT();
  const tp = useTp();
  const [now, setNow] = useState(() => Date.now());
  const seconds = Math.max(0, Math.ceil((sentAt + SEND_AGAIN_COOLDOWN_MS - now) / 1000));
  const cooling = seconds > 0;

  useEffect(() => {
    if (!cooling) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [cooling]);

  return (
    <section className="hp-card hp-signin-card" aria-live="polite">
      <h1>{title}</h1>
      <p className="hp-setup-lead">{body}</p>
      <p className="hp-field-hint">{t('hosted.selfService.spam')}</p>
      <button type="button" className="btn btn-secondary btn-md hp-block" disabled={cooling} onClick={onSendAgain}>
        {cooling ? tp('hosted.selfService.sendAgainIn', seconds) : t('hosted.selfService.sendAgain')}
      </button>
      {children}
    </section>
  );
}

/** A translated sentence with the address inside it, isolated so it reads left to right in an Arabic sentence. */
export function SentenceWithEmail({ sentence, email }: { sentence: string; email: string }) {
  const [before, after = ''] = sentence.split('{email}');
  return (
    <>
      {before}
      <bdi>{email}</bdi>
      {after}
    </>
  );
}
