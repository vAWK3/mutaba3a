import type { Context } from 'hono';
import { isAccountGone } from '../accounts/closure.js';
import { ApiError } from '../errors.js';
import { StateConflict } from '../repositories/memory.js';
import type { LedgerStore, SessionRecord, UserRecord } from '../repositories/ports.js';
import type { AppEnv } from './middleware.js';
import { generateDeviceSessionToken, generateSessionToken, sessionDigest, type SessionKind, type SignInThrottle } from './sessions.js';
import { generateOneTimePassword, normalizeEmail, type PasswordHasher } from './users.js';
import { verifyAssertion, type WebauthnConfig } from './webauthn.js';
import type { AuthenticationResponseJSON } from '@simplewebauthn/server';

/**
 * The credential-verification core shared by the portal's cookie sign-in
 * (MUT-38) and the native app's device-session sign-in (MUT-64): one
 * password check, one throttle, one audit trail. Extracted so there is one
 * tested implementation of the highest-risk logic in this ticket, not two
 * near-identical copies in two route files.
 *
 * Sign-in never reveals whether an email has an account: every refusal is the
 * same 401 INVALID_CREDENTIALS, every attempt runs exactly one argon2 verify
 * (against a dummy hash with the same parameters when there is no user), and
 * lockout keys on the normalised email string whether or not it exists.
 */

const USER_AGENT_MAX = 200;

/** One dummy hash per PasswordHasher instance, shared by every caller (both routes reuse the same hasher). */
const dummyHashes = new WeakMap<PasswordHasher, Promise<string>>();

function dummyHashFor(passwordHasher: PasswordHasher): Promise<string> {
  let cached = dummyHashes.get(passwordHasher);
  if (!cached) {
    cached = passwordHasher.hash(generateOneTimePassword());
    dummyHashes.set(passwordHasher, cached);
  }
  return cached;
}

/** Call once per PasswordHasher at startup so the first unknown email isn't slower than the rest. */
export function warmDummyHash(passwordHasher: PasswordHasher): void {
  void dummyHashFor(passwordHasher);
}

export interface SignInDeps {
  store: LedgerStore;
  passwordHasher: PasswordHasher;
  throttle: SignInThrottle;
  pepper: string;
}

export interface SignInLifetime {
  idleMs: number;
  absoluteMs: number;
}

export interface SignInResult {
  user: UserRecord;
  token: string;
  session: SessionRecord;
}

export type SignInMethod = 'password' | 'passkey';

export async function signIn(
  c: Context<AppEnv>,
  deps: SignInDeps,
  credentials: { email: string; password: string },
  sessionKind: SessionKind,
  lifetime: SignInLifetime,
): Promise<SignInResult> {
  const { store, passwordHasher, throttle } = deps;
  const now = c.get('now')();
  const key = normalizeEmail(credentials.email);
  const user = await store.users.findByEmail(key);
  const locked = isLocked(throttle, key, user, now);
  const matches = await passwordHasher.verify(user?.passwordHash ?? (await dummyHashFor(passwordHasher)), credentials.password);

  // MUT-367 (ADR-159 §7a, D10): only the right password learns that a self-service account waits for the operator.
  // No failure is recorded and no session is issued; every other refusal below is the usual 401.
  if (user && !locked && matches && user.status === 'PENDING_REVIEW') throw underReview();
  // MUT-333 (D5): a closed account past its deadline is gone to its person: the usual refusal, and no failure counted.
  if (user && matches && isAccountGone(user.closure, now)) throw invalidCredentials();
  if (!user || locked || !matches || user.status !== 'ACTIVE') {
    if (!locked) await recordSignInFailure(c, deps, key, user, { sessionKind, method: 'password' });
    throw invalidCredentials();
  }

  throttle.clear(key);
  return issueSession(c, deps, user, { sessionKind, method: 'password' }, lifetime);
}

export interface PasskeySignInDeps extends SignInDeps {
  webauthn: WebauthnConfig;
}

/**
 * MUT-115 (ADR-189): sign in with a passkey, cookie or device. The same core as the password: one 401
 * INVALID_CREDENTIALS for every refusal, the same throttle and lockout (A3: a failed assertion counts on the person's
 * email key, shared with wrong passwords), the same PENDING_REVIEW 403 and closed-account rule, and a session bound
 * to the person's current password hash (D6), so an operator --lock, a disable or a racing password change wins.
 *
 * An unknown credential or a used/expired challenge has no person to count against: only the IP limiter applies.
 */
