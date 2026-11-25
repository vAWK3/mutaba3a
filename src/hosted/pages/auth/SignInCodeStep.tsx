import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { useLanguage, useT } from '../../../lib/i18n/core';
import { useTp } from '../../../lib/i18n/plural';
import { api, ApiError, type Me } from '../../api/client';
import { countPublicPage } from '../../analytics/portalAnalytics';
import { AlertIcon, InfoIcon } from '../../components/Icons';
import { TurnstileWidget } from '../../components/turnstile/TurnstileWidget';
import { useTurnstile } from '../../components/turnstile/useTurnstile';
import { reportBoundaryError } from '../../observability/errorReporting';
import { SentenceWithEmail } from './CheckEmailNotice';
import { CODE_LENGTH, codeDigits, codeFailure, refusalReason, type CodeFailure } from './signInCode';
import { SEND_AGAIN_COOLDOWN_MS, selfServiceFailure, waitFor, type SelfServiceFailure } from './selfService';

/**
 * "Email me a sign-in code" (MUT-618, ADR-256 D9): the step that replaces the password form on /sign-in. It asks the
 * server to mail a code as soon as the bot check passes (Turnstile, action `sign-in-code`, as /recover), then takes the
 * six digits (`autocomplete="one-time-code"`, so the browser can fill it from the mail). "Resend code" waits out the
 * server's one-a-minute budget and needs a fresh check; "Use my password instead" goes back with the email kept.
 *
 * Every refusal says what to do next and none says whether the address has an account: the server answers every
 * address alike (ADR-037 §4).
 */

type Phase = 'asking' | 'code' | 'signingIn';
type AskBanner = Exclude<SelfServiceFailure, { kind: 'closed' } | { kind: 'notAccepted' } | { kind: 'invalidEmail' }>;

interface SignInCodeStepProps {
  email: string;
  onSignedIn: (me: Me) => void;
  onUnderReview: () => void;
  onUsePassword: () => void;
}

/** A failure worth a Sentry report: the server broke (5xx) or answered something unexpected. Offline is not a bug. */
function isUnexpected(error: unknown): boolean {
  if (!(error instanceof ApiError)) return true;
  return error.status >= 500;
}

