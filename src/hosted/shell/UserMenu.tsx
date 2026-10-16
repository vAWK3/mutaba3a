import { useT } from '../../lib/i18n/core';
import { LanguageSwitch } from '../components/Brand';
import { useMe } from '../session/me';
import { useSignOut } from '../session/useSignOut';
import { usePopover } from './usePopover';
import { useAccountDrawers } from './AccountDrawers';
import { MalafatMenuItems } from '../components/MalafatPortal';
import type { HostedProfile } from '../api/client';

const INITIALS = 2;

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, INITIALS)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
}

/** The account menu (hosted-portal.md §7.1): who is signed in, the language, Sign out, and on an eligible profile Malafat (MUT-191). */
export function UserMenu({ profile = null }: { profile?: HostedProfile | null }) {
  const t = useT();
  const { user } = useMe();
  const { signOut, signingOut } = useSignOut();
  const { open, close, toggle, buttonRef, panelRef } = usePopover();
  const accountDrawers = useAccountDrawers();

  function openChangePassword() {
    close(false);
    accountDrawers.open();
  }

  return (
    <div className="hp-usermenu">
      <button
        ref={buttonRef}
        type="button"
        className={`hp-usermenu-button press ${open ? 'hp-open' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${t('hosted.shell.account')}: ${user.displayName}`}
        onClick={toggle}
      >
        <span className="hp-avatar" aria-hidden="true">
          {initialsOf(user.displayName)}
        </span>
        <span className="hp-usermenu-who">
          <span>{user.displayName}</span>
          <small dir="ltr">{user.email}</small>
        </span>
      </button>
      {open && (
        <div ref={panelRef} className="hp-popover hp-usermenu-panel" role="menu" aria-label={t('hosted.shell.account')}>
          <div className="hp-menu-row">
            <span>{t('hosted.shell.language')}</span>
            <LanguageSwitch />
          </div>
          <div className="hp-menu-sep" role="separator" />
          <button type="button" role="menuitem" className="hp-menu-item press" disabled={signingOut} onClick={() => void signOut()}>
            {t('hosted.auth.signOut')}
          </button>
          <button type="button" role="menuitem" className="hp-menu-item press" onClick={openChangePassword}>
            {t('hosted.auth.changePassword')}
          </button>
          {/* After Sign out, so Sign out stays the menu's first item (focus on open) */}
          <MalafatMenuItems profile={profile} />
        </div>
      )}
    </div>
  );
}
