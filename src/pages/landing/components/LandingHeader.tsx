import { useCallback, useEffect, useRef } from 'react';
import { useT, useLanguage } from '../../../lib/i18n';
import { Wordmark } from '../../../components/brand/Wordmark';
import { useInView } from '../../../hooks/useInView';
import { useHeroCta } from '../useHeroCta';
import { hostedPortalUrl } from '../../../lib/goHosted';

/** The mark's size in the bar, about the cap height of the name beside it. */
const BAR_MARK_SIZE = 24;
/** The platform icon in the bar's button, sized to its label. */
const BAR_ICON_SIZE = 16;

interface LandingHeaderProps {
  /**
   * Whether the device-matched button shows. Only the landing page passes it:
   * false while the hero's own button is on screen. A page that leaves it out
   * (the privacy policy) gets no button, and no GitHub release lookup.
   */
  showCta?: boolean;
  /** Where the wordmark goes: the top of the landing page, or home from a sub-page. */
  homeHref?: string;
}

/** The hero's button in the bar. Its own component, so only a page that shows it asks for the release. */
function HeaderCta({ visible }: { visible: boolean }) {
  const t = useT();
  const { href, Icon, label, shortLabel } = useHeroCta();
  return (
    <a href={href} className="landing-header-cta" data-part="header-cta" data-visible={visible} aria-label={t(label)}>
      <Icon size={BAR_ICON_SIZE} />
      <span className="landing-header-cta-label">{t(shortLabel)}</span>
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
export function LandingHeader({ showCta, homeHref = '#top' }: LandingHeaderProps) {
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
                  {/* Both names on wide screens; a phone has room for the active language's only (MUT-77, 375 AC) */}
                  <span className="landing-wordmark-full">{t('landing.header.wordmark')}</span>
                  <span className="landing-wordmark-short">{t('landing.header.wordmarkShort')}</span>
                </>
              }
              markSize={BAR_MARK_SIZE}
              className="landing-wordmark"
            />
          </a>
          <div className="landing-header-actions">
            {portalUrl && (
              <a href={portalUrl} target="_blank" rel="noopener noreferrer" className="landing-header-signin">
                {t('landing.header.signIn')} <span className="sr-only">{t('common.opensInNewTab')}</span>
              </a>
            )}
            {/* Before the switch, so while it is hidden its reserved slot reads as gap and the switch keeps the end edge */}
            {showCta !== undefined && <HeaderCta visible={showCta} />}
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
