import { useT } from '../../../lib/i18n';

/** Privacy, said once and plainly. */
export function PrivacyBand() {
  const t = useT();

  return (
    <section data-part="privacy" aria-labelledby="privacy-title" className="landing-section landing-privacy-band">
      <div className="landing-container landing-privacy-band-inner">
        <h2 id="privacy-title" className="landing-privacy-title">
          {t('landing.privacy.title')}
        </h2>
        <p className="landing-privacy-body">{t('landing.privacy.body')}</p>
      </div>
    </section>
  );
}
