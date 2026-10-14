import { useLanguage, useT } from '../../../lib/i18n';
import { malafatUrl } from '../../../content/malafatLinks';

/**
 * Mutaba3a connects to Malafat (MUT-174): a band in the privacy band's look
 * (no picture: a mock of another product's screens would drift from it), for
 * law firms and accounting offices. The capture claim is tied to a hosted
 * account and the phone app, so it never contradicts the free app above it;
 * nothing is said to happen automatically, because a captured payment waits
 * unallocated for the firm (MUT-61). One link leaves for malafat.app.
 */
export function MalafatSection() {
  const t = useT();
  const { language } = useLanguage();
  const href = malafatUrl({ locale: language, medium: 'landing', content: 'landing-section' });

  return (
    <section data-part="malafat" aria-labelledby="malafat-title" className="landing-section landing-privacy-band landing-malafat">
      <div className="landing-container">
        <h2 id="malafat-title" className="landing-privacy-title">
          {t('landing.malafat.title')}
        </h2>
        <p className="landing-privacy-body">{t('landing.malafat.body')}</p>
        <p className="landing-malafat-link-line">
          <a className="landing-band-link" href={href} target="_blank" rel="noopener noreferrer">
            {t('landing.malafat.link')}{' '}
            <span className="sr-only">{t('common.opensInNewTab')}</span>
          </a>
        </p>
      </div>
    </section>
  );
}
