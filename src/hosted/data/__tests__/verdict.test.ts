import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CASES, type contractOf } from '../../../../scripts/verdict-glance-fixtures';
import type { HostedProfile, Me, Verdict } from '../../api/client';
import { allLocked, glanceOf, glanceShellProfile, isFirstRun, outsideProfiles, verdictAllLocked, type GlanceInput } from '../verdict';

/** MUT-448: the Glance ledger shaped from GET /v1/summaries/verdict (plan P6–P9, P14, D7, D8, DD1, DD3, DD4, DD8, DD9). */

type VerdictProfile = Verdict['profiles'][number];

const ZERO_HISTORY: VerdictProfile['history'] = [];

function profile(over: Partial<VerdictProfile> & Pick<VerdictProfile, 'profileId' | 'name'>): VerdictProfile {
  return { kind: 'BUSINESS', shared: false, currencies: [], converted: null, history: ZERO_HISTORY, owed: { currencies: [], overdueCount: 0 }, omittedCurrencies: [], ...over };
}

const nal = profile({ profileId: 'nal', name: 'Nal Software', currencies: [{ currency: 'ILS', received: '10000.00', spent: '960.00', net: '9040.00' }], converted: { received: '10000.00', spent: '960.00', net: '9040.00' } });
const me = profile({ profileId: 'me', name: 'Personal', kind: 'PERSONAL', currencies: [{ currency: 'ILS', received: '0.00', spent: '6350.00', net: '-6350.00' }], converted: { received: '0.00', spent: '6350.00', net: '-6350.00' } });

function verdict(over: Partial<Verdict> = {}): Verdict {
  return {
    from: '2026-09-01',
    to: '2026-09-30',
    asOf: '2026-10-26',
    base: 'ILS',
    rates: { date: '2026-10-23', source: 'live' },
    profiles: [nal, me],
    total: { label: 'kept', currencies: [{ currency: 'ILS', net: '2690.00' }], converted: '2690.00', inCurrencyOnly: null, sharedInFull: false, partial: false },
    usual: '2000.00',
    owed: { currencies: [{ currency: 'ILS', outstanding: '11500.00', overdue: '3000.00' }], overdueCount: 2, converted: '11500.00' },
    unavailable: [],
    ...over,
  };
}

const input = (over: Partial<GlanceInput> = {}): GlanceInput => ({ period: 'month', readable: new Set(['nal', 'me']), ...over });

