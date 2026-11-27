import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useT } from '../../../lib/i18n/core';
import type { Me } from '../../api/client';
import { trackPortal } from '../../analytics/portalAnalytics';
import { useToast } from '../../components/Toast';
import { useAnswerPasskeyPrompt } from '../../data/passkeyPromptQueries';
import { addPasskeyFlow, passkeysChanged, type AddPasskeyOutcome } from '../../passkeys/addPasskey';
import { ME_KEY, ME_TIMEOUT_MS } from '../../session/me';

/**
 * MUT-619: the last step of `/setup`, once the password is set and the person is signed in: "Create a passkey so you
 * won't need to type your password", with Not now. Shown only when `passkeyOfferable` (the MUT-370 rules, the same
 * `passkeyPrompt` record), so Not now here spends one of the Home card's three offers. The password stays (ADR-159 d9).
 *
 * Create runs MUT-115's ceremony with no password (the sign-in is seconds old). A cancelled or failed ceremony says so
 * and keeps both choices: setup never gets stuck on the passkey. Not now waits for its answer to be saved (at most as
 * long as a session check), so Home never shows the card in between, and goes on even when the save fails or hangs.
 *
 * `password`: the one just set. Adding needs none within 10 minutes of the sign-in; past that (a person who left the
 * step open) the server asks for it, and the step sends it once rather than failing.
 */

/** Which setup link set the password: the analytics contract's `link`. */
export type SetupLinkKind = 'setup' | 'reset' | 'signup';
type Problem = 'cancelled' | 'failed';

/** After a passkey is added: Home must not show the MUT-370 card from the cached /v1/me before its refetch lands. */
function markPasskeyHeld(queryClient: QueryClient) {
  queryClient.setQueryData<Me>(ME_KEY, (current) => {
    const prompt = current?.user.passkeyPrompt;
    return current && prompt ? { ...current, user: { ...current.user, passkeyPrompt: { ...prompt, due: false } } } : current;
  });
}

/** Resolves after `ms`, so a save that never answers can't hold the page. */
const giveUpAfter = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** The contract's `reason` for a ceremony that ended without a passkey. */
function reasonOf(outcome: Exclude<AddPasskeyOutcome, { kind: 'added' }>): 'cancelled' | 'offline' | 'other' {
  if (outcome.kind === 'cancelled') return 'cancelled';
  return outcome.kind === 'unreachable' ? 'offline' : 'other';
}

/** `art` (MUT-769): what sits above the title, e.g. the hand-over moment once an accountant's customer claims. */
export function SetupPasskeyStep({ link, password, onDone, art }: { link: SetupLinkKind; password?: string; onDone: () => void; art?: ReactNode }) {
  const t = useT();
  const ids = useId();
  const showToast = useToast();
  const queryClient = useQueryClient();
  const answer = useAnswerPasskeyPrompt();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const offerCounted = useRef(false);
  const [adding, setAdding] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const busy = adding || leaving;

  useEffect(() => {
    // The form this replaces held the focus; a screen reader hears the new step from its heading.
    headingRef.current?.focus();
    // Once per step, also under StrictMode's double effect
    if (offerCounted.current) return;
    offerCounted.current = true;
    void trackPortal('setup_passkey_offered', { link });
  }, [link]);

  async function create() {
    if (busy) return;
    setProblem(null);
    setAdding(true);
    let outcome = await addPasskeyFlow();
    if (outcome.kind === 'stepUp' && password) outcome = await addPasskeyFlow(password);
    if (outcome.kind === 'added') {
      setLeaving(true);
      void trackPortal('setup_passkey_created', { link });
      showToast(t('hosted.account.passkeys.added'), { tone: 'info' });
      markPasskeyHeld(queryClient);
      void passkeysChanged(queryClient);
      return onDone();
    }
    setAdding(false);
    void trackPortal('setup_passkey_not_created', { link, reason: reasonOf(outcome) });
    // `stepUp`, `operatorPasskeyFirst`, `limit`, `wrongPassword` can't happen seconds after a first sign-in; all read as a failure.
    setProblem(outcome.kind === 'cancelled' ? 'cancelled' : 'failed');
  }

  async function notNow() {
    if (busy) return;
    setLeaving(true);
    void trackPortal('setup_passkey_not_now', { link });
    // A failed save only means the Home card may show once more on a later visit (MUT-370's own Not now rule).
    await Promise.race([answer.mutateAsync('not-now').catch(() => undefined), giveUpAfter(ME_TIMEOUT_MS)]);
    onDone();
  }

  const titleId = `${ids}-title`;
  return (
    <section className="hp-card hp-signin-card" aria-labelledby={titleId}>
      {art}
      <h1 id={titleId} ref={headingRef} tabIndex={-1}>
        {t('hosted.setup.passkey.title')}
      </h1>
      <p className="hp-setup-lead">{t('hosted.setup.passkey.lead')}</p>
      {problem && (
        <p className="hp-field-error" role="alert">
          {t(`hosted.setup.passkey.${problem}`)}
        </p>
      )}
      <button type="button" className="btn btn-primary btn-md hp-block" onClick={() => void create()} disabled={busy} aria-busy={adding}>
        {adding && <span className="btn-spinner hp-inline-spinner" aria-hidden="true" />}
        <span>{t('hosted.setup.passkey.create')}</span>
      </button>
      <button type="button" className="btn btn-secondary btn-md hp-block" onClick={() => void notNow()} disabled={busy} aria-busy={leaving && !adding}>
        {t('hosted.setup.passkey.notNow')}
      </button>
    </section>
  );
}
