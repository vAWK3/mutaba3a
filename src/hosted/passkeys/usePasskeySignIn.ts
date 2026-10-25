import { useCallback, useEffect, useRef, useState } from 'react';
import type { PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/browser';
import { api, type Me, type Schemas } from '../api/client';
import { assertPasskey, cancelPasskeyCeremony, passkeyAutofillSupport, passkeySupport } from './webauthn';

/**
 * MUT-115 (§11.4, DR1, DR4): passkey sign-in on /sign-in. Two ways in, one result:
 *  - the "Sign in with a passkey" button;
 *  - autofill: the email field's suggestions offer this site's passkeys (conditional mediation), armed on mount and
 *    re-armed before its challenge expires (the server keeps one 5 minutes).
 * Starting the button aborts the autofill wait (SimpleWebAuthn's abort service); the password form calls `pause()`
 * before it submits and `resume()` if that fails. A cancelled sheet shows nothing. A passkey the server refused through
 * autofill is not offered again on its own (review: no retry loop).
 */
export const AUTOFILL_REARM_MS = 4.5 * 60_000;

/** The platform refused for a reason other than a cancel (e.g. a security error): shown like a refused passkey. */
export class PasskeyCeremonyError extends Error {
  constructor() {
    super('The passkey ceremony failed');
    this.name = 'PasskeyCeremonyError';
  }
}

export interface PasskeySignInHandlers {
  onSignedIn: (me: Me) => void;
  /** Any refusal the page shows: an ApiError from the server, or a network failure. */
  onError: (error: unknown) => void;
}

export function usePasskeySignIn({ onSignedIn, onError }: PasskeySignInHandlers) {
  const [supported] = useState(() => passkeySupport());
  const [pending, setPending] = useState(false);
  const handlers = useRef({ onSignedIn, onError });
  useEffect(() => {
    handlers.current = { onSignedIn, onError };
  });
  /** Whether the autofill wait may run: off while the button or the password form has the floor. */
  const autofillAllowed = useRef(true);
  const [autofillRun, setAutofillRun] = useState(0);

  const finish = useCallback(async (challengeId: string, response: Schemas['PasskeySignInRequest']['response']) => {
    const me = await api.signInWithPasskey({ challengeId, response });
    handlers.current.onSignedIn(me);
  }, []);

  useEffect(() => {
    if (!supported) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    void (async () => {
      if (!(await passkeyAutofillSupport()) || stopped || !autofillAllowed.current) return;
      let challenge: Schemas['PasskeySignInChallenge'];
      try {
        challenge = await api.passkeyChallenge();
      } catch {
        return; // Autofill is a convenience: a failed challenge leaves the button and the password.
      }
      if (stopped || !autofillAllowed.current) return;
      timer = setTimeout(() => {
        cancelPasskeyCeremony();
        setAutofillRun((n) => n + 1);
      }, AUTOFILL_REARM_MS);
      const outcome = await assertPasskey(challenge.publicKey as PublicKeyCredentialRequestOptionsJSON, true);
      clearTimeout(timer);
      if (stopped || outcome.kind !== 'ok') return;
      autofillAllowed.current = false;
      setPending(true);
      try {
        await finish(challenge.challengeId, outcome.response as Schemas['PasskeySignInRequest']['response']);
      } catch (error) {
        // Not re-armed: an authenticator that answers the field by itself would otherwise retry a refused passkey in a
        // loop, each failure counting toward the account's lockout. The button and the password stay.
        handlers.current.onError(error);
      } finally {
        setPending(false);
      }
    })();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      cancelPasskeyCeremony();
    };
  }, [supported, autofillRun, finish]);

  /** The button: a fresh challenge and the system sheet. */
  const start = useCallback(async () => {
    if (pending) return;
    autofillAllowed.current = false;
    setPending(true);
    try {
      const challenge = await api.passkeyChallenge();
      const outcome = await assertPasskey(challenge.publicKey as PublicKeyCredentialRequestOptionsJSON);
      if (outcome.kind === 'ok') {
        await finish(challenge.challengeId, outcome.response as Schemas['PasskeySignInRequest']['response']);
        return;
      }
      if (outcome.kind === 'failed') handlers.current.onError(new PasskeyCeremonyError());
    } catch (error) {
      handlers.current.onError(error);
    } finally {
      setPending(false);
    }
    autofillAllowed.current = true;
    setAutofillRun((n) => n + 1);
  }, [pending, finish]);

  /** The password form takes the floor: end the autofill wait. */
  const pause = useCallback(() => {
    autofillAllowed.current = false;
    cancelPasskeyCeremony();
  }, []);

  /** The password attempt failed: offer passkeys in the field again. */
  const resume = useCallback(() => {
    autofillAllowed.current = true;
    setAutofillRun((n) => n + 1);
  }, []);

  return { supported, pending, start, pause, resume };
}
