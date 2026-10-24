import { useNavigate } from '@tanstack/react-router';
import { useLanguage, useT } from '../../lib/i18n/core';
import { LanguageSwitch } from '../components/Brand';
import { useMe } from '../session/me';
import { useIsLocalMode } from '../session/mode';
import { useSignOut } from '../session/useSignOut';
import { usePopover } from './usePopover';
import { useAccountDrawers } from './AccountDrawers';
import { MalafatMenuItems } from '../components/MalafatPortal';
import { termsHref } from '../terms';
import { AppDownloadMenuItems } from '../components/AppDownloadMenuItems';
import { UsageMenuItem } from '../components/UsageMenuItem';
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

/**
 * The account menu (hosted-portal.md §7.1): who is signed in, the language, Sign out, on an eligible profile Malafat
 * (MUT-191), and the app store links (MUT-261). Signed out on this device (MUT-286) it has no account to show: "On
 * this device" instead of the placeholder email, Sign in and Your data instead of Sign out and Change password, and
 * nothing that needs an account (Malafat, the usage switch).
 */
export function UserMenu({ profile = null }: { profile?: HostedProfile | null }) {
  const t = useT();
  const { language } = useLanguage();
  const { user } = useMe();
  const local = useIsLocalMode();
  const { signOut, signingOut } = useSignOut();
  const termsLink = termsHref(language);
  const { open, close, toggle, buttonRef, panelRef } = usePopover();
  const accountDrawers = useAccountDrawers();
  const navigate = useNavigate();

  function openChangePassword() {
    close(false);
    accountDrawers.open();
  }

  function openYourData() {
    close(false);
    accountDrawers.openYourData();
  }

  function openBilling() {
    close(false);
    accountDrawers.openBilling();
  }

  function openCloseAccount() {
    close(false);
    accountDrawers.openCloseAccount();
  }

  function goToSignIn() {
    close(false);
    void navigate({ to: '/sign-in' });
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
          {local ? <small>{t('hosted.local.onThisDevice')}</small> : <small dir="ltr">{user.email}</small>}
        </span>
      </button>
      {open && (
        <div ref={panelRef} className="hp-popover hp-usermenu-panel" role="menu" aria-label={t('hosted.shell.account')}>
          <div className="hp-menu-row">
            <span>{t('hosted.shell.language')}</span>
            <LanguageSwitch />
          </div>
          <div className="hp-menu-sep" role="separator" />
          {local ? (
            <>
              <button type="button" role="menuitem" className="hp-menu-item press" onClick={goToSignIn}>
                {t('hosted.local.signIn')}
              </button>
              <button type="button" role="menuitem" className="hp-menu-item press" onClick={openYourData}>
                {t('hosted.local.yourData')}
              </button>
            </>
          ) : (
            <>
              <button type="button" role="menuitem" className="hp-menu-item press" disabled={signingOut} onClick={() => void signOut()}>
                {t('hosted.auth.signOut')}
              </button>
              <button type="button" role="menuitem" className="hp-menu-item press" onClick={openChangePassword}>
                {t('hosted.auth.changePassword')}
              </button>
              {/* MUT-325: the account's own Download my records */}
              <button type="button" role="menuitem" className="hp-menu-item press" onClick={openYourData}>
                {t('hosted.yourData.title')}
              </button>
              {/* MUT-362 (DR5): Settings › Billing, for everyone signed in; "open soon" until Stripe and prices are set */}
              <button type="button" role="menuitem" className="hp-menu-item press" onClick={openBilling}>
                {t('hosted.billing.title')}
              </button>
              {/* After Sign out, so Sign out stays the menu's first item (focus on open) */}
              <MalafatMenuItems profile={profile} />
              {/* MUT-155: the anonymous-usage switch; no telemetry signed out (brief §10) */}
              <UsageMenuItem />
              {/* MUT-333: the last account item, set apart: it can't be undone after 30 days */}
              <button type="button" role="menuitem" className="hp-menu-item hp-menu-item--danger press" onClick={openCloseAccount}>
                {t('hosted.closeAccount.menu')}
              </button>
            </>
          )}
          {/* MUT-324: the terms, in either mode; before the app downloads, which stay last */}
          {termsLink && (
            <a role="menuitem" className="hp-menu-item press" href={termsLink} target="_blank" rel="noopener">
              {t('hosted.terms.link')}
            </a>
          )}
          {/* Last item (MUT-261). Not signed out: the phone app can't see this device's records, and signed-out
              screens carry no store links (MUT-285 brief §11, MUT-186 9A). */}
          {!local && <AppDownloadMenuItems />}
        </div>
      )}
    </div>
  );
}
