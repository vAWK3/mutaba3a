import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, api, type IssueDocumentRequest, type IssuedDocType, type IssuedDocument } from '../api/client';
import { profileKey } from '../session/me';
import { setupKey, useIssuer, useIssuingSetup } from './issuingQueries';
import { useMeOrNull } from '../session/me';
import type { HostedProfile } from '../api/client';

/**
 * MUT-570: issued documents in the portal. The server owns every number and total: the drawer shows the preview's
 * totals (D7, nothing written), the issue takes the next number under an Idempotency-Key per attempt, and an issued
 * document is never edited (a credit note corrects a tax invoice). A 404 means issuing is off for the profile.
 */
const notFound = (error: unknown) => error instanceof ApiError && error.status === 404;
const noRetryOn404 = (count: number, error: unknown) => !notFound(error) && count < 2;

export const issuedKey = (profileId: string, ...rest: string[]) => profileKey(profileId, 'issued', ...rest);

export function useIssuedDocuments(profileId: string, filter: { customerId?: string; docType?: IssuedDocType } = {}, enabled = true) {
  return useQuery({
    queryKey: issuedKey(profileId, 'list', filter.customerId ?? '', filter.docType ?? ''),
    queryFn: ({ signal }) => api.issuedDocuments(profileId, filter, signal),
    retry: noRetryOn404,
    enabled,
  });
}

export function useIssuedDocument(profileId: string, documentId: string) {
  return useQuery({
    queryKey: issuedKey(profileId, 'doc', documentId),
    queryFn: ({ signal }) => api.issuedDocument(profileId, documentId, signal),
    retry: noRetryOn404,
  });
}

export function useIssuingStyles(profileId: string) {
  return useQuery({ queryKey: profileKey(profileId, 'issuing', 'styles'), queryFn: ({ signal }) => api.issuingStyles(profileId, signal), staleTime: Infinity });
}

/**
 * The draft's totals, asked again as the draft changes (the caller debounces). Kept on screen while the next answer
 * comes, so the totals never blank; a refusal (422 with a field) is returned for the drawer to show beside the field.
 */
export function useDocumentPreview(profileId: string, body: IssueDocumentRequest | null) {
  return useQuery({
    queryKey: issuedKey(profileId, 'preview', JSON.stringify(body)),
    queryFn: ({ signal }) => api.previewDocument(profileId, body!, signal),
    enabled: body !== null,
    placeholderData: keepPreviousData,
    retry: false,
  });
}

/** Issue. On success everything the document touched refetches: the lists, its Owed or Received, the summaries. */
export function useIssueDocument(profileId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ body, key }: { body: IssueDocumentRequest; key: string }): Promise<IssuedDocument> => api.issueDocument(profileId, body, key),
    onSuccess: (doc) => {
      queryClient.setQueryData(issuedKey(profileId, 'doc', doc.id), doc);
      for (const scope of ['issued', 'receivables', 'receivable', 'payments', 'payment', 'summary', 'directory', 'customer']) void queryClient.invalidateQueries({ queryKey: profileKey(profileId, scope) });
      void queryClient.invalidateQueries({ queryKey: setupKey(profileId) });
    },
  });
}

/** Opens a PDF blob in a new tab (the browser's own viewer), or saves it when the browser won't open one. */
export function openPdf(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/**
 * MUT-648: whether saving income on this profile offers to issue its document. Only where the person holds the
 * `invoicing` feature (so nobody else pays for a request), on a Business profile they own, with the setup done and the
 * business's "Offer to issue after saving" on.
 */
export function useIssueAfterSave(profile: HostedProfile): boolean {
  const me = useMeOrNull();
  const eligible = !!me?.user.features.includes('invoicing') && profile.owned === true && profile.type === 'BUSINESS';
  const setup = useIssuingSetup(profile.id, eligible);
  const issuer = useIssuer(profile.id, eligible && !!setup.data?.canIssue);
  return eligible && !!setup.data?.canIssue && issuer.data?.offerAfterSave === true;
}
