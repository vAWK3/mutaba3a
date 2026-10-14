import type { ReactNode } from 'react';
import { useT } from '../../../lib/i18n';
import { HOSTED_OFFER_URL, MOBILE_APP_LINKS, type MobileAppLink } from '../../../content/download-config';
import { ChapterSection } from './ChapterSection';
import { HostedDevicesMock } from './mocks';
import { AndroidIcon, IosIcon } from './PlatformIcons';

const T = 'landing.phone';

const PLATFORMS = ['ios', 'android'] as const;
type Platform = (typeof PLATFORMS)[number];

const ICONS: Record<Platform, (props: { size?: number }) => ReactNode> = { ios: IosIcon, android: AndroidIcon };

/** Where a phone app stands, from its config alone: a public listing, an app with no public link yet, or not yet. */
function storeState(link: MobileAppLink): 'link' | 'plain' | 'soon' {
  if (link.url) return 'link';
  return link.available ? 'plain' : 'soon';
}

/**
 * One platform's line. Only a real store link looks like a control; an app with
 * no public listing is named beside "with your hosted account", and an app that
 * does not exist yet says so (D9). Unlike /hosted, the landing may link a store:
 * the sentence above has already said the app needs a hosted account.
 */
function StoreEntry({ platform }: { platform: Platform }) {
  const t = useT();
  const link = MOBILE_APP_LINKS[platform];
  const Icon = ICONS[platform];
  const name = t(`landing.hostedOffer.platform.${platform}`);
  const state = storeState(link);

  if (state === 'link') {
    return (
      <a href={link.url!} className="landing-phone-store" target="_blank" rel="noopener noreferrer">
        <Icon size={20} />
        {t(`${T}.store.${platform}`)}
      </a>
    );
  }
  if (state === 'plain') {
    return (
      <span className="landing-phone-platform">
        <Icon size={20} />
        {name}
        <span className="landing-phone-platform-note">{t(`${T}.withAccount`)}</span>
      </span>
    );
  }
  return (
    <span className="landing-phone-platform landing-phone-platform--soon">
      <Icon size={20} />
      {t('landing.hostedOffer.platform.comingSoon', { platform: name })}
    </span>
  );
}

function PhoneExtra() {
  const t = useT();
  return (
    <>
      <p className="landing-phone-hint">
        {t(`${T}.hint`)} <a href={HOSTED_OFFER_URL}>{t(`${T}.hintLink`)}</a>
      </p>
      <ul className="landing-phone-stores" aria-label={t(`${T}.storesLabel`)}>
        {PLATFORMS.map((platform) => (
          <li key={platform}>
            <StoreEntry platform={platform} />
          </li>
        ))}
      </ul>
    </>
  );
}

/**
 * The phone logs, the portal shows (MUT-173): a chapter after Get it, with
 * /hosted's laptop-and-phone picture and, under the paragraph, each phone
 * platform's state read from `MOBILE_APP_LINKS` (never hardcoded).
 */
export function PhoneSection() {
  const t = useT();
  return (
    <ChapterSection
      part="phone"
      title={t(`${T}.title`)}
      body={t(`${T}.body`)}
      visual={<HostedDevicesMock />}
      flip
      extra={<PhoneExtra />}
    />
  );
}
