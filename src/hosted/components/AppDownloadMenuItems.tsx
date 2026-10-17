import { useLanguage } from '../../lib/i18n/core';
import { MOBILE_APP_LINKS, storeLinkUrl, type MobileAppLink } from '../../content/download-config';

const PLATFORMS = ['ios', 'android'] as const;
type Platform = (typeof PLATFORMS)[number];

/**
 * One platform's row: a real link once `storeLinkUrl` has one, else the
 * platform's name (it exists, no listing yet) or "coming soon" (MUT-261).
 * Reads the same `MOBILE_APP_LINKS` as the landing page's PhoneSection, so
 * one place ever decides what's live (MUT-173).
 */
function PlatformItem({ platform, link }: { platform: Platform; link: MobileAppLink }) {
  const { t } = useLanguage();
  const name = t(`hosted.appDownload.platform.${platform}`);
  const url = storeLinkUrl(link);

  if (url) {
    return (
      <a role="menuitem" className="hp-menu-item press" href={url} target="_blank" rel="noopener noreferrer">
        {t('hosted.appDownload.get', { platform: name })} <span className="sr-only">{t('common.opensInNewTab')}</span>
      </a>
    );
  }
  return (
    <span role="menuitem" aria-disabled="true" tabIndex={-1} className="hp-menu-item hp-menu-item--soon">
      {link.available ? name : t('hosted.appDownload.comingSoon', { platform: name })}
    </span>
  );
}

/** "Get the app" (MUT-261): always last in the account menu, after Malafat. */
export function AppDownloadMenuItems() {
  return (
    <>
      <div className="hp-menu-sep" role="separator" />
      {PLATFORMS.map((platform) => (
        <PlatformItem key={platform} platform={platform} link={MOBILE_APP_LINKS[platform]} />
      ))}
    </>
  );
}
