import { useId, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '../../components/ui/Button';
import { useT } from '../../lib/i18n/core';
import { addPasskeyFlow, passkeysChanged } from '../passkeys/addPasskey';
import { passkeySupport } from '../passkeys/webauthn';
import { trialWelcomeDue } from '../data/trialPrompt';
import { useMe } from '../session/me';
import { useIsLocalMode } from '../session/mode';
import { useAccountDrawers } from '../shell/AccountDrawers';
import { PasskeyIcon } from './Icons';
import { useToast } from './Toast';

/** This device's "Not now", per person; storage may be blocked (private windows), which only means the card returns. */
const dismissedKey = (userId: string) => `mtb3a.secondWayIn.dismissed.${userId}`;

function dismissedHere(userId: string): boolean {
  try {
    return window.localStorage.getItem(dismissedKey(userId)) !== null;
  } catch {
    return false;
  }
}

/**
 * MUT-596 (ADR-254 D5): the Home card for an account Sign in with Malafat created, while it has no way in of its own
 * (`ownSignIn` false): add a passkey, or set a password, as a second, secure way into MTB3A beside Malafat (Basel's copy:
 * a backup way in, never "if Malafat stops"). It takes MUT-370's passkey card's place and shape. The passkey needs a
 * recent sign-in; past that, the person signs in with Malafat again (there is no password to step up with). Set a
 * password opens Change password, which then asks for no current one. Not now hides it on this device.
 */
export function SecondWayIn() {
  const me = useMe();
  const local = useIsLocalMode();
  const [dismissed, setDismissed] = useState(() => dismissedHere(me.user.id));
  // After the trial's first-run step, like the passkey card (MUT-370 D4).
  if (local || me.user.ownSignIn || me.user.closure || dismissed || trialWelcomeDue(me, new Date())) return null;
  return (
    <SecondWayInCard
      onNotNow={() => {
        try {
          window.localStorage.setItem(dismissedKey(me.user.id), new Date().toISOString());
        } catch {
          // Storage blocked: hidden for this visit only.
        }
        setDismissed(true);
      }}
    />
  );
}

type Problem = 'failed' | 'unreachable' | 'signInAgain';
const PROBLEM_KEYS: Record<Problem, string> = { failed: 'hosted.account.passkeys.addFailed', unreachable: 'hosted.auth.unreachable', signInAgain: 'hosted.secondWayIn.signInAgain' };

function SecondWayInCard({ onNotNow }: { onNotNow: () => void }) {
  const t = useT();
  const ids = useId();
  const showToast = useToast();
  const queryClient = useQueryClient();
  const drawers = useAccountDrawers();
  const [adding, setAdding] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);

  async function add() {
    if (adding) return;
    setProblem(null);
    setAdding(true);
    const outcome = await addPasskeyFlow();
    setAdding(false);
    switch (outcome.kind) {
      case 'added':
        showToast(t('hosted.account.passkeys.added'), { tone: 'info' });
        // /v1/me then says ownSignIn, and the card goes.
        await passkeysChanged(queryClient);
        return;
      case 'cancelled':
        return;
      case 'stepUp':
        setProblem('signInAgain');
        return;
      case 'unreachable':
        setProblem('unreachable');
        return;
      default:
        setProblem('failed');
    }
  }

  const titleId = `${ids}-title`;
  return (
    <section className="hp-banner hp-banner-info hp-passkey-suggest" aria-labelledby={titleId}>
      <PasskeyIcon />
      <div className="hp-passkey-suggest-body">
        <p className="hp-passkey-suggest-title" id={titleId}>
          {t('hosted.secondWayIn.title')}
        </p>
        <p className="hp-passkey-suggest-note">{t('hosted.secondWayIn.lead')}</p>
        {problem && (
          <p className="hp-passkey-suggest-problem" role="alert">
            {t(PROBLEM_KEYS[problem])}
          </p>
        )}
        <div className="hp-passkey-suggest-actions">
          {passkeySupport() && (
            <Button size="sm" onClick={() => void add()} isLoading={adding} keepLabelWhileLoading aria-busy={adding}>
              {t('hosted.secondWayIn.addPasskey')}
            </Button>
          )}
          <Button size="sm" variant={passkeySupport() ? 'secondary' : 'primary'} onClick={drawers.open} disabled={adding}>
            {t('hosted.secondWayIn.setPassword')}
          </Button>
          <button type="button" className="hp-link-button" onClick={onNotNow} disabled={adding}>
            {t('hosted.secondWayIn.notNow')}
          </button>
        </div>
      </div>
    </section>
  );
}
