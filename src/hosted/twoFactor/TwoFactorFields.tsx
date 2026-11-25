import { useEffect, useId, useState } from 'react';
import { useT } from '../../lib/i18n/core';
import { useTp } from '../../lib/i18n/plural';
import { api, type TwoFactorChallenge } from '../api/client';
import { SentenceWithEmail } from '../pages/auth/CheckEmailNotice';
import { CODE_LENGTH, codeDigits } from '../pages/auth/signInCode';

/** The server's resend budget (D5): one new code every 30 seconds. */
const RESEND_COOLDOWN_MS = 30_000;
import { RECOVERY_CODE_LENGTH, recoveryCodeOf, type TwoFactorInput } from './twoFactor';

/**
 * The second step's one field (MUT-710 wireframes): the 6-digit code (one field, not six boxes: it pastes and autofills,
 * digits left to right in both languages), or a recovery code in its place. The email method also offers a new code,
 * once every 30 seconds (D5). Controlled: the screen around it sends the answer its own way (sign-in, a setup link,
 * Malafat's return, You › Account).
 */

interface TwoFactorFieldsProps {
  challenge: TwoFactorChallenge;
  value: TwoFactorInput;
  onChange: (next: TwoFactorInput) => void;
  /** The field's own error under it: nothing typed yet, or the server refused it. */
  missing?: boolean;
  invalid?: boolean;
  disabled?: boolean;
  /** The banner the field answers to, for `aria-describedby`. */
  describedBy?: string;
  /** "Code" on a sign-in; "Code from your app" in You › Account. */
  codeLabel?: string;
  /** False where a recovery code can't stand in (turning it on proves the new factor itself). */
  allowRecovery?: boolean;
  autoFocus?: boolean;
}

export function TwoFactorFields({ challenge, value, onChange, missing, invalid, disabled, describedBy, codeLabel, allowRecovery = true, autoFocus = true }: TwoFactorFieldsProps) {
  const t = useT();
  const ids = useId();
  const recovery = value.mode === 'recovery';
  const errorId = `${ids}-error`;
  const hintId = `${ids}-hint`;
  const described = [recovery ? hintId : null, missing ? errorId : null, describedBy ?? null].filter(Boolean).join(' ') || undefined;

  return (
    <>
      {!recovery && (
        <p className="hp-setup-lead">
          {challenge.method === 'email' ? <SentenceWithEmail sentence={t('hosted.twoFactor.enterEmail')} email={challenge.emailHint ?? ''} /> : t('hosted.twoFactor.enterApp')}
        </p>
      )}
      <div className="hp-field">
        <label htmlFor={`${ids}-answer`}>{recovery ? t('hosted.twoFactor.recoveryLabel') : (codeLabel ?? t('hosted.twoFactor.code'))}</label>
        {recovery ? (
          <input
            key="recovery"
            id={`${ids}-answer`}
            className={`input hp-ltr-input hp-code-input ${missing || invalid ? 'input-error' : ''}`}
            type="text"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            dir="ltr"
            placeholder="xxxx-xxxx"
            maxLength={RECOVERY_CODE_LENGTH}
            autoFocus
            readOnly={disabled}
            value={value.recoveryCode}
            aria-invalid={missing || invalid}
            aria-describedby={described}
            onChange={(e) => onChange({ ...value, recoveryCode: recoveryCodeOf(e.target.value) })}
          />
        ) : (
          <input
            key="code"
            id={`${ids}-answer`}
            name="one-time-code"
            className={`input hp-ltr-input hp-code-input ${missing || invalid ? 'input-error' : ''}`}
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]*"
            maxLength={CODE_LENGTH}
            dir="ltr"
            spellCheck={false}
            autoFocus={autoFocus}
            readOnly={disabled}
            value={value.code}
            aria-invalid={missing || invalid}
            aria-describedby={described}
            onChange={(e) => onChange({ ...value, code: codeDigits(e.target.value) })}
          />
        )}
        {recovery && (
          <p className="hp-field-hint" id={hintId}>
            {t('hosted.twoFactor.recoveryHint')}
          </p>
        )}
        {missing && (
          <p className="hp-field-error" id={errorId}>
            {t(recovery ? 'hosted.twoFactor.recoveryRequired' : 'hosted.twoFactor.codeRequired')}
          </p>
        )}
      </div>
      {!recovery && challenge.method === 'email' && <ResendCode challengeToken={challenge.challengeToken} disabled={disabled} />}
      {allowRecovery && (
        <p className="hp-help">
          <button type="button" className="hp-link-button press" disabled={disabled} onClick={() => onChange({ ...value, mode: recovery ? 'code' : 'recovery' })}>
            {t(recovery ? 'hosted.twoFactor.useCode' : 'hosted.twoFactor.useRecovery')}
          </button>
        </p>
      )}
    </>
  );
}

/** "Send a new code" for the email method: the server mailed one with the challenge, so it starts cooling down. */
function ResendCode({ challengeToken, disabled }: { challengeToken: string; disabled?: boolean }) {
  const t = useT();
  const tp = useTp();
  const [sentAt, setSentAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle');
  const seconds = Math.max(0, Math.ceil((sentAt + RESEND_COOLDOWN_MS - now) / 1000));
  const cooling = seconds > 0;

  useEffect(() => {
    if (!cooling) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [cooling]);

  async function resend() {
    if (cooling || state === 'sending') return;
    setState('sending');
    try {
      await api.resendTwoFactorCode(challengeToken);
      setState('sent');
    } catch {
      setState('failed');
    } finally {
      const sent = Date.now();
      setSentAt(sent);
      setNow(sent);
    }
  }

  return (
    <p className="hp-help">
      <button type="button" className="hp-link-button press" disabled={disabled || cooling || state === 'sending'} onClick={() => void resend()}>
        {cooling ? tp('hosted.twoFactor.resendIn', seconds) : t('hosted.twoFactor.resend')}
      </button>
      {state === 'sent' && (
        <span role="status" className="hp-field-hint">
          {' '}
          {t('hosted.twoFactor.resent')}
        </span>
      )}
      {state === 'failed' && (
        <span role="alert" className="hp-field-error">
          {' '}
          {t('hosted.twoFactor.resendFailed')}
        </span>
      )}
    </p>
  );
}
