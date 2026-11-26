import { validationError } from '../agreements/compose.js';

/**
 * MUT-740 (ADR-287 D1, D4): the countries whose invoicing rules are live on this server, from INVOICING_JURISDICTIONS.
 * A profile's country (`issuer_details.country`, ISO 3166-1 alpha-2) that is not in the list cannot save issuer details
 * or issue, so nobody issues an Israeli tax invoice by accident. MUT-741 grows this module into the pack registry;
 * nothing here pre-empts it.
 */
export const DEFAULT_LIVE_JURISDICTIONS: readonly string[] = ['IL'];

/** What an issuer saved before MUT-740 (and a request that names no country) is: Israel, the only pack there is. */
export const DEFAULT_COUNTRY = 'IL';

const COUNTRY_CODE = /^[A-Z]{2}$/;

/** The live list from the env value: upper-cased, trimmed, de-duplicated; null when it holds anything that isn't a code. */
export function parseLiveJurisdictions(raw: string | undefined): string[] | null {
  if (raw === undefined) return [...DEFAULT_LIVE_JURISDICTIONS];
  const codes = raw.split(',').map((part) => part.trim().toUpperCase());
  if (codes.length === 0 || codes.some((code) => !COUNTRY_CODE.test(code))) return null;
  return [...new Set(codes)];
}

export function isLive(live: readonly string[], country: string): boolean {
  return live.includes(country);
}

/** 422 JURISDICTION_NOT_LIVE (the reason, as every setup refusal): the clients say invoicing isn't available there yet. */
export function assertLive(live: readonly string[], country: string): void {
  if (!isLive(live, country)) {
    throw validationError('JURISDICTION_NOT_LIVE', `Invoicing is not available for businesses in ${country} yet`, { field: 'country', country, live: [...live] });
  }
}
