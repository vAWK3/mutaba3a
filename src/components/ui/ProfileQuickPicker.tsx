import { useEffect, useRef, useCallback } from 'react';
import { useT } from '../../lib/i18n';
import type { BusinessProfile } from '../../types';
import type { ProfileQuickPickerProps } from '../../hooks/useProfileAwareAction';
import './ProfileQuickPicker.css';

/**
 * ProfileQuickPicker
 *
 * A tiny, fast popover for selecting a profile before an action.
 * Designed to feel like choosing a destination, not filling a form.
 *
 * - Single click selects and continues
 * - No confirm button needed
 * - Escape or click-away cancels
 */
export function ProfileQuickPicker({
  anchor,
  profiles,
  onSelect,
  onClose,
}: ProfileQuickPickerProps) {
  const t = useT();
  const popoverRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!anchor) return;

    const currentAnchor = anchor;  // Capture for closure

    function handleClickOutside(e: MouseEvent) {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node) &&
        !currentAnchor.contains(e.target as Node)
      ) {
        onClose();
      }
    }

    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onClose();
        currentAnchor.focus();
      }
    }

    // Delay to avoid immediate close from the triggering click
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleEscape);
    }, 0);

    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [anchor, onClose]);

  // Position popover near anchor
  const getPosition = useCallback(() => {
    if (!anchor) return { top: 0, left: 0 };
    const rect = anchor.getBoundingClientRect();
    return {
      top: rect.bottom + 4,
      left: rect.left,
    };
  }, [anchor]);

  if (!anchor) return null;

  const position = getPosition();

  return (
    <div
      ref={popoverRef}
      className="profile-quick-picker"
      style={{
        position: 'fixed',
        top: position.top,
        left: position.left,
      }}
      role="listbox"
      aria-label={t('profile.choose')}
    >
      <div className="profile-quick-picker-header">
        {t('profile.choose')}
      </div>
      <div className="profile-quick-picker-list">
        {profiles.map((profile) => (
          <button
            key={profile.id}
            type="button"
            className="profile-quick-picker-option"
            role="option"
            onClick={() => onSelect(profile)}
          >
            <ProfileAvatar profile={profile} size="small" />
            <span className="profile-quick-picker-name">{profile.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

interface ProfileAvatarProps {
  profile: BusinessProfile;
  size?: 'small' | 'medium';
}

function ProfileAvatar({ profile, size = 'medium' }: ProfileAvatarProps) {
  const sizeClass = size === 'small' ? 'avatar-small' : 'avatar-medium';

  if (profile.logoDataUrl) {
    return (
      <img
        src={profile.logoDataUrl}
        alt=""
        className={`profile-quick-picker-avatar ${sizeClass}`}
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
      className={`profile-quick-picker-avatar profile-quick-picker-avatar-initials ${sizeClass}`}
      style={{ backgroundColor: profile.primaryColor || 'var(--accent)' }}
    >
      {initials}
    </div>
  );
}