describe('glanceOf: rows', () => {
  it('shows a business and a personal profile as two rows, with kept and owed (AC1)', () => {
    const g = glanceOf(verdict(), input());
    expect(g.rows.map((r) => [r.name, r.kind, r.primary])).toEqual([
      ['Nal Software', 'net', [{ minor: 904000, currency: 'ILS', approximate: false }]],
      ['Personal', 'spent', [{ minor: 635000, currency: 'ILS', approximate: false }]],
    ]);
    expect(g.hero.figure).toEqual({ minor: 269000, currency: 'ILS', approximate: false });
    expect(g.hero.label).toBe('kept');
    expect(g.owed).toEqual({ none: false, figure: { minor: 1150000, currency: 'ILS', approximate: false }, breakdown: null, overdueCount: 2 });
  });

  it('keeps five profiles in the API’s order and the hero is the API’s kept, as sent (AC2)', () => {
    const five = ['a', 'b', 'c', 'd'].map((id) => profile({ ...nal, profileId: id, name: id.toUpperCase() }));
    const g = glanceOf(verdict({ profiles: [...five, me], total: { ...verdict().total, converted: '29810.00' } }), input({ readable: new Set() }));
    expect(g.rows.map((r) => r.name)).toEqual(['A', 'B', 'C', 'D', 'Personal']);
    expect(g.hero.figure?.minor).toBe(2981000);
  });

  it('labels a business with no expenses "income only", never as profit (R3-5)', () => {
    const g = glanceOf(verdict({ profiles: [profile({ ...nal, currencies: [{ currency: 'ILS', received: '500.00', spent: '0.00', net: '500.00' }] })] }), input());
    expect(g.rows[0]!.kind).toBe('incomeOnly');
  });

  it('marks a profile with nothing in the period as empty (R3-4), still a link', () => {
    const quiet = profile({ profileId: 'nal', name: 'Nal Software', currencies: [], converted: { received: '0.00', spent: '0.00', net: '0.00' } });
    const row = glanceOf(verdict({ profiles: [quiet] }), input()).rows[0]!;
    expect(row.empty).toBe(true);
    expect(row.link).toBe(true);
  });

  it('adds "came in" under a personal profile only when money came in', () => {
    expect(glanceOf(verdict(), input()).rows[1]!.extra).toEqual([]);
    const earning = profile({ ...me, currencies: [{ currency: 'ILS', received: '500.00', spent: '6350.00', net: '-5850.00' }], converted: { received: '500.00', spent: '6350.00', net: '-5850.00' } });
    expect(glanceOf(verdict({ profiles: [earning] }), input()).rows[0]!.extra).toEqual([{ kind: 'cameIn', amount: { minor: 50000, currency: 'ILS', approximate: false } }]);
  });

  it('marks ≈ on a row only when the profile holds another currency, and tags shared ones', () => {
    const mixed = profile({ ...nal, shared: true, currencies: [...nal.currencies, { currency: 'USD', received: '100.00', spent: '0.00', net: '100.00' }], converted: { received: '10370.00', spent: '960.00', net: '9410.00' } });
    const row = glanceOf(verdict({ profiles: [mixed] }), input()).rows[0]!;
    expect(row.shared).toBe(true);
    expect(row.primary).toEqual([{ minor: 941000, currency: 'ILS', approximate: true }]);
  });

  it('stacks the currencies of an unconverted row and never adds them (ADR-004)', () => {
    const unrated = profile({ ...nal, currencies: [{ currency: 'ILS', received: '4000.00', spent: '0.00', net: '4000.00' }, { currency: 'USD', received: '1200.00', spent: '0.00', net: '1200.00' }], converted: null });
    const row = glanceOf(verdict({ profiles: [unrated] }), input()).rows[0]!;
    expect(row.primary).toEqual([{ minor: 400000, currency: 'ILS', approximate: false }]);
    expect(row.extra).toEqual([{ kind: 'more', amount: { minor: 120000, currency: 'USD', approximate: false } }]);
  });

  it('links only the profiles the person can read (P14)', () => {
    expect(glanceOf(verdict(), input({ readable: new Set(['me']) })).rows.map((r) => r.link)).toEqual([false, true]);
  });

  it('lists locked and failed profiles as rows that are not links, and names them (D4 of ADR-204)', () => {
    const g = glanceOf(
      verdict({ unavailable: [{ profileId: 'law', name: 'Sader Law', code: 'SUBSCRIPTION_LAPSED' }, { profileId: 'lab', name: 'elMokhtbr', code: 'INTERNAL' }], total: { ...verdict().total, partial: true } }),
      input({ readable: new Set(['nal', 'me', 'law', 'lab']) }),
    );
    expect(g.rows.slice(2).map((r) => [r.name, r.unavailable, r.link])).toEqual([
      ['Sader Law', 'locked', false],
      ['elMokhtbr', 'failed', false],
    ]);
    expect(g.leavesOut).toEqual(['Sader Law', 'elMokhtbr']);
  });
});

describe('glanceOf: hero', () => {
  it('is negative when more went out than came in', () => {
    const g = glanceOf(verdict({ total: { ...verdict().total, currencies: [{ currency: 'ILS', net: '-1200.50' }], converted: '-1200.50' } }), input());
    expect(g.hero.figure?.minor).toBe(-120050);
    expect(g.hero.negative).toBe(true);
  });

  it('carries ≈ and a per-currency breakdown only when other currencies were converted (DD8)', () => {
    expect(glanceOf(verdict(), input()).hero.breakdown).toBeNull();
    const mixed = glanceOf(verdict({ total: { ...verdict().total, currencies: [{ currency: 'ILS', net: '2000.00' }, { currency: 'USD', net: '200.00' }], converted: '2742.00' } }), input()).hero;
    expect(mixed.figure).toEqual({ minor: 274200, currency: 'ILS', approximate: true });
    expect(mixed.breakdown).toEqual([
      { minor: 200000, currency: 'ILS', approximate: false },
      { minor: 20000, currency: 'USD', approximate: false },
    ]);
  });

  it('shows one currency on its own when rates are missing, and says no rate date', () => {
    const g = glanceOf(verdict({ rates: null, total: { ...verdict().total, currencies: [{ currency: 'ILS', net: '2000.00' }, { currency: 'USD', net: '200.00' }], converted: null, inCurrencyOnly: 'USD' } }), input());
    expect(g.hero.figure).toEqual({ minor: 20000, currency: 'USD', approximate: false });
    expect(g.hero.inCurrencyOnly).toBe('USD');
    expect(g.footnote.rateDate).toBeNull();
  });

  it('labels a person with no personal profile "business net"', () => {
    expect(glanceOf(verdict({ total: { ...verdict().total, label: 'businessNet' } }), input()).hero.label).toBe('businessNet');
  });
});

