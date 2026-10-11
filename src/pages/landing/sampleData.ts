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

export const SAMPLE_CLIENT = {
  nameKey: 'landing.sample.clientName',
  currency: 'ILS' as Currency,
  owedMinor: 1853441,
  overdueMinor: 1498441,
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
