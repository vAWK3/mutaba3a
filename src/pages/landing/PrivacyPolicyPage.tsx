import './LandingPage.css';
import './PrivacyPolicyPage.css';
import { useT } from '../../lib/i18n';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { LandingHeader, LandingFooter } from './components';

const SECTION_KEYS = [
  'scope',
  'dataStorage',
  'mobile',
  'whatYouEnter',
  'network',
  'sharing',
  'security',
  'noTracking',
  'yourControl',
  'mobileDeletion',
  'children',
  'changes',
  'contact',
] as const;

/**
 * The policy for every Mutaba3a app: the local-only Mac, Windows, and browser apps, and the
 * account-based iPhone and Android apps that store data on the hosted API (Google Cloud).
 */
export function PrivacyPolicyPage() {
  const t = useT();
  useDocumentTitle(t('common.pageTitle', { page: t('landing.privacyPolicy.title') }));

  return (
    <div className="landing-page">
      <a href="#main-content" className="landing-skip-link">
        {t('landing.skipToContent')}
      </a>
      <LandingHeader homeHref="/" />
      <main id="main-content">
        <article className="landing-section privacy-policy" aria-labelledby="privacy-policy-title">
          <div className="landing-container privacy-policy-container">
            <h1 id="privacy-policy-title" className="privacy-policy-title">
              {t('landing.privacyPolicy.title')}
            </h1>
            <p className="privacy-policy-updated">{t('landing.privacyPolicy.updated')}</p>
            <p className="privacy-policy-intro">{t('landing.privacyPolicy.intro')}</p>

            {SECTION_KEYS.map((key) => (
              <section key={key} className="privacy-policy-section">
                <h2>{t(`landing.privacyPolicy.${key}.title`)}</h2>
                <p>{t(`landing.privacyPolicy.${key}.body`)}</p>
              </section>
            ))}

            <a href="/" className="privacy-policy-back">
              {t('landing.privacyPolicy.backLink')}
            </a>
          </div>
        </article>
      </main>
      <LandingFooter />
    </div>
  );
}
