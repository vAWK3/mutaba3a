import { describe, expect, it } from 'vitest';
import { clampToRange } from '../share-links/period.js';
import { idem, json, person, read, type AccountantHarness, type Loose, type Person } from './helpers/accountants.js';
import { entriesOf, linkOn, shareLinkHarness, viewerOf } from './helpers/share-links.js';

/**
 * MUT-575 S5 (plan test 12): the link page's feed filters. `kinds` narrows within what the link shows (expenses and
 * received payments); `occurredFrom` / `occurredBefore` are clamped inside the link's frozen range, never widened; a
 * request without them answers exactly what MUT-560 ships.
 */
async function entryAt(h: AccountantHarness, p: Person, kind: 'expense' | 'received', occurredOn: string): Promise<string> {
  const res =
    kind === 'expense'
      ? await h.app.request('/v1/expenses', json({ amount: '12.00', currency: 'ILS', occurredOn, title: `e ${occurredOn}` }, { ...p.on(p.personalId), ...idem() }))
      : await h.app.request('/v1/income', json({ kind: 'received', amount: '50.00', currency: 'ILS', occurredOn }, { ...p.on(p.personalId), ...idem() }));
  if (res.status !== 201) throw new Error(`${kind} failed: ${res.status} ${await res.text()}`);
  return (await read(res)).id as string;
}

const daysOf = (page: Loose) => page.items.map((i: Loose) => `${i.kind}:${i.expense?.occurredOn ?? i.income?.occurredOn}`);

async function world() {
  const h = shareLinkHarness();
  const owner = await person(h, { displayName: 'Basel Sader' });
  for (const day of ['2026-09-30', '2026-10-01', '2026-10-15', '2026-10-31', '2026-11-02']) await entryAt(h, owner, 'expense', day);
  for (const day of ['2026-10-10', '2026-10-20']) await entryAt(h, owner, 'received', day);
  // LAST_1_MONTH on 2026-11-06: 2026-10-01 … 2026-10-31.
  const viewer = await viewerOf(h, (await linkOn(h, owner, owner.personalId, { period: 'LAST_1_MONTH' })).token);
  return { h, viewer };
}

describe('12. link feed filters (MUT-575 S5)', () => {
  it('the default answer is unchanged: every in-range expense and received payment', async () => {
    const { h, viewer } = await world();
    expect(daysOf(await read(await entriesOf(h, viewer)))).toEqual([
      'expense:2026-10-31',
      'received:2026-10-20',
      'expense:2026-10-15',
      'received:2026-10-10',
      'expense:2026-10-01',
    ]);
  });

  it('kinds narrows, and can never add a kind the link doesn’t show', async () => {
    const { h, viewer } = await world();
    expect(daysOf(await read(await entriesOf(h, viewer, { kinds: ['received'] })))).toEqual(['received:2026-10-20', 'received:2026-10-10']);
    expect(daysOf(await read(await entriesOf(h, viewer, { kinds: ['expense'] })))).toEqual(['expense:2026-10-31', 'expense:2026-10-15', 'expense:2026-10-01']);
    expect((await entriesOf(h, viewer, { kinds: ['owed'] })).status).toBe(422);
    // No kind, or a from after the before: an empty page, never an error.
    expect(await read(await entriesOf(h, viewer, { kinds: [] }))).toEqual({ items: [], nextCursor: null });
    expect(await read(await entriesOf(h, viewer, { occurredFrom: '2026-10-20', occurredBefore: '2026-10-10' }))).toEqual({ items: [], nextCursor: null });
  });

  it('a from before the range is clamped to it, a before after it too; inside, they narrow', async () => {
    const { h, viewer } = await world();
    const wide = await read(await entriesOf(h, viewer, { occurredFrom: '2026-01-01', occurredBefore: '2027-01-01' }));
    expect(daysOf(wide)).toEqual(daysOf(await read(await entriesOf(h, viewer))));
    expect(daysOf(await read(await entriesOf(h, viewer, { occurredFrom: '2026-10-10', occurredBefore: '2026-10-31' })))).toEqual(['received:2026-10-20', 'expense:2026-10-15', 'received:2026-10-10']);
    expect(daysOf(await read(await entriesOf(h, viewer, { occurredFrom: '2026-11-01' })))).toEqual([]);
  });

  it('clampToRange never widens', () => {
    const range = { from: '2026-10-01', to: '2026-10-31' };
    expect(clampToRange(range, undefined, undefined)).toEqual({ occurredFrom: '2026-10-01', occurredBefore: '2026-11-01' });
    expect(clampToRange(range, '2026-09-01', '2026-12-01')).toEqual({ occurredFrom: '2026-10-01', occurredBefore: '2026-11-01' });
    expect(clampToRange(range, '2026-10-05', '2026-10-06')).toEqual({ occurredFrom: '2026-10-05', occurredBefore: '2026-10-06' });
    expect(clampToRange({ from: null, to: '2026-11-06' }, '2020-01-01', undefined)).toEqual({ occurredFrom: '2020-01-01', occurredBefore: '2026-11-07' });
    expect(clampToRange({ from: null, to: '2026-11-06' }, undefined, '2030-01-01')).toEqual({ occurredBefore: '2026-11-07' });
  });
});
