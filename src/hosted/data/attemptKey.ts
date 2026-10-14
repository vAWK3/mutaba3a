import { useState } from 'react';

/**
 * One Idempotency-Key per save *attempt*, not per click (MUT-133, eng review
 * §3.6 / D5). Minting a fresh key inside every `mutationFn` meant a Save that
 * timed out after the write landed, then Save again, wrote twice. Here the key
 * is reused while the body is unchanged, so the server replays the first
 * result. A changed body is a new intent and gets a new key (reusing it would
 * earn 422 IDEMPOTENCY_KEY_REUSED), and a success ends the attempt.
 */
export interface AttemptKey {
  keyFor(body: unknown): string;
  succeeded(): void;
}

export function createAttemptKey(mint: () => string = () => crypto.randomUUID()): AttemptKey {
  let lastBody: string | null = null;
  let key: string | null = null;
  return {
    keyFor(body) {
      const serialized = JSON.stringify(body);
      if (key === null || serialized !== lastBody) {
        key = mint();
        lastBody = serialized;
      }
      return key;
    },
    succeeded() {
      key = null;
      lastBody = null;
    },
  };
}

/** The attempt for one mounted drawer; a remounted drawer starts a new one. */
export function useAttemptKey(): AttemptKey {
  const [attempt] = useState(createAttemptKey);
  return attempt;
}
