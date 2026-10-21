import { describe, it, expect } from 'vitest';
import { me, profile } from '../../__tests__/harness';
import { businessProfileCount, isMalafatCustomer, portalMalafatEligible, retireChange } from '../malafatSuggestions';

const VIEWER = me().user.id;
const business = (id: string) => profile({ id, writerOfRecord: null, owned: true, type: 'BUSINESS', isPersonalDefault: false });
/** MUT-373: a Business profile someone else created that the viewer co-owns. */
const coOwned = (id: string) => profile({ ...business(id), owners: [{ userId: 'creator', name: 'Basel', email: 'b@s.ps', creator: true }, { userId: VIEWER, name: 'Nour', email: 'n@s.ps', creator: false }] });

/** Who the portal may suggest Malafat to (MUT-191): a person's own business profiles, never a Malafat customer. */
describe('portalMalafatEligible', () => {
  it('is a profile the person owns as a business, fed by nobody', () => {
    expect(portalMalafatEligible(business('a'), VIEWER)).toBe(true);
  });

  it('is never a Business profile the person only co-owns (MUT-373, OV9): its creator is the firm’s contact', () => {
    expect(portalMalafatEligible(coOwned('c'), VIEWER)).toBe(false);
  });

  it('is never a Malafat-fed firm, a firm not yet connected, the built-in personal profile, or a personal one', () => {
    expect(portalMalafatEligible(profile(), VIEWER)).toBe(false);
    expect(portalMalafatEligible(profile({ writerOfRecord: null }), VIEWER)).toBe(false);
    expect(portalMalafatEligible(profile({ writerOfRecord: null, owned: true, isPersonalDefault: true, type: 'PERSONAL' }), VIEWER)).toBe(false);
    expect(portalMalafatEligible(profile({ writerOfRecord: null, owned: true, type: 'PERSONAL' }), VIEWER)).toBe(false);
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
    expect(businessProfileCount(me([business('a'), coOwned('c')]))).toBe(1);
  });
});

describe('retireChange', () => {
  it('retires the business-created note and the second-business card together, and the threshold card alone', () => {
    expect(retireChange('business-profile')).toEqual({ dismiss: ['business-profile', 'second-business'] });
    expect(retireChange('second-business')).toEqual({ dismiss: ['business-profile', 'second-business'] });
    expect(retireChange('client-threshold')).toEqual({ dismiss: ['client-threshold'] });
  });
});
