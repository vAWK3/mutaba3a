import { useLocation, useNavigate } from '@tanstack/react-router';
import { useT } from '../../lib/i18n/core';
import { useTp } from '../../lib/i18n/plural';
import type { HostedProfile } from '../api/client';
import { atProfileCap, canCreateProfile } from '../data/profileRules';
import { useProfileKind } from '../data/useProfileKind';
import { useMe } from '../session/me';
import { useIsLocalMode } from '../session/mode';
import { useProfileDrawers } from './ProfileDrawers';
import { usePopover } from './usePopover';

/**
 * The profile switcher (hosted-portal.md §7.2): each hosted profile with its
 * "Hosted" chip and what kind it is, then New profile and Manage profiles
 * (MUT-183), and a footer that says local profiles stay on the device.
 * Switching keeps the section, never the record: a client id from one firm
 * means nothing in another. At the cap, New profile stays focusable and says
 * why it does nothing (`aria-disabled`, plan §2.2).
 */

const SECTION_SEGMENT = 3; // '' / 'p' / ':id' / section

export function ProfileSwitcher({ active }: { active: HostedProfile | null }) {
  const t = useT();
  const tp = useTp();
  const me = useMe();
  // Signed out every profile is on this device: no "Hosted" chip, no note about the old local app (MUT-286)
  const local = useIsLocalMode();
  const drawers = useProfileDrawers();
  const canCreate = canCreateProfile(me);
  const navigate = useNavigate();
  const location = useLocation();
  const { open, toggle, close, buttonRef, panelRef } = usePopover();

  function choose(profile: HostedProfile) {
    close();
    const section = location.pathname.split('/')[SECTION_SEGMENT];
    void navigate({ to: section ? `/p/${profile.id}/${section}` : `/p/${profile.id}` });
  }

  function openNew() {
    if (!canCreate) return;
    close(false);
    drawers.openNew();
  }

  function openManage() {
    close(false);
    drawers.openManage();
  }

  return (
    <div className="hp-switcher">
      <button
        ref={buttonRef}
        type="button"
        className="hp-switcher-button press"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={active ? `${t('hosted.shell.switcher.label')}: ${active.name}` : t('hosted.shell.switcher.label')}
        onClick={toggle}
      >
        <span className="hp-switcher-name">{active ? active.name : t('hosted.shell.switcher.label')}</span>
        {active && !local && <span className="hp-chip">{t('hosted.shell.switcher.hosted')}</span>}
        <span className="hp-chevron" aria-hidden="true">
          ▾
        </span>
      </button>
      {open && (
        <div ref={panelRef} className="hp-popover hp-switcher-panel" role="menu" aria-label={t('hosted.shell.switcher.label')}>
          {me.profiles.map((profile) => {
            const current = profile.id === active?.id;
            return (
              <button
                key={profile.id}
                type="button"
                role="menuitemradio"
                aria-checked={current}
                className={`hp-option press ${current ? 'hp-option-on' : ''}`}
                onClick={() => choose(profile)}
              >
                <span className="hp-check" aria-hidden="true">
                  {current ? '✓' : ''}
                </span>
                <span className="hp-option-text">
                  <span className="hp-option-line">
                    <span>{profile.name}</span>
                    {!local && <span className="hp-chip">{t('hosted.shell.switcher.hosted')}</span>}
                  </span>
                  <ProfileKindLine profile={profile} viewerId={me.user.id} />
                </span>
              </button>
            );
          })}
          <div className="hp-popover-sep" role="separator" />
          <button
            type="button"
            role="menuitem"
            aria-disabled={!canCreate || undefined}
            className="hp-option hp-option-action press"
            onClick={openNew}
          >
            <span className="hp-option-text">
              <span className="hp-option-line">{t('hosted.shell.switcher.newProfile')}</span>
              {atProfileCap(me) && (
                <span className="hp-option-sub">{tp('hosted.profiles.used', me.limits.maxOwnedProfiles, { owned: String(me.limits.ownedProfiles) })}</span>
              )}
            </span>
          </button>
          <button type="button" role="menuitem" className="hp-option hp-option-action press" onClick={openManage}>
            <span className="hp-option-text">
              <span className="hp-option-line">{t('hosted.shell.switcher.manage')}</span>
            </span>
          </button>
          {!local && <p className="hp-popover-foot">{t('hosted.shell.switcher.localFooter')}</p>}
        </div>
      )}
    </div>
  );
}

/** MUT-373 (DR12): the same line the Manage list shows, the shared cue included. */
function ProfileKindLine({ profile, viewerId }: { profile: HostedProfile; viewerId: string }) {
  const kind = useProfileKind(profile, viewerId);
  return (
    <span className="hp-option-sub hp-profile-kind" title={kind}>
      {kind}
    </span>
  );
}
