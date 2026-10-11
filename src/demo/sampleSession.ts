import type { FeatureKey } from '../types';

/**
 * A visitor's sample session (MUT-78, ADR-042): the record that this browser
 * is showing sample data to someone who arrived from the landing page, which
 * sample business it opened on, which optional areas the sample switched on,
 * and when it started — everything created after `startedAt` that isn't a
 * `demo_` row was added by the visitor while looking around.
 */
export interface SampleSession {
  profileId: string;
  enabledFeatures: FeatureKey[];
  startedAt: string;
}

const STORAGE_KEY = 'mutaba3a-sample-session';

/** Query parameter on the landing page's web-app link that asks for the sample. */
export const SAMPLE_QUERY_PARAM = 'sample';

export function readSampleSession(): SampleSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SampleSession>;
    if (typeof parsed.profileId !== 'string' || typeof parsed.startedAt !== 'string') return null;
    return {
      profileId: parsed.profileId,
      startedAt: parsed.startedAt,
      enabledFeatures: Array.isArray(parsed.enabledFeatures) ? parsed.enabledFeatures : [],
    };
  } catch {
    return null;
  }
}

export function writeSampleSession(session: SampleSession): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch {
    // Storage unavailable (private mode, quota): the sample still works for this visit.
  }
}

export function clearSampleSession(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to clear.
  }
}
