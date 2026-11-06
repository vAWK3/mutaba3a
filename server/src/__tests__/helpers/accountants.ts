import { randomUUID } from 'node:crypto';
import pino from 'pino';
import { createApp, type AppDependencies } from '../../app.js';
import { createMailer } from '../../email/mailer.js';
import { MemoryMailTransport } from '../../email/transports/memory.js';
import { CURRENT_TERMS } from '../../legal.js';
import { SlidingWindowRateLimiter } from '../../rate-limit.js';
import { MemoryLedgerStore } from '../../repositories/memory.js';
import { provisionUser } from './provision.js';

/**
 * MUT-559 (ADR-245): one app with accountant access on, a memory mailer and a movable clock, and the people a grant
 * involves: an owner with a profile to share, and an accountant. Phone device sessions (bearer tokens), so no cookie
 * or same-origin bookkeeping gets in the way of what the tests are about.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Loose = any;
export const read = (res: Response): Promise<Loose> => res.json() as Promise<Loose>;

export const ADMIN = { 'x-admin-token': 'test-admin-token-with-at-least-32-characters' };
export const JOB = { 'x-job-token': 'test-job-token-with-at-least-32-characters-long' };
export const ORIGIN = 'http://localhost';
export const SAME_ORIGIN = { origin: ORIGIN };
export const T0 = new Date('2026-11-06T09:00:00Z');
export const DAY = 86_400_000;
let seq = 0;

export const json = (body: unknown, headers: Record<string, string> = {}, method = 'POST'): RequestInit => ({
  method,
  headers: { 'content-type': 'application/json', ...headers },
  body: JSON.stringify(body),
});
export const idem = () => ({ 'idempotency-key': randomUUID() });

export function accountantHarness(overrides: Partial<AppDependencies> = {}) {
  let now = T0;
  // A harness handed another's store (a second app over the same data) reports that store as its own.
  const store = (overrides.store as MemoryLedgerStore | undefined) ?? new MemoryLedgerStore();
  const logger = pino({ level: 'silent' });
  const transport = new MemoryMailTransport(() => now);
  const mailer = createMailer({ transport, store, logger, now: () => now, fromAddress: 'no-reply@mail.example.test', replyTo: 'help@example.test', limits: { daily: 500, securityReserve: 50, perRecipient: 50 } });
  const app = createApp({
    store,
    logger,
    rateLimiter: new SlidingWindowRateLimiter(1_000_000),
    adminToken: ADMIN['x-admin-token'],
    keyEnvironment: 'test',
    version: '0.1.0-test',
    now: () => now,
    mailer,
    sessions: { pepper: 'session-pepper-with-at-least-32-chars!!', idleMinutes: 60 * 24 * 400, absoluteHours: 24 * 400, secureCookie: false, trustedProxyHops: 1, deviceIdleDays: 400, deviceAbsoluteDays: 400, portalOrigin: ORIGIN },
    jobToken: JOB['x-job-token'],
    accountantAccess: true,
    ...overrides,
  });
  return { app, store, transport, now: () => now, setNow: (at: Date) => void (now = at) };
}
export type AccountantHarness = ReturnType<typeof accountantHarness>;

export interface Person {
  email: string;
  password: string;
  userId: string;
  personalId: string;
  auth: Record<string, string>;
  on(profileId: string): Record<string, string>;
}

/**
 * A provisioned person (`email` or a fresh one), signed in on the phone. MUT-577: they hold the operator's
 * `accountant_access` feature (an owner needs it to invite or make a link) unless `sharing: false`.
 */
export async function person(h: AccountantHarness, options: { email?: string; displayName?: string; locale?: 'en' | 'ar'; sharing?: boolean } = {}): Promise<Person> {
  const email = options.email ?? `person${++seq}@studio${seq}.ps`;
  const created = await provisionUser(h.app, { email, displayName: options.displayName ?? `Person ${seq}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem', locale: options.locale ?? 'en' });
  if (options.sharing !== false) await h.store.features.grant({ userId: created.user.id as string, feature: 'accountant_access', grantedBy: 'test', at: h.now(), audit: [] });
  return signedIn(h, email, created.password as string, created.user.id as string, created.personalProfile.id as string);
}

export async function signedIn(h: AccountantHarness, email: string, password: string, userId: string, personalId: string): Promise<Person> {
  const res = await h.app.request('/v1/device-sessions', json({ email, password }));
  if (res.status !== 201) throw new Error(`sign-in failed: ${res.status} ${await res.text()}`);
  const auth = { authorization: `Bearer ${(await read(res)).token as string}` };
  return { email, password, userId, personalId, auth, on: (profileId) => ({ ...auth, 'x-mutaba3a-profile': profileId }) };
}

/** A Business profile the person creates and owns. */
export async function businessOf(h: AccountantHarness, owner: Person, name = 'Haddad Studio'): Promise<string> {
  const res = await h.app.request('/v1/profiles', json({ name, type: 'BUSINESS', defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }, { ...owner.auth, ...idem() }));
  if (res.status !== 201) throw new Error(`profile failed: ${res.status} ${await res.text()}`);
  return (await read(res)).id as string;
}

export async function expenseOn(h: AccountantHarness, p: Person, profileId: string, title: string): Promise<string> {
  const res = await h.app.request('/v1/expenses', json({ amount: '12.00', currency: 'ILS', occurredOn: '2026-11-01', title }, { ...p.on(profileId), ...idem() }));
  if (res.status !== 201) throw new Error(`expense failed: ${res.status} ${await res.text()}`);
  return (await read(res)).id as string;
}

export const inviteAccountant = (h: AccountantHarness, owner: Person, profileId: string, email: string, locale?: 'en' | 'ar') =>
  h.app.request(`/v1/profiles/${profileId}/accountants`, json({ email, ...(locale ? { locale } : {}) }, owner.auth));

/** The token from the newest invite mailed to `email`: it rides in the link's fragment (D3). */
export function inviteTokenFor(h: AccountantHarness, email: string): string {
  const mail = h.transport.list({ to: email }).filter((m) => m.template === 'accountant-invite').at(-1);
  if (!mail) throw new Error(`no invite mailed to ${email}`);
  const match = /\/accountant-invite#([A-Za-z0-9_-]{43})/.exec(mail.text);
  if (!match) throw new Error('no invite link in the mail');
  return match[1]!;
}

export const acceptInvite = (h: AccountantHarness, accountant: Person, token: string) => h.app.request('/v1/accountant-invites/accept', json({ token }, accountant.auth));

/** An owner shares `profileId` with a fresh accountant (an exact-address accept). */
export async function shared(h: AccountantHarness, owner: Person, profileId: string, accountant?: Person): Promise<Person> {
  const acc = accountant ?? (await person(h, { displayName: 'Hadi Accountant' }));
  const invited = await inviteAccountant(h, owner, profileId, acc.email);
  if (invited.status !== 201) throw new Error(`invite failed: ${invited.status} ${await invited.text()}`);
  const accepted = await acceptInvite(h, acc, inviteTokenFor(h, acc.email));
  if (accepted.status !== 200) throw new Error(`accept failed: ${accepted.status} ${await accepted.text()}`);
  return acc;
}

export const signupFromInvite = (h: AccountantHarness, token: string, extra: Record<string, unknown> = {}) =>
  h.app.request(
    '/v1/accountant-invites/signup',
    json({ token, password: 'a-long-enough-password', displayName: 'Hadi Accountant', acceptedTermsVersion: CURRENT_TERMS.version, turnstileToken: 'XXXX.DUMMY.TOKEN.XXXX', ...extra }, SAME_ORIGIN),
  );
