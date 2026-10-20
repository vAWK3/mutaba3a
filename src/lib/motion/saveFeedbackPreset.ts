import type { IconFeedbackPreset } from './iconMotion';

/**
 * Personal vs firm (MUT-338, epic MUT-334). "Firm" is MUT-300's switch, the
 * profile's `firm` flag on `/v1/me`, not its type: a BUSINESS profile without
 * firm features is still a freelancer's and plays (Basel, MUT-338 comment
 * 12272). A server older than 1.41.0-mut300 sends no `firm`, so it plays too.
 * The legacy app has no firm concept at all (local organizations never get a
 * firm flag, MUT-299 B11), so callers there pass nothing.
 */
export function saveFeedbackPreset(profile: { firm?: boolean } | null | undefined): IconFeedbackPreset {
  return profile?.firm === true ? 'restrained' : 'playful';
}
