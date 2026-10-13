import { useCallback, useRef } from 'react';
import { useT, useLanguage } from '../../../lib/i18n';
import { Wordmark } from '../../../components/brand/Wordmark';
import { useInView } from '../../../hooks/useInView';
import { useHeroCta } from '../useHeroCta';

/** The mark's size in the bar, about the cap height of the name beside it. */
const BAR_MARK_SIZE = 24;
/** The platform icon in the bar's button, sized to its label. */
const BAR_ICON_SIZE = 16;

interface LandingHeaderProps {
  /**
   * Show the device-matched button. The landing page passes false while the
   * hero's own button is on screen; pages with no hero leave it shown.
   */
  showCta?: boolean;
}

/**
 * The slim sticky frosted bar (MUT-77, brief L9): the wordmark, the language
 * switch, and the hero's button once the hero's has scrolled away. No section
 * links. The button stays in the DOM and CSS hides it (visibility, so it also
 * leaves the tab order), which lets it cross-fade. A sentinel at the very top
 * of the page tells the bar when to show its scroll-edge fade, so nothing
 * listens to scroll events.
 */
export function LandingHeader({ showCta = true }: LandingHeaderProps) {
  const t = useT();
  const { language, setLanguage } = useLanguage();
  const { href, Icon, label, shortLabel } = useHeroCta();
  const topRef = useRef<HTMLDivElement>(null);
  const scrolled = useInView(topRef) === false;

  const toggleLanguage = useCallback(() => {
    setLanguage(language === 'en' ? 'ar' : 'en');
  }, [language, setLanguage]);

  return (
    <>
      <div id="top" ref={topRef} className="landing-top-sentinel" aria-hidden="true" />
      <header className="landing-header" data-scrolled={scrolled}>
        <div className="landing-container landing-header-bar">
          <a href="#top" className="landing-header-brand">
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
            <button type="button" className="landing-lang-toggle" onClick={toggleLanguage}>
              <span className={language === 'en' ? 'active' : ''}>{t('landing.langToggle.en')}</span>
              <span className="landing-lang-divider" aria-hidden="true">
                |
              </span>
              <span className={language === 'ar' ? 'active' : ''}>{t('landing.langToggle.ar')}</span>
              <span className="sr-only">{t('landing.langToggle.label')}</span>
            </button>
            <a
              href={href}
              className="landing-header-cta"
              data-part="header-cta"
              data-visible={showCta}
              aria-label={t(label)}
            >
              <Icon size={BAR_ICON_SIZE} />
              <span>{t(shortLabel)}</span>
            </a>
          </div>
        </div>
      </header>
    </>
  );
}
