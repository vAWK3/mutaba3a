/**
 * MUT-449 D5: the verdict-glance contract fixtures. Each case is a GET /v1/summaries/verdict answer plus what the
 * Glance must make of it. The portal's `glanceOf` (src/hosted/data/verdict.ts) is the reference: this script writes
 * `expected` from it into docs/contracts/verdict-glance/<case>.json. The portal test (verdict.test.ts) and the phone
 * (mutaba3a-flutter test/fixtures/verdict_glance/, pinned by SOURCE.sha256) both assert against those files, so a change
 * to either side's shaping rules fails a test until the contract is re-written here on purpose.
 *
 *   npx tsx scripts/verdict-glance-fixtures.ts           write every case
 *   npx tsx scripts/verdict-glance-fixtures.ts --check   fail when a file differs from what glanceOf makes now
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Verdict } from '../src/hosted/api/client';
import type { Period } from '../src/hosted/data/reports';
import { glanceOf, isFirstRun, verdictAllLocked } from '../src/hosted/data/verdict';

export const CONTRACT_DIR = join(import.meta.dirname, '..', 'docs', 'contracts', 'verdict-glance');

type VerdictProfile = Verdict['profiles'][number];

export interface ContractCase {
  name: string;
  description: string;
  period: Period;
  /** Profiles whose own Reports the person may open (the portal's P14 link rule). */
  readable: string[];
  verdict: Verdict;
}

const ils = (received: string, spent: string, net: string) => ({ currency: 'ILS' as const, received, spent, net });

function profile(over: Partial<VerdictProfile> & Pick<VerdictProfile, 'profileId' | 'name'>): VerdictProfile {
  return { kind: 'BUSINESS', shared: false, currencies: [], converted: null, history: [], owed: { currencies: [], overdueCount: 0 }, omittedCurrencies: [], ...over };
}

const nal = profile({
  profileId: '11111111-1111-4111-8111-111111111111',
  name: 'Nal Software',
  currencies: [ils('10000.00', '960.00', '9040.00')],
  converted: { received: '10000.00', spent: '960.00', net: '9040.00' },
  history: [{ month: '2026-09', currencies: [{ currency: 'ILS', received: '10000.00', spent: '960.00' }] }],
});
const personal = profile({
  profileId: '22222222-2222-4222-8222-222222222222',
  name: 'Personal',
  kind: 'PERSONAL',
  currencies: [ils('500.00', '6350.00', '-5850.00')],
  converted: { received: '500.00', spent: '6350.00', net: '-5850.00' },
});

const SEPTEMBER = { from: '2026-09-01', to: '2026-09-30', asOf: '2026-10-26' };
const RATES = { date: '2026-10-23', source: 'live' as const };
const NO_OWED = { currencies: [], overdueCount: 0, converted: '0.00' };

const twoProfiles: ContractCase = {
  name: 'two-profiles',
  description: 'One business and one personal profile, all in ILS, a finished month above the usual (AC1).',
  period: 'month',
  readable: [nal.profileId, personal.profileId],
  verdict: {
    ...SEPTEMBER,
    base: 'ILS',
    rates: RATES,
    profiles: [nal, personal],
    total: { label: 'kept', currencies: [{ currency: 'ILS', net: '3190.00' }], converted: '3190.00', inCurrencyOnly: null, sharedInFull: false, partial: false },
    usual: '2590.00',
    owed: { currencies: [{ currency: 'ILS', outstanding: '11500.00', overdue: '3000.00' }], overdueCount: 2, converted: '11500.00' },
    unavailable: [],
  },
};

const elMokhtbr = profile({ profileId: '33333333-3333-4333-8333-333333333333', name: 'elMokhtbr', shared: true, currencies: [ils('2500.00', '650.00', '1850.00')], converted: { received: '2500.00', spent: '650.00', net: '1850.00' } });
const barmajiyat = profile({ profileId: '44444444-4444-4444-8444-444444444444', name: 'Barmajiyat', currencies: [ils('400.00', '3500.00', '-3100.00')], converted: { received: '400.00', spent: '3500.00', net: '-3100.00' } });
const sader = profile({ profileId: '55555555-5555-4555-8555-555555555555', name: 'مكتب صادر للمحاماة والاستشارات', kind: 'FIRM', currencies: [ils('7000.00', '1200.00', '5800.00')], converted: { received: '7000.00', spent: '1200.00', net: '5800.00' } });

