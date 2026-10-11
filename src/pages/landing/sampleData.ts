import type { Currency } from '../../types';

/**
 * Static, illustrative data for the landing page's product mock-ups.
 * Never read from or written to the visitor's database. Names are i18n keys so
 * the mock-ups read naturally in both languages; dates are fixed so the page
 * renders the same for every visitor.
 */

export type SampleStatus = 'paid' | 'unpaid' | 'overdue';

export interface SampleWorkRow {
  id: string;
  date: string;
  titleKey: string;
  amountMinor: number;
  currency: Currency;
  status: SampleStatus;
  daysOverdue?: number;
}

export interface SampleOwed {
  currency: Currency;
  owedMinor: number;
  overdueMinor: number;
  oldestOverdueDays?: number;
}

export interface SampleClient {
  id: string;
  nameKey: string;
  owed: SampleOwed[];
}

/** The hero's Clients list: ranked by what each client owes, most first. */
export const SAMPLE_CLIENTS: SampleClient[] = [
  {
    id: 'c1',
    nameKey: 'landing.sample.clientName',
    owed: [{ currency: 'ILS', owedMinor: 1853441, overdueMinor: 1498441, oldestOverdueDays: 227 }],
  },
  {
    id: 'c2',
    nameKey: 'landing.sample.client2',
    owed: [
      { currency: 'USD', owedMinor: 90000, overdueMinor: 0 },
      { currency: 'ILS', owedMinor: 1425000, overdueMinor: 1425000, oldestOverdueDays: 3 },
    ],
  },
  {
    id: 'c3',
    nameKey: 'landing.sample.client3',
    owed: [{ currency: 'ILS', owedMinor: 1405000, overdueMinor: 1405000, oldestOverdueDays: 158 }],
  },
];

/** Currencies in the order the app's Owed now strip shows them. */
const CURRENCY_ORDER: Currency[] = ['USD', 'ILS', 'EUR'];

/** Owed now per currency, summed from the rows so the mock-up always adds up. */
export function sampleOwedTotals(clients: SampleClient[]): SampleOwed[] {
  return CURRENCY_ORDER.map((currency) => {
    const rows = clients.flatMap((client) => client.owed).filter((o) => o.currency === currency);
    return {
      currency,
      owedMinor: rows.reduce((sum, o) => sum + o.owedMinor, 0),
      overdueMinor: rows.reduce((sum, o) => sum + o.overdueMinor, 0),
    };
  }).filter((total) => total.owedMinor > 0);
}

/** The client whose page the first chapter shows: the top of the list. */
const FIRST = SAMPLE_CLIENTS[0];
export const SAMPLE_CLIENT = {
  nameKey: FIRST.nameKey,
  currency: FIRST.owed[0].currency,
  owedMinor: FIRST.owed[0].owedMinor,
  overdueMinor: FIRST.owed[0].overdueMinor,
};

export const SAMPLE_WORK: SampleWorkRow[] = [
  {
    id: 'w1',
    date: '2026-09-24',
    titleKey: 'landing.sample.work1',
    amountMinor: 120000,
    currency: 'ILS',
    status: 'paid',
  },
  {
    id: 'w2',
    date: '2026-09-13',
    titleKey: 'landing.sample.work2',
    amountMinor: 355000,
    currency: 'ILS',
    status: 'unpaid',
  },
  {
    id: 'w3',
    date: '2026-08-24',
    titleKey: 'landing.sample.work3',
    amountMinor: 935000,
    currency: 'ILS',
    status: 'overdue',
    daysOverdue: 34,
  },
];

/** The entry the payment mock-up is recording. */
export const SAMPLE_PAYMENT = {
  titleKey: 'landing.sample.work2',
  remainingMinor: 355000,
  currency: 'ILS' as Currency,
};

export const SAMPLE_BUSINESSES = [
  { id: 'b1', nameKey: 'landing.sample.business1', initial: 'D', initialAr: 'ا', hue: 262 },
  { id: 'b2', nameKey: 'landing.sample.business2', initial: 'T', initialAr: 'ح', hue: 199 },
  { id: 'b3', nameKey: 'landing.sample.business3', initial: 'C', initialAr: 'م', hue: 152 },
] as const;
