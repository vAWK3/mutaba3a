import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ApiError, apiErrorReason, type BillingRetention, type CancellationReason, type CancellationResult, type PauseResult, type StayOfferResult } from '../api/client';
import { billingRetentionQuery, useCancelPlan, usePausePlan, useTakeStayOffer } from '../data/billingQueries';

/**
 * MUT-532 (plan D8, §3): the cancel flow's state, shared by its body and its pinned footer (BillingCancelFlow.tsx).
 * Why? → Pause instead? (when open) → the stay offer (when open) → Confirm cancel. Declining the stay offer is the
 * confirm, so Confirm shows only when no stay offer did. The offers are read when Cancel plan is pressed.
 */

export type CancelPhase = 'why' | 'pause' | 'stay' | 'confirm';
export type PauseMonths = 1 | 2 | 3;
export type CancelFailure = 'changed' | 'tooMany' | 'needsHelp' | 'sessionFailed';

/** What the status view says once the flow ends. */
export type CancelOutcome = { kind: 'paused'; result: PauseResult } | { kind: 'stayed'; result: StayOfferResult } | { kind: 'cancelled'; result: CancellationResult };

/** Stripe's `cancellation_details.feedback` values, in the order the Why? step lists them (server CANCELLATION_REASONS). */
export const CANCEL_REASONS: readonly CancellationReason[] = ['too_expensive', 'unused', 'missing_features', 'switched_service', 'too_complex', 'low_quality', 'customer_service', 'other'];
/** Stripe's own limit on the comment. */
export const CANCEL_COMMENT_MAX = 500;

export interface CancelFlow {
  phase: CancelPhase;
  retention: BillingRetention | null;
  /** The offers are still being read: Continue waits. */
  loading: boolean;
  reason: CancellationReason | null;
  setReason: (reason: CancellationReason) => void;
  comment: string;
  setComment: (comment: string) => void;
  months: PauseMonths;
  setMonths: (months: PauseMonths) => void;
  busy: boolean;
  failure: CancelFailure | null;
  next: () => void;
  confirmPause: () => void;
  declinePause: () => void;
  acceptStay: () => void;
  /** Declining the stay offer and Confirm cancel both cancel at the period end. */
  cancel: () => void;
}

export function useCancelFlow(active: boolean, onDone: (outcome: CancelOutcome) => void): CancelFlow {
  const retentionQuery = useQuery({ ...billingRetentionQuery, enabled: active });
  const pause = usePausePlan();
  const stay = useTakeStayOffer();
  const cancelPlan = useCancelPlan();
  const [phase, setPhase] = useState<CancelPhase>('why');
  const [reason, setReason] = useState<CancellationReason | null>(null);
  const [comment, setComment] = useState('');
  const [months, setMonths] = useState<PauseMonths>(1);
  // Render-time reset, not an effect (react-hooks v7): each Cancel plan press starts at Why?.
  const [wasActive, setWasActive] = useState(active);
  if (active !== wasActive) {
    setWasActive(active);
    if (active) {
      setPhase('why');
      setReason(null);
      setComment('');
      setMonths(1);
      pause.reset();
      stay.reset();
      cancelPlan.reset();
    }
  }

  const retention = retentionQuery.data ?? null;
  const stayStep = (): CancelPhase => (retention?.stayOffer ? 'stay' : 'confirm');
  const withReason = <T,>(run: (why: CancellationReason) => T) => (reason ? run(reason) : undefined);
  const trimmed = comment.trim();
  // An unreadable offer list never blocks a cancel: the flow goes straight to Confirm (ADR-237 D5's rule).
  const refused = retentionQuery.error instanceof ApiError && retentionQuery.error.code === 'CONFLICT';

  return {
    phase,
    retention,
    loading: retentionQuery.isPending && retentionQuery.fetchStatus !== 'idle',
    reason,
    setReason,
    comment,
    setComment: (value) => setComment(value.slice(0, CANCEL_COMMENT_MAX)),
    months,
    setMonths,
    busy: pause.isPending || stay.isPending || cancelPlan.isPending,
    failure: failureOf(pause.error ?? stay.error ?? cancelPlan.error ?? (refused ? retentionQuery.error : null)),
    next: () => {
      if (!reason || refused) return;
      setPhase(retention?.pause ? 'pause' : stayStep());
    },
    confirmPause: () => withReason((why) => pause.mutate({ months, reason: why }, { onSuccess: (result) => onDone({ kind: 'paused', result }) })),
    declinePause: () => setPhase(stayStep()),
    acceptStay: () => withReason((why) => stay.mutate({ reason: why }, { onSuccess: (result) => onDone({ kind: 'stayed', result }) })),
    cancel: () =>
      withReason((why) => cancelPlan.mutate({ reason: why, ...(trimmed ? { comment: trimmed } : {}) }, { onSuccess: (result) => onDone({ kind: 'cancelled', result }) })),
  };
}

function failureOf(error: Error | null): CancelFailure | null {
  if (!error) return null;
  if (!(error instanceof ApiError)) return 'sessionFailed';
  if (apiErrorReason(error) === 'BILLING_ACCOUNT_NEEDS_HELP') return 'needsHelp';
  if (error.code === 'RATE_LIMITED') return 'tooMany';
  if (error.code === 'CONFLICT' || error.code === 'VALIDATION_FAILED' || error.code === 'BILLING_NOT_CONFIGURED') return 'changed';
  return 'sessionFailed';
}
