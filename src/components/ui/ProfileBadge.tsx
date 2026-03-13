import type { BusinessProfile } from '../../types';
import './ProfileBadge.css';

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
}

export function ProfileBadge({
  profile,
  size = 'sm',
  showTooltip = true,
  className = '',
}: ProfileBadgeProps) {
  // Generate initial from name
  const initial = profile.name.charAt(0).toUpperCase();

  return (
    <span
      className={`profile-badge profile-badge-${size} ${className}`}
      style={{ backgroundColor: profile.primaryColor || 'var(--accent)' }}
      title={showTooltip ? profile.name : undefined}
      aria-label={profile.name}
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
      />
      {showName && (
        <span className="profile-badge-name">{profile.name}</span>
      )}
    </span>
  );
}
