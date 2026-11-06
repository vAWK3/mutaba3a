import { describe, expect, it } from 'vitest';
import { MemoryAttachmentStorage } from '../attachments/storage.js';
import { sessionDigest } from '../auth/sessions.js';
import { SlidingWindowRateLimiter } from '../rate-limit.js';
import { SHARE_LINK_MAX_VIEWERS, SHARE_LINK_PIN_ATTEMPTS, SHARE_LINKS_PER_PROFILE_DEFAULT } from '../share-links/links.js';
import { shareRowKey } from '../share-links/row-key.js';
import { ADMIN, DAY, JOB, T0, businessOf, idem, json, person, read, type AccountantHarness, type Loose, type Person } from './helpers/accountants.js';
import {
  check,
  createLink,
  entriesOf,
  linkOn,
  listLinks,
  publicPost,
  receiptsOf,
  revokeLink,
  shareLinkHarness,
  summaryOf,
  unlock,
  viewerOf,
} from './helpers/share-links.js';

/**
 * MUT-560 (ADR-247): an owner shares a period of one profile through a link and a PIN; whoever holds both reads that
 * period, nothing more, with no account. Through the real app: create, list and revoke; check and unlock (the PIN
 * lockout, the 3-viewer cap, returning viewers, the 8-hour access); the uniform 404; the period boundaries; the reads
 * and their projection; read-only; throttles, audit, rate limits, closure, headers, isolation and the dark launch.
 * The numbered groups are the plan's.
 */
const HOUR = 3_600_000;
const PEPPER = 'session-pepper-with-at-least-32-chars!!';
const later = (h: AccountantHarness, ms: number) => h.setNow(new Date(h.now().getTime() + ms));
const errorOf = async (res: Response) => {
  const { error } = await read(res);
  delete error.requestId;
  return error;
};
const UNAVAILABLE = { code: 'NOT_FOUND', message: 'This link is no longer available', details: { reason: 'SHARE_LINK_UNAVAILABLE' } };
const auditOf = async (h: AccountantHarness, profileId: string) => (await h.store.audit.listByOrganization(profileId, 500)).filter((e) => e.action.startsWith('share_link.'));

async function ownerWithProfile(h: AccountantHarness) {
  const owner = await person(h, { displayName: 'Basel Sader' });
  return { owner, profileId: owner.personalId };
}

async function expenseAt(h: AccountantHarness, p: Person, profileId: string, occurredOn: string, title: string, amount = '12.00', currency = 'ILS'): Promise<Loose> {
  const res = await h.app.request('/v1/expenses', json({ amount, currency, occurredOn, title }, { ...p.on(profileId), ...idem() }));
  if (res.status !== 201) throw new Error(`expense failed: ${res.status} ${await res.text()}`);
  return read(res);
}

async function receivedAt(h: AccountantHarness, p: Person, profileId: string, occurredOn: string, amount: string, currency = 'ILS'): Promise<Loose> {
  const res = await h.app.request('/v1/income', json({ kind: 'received', amount, currency, occurredOn }, { ...p.on(profileId), ...idem() }));
  if (res.status !== 201) throw new Error(`income failed: ${res.status} ${await res.text()}`);
  return read(res);
}

const titlesOf = async (h: AccountantHarness, viewer: string) => (await read(await entriesOf(h, viewer))).items.filter((e: Loose) => e.kind === 'expense').map((e: Loose) => e.expense.title).sort();

describe('1 + 2. the period, end to end (MUT-560)', () => {
  it('last month = the last complete calendar month: only its first and last days show, never the day before, after or the future', async () => {
    const h = shareLinkHarness();
    const { owner, profileId } = await ownerWithProfile(h);
    for (const [day, title] of [['2026-09-30', 'before'], ['2026-10-01', 'from'], ['2026-10-31', 'to'], ['2026-11-01', 'after'], ['2026-11-20', 'future']]) await expenseAt(h, owner, profileId, day!, title!);
    const link = await linkOn(h, owner, profileId, { period: 'LAST_1_MONTH' });
    expect(link).toMatchObject({ period: 'LAST_1_MONTH', from: '2026-10-01', to: '2026-10-31' });
    expect(await titlesOf(h, await viewerOf(h, link.token))).toEqual(['from', 'to']);
  });

  it('last 3 months on 2026-11-06 is 2026-08-01 … 2026-10-31', async () => {
    const h = shareLinkHarness();
    const { owner, profileId } = await ownerWithProfile(h);
    expect(await linkOn(h, owner, profileId, { period: 'LAST_3_MONTHS' })).toMatchObject({ from: '2026-08-01', to: '2026-10-31' });
    expect(await linkOn(h, owner, profileId, { period: 'LAST_2_MONTHS' })).toMatchObject({ from: '2026-09-01', to: '2026-10-31' });
  });

  it('whole profile = everything up to and including the creation day; never a future-dated entry', async () => {
    const h = shareLinkHarness();
    const { owner, profileId } = await ownerWithProfile(h);
    for (const [day, title] of [['2024-01-15', 'old'], ['2026-11-06', 'today'], ['2026-11-07', 'tomorrow']]) await expenseAt(h, owner, profileId, day!, title!);
    const link = await linkOn(h, owner, profileId, { period: 'WHOLE_PROFILE' });
    expect(link).toMatchObject({ from: null, to: '2026-11-06' });
    expect(await titlesOf(h, await viewerOf(h, link.token))).toEqual(['old', 'today']);
  });

  it('the creation day is the profile’s: 00:30 on the 1st in Jerusalem makes last month the one just ended there', async () => {
    const h = shareLinkHarness();
    const { owner, profileId } = await ownerWithProfile(h);
    // 2026-12-01 00:30 in Asia/Jerusalem = 2026-11-30 22:30 UTC.
    h.setNow(new Date('2026-11-30T22:30:00Z'));
    expect(await linkOn(h, owner, profileId, { period: 'LAST_1_MONTH' })).toMatchObject({ from: '2026-11-01', to: '2026-11-30' });
  });

  it('reads are live inside the frozen range: an entry backdated into it shows, one edited out of it disappears', async () => {
    const h = shareLinkHarness();
    const { owner, profileId } = await ownerWithProfile(h);
    const inside = await expenseAt(h, owner, profileId, '2026-10-10', 'inside');
    const outside = await expenseAt(h, owner, profileId, '2026-11-02', 'outside');
    const viewer = await viewerOf(h, (await linkOn(h, owner, profileId)).token);
    expect(await titlesOf(h, viewer)).toEqual(['inside']);
    const edit = (e: Loose, occurredOn: string) => h.app.request(`/v1/expenses/${e.id}`, json({ occurredOn }, { ...owner.on(profileId), 'if-match': String(e.version) }, 'PATCH'));
    expect((await edit(outside, '2026-10-20')).status).toBe(200);
    expect((await edit(inside, '2026-11-03')).status).toBe(200);
    expect(await titlesOf(h, viewer)).toEqual(['outside']);
  });
});

