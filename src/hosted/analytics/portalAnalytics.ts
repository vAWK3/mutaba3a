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
 *
 * The SDK starts opted out (`opt_out_capturing_by_default`) and is opted in
 * only while the choice is on, so deleting its consent record silences every
 * open tab, not just this one (review F1). Each step that waits for the SDK
 * to load checks the choice again afterwards, so an opt-out or sign-out made
 * meanwhile wins (review F2).
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
  has_opted_out_capturing: () => boolean;
  reset: (resetDeviceId?: boolean) => void;
}

let sdk: PostHogLike | null = null;
let loading: Promise<PostHogLike | null> | null = null;
let openedCounted = false;
/** True once this page has opted out: turning it on again starts a fresh ID. */
let silencedInThisPage = false;
let listening = false;

/** Loads the SDK, the contract and its guard together, once per page, and initialises it opted out. */
function loadSdk(): Promise<PostHogLike | null> {
  loading ??= (async () => {
    try {
      const [sdkModule, { documentLocale, posthogInitOptions }] = await Promise.all([import('posthog-js'), import('../../lib/analytics/posthogConfig')]);
      const posthog = sdkModule.default as unknown as PostHogLike;
      posthog.init(
        POSTHOG_KEY,
        posthogInitOptions(() => ({ surface: 'portal', appVersion: APP_VERSION, locale: documentLocale() })),
      );
      sdk = posthog;
      return posthog;
    } catch {
      // An ad blocker or a network failure must never break the portal
      return null;
    }
  })();
  return loading;
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

/** The choice this browser holds for `owner`, as any tab last wrote it. */
function storedChoiceFor(owner: string): UsageChoice | null {
  const record = readRecord();
  return record && record.owner === owner ? record.choice : null;
}

/** Still on for the same person, in this tab and in storage (another tab may have turned it off). */
function stillOn(owner: string): boolean {
  const state = usePortalUsage.getState();
  return state.choice === 'on' && state.owner === owner && storedChoiceFor(owner) === 'on';
}

/** Deletes PostHog's own keys (the random ID, its consent record, the window and session marks) from this browser. */
function forgetPosthogStorage() {
  for (const store of [globalThis.localStorage, globalThis.sessionStorage]) {
    try {
      for (const key of Object.keys(store)) if (/^(__)?ph_/.test(key)) store.removeItem(key);
    } catch {
      // Nothing stored, or storage refused: nothing to delete
    }
  }
}

/** Opts the SDK out, then resets its identity, without sending anything (ticket order; the SDK stays opted out). */
function silenceSdk() {
  if (!sdk) return;
  sdk.opt_out_capturing();
  sdk.reset(true);
  silencedInThisPage = true;
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

/** Opts a loaded SDK in for this person; a fresh random ID if this page opted out before. */
function optIn(posthog: PostHogLike) {
  if (!posthog.has_opted_out_capturing()) return;
  if (silencedInThisPage) posthog.reset(true);
  posthog.opt_in_capturing({ captureEventName: false });
  silencedInThisPage = false;
}

/** Another tab changed the choice: follow it here, sending nothing. */
function followOtherTab() {
  const { owner, choice } = usePortalUsage.getState();
  if (!owner || choice === 'unavailable') return;
  const stored = storedChoiceFor(owner);
  if (stored === choice) return;
  usePortalUsage.setState({ choice: stored });
  if (stored === 'on') return;
  silenceSdk();
  // sessionStorage is per tab: the tab that turned it off can't reach this one's
  forgetPosthogStorage();
}

function listenToOtherTabs() {
  if (listening || typeof window === 'undefined') return;
  listening = true;
  window.addEventListener('storage', onStorage);
}

function onStorage(event: StorageEvent) {
  if (event.key === USAGE_RECORD_KEY || event.key === null) followOtherTab();
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
  listenToOtherTabs();
  let record = readRecord();
  if (record && record.owner !== userId) {
    clearEverything();
    record = null;
  }
  usePortalUsage.setState({ choice: record?.choice ?? null, owner: userId });
  if (record?.choice !== 'on' || openedCounted) return;
  openedCounted = true;
  const posthog = await loadSdk();
  if (!posthog || !stillOn(userId)) return;
  optIn(posthog);
  posthog.capture('portal_opened');
}

/** The person's answer, from the prompt or the account menu. */
export async function choosePortalUsage(choice: UsageChoice, prompt: UsagePrompt): Promise<void> {
  const { owner, choice: current } = usePortalUsage.getState();
  if (!POSTHOG_KEY || !owner || current === 'unavailable') return;
  writeRecord(owner, choice);
  usePortalUsage.setState({ choice });
  if (choice === 'on') {
    if (current === 'on') return;
    const posthog = await loadSdk();
    // Turned off or signed out while the SDK loaded: that answer wins
    if (!posthog || !stillOn(owner)) return;
    optIn(posthog);
    openedCounted = true;
    posthog.capture('analytics_opted_in', { prompt });
    return;
  }
  if (current === 'on' && sdk && !sdk.has_opted_out_capturing()) {
    // The one last note (D5), sent at once (request_batching is off), then the ID goes
    sdk.capture('analytics_opted_out');
  }
  silenceSdk();
  forgetPosthogStorage();
}

/** Sign-out on this tab or another: forget the choice and the ID, sending nothing (rule 6). */
export function endPortalUsage(): void {
  clearEverything();
  openedCounted = false;
  usePortalUsage.setState({ choice: null, owner: null });
}

/**
 * Counts a confirmed save; does nothing unless the signed-in person turned
 * sharing on. Right after a reload the SDK may still be loading: the save
 * waits for it rather than being lost (review F3).
 */
export async function trackPortal(event: PortalEvent, properties: Record<string, unknown>): Promise<void> {
  const { owner, choice } = usePortalUsage.getState();
  if (choice !== 'on' || !owner) return;
  if (!stillOn(owner)) {
    followOtherTab();
    return;
  }
  const posthog = sdk ?? (await loading);
  if (!posthog || !stillOn(owner)) return;
  try {
    optIn(posthog);
    posthog.capture(event, properties);
  } catch {
    // Counting must never break a save
  }
}

export function resetPortalUsageForTests() {
  sdk = null;
  loading = null;
  openedCounted = false;
  silencedInThisPage = false;
  if (listening) window.removeEventListener('storage', onStorage);
  listening = false;
  usePortalUsage.setState({ choice: null, owner: null });
}
