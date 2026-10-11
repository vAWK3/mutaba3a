import { useT } from '../../lib/i18n/core';
import { LanguageSwitch } from '../components/Brand';
import { useMe } from '../session/me';
import { useSignOut } from '../session/useSignOut';
import { usePopover } from './usePopover';

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

/** The account menu (hosted-portal.md §7.1): who is signed in, the language, and Sign out. */
export function UserMenu() {
  const t = useT();
  const { user } = useMe();
  const { signOut, signingOut } = useSignOut();
  const popover = usePopover();

  return (
    <div className="hp-usermenu">
      <button
        ref={popover.buttonRef}
        type="button"
        className={`hp-usermenu-button ${popover.open ? 'hp-open' : ''}`}
        aria-haspopup="menu"
        aria-expanded={popover.open}
        aria-label={`${t('hosted.shell.account')}: ${user.displayName}`}
        onClick={popover.toggle}
      >
        <span className="hp-avatar" aria-hidden="true">
          {initialsOf(user.displayName)}
        </span>
        <span className="hp-usermenu-who">
          <span>{user.displayName}</span>
          <small dir="ltr">{user.email}</small>
        </span>
      </button>
      {popover.open && (
        <div ref={popover.panelRef} className="hp-popover hp-usermenu-panel" role="menu" aria-label={t('hosted.shell.account')}>
          <div className="hp-menu-row">
            <span>{t('hosted.shell.language')}</span>
            <LanguageSwitch />
          </div>
          <div className="hp-menu-sep" role="separator" />
          <button type="button" role="menuitem" className="hp-menu-item" disabled={signingOut} onClick={() => void signOut()}>
            {t('hosted.auth.signOut')}
          </button>
        </div>
      )}
    </div>
  );
}
