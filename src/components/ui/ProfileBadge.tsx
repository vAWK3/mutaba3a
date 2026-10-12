import type { BusinessProfile } from '../../types';
import './ProfileBadge.css';
import { profileAvatarStyle } from './profileAvatarStyle';

/**
 * ProfileBadge Component
 *
 * A small badge showing a profile's initial and color.
 * Used in table rows when viewing "All Profiles" mode to indicate
 * which profile each item belongs to.
 */

interface ProfileBadgeProps {
  /** The business profile to display */
  profile: BusinessProfile;

  /** Size variant */
  size?: 'sm' | 'md';

  /** Show tooltip with full name on hover */
  showTooltip?: boolean;

  /** Additional CSS class */
  className?: string;

  /** The name is shown beside it: hide the badge from assistive tech so the name is read once */
  decorative?: boolean;
}

export function ProfileBadge({
  profile,
  size = 'sm',
  showTooltip = true,
  className = '',
  decorative = false,
}: ProfileBadgeProps) {
  // Generate initial from name
  const initial = profile.name.charAt(0).toUpperCase();

  return (
    <span
      className={`profile-badge profile-badge-${size} ${className}`}
      style={profileAvatarStyle(profile.primaryColor)}
      title={showTooltip ? profile.name : undefined}
      aria-label={decorative ? undefined : profile.name}
      aria-hidden={decorative || undefined}
    >
      {initial}
    </span>
  );
}

interface ProfileBadgeWithNameProps extends ProfileBadgeProps {
  /** Show the profile name next to the badge */
  showName?: boolean;
}

/**
 * ProfileBadge with optional name display
 */
export function ProfileBadgeWithName({
  profile,
  size = 'sm',
  showName = true,
  showTooltip = false,
  className = '',
}: ProfileBadgeWithNameProps) {
  return (
    <span className={`profile-badge-with-name ${className}`}>
      <ProfileBadge
        profile={profile}
        size={size}
        showTooltip={showTooltip && !showName}
        decorative={showName}
      />
      {showName && (
        <bdi className="profile-badge-name" title={profile.name}>{profile.name}</bdi>
      )}
    </span>
  );
}

interface BusinessTagsProps {
  /** The businesses to name, in order; unknown or missing ids are skipped */
  profileIds: readonly (string | undefined)[];
  /** The live businesses by id */
  profilesById: ReadonlyMap<string, BusinessProfile>;
  className?: string;
}

/**
 * The business tags of a row under "All businesses" (MUT-89, O5): one
 * colour-and-name tag per business, so a client shared across businesses
 * shows each. Renders nothing when none of the ids is a live business.
 */
export function BusinessTags({ profileIds, profilesById, className = '' }: BusinessTagsProps) {
  const profiles = profileIds.flatMap((id) => {
    const profile = id ? profilesById.get(id) : undefined;
    return profile ? [profile] : [];
  });
  if (profiles.length === 0) return null;

  return (
    <span className={`business-tags ${className}`}>
      {profiles.map((profile) => (
        <ProfileBadgeWithName key={profile.id} profile={profile} size="sm" />
      ))}
    </span>
  );
}
