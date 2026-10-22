import { queryOptions, useMutation } from '@tanstack/react-query';
import { api, type BillingRedirect, type CheckoutSessionRequest } from '../api/client';

/**
 * MUT-362: Settings › Billing's server state. Person-level, so the key is not under a profile (`['p', id, …]`): one
 * person, one billing. Both mutations end by leaving the portal for a Stripe-hosted page (DR6 warns first).
 */

export const BILLING_KEY = ['billing'] as const;
const BILLING_STALE_MS = 30_000;
/** The return-from-Checkout poll (eng review D4): every 2 s, for up to 30 s. */
export const CONFIRM_POLL_MS = 2_000;
export const CONFIRM_POLL_LIMIT_MS = 30_000;

export const billingQuery = queryOptions({
  queryKey: BILLING_KEY,
  queryFn: ({ signal }) => api.billing({ signal }),
  staleTime: BILLING_STALE_MS,
  retry: false,
});

/** Where Stripe sends the person back: this page if it is a portal path the server accepts, else the portal root. */
export function billingReturnPath(pathname: string): string {
  return /^\/(p\/[0-9a-f-]{36}(\/[a-z0-9-]+)*)?$/.test(pathname) ? pathname : '/';
}

/** The one way the drawer leaves for Stripe; an object so a test can watch it (jsdom's location can't be spied on). */
export const stripeNavigation = {
  assign: (url: string): void => window.location.assign(url),
};

function leaveFor(redirect: BillingRedirect): void {
  stripeNavigation.assign(redirect.url);
}

export function useStartCheckout() {
  return useMutation({ mutationFn: (body: CheckoutSessionRequest) => api.startCheckout(body), onSuccess: leaveFor });
}

export function useOpenBillingPortal() {
  return useMutation({ mutationFn: (returnPath: string) => api.openBillingPortal({ returnPath }), onSuccess: leaveFor });
}