describe('glanceOf: usual (R8, DD1)', () => {
  it('compares a finished month with the usual', () => {
    expect(glanceOf(verdict(), input()).usual).toEqual({ direction: 'above', delta: { minor: 69000, currency: 'ILS', approximate: false } });
    expect(glanceOf(verdict({ usual: '3000.00' }), input()).usual?.direction).toBe('below');
    expect(glanceOf(verdict({ usual: '2690.00' }), input()).usual?.direction).toBe('about');
  });

  it('calls a gap under one whole unit "about", never "▲ ₪0" (review)', () => {
    expect(glanceOf(verdict({ usual: '2689.60' }), input()).usual?.direction).toBe('about');
  });

  it('marks the gap ≈ when the kept figure was converted (review)', () => {
    const mixed = verdict({ total: { ...verdict().total, currencies: [{ currency: 'ILS', net: '2000.00' }, { currency: 'USD', net: '200.00' }], converted: '2742.00' } });
    expect(glanceOf(mixed, input()).usual?.delta.approximate).toBe(true);
  });

  it('hides it while the month is still running, so the 3rd never reads as a bad month', () => {
    expect(glanceOf(verdict({ from: '2026-10-01', to: '2026-10-31', asOf: '2026-10-03' }), input()).usual).toBeNull();
  });

  it('hides it for weeks and years, without a usual, or without a converted kept', () => {
    expect(glanceOf(verdict(), input({ period: 'week' })).usual).toBeNull();
    expect(glanceOf(verdict({ usual: null }), input()).usual).toBeNull();
    expect(glanceOf(verdict({ total: { ...verdict().total, converted: null, inCurrencyOnly: 'ILS' } }), input()).usual).toBeNull();
  });
});

describe('glanceOf: owed and footnote (DD3)', () => {
  it('says nothing is owed when nothing is open', () => {
    expect(glanceOf(verdict({ owed: { currencies: [], overdueCount: 0, converted: '0.00' } }), input()).owed.none).toBe(true);
  });

  it('shows mixed owed as ≈ with its currencies', () => {
    const owed = glanceOf(verdict({ owed: { currencies: [{ currency: 'ILS', outstanding: '1000.00', overdue: '0.00' }, { currency: 'USD', outstanding: '100.00', overdue: '0.00' }], overdueCount: 0, converted: '1371.00' } }), input()).owed;
    expect(owed.figure).toEqual({ minor: 137100, currency: 'ILS', approximate: true });
    expect(owed.breakdown).toHaveLength(2);
  });

  it('notes shared businesses in full, the rate date and any left-out currencies', () => {
    const g = glanceOf(verdict({ total: { ...verdict().total, sharedInFull: true }, profiles: [profile({ ...nal, omittedCurrencies: ['AED'] }), profile({ ...me, omittedCurrencies: ['AED', 'SAR'] })] }), input());
    expect(g.footnote).toEqual({ sharedInFull: true, rateDate: '2026-10-23', omitted: ['AED', 'SAR'] });
  });
});

describe('isFirstRun (DD4)', () => {
  it('is true only when nothing at all is on record', () => {
    const blank = (p: VerdictProfile) => profile({ profileId: p.profileId, name: p.name, kind: p.kind, converted: { received: '0.00', spent: '0.00', net: '0.00' } });
    const empty = verdict({ profiles: [blank(nal), blank(me)], total: { ...verdict().total, currencies: [], converted: '0.00' }, owed: { currencies: [], overdueCount: 0, converted: '0.00' } });
    expect(isFirstRun(empty)).toBe(true);
    expect(isFirstRun(verdict())).toBe(false);
    const withHistory = { ...empty, profiles: [profile({ ...blank(nal), history: [{ month: '2026-05', currencies: [{ currency: 'ILS', received: '10.00', spent: '0.00' }] }] })] };
    expect(isFirstRun(withHistory)).toBe(false);
    expect(isFirstRun({ ...empty, unavailable: [{ profileId: 'x', name: 'X', code: 'INTERNAL' }] })).toBe(false);
  });
});

