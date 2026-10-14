import type { Currency } from '../api/client';

/**
 * The currencies the hosted API accepts, in the order every portal picker
 * shows them (MUT-183 R4, TD-125). The type check below fails `typecheck` the
 * day the API's `Currency` grows, so no picker can silently miss a currency
 * (JOD nearly did, MUT-140).
 */
export const HOSTED_CURRENCIES = ['USD', 'ILS', 'EUR', 'JOD'] as const satisfies readonly Currency[];

export type HostedCurrency = (typeof HOSTED_CURRENCIES)[number];

type MissingFromList = Exclude<Currency, HostedCurrency>;
// Compile-time only: `true` unless the API has a currency this list lacks.
const coversEveryCurrency: [MissingFromList] extends [never] ? true : MissingFromList = true;
void coversEveryCurrency;
