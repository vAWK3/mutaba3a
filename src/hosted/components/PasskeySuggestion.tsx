import { useId, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '../../components/ui/Button';
import { useT } from '../../lib/i18n/core';
import { passkeySuggestionShows } from '../data/passkeyPrompt';
import { useAnswerPasskeyPrompt } from '../data/passkeyPromptQueries';
import { addPasskeyFlow, passkeysChanged } from '../passkeys/addPasskey';
import { passkeySupport } from '../passkeys/webauthn';
import { useMe } from '../session/me';
import { useIsLocalMode } from '../session/mode';
import { useAccountDrawers } from '../shell/AccountDrawers';
import { PasskeyIcon } from './Icons';
import { useToast } from './Toast';

/**
 * MUT-370 (ADR-191): the Home card "Add a passkey: the more secure way to sign in. Your password still works." after a
 * sign-in, while the server says it is due (no passkey, an offer left, not hidden) and this device can make one. It
 * waits for MUT-418's first-run trial step (D4) and sits under the trial banner.
 *
 * Add a passkey runs MUT-115's ceremony (`addPasskeyFlow`) with no password: right after a sign-in none is needed. An
 * older sign-in gets `stepUp`, and the card hands over to You › Account › Passkeys, where the password step lives (D6).
 * Not now hides it for 30 days on every device (D2).
 */
export function PasskeySuggestion() {
  const me = useMe();
  const local = useIsLocalMode();
  return passkeySuggestionShows(me, { supported: passkeySupport(), local, now: new Date() }) ? <SuggestionCard /> : null;
}

type Problem = 'failed' | 'unreachable';
const PROBLEM_KEYS: Record<Problem, string> = { failed: 'hosted.account.passkeys.addFailed', unreachable: 'hosted.auth.unreachable' };

function SuggestionCard() {
  const t = useT();
  const ids = useId();
  const showToast = useToast();
  const queryClient = useQueryClient();
  const drawers = useAccountDrawers();
  const answer = useAnswerPasskeyPrompt();
  const [adding, setAdding] = useState(false);
  // Code review: once added, the card is done, even before /v1/me says so (no second ceremony on a slow refetch)
  const [added, setAdded] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const busy = adding || answer.isPending;

  async function add() {
    if (busy) return;
    setProblem(null);
    setAdding(true);
    const outcome = await addPasskeyFlow();
    setAdding(false);
    switch (outcome.kind) {
      case 'added':
        setAdded(true);
        showToast(t('hosted.account.passkeys.added'), { tone: 'info' });
        await passkeysChanged(queryClient);
        return;
      case 'cancelled':
        return;
      case 'stepUp':
        drawers.openPasskeys();
        return;
      case 'unreachable':
        setProblem('unreachable');
        return;
      default:
        // `limit` and `wrongPassword` can't happen with no passkey and no password; they read as a plain failure.
        setProblem('failed');
    }
  }

  const titleId = `${ids}-title`;
  if (added) return null;
  return (
    <section className="hp-banner hp-banner-info hp-passkey-suggest" aria-labelledby={titleId}>
      <PasskeyIcon />
      <div className="hp-passkey-suggest-body">
        <p className="hp-passkey-suggest-title" id={titleId}>
          {t('hosted.passkeys.suggest.title')}
        </p>
        <p className="hp-passkey-suggest-note">{t('hosted.passkeys.suggest.note')}</p>
        {problem && (
          <p className="hp-passkey-suggest-problem" role="alert">
            {t(PROBLEM_KEYS[problem])}
          </p>
        )}
        <div className="hp-passkey-suggest-actions">
          <Button size="sm" onClick={() => void add()} isLoading={adding} keepLabelWhileLoading aria-busy={adding} disabled={answer.isPending}>
            {t('hosted.passkeys.suggest.add')}
          </Button>
          <button type="button" className="hp-link-button" onClick={() => answer.mutate('not-now')} disabled={busy}>
            {t('hosted.passkeys.suggest.notNow')}
          </button>
        </div>
      </div>
    </section>
  );
}
