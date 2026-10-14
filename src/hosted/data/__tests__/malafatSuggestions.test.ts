import { describe, it, expect } from 'vitest';
import { me, profile } from '../../__tests__/harness';
import { businessProfileCount, isMalafatCustomer, portalMalafatEligible, retireChange } from '../malafatSuggestions';

const business = (id: string) => profile({ id, writerOfRecord: null, owned: true, type: 'BUSINESS', isPersonalDefault: false });

/** Who the portal may suggest Malafat to (MUT-191): a person's own business profiles, never a Malafat customer. */
describe('portalMalafatEligible', () => {
  it('is a profile the person owns as a business, fed by nobody', () => {
    expect(portalMalafatEligible(business('a'))).toBe(true);
  });

  it('is never a Malafat-fed firm, a firm not yet connected, the built-in personal profile, or a personal one', () => {
    expect(portalMalafatEligible(profile())).toBe(false);
    expect(portalMalafatEligible(profile({ writerOfRecord: null }))).toBe(false);
    expect(portalMalafatEligible(profile({ writerOfRecord: null, owned: true, isPersonalDefault: true, type: 'PERSONAL' }))).toBe(false);
    expect(portalMalafatEligible(profile({ writerOfRecord: null, owned: true, type: 'PERSONAL' }))).toBe(false);
  });
});

describe('isMalafatCustomer', () => {
  it('is anyone who belongs to a Malafat-fed firm: they already use Malafat', () => {
    expect(isMalafatCustomer(me([business('a'), profile()]))).toBe(true);
    expect(isMalafatCustomer(me([business('a')]))).toBe(false);
  });
});

describe('businessProfileCount', () => {
  it('counts the person\'s own business profiles only', () => {
    expect(businessProfileCount(me([business('a'), business('b'), profile({ writerOfRecord: null })]))).toBe(2);
  });
});

describe('retireChange', () => {
  it('retires the business-created note and the second-business card together, and the threshold card alone', () => {
    expect(retireChange('business-profile')).toEqual({ dismiss: ['business-profile', 'second-business'] });
    expect(retireChange('second-business')).toEqual({ dismiss: ['business-profile', 'second-business'] });
    expect(retireChange('client-threshold')).toEqual({ dismiss: ['client-threshold'] });
  });
});
