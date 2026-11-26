import { hasFeature } from '../features.js';
import { isMalafatFirm, profileOwnerOf, profileTypeOf } from '../personal-profile.js';
import type { LedgerStore, Organization } from '../repositories/ports.js';

/**
 * Whether issuing is on for the profile: a business profile with an owner that isn't a Malafat firm, and then
 * MUT-736 (ADR-282): everyone while INVOICING_FOR_ALL is on. Off, it is the kill switch: the owner's operator
 * `invoicing` grant decides again, as before. The same rule as the issuing routes' gate (`issuingProfileOf`), and for
 * the readers without a session (summaries, the monthly mail, exports), which pass the server's flag.
 */
export async function invoicingOn(store: Pick<LedgerStore, 'features'>, organization: Organization, forAll: boolean): Promise<boolean> {
  const owner = profileOwnerOf(organization);
  if (isMalafatFirm(organization) || !owner || profileTypeOf(organization) === 'PERSONAL') return false;
  return forAll || hasFeature(store, owner, 'invoicing');
}
