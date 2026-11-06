import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { sessionDigest } from '../../auth/sessions.js';
import { ApiError } from '../../errors.js';
import { MemoryLedgerStore } from '../../repositories/memory.js';
import { shareLinkAccess } from '../access.js';

/**
 * MUT-560 (ADR-247): shareLinkAccess, the one door MUT-314's download will call too. The route tests drive it through
 * the app; here, the causes the app can't reach directly (a profile gone under a live link) and the shape it answers.
 */
const PEPPER = 'pepper-with-at-least-32-characters-long!';
const T0 = new Date('2026-11-06T09:00:00Z');
const HOUR = 3_600_000;

async function linked(options: { expiresAt?: Date; accessExpiresAt?: Date } = {}) {
  const store = new MemoryLedgerStore();
  const { user, personalOrganization } = await store.users.create({
    email: `o-${randomUUID()}@studio.ps`,
    displayName: 'Basel Sader',
    passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA',
    locale: 'en',
    personal: { name: 'Personal', slug: `p-${randomUUID()}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' },
    at: T0,
  });
  const created = await store.shareLinks.create({
    id: randomUUID(),
    organizationId: personalOrganization.id,
    createdByUserId: user.id,
    tokenDigest: sessionDigest(PEPPER, 'link-token'),
    pinHash: 'x',
    period: 'LAST_1_MONTH',
    periodFrom: '2026-10-01',
    periodTo: '2026-10-31',
    expiresAt: options.expiresAt ?? new Date(T0.getTime() + 7 * 24 * HOUR),
    at: T0,
    max: 10,
    auditFor: () => [],
  });
  if (created.kind !== 'created') throw new Error('not created');
  await store.shareLinks.addOrRotateViewer({
    linkId: created.link.id,
    previousTokenDigest: null,
    tokenDigest: sessionDigest(PEPPER, 'viewer-token'),
    accessExpiresAt: options.accessExpiresAt ?? new Date(T0.getTime() + 8 * HOUR),
    at: T0,
    max: 3,
    auditFor: () => [],
  });
  return { store, link: created.link, organization: personalOrganization };
}

async function refusal(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (err) {
    if (err instanceof ApiError) return { status: err.status, code: err.code, message: err.message, details: err.details };
    throw err;
  }
  throw new Error('did not throw');
}

const UNAVAILABLE = { status: 404, code: 'NOT_FOUND', message: 'This link is no longer available', details: { reason: 'SHARE_LINK_UNAVAILABLE' } };

describe('shareLinkAccess (MUT-560)', () => {
  it('answers the link, the viewer, the profile and the frozen range, and stamps the views', async () => {
    const { store, link, organization } = await linked();
    const access = await shareLinkAccess(store, PEPPER, 'viewer-token', new Date(T0.getTime() + HOUR));
    expect(access.range).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(access.organization.id).toBe(organization.id);
    expect(access.link.id).toBe(link.id);
    const found = await store.shareLinks.findViewerByDigest(sessionDigest(PEPPER, 'viewer-token'));
    expect(found?.viewer.lastViewedAt).toEqual(new Date(T0.getTime() + HOUR));
  });

  it('a profile gone under a live link is the same 404 as an unknown token', async () => {
    const { store, organization } = await linked();
    const gone = { ...store, shareLinks: store.shareLinks, users: store.users, organizations: { ...store.organizations, getById: async (id: string) => (id === organization.id ? null : store.organizations.getById(id)) } };
    expect(await refusal(shareLinkAccess(gone, PEPPER, 'viewer-token', T0))).toEqual(UNAVAILABLE);
    expect(await refusal(shareLinkAccess(store, PEPPER, 'not-a-viewer', T0))).toEqual(UNAVAILABLE);
  });

  it('an expired link is the 404; a known viewer past its 8 hours on a live link is 401 SHARE_VIEW_EXPIRED', async () => {
    const { store } = await linked({ expiresAt: new Date(T0.getTime() + 24 * HOUR) });
    expect(await refusal(shareLinkAccess(store, PEPPER, 'viewer-token', new Date(T0.getTime() + 9 * HOUR)))).toEqual({
      status: 401,
      code: 'UNAUTHENTICATED',
      message: 'Enter the PIN again to keep reading',
      details: { reason: 'SHARE_VIEW_EXPIRED' },
    });
    expect(await refusal(shareLinkAccess(store, PEPPER, 'viewer-token', new Date(T0.getTime() + 24 * HOUR)))).toEqual(UNAVAILABLE);
  });

  it('a locked link is the 404 for a viewer already in', async () => {
    const { store, link } = await linked();
    await store.shareLinks.recordFailedPin({ linkId: link.id, at: T0, maxAttempts: 1, lockAudit: () => [] });
    expect(await refusal(shareLinkAccess(store, PEPPER, 'viewer-token', T0))).toEqual(UNAVAILABLE);
  });
});
