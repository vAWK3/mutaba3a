import { useCallback } from 'react';
import { useActiveProfile } from '../../hooks/useActiveProfile';
import { useT } from '../../lib/i18n';
import type { BusinessProfile } from '../../types';
import './ProfilePickerModal.css';

/**
 * ProfilePickerModal
 *
 * A modal that prompts the user to select a business profile when creating
 * new entities while in "All Profiles" mode. This ensures all new entities
 * are properly scoped to a profile.
 */

interface ProfilePickerModalProps {
  /** Whether the modal is open */
  isOpen: boolean;

  /** Close the modal without selecting */
  onClose: () => void;

  /** Called when a profile is selected */
  onSelectProfile: (profile: BusinessProfile) => void;

  /** Optional title override */
  title?: string;

  /** Optional description override */
  description?: string;
}

export function ProfilePickerModal({
  isOpen,
  onClose,
  onSelectProfile,
  title,
  description,
}: ProfilePickerModalProps) {
  const t = useT();
  const { profiles } = useActiveProfile();

  const handleSelect = useCallback(
    (profile: BusinessProfile) => {
      onSelectProfile(profile);
      onClose();
    },
    [onSelectProfile, onClose]
  );

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) {
        onClose();
      }
    },
    [onClose]
  );

  if (!isOpen) return null;

  return (
    <div className="profile-picker-backdrop" onClick={handleBackdropClick}>
      <div className="profile-picker-modal" role="dialog" aria-modal="true">
        <div className="profile-picker-header">
          <h2 className="profile-picker-title">
            {title || t('profile.select')}
          </h2>
          <p className="profile-picker-description">
            {description || t('profile.selectPrompt')}
          </p>
        </div>

        <div className="profile-picker-list">
          {profiles.map((profile) => (
            <button
              key={profile.id}
              className="profile-picker-option"
              onClick={() => handleSelect(profile)}
            >
              <ProfileAvatar profile={profile} />
              <div className="profile-picker-option-info">
                <span className="profile-picker-option-name">
                  {profile.name}
                </span>
                {profile.nameEn && (
                  <span className="profile-picker-option-secondary">
                    {profile.nameEn}
                  </span>
                )}
              </div>
            </button>
          ))}
        </div>

        <div className="profile-picker-footer">
          <button
            className="btn btn-secondary"
            onClick={onClose}
          >
            {t('common.cancel')}
          </button>
        </div>
      </div>
    </div>
  );
}

function ProfileAvatar({ profile }: { profile: BusinessProfile }) {
  if (profile.logoDataUrl) {
    return (
      <img
        src={profile.logoDataUrl}
        alt=""
        className="profile-picker-avatar"
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
      className="profile-picker-avatar profile-picker-avatar-initials"
      style={{ backgroundColor: profile.primaryColor || 'var(--accent)' }}
    >
      {initials}
    </div>
  );
}
