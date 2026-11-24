import { useId, useState, type FormEvent } from 'react';
import { useT } from '../../lib/i18n/core';
import { useTp } from '../../lib/i18n/plural';
import { ApiError, type TwoFactorChallenge } from '../api/client';
import { AlertIcon } from '../components/Icons';
import { reportBoundaryError } from '../observability/errorReporting';
import { TwoFactorFields } from './TwoFactorFields';
import { answerOf, EMPTY_TWO_FACTOR_INPUT, endsTheTry, twoFactorFailure, type TwoFactorAnswer, type TwoFactorFailure } from './twoFactor';

/**
 * The second step of a sign-in (MUT-710 D1, wireframe "Sign in"): shown in the first step's place after the password, a
 * passkey, an emailed sign-in code or Malafat's return, with nothing signed in yet. `submit` finishes the sign-in its own
 * way and throws the server's refusal; a wrong code says how many tries are left, and an ended try (five wrong codes, or
 * ten minutes) offers only the way back.
 */

interface TwoFactorStepProps {
  challenge: TwoFactorChallenge;
  submit: (answer: TwoFactorAnswer) => Promise<void>;
  /** Back to the first step: "Back to sign in". */
  onRestart: () => void;
  restartLabel: string;
}

export function TwoFactorStep({ challenge, submit, onRestart, restartLabel }: TwoFactorStepProps) {
  const t = useT();
  const tp = useTp();
  const ids = useId();
  const [input, setInput] = useState(EMPTY_TWO_FACTOR_INPUT);
  const [missing, setMissing] = useState(false);
  const [failure, setFailure] = useState<TwoFactorFailure | null>(null);
  const [pending, setPending] = useState(false);
  const ended = failure !== null && endsTheTry(failure);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (pending || ended) return;
    const answer = answerOf(input);
    if (!answer) return setMissing(true);
    setMissing(false);
    setFailure(null);
    setPending(true);
    try {
      await submit(answer);
    } catch (error) {
      const refused = twoFactorFailure(error);
      // A server fault is worth a report; being offline is not (as SignInCodeStep).
      if (refused.kind === 'unreachable' && (!(error instanceof ApiError) || error.status >= 500)) reportBoundaryError(error);
      setFailure(refused);
      setInput((current) => ({ ...current, code: '', recoveryCode: refused.kind === 'wrong' ? '' : current.recoveryCode }));
      setPending(false);
    }
  }

  const bannerId = `${ids}-banner`;
  return (
    <form className="hp-card hp-signin-card" noValidate onSubmit={onSubmit} aria-busy={pending}>
      <h1>{t('hosted.twoFactor.title')}</h1>
      {failure && (
        <div className="hp-banner hp-banner-error" role="alert" id={bannerId}>
          <AlertIcon />
          <span>
            {failure.kind === 'wrong' && tp('hosted.twoFactor.wrong', failure.triesLeft)}
            {failure.kind === 'tooMany' && t('hosted.twoFactor.tooMany')}
            {failure.kind === 'expired' && t('hosted.twoFactor.expired')}
            {failure.kind === 'wait' && tp('hosted.signInCode.wait', failure.minutes)}
            {failure.kind === 'unreachable' && t('hosted.auth.unreachable')}
          </span>
        </div>
      )}
      {ended ? (
        <button type="button" className="btn btn-primary btn-md hp-block" onClick={onRestart}>
          {restartLabel}
        </button>
      ) : (
        <>
          <TwoFactorFields
            challenge={challenge}
            value={input}
            onChange={(next) => {
              setInput(next);
              setMissing(false);
            }}
            missing={missing}
            invalid={failure?.kind === 'wrong'}
            disabled={pending}
            describedBy={failure ? bannerId : undefined}
          />
          <button type="submit" className="btn btn-primary btn-md hp-block" disabled={pending} aria-busy={pending}>
            {pending && <span className="btn-spinner hp-inline-spinner" aria-hidden="true" />}
            <span>{t(pending ? 'hosted.auth.submitting' : 'hosted.twoFactor.continue')}</span>
          </button>
          <p className="hp-help">
            <button type="button" className="hp-link-button press" disabled={pending} onClick={onRestart}>
              {restartLabel}
            </button>
          </p>
        </>
      )}
    </form>
  );
}
