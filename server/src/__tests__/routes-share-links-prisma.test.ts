import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { PrismaLedgerStore } from '../repositories/prisma.js';
import { SHARE_LINK_PIN_ATTEMPTS } from '../share-links/links.js';
import { idem, json, person, read, type AccountantHarness, type Loose } from './helpers/accountants.js';
import { check, entriesOf, linkOn, listLinks, revokeLink, shareLinkHarness, summaryOf, unlock, viewerOf } from './helpers/share-links.js';

/**
 * MUT-560 review 7: the key share-link flows through the real app on Postgres (test:db), so the row locks, the atomic
 * PIN count and the stale re-unlock are proven where they matter, not only on the memory store.
 */
const url = process.env.MUTABA3A_TEST_DATABASE_URL;

if (!url) {
  describe.skip('share-link routes on Postgres (set MUTABA3A_TEST_DATABASE_URL to run)', () => {
    it('skipped', () => {});
  });
} else {
  const store = PrismaLedgerStore.connect(url);
  afterAll(() => store.disconnect());
  const harness = () => shareLinkHarness({ store });
  const owner = (h: AccountantHarness) => person(h, { email: `share-${randomUUID()}@studio.ps`, displayName: 'Basel Sader' });

  describe('share-link routes on Postgres (MUT-560)', () => {
    it('create → check → unlock → entries and summary of the range → revoke → the uniform 404', async () => {
      const h = harness();
      const o = await owner(h);
      for (const [day, title] of [['2026-09-30', 'before'], ['2026-10-01', 'from'], ['2026-10-31', 'to'], ['2026-11-01', 'after']]) {
        expect((await h.app.request('/v1/expenses', json({ amount: '10.00', currency: 'ILS', occurredOn: day, title }, { ...o.on(o.personalId), ...idem() }))).status).toBe(201);
      }
      const link = await linkOn(h, o, o.personalId);
      expect(await read(await check(h, link.token))).toEqual({ state: 'pin' });
      const viewer = await viewerOf(h, link.token);
      const page = await read(await entriesOf(h, viewer));
      expect(page.items.map((e: Loose) => e.expense.title).sort()).toEqual(['from', 'to']);
      const summary = await read(await summaryOf(h, viewer));
      expect(summary.expenses).toEqual([expect.objectContaining({ currency: 'ILS', total: '20.00', count: 2 })]);
      expect((await revokeLink(h, o, o.personalId, link.id)).status).toBe(204);
      expect((await entriesOf(h, viewer)).status).toBe(404);
    });

    it('parallel wrong PINs lock at exactly the limit; viewers already in are cut off', async () => {
      const h = harness();
      const o = await owner(h);
      const link = await linkOn(h, o, o.personalId);
      const viewer = await viewerOf(h, link.token);
      const results = await Promise.all(Array.from({ length: SHARE_LINK_PIN_ATTEMPTS + 3 }, () => unlock(h, link.token, '0000')));
      expect(results.every((r) => r.status === 403)).toBe(true);
      expect((await listLinks(h, o, o.personalId)).items[0]).toMatchObject({ status: 'locked' });
      expect((await read(await unlock(h, link.token, '2468'))).error.details).toEqual({ reason: 'LOCKED' });
      expect((await entriesOf(h, viewer)).status).toBe(404);
    });

    it('parallel unlocks at 2 viewers make exactly one more; two re-unlocks with one old token: one renews, one is stale', async () => {
      const h = harness();
      const o = await owner(h);
      const link = await linkOn(h, o, o.personalId);
      const first = await viewerOf(h, link.token);
      await viewerOf(h, link.token);
      const opened = await Promise.all(Array.from({ length: 4 }, () => unlock(h, link.token, '2468')));
      expect(opened.map((r) => r.status).sort()).toEqual([200, 403, 403, 403]);
      const again = await Promise.all([unlock(h, link.token, '2468', first), unlock(h, link.token, '2468', first)]);
      expect(again.map((r) => r.status).sort()).toEqual([200, 409]);
      expect((await listLinks(h, o, o.personalId)).items[0].viewers).toBe(3);
    });
  });
}
