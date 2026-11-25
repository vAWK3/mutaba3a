import { describe, expect, it, vi } from 'vitest';
import { RegistryLookup } from '../registry.js';

/** MUT-642: the registry lookup, with data.gov.il stubbed. */
const config = { baseUrl: 'https://data.example/api/3/action/datastore_search', companiesResource: 'companies', nonprofitsResource: 'amutot', timeoutMs: 1000, ttlMs: 60_000 };
const ok = (records: unknown[]) => new Response(JSON.stringify({ success: true, result: { records } }), { status: 200 });

describe('RegistryLookup', () => {
  it('finds an active company with its registered address, asking the companies file by number', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => ok([{ 'שם חברה': 'ברמג׳יאת בע״מ', 'שם באנגלית': 'BARMAJIYAT LTD', 'סטטוס חברה': 'פעילה', 'שם רחוב': 'החרמון', 'מספר בית': '12', 'שם עיר': 'נצרת', 'מיקוד': 1600000 }]));
    const result = await new RegistryLookup({ ...config, fetch }).lookup('516123452');
    expect(result).toEqual({ kind: 'found', entry: { kind: 'company', name: 'ברמג׳יאת בע״מ', nameEn: 'BARMAJIYAT LTD', status: 'פעילה', active: true, address: 'החרמון 12, נצרת, 1600000' } });
    const url = new URL(String(fetch.mock.calls[0]![0]));
    expect(url.searchParams.get('resource_id')).toBe('companies');
    expect(JSON.parse(url.searchParams.get('filters')!)).toEqual({ 'מספר חברה': 516123452 });
  });

  it('marks a struck-off company inactive', async () => {
    const result = await new RegistryLookup({ ...config, fetch: async () => ok([{ 'שם חברה': 'ישנה בע״מ', 'סטטוס חברה': 'מחוקה' }]) }).lookup('510000045');
    expect(result).toMatchObject({ kind: 'found', entry: { active: false, status: 'מחוקה', address: null } });
  });

  it('asks the nonprofits registry for a 58 number', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => ok([{ 'שם עמותה בעברית': 'עמותת הגליל', 'סטטוס עמותה': 'רשומה', 'כתובת - ישוב': 'חיפה' }]));
    expect(await new RegistryLookup({ ...config, fetch }).lookup('580000008')).toMatchObject({ kind: 'found', entry: { kind: 'nonprofit', active: true, address: 'חיפה' } });
    expect(new URL(String(fetch.mock.calls[0]![0])).searchParams.get('resource_id')).toBe('amutot');
  });

  it('a nonprofit prints street, number and town as the live registry spells them', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => ok([{ 'מספר עמותה': 580000016, 'שם עמותה בעברית': 'ארץ', 'סטטוס עמותה': 'רשומה', 'כתובת - רחוב': 'זליג', 'כתובת - מספר דירה': '10', 'כתובת - ישוב': 'תל אביב - יפו', 'כתובת - מיקוד': 6969352 }]));
    expect(await new RegistryLookup({ ...config, fetch }).lookup('580000016')).toMatchObject({ kind: 'found', entry: { address: 'זליג 10, תל אביב - יפו, 6969352' } });
  });

  it('keeps the most recently answered numbers: a refreshed number never evicts another', async () => {
    let t = 0;
    const fetch = vi.fn<typeof globalThis.fetch>(async () => ok([{ 'שם חברה': 'X', 'סטטוס חברה': 'פעילה' }]));
    const registry = new RegistryLookup({ ...config, ttlMs: 10, fetch, now: () => t });
    await registry.lookup('516123452');
    await registry.lookup('510000045');
    t = 100; // both stale
    await registry.lookup('516123452'); // refreshed: same size, nothing evicted
    expect(fetch).toHaveBeenCalledTimes(3);
    t = 105;
    await registry.lookup('516123452');
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('a sole dealer or a person is not in any registry and never asks', async () => {
    const fetch = vi.fn();
    expect(await new RegistryLookup({ ...config, fetch }).lookup('000000018')).toEqual({ kind: 'not_found' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('a number the registry doesn\'t hold is not found', async () => {
    expect(await new RegistryLookup({ ...config, fetch: async () => ok([]) }).lookup('516123452')).toEqual({ kind: 'not_found' });
  });

  it('an error, a timeout or a bad answer is unavailable and not cached; an answer is cached until it expires', async () => {
    let now = 0;
    const fetch = vi.fn().mockRejectedValueOnce(new Error('timeout')).mockResolvedValueOnce(new Response('nope', { status: 500 })).mockResolvedValue(ok([{ 'שם חברה': 'A', 'סטטוס חברה': 'פעילה' }]));
    const lookup = new RegistryLookup({ ...config, fetch, now: () => now });
    expect(await lookup.lookup('516123452')).toEqual({ kind: 'unavailable' });
    expect(await lookup.lookup('516123452')).toEqual({ kind: 'unavailable' });
    expect((await lookup.lookup('516123452')).kind).toBe('found');
    await lookup.lookup('516123452');
    expect(fetch).toHaveBeenCalledTimes(3);
    now = 61_000;
    await lookup.lookup('516123452');
    expect(fetch).toHaveBeenCalledTimes(4);
  });
});