const fiveProfiles: ContractCase = {
  name: 'five-profiles',
  description: 'Five profiles in API order: a shared business, a losing business, an OWNER firm with an Arabic name, below the usual (AC2).',
  period: 'month',
  readable: [nal.profileId, elMokhtbr.profileId, barmajiyat.profileId, personal.profileId],
  verdict: {
    ...SEPTEMBER,
    base: 'ILS',
    rates: RATES,
    profiles: [nal, elMokhtbr, barmajiyat, sader, personal],
    total: { label: 'kept', currencies: [{ currency: 'ILS', net: '7740.00' }], converted: '7740.00', inCurrencyOnly: null, sharedInFull: true, partial: false },
    usual: '9100.00',
    owed: NO_OWED,
    unavailable: [],
  },
};

const consulting = profile({
  profileId: '66666666-6666-4666-8666-666666666666',
  name: 'US Consulting',
  currencies: [
    { currency: 'USD', received: '3000.00', spent: '0.00', net: '3000.00' },
    ils('0.00', '900.00', '-900.00'),
  ],
  converted: { received: '11100.00', spent: '900.00', net: '10200.00' },
});

const converted: ContractCase = {
  name: 'converted-multi-currency',
  description: 'A USD + ILS business converted into ILS: ≈ hero with a per-currency breakdown, ≈ owed across two currencies, a week (no usual).',
  period: 'week',
  readable: [consulting.profileId],
  verdict: {
    from: '2026-10-17',
    to: '2026-10-23',
    asOf: '2026-10-26',
    base: 'ILS',
    rates: RATES,
    profiles: [consulting, personal],
    total: { label: 'kept', currencies: [{ currency: 'USD', net: '3000.00' }, { currency: 'ILS', net: '-6750.00' }], converted: '4350.00', inCurrencyOnly: null, sharedInFull: false, partial: false },
    usual: null,
    owed: { currencies: [{ currency: 'USD', outstanding: '1000.00', overdue: '0.00' }, { currency: 'ILS', outstanding: '2000.00', overdue: '2000.00' }], overdueCount: 1, converted: '5700.00' },
    unavailable: [],
  },
};

const unconverted = profile({ ...consulting, converted: null });
const ratesNull: ContractCase = {
  name: 'rates-null',
  description: 'No ECB rates: every converted figure is null, the hero is "in ILS only", the row stacks its currencies, owed lists each one.',
  period: 'month',
  readable: [consulting.profileId, personal.profileId],
  verdict: {
    ...SEPTEMBER,
    base: 'ILS',
    rates: null,
    profiles: [unconverted, { ...personal, converted: null }],
    total: { label: 'kept', currencies: [{ currency: 'USD', net: '3000.00' }, { currency: 'ILS', net: '-6750.00' }], converted: null, inCurrencyOnly: 'ILS', sharedInFull: false, partial: false },
    usual: null,
    owed: { currencies: [{ currency: 'USD', outstanding: '1000.00', overdue: '0.00' }, { currency: 'ILS', outstanding: '2000.00', overdue: '2000.00' }], overdueCount: 1, converted: null },
    unavailable: [],
  },
};

const partial: ContractCase = {
  name: 'partial-unavailable',
  description: 'One profile locked by billing and one that failed to read: non-link rows, "Leaves out", no usual (AC3, 402 on one profile).',
  period: 'month',
  readable: [nal.profileId, elMokhtbr.profileId, barmajiyat.profileId],
  verdict: {
    ...SEPTEMBER,
    base: 'ILS',
    rates: RATES,
    profiles: [nal],
    total: { label: 'businessNet', currencies: [{ currency: 'ILS', net: '9040.00' }], converted: '9040.00', inCurrencyOnly: null, sharedInFull: false, partial: true },
    usual: null,
    owed: NO_OWED,
    unavailable: [
      { profileId: elMokhtbr.profileId, name: elMokhtbr.name, code: 'SUBSCRIPTION_LAPSED' },
      { profileId: barmajiyat.profileId, name: barmajiyat.name, code: 'INTERNAL' },
    ],
  },
};

const incomeOnly = profile({ profileId: '77777777-7777-4777-8777-777777777777', name: 'Side gig', currencies: [ils('1200.00', '0.00', '1200.00')], converted: { received: '1200.00', spent: '0.00', net: '1200.00' }, omittedCurrencies: ['KWD'] });
const quiet = profile({ profileId: '88888888-8888-4888-8888-888888888888', name: 'Quiet shop', currencies: [ils('0.00', '0.00', '0.00')], converted: { received: '0.00', spent: '0.00', net: '0.00' } });

