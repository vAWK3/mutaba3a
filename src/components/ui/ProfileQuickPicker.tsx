import { useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { useT } from '../../lib/i18n';
import type { BusinessProfile } from '../../types';
import type { ProfileQuickPickerProps } from '../../hooks/useProfileAwareAction';
import { nudgeInside } from '../layout/popoverPosition';
import './ProfileQuickPicker.css';

/** Gap kept between the picker and the window's edges */
const EDGE_MARGIN = 8;

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
  anchorRect,
  returnFocus,
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

    // Focus goes back to the menu button: the item that asked has usually
    // left the page with its menu (MUT-89)
    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onClose();
        (returnFocus ?? (currentAnchor.isConnected ? currentAnchor : null))?.focus();
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
  }, [anchor, returnFocus, onClose]);

  // Before paint: keep the picker inside the window. The top bar's Add menu
  // sits at the inline end, where a picker aligned to its item would run past
  // the edge (MUT-89, the first time this picker can open)
  // Focus moves into the picker, so a keyboard user lands on the choice
  useLayoutEffect(() => {
    const popover = popoverRef.current;
    if (!anchor || !popover) return;
    const dx = nudgeInside(popover.getBoundingClientRect(), { left: 0, right: window.innerWidth }, EDGE_MARGIN);
    popover.style.translate = dx === 0 ? '' : `${dx}px 0`;
    popover.querySelector<HTMLElement>('[role="option"]')?.focus();
  }, [anchor]);

  // Placed from where the item was when the picker opened: the item itself
  // has usually left the page, and measuring it again would give zeros
  const getPosition = useCallback(() => {
    const rect = anchorRect ?? anchor?.getBoundingClientRect();
    if (!rect) return { top: 0, left: 0 };
    return {
      top: rect.bottom + 4,
      left: rect.left,
    };
  }, [anchor, anchorRect]);

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