export function SignInCodeStep({ email, onSignedIn, onUnderReview, onUsePassword }: SignInCodeStepProps) {
  const t = useT();
  const tp = useTp();
  const { language } = useLanguage();
  const locale = language === 'ar' ? 'ar' : 'en';
  const ids = useId();
  const codeRef = useRef<HTMLInputElement>(null);
  /** The first ask goes out as soon as the check passes: the person already pressed the link. */
  const waiting = useRef(true);
  const resending = useRef(false);

  const [phase, setPhase] = useState<Phase>('asking');
  const [code, setCode] = useState('');
  const [codeMissing, setCodeMissing] = useState(false);
  const [askBanner, setAskBanner] = useState<AskBanner | null>(null);
  const [refusal, setRefusal] = useState<CodeFailure | null>(null);
  const [sentAt, setSentAt] = useState<number | null>(null);
  const [resent, setResent] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const { containerRef, token, status, reset, retry } = useTurnstile({
    action: 'sign-in-code',
    language: locale,
    onToken: (fresh) => {
      if (!waiting.current) return;
      waiting.current = false;
      void ask(fresh);
    },
  });

  const seconds = sentAt === null ? 0 : Math.max(0, Math.ceil((sentAt + SEND_AGAIN_COOLDOWN_MS - now) / 1000));
  const cooling = seconds > 0;
  useEffect(() => {
    if (!cooling) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [cooling]);

  async function ask(turnstileToken: string) {
    const isResend = resending.current;
    setAskBanner(null);
    try {
      await api.requestSignInCode({ email, locale, turnstileToken });
      countPublicPage({ event: 'sign_in_code_requested', properties: { resend: isResend } });
      const sent = Date.now();
      setSentAt(sent);
      setNow(sent);
      setResent(isResend);
      setRefusal(null);
      setPhase('code');
      window.setTimeout(() => codeRef.current?.focus(), 0);
    } catch (error) {
      const failure = selfServiceFailure(error);
      if (failure.kind === 'unreachable' && isUnexpected(error)) reportBoundaryError(error);
      // Only the page's own bugs (a 404, a refused address shape) land here otherwise: the server checked nothing yet.
      setAskBanner(failure.kind === 'checkFailed' || failure.kind === 'rateLimited' ? failure : { kind: 'unreachable' });
      if (isResend) setPhase('code');
    } finally {
      resending.current = false;
      // The token is spent whatever the answer: the check runs again for the next ask.
      reset();
    }
  }

  /** The first ask failed (offline, a limit, the check): try it again, as a first ask. */
  function retryAsk() {
    setAskBanner(null);
    if (token) return void ask(token);
    if (status === 'failed') return;
    waiting.current = true;
  }

  function onResend() {
    if (cooling || phase === 'signingIn') return;
    resending.current = true;
    setCode('');
    setRefusal(null);
    if (token) return void ask(token);
    if (status === 'failed') return;
    waiting.current = true;
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (phase !== 'code') return;
    if (code.length !== CODE_LENGTH) {
      setCodeMissing(true);
      codeRef.current?.focus();
      return;
    }
    setCodeMissing(false);
    setRefusal(null);
    setPhase('signingIn');
    try {
      const me = await api.signInWithCode({ email, code });
      countPublicPage({ event: 'sign_in_code_signed_in', properties: {} });
      onSignedIn(me);
    } catch (error) {
      const failure = codeFailure(error);
      const reason = refusalReason(failure);
      if (reason) countPublicPage({ event: 'sign_in_code_refused', properties: { reason } });
      else if (isUnexpected(error)) reportBoundaryError(error);
      if (failure.kind === 'underReview') return onUnderReview();
      setRefusal(failure);
      setPhase('code');
      if (failure.kind !== 'wrong') setCode('');
      window.setTimeout(() => codeRef.current?.focus(), 0);
    }
  }

  const bannerId = `${ids}-banner`;
  const codeErrorId = `${ids}-code-error`;
  const checkId = `${ids}-check`;
  const askWait = askBanner?.kind === 'rateLimited' ? waitFor(askBanner.minutes) : null;
  const describedBy = [codeMissing ? codeErrorId : null, refusal || askBanner ? bannerId : null].filter(Boolean).join(' ') || undefined;

  return (
    <form className="hp-card hp-signin-card" noValidate onSubmit={onSubmit} aria-busy={phase !== 'code'}>
      <h1>{t('hosted.signInCode.title')}</h1>
      {phase === 'asking' ? (
        <p className="hp-setup-lead" role="status">
          {t('hosted.signInCode.sending')} <bdi>{email}</bdi>
        </p>
      ) : (
        <p className="hp-setup-lead">
          <SentenceWithEmail sentence={t('hosted.signInCode.lead')} email={email} />
        </p>
      )}

      {resent && !refusal && !askBanner && (
        <div className="hp-banner hp-banner-info" role="status">
          <InfoIcon />
          <span>{t('hosted.signInCode.resent')}</span>
        </div>
      )}

      {(refusal || askBanner) && (
        <div className="hp-banner hp-banner-error" role="alert" id={bannerId}>
          <AlertIcon />
          <span>
            {refusal?.kind === 'wrong' && tp('hosted.signInCode.wrong', refusal.triesLeft)}
            {refusal?.kind === 'expired' && t('hosted.signInCode.expired')}
            {refusal?.kind === 'tooMany' && t('hosted.signInCode.tooMany')}
            {refusal?.kind === 'wait' && tp('hosted.signInCode.wait', refusal.minutes)}
            {(refusal?.kind === 'unreachable' || askBanner?.kind === 'unreachable') && t('hosted.auth.unreachable')}
            {askBanner?.kind === 'checkFailed' && t('hosted.selfService.refused.checkFailed')}
            {askWait && tp(`hosted.selfService.wait.${askWait.unit}`, askWait.count)}
          </span>
        </div>
      )}

      {phase === 'asking' && askBanner && (
        <button type="button" className="btn btn-primary btn-md hp-block" onClick={retryAsk}>
          {t('hosted.signInCode.send')}
        </button>
      )}

      {phase !== 'asking' && (
        <>
          <div className="hp-field">
            <label htmlFor={`${ids}-code`}>{t('hosted.signInCode.code')}</label>
            <input
              ref={codeRef}
              id={`${ids}-code`}
              name="one-time-code"
              className={`input hp-ltr-input hp-code-input ${codeMissing || refusal?.kind === 'wrong' ? 'input-error' : ''}`}
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              maxLength={CODE_LENGTH}
              dir="ltr"
              spellCheck={false}
              readOnly={phase === 'signingIn'}
              value={code}
              aria-invalid={codeMissing || refusal?.kind === 'wrong'}
              aria-describedby={describedBy}
              onChange={(e) => setCode(codeDigits(e.target.value))}
            />
            {codeMissing && (
              <p className="hp-field-error" id={codeErrorId}>
                {t('hosted.signInCode.codeRequired')}
              </p>
            )}
            <p className="hp-field-hint">{t('hosted.selfService.spam')}</p>
          </div>

          <button type="submit" className="btn btn-primary btn-md hp-block" disabled={phase === 'signingIn'} aria-busy={phase === 'signingIn'}>
            {phase === 'signingIn' && <span className="btn-spinner hp-inline-spinner" aria-hidden="true" />}
            <span>{t(phase === 'signingIn' ? 'hosted.auth.submitting' : 'hosted.signInCode.submit')}</span>
          </button>

          <button type="button" className="btn btn-secondary btn-md hp-block" disabled={cooling || phase === 'signingIn'} onClick={onResend}>
            {cooling ? tp('hosted.signInCode.resendIn', seconds) : t('hosted.signInCode.resend')}
          </button>
        </>
      )}

      <TurnstileWidget containerRef={containerRef} status={status} onRetry={retry} id={checkId} />

      <p className="hp-help">
        <button type="button" className="hp-link-button press" onClick={onUsePassword} disabled={phase === 'signingIn'}>
          {t('hosted.signInCode.usePassword')}
        </button>
      </p>
    </form>
  );
}
