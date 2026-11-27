import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, type Schemas } from '../api/client';
import { ME_KEY } from '../session/me';
import { CLIENT_BOOKS_KEY } from './clientBooksQueries';

/**
 * MUT-768 (accountant channel): the desk's reads and writes for the customers an approved accountant creates.
 * The list is the accountant's own (`['accountantCustomers']`, no profile). It answers 404 while the feature is off and
 * 403 ACCOUNTANT_NOT_APPROVED until the operator approves: both mean "not for this person", so the desk shows its client
 * books as before and no Add customer button.
 */
export const ACCOUNTANT_CUSTOMERS_KEY = ['accountantCustomers'] as const;
const STALE_MS = 30_000;

export interface AccountantCustomers {
  /** The operator approved this person to create customers. */
  approved: boolean;
  items: Schemas['ProvisionedCustomerRow'][];
}

const NOT_APPROVED: AccountantCustomers = { approved: false, items: [] };

/** `pollMs`: re-read this often (the two-minute Activating wait); false = no polling. */
export function useAccountantCustomers(pollMs: number | false = false) {
  return useQuery({
    queryKey: ACCOUNTANT_CUSTOMERS_KEY,
    queryFn: async ({ signal }): Promise<AccountantCustomers> => {
      try {
        return { approved: true, items: (await api.accountantCustomers(signal)).items };
      } catch (error) {
        if (error instanceof ApiError && (error.status === 404 || error.code === 'ACCOUNTANT_NOT_APPROVED')) return NOT_APPROVED;
        throw error;
      }
    },
    staleTime: STALE_MS,
    refetchInterval: pollMs,
  });
}

/** Every desk write changes both lists (a new customer is also a new client book, a claim changes a state). */
function useRefreshDesk() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: ACCOUNTANT_CUSTOMERS_KEY });
    void queryClient.invalidateQueries({ queryKey: CLIENT_BOOKS_KEY });
    void queryClient.invalidateQueries({ queryKey: ME_KEY });
  };
}

export function useCreateCustomer() {
  const refresh = useRefreshDesk();
  return useMutation({
    mutationFn: ({ body, idempotencyKey }: { body: Schemas['ProvisionCustomerRequest']; idempotencyKey: string }) => api.createAccountantCustomer(body, idempotencyKey),
    onSuccess: refresh,
  });
}

/** Resend the link and make a new code (one action). */
export function useReissueLink() {
  const refresh = useRefreshDesk();
  return useMutation({ mutationFn: ({ userId, idempotencyKey }: { userId: string; idempotencyKey: string }) => api.reissueCustomerLink(userId, idempotencyKey), onSuccess: refresh });
}

export function useChangeCustomerEmail() {
  const refresh = useRefreshDesk();
  return useMutation({
    mutationFn: ({ userId, email, idempotencyKey }: { userId: string; email: string; idempotencyKey: string }) => api.changeCustomerEmail(userId, email, idempotencyKey),
    onSuccess: refresh,
  });
}

/** Stripe Checkout for the customer's plan; the caller sends the browser to the returned URL. */
export function useCustomerCheckout() {
  return useMutation({ mutationFn: ({ userId, body }: { userId: string; body: Schemas['ActivationCheckoutRequest'] }) => api.customerCheckout(userId, body) });
}
