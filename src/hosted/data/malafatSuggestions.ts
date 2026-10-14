import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, type HostedProfile, type MalafatSuggestions, type MalafatSuggestionsChange, type Me } from '../api/client';
import { ME_KEY, useMe } from '../session/me';
import type { MalafatMoment } from '../../types';

/**
 * Who the portal may suggest Malafat to (MUT-191, ADR-078): a profile the
 * person owns as a business, fed by nobody. Firms are Malafat's own tenants
 * (connected, or not yet), and personal profiles are never a firm.
 */
export function portalMalafatEligible(profile: HostedProfile | null): boolean {
  return !!profile && profile.owned && profile.type === 'BUSINESS' && !profile.isPersonalDefault && profile.writerOfRecord === null;
}

/** Someone who belongs to a Malafat-fed firm already uses Malafat: no suggestion anywhere. */
export function isMalafatCustomer(me: Me): boolean {
  return me.profiles.some((profile) => profile.writerOfRecord === 'MALAFAT');
}

/** The person's own business profiles (C3 asks for a second one). */
export function businessProfileCount(me: Me): number {
  return me.profiles.filter((profile) => profile.owned && profile.type === 'BUSINESS' && !profile.isPersonalDefault).length;
}

/** What retiring a moment sends: the business-created note and the second-business card are one event. */
export function retireChange(moment: MalafatMoment): MalafatSuggestionsChange {
  return moment === 'client-threshold' ? { dismiss: ['client-threshold'] } : { dismiss: ['business-profile', 'second-business'] };
}

export interface PortalMalafatState {
  on: boolean;
  dismissed: MalafatMoment[];
  /** Suggestions may show at all for this person (not a Malafat customer). */
  allowed: boolean;
}

/** The account's preferences, read from /v1/me. */
export function usePortalMalafat(): PortalMalafatState {
  const me = useMe();
  const stored = me.user.malafatSuggestions;
  return { on: !stored.off, dismissed: stored.dismissed, allowed: !isMalafatCustomer(me) };
}

/** Send one change; the answer is written into the cached /v1/me, so every suggestion re-reads it. */
export function useChangeMalafatSuggestions() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (change: MalafatSuggestionsChange) => api.changeMalafatSuggestions(change),
    onSuccess: (stored: MalafatSuggestions) => {
      queryClient.setQueryData<Me>(ME_KEY, (current) => (current ? { ...current, user: { ...current.user, malafatSuggestions: stored } } : current));
    },
  });
}
