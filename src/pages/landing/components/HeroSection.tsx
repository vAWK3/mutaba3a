import { useMemo, type ComponentType } from 'react';
import { useT } from '../../../lib/i18n';
import { useLatestRelease } from '../../../hooks/useLatestRelease';
import { DOWNLOAD_URLS, WEB_APP_URL } from '../../../content/download-config';
import { currentDevice } from '../../../lib/platform';
import { chooseHeroCta, secondaryHeroLink, type HeroCta } from '../heroCta';
import { AppleIcon, BrowserIcon, WindowsIcon } from './PlatformIcons';
import { ClientsListMock } from './mocks';
import './HeroSection.css';

const CTA: Record<HeroCta, { href: string; Icon: ComponentType; label: string; hint: string }> = {
  mac: {
    href: DOWNLOAD_URLS.mac,
    Icon: AppleIcon,
    label: 'landing.hero.ctaMac',
    hint: 'landing.hero.ctaMacHint',
  },
  windows: {
    href: DOWNLOAD_URLS.windowsMsi,
    Icon: WindowsIcon,
    label: 'landing.hero.ctaWindows',
    hint: 'landing.hero.ctaWindowsHint',
  },
  web: {
    href: WEB_APP_URL,
    Icon: BrowserIcon,
    label: 'landing.hero.ctaWeb',
    hint: 'landing.hero.ctaWebHint',
  },
};

export function HeroSection() {
  const t = useT();
  const { release } = useLatestRelease();
  const device = useMemo(() => currentDevice(), []);
  const cta = chooseHeroCta(device, release?.hasWindowsBuild !== false);
  const { href, Icon, label, hint } = CTA[cta];
  const alternative = secondaryHeroLink(cta);

  return (
    <section data-part="hero" aria-labelledby="hero-title" className="landing-section landing-hero">
      <div className="landing-container">
        <div className="hero-layout">
          <div className="hero-content">
            <h1 id="hero-title" className="landing-headline-large">
              <span className="hero-headline-line">{t('landing.hero.headlineLine1')}</span>{' '}
              <span className="hero-headline-line">{t('landing.hero.headlineLine2')}</span>
            </h1>
            <p className="landing-subheadline-large">{t('landing.hero.subheadline')}</p>

            <div className="hero-cta">
              <a href={href} className="hero-cta-primary">
                <Icon />
                <span className="hero-cta-text">
                  <span className="hero-cta-label">{t(label)}</span>
                  <span className="hero-cta-hint">{t(hint)}</span>
                </span>
              </a>
              {alternative === 'web' ? (
                <a href={WEB_APP_URL} className="hero-cta-alt">
                  {t('landing.hero.altWeb')}
                </a>
              ) : (
                <a href="#get-it" className="hero-cta-alt">
                  {t('landing.hero.altDesktop')}
                </a>
              )}
            </div>
          </div>

          <div className="hero-visual">
            <ClientsListMock />
          </div>
        </div>
      </div>
    </section>
  );
}
