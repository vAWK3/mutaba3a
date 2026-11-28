import { defaultPack, hasPack, packFor, type JurisdictionPack } from '../jurisdictions/index.js';

/**
 * MUT-782 (ADR-341): the pack that reads a profile's VAT periods: the one for the country on its issuer details. A
 * profile with no issuer details carries no country yet (the accountant's chosen period still needs rules), so it falls
 * back to the default pack, like every caller on `boundary.test.ts`'s list; a country with no pack falls back too.
 */
export function vatPackFor(country: string | null): JurisdictionPack {
  return country !== null && hasPack(country) ? packFor(country) : defaultPack();
}