describe('3. create (MUT-560)', () => {
  it('every period × expiry: 201 with the URL only here, the token in its fragment, and the expiry from now', async () => {
    const h = shareLinkHarness();
    const { owner, profileId } = await ownerWithProfile(h);
    for (const expiresInDays of [1, 7, 30]) {
      for (const period of ['LAST_1_MONTH', 'LAST_2_MONTHS', 'LAST_3_MONTHS', 'WHOLE_PROFILE']) {
        const res = await createLink(h, owner, profileId, { period, expiresInDays });
        expect(res.status, `${period} ${expiresInDays}`).toBe(201);
        const body = await read(res);
        expect(body.url).toMatch(/^http:\/\/localhost\/share#[A-Za-z0-9_-]{43}$/);
        expect(new Date(body.expiresAt).getTime()).toBe(T0.getTime() + expiresInDays * DAY);
        expect(body).toMatchObject({ period, createdAt: T0.toISOString() });
        const listed = (await listLinks(h, owner, profileId)).items.find((l: Loose) => l.id === body.id);
        expect(listed).toBeDefined();
        expect(JSON.stringify(listed)).not.toContain(body.url.split('#')[1]);
        expect(listed).not.toHaveProperty('url');
        await revokeLink(h, owner, profileId, body.id);
      }
    }
  });

  it.each([['123'], ['123456789'], ['12a4'], ['12 34'], ['']])('refuses the PIN %j: 422 VALIDATION_FAILED, PIN_FORMAT', async (pin) => {
    const h = shareLinkHarness();
    const { owner, profileId } = await ownerWithProfile(h);
    const res = await createLink(h, owner, profileId, { pin });
    expect(res.status).toBe(422);
    expect((await read(res)).error).toMatchObject({ code: 'VALIDATION_FAILED', details: { reason: 'PIN_FORMAT' } });
  });

  it('refuses an expiry other than 1, 7 or 30 days, and an unknown period (422)', async () => {
    const h = shareLinkHarness();
    const { owner, profileId } = await ownerWithProfile(h);
    expect((await createLink(h, owner, profileId, { expiresInDays: 14 })).status).toBe(422);
    expect((await createLink(h, owner, profileId, { period: 'LAST_YEAR' })).status).toBe(422);
  });

  it('folds Arabic-Indic and Eastern Arabic-Indic digits: a PIN set as ٢٤٦٨ opens with 2468 and ۲۴۶۸', async () => {
    const h = shareLinkHarness();
    const { owner, profileId } = await ownerWithProfile(h);
    const link = await linkOn(h, owner, profileId, { pin: '٢٤٦٨' });
    expect((await unlock(h, link.token, '2468')).status).toBe(200);
    expect((await unlock(h, link.token, '۲۴۶۸')).status).toBe(200);
  });

  it(`caps live links at ${SHARE_LINKS_PER_PROFILE_DEFAULT} per profile (409 SHARE_LINK_LIMIT); revoking frees a place`, async () => {
    const h = shareLinkHarness();
    const { owner, profileId } = await ownerWithProfile(h);
    const ids: string[] = [];
    for (let i = 0; i < SHARE_LINKS_PER_PROFILE_DEFAULT; i++) ids.push((await linkOn(h, owner, profileId)).id);
    const capped = await createLink(h, owner, profileId);
    expect(capped.status).toBe(409);
    expect((await read(capped)).error).toMatchObject({ code: 'CONFLICT', details: { reason: 'SHARE_LINK_LIMIT', limit: SHARE_LINKS_PER_PROFILE_DEFAULT } });
    expect((await revokeLink(h, owner, profileId, ids[0]!)).status).toBe(204);
    expect((await createLink(h, owner, profileId)).status).toBe(201);
  });

  it('rate-limits creates per owner (429 with Retry-After)', async () => {
    const h = shareLinkHarness({ shareLinkCreateLimiter: new SlidingWindowRateLimiter(2, HOUR) });
    const { owner, profileId } = await ownerWithProfile(h);
    expect((await createLink(h, owner, profileId)).status).toBe(201);
    expect((await createLink(h, owner, profileId)).status).toBe(201);
    const limited = await createLink(h, owner, profileId);
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
  });

  it('only an owner: a stranger gets 404, a firm member who doesn’t own it 403 NOT_OWNER; any owner sees and revokes every link', async () => {
    const h = shareLinkHarness();
    const { owner, profileId } = await ownerWithProfile(h);
    const stranger = await person(h);
    expect((await createLink(h, stranger, profileId)).status).toBe(404);
    expect((await h.app.request(`/v1/profiles/${profileId}/share-links`, { headers: stranger.auth })).status).toBe(404);
    const firm = await read(await h.app.request('/admin/v1/organizations', json({ name: 'Firm', defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }, ADMIN)));
    expect((await h.app.request(`/admin/v1/users/${stranger.userId}/memberships`, json({ organizationId: firm.id }, ADMIN))).status).toBe(201);
    const refused = await createLink(h, stranger, firm.id);
    expect(refused.status).toBe(403);
    expect((await read(refused)).error.details).toMatchObject({ reason: 'NOT_OWNER' });

    // A co-owner of a business sees and revokes the creator's link.
    const business = await businessOf(h, owner, 'Sader Studio');
    const co = await person(h, { displayName: 'Rana Co-owner' });
    expect((await h.app.request(`/admin/v1/users/${co.userId}/memberships`, json({ organizationId: business, role: 'OWNER' }, ADMIN))).status).toBe(201);
    const link = await linkOn(h, owner, business);
    const seen = await listLinks(h, co, business);
    expect(seen.items).toEqual([expect.objectContaining({ id: link.id, createdByName: 'Basel Sader' })]);
    expect((await revokeLink(h, co, business, link.id)).status).toBe(204);
  });

  it('a personal profile can be shared', async () => {
    const h = shareLinkHarness();
    const { owner } = await ownerWithProfile(h);
    expect((await createLink(h, owner, owner.personalId)).status).toBe(201);
  });
});

describe('the lapse gate (MUT-560 A13)', () => {
  it('a LOCKED owner can’t create (402), still lists and revokes, and the link they made keeps working', async () => {
    const h = shareLinkHarness({ billingGate: true });
    const owner = await person(h, { displayName: 'Basel Sader' });
    await h.store.billing.setTrialStart(owner.userId, new Date(T0.getTime() - 3 * DAY));
    const link = await linkOn(h, owner, owner.personalId);
    await h.store.billing.setTrialStart(owner.userId, new Date(T0.getTime() - 40 * DAY));
    expect((await createLink(h, owner, owner.personalId)).status).toBe(402);
    expect((await h.app.request(`/v1/profiles/${owner.personalId}/share-links`, { headers: owner.auth })).status).toBe(200);
    const viewer = await viewerOf(h, link.token);
    expect((await entriesOf(h, viewer)).status).toBe(200);
    expect((await revokeLink(h, owner, owner.personalId, link.id)).status).toBe(204);
  });
});

describe('4. the token and PIN at rest (MUT-560)', () => {
  it('the row holds the token’s HMAC and the PIN’s argon2id, never either of them', async () => {
    const h = shareLinkHarness();
    const { owner, profileId } = await ownerWithProfile(h);
    const link = await linkOn(h, owner, profileId, { pin: '97531' });
    const row = await h.store.shareLinks.findByTokenDigest(sessionDigest(PEPPER, link.token));
    expect(row).not.toBeNull();
    expect(row!.tokenDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(row!.pinHash).toMatch(/^\$argon2id\$/);
    const stored = JSON.stringify(row);
    expect(stored).not.toContain(link.token);
    expect(stored).not.toContain('97531');
    // The viewer token is stored the same way.
    const viewer = await viewerOf(h, link.token, '97531');
    const found = await h.store.shareLinks.findViewerByDigest(sessionDigest(PEPPER, viewer));
    expect(JSON.stringify(found)).not.toContain(viewer);
  });

  it('the published contract carries no token in a path or a query, and every link route is a POST', async () => {
    const h = shareLinkHarness();
    const doc = await read(await h.app.request('/openapi.json'));
    const linkPaths = Object.entries(doc.paths as Record<string, Record<string, Loose>>).filter(([path]) => path.startsWith('/v1/share-links'));
    expect(linkPaths.map(([path]) => path).sort()).toEqual(['/v1/share-links/check', '/v1/share-links/download-ticket', '/v1/share-links/entries', '/v1/share-links/expense-receipts', '/v1/share-links/summary', '/v1/share-links/unlock']);
    for (const [path, ops] of linkPaths) {
      expect(Object.keys(ops), path).toEqual(['post']);
      expect(ops.post.security, path).toEqual([]);
    }
    for (const [path, ops] of Object.entries(doc.paths as Record<string, Record<string, Loose>>)) {
      expect(path).not.toMatch(/token/i);
      for (const [method, op] of Object.entries(ops)) {
        for (const param of (op.parameters ?? []) as Loose[]) expect(`${method} ${path} ${param.name}`).not.toMatch(/token$/i);
      }
    }
  });
});

describe('5. unlock and the PIN lockout (MUT-560)', () => {
  it('check says only that a PIN is needed; the correct PIN issues a viewer token and the names, which check never shows', async () => {
    const h = shareLinkHarness();
    const { owner, profileId } = await ownerWithProfile(h);
    const link = await linkOn(h, owner, profileId);
    const checked = await check(h, link.token);
    expect(checked.status).toBe(200);
    const body = await read(checked);
    expect(body).toEqual({ state: 'pin' });
    expect(JSON.stringify(body)).not.toMatch(/Basel|Personal/);
    const res = await unlock(h, link.token, '2468');
    expect(res.status).toBe(200);
    const unlocked = await read(res);
    expect(unlocked).toMatchObject({ ownerName: 'Basel Sader', profileName: 'Personal', period: 'LAST_1_MONTH', from: '2026-10-01', to: '2026-10-31', linkExpiresAt: link.expiresAt });
    expect(unlocked.viewerToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(new Date(unlocked.viewerExpiresAt).getTime()).toBe(T0.getTime() + 8 * HOUR);
  });

  it(`counts wrong PINs down (attemptsLeft ${SHARE_LINK_PIN_ATTEMPTS - 1} … 1); the ${SHARE_LINK_PIN_ATTEMPTS}th answers LOCKED, and so does the right PIN after`, async () => {
    const h = shareLinkHarness();
    const { owner, profileId } = await ownerWithProfile(h);
    const link = await linkOn(h, owner, profileId);
    for (let left = SHARE_LINK_PIN_ATTEMPTS - 1; left >= 1; left--) {
      const res = await unlock(h, link.token, '0000');
      expect(res.status).toBe(403);
      expect((await read(res)).error).toMatchObject({ code: 'SHARE_LINK_REFUSED', details: { reason: 'PIN_WRONG', attemptsLeft: left } });
    }
    const last = await unlock(h, link.token, '0000');
    expect(last.status).toBe(403);
    expect((await read(last)).error.details).toEqual({ reason: 'LOCKED' });
    expect((await read(await unlock(h, link.token, '2468'))).error.details).toEqual({ reason: 'LOCKED' });
    expect((await read(await check(h, link.token))).error).toMatchObject({ code: 'SHARE_LINK_REFUSED', details: { reason: 'LOCKED' } });
    expect((await listLinks(h, owner, profileId)).items[0]).toMatchObject({ id: link.id, status: 'locked' });
  });

  it('5 wrong PINs in parallel count exactly 5 and lock the link', async () => {
    const h = shareLinkHarness();
    const { owner, profileId } = await ownerWithProfile(h);
    const link = await linkOn(h, owner, profileId);
    const results = await Promise.all(Array.from({ length: 7 }, () => unlock(h, link.token, '1111')));
    expect(results.every((r) => r.status === 403)).toBe(true);
    const row = await h.store.shareLinks.findByTokenDigest(sessionDigest(PEPPER, link.token));
    expect(row).toMatchObject({ failedPinAttempts: SHARE_LINK_PIN_ATTEMPTS });
    expect(row!.lockedAt).not.toBeNull();
  });

  it('a lock also ends the access of viewers already in: their next read is the uniform 404', async () => {
    const h = shareLinkHarness();
    const { owner, profileId } = await ownerWithProfile(h);
    const link = await linkOn(h, owner, profileId);
    const viewer = await viewerOf(h, link.token);
    expect((await entriesOf(h, viewer)).status).toBe(200);
    for (let i = 0; i < SHARE_LINK_PIN_ATTEMPTS; i++) await unlock(h, link.token, '9999');
    const res = await entriesOf(h, viewer);
    expect(res.status).toBe(404);
    expect(await errorOf(res)).toEqual(UNAVAILABLE);
  });

  it('a malformed PIN at unlock counts as a wrong one', async () => {
    const h = shareLinkHarness();
    const { owner, profileId } = await ownerWithProfile(h);
    const link = await linkOn(h, owner, profileId);
    expect((await read(await unlock(h, link.token, 'abcd'))).error.details).toEqual({ reason: 'PIN_WRONG', attemptsLeft: SHARE_LINK_PIN_ATTEMPTS - 1 });
  });
});

describe('6. viewers (MUT-560)', () => {
  it(`${SHARE_LINK_MAX_VIEWERS} viewers open it; a 4th is refused VIEWER_LIMIT; the owner’s list counts them`, async () => {
    const h = shareLinkHarness();
    const { owner, profileId } = await ownerWithProfile(h);
    const link = await linkOn(h, owner, profileId);
    for (let i = 0; i < SHARE_LINK_MAX_VIEWERS; i++) await viewerOf(h, link.token);
    const fourth = await unlock(h, link.token, '2468');
    expect(fourth.status).toBe(403);
    expect((await read(fourth)).error).toMatchObject({ code: 'SHARE_LINK_REFUSED', details: { reason: 'VIEWER_LIMIT' } });
    expect((await listLinks(h, owner, profileId)).items[0]).toMatchObject({ viewers: SHARE_LINK_MAX_VIEWERS, maxViewers: SHARE_LINK_MAX_VIEWERS, status: 'active' });
  });

  it('the viewer limit is checked before the PIN: a 4th viewer’s wrong PIN never counts toward the lock', async () => {
    const h = shareLinkHarness();
    const { owner, profileId } = await ownerWithProfile(h);
    const link = await linkOn(h, owner, profileId);
    for (let i = 0; i < SHARE_LINK_MAX_VIEWERS; i++) await viewerOf(h, link.token);
    expect((await read(await unlock(h, link.token, '0000'))).error.details).toEqual({ reason: 'VIEWER_LIMIT' });
    expect((await h.store.shareLinks.findByTokenDigest(sessionDigest(PEPPER, link.token)))?.failedPinAttempts).toBe(0);
  });

  it('a returning viewer keeps its slot with a rotated token, at the cap too; its old token stops working', async () => {
    const h = shareLinkHarness();
    const { owner, profileId } = await ownerWithProfile(h);
    const link = await linkOn(h, owner, profileId);
    const first = await viewerOf(h, link.token);
    await viewerOf(h, link.token);
    await viewerOf(h, link.token);
    const again = await viewerOf(h, link.token, '2468', first);
    expect(again).not.toBe(first);
    expect((await entriesOf(h, again)).status).toBe(200);
    expect(await errorOf(await entriesOf(h, first))).toEqual(UNAVAILABLE);
    expect((await listLinks(h, owner, profileId)).items[0].viewers).toBe(SHARE_LINK_MAX_VIEWERS);
    const unlockedOnce = (await auditOf(h, profileId)).filter((e) => e.action === 'share_link.unlocked');
    expect(unlockedOnce.map((e) => (e.metadata as Loose).viewerNumber).sort()).toEqual([1, 2, 3]);
  });

  it('parallel unlocks at 2 viewers never make a 4th', async () => {
    const h = shareLinkHarness();
    const { owner, profileId } = await ownerWithProfile(h);
    const link = await linkOn(h, owner, profileId);
    await viewerOf(h, link.token);
    await viewerOf(h, link.token);
    const results = await Promise.all(Array.from({ length: 4 }, () => unlock(h, link.token, '2468')));
    expect(results.map((r) => r.status).sort()).toEqual([200, 403, 403, 403]);
    expect((await listLinks(h, owner, profileId)).items[0].viewers).toBe(3);
  });

  it('access ends after 8 hours (401 SHARE_VIEW_EXPIRED); unlocking again with the old token keeps the slot', async () => {
    const h = shareLinkHarness();
    const { owner, profileId } = await ownerWithProfile(h);
    const link = await linkOn(h, owner, profileId);
    const viewer = await viewerOf(h, link.token);
    later(h, 8 * HOUR);
    const expired = await entriesOf(h, viewer);
    expect(expired.status).toBe(401);
    expect((await read(expired)).error).toMatchObject({ code: 'UNAUTHENTICATED', details: { reason: 'SHARE_VIEW_EXPIRED' } });
    const again = await viewerOf(h, link.token, '2468', viewer);
    expect((await entriesOf(h, again)).status).toBe(200);
    expect((await listLinks(h, owner, profileId)).items[0].viewers).toBe(1);
  });

  it('access never outlives the link', async () => {
    const h = shareLinkHarness();
    const { owner, profileId } = await ownerWithProfile(h);
    const link = await linkOn(h, owner, profileId, { expiresInDays: 1 });
    later(h, 20 * HOUR);
    const unlocked = await read(await unlock(h, link.token, '2468'));
    expect(unlocked.viewerExpiresAt).toBe(link.expiresAt);
    later(h, 4 * HOUR);
    expect(await errorOf(await entriesOf(h, unlocked.viewerToken))).toEqual(UNAVAILABLE);
  });
});

describe('7. one 404 for every unusable link (MUT-560)', () => {
  async function everyRoute(h: AccountantHarness, token: string, viewer: string) {
    return [await check(h, token), await unlock(h, token, '2468', viewer), await entriesOf(h, viewer), await summaryOf(h, viewer), await receiptsOf(h, viewer, 'A'.repeat(22))];
  }
  async function expectUniform(responses: Response[]) {
    for (const res of responses) {
      expect(res.status, res.url).toBe(404);
      expect(await errorOf(res)).toEqual(UNAVAILABLE);
    }
  }
  async function opened(h: AccountantHarness) {
    const { owner, profileId } = await ownerWithProfile(h);
    const link = await linkOn(h, owner, profileId);
    return { owner, profileId, link, viewer: await viewerOf(h, link.token) };
  }

  it('an unknown token and an unknown viewer token', async () => {
    const h = shareLinkHarness();
    await expectUniform(await everyRoute(h, 'A'.repeat(43), 'B'.repeat(43)));
  });

  it('an expired link', async () => {
    const h = shareLinkHarness();
    const { link, viewer } = await opened(h);
    later(h, 7 * DAY);
    await expectUniform(await everyRoute(h, link.token, viewer));
  });

  it('a revoked link: every viewer’s next request', async () => {
    const h = shareLinkHarness();
    const { owner, profileId, link, viewer } = await opened(h);
    expect((await revokeLink(h, owner, profileId, link.id)).status).toBe(204);
    await expectUniform(await everyRoute(h, link.token, viewer));
    // OW5: the owner still sees it, revoked, for a day.
    expect((await listLinks(h, owner, profileId)).items).toEqual([expect.objectContaining({ id: link.id, status: 'revoked', endedAt: T0.toISOString() })]);
  });

  it('the owner closing their account', async () => {
    const h = shareLinkHarness();
    const { owner, link, viewer } = await opened(h);
    expect((await h.app.request('/v1/me/closure', json({ password: owner.password }, owner.auth))).status).toBe(200);
    await expectUniform(await everyRoute(h, link.token, viewer));
  });

  it('the switch off: the same 404 before anything else, on every link route', async () => {
    const on = shareLinkHarness();
    const { link, viewer } = await opened(on);
    const off = shareLinkHarness({ shareLinks: false, store: on.store });
    await expectUniform(await everyRoute(off, link.token, viewer));
    const { owner, profileId } = await ownerWithProfile(off);
    expect((await createLink(off, owner, profileId)).status).toBe(404);
    expect((await off.app.request(`/v1/profiles/${profileId}/share-links`, { headers: owner.auth })).status).toBe(404);
    expect((await revokeLink(off, owner, profileId, link.id)).status).toBe(404);
  });
});

describe('8. reads (MUT-560)', () => {
  it('entries come only from the link’s profile and its range, without profileId or createdByUserId', async () => {
    const h = shareLinkHarness();
    const { owner, profileId } = await ownerWithProfile(h);
    const other = await businessOf(h, owner, 'Other Studio');
    await expenseAt(h, owner, profileId, '2026-10-05', 'shared paper');
    await expenseAt(h, owner, other, '2026-10-05', 'private rent');
    await receivedAt(h, owner, profileId, '2026-10-06', '300.00');
    const viewer = await viewerOf(h, (await linkOn(h, owner, profileId)).token);
    const page = await read(await entriesOf(h, viewer));
    expect(page.items.map((e: Loose) => e.kind).sort()).toEqual(['expense', 'received']);
    const text = JSON.stringify(page);
    expect(text).not.toContain('private rent');
    expect(text).not.toContain(profileId);
    expect(text).not.toContain(owner.userId);
    for (const item of page.items) {
      expect(item).not.toHaveProperty('profileId');
      expect(item).not.toHaveProperty('createdByUserId');
    }
    expect(page.items.find((e: Loose) => e.kind === 'expense').expense).not.toHaveProperty('createdByUserId');
  });

  it('pages by money date, newest first, with a cursor', async () => {
    const h = shareLinkHarness();
    const { owner, profileId } = await ownerWithProfile(h);
    for (const day of ['2026-10-03', '2026-10-09', '2026-10-21']) await expenseAt(h, owner, profileId, day, day);
    const viewer = await viewerOf(h, (await linkOn(h, owner, profileId)).token);
    const first = await read(await entriesOf(h, viewer, { limit: 2 }));
    expect(first.items.map((e: Loose) => e.expense.occurredOn)).toEqual(['2026-10-21', '2026-10-09']);
    const second = await read(await entriesOf(h, viewer, { limit: 2, cursor: first.nextCursor }));
    expect(second.items.map((e: Loose) => e.expense.occurredOn)).toEqual(['2026-10-03']);
    expect(second.nextCursor).toBeNull();
  });

  it('the summary totals each currency apart and equals the feed’s sums; reversed and out-of-range rows don’t count', async () => {
    const h = shareLinkHarness();
    const { owner, profileId } = await ownerWithProfile(h);
    await expenseAt(h, owner, profileId, '2026-10-02', 'a', '10.50');
    await expenseAt(h, owner, profileId, '2026-10-30', 'b', '4.50');
    await expenseAt(h, owner, profileId, '2026-10-15', 'c', '20.00', 'USD');
    await expenseAt(h, owner, profileId, '2026-11-02', 'outside', '99.00');
    await receivedAt(h, owner, profileId, '2026-10-12', '100.00');
    await receivedAt(h, owner, profileId, '2026-10-13', '50.00', 'USD');
    const viewer = await viewerOf(h, (await linkOn(h, owner, profileId)).token);
    const summary = await read(await summaryOf(h, viewer));
    expect(summary.from).toBe('2026-10-01');
    expect(summary.to).toBe('2026-10-31');
    expect(summary.expenses.map((b: Loose) => [b.currency, b.total, b.count])).toEqual([
      ['ILS', '15.00', 2],
      ['USD', '20.00', 1],
    ]);
    expect(summary.received).toEqual([
      { currency: 'ILS', total: '100.00', count: 1 },
      { currency: 'USD', total: '50.00', count: 1 },
    ]);
  });

  it('receipts: an in-range expense’s READY receipts as short-lived signed URLs; out of range, deleted or another profile’s: 404', async () => {
    const storage = new MemoryAttachmentStorage();
    const h = shareLinkHarness({ attachments: storage });
    const { owner, profileId } = await ownerWithProfile(h);
    const other = await businessOf(h, owner, 'Other Studio');
    const keyOf = (url: string) => new URL(url).pathname.replace(/^\/+/, '').replace(/^upload\//, '');
    async function withReceipt(on: string, occurredOn: string, title: string) {
      const expense = await expenseAt(h, owner, on, occurredOn, title);
      const started = await read(await h.app.request(`/v1/expenses/${expense.id}/receipts`, json({ filename: 'cafe.jpg', mimeType: 'image/jpeg', sizeBytes: 2048 }, owner.on(on))));
      storage.put(keyOf(started.upload.url), { sizeBytes: 2048, contentType: 'image/jpeg' });
      expect((await h.app.request(`/v1/expenses/${expense.id}/receipts/${started.receipt.id}/complete`, { method: 'POST', headers: owner.on(on) })).status).toBe(200);
      return expense;
    }
    const inRange = await withReceipt(profileId, '2026-10-10', 'in range');
    const outOfRange = await withReceipt(profileId, '2026-11-02', 'out of range');
    const elsewhere = await withReceipt(other, '2026-10-10', 'elsewhere');
    const deleted = await withReceipt(profileId, '2026-10-11', 'deleted');
    expect((await h.app.request(`/v1/expenses/${deleted.id}`, { method: 'DELETE', headers: owner.on(profileId) })).status).toBe(204);
    const link = await linkOn(h, owner, profileId);
    const viewer = await viewerOf(h, link.token);
    const keyFor = (id: string) => shareRowKey(PEPPER, link.id, id);
    const entries = await read(await entriesOf(h, viewer));
    const listed = entries.items.find((e: Loose) => e.kind === 'expense' && e.expense.title === 'in range').expense;
    expect(listed.receiptCount).toBe(1);
    expect(listed.key).toBe(keyFor(inRange.id));

    const res = await receiptsOf(h, viewer, listed.key);
    expect(res.status).toBe(200);
    const { items } = await read(res);
    expect(items).toHaveLength(1);
    expect(items[0]).toEqual({ filename: 'cafe.jpg', mimeType: 'image/jpeg', url: expect.stringContaining('/download/org/'), expiresAt: expect.any(String) });
    // Review (MUT-560): a signed URL lives at most 60 seconds, so a revoke or lock cuts receipts within a minute.
    expect(new Date(items[0].expiresAt).getTime()).toBe(T0.getTime() + 60_000);
    for (const e of [outOfRange, elsewhere, deleted]) {
      const refused = await receiptsOf(h, viewer, keyFor(e.id));
      expect(refused.status, e.title).toBe(404);
      expect((await read(refused)).error.code).toBe('NOT_FOUND');
    }
    expect((await receiptsOf(h, viewer, 'not-a-key')).status).toBe(404);
  });

  it('receipts without a bucket: 503 ATTACHMENTS_NOT_CONFIGURED; entries still work', async () => {
    const h = shareLinkHarness({ attachments: null });
    const { owner, profileId } = await ownerWithProfile(h);
    const e = await expenseAt(h, owner, profileId, '2026-10-10', 'x');
    const link = await linkOn(h, owner, profileId);
    const viewer = await viewerOf(h, link.token);
    const res = await receiptsOf(h, viewer, shareRowKey(PEPPER, link.id, e.id));
    expect(res.status).toBe(503);
    expect((await read(res)).error.code).toBe('ATTACHMENTS_NOT_CONFIGURED');
    expect((await entriesOf(h, viewer)).status).toBe(200);
  });
});

describe('9. read-only (MUT-560)', () => {
  it('no route under /v1/share-links/ answers a non-POST method', async () => {
    const h = shareLinkHarness();
    for (const path of ['check', 'unlock', 'entries', 'summary', 'expense-receipts']) {
      for (const method of ['GET', 'PUT', 'PATCH', 'DELETE']) {
        const res = await h.app.request(`/v1/share-links/${path}`, { method, headers: { origin: 'http://localhost' } });
        expect([401, 404], `${method} ${path}`).toContain(res.status);
      }
    }
  });
});

describe('10. throttles and audit (MUT-560)', () => {
  it('stamps lastOpenedAt at unlock and at most hourly on views', async () => {
    const h = shareLinkHarness();
    const { owner, profileId } = await ownerWithProfile(h);
    const link = await linkOn(h, owner, profileId);
    const openedAt = async () => (await listLinks(h, owner, profileId)).items[0].lastOpenedAt;
    expect(await openedAt()).toBeNull();
    const viewer = await viewerOf(h, link.token);
    expect(await openedAt()).toBe(T0.toISOString());
    later(h, 20 * 60_000);
    await entriesOf(h, viewer);
    // The unlock stamped the link 20 minutes ago: this first view stamps the viewer, not the link again.
    const first = await openedAt();
    expect(first).toBe(T0.toISOString());
    later(h, 20 * 60_000);
    await entriesOf(h, viewer);
    expect(await openedAt()).toBe(first);
    later(h, HOUR);
    await entriesOf(h, viewer);
    expect(await openedAt()).toBe(h.now().toISOString());
    const found = await h.store.shareLinks.findViewerByDigest(sessionDigest(PEPPER, viewer));
    expect(found?.viewer.lastViewedAt?.toISOString()).toBe(h.now().toISOString());
  });

  it('writes created, unlocked (new viewers only), locked and revoked rows, never the token, the PIN or an address', async () => {
    const h = shareLinkHarness();
    const { owner, profileId } = await ownerWithProfile(h);
    const link = await linkOn(h, owner, profileId, { pin: '86420' });
    const viewer = await viewerOf(h, link.token, '86420');
    await viewerOf(h, link.token, '86420', viewer);
    for (let i = 0; i < SHARE_LINK_PIN_ATTEMPTS; i++) await unlock(h, link.token, '11111');
    const second = await linkOn(h, owner, profileId);
    await revokeLink(h, owner, profileId, second.id);
    const rows = await auditOf(h, profileId);
    expect(rows.map((e) => e.action).sort()).toEqual(['share_link.created', 'share_link.created', 'share_link.locked', 'share_link.revoked', 'share_link.unlocked']);
    const text = JSON.stringify(rows);
    for (const secret of [link.token, viewer, '86420', second.token]) expect(text).not.toContain(secret);
    expect(text).not.toMatch(/\d+\.\d+\.\d+\.\d+/);
  });
});

describe('11. rate limits (MUT-560)', () => {
  it('check and unlock share a per-IP budget (429 with Retry-After)', async () => {
    const h = shareLinkHarness({ signInIpLimiter: new SlidingWindowRateLimiter(3) });
    const { owner, profileId } = await ownerWithProfile(h);
    const link = await linkOn(h, owner, profileId);
    expect((await check(h, link.token)).status).toBe(200);
    expect((await check(h, link.token)).status).toBe(200);
    expect((await unlock(h, link.token, '2468')).status).toBe(200);
    const limited = await unlock(h, link.token, '2468');
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
  });

  it('views are budgeted per viewer', async () => {
    const h = shareLinkHarness({ shareLinkViewLimiter: new SlidingWindowRateLimiter(2) });
    const { owner, profileId } = await ownerWithProfile(h);
    const link = await linkOn(h, owner, profileId);
    const one = await viewerOf(h, link.token);
    const two = await viewerOf(h, link.token);
    expect((await entriesOf(h, one)).status).toBe(200);
    expect((await summaryOf(h, one)).status).toBe(200);
    const limited = await entriesOf(h, one);
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
    expect((await entriesOf(h, two)).status).toBe(200);
  });
});

describe('12. closure and purge (MUT-560)', () => {
  async function purge(h: AccountantHarness, p: Person) {
    expect((await h.app.request('/v1/me/closure', json({ password: p.password }, p.auth))).status).toBe(200);
    later(h, 30 * DAY + 60_000);
    const res = await h.app.request('/jobs/v1/accounts/purge', { method: 'POST', headers: JOB });
    expect(await read(res)).toMatchObject({ purged: 1, failed: 0 });
  }

  it('the owner’s purge takes their profile’s links, and is never blocked by them', async () => {
    const h = shareLinkHarness();
    const { owner, profileId } = await ownerWithProfile(h);
    const link = await linkOn(h, owner, profileId, { expiresInDays: 30 });
    await viewerOf(h, link.token);
    await purge(h, owner);
    expect(await h.store.shareLinks.findByTokenDigest(sessionDigest(PEPPER, link.token))).toBeNull();
  });

  it('a co-owner who made a link and is purged leaves it on the profile, with no creator, revocable by the owner', async () => {
    const h = shareLinkHarness();
    const owner = await person(h, { displayName: 'Basel Sader' });
    const business = await businessOf(h, owner, 'Sader Studio');
    const co = await person(h, { displayName: 'Rana Co-owner' });
    expect((await h.app.request(`/admin/v1/users/${co.userId}/memberships`, json({ organizationId: business, role: 'OWNER' }, ADMIN))).status).toBe(201);
    const link = await linkOn(h, co, business, { expiresInDays: 30 });
    await purge(h, co);
    // Expired a minute ago: listed (OW5) as expired, its creator gone.
    const listed = (await listLinks(h, owner, business)).items;
    expect(listed).toEqual([expect.objectContaining({ id: link.id, status: 'expired', createdByName: null })]);
    // Expired by now (30 days and a minute): the row remains, its creator gone.
    expect(await h.store.shareLinks.findByTokenDigest(sessionDigest(PEPPER, link.token))).toMatchObject({ id: link.id, createdByUserId: null });
  });
});

describe('13. headers (MUT-560)', () => {
  it('noindex and no-store on every link route', async () => {
    const h = shareLinkHarness();
    const { owner, profileId } = await ownerWithProfile(h);
    const link = await linkOn(h, owner, profileId);
    const viewer = await viewerOf(h, link.token);
    for (const res of [await check(h, link.token), await unlock(h, link.token, '2468', viewer), await entriesOf(h, viewer), await summaryOf(h, viewer), await createLink(h, owner, profileId)]) {
      expect(res.headers.get('x-robots-tag')).toBe('noindex');
      expect(res.headers.get('cache-control')).toBe('no-store');
    }
  });
});

describe('14. isolation from the main API (MUT-560)', () => {
  it('a viewer token is no credential: as a Bearer or a cookie on /v1 it answers 401', async () => {
    const h = shareLinkHarness();
    const { owner, profileId } = await ownerWithProfile(h);
    const viewer = await viewerOf(h, (await linkOn(h, owner, profileId)).token);
    expect((await h.app.request('/v1/expenses', { headers: { authorization: `Bearer ${viewer}`, 'x-mutaba3a-profile': profileId } })).status).toBe(401);
    expect((await h.app.request('/v1/me', { headers: { authorization: `Bearer ${viewer}` } })).status).toBe(401);
    expect((await h.app.request('/v1/expenses', { headers: { cookie: `mut_session=${viewer}`, 'x-mutaba3a-profile': profileId } })).status).toBe(401);
  });

  it('the link routes come from the portal only (403 CROSS_SITE_REQUEST otherwise)', async () => {
    const h = shareLinkHarness();
    const { owner, profileId } = await ownerWithProfile(h);
    const link = await linkOn(h, owner, profileId);
    const res = await publicPost(h, 'check', { token: link.token }, { origin: 'https://evil.example' });
    expect(res.status).toBe(403);
    expect((await read(res)).error.code).toBe('CROSS_SITE_REQUEST');
  });
});
