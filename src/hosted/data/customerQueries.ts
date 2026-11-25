import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, api, type Customer, type UpdateCustomerRequest } from '../api/client';
import { profileKey } from '../session/me';
import { useAttemptKey } from './attemptKey';

/**
 * Adding a client from the client picker (MUT-286), beside incomeQueries.ts.
 * The Idempotency-Key follows the attempt (data/attemptKey.ts): picking Add
 * for the same name again after a lost response replays the first create
 * instead of adding the client twice. On success the picker's directory and
 * the Clients summaries refetch from the server; nothing is placed in the
 * cache ahead of it.
 */
export function useCreateCustomer(profileId: string) {
  const queryClient = useQueryClient();
  const attempt = useAttemptKey();
  return useMutation({
    mutationFn: (name: string): Promise<Customer> => {
      const body = { name };
      return api.createCustomer(profileId, body, attempt.keyFor(body));
    },
    onSuccess: () => {
      attempt.succeeded();
      void queryClient.invalidateQueries({ queryKey: profileKey(profileId, 'directory', 'customers') });
      void queryClient.invalidateQueries({ queryKey: profileKey(profileId, 'summary') });
    },
  });
}

/**
 * MUT-642: save a client's VAT or company number and address. The PATCH
 * carries the version read (If-Match); on success the client and its
 * directory refetch.
 */
export function useUpdateCustomer(profileId: string, customerId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ version, body }: { version: number; body: UpdateCustomerRequest }): Promise<Customer> =>
      api.updateCustomer(profileId, customerId, version, body),
    onSuccess: (saved) => {
      queryClient.setQueryData(profileKey(profileId, 'customer', customerId), saved);
      void queryClient.invalidateQueries({ queryKey: profileKey(profileId, 'directory', 'customers') });
      void queryClient.invalidateQueries({ queryKey: profileKey(profileId, 'summary') });
      // MUT-660: a documents preference changes what is due.
      void queryClient.invalidateQueries({ queryKey: profileKey(profileId, 'documents-due') });
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status === 409) void queryClient.invalidateQueries({ queryKey: profileKey(profileId, 'customer', customerId) });
    },
  });
}

/** MUT-642: the digits of a complete Israeli number, or null while it is incomplete. */
export function completeNumber(raw: string): string | null {
  const digits = raw.replace(/[\s-]/g, '');
  return /^\d{9}$/.test(digits) ? digits : null;
}

/**
 * MUT-642: the registry entry for a complete 9-digit number, or nothing while
 * the number is incomplete. Asked once per number (the server caches a day);
 * a miss or an outage is not retried.
 */
export function useBusinessLookup(profileId: string, number: string | null) {
  return useQuery({
    queryKey: profileKey(profileId, 'business-lookup', number ?? ''),
    queryFn: () => api.businessLookup(profileId, number ?? ''),
    enabled: number !== null,
    staleTime: Infinity,
    retry: false,
  });
}
