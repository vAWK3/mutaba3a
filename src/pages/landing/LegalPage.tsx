import type { ReactNode } from 'react';
import './LandingPage.css';
import './PrivacyPolicyPage.css';
import { useT } from '../../lib/i18n';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { useLandingAnalytics } from './analytics/landingAnalytics';
import { LandingHeader, LandingFooter } from './components';

export interface LegalSection {
  title: string;
  paragraphs: readonly string[];
}

interface LegalPageProps {
  title: string;
  /** "Last updated …" or the version's own line; omitted while the text is still loading. */
  updated?: string;
  intro?: string;
  sections: readonly LegalSection[];
  /** Below the sections, before the way back home: e.g. links to other versions. */
  after?: ReactNode;
}

/**
 * The layout shared by /privacy and /terms (MUT-324): landing chrome, one
 * heading, a dated intro, then titled sections. Mounted outside the router.
 */
export function LegalPage({ title, updated, intro, sections, after }: LegalPageProps) {
  const t = useT();
  useDocumentTitle(t('common.pageTitle', { page: title }));
  useLandingAnalytics();

  return (
    <div className="landing-page">
      <a href="#main-content" className="landing-skip-link">
        {t('landing.skipToContent')}
      </a>
      <LandingHeader homeHref="/" />
      <main id="main-content" aria-busy={updated === undefined}>
        <article className="landing-section privacy-policy" aria-labelledby="legal-page-title">
          <div className="landing-container privacy-policy-container">
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
