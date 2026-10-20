import { describe, expect, it } from 'vitest';
import { saveFeedbackPreset } from '../saveFeedbackPreset';

/**
 * MUT-338: firm accounts get the restrained icon preset, everyone else the
 * playful one. "Firm" is MUT-300's switch (`firm: true` on the profile), not
 * the profile's type (Basel, MUT-338 comment 12272): a plain BUSINESS profile
 * without firm features is still a freelancer's, so it plays. The legacy app
 * has no firm concept at all (MUT-299 B11): callers there pass nothing.
 */
describe('saveFeedbackPreset', () => {
  it('is restrained once firm features are on', () => {
    expect(saveFeedbackPreset({ firm: true })).toBe('restrained');
  });

  it('is playful for a BUSINESS profile without firm features', () => {
    expect(saveFeedbackPreset({ type: 'BUSINESS', firm: false })).toBe('playful');
  });

  it('is playful for a PERSONAL profile', () => {
    expect(saveFeedbackPreset({ type: 'PERSONAL', firm: false })).toBe('playful');
  });

  it('is playful when a server older than 1.41.0-mut300 sends no firm field', () => {
    expect(saveFeedbackPreset({ type: 'BUSINESS' })).toBe('playful');
  });

  it('is playful for undefined (legacy app has no firm concept, MUT-299 B11)', () => {
    expect(saveFeedbackPreset(undefined)).toBe('playful');
  });

  it('is playful for null (profile not yet resolved)', () => {
    expect(saveFeedbackPreset(null)).toBe('playful');
  });
});
