import { hasFeature } from '../features.js';
import { isMalafatFirm, profileOwnerOf, profileTypeOf } from '../personal-profile.js';
import type { LedgerStore, Organization } from '../repositories/ports.js';

/**
 * Whether issuing is on for the profile: its owner has the `invoicing` feature, on a business profile that isn't a
 * Malafat firm. The same rule as the issuing routes' gate, without a session (summaries, the monthly mail, exports).
 */
export async function invoicingOn(store: LedgerStore, organization: Organization): Promise<boolean> {
  const owner = profileOwnerOf(organization);
  if (isMalafatFirm(organization) || !owner || profileTypeOf(organization) === 'PERSONAL') return false;
  return hasFeature(store, owner, 'invoicing');
}
