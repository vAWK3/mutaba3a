import { useLanguage } from '../../lib/i18n/core';
import { MOBILE_APP_LINKS, storeLinkUrl, type MobileAppLink } from '../../content/download-config';
import { RowLink, RowNote } from './YouRows';

const PLATFORMS = ['ios', 'android'] as const;
type Platform = (typeof PLATFORMS)[number];

/**
 * One platform's row: a real link once `storeLinkUrl` has one, else the
 * platform's name (it exists, no listing yet) or "coming soon" (MUT-261).
 * Reads the same `MOBILE_APP_LINKS` as the landing page's PhoneSection, so
 * one place ever decides what's live (MUT-173).
 */
function PlatformRow({ platform, link }: { platform: Platform; link: MobileAppLink }) {
  const { t } = useLanguage();
  const name = t(`hosted.appDownload.platform.${platform}`);
  const url = storeLinkUrl(link, 'mutaba3a-portal');
  if (url) return <RowLink label={t('hosted.appDownload.get', { platform: name })} href={url} />;
  return <RowNote label={link.available ? name : t('hosted.appDownload.comingSoon', { platform: name })} />;
}

/** "Get the app" (MUT-261): the last rows of You › App (MUT-425), signed in only. */
export function AppDownloadRows() {
  return (
    <>
      {PLATFORMS.map((platform) => (
        <PlatformRow key={platform} platform={platform} link={MOBILE_APP_LINKS[platform]} />
      ))}
    </>
  );
}
