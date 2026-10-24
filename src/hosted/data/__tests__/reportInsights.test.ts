import { describe, expect, it } from 'vitest';
import { buildInsights, CONCENTRATION_SHARE, recordViews, type MonthPoint } from '../reportInsights';

/** MUT-175: deterministic staged insights (B4 as amended by DR15; DR16–DR19, DR29, D3). */

const month = (m: string, received: number, spent: number, extra: Partial<MonthPoint> = {}): MonthPoint => ({ month: m, received, spent, categories: [], clients: [], ...extra });
const cat = (name: string, amount: number) => ({ key: name.toLowerCase(), name, amount });
const client = (name: string, amount: number) => ({ key: `p1:${name}`, name, amount });

const ids = (insights: ReturnType<typeof buildInsights>) => insights.map((i) => i.id);

describe('stage 1 and 2', () => {
  it('stage 1 has no insights', () => {
    expect(buildInsights({ stage: 1, months: [], daysToPaid: null })).toEqual([]);
  });

  it('stage 2 is only a factual recap of the first complete month: received, spent, top category, top client', () => {
    const [recap, ...rest] = buildInsights({
      stage: 2,
      months: [month('2026-09', 50000, 12000, { categories: [cat('Rent', 9000), cat('Food', 3000)], clients: [client('Haddad', 30000), client('Nasser', 20000)] })],
      daysToPaid: 4,
    });
    expect(rest).toEqual([]);
    expect(recap!.id).toBe('recap');
    expect(recap!.parts).toEqual([
      { key: 'insights.recap.base', values: { month: { kind: 'month', month: '2026-09' }, received: { kind: 'money', minor: 50000 }, spent: { kind: 'money', minor: 12000 } } },
      { key: 'insights.recap.topCategory', values: { category: { kind: 'text', text: 'Rent' } } },
      { key: 'insights.recap.topClient', values: { client: { kind: 'text', text: 'Haddad' } } },
    ]);
  });

  it('a recap with no spending and no client keeps to the base sentence', () => {
    const [recap] = buildInsights({ stage: 2, months: [month('2026-09', 100, 0)], daysToPaid: null });
    expect(recap!.parts.map((p) => p.key)).toEqual(['insights.recap.base']);
  });
});

