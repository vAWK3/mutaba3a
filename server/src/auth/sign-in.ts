import type { Context } from 'hono';
import { isAccountGone } from '../accounts/closure.js';
import { ApiError } from '../errors.js';
import { StateConflict } from '../repositories/memory.js';
import type { LedgerStore, SessionRecord, UserRecord } from '../repositories/ports.js';
import type { AppEnv } from './middleware.js';
import { generateDeviceSessionToken, generateSessionToken, sessionDigest, type SessionKind, type SignInThrottle } from './sessions.js';
import { generateOneTimePassword, normalizeEmail, type PasswordHasher } from './users.js';

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

export async function signIn(
  c: Context<AppEnv>,
  deps: SignInDeps,
  credentials: { email: string; password: string },
  sessionKind: SessionKind,
  lifetime: SignInLifetime,
): Promise<SignInResult> {
  const { store, passwordHasher, throttle, pepper } = deps;
  const now = c.get('now')();
  const key = normalizeEmail(credentials.email);
  const user = await store.users.findByEmail(key);
  const locked = throttle.isLocked(key, now) || (user?.lockedUntil ? user.lockedUntil.getTime() > now.getTime() : false);
  const matches = await passwordHasher.verify(user?.passwordHash ?? (await dummyHashFor(passwordHasher)), credentials.password);

  // MUT-367 (ADR-159 §7a, D10): only the right password learns that a self-service account waits for the operator.
  // No failure is recorded and no session is issued; every other refusal below is the usual 401.
  if (user && !locked && matches && user.status === 'PENDING_REVIEW') {
    throw new ApiError('ACCOUNT_UNDER_REVIEW', 'Your account is waiting for our review; we’ll email you when it’s ready');
  }
  // MUT-333 (D5): a closed account past its deadline is gone to its person: the usual refusal, and no failure counted.
  if (user && matches && isAccountGone(user.closure, now)) throw new ApiError('INVALID_CREDENTIALS', 'That email and password do not match');
  if (!user || locked || !matches || user.status !== 'ACTIVE') {
    if (!locked) {
      const lockUntil = throttle.recordFailure(key, now);
      if (user) {
        await store.users.recordFailedSignIn(user.id, now, lockUntil);
        if (lockUntil) await auditToMembers(c, store, user, 'user.locked_out', sessionKind);
      }
    }
    throw new ApiError('INVALID_CREDENTIALS', 'That email and password do not match');
  }

  throttle.clear(key);
  const token = sessionKind === 'device' ? generateDeviceSessionToken() : generateSessionToken();
  const absoluteExpiresAt = new Date(now.getTime() + lifetime.absoluteMs);
  let session: SessionRecord;
  try {
    session = await store.sessions.create({
      userId: user.id,
      tokenDigest: sessionDigest(pepper, token),
      kind: sessionKind,
      at: now,
      idleExpiresAt: new Date(Math.min(now.getTime() + lifetime.idleMs, absoluteExpiresAt.getTime())),
      absoluteExpiresAt,
      userAgent: c.req.header('user-agent')?.slice(0, USER_AGENT_MAX) ?? null,
      // MUT-235 review: tied to the hash just verified, so an operator --lock (or a setup-link redeem, or a disable)
      // that commits while this sign-in was verifying wins, instead of this sign-in keeping a session.
      // Never null here (a null hash cannot verify), but the type cannot know that.
      ...(user.passwordHash === null ? {} : { verifiedPasswordHash: user.passwordHash }),
    });
  } catch (err) {
    if (err instanceof StateConflict) throw new ApiError('INVALID_CREDENTIALS', 'That email and password do not match');
    throw err;
  }
  const signedIn = (await store.users.recordSignIn(user.id, now)) ?? user;
  await auditToMembers(c, store, signedIn, 'user.signed_in', sessionKind);
  return { user: signedIn, token, session };
}

/** Stamps `metadata.sessionKind` so an operator can tell a device sign-in from a portal one in the audit log (MUT-64). */
async function auditToMembers(
  c: Context<AppEnv>,
  store: LedgerStore,
  user: UserRecord,
  action: 'user.signed_in' | 'user.locked_out',
  sessionKind: SessionKind,
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
      metadata: { sessionKind },
    });
  }
}
