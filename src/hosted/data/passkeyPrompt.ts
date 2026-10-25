import type { Me, PasskeyPrompt } from '../api/client';
import { trialWelcomeDue } from './trialPrompt';

/**
 * MUT-370: the Home card "Add a passkey: the more secure way to sign in". The server decides whether it is due (no
 * passkey, an offer left, not hidden: server/src/auth/passkey-prompt.ts); the portal adds only what the server can't
 * know. Pure, so every branch is a unit test.
 */

/** Mirrors the server's PASSKEY_PROMPT_MAX_OFFERS and PASSKEY_PROMPT_HIDE_DAYS, for the optimistic write only. */
const MAX_OFFERS = 3;
const HIDE_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface SuggestionContext {
  /** `passkeySupport()`: a WebAuthn browser on a host under the build's relying party. */
  supported: boolean;
  /** The portal's signed-out local mode has no passkeys. */
  local: boolean;
  now: Date;
}

/**
 * Show the card: the server says due, this device can make a passkey, the account isn't closing, and MUT-418's
 * first-run trial step has been answered (D4: the trial step comes first; the card then sits under the trial banner).
 * A hide written a moment ago (optimistic) counts before the server's answer arrives.
 */
export function passkeySuggestionShows(me: Me, { supported, local, now }: SuggestionContext): boolean {
  const prompt = me.user.passkeyPrompt;
  if (!supported || local || !prompt?.due || me.user.closure) return false;
  if (prompt.hiddenUntil && new Date(prompt.hiddenUntil).getTime() > now.getTime()) return false;
  return !trialWelcomeDue(me, now);
}

/**
 * What the cached /v1/me should say the moment the person presses Not now, before the server does (its answer then
 * replaces it). A failed write only means the card may show once more on the next visit.
 */
export function optimisticPasskeyPrompt(current: PasskeyPrompt | null | undefined, now: Date): PasskeyPrompt | null {
  if (!current) return null;
  return { due: false, notNowCount: Math.min(current.notNowCount + 1, MAX_OFFERS), hiddenUntil: new Date(now.getTime() + HIDE_DAYS * DAY_MS).toISOString() };
}
