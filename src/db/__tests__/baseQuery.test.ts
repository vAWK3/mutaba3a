import { describe, it, expect } from 'vitest';
import { excludeDeleted, scopeToProfile } from '../baseQuery';

describe('excludeDeleted', () => {
  it('should return true for records without deletedAt', () => {
    expect(excludeDeleted({})).toBe(true);
    expect(excludeDeleted({ deletedAt: undefined })).toBe(true);
    expect(excludeDeleted({ deletedAt: null })).toBe(true);
  });

  it('should return false for records with deletedAt set', () => {
    expect(excludeDeleted({ deletedAt: '2024-01-01T00:00:00Z' })).toBe(false);
  });
});

describe('scopeToProfile', () => {
  it('should return true when no profileId filter is provided', () => {
    expect(scopeToProfile({ profileId: 'abc' })).toBe(true);
    expect(scopeToProfile({ profileId: undefined })).toBe(true);
    expect(scopeToProfile({})).toBe(true);
  });

  it('should return true when record profileId matches filter', () => {
    expect(scopeToProfile({ profileId: 'abc' }, 'abc')).toBe(true);
  });

  it('should return false when record profileId does not match filter', () => {
    expect(scopeToProfile({ profileId: 'abc' }, 'xyz')).toBe(false);
  });

  it('should return false when record has no profileId but filter is set', () => {
    expect(scopeToProfile({}, 'abc')).toBe(false);
    expect(scopeToProfile({ profileId: undefined }, 'abc')).toBe(false);
  });
});

describe('scopeToProfile with several businesses (MUT-89, All businesses)', () => {
  const ALL = ['studio', 'teaching'];

  it('matches a record of any listed business', () => {
    expect(scopeToProfile({ profileId: 'studio' }, ALL)).toBe(true);
    expect(scopeToProfile({ profileId: 'teaching' }, ALL)).toBe(true);
  });

  it('leaves out a record of a business that is not listed (an archived one, O3)', () => {
    expect(scopeToProfile({ profileId: 'archived-business' }, ALL)).toBe(false);
  });

  it('leaves out an unassigned record: it belongs to no business (O3)', () => {
    expect(scopeToProfile({}, ALL)).toBe(false);
    expect(scopeToProfile({ profileId: undefined }, ALL)).toBe(false);
  });

  it('matches nothing for an empty list', () => {
    expect(scopeToProfile({ profileId: 'studio' }, [])).toBe(false);
  });
});
