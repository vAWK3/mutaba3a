import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, api, type HostedProfile, type IssuerDefaultsRequest, type IssuerDetails, type IssuerDetailsRequest, type IssuingNumberingRequest, type IssuingSetup, type Me } from '../api/client';
import { profileKey, useMeOrNull } from '../session/me';
import { useIsLocalMode } from '../session/mode';

/**
 * MUT-646: the invoicing setup's data. The setup answer is the source of truth for progress: every step's save
 * refetches it (AC2), and the server's own gate (409 ISSUING_SETUP_INCOMPLETE) decides whether anything can be issued.
 * A 404 means issuing is off for this profile (the owner's feature, or signed out): the page and its entry hide.
 */
const notFound = (error: unknown) => error instanceof ApiError && error.status === 404;
const noRetryOn404 = (count: number, error: unknown) => !notFound(error) && count < 2;

export const setupKey = (profileId: string) => profileKey(profileId, 'issuing', 'setup');
const issuerKey = (profileId: string) => profileKey(profileId, 'issuing', 'issuer');
const logoKey = (profileId: string) => profileKey(profileId, 'issuing', 'logo');
const countersKey = (profileId: string) => profileKey(profileId, 'issuing', 'counters');

type InvoicingProfile = Pick<HostedProfile, 'type' | 'owned' | 'owners' | 'writerOfRecord' | 'managedInMalafat'>;

/**
 * Whether asking the server about issuing on this profile (the setup, the issuer, documents due) can answer anything
 * but 404. The server's rule (issuingProfileOf) is the profile creator's `invoicing` feature, never on a personal
 * profile or one Malafat writes. Where the person created the profile, their own features already say it, so nothing is
 * asked; where someone else did (a co-owner, an accountant), only the server knows, so it is asked.
 */
export function invoicingWorthAsking(profile: InvoicingProfile | null, me: Pick<Me, 'user'> | null, local: boolean): boolean {
  if (local || !profile || !me) return false;
  if (profile.type === 'PERSONAL' || profile.writerOfRecord === 'MALAFAT' || profile.managedInMalafat) return false;
  const creator = profile.owners?.find((owner) => owner.creator)?.userId;
  const created = profile.owned && (creator === undefined || creator === me.user.id);
  return created ? me.user.features.includes('invoicing') : true;
}

/** `invoicingWorthAsking` for the signed-in person, on this device's mode. */
export function useInvoicingWorthAsking(profile: InvoicingProfile | null): boolean {
  return invoicingWorthAsking(profile, useMeOrNull(), useIsLocalMode());
}

export function useIssuingSetup(profileId: string, enabled = true) {
  return useQuery({ queryKey: setupKey(profileId), queryFn: ({ signal }) => api.issuingSetup(profileId, signal), retry: noRetryOn404, enabled });
}

/** The details, or null before the first save (the server answers 404 ISSUER_DETAILS_REQUIRED). */
export function useIssuer(profileId: string, enabled = true) {
  return useQuery({
    enabled,
    queryKey: issuerKey(profileId),
    queryFn: async ({ signal }): Promise<IssuerDetails | null> => {
      try {
        return await api.issuer(profileId, signal);
      } catch (error) {
        if (notFound(error)) return null;
        throw error;
      }
    },
  });
}

export function useIssuingCounters(profileId: string) {
  return useQuery({ queryKey: countersKey(profileId), queryFn: ({ signal }) => api.issuingSettings(profileId, signal) });
}

/** A file as a data URL: at most 256 KB, and nothing to revoke when the page closes. */
export const dataUrlOf = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

/** The current logo for the letterhead, or null. */
export function useIssuerLogoUrl(profileId: string, hasLogo: boolean): string | null {
  const query = useQuery({
    queryKey: logoKey(profileId),
    queryFn: async ({ signal }) => {
      try {
        return await dataUrlOf(await api.issuerLogo(profileId, signal));
      } catch (error) {
        if (notFound(error)) return null;
        throw error;
      }
    },
    enabled: hasLogo,
    staleTime: Infinity,
  });
  return hasLogo ? (query.data ?? null) : null;
}

function useRefresh(profileId: string) {
  const queryClient = useQueryClient();
  return (setup?: IssuingSetup) => {
    if (setup) queryClient.setQueryData(setupKey(profileId), setup);
    else void queryClient.invalidateQueries({ queryKey: setupKey(profileId) });
  };
}

/** Step 1. A 409 (someone saved in between) reloads the details so the next save carries their version. */
export function useSaveIssuer(profileId: string) {
  const queryClient = useQueryClient();
  const refresh = useRefresh(profileId);
  return useMutation({
    mutationFn: ({ version, body }: { version: number | null; body: IssuerDetailsRequest }) => api.saveIssuer(profileId, version, body),
    onSuccess: (issuer) => {
      queryClient.setQueryData(issuerKey(profileId), issuer);
      refresh();
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status === 409) void queryClient.invalidateQueries({ queryKey: issuerKey(profileId) });
    },
  });
}

/** Step 3. */
export function useSaveIssuerDefaults(profileId: string) {
  const queryClient = useQueryClient();
  const refresh = useRefresh(profileId);
  return useMutation({
    mutationFn: ({ version, body }: { version: number; body: IssuerDefaultsRequest }) => api.saveIssuerDefaults(profileId, version, body),
    onSuccess: (issuer) => {
      queryClient.setQueryData(issuerKey(profileId), issuer);
      refresh();
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status === 409) void queryClient.invalidateQueries({ queryKey: issuerKey(profileId) });
    },
  });
}

/** Step 2: a new logo, or none. */
export function useSaveIssuerLogo(profileId: string) {
  const queryClient = useQueryClient();
  const refresh = useRefresh(profileId);
  return useMutation({
    mutationFn: async (file: Blob | null) => {
      if (!file) return void (await api.removeIssuerLogo(profileId));
      await api.saveIssuerLogo(profileId, file);
      queryClient.setQueryData(logoKey(profileId), await dataUrlOf(file));
    },
    onSuccess: () => refresh(),
  });
}

/** Step 4. */
export function useAnswerNumbering(profileId: string) {
  const queryClient = useQueryClient();
  const refresh = useRefresh(profileId);
  return useMutation({
    mutationFn: (body: IssuingNumberingRequest) => api.answerNumbering(profileId, body),
    onSuccess: (setup) => {
      refresh(setup);
      void queryClient.invalidateQueries({ queryKey: countersKey(profileId) });
    },
  });
}

export function useIntroSeen(profileId: string) {
  const refresh = useRefresh(profileId);
  return useMutation({ mutationFn: () => api.issuingIntroSeen(profileId), onSuccess: (setup) => refresh(setup) });
}
