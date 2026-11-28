import { useState } from 'react';
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { trackPortal } from '../analytics/portalAnalytics';
import { ApiError, api, apiErrorReason, type BillingOverview, type PlanChangePreview, type PlanChangeResult, type PlanChangeTarget } from '../api/client';
import { useLanguage, useT } from '../../lib/i18n/core';
import { useToast } from '../components/Toast';
import { formatInstant } from '../format/dates';
import { browserTimezone } from '../format/timezones';
import { ME_KEY } from '../session/me';
import { BILLING_KEY } from './billingQueries';

/**
 * MUT-734: change plan from Billing (server half ADR-291). Up now with Stripe's proration, down at the period end, to
 * Starter by a cancel at the period end. The preview is Stripe's amount at this moment, never cached; the confirm
 * sends its `prorationAt` and amount back, so what is charged is what was shown (MUT-531 D1).
 */

export const PLAN_LADDER: readonly PlanChangeTarget[] = ['starter', 'solo', 'business', 'firm'];

/** GET /v1/billing `planChange`: the plans the person may move to now (empty while a change is scheduled). */
export function changeTargetsOf(billing: BillingOverview | undefined): PlanChangeTarget[] {
  const change = billing?.planChange;
  if (!change) return [];
  const allowed = new Set<string>([...change.canUpgradeTo, ...change.canDowngradeTo]);
  return PLAN_LADDER.filter((p) => allowed.has(p));
}

/** GET /v1/billing `scheduledChange` (a nullable union the generator types loosely). */
export interface ScheduledChange {
  plan: string;
  at: string;
  kind: 'UPGRADE' | 'DOWNGRADE' | 'TO_STARTER';
}
export function scheduledChangeOf(billing: BillingOverview | undefined): ScheduledChange | null {
  return (billing?.scheduledChange as ScheduledChange | null | undefined) ?? null;
}

/** GET /v1/billing `pendingChange`: an upgrade waiting for the bank (3-D Secure) until the mirror sees it. */
export function pendingChangeOf(billing: BillingOverview | undefined): { plan: string; since: string } | null {
  return (billing?.pendingChange as { plan: string; since: string } | null | undefined) ?? null;
}

export const planChangePreviewQuery = (plan: PlanChangeTarget) =>
  queryOptions({
    queryKey: [...BILLING_KEY, 'plan-change', plan] as const,
    queryFn: () => api.previewPlanChange(plan),
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });

export type ChangeFailure = 'declined' | 'changed' | 'chooseBusinesses' | 'failed';

/** What a refused confirm means on screen: the card, a stale preview (preview again), the pick, or anything else. */
export function changeFailureOf(error: unknown): ChangeFailure | null {
  if (!error) return null;
  if (!(error instanceof ApiError)) return 'failed';
  const reason = apiErrorReason(error);
  if (reason === 'PAYMENT_FAILED') return 'declined';
  if (reason === 'PREVIEW_EXPIRED' || reason === 'AMOUNT_CHANGED') return 'changed';
  if (reason === 'ACTIVE_BUSINESSES_REQUIRED') return 'chooseBusinesses';
  return 'failed';
}

/** The pane's state: the plan picked, its preview, the businesses kept, and the confirm. */
export function useChangePlan(billing: BillingOverview | undefined, wanted: PlanChangeTarget | undefined, onScheduled: (result: PlanChangeResult) => void) {
  const queryClient = useQueryClient();
  const targets = changeTargetsOf(billing);
  const from = billing?.currentPlan ?? 'solo';
  // The plan the URL asked for stands until the person picks (derived, so it applies once billing has loaded).
  const [chosen, setPicked] = useState<PlanChangeTarget | null>(null);
  const picked = chosen ?? (wanted && targets.includes(wanted) ? wanted : null);
  const [keep, setKeep] = useState<string[]>([]);
  const preview = useQuery({ ...planChangePreviewQuery(picked ?? 'solo'), enabled: picked !== null });
  const data: PlanChangePreview | undefined = picked ? preview.data : undefined;
  const confirm = useMutation({
    mutationFn: (shown: PlanChangePreview) =>
      api.changePlan({
        plan: shown.plan,
        ...(shown.kind === 'upgrade' ? { prorationAt: shown.prorationAt, expectedAmountDue: shown.amountDue } : {}),
        ...(shown.kind !== 'upgrade' && shown.mustChoose ? { activeBusinessIds: keep } : {}),
      }),
    onSuccess: (result) => {
      void trackPortal('plan_change_confirmed', { from, to: result.change.toPlan.toLowerCase(), kind: result.change.kind.toLowerCase() });
      if (result.state === 'scheduled') onScheduled(result);
    },
    onError: (error) => {
      if (changeFailureOf(error) === 'changed') void preview.refetch();
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: BILLING_KEY, exact: true });
      void queryClient.invalidateQueries({ queryKey: ME_KEY });
    },
  });
  const pick = (plan: PlanChangeTarget) => {
    setPicked(plan);
    setKeep([]);
    confirm.reset();
    void trackPortal('plan_change_previewed', { from, to: plan });
  };
  const needsPick = data !== undefined && data.kind !== 'upgrade' && data.mustChoose;
  const cap = data && data.kind !== 'upgrade' ? data.cap : 0;
  const ready = data !== undefined && !preview.isFetching && (!needsPick || keep.length === cap);
  return {
    targets,
    from,
    picked,
    pick,
    preview,
    data,
    keep,
    setKeep,
    needsPick,
    ready,
    confirm,
    submit: () => data && ready && confirm.mutate(data),
    failure: changeFailureOf(confirm.error),
  };
}

export type ChangePlanState = ReturnType<typeof useChangePlan>;

/** Undo a scheduled change. Billing is read again after the line's 350 ms collapse (undo-toast spec), not before. */
export function useUndoPlanChange() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.undoPlanChange(),
    onSuccess: () => void trackPortal('plan_change_undone', {}),
    onSettled: () => {
      setTimeout(() => {
        void queryClient.invalidateQueries({ queryKey: BILLING_KEY, exact: true });
        void queryClient.invalidateQueries({ queryKey: ME_KEY });
      }, UNDO_COLLAPSE_MS);
    },
  });
}

/** The undo-toast spec's collapse of the "Scheduled · Undo" line. */
export const UNDO_COLLAPSE_MS = 350;

/** After a downgrade or a move to Starter is scheduled: the undo toast (rises, 6 s, Undo fades it; spec undo-toast). */
export function useScheduledToast() {
  const t = useT();
  const { language } = useLanguage();
  const toast = useToast();
  const undo = useUndoPlanChange();
  return (result: PlanChangeResult) =>
    toast(t('hosted.billing.change.fromDate', { plan: t(`hosted.plan.name.${result.change.toPlan.toLowerCase()}`), date: formatInstant(result.change.effectiveAt, language, browserTimezone()) }), {
      tone: 'info',
      motion: 'undo',
      action: { label: t('hosted.billing.change.undo'), onAction: () => undo.mutate() },
    });
}
