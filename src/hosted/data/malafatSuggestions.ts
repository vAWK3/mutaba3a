import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, type HostedProfile, type MalafatSuggestions, type MalafatSuggestionsChange, type Me } from '../api/client';
import { ME_KEY, useMe } from '../session/me';
import { useIsLocalMode } from '../session/mode';
import type { MalafatMoment } from '../../types';
import { createdBy } from './profileRules';

/**
 * Who the portal may suggest Malafat to (MUT-191, ADR-078): a profile the
 * person created as a business, fed by nobody. Firms are Malafat's own tenants
 * (connected, or not yet), and personal profiles are never a firm. MUT-373
 * (OV9): a Business profile they only co-own is its creator's to take to
 * Malafat, so its partners aren't pitched about the same firm twice.
 */
export function portalMalafatEligible(profile: HostedProfile | null, viewerId: string): boolean {
  return !!profile && createdBy(profile, viewerId) && profile.type === 'BUSINESS' && !profile.isPersonalDefault && profile.writerOfRecord === null;
}

/** Someone who belongs to a Malafat-fed firm already uses Malafat: no suggestion anywhere. */
export function isMalafatCustomer(me: Me): boolean {
  return me.profiles.some((profile) => profile.writerOfRecord === 'MALAFAT');
}

/** The business profiles the person created (C3 asks for a second one); one they co-own isn't theirs to count (MUT-373). */
export function businessProfileCount(me: Me): number {
  return me.profiles.filter((profile) => createdBy(profile, me.user.id) && profile.type === 'BUSINESS' && !profile.isPersonalDefault).length;
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

/** The account's preferences, read from /v1/me. Signed out there is no account to hold them: never allowed (MUT-286 AC5). */
export function usePortalMalafat(): PortalMalafatState {
  const me = useMe();
  const local = useIsLocalMode();
  // Resolved here too: a server older than 1.25.0-mut191 sends no field, and the portal may ship first
  const stored: Partial<MalafatSuggestions> | undefined = me.user.malafatSuggestions;
  return { on: stored?.off !== true, dismissed: stored?.dismissed ?? [], allowed: !local && !isMalafatCustomer(me) };
}

/** Send one change; the answer is written into the cached /v1/me, so every suggestion re-reads it. */
export function useChangeMalafatSuggestions() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (change: MalafatSuggestionsChange) => api.changeMalafatSuggestions(change),
    // A /v1/me refetch already in flight (focus, staleness) would land after the answer and undo it
    onMutate: () => queryClient.cancelQueries({ queryKey: ME_KEY }),
    onSuccess: (stored: MalafatSuggestions) => {
      queryClient.setQueryData<Me>(ME_KEY, (current) => (current ? { ...current, user: { ...current.user, malafatSuggestions: stored } } : current));
    },
  });
}
