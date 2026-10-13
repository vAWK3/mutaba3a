import type { Ref } from 'react';
import { useT } from '../../../lib/i18n';
import { WEB_APP_URL } from '../../../content/download-config';
import { useHeroCta } from '../useHeroCta';
import { ClientsListMock } from './mocks';
import './HeroSection.css';

interface HeroSectionProps {
  /** The device-matched button, for the header bar to watch (MUT-77). */
  ctaRef?: Ref<HTMLAnchorElement>;
}

export function HeroSection({ ctaRef }: HeroSectionProps) {
  const t = useT();
  const { href, Icon, label, hint, alternative } = useHeroCta();

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
              <a ref={ctaRef} href={href} className="hero-cta-primary">
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
