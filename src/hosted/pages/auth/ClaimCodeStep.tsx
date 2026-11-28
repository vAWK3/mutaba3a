import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { useT } from '../../../lib/i18n/core';
import { useTp } from '../../../lib/i18n/plural';
import { api } from '../../api/client';
import { AlertIcon } from '../../components/Icons';
import { PinBoxes } from '../../components/PinBoxes';
import { Scene } from '../../components/Scene';
import { CLAIM_CODE_LENGTH, claimCodeFailure, claimContextKey, type ClaimCodeFailure, type ClaimContext } from './claimStep';

/**
 * MUT-769 (DR-1, DR-7; ACCT-6): the first step of `/setup` for an account an accountant created. The context line
 * says who set it up and for which business (the `handover-welcome` scene beside it), then the six-digit code the
 * accountant said: one box per digit, LTR, "Digit n of 6", a paste fills all. A wrong code says the tries left; the
 * fifth locks it (`onLocked`: the page shows the `code-locked` screen). The code is checked on its own route before
 * the password (B9), and sent again with the password.
 */

export function ClaimContextLine({ claim }: { claim: ClaimContext }) {
  const t = useT();
  const { key, vars } = claimContextKey(claim);
  return (
    <div className="hp-claim-context">
      <Scene name="handover-welcome" size={120} />
      <p className="hp-claim-context-line">{t(key, vars)}</p>
    </div>
  );
}

export function ClaimStepCount({ step }: { step: 1 | 2 | 3 }) {
  const t = useT();
  return (
    <p className="hp-claim-steps">
      <span className="sr-only">{t('hosted.accountantChannel.claim.step', { n: step, total: 3 })}</span>
      {[1, 2, 3].map((n) => (
        <span key={n} className={`hp-claim-step${n <= step ? ' hp-claim-step-on' : ''}`} aria-hidden="true" />
      ))}
    </p>
  );
}

const requestTimeout = () => AbortSignal.timeout(15_000);

export function ClaimCodeStep({ token, claim, onVerified, onLocked }: { token: string; claim: ClaimContext; onVerified: (code: string) => void; onLocked: () => void }) {
  const t = useT();
  const tp = useTp();
  const ids = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ClaimCodeFailure | null>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  async function verify(event?: FormEvent) {
    event?.preventDefault();
    if (busy) return;
    if (code.length !== CLAIM_CODE_LENGTH) return setFailure({ kind: 'required' });
    setBusy(true);
    setFailure(null);
    try {
      await api.checkClaimCode({ token, claimCode: code }, requestTimeout());
      onVerified(code);
    } catch (error) {
      const next = claimCodeFailure(error);
      if (next.kind === 'locked') return onLocked();
      // A link that carries no code (409 NO_CLAIM_CODE) needs none: go on to the password.
      if (next.kind === 'noCode') return onVerified('');
      setFailure(next);
      setCode('');
      setBusy(false);
    }
  }

  const errorId = `${ids}-error`;
  return (
    <form className="hp-card hp-signin-card hp-claim-card" noValidate onSubmit={(event) => void verify(event)}>
      <ClaimContextLine claim={claim} />
      <ClaimStepCount step={1} />
      <h1 id={`${ids}-title`} ref={headingRef} tabIndex={-1}>
        {t('hosted.accountantChannel.claim.codeTitle')}
      </h1>
      {failure && (
        <div className="hp-banner hp-banner-error" role="alert" id={errorId}>
          <AlertIcon />
          <span>
            {failure.kind === 'wrong' && tp('hosted.accountantChannel.claim.wrong', failure.triesLeft)}
            {failure.kind === 'required' && t('hosted.accountantChannel.claim.required')}
            {failure.kind === 'rateLimited' && tp('hosted.auth.rateLimited', failure.minutes)}
            {failure.kind === 'unreachable' && t('hosted.auth.unreachable')}
          </span>
        </div>
      )}
      <PinBoxes
        value={code}
        onChange={(next) => {
          setCode(next);
          if (failure?.kind === 'required') setFailure(null);
        }}
        label={t('hosted.accountantChannel.claim.codeTitle')}
        boxLabel={(n, total) => t('hosted.accountantChannel.claim.digit', { n, total })}
        length={CLAIM_CODE_LENGTH}
        onSubmit={() => void verify()}
        invalid={failure?.kind === 'wrong' || failure?.kind === 'required'}
        disabled={busy}
        describedBy={failure ? errorId : undefined}
      />
      <button type="submit" className="btn btn-primary btn-md hp-block" disabled={busy} aria-busy={busy}>
        {busy && <span className="btn-spinner hp-inline-spinner" aria-hidden="true" />}
        <span>{t(busy ? 'hosted.accountantChannel.claim.verifying' : 'hosted.accountantChannel.claim.verify')}</span>
      </button>
    </form>
  );
}

/** The `code-locked` and dead-link screens of a provisioned link: the scene, one title, what to do. */
export function ClaimDeadEnd({ kind }: { kind: 'locked' | 'dead' }) {
  const t = useT();
  return (
    <section className="hp-card hp-signin-card hp-claim-card" role={kind === 'locked' ? 'alert' : undefined}>
      <Scene name={kind === 'locked' ? 'code-locked' : 'link-expired'} size={120} />
      <h1>{t(`hosted.accountantChannel.claim.${kind}.title`)}</h1>
      <p className="hp-setup-lead">{t(`hosted.accountantChannel.claim.${kind}.body`)}</p>
    </section>
  );
}
