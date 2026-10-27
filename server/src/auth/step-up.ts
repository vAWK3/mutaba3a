import type { AuthenticationResponseJSON } from '@simplewebauthn/server';
import { ApiError } from '../errors.js';
import type { Logger } from '../logger.js';
import type { LedgerStore, SessionRecord, UserRecord } from '../repositories/ports.js';
import { CHALLENGE_TTL_MS, STEP_UP_WINDOW_MS, stepUpOptions, verifyAssertion, type WebauthnConfig } from './webauthn.js';

/**
 * MUT-459 (ADR-212, D7): an operator's step-up is passkey-only. A write passes while `sessions.stepUpAt` is under 10
 * minutes old. Only a passkey sets it: a passkey sign-in (the session is created stamped) or a passkey step-up here.
 * A password never does, a password sign-in included, and a password change's rotated session starts unstamped
 * (review finding 1: inferring the proof from `createdAt` let a password change reopen the window). The step-up never
 * touches `credentialsVerifiedAt`, which the password-change revocation reads (MUT-238): a step-up must not revive a
 * session a password change or a setup-link lock just ended.
 */
export const OPERATOR_STEP_UP_WINDOW_MS = STEP_UP_WINDOW_MS;

/** When this session's operator step-up lapses, or null when it already has (or there never was one). */
export function operatorStepUpUntil(session: Pick<SessionRecord, 'stepUpAt'>, now: Date): Date | null {
  if (!session.stepUpAt) return null;
  const until = new Date(session.stepUpAt.getTime() + OPERATOR_STEP_UP_WINDOW_MS);
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
  deps: { store: LedgerStore; webauthn: WebauthnConfig; logger: Logger },
  identity: { user: UserRecord; session: SessionRecord },
  presented: { challengeId: string; response: AuthenticationResponseJSON },
  context: { now: Date; requestId: string | null },
): Promise<Date> {
  const { store, webauthn, logger } = deps;
  const { now, requestId } = context;
  const refuse = (reason: string): ApiError => {
    // Review finding 5: a refused step-up on the most privileged surface leaves a trace (never the credential).
    logger.warn({ userId: identity.user.id, sessionId: identity.session.id, reason, requestId }, 'operator.step_up_refused');
    return notAccepted();
  };
  const challenge = await store.passkeys.consumeChallenge(presented.challengeId, 'step_up', identity.user.id, now);
  const passkey = challenge ? await store.passkeys.findByCredentialId(presented.response.id) : null;
  if (!challenge) throw refuse('challenge');
  if (!passkey || passkey.userId !== identity.user.id) throw refuse('passkey');
  const outcome = await verifyAssertion(webauthn, presented.response, challenge.challenge, passkey);
  // A cloned authenticator is audited as at sign-in (auth/sign-in.ts), so it is noticed wherever it is used.
  if (outcome.kind === 'counter-regressed') await auditOnProfiles(store, identity.user, 'user.passkey_counter_regressed', { actorType: 'SYSTEM', actorId: null }, { method: 'step_up', passkeyId: passkey.id }, requestId);
  if (outcome.kind !== 'verified') throw refuse(outcome.kind);
  await store.passkeys.recordUse(passkey.id, outcome.signCount, now);
  // A session revoked meanwhile (a password change, a lock, a disable) stays revoked: the stamp is conditional.
  if (!(await store.sessions.markStepUp(identity.session.id, now))) throw new ApiError('UNAUTHENTICATED', 'This session has ended; sign in again');
  await auditOnProfiles(store, identity.user, 'user.operator_stepped_up', { actorType: 'USER', actorId: identity.user.id }, { passkeyId: passkey.id }, requestId);
  return new Date(now.getTime() + OPERATOR_STEP_UP_WINDOW_MS);
}

async function auditOnProfiles(
  store: LedgerStore,
  user: UserRecord,
  action: 'user.operator_stepped_up' | 'user.passkey_counter_regressed',
  actor: { actorType: 'USER' | 'SYSTEM'; actorId: string | null },
  metadata: { method?: string; passkeyId: string },
  requestId: string | null,
): Promise<void> {
  for (const m of await store.memberships.listByUser(user.id)) {
    await store.audit.append({ organizationId: m.organizationId, ...actor, action, entityType: 'user', entityId: user.id, metadata, requestId });
  }
}

function notAccepted(): ApiError {
  return new ApiError('PASSKEY_NOT_ACCEPTED', 'That passkey wasn’t accepted. Try again');
}