const runningMonth: ContractCase = {
  name: 'running-month',
  description: 'The month in progress (usual hidden though sent), an income-only business, a profile with nothing, an omitted retired currency, a negative kept.',
  period: 'month',
  readable: [incomeOnly.profileId, quiet.profileId, personal.profileId],
  verdict: {
    from: '2026-10-01',
    to: '2026-10-31',
    asOf: '2026-10-26',
    base: 'ILS',
    rates: RATES,
    profiles: [incomeOnly, quiet, personal],
    total: { label: 'kept', currencies: [{ currency: 'ILS', net: '-4650.00' }], converted: '-4650.00', inCurrencyOnly: null, sharedInFull: false, partial: false },
    usual: '2000.00',
    owed: NO_OWED,
    unavailable: [],
  },
};

const allLockedCase: ContractCase = {
  name: 'all-locked',
  description: 'Every profile the person owns has lapsed while a firm they staff is open: no profiles, every unavailable is SUBSCRIPTION_LAPSED.',
  period: 'month',
  readable: [],
  verdict: {
    ...SEPTEMBER,
    base: 'ILS',
    rates: RATES,
    profiles: [],
    total: { label: 'kept', currencies: [], converted: '0.00', inCurrencyOnly: null, sharedInFull: false, partial: true },
    usual: null,
    owed: NO_OWED,
    unavailable: [
      { profileId: nal.profileId, name: nal.name, code: 'SUBSCRIPTION_LAPSED' },
      { profileId: personal.profileId, name: personal.name, code: 'SUBSCRIPTION_LAPSED' },
    ],
  },
};

const empty = (p: VerdictProfile): VerdictProfile => ({ ...p, currencies: [ils('0.00', '0.00', '0.00')], converted: { received: '0.00', spent: '0.00', net: '0.00' }, history: [] });
const firstRun: ContractCase = {
  name: 'first-run',
  description: 'Nothing recorded anywhere: no movement in the period or its history, nothing owed (First Run, default view).',
  period: 'month',
  readable: [nal.profileId, personal.profileId],
  verdict: {
    from: '2026-10-01',
    to: '2026-10-31',
    asOf: '2026-10-26',
    base: 'ILS',
    rates: RATES,
    profiles: [empty(nal), empty(personal)],
    total: { label: 'kept', currencies: [{ currency: 'ILS', net: '0.00' }], converted: '0.00', inCurrencyOnly: null, sharedInFull: false, partial: false },
    usual: null,
    owed: NO_OWED,
    unavailable: [],
  },
};

export const CASES: ContractCase[] = [twoProfiles, fiveProfiles, converted, ratesNull, partial, runningMonth, allLockedCase, firstRun];

export function contractOf(c: ContractCase) {
  return {
    name: c.name,
    description: c.description,
    period: c.period,
    readable: c.readable,
    verdict: c.verdict,
    expected: {
      glance: glanceOf(c.verdict, { period: c.period, readable: new Set(c.readable) }),
      isFirstRun: isFirstRun(c.verdict),
      verdictAllLocked: verdictAllLocked(c.verdict),
    },
  };
}

const render = (c: ContractCase) => `${JSON.stringify(contractOf(c), null, 2)}\n`;

/** One digest over every case file in name order: the phone's SOURCE.sha256 pins this exact set. */
export function contractDigest(dir = CONTRACT_DIR): string {
  const hash = createHash('sha256');
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
    hash.update(file);
    hash.update(readFileSync(join(dir, file)));
  }
  return hash.digest('hex');
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  const check = process.argv.includes('--check');
  let stale = 0;
  for (const c of CASES) {
    const path = join(CONTRACT_DIR, `${c.name}.json`);
    if (check) {
      let current = '';
      try {
        current = readFileSync(path, 'utf8');
      } catch {
        // missing counts as stale
      }
      if (current !== render(c)) {
        console.error(`stale: ${path}`);
        stale += 1;
      }
    } else {
      writeFileSync(path, render(c));
    }
  }
  if (stale > 0) process.exit(1);
  console.log(`${check ? 'checked' : 'wrote'} ${CASES.length} cases; sha256 ${contractDigest()}`);
}
