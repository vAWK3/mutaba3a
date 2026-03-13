import { useT } from '../../lib/i18n';
import type { BusinessProfile } from '../../types';
import './ProfileContextChip.css';

/**
 * ProfileContextChip
 *
 * Compact readonly profile indicator shown in drawer headers.
 * Displays the profile name with optional "change" link.
 *
 * Design principle: Profile is context, not a form field.
 */

interface ProfileContextChipProps {
  /** The profile to display */
  profile: BusinessProfile;
  /** Optional callback when "change" is clicked */
  onChangeClick?: () => void;
  /** Whether to show the "change" link */
  showChangeLink?: boolean;
}

export function ProfileContextChip({
  profile,
  onChangeClick,
  showChangeLink = false,
}: ProfileContextChipProps) {
  const t = useT();

  return (
    <div className="profile-context-chip">
      <ProfileAvatar profile={profile} />
      <span className="profile-context-chip-name">{profile.name}</span>
      {showChangeLink && onChangeClick && (
        <button
          type="button"
          className="profile-context-chip-change"
          onClick={onChangeClick}
        >
          {t('profile.change')}
        </button>
      )}
    </div>
  );
}

function ProfileAvatar({ profile }: { profile: BusinessProfile }) {
  if (profile.logoDataUrl) {
    return (
      <img
        src={profile.logoDataUrl}
        alt=""
        className="profile-context-chip-avatar"
      />
    );
  }

  // Generate initials from name
  const initials = profile.name
    .split(' ')
    .map((word) => word[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <div
      className="profile-context-chip-avatar profile-context-chip-avatar-initials"
      style={{ backgroundColor: profile.primaryColor || 'var(--accent)' }}
    >
      {initials}
    </div>
  );
}
