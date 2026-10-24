import { ApiError } from '../errors.js';
import type { AuditEventInput, LedgerStore, UserRecord } from '../repositories/ports.js';
import type { SignInThrottle } from './sessions.js';
import { normalizeEmail, type PasswordHasher } from './users.js';

/**
 * A signed-in person typing their password again before something that can't be taken back lightly: changing the
 * password (MUT-237) and closing the account (MUT-333). One rule for both: a wrong guess counts toward the same lockout
 * a wrong sign-in would, and a lockout it causes is audited (actor USER, as MUT-237 wrote it). The session already
 * proves who this is, so there is no unknown address to hide and no dummy-hash timing defense.
 *
 * Returns the hash the password verified against (callers pin their write to it); throws 403 CURRENT_PASSWORD_WRONG.
 */
export interface CurrentPasswordDeps {
  store: LedgerStore;
  passwordHasher: PasswordHasher;
  throttle: SignInThrottle;
}

export async function verifyCurrentPassword(deps: CurrentPasswordDeps, user: UserRecord, password: string, now: Date, requestId: string | null): Promise<string> {
  const { store, passwordHasher, throttle } = deps;
  const key = normalizeEmail(user.email);
  const locked = throttle.isLocked(key, now) || (user.lockedUntil ? user.lockedUntil.getTime() > now.getTime() : false);
  const verifiedPasswordHash = user.passwordHash;
  const matches = !locked && verifiedPasswordHash !== null && (await passwordHasher.verify(verifiedPasswordHash, password));
  if (locked || !matches || verifiedPasswordHash === null) {
    if (!locked) {
      const lockUntil = throttle.recordFailure(key, now);
      await store.users.recordFailedSignIn(user.id, now, lockUntil);
      // ADR-037 decision 4: a real lockout is always written to the audit log too, whichever route trips it.
      if (lockUntil) for (const event of await lockedOutAudit(store, requestId, user)) await store.audit.append(event);
    }
    throw new ApiError('CURRENT_PASSWORD_WRONG', 'Current password is wrong');
  }
  throttle.clear(key);
  return verifiedPasswordHash;
}

async function lockedOutAudit(store: LedgerStore, requestId: string | null, person: UserRecord): Promise<AuditEventInput[]> {
  return (await store.memberships.listByUser(person.id)).map((m) => ({
    organizationId: m.organizationId,
    actorType: 'USER',
    actorId: person.id,
    action: 'user.locked_out',
    entityType: 'user',
    entityId: person.id,
    requestId,
  }));
}
