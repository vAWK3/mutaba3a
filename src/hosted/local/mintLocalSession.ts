import { generateDeviceSessionToken, sessionDigest } from '../../../server/src/auth/sessions.js';
import { PERSONAL_PROFILE_NAME, personalProfileFor } from '../../../server/src/personal-profile.js';
import type { LedgerStore, UserLocale, UserRecord } from '../../../server/src/repositories/ports.js';
import { LOCAL_PERSON_EMAIL } from '../../../server/src/records-file/local-person.js';

/**
 * Not a secret (ADR-097 §2.2, brief §2.2): the local pepper and token protect
 * nothing — only this browser's own script ever presents the token, and
 * anyone who can run script on the origin can read IndexedDB directly anyway.
 * A constant, not derived from anything, because there is exactly one of it
 * and rotating it would only sign the local person out of their own device.
 */
export const LOCAL_PEPPER = 'mut-local-mode-pepper';

export { LOCAL_PERSON_EMAIL };

/** Matches the hosted portal's own "create a profile" default (`ProfileCreateDrawer.tsx`); there is no admin or sign-up flow here to ask instead. */
const LOCAL_DEFAULT_CURRENCY = 'ILS';

/** Long enough to outlast any realistic page lifetime; a fresh session is minted every boot regardless (see `mintLocalSession`'s docblock), so this never has to survive a reload on its own. */
const SESSION_LIFETIME_MS = 100 * 365 * 24 * 60 * 60 * 1000;

export interface LocalSession {
  /** `mds_…`: attach as `Authorization: Bearer <token>` on every local request (transport.ts). */
  token: string;
  user: UserRecord;
}

/**
 * Lookup-or-create the local person, then mint a fresh device session on
 * *every* boot — corrected from an earlier draft during the implementation
 * plan's adversarial review (BLOCKING finding #1): `MemoryLedgerStore`'s
 * `sessionsById` is deliberately excluded from `snapshot()`/`restore()`
 * (a server-identity concern, ADR-097 §2.3.4), so a restored store never has
 * the session row a previous page load created, even though the person and
 * their personal profile *are* restored. Minting once-only would mean every
 * reload after the first finds no valid `mds_` token, `GET /v1/me` 401s, and
 * the app would redirect to a sign-in page local mode doesn't have (AC1/AC2
 * broken outright). Minting is cheap (one row, never persisted, never needs
 * to be) and correctness doesn't depend on reusing the old one.
 *
 * Does not call the shared `signIn()` (`server/src/auth/sign-in.ts`): that
 * function's job is verifying a password, and a from-scratch local person has
 * none. This reuses the same token/digest primitives `signIn()` and
 * `POST /v1/device-sessions` use, so the *verification* path
 * (`auth/middleware.ts` `authenticate()`) runs completely unmodified and sees
 * an ordinary device session — there is no local-only auth code for the
 * server to special-case.
 */
export async function mintLocalSession(store: LedgerStore, now: () => Date, locale: UserLocale = 'ar'): Promise<LocalSession> {
  const user = (await store.users.findByEmail(LOCAL_PERSON_EMAIL)) ?? (await createLocalPerson(store, locale, now()));
  // Never older than the person: `authenticate()` revokes a session verified before `passwordChangedAt`, so a clock
  // that has since moved back (or a records file from a device whose clock ran ahead) would lock them out for good.
  const at = new Date(Math.max(now().getTime(), user.passwordChangedAt.getTime()));

  const token = generateDeviceSessionToken();
  await store.sessions.create({
    userId: user.id,
    tokenDigest: sessionDigest(LOCAL_PEPPER, token),
    kind: 'device',
    at,
    idleExpiresAt: new Date(at.getTime() + SESSION_LIFETIME_MS),
    absoluteExpiresAt: new Date(at.getTime() + SESSION_LIFETIME_MS),
    userAgent: null,
  });

  return { token, user };
}

/** First-ever boot: `users.create` writes the person, their personal profile/organization and the owning membership in one transaction (`UserRepository.create`'s own contract) — nothing further to create here. */
async function createLocalPerson(store: LedgerStore, locale: UserLocale, at: Date): Promise<UserRecord> {
  const settings = { defaultCurrency: LOCAL_DEFAULT_CURRENCY, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone };
  const { user } = await store.users.create({
    email: LOCAL_PERSON_EMAIL,
    displayName: PERSONAL_PROFILE_NAME[locale],
    passwordHash: null,
    locale,
    personal: personalProfileFor(locale, settings),
    at,
  });
  return user;
}
