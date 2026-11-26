import { useQuery } from '@tanstack/react-query';
import type { BillingOverview } from '../api/client';
import { useMeOrNull } from '../session/me';
import { useIsLocalMode } from '../session/mode';
import { billingQuery } from './billingQueries';
import { isSellable } from './billingView';
import { starterUsageOf, type StarterUsage } from './planUsage';

/**
 * MUT-731 (ADR-284): this month's Starter meters where a screen needs them (the Issue drawer, the receipt upload).
 * Billing's query runs only for someone on Starter (/v1/me `plan.current`), never signed out.
 */
export function useStarterUsage(): { usage: StarterUsage | null; billing: BillingOverview | null; canUpgrade: boolean } {
  const me = useMeOrNull();
  const local = useIsLocalMode();
  const onStarter = !local && me?.plan?.current === 'starter';
  const billing = useQuery({ ...billingQuery, enabled: onStarter });
  const data = onStarter ? (billing.data ?? null) : null;
  return { usage: starterUsageOf(data), billing: data, canUpgrade: data ? isSellable(data) : false };
}
