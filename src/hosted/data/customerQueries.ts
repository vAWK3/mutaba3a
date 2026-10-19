import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, type Customer } from '../api/client';
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
