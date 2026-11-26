import type { Currency } from '../../lib/utils';

/**
 * The name of every currency the app supports, for the landing page's
 * currency answer. A `Record<Currency, …>` so adding a currency to the type
 * without naming it here fails to compile — the page can't under-claim or
 * over-claim what the app supports.
 */
export const CURRENCY_NAME_KEYS: Record<Currency, string> = {
  USD: 'landing.currency.USD',
  ILS: 'landing.currency.ILS',
  EUR: 'landing.currency.EUR',
  JOD: 'landing.currency.JOD',
};

/**
 * One FAQ question: `landing.faq.<id>.q` and its answer `.a`. An entry with `open` answers `.aOpen` while signup is
 * open (MUT-369); one with `starter` answers `.aStarter` while the free Starter plan is on (MUT-731), which wins.
 */
export interface FaqEntry {
  id: string;
  open?: true;
  starter?: true;
  /** Asked only while the free Starter plan is on: invoicing for everyone ships with it (MUT-736). */
  starterOnly?: true;
}

/** The questions, in page order. */
export const FAQ_ENTRIES: readonly FaqEntry[] = [
  { id: 'free', open: true, starter: true },
  { id: 'try' },
  { id: 'invoices', starterOnly: true },
  { id: 'receipts' },
  { id: 'accountant' },
  { id: 'businesses', starter: true },
  { id: 'currencies' },
  { id: 'data' },
  { id: 'backup' },
  { id: 'phone' },
];

/** The FAQ entry whose answer lists the supported currencies. */
export const FAQ_CURRENCY_ID = 'currencies';

export interface LandingState {
  signupOpen: boolean;
  starter: boolean;
}

/** The questions this page asks, each with the key of the answer it gives. */
export function faqFor({ signupOpen, starter }: LandingState): { id: string; questionKey: string; answerKey: string }[] {
  return FAQ_ENTRIES.filter((entry) => starter || !entry.starterOnly).map((entry) => {
    const variant = starter && entry.starter ? 'aStarter' : signupOpen && entry.open ? 'aOpen' : 'a';
    return { id: entry.id, questionKey: `landing.faq.${entry.id}.q`, answerKey: `landing.faq.${entry.id}.${variant}` };
  });
}

/** Joins the localized currency names as a natural-language list. */
export function formatCurrencyList(names: string[], locale: string): string {
  return new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' }).format(names);
}