function hosted(id: string, state: 'TRIAL' | 'LOCKED' = 'TRIAL', reads = true): HostedProfile {
  return { id, name: id, access: { payments: reads ? 'write' : 'none', expenses: reads ? 'write' : 'none' }, billing: { state } } as unknown as HostedProfile;
}
const standing = { billingStanding: 'open' } as unknown as Me;

describe('glanceShellProfile (D8)', () => {
  it('keeps the profile the person came from when it is open and readable', () => {
    expect(glanceShellProfile([hosted('a'), hosted('b')], 'b', standing)?.id).toBe('b');
  });

  it('skips a locked or unreadable profile for the first one that is both open and readable', () => {
    expect(glanceShellProfile([hosted('a', 'LOCKED'), hosted('b', 'TRIAL', false), hosted('c')], 'a', standing)?.id).toBe('c');
  });

  it('falls back to the first open one, then to none', () => {
    expect(glanceShellProfile([hosted('a', 'LOCKED'), hosted('b', 'TRIAL', false)], undefined, standing)?.id).toBe('b');
    expect(glanceShellProfile([], undefined, standing)).toBeNull();
  });
});

describe('allLocked (D7)', () => {
  it('is true only when the person holds profiles and every one is locked', () => {
    expect(allLocked([hosted('a', 'LOCKED'), hosted('b', 'LOCKED')], standing)).toBe(true);
    expect(allLocked([hosted('a', 'LOCKED'), hosted('b')], standing)).toBe(false);
    expect(allLocked([], standing)).toBe(false);
  });
});

describe('outsideProfiles (review: firms you staff)', () => {
  it('lists readable, open profiles the verdict does not count, and all of them when it counts none', () => {
    const counted = verdict({ profiles: [profile({ ...nal, profileId: 'a' })], unavailable: [{ profileId: 'b', name: 'B', code: 'SUBSCRIPTION_LAPSED' }] });
    const held = [hosted('a'), hosted('b'), hosted('firm'), hosted('locked', 'LOCKED'), hosted('blind', 'TRIAL', false)];
    expect(outsideProfiles(held, counted, standing).map((p) => p.id)).toEqual(['firm']);
    expect(outsideProfiles(held, null, standing).map((p) => p.id)).toEqual(['a', 'b', 'firm']);
  });
});

describe('verdictAllLocked (review)', () => {
  it('is true when every counted profile is locked, though a staffed firm keeps the person open', () => {
    expect(verdictAllLocked(verdict({ profiles: [], unavailable: [{ profileId: 'a', name: 'A', code: 'SUBSCRIPTION_LAPSED' }] }))).toBe(true);
    expect(verdictAllLocked(verdict({ profiles: [], unavailable: [{ profileId: 'a', name: 'A', code: 'INTERNAL' }] }))).toBe(false);
    expect(verdictAllLocked(verdict())).toBe(false);
  });
});


/**
 * MUT-449 D5: the shared verdict-glance contract (docs/contracts/verdict-glance). The phone asserts its Dart twin of
 * glanceOf against the same files, so a change here must re-write the contract on purpose
 * (`npx tsx scripts/verdict-glance-fixtures.ts`) and re-sync the phone's pinned copy.
 */
describe('glanceOf: the shared verdict-glance contract (MUT-449)', () => {
  const dir = 'docs/contracts/verdict-glance';
  const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();

  it('has a file for every case the generator defines, and nothing else', () => {
    expect(files).toEqual(CASES.map((c) => `${c.name}.json`).sort());
  });

  it.each(files)('%s: glanceOf, isFirstRun and verdictAllLocked match the contract', (file) => {
    const contract = JSON.parse(readFileSync(`${dir}/${file}`, 'utf8')) as ReturnType<typeof contractOf>;
    const glance = glanceOf(contract.verdict, { period: contract.period, readable: new Set(contract.readable) });
    expect(glance).toEqual(contract.expected.glance);
    expect(isFirstRun(contract.verdict)).toBe(contract.expected.isFirstRun);
    expect(verdictAllLocked(contract.verdict)).toBe(contract.expected.verdictAllLocked);
  });
});
