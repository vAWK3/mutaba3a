import { packFor, type JurisdictionPack } from '../jurisdictions/index.js';
import type { LedgerStore } from '../repositories/ports.js';
import { DEFAULT_COUNTRY } from './jurisdictions.js';

/** MUT-741 (ADR-287): the jurisdiction pack of a profile's issuer (an issuer saved before MUT-740 is Israel's). */
export async function issuerPackOf(store: Pick<LedgerStore, 'issuing'>, organizationId: string): Promise<JurisdictionPack> {
  const issuer = await store.issuing.getIssuer(organizationId);
  return packFor(issuer?.country ?? DEFAULT_COUNTRY);
}
