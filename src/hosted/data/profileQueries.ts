import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { api, type CreateProfileRequest, type HostedProfile, type Me, type ProfileType, type UpdateProfileRequest } from '../api/client';
import { ME_KEY, profileKey } from '../session/me';
import { createAttemptKey, type AttemptKey } from './attemptKey';

/**
 * The profile writes (MUT-183, MUT-182 API). Profiles live in `/v1/me`, so
 * every write updates that cache directly from the server's answer and then
 * re-reads it in the background: a failed re-read can never strand the user
 * on "This profile isn't available" right after a create (eng review R2).
 */

/**
 * One create attempt per tab, not per drawer mount (eng review R6). The drawer
 * is URL-driven, so Back or Cancel can unmount it while a slow POST is still in
 * flight; reopening and saving the same profile must replay that POST, not mint
 * a new key and create a twin that permanently uses one of the capped slots.
 * A changed body or a success starts a new attempt; a page reload starts fresh.
 */
const createAttempt = createAttemptKey();

export function useProfileCreateAttempt(): AttemptKey {
  return createAttempt;
}

/** `me` with `profile` added; a replayed 201 (same id) changes nothing. */
export function withProfileAdded(me: Me | undefined, profile: HostedProfile): Me | undefined {
  if (!me || me.profiles.some((p) => p.id === profile.id)) return me;
  return {
    ...me,
    profiles: [...me.profiles, profile],
    limits: { ...me.limits, ownedProfiles: me.limits.ownedProfiles + (profile.owned ? 1 : 0) },
  };
}

/** `me` with `profile` replaced in place (a PATCH answer). */
export function withProfileReplaced(me: Me | undefined, profile: HostedProfile): Me | undefined {
  if (!me) return me;
  return { ...me, profiles: me.profiles.map((p) => (p.id === profile.id ? profile : p)) };
}

function refreshMe(queryClient: QueryClient) {
  void queryClient.invalidateQueries({ queryKey: ME_KEY });
}

export function useCreateProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ body, idempotencyKey }: { body: CreateProfileRequest; idempotencyKey: string }) => api.createProfile(body, idempotencyKey),
    onSuccess: (profile) => {
      queryClient.setQueryData<Me>(ME_KEY, (me) => withProfileAdded(me, profile));
      refreshMe(queryClient);
    },
  });
}

export function useUpdateProfile(profileId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ body, version }: { body: UpdateProfileRequest; version: number }) => api.updateProfile(profileId, body, version),
    onSuccess: (result) => {
      queryClient.setQueryData<Me>(ME_KEY, (me) => withProfileReplaced(me, result.profile));
      // A type change replaced the categories and uncategorized expenses: every figure under the profile may differ.
      if (result.typeChange) void queryClient.invalidateQueries({ queryKey: profileKey(profileId) });
      refreshMe(queryClient);
    },
  });
}

/** The server's count for a type change, read fresh at the moment of asking (plan §2.5). */
export function fetchTypeChangePreview(queryClient: QueryClient, profileId: string, to: ProfileType) {
  return queryClient.fetchQuery({
    queryKey: ['profile-type-change', profileId, to],
    queryFn: () => api.profileTypeChangePreview(profileId, to),
    staleTime: 0,
  });
}
