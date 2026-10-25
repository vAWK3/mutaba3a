import type { PasskeyPromptRecord } from '../repositories/ports.js';

/**
 * MUT-370 (ADR-191, D1–D3): the "Add a passkey: the more secure way to sign in" suggestion, kept on the person's user
 * row (`users.passkeyPrompt`, the MUT-418 `trialPrompt` pattern) so its rules hold on the portal and the phone alike.
 *
 * An offer lasts until the person answers it (D2): the card shows on every visit until **Not now**, which hides it for
 * 30 days and spends that offer. After the third Not now it never shows again, nor while a passkey exists. The server
 * decides `due` (D3); clients add only their own device check and their first-run order.
 */

/** "Offered at most three times" (ticket). */
export const PASSKEY_PROMPT_MAX_OFFERS = 3;
/** "Not now hides it for 30 days" (ticket). */
export const PASSKEY_PROMPT_HIDE_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface PasskeyPromptView extends PasskeyPromptRecord {
  /** Show the suggestion now: no passkey, an offer left, and not hidden. */
  due: boolean;
}

/** The stored value, tolerant of NULL and of anything malformed: a field that doesn't parse reads as never set. */
export function resolvePasskeyPrompt(stored: unknown): PasskeyPromptRecord {
  const value = stored && typeof stored === 'object' && !Array.isArray(stored) ? (stored as Record<string, unknown>) : {};
  const count = value.notNowCount;
  const notNowCount = typeof count === 'number' && Number.isInteger(count) && count >= 0 ? Math.min(count, PASSKEY_PROMPT_MAX_OFFERS) : 0;
  return { notNowCount, hiddenUntil: instant(value.hiddenUntil) };
}

/**
 * Not now: spends the current offer and hides the card for 30 days from `at`. Only a due offer is spent: while the
 * card is already hidden (two devices answering one offer), past the last offer, or once the person holds a passkey (a
 * stale card in another tab), nothing changes.
 */
export function applyPasskeyNotNow(stored: unknown, at: Date, passkeys: number): PasskeyPromptRecord {
  const current = resolvePasskeyPrompt(stored);
  if (!passkeyPromptView(current, passkeys, at).due) return current;
  return { notNowCount: current.notNowCount + 1, hiddenUntil: new Date(at.getTime() + PASSKEY_PROMPT_HIDE_DAYS * DAY_MS).toISOString() };
}

/**
 * What /v1/me says. `passkeys`: how many the person holds now (D11: removing every one brings the offer back). Never
 * due to a closing account, which reaches no passkey route (MUT-333).
 */
export function passkeyPromptView(stored: unknown, passkeys: number, now: Date, closing = false): PasskeyPromptView {
  const record = resolvePasskeyPrompt(stored);
  const due = !closing && passkeys === 0 && record.notNowCount < PASSKEY_PROMPT_MAX_OFFERS && !isHidden(record, now);
  return { due, ...record };
}

function isHidden(record: PasskeyPromptRecord, at: Date): boolean {
  return record.hiddenUntil !== null && new Date(record.hiddenUntil).getTime() > at.getTime();
}

function instant(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : new Date(time).toISOString();
}
