import { useCallback, useEffect, useRef } from 'react';
import { useT, useLanguage } from '../../../lib/i18n';
import { Wordmark } from '../../../components/brand/Wordmark';
import { BrandName } from '../../../components/brand/Logotype';
import { useInView } from '../../../hooks/useInView';
import { hostedPortalUrl } from '../../../lib/goHosted';

/** The mark's size in the bar: the Arabic name beside it stays at today's 16px (design D3). */
const BAR_MARK_SIZE = 32;

interface LandingHeaderProps {
  /**
   * Whether the device-matched button shows. Only the landing page passes it:
   * false while the hero's own button is on screen. A page that leaves it out
   * (the privacy policy) gets no button, and no GitHub release lookup.
   */
  showCta?: boolean;
  /** Where the wordmark goes: the top of the landing page, or home from a sub-page. */
  homeHref?: string;
  /** MUT-369: while signup is open the bar's button mirrors the hero's "Create an account". */
  signupUrl?: string | null;
}

/** The hero's primary button, mirrored in the bar once the hero's own has scrolled away. */
function HeaderCta({ visible, signupUrl }: { visible: boolean; signupUrl: string | null }) {
  const t = useT();
  if (signupUrl) {
    return (
      <a href={signupUrl} target="_blank" rel="noopener noreferrer" className="landing-header-cta" data-part="header-cta" data-visible={visible}>
        <span className="landing-header-cta-label">{t('landing.hero.ctaCreate')}</span>
        <span className="sr-only"> {t('common.opensInNewTab')}</span>
      </a>
    );
  }
  return (
    <a href="#get-it" className="landing-header-cta" data-part="header-cta" data-visible={visible}>
      <span className="landing-header-cta-label">{t('landing.hero.ctaRequest')}</span>
    </a>
  );
}

/**
 * The slim sticky frosted bar (MUT-77, brief L9): the wordmark, the hero's
 * button once the hero's has scrolled away, and the language switch at the
 * end edge. No section links. The button stays in the DOM and CSS hides it
 * (visibility, so it also leaves the tab order), which lets it cross-fade. A
 * sentinel at the very top of the page tells the bar when to show its
 * scroll-edge fade, so nothing listens to scroll events.
 */
export function LandingHeader({ showCta, homeHref = '#top', signupUrl = null }: LandingHeaderProps) {
  const t = useT();
  const { language, setLanguage } = useLanguage();
  const topRef = useRef<HTMLDivElement>(null);
  const scrolled = useInView(topRef) === false;
  const portalUrl = hostedPortalUrl();

  const toggleLanguage = useCallback(() => {
    setLanguage(language === 'en' ? 'ar' : 'en');
  }, [language, setLanguage]);

  useEffect(() => {
    // iOS Safari applies :active only when a touch listener is present, so without this taps get no press state (L10).
    const noop = () => {};
    document.addEventListener('touchstart', noop, { passive: true });
    return () => document.removeEventListener('touchstart', noop);
  }, []);

  return (
    <>
      <div id="top" ref={topRef} className="landing-top-sentinel" aria-hidden="true" />
      <header className="landing-header" data-scrolled={scrolled}>
        <div className="landing-container landing-header-bar">
          <a href={homeHref} className="landing-header-brand">
            <Wordmark
              name={
                <>
                  {/* The active language's name first, so dir orders the lockup. A phone has room for that name
                      only: CSS hides the .wordmark-other pieces at 480px and below (MUT-77 375 AC, MUT-402 D12).
                      The spaces keep the link's name two words for screen readers; flex layout drops them visually */}
                  <BrandName language={language} />{' '}
                  <span className="wordmark-separator wordmark-other" aria-hidden="true" />{' '}
                  <BrandName language={language === 'en' ? 'ar' : 'en'} className="wordmark-other" />
                </>
              }
              markSize={BAR_MARK_SIZE}
              className="landing-wordmark"
            />
          </a>
          <div className="landing-header-actions">
            {/* Before the switch, so while the button is hidden its reserved slot reads as gap and the switch keeps the end edge.
                A phone has room for one of the two: Sign in until the button shows, then the button (MUT-231, CSS) */}
            <span className="landing-header-slot" data-cta-visible={showCta === true}>
              {portalUrl && (
                <a href={portalUrl} target="_blank" rel="noopener noreferrer" className="landing-header-signin">
                  {t('landing.header.signIn')} <span className="sr-only">{t('common.opensInNewTab')}</span>
                </a>
              )}
              {showCta !== undefined && <HeaderCta visible={showCta} signupUrl={signupUrl} />}
            </span>
            <button type="button" className="landing-lang-toggle" onClick={toggleLanguage}>
              <span className={language === 'en' ? 'active' : ''}>{t('landing.langToggle.en')}</span>
              <span className="landing-lang-divider" aria-hidden="true">
                |
              </span>
              <span className={language === 'ar' ? 'active' : ''}>{t('landing.langToggle.ar')}</span>
              <span className="sr-only">{t('landing.langToggle.label')}</span>
            </button>
          </div>
        </div>
      </header>
    </>
  );
}
