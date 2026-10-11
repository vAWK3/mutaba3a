/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, type ReactNode } from 'react';
import { queryOptions } from '@tanstack/react-query';
import { api, type HostedProfile, type Me } from '../api/client';

/**
 * The signed-in person (`GET /v1/me`). Profile figures live under query keys
 * that start with `['p', profileId, …]`, so switching profile can never show
 * another profile's numbers, and sign-out can find and drop them all.
 */

export const ME_KEY = ['me'] as const;
const ME_STALE_MS = 60_000;

export const meQuery = queryOptions({
  queryKey: ME_KEY,
  queryFn: () => api.me(),
  staleTime: ME_STALE_MS,
  retry: false,
});

export function profileKey(profileId: string, ...rest: unknown[]) {
  return ['p', profileId, ...rest] as const;
}

const MeContext = createContext<Me | null>(null);
const ProfileContext = createContext<HostedProfile | null>(null);

export function MeProvider({ me, children }: { me: Me; children: ReactNode }) {
  return <MeContext.Provider value={me}>{children}</MeContext.Provider>;
}

export function ProfileProvider({ profile, children }: { profile: HostedProfile; children: ReactNode }) {
  return <ProfileContext.Provider value={profile}>{children}</ProfileContext.Provider>;
}

/** The signed-in person; only valid under the authenticated routes. */
export function useMe(): Me {
  const me = useContext(MeContext);
  if (!me) throw new Error('useMe must be used under the authenticated routes');
  return me;
}

/** The active hosted profile; only valid under `/p/$profileId`. */
export function useProfile(): HostedProfile {
  const profile = useContext(ProfileContext);
  if (!profile) throw new Error('useProfile must be used under /p/$profileId');
  return profile;
}
