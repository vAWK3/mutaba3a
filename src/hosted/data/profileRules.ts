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

/**
 * MUT-373 (ADR-163): co-owners. `owners` comes from the server (creator first); every rule below reads it, never
 * the column it came from. A profile you don't own has none, and an older server sends none at all.
 */
type ProfileOwner = NonNullable<HostedProfile['owners']>[number];

/** The other owners' names — never yours — or their email when they have none (DR12); null when nobody shares it. */
export function sharedWith(profile: HostedProfile, viewerId: string): string[] | null {
  const others = (profile.owners ?? []).filter((owner) => owner.userId !== viewerId);
  return others.length > 0 ? others.map(ownerLabel) : null;
}

/** How a person reads in the Owners list and the shared cue: their name, else their email (DR10). */
export function ownerLabel(owner: ProfileOwner): string {
  return owner.name ?? owner.email;
}

/** More than one owner: such a profile stays Business (server 409 CO_OWNED). */
export function isShared(profile: HostedProfile): boolean {
  return (profile.owners?.length ?? 0) > 1;
}

/**
 * Whether the viewer created the profile. An older server sends no `owners`: an owned profile was then always the
 * viewer's own creation, as before MUT-373.
 */
export function createdBy(profile: HostedProfile, viewerId: string): boolean {
  if (!profile.owned) return false;
  return profile.owners ? profile.owners.some((owner) => owner.creator && owner.userId === viewerId) : true;
}

/** The creator removes co-owners; a co-owner leaves; the creator never leaves (eng review D3). */
export function ownerActions(profile: HostedProfile, viewerId: string): { canRemove: boolean; canLeave: boolean } {
  if (!profile.owned) return { canRemove: false, canLeave: false };
  const creator = createdBy(profile, viewerId);
  return { canRemove: creator, canLeave: !creator };
}

/** The Owners section belongs to owned Business profiles (AD5): never the built-in one, an owned Personal one or a firm. */
export function ownersSectionVisible(profile: HostedProfile): boolean {
  return profile.owned && profile.type === 'BUSINESS' && !profile.isPersonalDefault;
}

/** The cap hint (DR2): only for someone who co-owns a profile they didn't create, which their count leaves out. */
export function coOwnsOthersProfiles(me: Me): boolean {
  return me.profiles.some((profile) => profile.owned && !createdBy(profile, me.user.id));
}
