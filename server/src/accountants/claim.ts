import { timingSafeEqual } from 'node:crypto';
import { CLAIM_CODE_MAX_ATTEMPTS, claimCodeDigest } from '../auth/claim-code.js';
import { ApiError } from '../errors.js';
import type { LedgerStore, Organization, PersonSetupLinkRecord, ProvisionedSetupLink, UserRecord } from '../repositories/ports.js';

/**
 * MUT-765 (accountant channel, ADR-294; CEO ACCT-6, eng R6): the claim step's server side. A link carries a claim code
 * only when an accountant created the account (or reissued its link); the customer types the six digits he said in
 * person, so a typo'd address alone can't claim someone's books. Five wrong tries lock the code; the accountant then
 * issues a new link and code. Operator links and recovery links carry no code and are unchanged.
 */

/** The claim code this setup link carries, or null when it carries none (every link that is not a provisioned one). */
export async function claimOfLink(store: Pick<LedgerStore, 'provision'>, link: PersonSetupLinkRecord): Promise<ProvisionedSetupLink | null> {
  const claim = await store.provision.claimOf(link.tokenDigest);
  return claim?.claimCodeDigest ? claim : null;
}

export const isClaimCodeLocked = (claim: Pick<ProvisionedSetupLink, 'claimCodeAttempts'>): boolean => claim.claimCodeAttempts >= CLAIM_CODE_MAX_ATTEMPTS;

/**
 * Accepts the right code; counts a wrong one (atomically, in the store) and refuses it with the tries left, or locked
 * on the fifth. A locked code refuses even the right digits.
 */
export async function verifyClaimCode(store: Pick<LedgerStore, 'provision'>, pepper: string, claim: ProvisionedSetupLink, email: string, typed: string): Promise<void> {
  if (isClaimCodeLocked(claim)) throw locked();
  const code = typed.replace(/\s+/g, '');
  const expected = Buffer.from(claim.claimCodeDigest ?? '', 'utf8');
  const given = Buffer.from(claimCodeDigest(pepper, email, code), 'utf8');
  if (expected.length === given.length && timingSafeEqual(expected, given)) return;
  const tries = await store.provision.failClaimCode(claim.tokenDigest);
  if (tries === null || tries >= CLAIM_CODE_MAX_ATTEMPTS) throw locked();
  throw new ApiError('CLAIM_CODE_WRONG', 'That code is not right', { triesLeft: CLAIM_CODE_MAX_ATTEMPTS - tries });
}

function locked(): ApiError {
  return new ApiError('CLAIM_CODE_LOCKED', 'This code no longer works; ask your accountant for a new one');
}

/** Who set the account up and for which business: the claim page's context line. Null parts when gone. */
export async function claimContextOf(store: Pick<LedgerStore, 'provision' | 'users' | 'memberships' | 'organizations'>, person: UserRecord): Promise<{ accountantUserId: string | null; accountantName: string | null; business: Organization | null }> {
  const origin = await store.provision.originOf(person.id);
  const accountant = origin?.accountantUserId ? await store.users.getById(origin.accountantUserId) : null;
  let business: Organization | null = null;
  for (const membership of await store.memberships.listByUser(person.id)) {
    const organization = await store.organizations.getById(membership.organizationId);
    if (organization?.profileType === 'BUSINESS' && organization.ownerUserId === person.id && (!business || organization.createdAt < business.createdAt)) business = organization;
  }
  return { accountantUserId: origin?.accountantUserId ?? null, accountantName: accountant?.displayName ?? null, business };
}
