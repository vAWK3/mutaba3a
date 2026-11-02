import { useQuery } from '@tanstack/react-query';
import { ApiError, apiErrorReason, type YearlySwitchPreview, type YearlySwitchResult } from '../api/client';
import { assertStripeUrl, useSwitchToYearly, yearlySwitchQuery } from '../data/billingQueries';

/** MUT-531: the "Switch to yearly" step's state, shared by its body and its pinned footer (BillingSwitchBody.tsx). */

export type SwitchFailure = 'declined' | 'amountChanged' | 'needsAction' | 'notAvailable' | 'failed';

export interface SwitchStep {
  preview: ReturnType<typeof useQuery<YearlySwitchPreview, Error>>;
  mutation: ReturnType<typeof useSwitchToYearly>;
  failure: SwitchFailure | null;
  /** R2: Stripe's page to approve a payment the bank is holding; only ever a stripe.com URL. */
  approveUrl: string | null;
  confirm: () => void;
}

/** The step's state, shared by its body and its pinned footer. `onSwitched` hands the result to the status view. */
export function useSwitchStep(active: boolean, onSwitched: (result: YearlySwitchResult) => void): SwitchStep {
  const preview = useQuery({ ...yearlySwitchQuery, enabled: active });
  const mutation = useSwitchToYearly();
  const failure = failureOf(mutation.error) ?? (preview.error ? failureOf(preview.error) : null);
  return {
    preview,
    mutation,
    failure,
    approveUrl: approveUrlOf(mutation.error),
    confirm: () => {
      if (!preview.data) return;
      mutation.mutate(preview.data, {
        onSuccess: onSwitched,
        // A changed amount is previewed again at once; the banner says why the number moved.
        onError: (error) => {
          if (failureOf(error) === 'amountChanged') void preview.refetch();
        },
      });
    },
  };
}

const FAILURES: Record<string, SwitchFailure> = {
  PAYMENT_FAILED: 'declined',
  AMOUNT_CHANGED: 'amountChanged',
  PAYMENT_NEEDS_ACTION: 'needsAction',
  SWITCH_NOT_AVAILABLE: 'notAvailable',
};

function failureOf(error: Error | null): SwitchFailure | null {
  if (!error) return null;
  if (!(error instanceof ApiError)) return 'failed';
  return FAILURES[apiErrorReason(error) ?? ''] ?? 'failed';
}

function approveUrlOf(error: Error | null): string | null {
  if (!(error instanceof ApiError) || apiErrorReason(error) !== 'PAYMENT_NEEDS_ACTION') return null;
  const url = (error.details as { hostedInvoiceUrl?: unknown } | null)?.hostedInvoiceUrl;
  if (typeof url !== 'string') return null;
  try {
    assertStripeUrl(url);
    return url;
  } catch {
    return null;
  }
}
