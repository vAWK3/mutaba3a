import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { trackPlanEvent } from '../analytics/portalAnalytics';
import { ApiError, api, type BillingOverview } from '../api/client';
import { useMeOrNull } from '../session/me';
import { useIsLocalMode } from '../session/mode';
import { BILLING_KEY, billingQuery } from './billingQueries';
import { isSellable } from './billingView';
import { LIMITED_PLANS, planUsageOf, type LimitedPlan, type MeterKey, type PlanLimit, type PlanUsage } from './planUsage';

/**
 * MUT-733: this month's meters on any plan with limits, where a screen needs them (the Issue drawer, the receipt
 * upload). Billing's query runs only for someone on Starter, Solo, Business or Firm (/v1/me `plan.current`).
 */
export function usePlanUsage(): { usage: PlanUsage | null; billing: BillingOverview | null; canUpgrade: boolean } {
  const me = useMeOrNull();
  const local = useIsLocalMode();
  const limited = !local && LIMITED_PLANS.includes(me?.plan?.current as LimitedPlan);
  const billing = useQuery({ ...billingQuery, enabled: limited });
  const data = limited ? (billing.data ?? null) : null;
  return { usage: planUsageOf(data), billing: data, canUpgrade: data ? isSellable(data) : false };
}

/**
 * MUT-733 (AC2): the gift, known before the person types: a paid plan's meter at its cap with the once-ever gift unused
 * (the server sends `gift.available` only where PAID_HARD_CAPS refuses). Firm is never refused (Q2), so never gifted.
 */
export function giftBeforeTyping(usage: PlanUsage | null, meter: MeterKey): PlanLimit | null {
  if (!usage || usage.plan === 'starter' || usage.plan === 'firm' || !usage.giftAvailable) return null;
  const m = usage[meter];
  if (m.level !== 'at_cap' || m.graceUntil) return null;
  return { limit: meter, used: m.used, cap: m.limit, resetsOn: usage.resetsOn, nextPlan: usage.plan === 'solo' ? 'business' : 'firm', canUpgrade: true, gift: true };
}

/**
 * MUT-733: Continue on the gift. Records it (POST /v1/billing/over-cap-gift; a partner names the business, so the owner's
 * gift is taken, Q3) and reads Billing again, so the meter says "No limit until …". 409 GIFT_USED from a second tab is
 * success for the caller: the gift runs either way when the meters match.
 */
export function useAcceptGift(organizationId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (meter: MeterKey) => {
      try {
        return await api.acceptOverCapGift({ meter, ...(organizationId ? { organizationId } : {}) });
      } catch (error) {
        if (error instanceof ApiError && error.code === 'GIFT_USED') return null;
        throw error;
      }
    },
    onSuccess: (_, meter) => trackPlanEvent('plan_gift_accepted', { limit: meter }),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: BILLING_KEY, exact: true }),
  });
}