export async function signInWithPasskey(
  c: Context<AppEnv>,
  deps: PasskeySignInDeps,
  presented: { challengeId: string; response: AuthenticationResponseJSON },
  sessionKind: SessionKind,
  lifetime: SignInLifetime,
): Promise<SignInResult> {
  const { store, throttle, webauthn } = deps;
  const now = c.get('now')();
  const challenge = await store.passkeys.consumeChallenge(presented.challengeId, 'authentication', null, now);
  if (!challenge) throw invalidCredentials();
  const passkey = await store.passkeys.findByCredentialId(presented.response.id);
  const user = passkey ? await store.users.getById(passkey.userId) : null;
  if (!passkey || !user) throw invalidCredentials();

  const key = normalizeEmail(user.email);
  const locked = isLocked(throttle, key, user, now);
  const outcome = await verifyAssertion(webauthn, presented.response, challenge.challenge, passkey);
  const verified = outcome.kind === 'verified';
  const audit: SignInAudit = { sessionKind, method: 'passkey', passkeyId: passkey.id };

  if (verified && !locked && user.status === 'PENDING_REVIEW') throw underReview();
  if (verified && isAccountGone(user.closure, now)) throw invalidCredentials();
  if (outcome.kind === 'counter-regressed') await auditToMembers(c, store, user, 'user.passkey_counter_regressed', audit);
  if (!verified || locked || user.status !== 'ACTIVE' || user.passwordHash === null) {
    if (!locked) await recordSignInFailure(c, deps, key, user, audit);
    throw invalidCredentials();
  }

  throttle.clear(key);
  await store.passkeys.recordUse(passkey.id, outcome.signCount, now);
  return issueSession(c, deps, user, audit, lifetime);
}

/** The one refusal every sign-in answers, whatever went wrong (ADR-037 decision 4). */
export function invalidCredentials(): ApiError {
  return new ApiError('INVALID_CREDENTIALS', 'That email and password do not match');
}

function underReview(): ApiError {
  return new ApiError('ACCOUNT_UNDER_REVIEW', 'Your account is waiting for our review; we’ll email you when it’s ready');
}

/** Locked by the in-process throttle or by the person's stored lockout. */
export function isLocked(throttle: SignInThrottle, key: string, user: UserRecord | null, now: Date): boolean {
  return throttle.isLocked(key, now) || (user?.lockedUntil ? user.lockedUntil.getTime() > now.getTime() : false);
}

interface SignInAudit {
  sessionKind: SessionKind;
  method: SignInMethod;
  /** MUT-115: the passkey that signed in, on a passkey sign-in. */
  passkeyId?: string;
}

/**
 * A failed sign-in attempt, password or passkey (MUT-115 A3: one counter for both). Counts toward the email key's
 * lockout; a known person also gets the stored count and, on a real lockout, the SYSTEM-actor audit (R1).
 */
export async function recordSignInFailure(c: Context<AppEnv>, deps: SignInDeps, key: string, user: UserRecord | null, audit: SignInAudit): Promise<void> {
  const now = c.get('now')();
  const lockUntil = deps.throttle.recordFailure(key, now);
  if (!user) return;
  await deps.store.users.recordFailedSignIn(user.id, now, lockUntil);
  if (lockUntil) await auditToMembers(c, deps.store, user, 'user.locked_out', audit);
}

/**
 * The session a verified credential earns, cookie or device. Bound to the hash the person has right now (MUT-235
 * review): an operator --lock, a setup-link redeem or a disable that commits meanwhile wins, and the sign-in gets the
 * usual 401. A passkey sign-in binds to the same hash (MUT-115 D6), so a person with no password can't sign in at all.
 */
export async function issueSession(c: Context<AppEnv>, deps: SignInDeps, user: UserRecord, audit: SignInAudit, lifetime: SignInLifetime): Promise<SignInResult> {
  const { store, pepper } = deps;
  const now = c.get('now')();
  if (user.passwordHash === null) throw invalidCredentials();
  const token = audit.sessionKind === 'device' ? generateDeviceSessionToken() : generateSessionToken();
  const absoluteExpiresAt = new Date(now.getTime() + lifetime.absoluteMs);
  let session: SessionRecord;
  try {
    session = await store.sessions.create({
      userId: user.id,
      tokenDigest: sessionDigest(pepper, token),
      kind: audit.sessionKind,
      at: now,
      idleExpiresAt: new Date(Math.min(now.getTime() + lifetime.idleMs, absoluteExpiresAt.getTime())),
      absoluteExpiresAt,
      userAgent: c.req.header('user-agent')?.slice(0, USER_AGENT_MAX) ?? null,
      verifiedPasswordHash: user.passwordHash,
      ...(audit.passkeyId === undefined ? {} : { passkeyId: audit.passkeyId }),
    });
  } catch (err) {
    if (err instanceof StateConflict) throw invalidCredentials();
    throw err;
  }
  const signedIn = (await store.users.recordSignIn(user.id, now)) ?? user;
  await auditToMembers(c, store, signedIn, 'user.signed_in', audit);
  return { user: signedIn, token, session };
}

/**
 * Stamps `metadata.sessionKind` so an operator can tell a device sign-in from a portal one in the audit log (MUT-64),
 * and `method` (+ `passkeyId`) so they can tell a passkey from a password (MUT-115). Actors are pinned (R1): a
 * sign-in is the USER's act, a lockout the SYSTEM's.
 */
async function auditToMembers(
  c: Context<AppEnv>,
  store: LedgerStore,
  user: UserRecord,
  action: 'user.signed_in' | 'user.locked_out' | 'user.passkey_counter_regressed',
  audit: SignInAudit,
): Promise<void> {
  for (const m of await store.memberships.listByUser(user.id)) {
    await store.audit.append({
      organizationId: m.organizationId,
      actorType: action === 'user.signed_in' ? 'USER' : 'SYSTEM',
      actorId: action === 'user.signed_in' ? user.id : null,
      action,
      entityType: 'user',
      entityId: user.id,
      requestId: c.get('requestId'),
      metadata: { ...audit },
    });
  }
}
