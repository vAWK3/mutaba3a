import type { PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/browser';
import { api, ApiError, apiErrorReason, type Schemas } from '../api/client';
import { assertPasskey } from '../passkeys/webauthn';

/**
 * MUT-460 (ADR-213, design 1A, 10A): every operator write needs a passkey step-up no older than 10 minutes (MUT-459
 * D7). While the server's `stepUpUntil` is fresh, an action runs straight away; when it isn't, the same tap runs the
 * passkey sheet first. A 403 on a direct action never starts the sheet by itself: the confirm offers "Confirm with
 * passkey" instead, so the system prompt only ever follows a tap that said it would. No UI here: MUT-461/462 reuse it.
 */
export type StepUpFailure = 'cancelled' | 'refused' | 'noPasskey' | 'browser' | 'failed';

/** A failed step-up; `browser` keeps the platform's error name (NotSupportedError, SecurityError, …) to show. */
export type StepUpFailed = { kind: StepUpFailure; error?: string };

export type OperatorActionOutcome<T> =
  | { kind: 'done'; value: T }
  /** A direct action met 403 RECENT_SIGN_IN_REQUIRED: the window lapsed since the page read it. */
  | { kind: 'needsPasskey' }
  | { kind: 'stepUpFailed'; reason: StepUpFailure; error?: string }
  /** Any other refusal (409, 404, network): the caller maps it. */
  | { kind: 'error'; error: unknown };

/** A tap this close to the window's end steps up first rather than meet a 403 halfway. */
const FRESH_MARGIN_MS = 30_000;

export function isStepUpFresh(until: string | null | undefined, now: Date): boolean {
  const end = until ? Date.parse(until) : Number.NaN;
  return Number.isFinite(end) && end - now.getTime() > FRESH_MARGIN_MS;
}

type StepUpOptions = Awaited<ReturnType<typeof api.operatorStepUpOptions>>;

/** A challenge lives 5 minutes on the server; one fetched ahead is used only while well inside that. */
const PREFETCH_FRESH_MS = 4 * 60_000;
let prefetched: { at: number; options: Promise<StepUpOptions> } | null = null;

/**
 * Fetches the step-up options before the tap that needs them (a confirm that will ask for the passkey has opened), so
 * the tap goes straight to the system sheet. Safari only shows the sheet close to the tap: a round trip in between
 * could cost it the gesture and end in a NotAllowedError with no sheet at all. One challenge at a time; a failed fetch
 * is forgotten, and the tap fetches again.
 */
export function prefetchStepUpOptions(now: number = Date.now()): void {
  if (prefetched && now - prefetched.at < PREFETCH_FRESH_MS) return;
  const options = api.operatorStepUpOptions();
  prefetched = { at: now, options };
  options.catch(() => {
    if (prefetched?.options === options) prefetched = null;
  });
}

/** The prefetched options when still fresh (each challenge is single-use, so it's taken), else a fresh fetch. */
function takeOptions(now: number): Promise<StepUpOptions> {
  const ready = prefetched;
  prefetched = null;
  return ready && now - ready.at < PREFETCH_FRESH_MS ? ready.options : api.operatorStepUpOptions();
}

/** Forgets a prefetched challenge (tests). */
export function resetStepUpPrefetch(): void {
  prefetched = null;
}

/**
 * Options, the system sheet, then the server. Cancelling the sheet (or no passkey on this device) is `cancelled`; a
 * platform error the server never saw is `browser`, with its name; a passkey the server refused is `refused`.
 */
export async function stepUpWithPasskey(): Promise<{ kind: 'ok'; until: string } | StepUpFailed> {
  try {
    const { challengeId, publicKey } = await takeOptions(Date.now());
    const asserted = await assertPasskey(publicKey as unknown as PublicKeyCredentialRequestOptionsJSON);
    if (asserted.kind === 'cancelled') return { kind: 'cancelled' };
    if (asserted.kind === 'failed') return { kind: 'browser', error: asserted.error };
    const { stepUpUntil } = await api.operatorStepUp({ challengeId, response: asserted.response as Schemas['PasskeySignInRequest']['response'] });
    return { kind: 'ok', until: stepUpUntil };
  } catch (error) {
    if (!(error instanceof ApiError)) return { kind: 'failed' };
    if (error.code === 'PASSKEY_NOT_ACCEPTED') return { kind: 'refused' };
    if (apiErrorReason(error) === 'OPERATOR_NEEDS_PASSKEY') return { kind: 'noPasskey' };
    return { kind: 'failed' };
  }
}

const needsStepUp = (error: unknown) => error instanceof ApiError && error.code === 'RECENT_SIGN_IN_REQUIRED';

export async function runOperatorAction<T>(
  action: () => Promise<T>,
  options: { withPasskey: boolean; onSteppedUp?: (until: string) => void },
): Promise<OperatorActionOutcome<T>> {
  if (options.withPasskey) {
    const stepped = await stepUpWithPasskey();
    if (stepped.kind !== 'ok') return { kind: 'stepUpFailed', reason: stepped.kind, ...(stepped.error ? { error: stepped.error } : {}) };
    options.onSteppedUp?.(stepped.until);
  }
  try {
    return { kind: 'done', value: await action() };
  } catch (error) {
    if (!needsStepUp(error)) return { kind: 'error', error };
    return options.withPasskey ? { kind: 'stepUpFailed', reason: 'refused' } : { kind: 'needsPasskey' };
  }
}
