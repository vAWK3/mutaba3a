import type { AppDependencies } from '../../app.js';
import { SlidingWindowRateLimiter } from '../../rate-limit.js';
import { accountantHarness, json, read, SAME_ORIGIN, type AccountantHarness, type Loose, type Person } from './accountants.js';

/**
 * MUT-560 (ADR-246): the accountant harness (a memory store, a movable clock at T0 = 2026-11-06 09:00 UTC, phone
 * sessions) with share links on, and the sign-in IP budget opened wide so only the rate-limit tests meet it.
 */
export function shareLinkHarness(overrides: Partial<AppDependencies> = {}) {
  return accountantHarness({ shareLinks: true, signInIpLimiter: new SlidingWindowRateLimiter(1_000_000), ...overrides });
}

export interface CreateLinkBody {
  period?: string;
  expiresInDays?: number;
  pin?: string;
}

export const createLink = (h: AccountantHarness, owner: Person, profileId: string, body: CreateLinkBody = {}) =>
  h.app.request(`/v1/profiles/${profileId}/share-links`, json({ period: 'LAST_1_MONTH', expiresInDays: 7, pin: '2468', ...body }, owner.auth));

/** The token a created link's URL carries in its fragment. */
export function tokenOf(created: Loose): string {
  const match = /\/share#([A-Za-z0-9_-]{43})$/.exec(created.url as string);
  if (!match) throw new Error(`no token in ${created.url}`);
  return match[1]!;
}

/** Creates a link and answers its body and token. */
export async function linkOn(h: AccountantHarness, owner: Person, profileId: string, body: CreateLinkBody = {}) {
  const res = await createLink(h, owner, profileId, body);
  if (res.status !== 201) throw new Error(`create failed: ${res.status} ${await res.text()}`);
  const created = await read(res);
  return { ...created, token: tokenOf(created) } as Loose & { token: string };
}

export const publicPost = (h: AccountantHarness, path: string, body: unknown, headers: Record<string, string> = {}) =>
  h.app.request(`/v1/share-links/${path}`, json(body, { ...SAME_ORIGIN, ...headers }));

export const check = (h: AccountantHarness, token: string) => publicPost(h, 'check', { token });
export const unlock = (h: AccountantHarness, token: string, pin: string, viewerToken?: string) => publicPost(h, 'unlock', { token, pin, ...(viewerToken ? { viewerToken } : {}) });

/** Unlocks and answers the viewer token (throws unless 200). */
export async function viewerOf(h: AccountantHarness, token: string, pin = '2468', previous?: string): Promise<string> {
  const res = await unlock(h, token, pin, previous);
  if (res.status !== 200) throw new Error(`unlock failed: ${res.status} ${await res.text()}`);
  return (await read(res)).viewerToken as string;
}

export const entriesOf = (h: AccountantHarness, viewerToken: string, extra: Record<string, unknown> = {}) => publicPost(h, 'entries', { viewerToken, ...extra });
export const summaryOf = (h: AccountantHarness, viewerToken: string) => publicPost(h, 'summary', { viewerToken });
export const receiptsOf = (h: AccountantHarness, viewerToken: string, entryKey: string) => publicPost(h, 'expense-receipts', { viewerToken, entryKey });

export const listLinks = async (h: AccountantHarness, owner: Person, profileId: string) => read(await h.app.request(`/v1/profiles/${profileId}/share-links`, { headers: owner.auth }));
export const revokeLink = (h: AccountantHarness, owner: Person, profileId: string, linkId: string) => h.app.request(`/v1/profiles/${profileId}/share-links/${linkId}`, { method: 'DELETE', headers: owner.auth });
