import { queryOptions, useQuery } from '@tanstack/react-query';
import { api, type SelfServiceDoors } from '../api/client';

/**
 * Which self-service doors this server opens (MUT-368, D1): GET /v1/self-service, asked once per page load. A failure
 * reads as both closed, so an outage never shows a door that can only fail; /signup and /recover show their own
 * "can't reach" with a retry instead.
 */
export const SELF_SERVICE_KEY = ['self-service-doors'] as const;
export const CLOSED_DOORS: SelfServiceDoors = { signup: false, recovery: false };

export const selfServiceQuery = queryOptions({
  queryKey: SELF_SERVICE_KEY,
  queryFn: ({ signal }) => api.selfService(signal),
  staleTime: Infinity,
  gcTime: Infinity,
  retry: false,
  refetchOnWindowFocus: false,
});

/** The doors, closed until the server says otherwise. */
export function useSelfServiceDoors(): SelfServiceDoors {
  return useQuery(selfServiceQuery).data ?? CLOSED_DOORS;
}
