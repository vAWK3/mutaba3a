import { useQueryClient } from '@tanstack/react-query';
import { ME_KEY, meQuery } from './me';

/**
 * Where to go once this device's records were replaced (Your data › Restore,
 * the carry-over): the restored person's first profile, from a fresh /v1/me.
 * `/` would redirect once, from whatever answer AuthGate last rendered, which
 * can still be the old one for a tick, and a redirect doesn't correct itself;
 * the profile page reads /v1/me on every render, so it does. `/` when /v1/me
 * can't be read now.
 */
export function useRestoredHome(): () => Promise<string> {
  const queryClient = useQueryClient();
  return async () => {
    try {
      const me = await queryClient.fetchQuery({ ...meQuery, staleTime: 0 });
      queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== ME_KEY[0] });
      const first = me.profiles[0];
      return first ? `/p/${first.id}` : '/';
    } catch {
      void queryClient.resetQueries();
      return '/';
    }
  };
}
