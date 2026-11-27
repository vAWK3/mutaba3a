import { ApiError, retryMinutes, type BillingOverview, type Me, type SetupLinkCheck } from '../../api/client';

/**
 * MUT-769: the pure half of `/setup` for an account an accountant created (MUT-764/765): what the context line says,
 * what a refused code means, and where the customer goes once the account is theirs (DR-7: the passkey nudge, then
 * the card when one is due, then the app).
 */

/** The server's claim code: six digits (server/src/accountants/claim.ts). */
export const CLAIM_CODE_LENGTH = 6;

export type ClaimContext = NonNullable<Extract<SetupLinkCheck, { state: 'valid' }>['claim']>;

/** The context line's key and names: either name may be missing (a removed business, an accountant with no name). */
export function claimContextKey(claim: Pick<ClaimContext, 'accountantName' | 'businessName'>): { key: string; vars: Record<string, string> } {
  const accountant = claim.accountantName?.trim() || null;
  const business = claim.businessName?.trim() || null;
  const base = 'hosted.accountantChannel.claim.';
  if (accountant && business) return { key: `${base}context`, vars: { accountant, business } };
  if (business) return { key: `${base}contextNoAccountant`, vars: { business } };
  if (accountant) return { key: `${base}contextNoBusiness`, vars: { accountant } };
  return { key: `${base}contextNone`, vars: {} };
}

export type ClaimCodeFailure =
  | { kind: 'wrong'; triesLeft: number }
  | { kind: 'locked' }
  | { kind: 'noCode' }
  | { kind: 'required' }
  | { kind: 'rateLimited'; minutes: number }
  | { kind: 'unreachable' };

/** What a refused code check (or a redeem refused for its code) means for the page. */
export function claimCodeFailure(error: unknown): ClaimCodeFailure {
  if (!(error instanceof ApiError)) return { kind: 'unreachable' };
  if (error.code === 'CLAIM_CODE_LOCKED') return { kind: 'locked' };
  if (error.code === 'CLAIM_CODE_WRONG') {
    const left = (error.details as { triesLeft?: unknown } | null)?.triesLeft;
    return { kind: 'wrong', triesLeft: typeof left === 'number' ? left : 1 };
  }
  if (error.status === 409 && (error.details as { reason?: unknown } | null)?.reason === 'NO_CLAIM_CODE') return { kind: 'noCode' };
  if (error.status === 429) return { kind: 'rateLimited', minutes: retryMinutes(error) };
  return { kind: 'unreachable' };
}

/** True when a redeem was refused for its claim code (it changed or locked since the code step). */
export function isClaimRefusal(error: unknown): boolean {
  return error instanceof ApiError && (error.code === 'CLAIM_CODE_WRONG' || error.code === 'CLAIM_CODE_LOCKED');
}

const COVERING = new Set(['active', 'trialing', 'past_due']);

/** Whether the customer already pays: the accountant took the card in the room (B15: a covering subscription). */
export function paysAlready(billing: Pick<BillingOverview, 'configured' | 'subscription'> | null): boolean {
  if (!billing) return true; // Billing unreadable: never block the app on a card step.
  if (!billing.configured) return true;
  const status = billing.subscription?.status;
  return typeof status === 'string' && COVERING.has(status);
}

export type ClaimNext = { to: string; search?: { billing: true; step: 'subscribe' } };

/**
 * DR-7 / ACCT-4: after the password (and the passkey nudge), the card step when the customer does not pay yet: their
 * own Checkout on the business profile the accountant made (the Billing drawer's Subscribe step, where the free plan
 * goes on without a card); otherwise the app.
 */
export function claimNext(me: Pick<Me, 'profiles'>, billing: Pick<BillingOverview, 'configured' | 'subscription'> | null): ClaimNext {
  const owned = me.profiles.filter((profile) => profile.owned);
  const business = owned.find((profile) => !profile.isPersonalDefault) ?? owned[0];
  if (!business) return { to: '/' };
  const to = `/p/${business.id}`;
  return paysAlready(billing) ? { to } : { to, search: { billing: true, step: 'subscribe' } };
}
