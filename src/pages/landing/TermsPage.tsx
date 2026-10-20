import { useEffect, useState } from 'react';
import { useLanguage, useT } from '../../lib/i18n';
import { LATEST_TERMS_VERSION, TERMS_VERSIONS, loadTerms, termsVersionOf, type TermsText } from '../../content/legal/terms';
import { legalLanguageOf } from '../../content/legal/language';
import { LegalPage } from './LegalPage';

type Shown = { status: 'loading' } | { status: 'found'; text: TermsText } | { status: 'missing' };

/**
 * /terms and /terms/<version> (MUT-324, ADR-102): the frozen terms text in the
 * page language. Every released version keeps its own address, so a person can
 * always read exactly what they agreed to; /terms is the latest.
 * A portal link names the language it records (`?lang`), which wins over the page
 * language for the text only and is never stored: the landing keeps its own choice.
 */
export function TermsPage({ path, search = '' }: { path: string; search?: string }) {
  const t = useT();
  const { language } = useLanguage();
  const linked = legalLanguageOf(search);
  const textLanguage = linked ?? language;
  const withLang = (href: string) => (linked ? `${href}?lang=${linked}` : href);
  const version = termsVersionOf(path);
  const [shown, setShown] = useState<{ key: string; value: Shown }>({ key: '', value: { status: 'loading' } });
  const key = `${version}:${textLanguage}`;

  useEffect(() => {
    let live = true;
    void (version ? loadTerms(version, textLanguage) : Promise.resolve(null)).then((text) => {
      if (live) setShown({ key, value: text ? { status: 'found', text } : { status: 'missing' } });
    });
    return () => {
      live = false;
    };
  }, [key, version, textLanguage]);

  const current = shown.key === key ? shown.value : ({ status: 'loading' } as const);

  if (current.status === 'missing') {
    return (
      <LegalPage
        title={t('landing.terms.missingTitle')}
        sections={[]}
        after={
          <p className="privacy-policy-intro">
            {t('landing.terms.missingBody')} <a href={withLang('/terms')}>{t('landing.terms.currentLink')}</a>
          </p>
        }
      />
    );
  }
  if (current.status === 'loading') return <LegalPage title={t('landing.terms.title')} loading sections={[]} />;

  const { text } = current;
  const others = TERMS_VERSIONS.filter((v) => v !== text.version);
  return (
    <LegalPage
      title={text.title}
      textLanguage={linked ?? undefined}
      updated={text.updated}
      intro={text.intro}
      sections={text.sections.map((s) => ({ title: s.title, paragraphs: s.body }))}
      after={
        others.length > 0 && (
          <section className="privacy-policy-section" aria-labelledby="terms-other-versions">
            <h2 id="terms-other-versions">{t('landing.terms.otherVersions')}</h2>
            <ul>
              {others.map((v) => (
                <li key={v}>
                  <a href={withLang(v === LATEST_TERMS_VERSION ? '/terms' : `/terms/${v}`)}>{v}</a>
                </li>
              ))}
            </ul>
          </section>
        )
      }
    />
  );
}
