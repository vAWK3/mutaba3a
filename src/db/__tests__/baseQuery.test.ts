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
