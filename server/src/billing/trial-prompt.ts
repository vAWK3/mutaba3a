import type { TrialPromptAction, TrialPromptRecord } from '../repositories/ports.js';

/**
 * MUT-418 (D1, D2): the person's answers to the free trial's card prompt, kept on their user row (`users.trialPrompt`,
 * the MUT-191 `malafatSuggestions` pattern) so the first-run step shows once per person, not once per browser, and
 * the Home banner's "hide for 3 days" holds on every device. The welcome's answer is stored too: the first-run
 * events rarely reach PostHog (nobody has opted in yet, ADR-090), so this is the funnel's own count.
 */

/** "Hide for 3 days" (ticket). The portal never offers it in the trial's last 3 days. */
export const BANNER_SNOOZE_DAYS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

export const TRIAL_PROMPT_ACTIONS: readonly TrialPromptAction[] = ['welcome-accepted', 'welcome-skipped', 'banner-snoozed'];

const ANSWERS: ReadonlyMap<TrialPromptAction, TrialPromptRecord['welcomeAnswer']> = new Map([
  ['welcome-accepted', 'accepted'],
  ['welcome-skipped', 'skipped'],
]);

/** The stored value, tolerant of NULL and of anything malformed: a field that doesn't parse reads as never set. */
export function resolveTrialPrompt(stored: unknown): TrialPromptRecord {
  const value = stored && typeof stored === 'object' && !Array.isArray(stored) ? (stored as Record<string, unknown>) : {};
  const welcomedAt = instant(value.welcomedAt);
  const welcomeAnswer = value.welcomeAnswer === 'accepted' || value.welcomeAnswer === 'skipped' ? value.welcomeAnswer : null;
  // A welcome is its time and its answer together; half of one is a write this code never makes.
  const welcomed = welcomedAt !== null && welcomeAnswer !== null;
  return { welcomedAt: welcomed ? welcomedAt : null, welcomeAnswer: welcomed ? welcomeAnswer : null, bannerSnoozedUntil: instant(value.bannerSnoozedUntil) };
}

/** One action applied to what is stored. The first welcome answer wins, so two devices never undo each other. */
export function applyTrialPromptAction(stored: unknown, action: TrialPromptAction, at: Date): TrialPromptRecord {
  const current = resolveTrialPrompt(stored);
  if (action === 'banner-snoozed') return { ...current, bannerSnoozedUntil: new Date(at.getTime() + BANNER_SNOOZE_DAYS * DAY_MS).toISOString() };
  if (current.welcomedAt !== null) return current;
  return { ...current, welcomedAt: at.toISOString(), welcomeAnswer: ANSWERS.get(action) ?? null };
}

function instant(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : new Date(time).toISOString();
}
