import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, type BillingRedirect, type CheckoutSessionRequest } from '../api/client';
import { ME_KEY } from '../session/me';

/**
 * MUT-362: Settings › Billing's server state. Person-level, so the key is not under a profile (`['p', id, …]`): one
 * person, one billing. Both mutations end by leaving the portal for a Stripe-hosted page (DR6 warns first).
 */

export const BILLING_KEY = ['billing'] as const;
const BILLING_STALE_MS = 30_000;
/** The return-from-Stripe poll (eng review D4; the Customer Portal's return too): every 2 s, for up to 30 s. */
export const CONFIRM_POLL_MS = 2_000;
export const CONFIRM_POLL_LIMIT_MS = 30_000;
/** The server's RETURN_PATH (server/src/billing/checkout.ts): `/` or a profile page with a real UUID. */
const RETURN_PATH = /^\/(p\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(\/[a-z0-9-]+)*)?$/;
/** Error codes that mean the server's view of this person's billing differs from the drawer's: read it again. */
const STALE_VIEW_CODES: ReadonlySet<string> = new Set(['CONFLICT', 'VALIDATION_FAILED', 'BILLING_NOT_CONFIGURED']);

export const billingQuery = queryOptions({
  queryKey: BILLING_KEY,
  queryFn: ({ signal }) => api.billing({ signal }),
  staleTime: BILLING_STALE_MS,
  retry: false,
});

/** Where Stripe sends the person back: this page if it is a portal path the server accepts, else the portal root. */
export function billingReturnPath(pathname: string): string {
  return RETURN_PATH.test(pathname) ? pathname : '/';
}

/** The browser leaves only for Stripe (review): a bad server answer must never become a redirect anywhere else. */
export function assertStripeUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('The billing redirect is not a URL');
  }
  const host = parsed.hostname;
  if (parsed.protocol !== 'https:' || !(host === 'stripe.com' || host.endsWith('.stripe.com'))) throw new Error('The billing redirect is not a Stripe page');
}

/** The one way the drawer leaves for Stripe; an object so a test can watch it (jsdom's location can't be spied on). */
export const stripeNavigation = {
  assign: (url: string): void => window.location.assign(url),
};

async function checked(redirect: Promise<BillingRedirect>): Promise<BillingRedirect> {
  const answer = await redirect;
  assertStripeUrl(answer.url);
  return answer;
}

function leaveFor(redirect: BillingRedirect): void {
  stripeNavigation.assign(redirect.url);
}

/** A refusal means the drawer's view is stale (a grant added, a payment failed): read billing and /v1/me again. */
function useRefreshOnRefusal() {
  const queryClient = useQueryClient();
  return (error: Error) => {
    if (!(error instanceof ApiError) || !STALE_VIEW_CODES.has(error.code)) return;
    void queryClient.invalidateQueries({ queryKey: BILLING_KEY });
    void queryClient.invalidateQueries({ queryKey: ME_KEY });
  };
}

export function useStartCheckout() {
  const onError = useRefreshOnRefusal();
  return useMutation({ mutationFn: (body: CheckoutSessionRequest) => checked(api.startCheckout(body)), onSuccess: leaveFor, onError });
}

export function useOpenBillingPortal() {
  const onError = useRefreshOnRefusal();
  return useMutation({ mutationFn: (returnPath: string) => checked(api.openBillingPortal({ returnPath })), onSuccess: leaveFor, onError });
}
