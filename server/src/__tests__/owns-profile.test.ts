import { describe, expect, it } from 'vitest';
import { canCoOwn, ownsProfile } from '../personal-profile.js';
import type { MembershipRole, Organization } from '../repositories/ports.js';

/**
 * MUT-373 (eng review R1, outside voice OV1): the one ownership rule. A co-owner is an OWNER member of an owned
 * BUSINESS profile; every membership defaults to OWNER, so the rule must never read the role anywhere else.
 */
type Org = Pick<Organization, 'ownerUserId' | 'personalOwnerUserId' | 'profileType'>;

const CREATOR = 'creator';
const PARTNER = 'partner';
const business: Org = { ownerUserId: CREATOR, personalOwnerUserId: null, profileType: 'BUSINESS' };
const ownedPersonal: Org = { ownerUserId: CREATOR, personalOwnerUserId: null, profileType: 'PERSONAL' };
const builtIn: Org = { ownerUserId: CREATOR, personalOwnerUserId: CREATOR, profileType: 'PERSONAL' };
const unstampedBuiltIn: Org = { ownerUserId: null, personalOwnerUserId: CREATOR, profileType: null };
const operatorFirm: Org = { ownerUserId: null, personalOwnerUserId: null, profileType: null };

describe('canCoOwn', () => {
  it.each([
    ['an owned Business profile', business, true],
    ['an owned Personal profile', ownedPersonal, false],
    ['the built-in personal profile', builtIn, false],
    ['an unstamped built-in personal profile', unstampedBuiltIn, false],
    ['an operator firm (Malafat-fed or not)', operatorFirm, false],
  ] as const)('%s → %s', (_label, org, expected) => {
    expect(canCoOwn(org)).toBe(expected);
  });
});

describe('ownsProfile', () => {
  const rows: [string, Org, string, MembershipRole | null, boolean][] = [
    ['the creator of a Business profile', business, CREATOR, 'OWNER', true],
    ['the creator, whatever their role reads', business, CREATOR, 'BOOKKEEPER', true],
    ['a co-owner: an OWNER member of an owned Business profile', business, PARTNER, 'OWNER', true],
    ['a BOOKKEEPER member of an owned Business profile', business, PARTNER, 'BOOKKEEPER', false],
    ['an OWNER-role member of an owned Personal profile', ownedPersonal, PARTNER, 'OWNER', false],
    ['an OWNER-role member of someone’s built-in personal profile', builtIn, PARTNER, 'OWNER', false],
    ['the person whose built-in profile it is', builtIn, CREATOR, 'OWNER', true],
    ['the person whose unstamped built-in profile it is', unstampedBuiltIn, CREATOR, 'OWNER', true],
    ['an OWNER-role member of an operator or Malafat firm', operatorFirm, PARTNER, 'OWNER', false],
    ['someone with no membership at all', business, PARTNER, null, false],
  ];
  it.each(rows)('%s', (_label, org, userId, role, expected) => {
    expect(ownsProfile(org, userId, role)).toBe(expected);
  });
});
