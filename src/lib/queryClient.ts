import { QueryClient } from '@tanstack/react-query';

const STALE_MS = 60_000;
const GC_MS = 5 * 60_000;

/**
 * The app's query client. Its queries and mutations read and write IndexedDB,
 * so they run whether the device is online or not ('always'); TanStack's
 * default ('online') pauses every read and save while offline. A query that
 * really goes to the network (the live FX rate) opts back into 'online'.
 */
export function createAppQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { staleTime: STALE_MS, gcTime: GC_MS, networkMode: 'always' },
      mutations: { networkMode: 'always' },
    },
  });
}
