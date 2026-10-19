import type { ReactNode } from 'react';
import './LandingPage.css';
import './PrivacyPolicyPage.css';
import { useT, type Language } from '../../lib/i18n';
import { getDirection } from '../../lib/i18n/core';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { useLandingAnalytics } from './analytics/landingAnalytics';
import { LandingHeader, LandingFooter } from './components';

export interface LegalSection {
  title: string;
  paragraphs: readonly string[];
}

interface LegalPageProps {
  title: string;
  /** "Last updated …" or the version's own line. */
  updated?: string;
  /** The text is still loading: the page says it is busy. */
  loading?: boolean;
  intro?: string;
  sections: readonly LegalSection[];
  /** Below the sections, before the way back home: e.g. links to other versions. */
  after?: ReactNode;
  /** The text's own language when it may differ from the page's (a /terms?lang link), so it reads in its direction. */
  textLanguage?: Language;
}

/**
 * The layout shared by /privacy and /terms (MUT-324): landing chrome, one
 * heading, a dated intro, then titled sections. Mounted outside the router.
 */
export function LegalPage({ title, updated, loading = false, intro, sections, after, textLanguage }: LegalPageProps) {
  const t = useT();
  useDocumentTitle(t('common.pageTitle', { page: title }));
  useLandingAnalytics();

  return (
    <div className="landing-page">
      <a href="#main-content" className="landing-skip-link">
        {t('landing.skipToContent')}
      </a>
      <LandingHeader homeHref="/" />
      <main id="main-content" aria-busy={loading}>
        <article className="landing-section privacy-policy" aria-labelledby="legal-page-title">
          <div className="landing-container privacy-policy-container">
            <div lang={textLanguage} dir={textLanguage && getDirection(textLanguage)}>
              <h1 id="legal-page-title" className="privacy-policy-title">
                {title}
              </h1>
              {updated && <p className="privacy-policy-updated">{updated}</p>}
              {intro && <p className="privacy-policy-intro">{intro}</p>}

              {sections.map((section) => (
                <section key={section.title} className="privacy-policy-section">
                  <h2>{section.title}</h2>
                  {section.paragraphs.map((paragraph) => (
                    <p key={paragraph}>{paragraph}</p>
                  ))}
                </section>
              ))}
            </div>

            {after}

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
