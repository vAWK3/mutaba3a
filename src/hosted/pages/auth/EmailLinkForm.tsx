import { useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useLanguage, useT } from '../../../lib/i18n/core';
import { useTp } from '../../../lib/i18n/plural';
import { AlertIcon } from '../../components/Icons';
import { TurnstileWidget } from '../../components/turnstile/TurnstileWidget';
import { useTurnstile, type TurnstileAction } from '../../components/turnstile/useTurnstile';
import { EMAIL_SHAPE, selfServiceFailure, waitFor, type NotAcceptedReason } from './selfService';

/**
 * The shared half of /signup and /recover (MUT-368): an email, the bot check, one button. Each answer spends the
 * check's token, so the widget runs again after it. A press made before the check finishes waits for its token and
 * then sends (D15). Every refusal keeps the typed email and says what to do next; none can say whether an account
 * exists, because the server answers every address alike (ADR-037 §4).
 */

type FieldError = { kind: 'emailRequired' | 'emailInvalid' } | { kind: 'notAccepted'; reason: NotAcceptedReason };
type Banner = { kind: 'checkFailed' } | { kind: 'rateLimited'; minutes: number } | { kind: 'unreachable' };
type Phase = 'idle' | 'waiting' | 'sending';

export interface EmailLinkRequest {
  email: string;
  locale: 'en' | 'ar';
  turnstileToken: string;
}

interface EmailLinkFormProps {
  action: TurnstileAction;
  title: string;
  lead: string;
  submitLabel: string;
  initialEmail: string;
  send: (body: EmailLinkRequest) => Promise<unknown>;
  onSent: (email: string) => void;
  /** POST /v1/signups answered 404: signup closed while the page was open. */
  onClosed?: () => void;
  /** Lines under the button (signup's terms line). */
  children?: ReactNode;
}

const NOT_ACCEPTED_KEYS: Record<NotAcceptedReason, string> = {
  disposable: 'hosted.selfService.refused.disposable',
  'no-mail': 'hosted.selfService.refused.noMail',
  other: 'hosted.selfService.refused.other',
};

export function EmailLinkForm({ action, title, lead, submitLabel, initialEmail, send, onSent, onClosed, children }: EmailLinkFormProps) {
  const t = useT();
  const tp = useTp();
  const { language } = useLanguage();
  const locale = language === 'ar' ? 'ar' : 'en';
  const ids = useId();
  const emailRef = useRef<HTMLInputElement>(null);
  const waiting = useRef(false);
  /** The address that passed the shape check when Continue was pressed: what a token arriving later sends. */
  const checkedEmail = useRef('');

  const [email, setEmail] = useState(initialEmail);
  const [fieldError, setFieldError] = useState<FieldError | null>(null);
  const [banner, setBanner] = useState<Banner | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');

  const { containerRef, token, status, reset, retry } = useTurnstile({
    action,
    language: locale,
    onToken: (fresh) => {
      if (!waiting.current) return;
      waiting.current = false;
      void deliver(fresh);
    },
  });

  // Waiting for a check that then failed is not busy: the failure line says so, and Continue works again (review #3).
  const shown: Phase = phase === 'waiting' && status === 'failed' ? 'idle' : phase;
  const busy = shown !== 'idle';

  function refuse(error: FieldError) {
    setFieldError(error);
    emailRef.current?.focus();
  }

  async function deliver(turnstileToken: string) {
    const address = checkedEmail.current;
    setPhase('sending');
    try {
      await send({ email: address, locale, turnstileToken });
      onSent(address);
      return;
    } catch (error) {
      const failure = selfServiceFailure(error);
      // A 404 means "signup closed" only where the page offers that screen; anywhere else it's an outage.
      if (failure.kind === 'closed') {
        if (onClosed) onClosed();
        else setBanner({ kind: 'unreachable' });
      }
      else if (failure.kind === 'notAccepted') refuse(failure);
      else if (failure.kind === 'invalidEmail') refuse({ kind: 'emailInvalid' });
      else setBanner(failure);
    }
    // The token is spent whatever the answer: the check runs again for the next try.
    reset();
    setPhase('idle');
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const address = email.trim();
    if (!address) return refuse({ kind: 'emailRequired' });
    if (!EMAIL_SHAPE.test(address)) return refuse({ kind: 'emailInvalid' });
    checkedEmail.current = address;
    setFieldError(null);
    setBanner(null);
    if (token) return void deliver(token);
    // A failed check has already said so under the widget; anything else is still checking: wait for its token.
    if (status === 'failed') return;
    waiting.current = true;
    setPhase('waiting');
  }

  const bannerId = `${ids}-banner`;
  const errorId = `${ids}-email-error`;
  const checkId = `${ids}-check`;
  const describedBy = [fieldError ? errorId : null, banner ? bannerId : null, status === 'failed' ? checkId : null].filter(Boolean).join(' ') || undefined;
  const wait = banner?.kind === 'rateLimited' ? waitFor(banner.minutes) : null;

  return (
    <form className="hp-card hp-signin-card" noValidate onSubmit={onSubmit}>
      <h1>{title}</h1>
      <p className="hp-setup-lead">{lead}</p>

      {banner && (
        <div className="hp-banner hp-banner-error" role="alert" id={bannerId}>
          <AlertIcon />
          <span>
            {banner.kind === 'checkFailed' && t('hosted.selfService.refused.checkFailed')}
            {wait && tp(`hosted.selfService.wait.${wait.unit}`, wait.count)}
            {banner.kind === 'unreachable' && t('hosted.auth.unreachable')}
          </span>
        </div>
      )}

      <div className="hp-field">
        <label htmlFor={`${ids}-email`}>{t('hosted.auth.email')}</label>
        <input
          ref={emailRef}
          id={`${ids}-email`}
          className={`input hp-ltr-input ${fieldError ? 'input-error' : ''}`}
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
          dir="ltr"
          autoFocus
          readOnly={busy}
          value={email}
          aria-invalid={Boolean(fieldError)}
          aria-describedby={describedBy}
          onChange={(e) => setEmail(e.target.value)}
        />
        {fieldError && (
          <p className="hp-field-error" id={errorId}>
            {fieldError.kind === 'notAccepted' ? t(NOT_ACCEPTED_KEYS[fieldError.reason]) : t(`hosted.auth.${fieldError.kind}`)}
          </p>
        )}
      </div>

      <TurnstileWidget containerRef={containerRef} status={status} onRetry={retry} id={checkId} />

      <button type="submit" className="btn btn-primary btn-md hp-block" disabled={busy} aria-busy={busy}>
        {busy && <span className="btn-spinner hp-inline-spinner" aria-hidden="true" />}
        <span>{shown === 'waiting' ? t('hosted.selfService.checking') : shown === 'sending' ? t('hosted.selfService.sending') : submitLabel}</span>
      </button>
      {children}
    </form>
  );
}
