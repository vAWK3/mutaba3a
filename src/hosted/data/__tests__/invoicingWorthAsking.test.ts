import { describe, it, expect } from 'vitest';
import { invoicingWorthAsking } from '../issuingQueries';

const ME = 'u-me';
const OTHER = 'u-other';
const me = (features: string[] = []) => ({ user: { id: ME, features } }) as never;
const profile = (over: Record<string, unknown> = {}) =>
  ({ type: 'BUSINESS', owned: true, owners: [{ userId: ME, name: null, email: 'me@x.test', creator: true }], writerOfRecord: null, managedInMalafat: false, ...over }) as never;
const coOwned = (creator: string) =>
  profile({ owners: [{ userId: creator, name: null, email: 'a@x.test', creator: true }, { userId: creator === ME ? OTHER : ME, name: null, email: 'b@x.test', creator: false }] });

/** The portal asks the server about issuing only where the answer can be something but 404 (the server's issuingProfileOf). */
describe('invoicingWorthAsking', () => {
  it('on a profile the person created, their own invoicing feature decides, with nothing asked', () => {
    expect(invoicingWorthAsking(profile(), me(['invoicing']), false)).toBe(true);
    expect(invoicingWorthAsking(profile(), me([]), false)).toBe(false);
    expect(invoicingWorthAsking(coOwned(ME), me([]), false)).toBe(false);
  });

  it('asks where someone else created the profile: a co-owner, or a person it is shared with', () => {
    expect(invoicingWorthAsking(coOwned(OTHER), me([]), false)).toBe(true);
    expect(invoicingWorthAsking(profile({ owned: false, owners: null, type: null }), me([]), false)).toBe(true);
  });

  it('treats an owned profile with no owners list as the person’s own', () => {
    expect(invoicingWorthAsking(profile({ owners: null }), me([]), false)).toBe(false);
  });

  it('never asks on a personal profile, one Malafat writes or manages, signed out, or without a profile', () => {
    expect(invoicingWorthAsking(profile({ type: 'PERSONAL' }), me(['invoicing']), false)).toBe(false);
    expect(invoicingWorthAsking(profile({ owned: false, owners: null, type: null, writerOfRecord: 'MALAFAT' }), me(['invoicing']), false)).toBe(false);
    expect(invoicingWorthAsking(profile({ managedInMalafat: true }), me(['invoicing']), false)).toBe(false);
    expect(invoicingWorthAsking(profile(), me(['invoicing']), true)).toBe(false);
    expect(invoicingWorthAsking(profile(), null, false)).toBe(false);
    expect(invoicingWorthAsking(null, me(['invoicing']), false)).toBe(false);
  });
});
