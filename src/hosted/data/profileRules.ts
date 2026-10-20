import type { HostedProfile, Me, ProfileType, UpdateProfileRequest } from '../api/client';
import type { HostedCurrency } from '../format/currencies';

/**
 * What the portal may offer for a profile (MUT-183). Pure, so every rule is
 * unit-tested without the UI. Ownership is the writability gate (MUT-182: an
 * owned profile is the user's own, whatever its type); the built-in Personal
 * profile is always PERSONAL (MUT-182 D2, server 409 DEFAULT_PERSONAL_PROFILE).
 */

/** Below the server's cap. The cap comes from `/v1/me`, never a constant here. */
export function canCreateProfile(me: Me): boolean {
  return me.limits.ownedProfiles < me.limits.maxOwnedProfiles;
}

/** OPERATOR: set up for the user by an operator (MUT-300 D5: "firm" now means firm features are on, owned or not). */
export type ProfileEditability = { editable: false; reason: 'MALAFAT' | 'OPERATOR' } | { editable: true; typeLocked: boolean };

export function profileEditability(profile: HostedProfile): ProfileEditability {
  if (!profile.owned) return { editable: false, reason: profile.writerOfRecord === 'MALAFAT' ? 'MALAFAT' : 'OPERATOR' };
  return { editable: true, typeLocked: profile.isPersonalDefault };
}

export type FirmRequestState = 'hidden' | 'offer' | 'requested';

/**
 * MUT-300: what the edit pane shows about firm features. Only the owner of a
 * Business profile (not the built-in one) may ask; once firm features are on
 * there is nothing to ask for. A server older than 1.41.0-mut300 sends no
 * `firm` and has no route to take the request, so nothing shows.
 */
export function firmRequestState(profile: HostedProfile): FirmRequestState {
  if (profile.firm !== false) return 'hidden';
  if (!profile.owned || profile.isPersonalDefault || profile.type !== 'BUSINESS') return 'hidden';
  return profile.firmRequestedAt ? 'requested' : 'offer';
}

/**
 * The line under a profile's name, in the switcher and the Manage list alike
 * (plan §2.2, design review Issue 4). An owned profile takes income since
 * MUT-182, so only an operator firm still reads "Expenses only".
 */
export function profileKindKey(profile: HostedProfile): string {
  if (profile.writerOfRecord === 'MALAFAT') return 'hosted.shell.switcher.sourceMalafat';
  if (!profile.owned) return 'hosted.shell.switcher.sourceExpensesOnly';
  if (profile.isPersonalDefault) return 'hosted.profiles.kind.builtIn';
  return profile.type === 'BUSINESS' ? 'hosted.profiles.kind.business' : 'hosted.profiles.kind.personal';
}

export interface ProfileEditValues {
  name: string;
  defaultCurrency: HostedCurrency;
  type: ProfileType;
}

/** The PATCH body: only what changed. Never a type for the built-in Personal profile. */
export function changedFields(profile: HostedProfile, values: ProfileEditValues): UpdateProfileRequest {
  const patch: UpdateProfileRequest = {};
  const name = values.name.trim();
  if (name !== profile.name) patch.name = name;
  if (values.defaultCurrency !== profile.defaultCurrency) patch.defaultCurrency = values.defaultCurrency;
  if (!profile.isPersonalDefault && values.type !== profile.type) patch.type = values.type;
  return patch;
}
