import type { Ref } from 'react';
import { useT } from '../../../lib/i18n';
import { MOBILE_APP_LINKS, storeLinkUrl } from '../../../content/download-config';
import { hostedPortalUrl } from '../../../lib/goHosted';
import { ClientsListMock } from './mocks';
import { AndroidIcon, IosIcon } from './PlatformIcons';
import './HeroSection.css';

interface HeroSectionProps {
  /** The primary CTA, for the header bar to watch (MUT-77). */
  ctaRef?: Ref<HTMLAnchorElement>;
  /** MUT-369: the portal's signup page while signup is open; null keeps "Request an account". */
  signupUrl?: string | null;
}

/**
 * Hosted-only hero (MUT-? landing rewrite): one account, reached either by
 * requesting one (most visitors) or signing in / getting the phone app (people
 * whose organization already has one). While self-service signup is open
 * (MUT-369) the primary action is "Create an account" on the portal; otherwise
 * it is "Request an account". Never a direct download.
 */
export function HeroSection({ ctaRef, signupUrl = null }: HeroSectionProps) {
  const t = useT();
  const portalUrl = hostedPortalUrl();
  const iosUrl = storeLinkUrl(MOBILE_APP_LINKS.ios, 'mutaba3a-landing');
  const androidUrl = storeLinkUrl(MOBILE_APP_LINKS.android, 'mutaba3a-landing');

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
              {signupUrl ? (
                <a ref={ctaRef} href={signupUrl} target="_blank" rel="noopener noreferrer" className="hero-cta-primary">
                  <span className="hero-cta-label">{t('landing.hero.ctaCreate')}</span>
                  <span className="sr-only"> {t('common.opensInNewTab')}</span>
                </a>
              ) : (
                <a ref={ctaRef} href="#get-it" className="hero-cta-primary">
                  <span className="hero-cta-label">{t('landing.hero.ctaRequest')}</span>
                </a>
              )}
              {portalUrl && (
                <a href={portalUrl} target="_blank" rel="noopener noreferrer" className="hero-cta-alt">
                  {t('landing.hero.ctaSignIn')}
                </a>
              )}
              {iosUrl && (
                <a href={iosUrl} target="_blank" rel="noopener noreferrer" className="hero-cta-alt">
                  <IosIcon size={18} />
                  {t('landing.hero.ctaIos')}
                </a>
              )}
              {androidUrl && (
                <a href={androidUrl} target="_blank" rel="noopener noreferrer" className="hero-cta-alt">
                  <AndroidIcon size={18} />
                  {t('landing.hero.ctaAndroid')}
                </a>
              )}
            </div>
            <p className="hero-cta-note">{t(signupUrl ? 'landing.hero.altNoteOpen' : 'landing.hero.altNote')}</p>
          </div>

          <div className="hero-visual">
            <ClientsListMock />
          </div>
        </div>
      </div>
    </section>
  );
}
