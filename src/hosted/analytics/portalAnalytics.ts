import { create } from 'zustand';
import type { PostHogConfig } from 'posthog-js';
import { POSTHOG_KEY } from '../../lib/analytics/posthogKey';
import { APP_VERSION } from '../../lib/appVersion';

/**
 * The portal's opt-in, anonymous usage counts (MUT-155, ADR-090). Nothing is
 * loaded or sent until the signed-in person turns sharing on; the choice
 * belongs to that person on this browser, so signing out or another account
 * signing in resets it (README rule 6). Every event leaves through the
 * contract guard (rule 1). This is the only portal file that imports posthog-js.
 */

/** Where this browser keeps the signed-in person's choice: `{ owner: <user id>, choice }`. Never sent. */
export const USAGE_RECORD_KEY = 'mutaba3a-portal-usage';

export type UsageChoice = 'on' | 'off';
export type UsagePrompt = 'first_run' | 'settings';
type PortalEvent = 'income_recorded' | 'expense_recorded' | 'payment_recorded';

interface UsageState {
  /** null: not asked yet; 'unavailable': this build has no key, so nothing is ever asked or sent. */
  choice: UsageChoice | null | 'unavailable';
  owner: string | null;
}

export const usePortalUsage = create<UsageState>(() => ({ choice: null, owner: null }));

/** The slice of posthog-js the portal uses. */
interface PostHogLike {
  init: (key: string, options: Partial<PostHogConfig>) => unknown;
  capture: (event: string, properties?: Record<string, unknown>) => unknown;
  opt_out_capturing: () => void;
  opt_in_capturing: (options?: { captureEventName?: false | null }) => void;
  reset: (resetDeviceId?: boolean) => void;
}

let sdk: PostHogLike | null = null;
let openedCounted = false;

async function loadSdk(): Promise<PostHogLike | null> {
  if (sdk) return sdk;
  try {
    // The SDK, the contract and its guard load together, only once sharing is on
    const [sdkModule, { documentLocale, posthogInitOptions }] = await Promise.all([import('posthog-js'), import('../../lib/analytics/posthogConfig')]);
    const posthog = sdkModule.default as unknown as PostHogLike;
    posthog.init(
      POSTHOG_KEY,
      posthogInitOptions(() => ({ surface: 'portal', appVersion: APP_VERSION, locale: documentLocale() })),
    );
    sdk = posthog;
    return sdk;
  } catch {
    // An ad blocker or a network failure must never break the portal
    return null;
  }
}

function readRecord(): { owner: string; choice: UsageChoice } | null {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(USAGE_RECORD_KEY) ?? 'null');
    if (parsed && typeof parsed === 'object') {
      const { owner, choice } = parsed as Record<string, unknown>;
      if (typeof owner === 'string' && (choice === 'on' || choice === 'off')) return { owner, choice };
    }
  } catch {
    // Unreadable storage or a malformed record: treat as not asked
  }
  return null;
}

function writeRecord(owner: string, choice: UsageChoice) {
  try {
    localStorage.setItem(USAGE_RECORD_KEY, JSON.stringify({ owner, choice }));
  } catch {
    // Private windows can refuse storage; the choice then lasts for this page only
  }
}

/** Deletes PostHog's own keys (the random ID and its consent flag) from this browser. */
function forgetPosthogStorage() {
  try {
    for (const key of Object.keys(localStorage)) if (/^(__)?ph_/.test(key)) localStorage.removeItem(key);
  } catch {
    // Nothing stored, or storage refused: nothing to delete
  }
}

/** Resets the SDK's identity and silences it, without sending anything (order matters: reset clears consent). */
function silenceSdk() {
  if (!sdk) return;
  sdk.reset(true);
  sdk.opt_out_capturing();
}

function clearEverything() {
  silenceSdk();
  forgetPosthogStorage();
  try {
    localStorage.removeItem(USAGE_RECORD_KEY);
  } catch {
    // Storage refused: nothing was kept
  }
}

/**
 * Called once the signed-in person is known. Another account's choice is
 * reset; a stored "on" starts the SDK and counts this opening of the portal.
 */
export async function syncPortalUsage(userId: string): Promise<void> {
  if (!POSTHOG_KEY) {
    usePortalUsage.setState({ choice: 'unavailable', owner: userId });
    return;
  }
  let record = readRecord();
  if (record && record.owner !== userId) {
    clearEverything();
    record = null;
  }
  usePortalUsage.setState({ choice: record?.choice ?? null, owner: userId });
  if (record?.choice !== 'on' || openedCounted) return;
  openedCounted = true;
  const posthog = await loadSdk();
  posthog?.capture('portal_opened');
}

/** The person's answer, from the prompt or the account menu. */
export async function choosePortalUsage(choice: UsageChoice, prompt: UsagePrompt): Promise<void> {
  const { owner, choice: current } = usePortalUsage.getState();
  if (!POSTHOG_KEY || !owner || current === 'unavailable') return;
  writeRecord(owner, choice);
  usePortalUsage.setState({ choice });
  if (choice === 'on') {
    if (current === 'on') return;
    const reopening = sdk !== null;
    const posthog = await loadSdk();
    if (!posthog) return;
    if (reopening) {
      // A fresh ID after an earlier opt-out in this page: reset first, then opt in (reset clears consent)
      posthog.reset(true);
      posthog.opt_in_capturing({ captureEventName: false });
    }
    openedCounted = true;
    posthog.capture('analytics_opted_in', { prompt });
    return;
  }
  if (current === 'on' && sdk) {
    // The one last note (D5), sent at once (request_batching is off), then the ID goes
    sdk.capture('analytics_opted_out');
    silenceSdk();
  }
  forgetPosthogStorage();
}

/** Sign-out on this tab or another: forget the choice and the ID, sending nothing (rule 6). */
export function endPortalUsage(): void {
  clearEverything();
  openedCounted = false;
  usePortalUsage.setState({ choice: null, owner: null });
}

/** Counts a confirmed save; does nothing unless the signed-in person turned sharing on. */
export async function trackPortal(event: PortalEvent, properties: Record<string, unknown>): Promise<void> {
  if (usePortalUsage.getState().choice !== 'on' || !sdk) return;
  try {
    sdk.capture(event, properties);
  } catch {
    // Counting must never break a save
  }
}

export function resetPortalUsageForTests() {
  sdk = null;
  openedCounted = false;
  usePortalUsage.setState({ choice: null, owner: null });
}