describe('stage 3 thresholds', () => {
  const base = (latest: Partial<MonthPoint>, previous: Partial<MonthPoint> = {}) => [month('2026-08', 10000, 10000, previous), month('2026-09', 10000, 10000, latest)];

  it('names a category mover only when the change is big enough in share and in percent', () => {
    // 10000 spent; +1000 on Food (from 4000 to 5000) is 10% of the month and +25%: shown
    const shown = buildInsights({ stage: 3, months: base({ categories: [cat('Food', 5000)] }, { categories: [cat('Food', 4000)] }), daysToPaid: null });
    expect(shown.find((i) => i.id === 'mover')!.parts[0]).toEqual({
      key: 'insights.mover.up',
      values: { category: { kind: 'text', text: 'Food' }, amount: { kind: 'money', minor: 5000 }, month: { kind: 'month', month: '2026-09' }, delta: { kind: 'money', minor: 1000 }, previous: { kind: 'month', month: '2026-08' } },
    });
    // +999 is under 10% of the month
    expect(ids(buildInsights({ stage: 3, months: base({ categories: [cat('Food', 4999)] }, { categories: [cat('Food', 4000)] }), daysToPaid: null }))).not.toContain('mover');
    // +1000 from 5000 is only +20%
    expect(ids(buildInsights({ stage: 3, months: base({ categories: [cat('Food', 6000)] }, { categories: [cat('Food', 5000)] }), daysToPaid: null }))).not.toContain('mover');
  });

  it('a category that fell says less, and a new category counts as a change', () => {
    const down = buildInsights({ stage: 3, months: base({ categories: [cat('Food', 2000)] }, { categories: [cat('Food', 4000)] }), daysToPaid: null });
    expect(down.find((i) => i.id === 'mover')!.parts[0]!.key).toBe('insights.mover.down');
    const fresh = buildInsights({ stage: 3, months: base({ categories: [cat('Travel', 3000)] }), daysToPaid: null });
    expect(fresh.find((i) => i.id === 'mover')!.parts[0]!.values.category).toEqual({ kind: 'text', text: 'Travel' });
  });

  it('names client concentration at 35% of the last 3 months’ received, never for “no client”', () => {
    const at = (share: number) => [month('2026-07', 0, 0), month('2026-08', 0, 0), month('2026-09', 10000, 0, { clients: [client('Haddad', Math.round(10000 * share)), client('Other', 10000 - Math.round(10000 * share))] })];
    expect(CONCENTRATION_SHARE).toBe(0.35);
    const shown = buildInsights({ stage: 3, months: at(0.35), daysToPaid: null }).find((i) => i.id === 'concentration');
    expect(shown!.parts[0]!.values).toEqual({ client: { kind: 'text', text: 'Other' }, percent: { kind: 'percent', value: 65 } });
    const below = [month('2026-08', 0, 0), month('2026-09', 10000, 0, { clients: [client('A', 3400), client('B', 3300), client('C', 3300)] })];
    expect(ids(buildInsights({ stage: 3, months: below, daysToPaid: null }))).not.toContain('concentration');
    const noClient = [month('2026-08', 0, 0), month('2026-09', 10000, 0, { clients: [{ key: 'p1:none', name: 'No client', amount: 9000, none: true }, client('A', 1000)] })];
    expect(ids(buildInsights({ stage: 3, months: noClient, daysToPaid: null }))).not.toContain('concentration');
  });

  it('days to get paid shows from the server’s median, and the same day has its own sentence', () => {
    const months = base({});
    expect(buildInsights({ stage: 3, months, daysToPaid: 14 }).find((i) => i.id === 'daysToPaid')!.parts[0]).toEqual({ key: 'insights.daysToPaid', values: {}, count: 14 });
    expect(buildInsights({ stage: 3, months, daysToPaid: 0 }).find((i) => i.id === 'daysToPaid')!.parts[0]!.key).toBe('insights.daysToPaidSameDay');
    expect(ids(buildInsights({ stage: 3, months, daysToPaid: null }))).not.toContain('daysToPaid');
  });

  it('the received trend shows from a 10% change between the two latest months', () => {
    const trend = (latest: number) => buildInsights({ stage: 3, months: [month('2026-08', 10000, 0), month('2026-09', latest, 0)], daysToPaid: null }).find((i) => i.id === 'trend');
    expect(trend(11000)!.parts[0]!.key).toBe('insights.trend.up');
    expect(trend(9000)!.parts[0]!.key).toBe('insights.trend.down');
    expect(trend(10999)).toBeUndefined();
  });

  it('best month and the 3-month average need 3 complete months', () => {
    const two = [month('2026-08', 10000, 0), month('2026-09', 20000, 0)];
    expect(ids(buildInsights({ stage: 3, months: two, daysToPaid: null }))).not.toContain('best');
    const four = [month('2026-06', 30000, 0), month('2026-07', 9000, 0), month('2026-08', 9000, 0), month('2026-09', 9000, 0)];
    const all = buildInsights({ stage: 3, months: four, daysToPaid: null });
    expect(all.find((i) => i.id === 'best')!.parts[0]!.values).toEqual({ month: { kind: 'month', month: '2026-06' }, amount: { kind: 'money', minor: 30000 } });
  });
});

describe('ranking (DR29, DR18) and the cap', () => {
  const rich = [
    month('2026-06', 30000, 0),
    month('2026-07', 9000, 0),
    month('2026-08', 9000, 10000, { categories: [cat('Food', 4000)], clients: [client('Haddad', 9000)] }),
    month('2026-09', 20000, 10000, { categories: [cat('Food', 6000)], clients: [client('Haddad', 20000)] }),
  ];

  it('orders by kind — mover, concentration, days to paid, best month, trend, average — and keeps 3', () => {
    expect(ids(buildInsights({ stage: 3, months: rich, daysToPaid: 9 }))).toEqual(['mover', 'concentration', 'daysToPaid']);
  });

  it('a fact seen on 3 earlier visits drops below fresh ones; a changed fact ranks first', () => {
    const first = buildInsights({ stage: 3, months: rich, daysToPaid: 9 });
    let seen = {};
    for (let i = 0; i < 3; i++) seen = recordViews(seen, first);
    expect(ids(buildInsights({ stage: 3, months: rich, daysToPaid: 9 }, seen))).toEqual(['best', 'trend', 'average']);
    expect(ids(buildInsights({ stage: 3, months: rich, daysToPaid: 12 }, seen))).toEqual(['daysToPaid', 'best', 'trend']);
  });

  it('records a view per shown insight, restarting the count when its fact changes', () => {
    const [mover] = buildInsights({ stage: 3, months: rich, daysToPaid: null });
    const once = recordViews({}, [mover!]);
    expect(once).toEqual({ mover: { fact: mover!.fact, views: 1 } });
    expect(recordViews(once, [mover!]).mover!.views).toBe(2);
    expect(recordViews(once, [{ ...mover!, fact: 'other' }]).mover).toEqual({ fact: 'other', views: 1 });
  });
});
