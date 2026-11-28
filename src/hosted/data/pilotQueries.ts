import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type BillingOverview } from '../api/client';
import { useMeOrNull } from '../session/me';
import { useIsLocalMode } from '../session/mode';
import { BILLING_KEY, billingQuery } from './billingQueries';
import { billingPilotOf, mayBeOnPilot, type BillingPilot } from './pilot';

/**
 * MUT-755: the pilot as the shell needs it (the Welcome, the milestones). GET /v1/billing is read only for someone
 * an ending operator grant covers (`mayBeOnPilot`), never signed out; everyone else gets null without a request.
 */
export function usePilot(): { pilot: BillingPilot | null; billing: BillingOverview | null; settled: boolean } {
  const me = useMeOrNull();
  const local = useIsLocalMode();
  const enabled = !local && me !== null && mayBeOnPilot(me);
  const billing = useQuery({ ...billingQuery, enabled });
  const data = enabled ? (billing.data ?? null) : null;
  // Settled: the answer is known (no read needed, or the read ended either way).
  return { pilot: billingPilotOf(data), billing: data, settled: !enabled || billing.isSuccess || billing.isError };
}

/** MUT-777 (ADR-333): the tester said yes to watched sessions (in the Welcome); the cache says so once it is stored. */
export function usePilotWatchConsent() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api.pilotWatchConsent(),
    onSuccess: ({ watchConsentAt }) => {
      client.setQueryData<BillingOverview>(BILLING_KEY, (old) => {
        const pilot = billingPilotOf(old);
        return old && pilot ? { ...old, pilot: { ...pilot, watchConsentAt } } : old;
      });
    },
  });
}

/**
 * MUT-755 (ADR-296): the Welcome was closed. The cached billing says so at once, so the Welcome never opens again in
 * this tab even if the request fails (then it comes back on the next visit, which is the safe side).
 */
export function usePilotWelcomeSeen() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api.pilotWelcomeSeen(),
    onMutate: () => {
      const at = new Date().toISOString();
      client.setQueryData<BillingOverview>(BILLING_KEY, (old) => {
        const pilot = billingPilotOf(old);
        return old && pilot ? { ...old, pilot: { ...pilot, welcomeSeenAt: at } } : old;
      });
    },
    onSuccess: ({ welcomeSeenAt }) => {
      client.setQueryData<BillingOverview>(BILLING_KEY, (old) => {
        const pilot = billingPilotOf(old);
        return old && pilot ? { ...old, pilot: { ...pilot, welcomeSeenAt } } : old;
      });
    },
  });
}
