import type { AuthenticationResponseJSON } from '@simplewebauthn/server';
import { ApiError } from '../errors.js';
import type { LedgerStore, SessionRecord, UserRecord } from '../repositories/ports.js';
import { CHALLENGE_TTL_MS, STEP_UP_WINDOW_MS, stepUpOptions, verifyAssertion, type WebauthnConfig } from './webauthn.js';

/**
 * MUT-459 (ADR-208, D7): an operator's step-up is passkey-only. A write passes while either is under 10 minutes old:
 *
 *   - the session itself was opened with a passkey (`passkeyId` set; `createdAt` is that sign-in), or
 *   - the session's last passkey step-up (`stepUpAt`).
 *
 * A fresh password sign-in never counts: the password alone was the admin token's weakest substitute. The step-up
 * stamps its own column and never `credentialsVerifiedAt`, which the password-change revocation reads (MUT-238): a
 * step-up must not revive a session a password change or a setup-link lock just ended.
 */
export const OPERATOR_STEP_UP_WINDOW_MS = STEP_UP_WINDOW_MS;

/** When this session's operator step-up lapses, or null when it already has (or there never was one). */
export function operatorStepUpUntil(session: Pick<SessionRecord, 'passkeyId' | 'createdAt' | 'stepUpAt'>, now: Date): Date | null {
  const proofs = [session.passkeyId ? session.createdAt : null, session.stepUpAt].filter((d): d is Date => d !== null);
  if (proofs.length === 0) return null;
  const until = new Date(Math.max(...proofs.map((d) => d.getTime())) + OPERATOR_STEP_UP_WINDOW_MS);
  return until.getTime() > now.getTime() ? until : null;
}

/** 403 RECENT_SIGN_IN_REQUIRED `{ method: 'passkey', windowMinutes }` unless the session's step-up is fresh. */
export function assertOperatorStepUp(session: SessionRecord, now: Date): void {
  if (operatorStepUpUntil(session, now)) return;
  throw new ApiError('RECENT_SIGN_IN_REQUIRED', 'Confirm it’s you with your passkey', { method: 'passkey', windowMinutes: OPERATOR_STEP_UP_WINDOW_MS / 60_000 });
}

/** The options for `navigator.credentials.get()`: a single-use challenge bound to this person, offering their passkeys. */
export async function beginOperatorStepUp(store: LedgerStore, webauthn: WebauthnConfig, user: UserRecord, now: Date) {
  const passkeys = await store.passkeys.listByUser(user.id);
  if (passkeys.length === 0) throw new ApiError('CONFLICT', 'Operator actions need a passkey; add one in You › Account', { reason: 'OPERATOR_NEEDS_PASSKEY' });
  const publicKey = await stepUpOptions(webauthn, passkeys);
  const { id } = await store.passkeys.createChallenge({ challenge: publicKey.challenge, purpose: 'step_up', userId: user.id, at: now, expiresAt: new Date(now.getTime() + CHALLENGE_TTL_MS) });
  return { challengeId: id, publicKey };
}

/**
 * Verifies the assertion against this person's own passkey and a step_up challenge issued to them, then stamps the
 * session. Every refusal is the one 403 PASSKEY_NOT_ACCEPTED. A cloned authenticator (a counter that went back) is
 * refused like any other failure.
 */
export async function finishOperatorStepUp(
  store: LedgerStore,
  webauthn: WebauthnConfig,
  identity: { user: UserRecord; session: SessionRecord },
  presented: { challengeId: string; response: AuthenticationResponseJSON },
  now: Date,
): Promise<Date> {
  const challenge = await store.passkeys.consumeChallenge(presented.challengeId, 'step_up', identity.user.id, now);
  const passkey = challenge ? await store.passkeys.findByCredentialId(presented.response.id) : null;
  if (!challenge || !passkey || passkey.userId !== identity.user.id) throw notAccepted();
  const outcome = await verifyAssertion(webauthn, presented.response, challenge.challenge, passkey);
  if (outcome.kind !== 'verified') throw notAccepted();
  await store.passkeys.recordUse(passkey.id, outcome.signCount, now);
  // A session revoked meanwhile (a password change, a lock, a disable) stays revoked: the stamp is conditional.
  if (!(await store.sessions.markStepUp(identity.session.id, now))) throw new ApiError('UNAUTHENTICATED', 'This session has ended; sign in again');
  return new Date(now.getTime() + OPERATOR_STEP_UP_WINDOW_MS);
}

function notAccepted(): ApiError {
  return new ApiError('PASSKEY_NOT_ACCEPTED', 'That passkey wasn’t accepted. Try again');
}
