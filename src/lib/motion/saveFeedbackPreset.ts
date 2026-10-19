import type { IconFeedbackPreset } from './iconMotion';

/**
 * Personal vs firm/org (MUT-338, epic MUT-334). The legacy app has no firm
 * concept at all - local organizations never get a firm flag (MUT-299 B11) -
 * so callers there pass nothing, which resolves the same as an explicit
 * PERSONAL hosted profile.
 */
export function saveFeedbackPreset(
  profile: { type?: 'PERSONAL' | 'BUSINESS' | null } | null | undefined
): IconFeedbackPreset {
  return profile?.type === 'BUSINESS' ? 'restrained' : 'playful';
}
