import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, api, type ExternalEntryKind, type ExternalInvoice } from '../api/client';
import { profileKey } from '../session/me';

/**
 * MUT-647: invoices issued elsewhere on the Owed and Received lists. One request per page of rows on screen; a 404
 * (issuing off for the profile) means the lists show nothing new.
 */
const scope = (profileId: string) => profileKey(profileId, 'external-invoices');

export function useExternalInvoices(profileId: string, entryKind: ExternalEntryKind, entryIds: readonly string[], enabled: boolean) {
  const ids = [...entryIds].sort();
  return useQuery({
    queryKey: [...scope(profileId), entryKind, ids.join(',')],
    queryFn: async ({ signal }) => {
      const page = await api.externalInvoices(profileId, entryKind, ids, signal);
      return new Map<string, ExternalInvoice>(page.items.map((x) => [x.entryId, x]));
    },
    enabled: enabled && ids.length > 0,
    retry: (count, error) => !(error instanceof ApiError && error.status === 404) && count < 2,
  });
}

export function useAttachExternalInvoice(profileId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ query, file }: { query: Parameters<typeof api.attachExternalInvoice>[1]; file: Blob }) => api.attachExternalInvoice(profileId, query, file),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: scope(profileId) }),
  });
}

export function useRemoveExternalInvoice(profileId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.removeExternalInvoice(profileId, id),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: scope(profileId) }),
  });
}

/** The person's typed date as YYYY-MM-DD, from YYYY-MM-DD or DD/MM/YYYY; null otherwise. */
export function isoDateOf(raw: string): string | null {
  const s = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = /^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/.exec(s);
  return m ? `${m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}` : null;
}
