import { describe, expect, it } from 'vitest';
import { saveFeedbackPreset } from '../saveFeedbackPreset';

/**
 * MUT-338: personal accounts get the playful icon preset, firm/org accounts
 * get the restrained one. The legacy app has no firm concept at all (MUT-299
 * B11: local organizations never get a firm flag) - callers there pass
 * nothing, which must resolve the same as an explicit PERSONAL profile.
 */
describe('saveFeedbackPreset', () => {
  it('is restrained for a BUSINESS profile', () => {
    expect(saveFeedbackPreset({ type: 'BUSINESS' })).toBe('restrained');
  });

  it('is playful for a PERSONAL profile', () => {
    expect(saveFeedbackPreset({ type: 'PERSONAL' })).toBe('playful');
  });

  it('is playful when type is null (hosted profile with no type recorded)', () => {
    expect(saveFeedbackPreset({ type: null })).toBe('playful');
  });

  it('is playful for undefined (legacy app has no firm concept, MUT-299 B11)', () => {
    expect(saveFeedbackPreset(undefined)).toBe('playful');
  });

  it('is playful for null (profile not yet resolved)', () => {
    expect(saveFeedbackPreset(null)).toBe('playful');
  });
});
