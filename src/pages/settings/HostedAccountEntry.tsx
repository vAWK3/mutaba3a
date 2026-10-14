import { useT } from '../../lib/i18n';
import { hostedPortalUrl } from '../../lib/goHosted';
import { HOSTED_OFFER_URL } from '../../content/download-config';
import './HostedAccountEntry.css';

/**
 * Settings › Businesses' "Hosted account" row (MUT-187): one sentence on what
 * hosted is, a link to /hosted, and a sign-in link to the portal for people
 * who already have an account. Both open in a new tab, as plain anchors (the
 * router's /app basepath would rewrite /hosted). The sign-in line appears only
 * when the build set a portal URL. Web build only; SettingsPage gates it.
 */
export function HostedAccountEntry() {
  const t = useT();
  const portalUrl = hostedPortalUrl();
  const newTab = <span className="sr-only">{t('common.opensInNewTab')}</span>;

  return (
    <div className="hosted-account-entry">
      <div className="settings-label">{t('settings.profile.hosted.title')}</div>
      <p className="hosted-account-entry-text">{t('settings.profile.hosted.description')}</p>
      <div className="hosted-account-entry-actions">
        <a href={HOSTED_OFFER_URL} target="_blank" rel="noopener noreferrer" className="btn btn-sm btn-secondary hosted-account-entry-cta">
          {t('settings.profile.hosted.cta')} {newTab}
        </a>
        {portalUrl && (
          <span className="text-muted">
            {t('settings.profile.hosted.signInPrompt')}{' '}
            <a href={portalUrl} target="_blank" rel="noopener noreferrer" className="hosted-account-entry-signin">
              {t('settings.profile.hosted.signIn')} {newTab}
            </a>
          </span>
        )}
      </div>
    </div>
  );
}
