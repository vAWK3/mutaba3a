import { useState, useRef, useEffect } from 'react';
import { Link } from '@tanstack/react-router';
import { useBusinessProfiles, useDefaultBusinessProfile, useSetDefaultBusinessProfile } from '../../hooks/useQueries';
import { useDrawerStore } from '../../lib/stores';
import { useT } from '../../lib/i18n';
import type { BusinessProfile } from '../../types';
import './ProfileSwitcher.css';

export function ProfileSwitcher() {
  const t = useT();
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const { data: profiles = [], isLoading: profilesLoading } = useBusinessProfiles();
  const { data: defaultProfile, isLoading: defaultLoading } = useDefaultBusinessProfile();
  const setDefaultMutation = useSetDefaultBusinessProfile();
  const { openBusinessProfileDrawer } = useDrawerStore();

  const isLoading = profilesLoading || defaultLoading;

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  // Close dropdown on Escape key
  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
    }

    return () => {
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen]);

  const handleSwitchProfile = (profileId: string) => {
    setDefaultMutation.mutate(profileId);
    setIsOpen(false);
  };

  const handleAddProfile = () => {
    openBusinessProfileDrawer({ mode: 'create' });
    setIsOpen(false);
  };

  if (isLoading) {
    return (
      <div className="profile-switcher profile-switcher-loading">
        <div className="profile-switcher-skeleton" />
      </div>
    );
  }

  // Empty state - no profiles
  if (profiles.length === 0) {
    return (
      <button
        className="profile-switcher profile-switcher-empty"
        onClick={handleAddProfile}
      >
        <div className="profile-switcher-avatar profile-switcher-avatar-empty">
          <PlusIcon />
        </div>
        <span className="profile-switcher-name">{t('profileSwitcher.setUpBusiness')}</span>
      </button>
    );
  }

  const currentProfile = defaultProfile || profiles[0];

  return (
    <div className="profile-switcher-container" ref={containerRef}>
      <button
        className="profile-switcher"
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
      >
        <ProfileAvatar profile={currentProfile} />
        <span className="profile-switcher-name">
          {currentProfile.name}
        </span>
        <ChevronIcon className={isOpen ? 'rotated' : ''} />
      </button>

      {isOpen && (
        <div className="profile-switcher-dropdown" role="listbox">
          <div className="profile-switcher-list">
            {profiles.map((profile) => (
              <button
                key={profile.id}
                className={`profile-switcher-option ${profile.id === currentProfile.id ? 'active' : ''}`}
                onClick={() => handleSwitchProfile(profile.id)}
                role="option"
                aria-selected={profile.id === currentProfile.id}
              >
                <ProfileAvatar profile={profile} size="small" />
                <span className="profile-switcher-option-name">
                  {profile.name}
                  {profile.nameEn && (
                    <span className="profile-switcher-option-name-en">
                      {profile.nameEn}
                    </span>
                  )}
                </span>
                {profile.id === currentProfile.id && (
                  <CheckIcon className="profile-switcher-check" />
                )}
              </button>
            ))}
          </div>

          <div className="profile-switcher-divider" />

          <button
            className="profile-switcher-action"
            onClick={handleAddProfile}
          >
            <PlusIcon />
            {t('profileSwitcher.addProfile')}
          </button>

          <Link
            to="/settings"
            className="profile-switcher-action"
            onClick={() => setIsOpen(false)}
          >
            <SettingsIcon />
            {t('profileSwitcher.manageProfiles')}
          </Link>
        </div>
      )}
    </div>
  );
}

function ProfileAvatar({ profile, size = 'medium' }: { profile: BusinessProfile; size?: 'small' | 'medium' }) {
  const sizeClass = size === 'small' ? 'profile-switcher-avatar-sm' : '';

  if (profile.logoDataUrl) {
    return (
      <img
        src={profile.logoDataUrl}
        alt=""
        className={`profile-switcher-avatar ${sizeClass}`}
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
      className={`profile-switcher-avatar profile-switcher-avatar-initials ${sizeClass}`}
      style={{ backgroundColor: profile.primaryColor || 'var(--color-accent)' }}
    >
      {initials}
    </div>
  );
}

function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg
      className={`profile-switcher-chevron ${className || ''}`}
      width="16"
      height="16"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
    </svg>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="16"
      height="16"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z"
      />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
    </svg>
  );
}
