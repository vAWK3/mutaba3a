import { useState, useCallback } from 'react';
import { useT, useLanguage } from '../../lib/i18n';
import './LandingPage.css';

// Icons as simple SVG components for features
const LedgerIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="16" y1="13" x2="8" y2="13" />
    <line x1="16" y1="17" x2="8" y2="17" />
    <polyline points="10 9 9 9 8 9" />
  </svg>
);

const ClientsIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
);

const DocumentIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="16" y1="13" x2="8" y2="13" />
    <line x1="16" y1="17" x2="8" y2="17" />
  </svg>
);

const RetainerIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <polyline points="12 6 12 12 16 14" />
  </svg>
);

const ExpenseIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="1" y="4" width="22" height="16" rx="2" ry="2" />
    <line x1="1" y1="10" x2="23" y2="10" />
  </svg>
);

const DashboardIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="7" height="7" />
    <rect x="14" y="3" width="7" height="7" />
    <rect x="14" y="14" width="7" height="7" />
    <rect x="3" y="14" width="7" height="7" />
  </svg>
);

const ReportsIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="20" x2="18" y2="10" />
    <line x1="12" y1="20" x2="12" y2="4" />
    <line x1="6" y1="20" x2="6" y2="14" />
  </svg>
);

const CurrencyIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="1" x2="12" y2="23" />
    <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
  </svg>
);

const CheckIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

const ChevronDownIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

// How It Works step icons
const StepOneIcon = () => (
  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="16" y1="13" x2="8" y2="13" />
    <line x1="16" y1="17" x2="8" y2="17" />
  </svg>
);

const StepTwoIcon = () => (
  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
    <line x1="8" y1="21" x2="16" y2="21" />
    <line x1="12" y1="17" x2="12" y2="21" />
    <path d="M7 9l3 3-3 3" />
    <line x1="11" y1="15" x2="17" y2="15" />
  </svg>
);

const StepThreeIcon = () => (
  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="1" x2="12" y2="23" />
    <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
  </svg>
);

interface FAQItemProps {
  question: string;
  answer: string;
  isOpen: boolean;
  onToggle: () => void;
}

function FAQItem({ question, answer, isOpen, onToggle }: FAQItemProps) {
  return (
    <div className={`landing-faq-item ${isOpen ? 'landing-faq-item--open' : ''}`}>
      <button className="landing-faq-question" onClick={onToggle} aria-expanded={isOpen}>
        <span>{question}</span>
        <ChevronDownIcon />
      </button>
      <div className="landing-faq-answer">
        <p>{answer}</p>
      </div>
    </div>
  );
}

export function LandingPage() {
  const t = useT();
  const { language, setLanguage } = useLanguage();
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  const toggleFaq = useCallback((index: number) => {
    setOpenFaq(prev => prev === index ? null : index);
  }, []);

  const toggleLanguage = useCallback(() => {
    setLanguage(language === 'en' ? 'ar' : 'en');
  }, [language, setLanguage]);

  const features = [
    { key: 'ledger', icon: <LedgerIcon /> },
    { key: 'clients', icon: <ClientsIcon /> },
    { key: 'documents', icon: <DocumentIcon /> },
    { key: 'retainers', icon: <RetainerIcon /> },
    { key: 'expenses', icon: <ExpenseIcon /> },
    { key: 'answers', icon: <DashboardIcon /> },
    { key: 'reports', icon: <ReportsIcon /> },
    { key: 'currency', icon: <CurrencyIcon /> },
  ];

  const faqItems = Array.from({ length: 10 }, (_, i) => ({
    question: t(`landing.faq.q${i + 1}`),
    answer: t(`landing.faq.a${i + 1}`),
  }));

  return (
    <div className="landing-page">
      {/* Language Toggle */}
      <header className="landing-header">
        <button className="landing-lang-toggle" onClick={toggleLanguage} aria-label="Toggle language">
          <span className={language === 'en' ? 'active' : ''}>{t('landing.langToggle.en')}</span>
          <span className="landing-lang-divider">|</span>
          <span className={language === 'ar' ? 'active' : ''}>{t('landing.langToggle.ar')}</span>
        </button>
      </header>

      {/* Section 1: Hero */}
      <section className="landing-section landing-hero">
        <div className="landing-container">
          <img
            src="/icons/icon-512.png"
            alt=""
            className="landing-logo"
            width={80}
            height={80}
          />
          <h1 className="landing-brand">
            Mutaba3a
            <span className="landing-brand-ar">متابعة</span>
          </h1>
          <h2 className="landing-headline">{t('landing.hero.headline')}</h2>
          <p className="landing-subheadline">{t('landing.hero.subheadline')}</p>
          <p className="landing-trust">{t('landing.hero.trust')}</p>

          <div className="landing-hero-actions">
            <a href="/app" className="landing-btn landing-btn--primary">
              {t('landing.hero.ctaPrimary')}
            </a>
            <a href="/download" className="landing-btn landing-btn--secondary">
              {t('landing.hero.ctaSecondary')}
            </a>
          </div>
        </div>
      </section>

      {/* Section 2: Problem Statement */}
      <section className="landing-section landing-problem">
        <div className="landing-container">
          <h2 className="landing-section-headline">{t('landing.problem.headline')}</h2>
          <ul className="landing-pain-points">
            <li>{t('landing.problem.pain1')}</li>
            <li>{t('landing.problem.pain2')}</li>
            <li>{t('landing.problem.pain3')}</li>
            <li>{t('landing.problem.pain4')}</li>
          </ul>
        </div>
      </section>

      {/* Section 3: How It Works */}
      <section className="landing-section landing-how">
        <div className="landing-container">
          <h2 className="landing-section-headline">{t('landing.howItWorks.headline')}</h2>
          <div className="landing-steps">
            <div className="landing-step">
              <div className="landing-step-icon">
                <StepOneIcon />
              </div>
              <h3 className="landing-step-title">{t('landing.howItWorks.step1Title')}</h3>
              <p className="landing-step-desc">{t('landing.howItWorks.step1Desc')}</p>
            </div>
            <div className="landing-step">
              <div className="landing-step-icon">
                <StepTwoIcon />
              </div>
              <h3 className="landing-step-title">{t('landing.howItWorks.step2Title')}</h3>
              <p className="landing-step-desc">{t('landing.howItWorks.step2Desc')}</p>
            </div>
            <div className="landing-step">
              <div className="landing-step-icon">
                <StepThreeIcon />
              </div>
              <h3 className="landing-step-title">{t('landing.howItWorks.step3Title')}</h3>
              <p className="landing-step-desc">{t('landing.howItWorks.step3Desc')}</p>
            </div>
          </div>
          <div className="landing-how-cta">
            <a href="/app" className="landing-btn landing-btn--outline">
              {t('landing.howItWorks.cta')}
            </a>
          </div>
        </div>
      </section>

      {/* Section 4: Features */}
      <section className="landing-section landing-features">
        <div className="landing-container">
          <h2 className="landing-section-headline">{t('landing.features.headline')}</h2>
          <div className="landing-features-grid">
            {features.map(({ key, icon }) => (
              <div key={key} className="landing-feature-card">
                <div className="landing-feature-icon">{icon}</div>
                <h3 className="landing-feature-title">{t(`landing.features.${key}.title`)}</h3>
                <p className="landing-feature-desc">{t(`landing.features.${key}.desc`)}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Section 5: Privacy & Trust */}
      <section className="landing-section landing-privacy">
        <div className="landing-container">
          <h2 className="landing-section-headline">{t('landing.privacy.headline')}</h2>
          <ul className="landing-trust-list">
            {[1, 2, 3, 4, 5, 6].map(i => (
              <li key={i} className="landing-trust-item">
                <CheckIcon />
                <span>{t(`landing.privacy.point${i}`)}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Section 6: Platforms */}
      <section className="landing-section landing-platforms">
        <div className="landing-container">
          <h2 className="landing-section-headline">{t('landing.platforms.headline')}</h2>
          <div className="landing-platform-cards">
            <a href="/download" className="landing-platform-card">
              <div className="landing-platform-icon">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/>
                </svg>
              </div>
              <span className="landing-platform-label">{t('landing.platforms.downloadMac')}</span>
            </a>
            <a href="/download" className="landing-platform-card">
              <div className="landing-platform-icon">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M3 5.548L10.475 4.61v6.638H3V5.548zM3 18.452L10.475 19.39v-6.638H3v5.7zm8.166 1.047L21 21V12.752H11.166v6.747zM11.166 4.51v6.738H21V3L11.166 4.51z"/>
                </svg>
              </div>
              <span className="landing-platform-label">{t('landing.platforms.downloadWindows')}</span>
            </a>
          </div>
          <p className="landing-pwa-note">{t('landing.platforms.pwa')}</p>
        </div>
      </section>

      {/* Section 7: Pricing */}
      <section className="landing-section landing-pricing">
        <div className="landing-container">
          <h2 className="landing-section-headline">{t('landing.pricing.headline')}</h2>
          <div className="landing-pricing-content">
            <p className="landing-pricing-line">{t('landing.pricing.personal')}</p>
            <p className="landing-pricing-line landing-pricing-line--muted">{t('landing.pricing.commercial')}</p>
            <div className="landing-pricing-support">
              <span>{t('landing.pricing.support')}</span>
              <a
                href="https://www.buymeacoffee.com/ahmad3"
                target="_blank"
                rel="noopener noreferrer"
                className="landing-btn landing-btn--coffee"
              >
                {t('landing.pricing.supportCta')}
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* Section 8: FAQ */}
      <section className="landing-section landing-faq">
        <div className="landing-container">
          <h2 className="landing-section-headline">{t('landing.faq.headline')}</h2>
          <div className="landing-faq-list">
            {faqItems.map((item, index) => (
              <FAQItem
                key={index}
                question={item.question}
                answer={item.answer}
                isOpen={openFaq === index}
                onToggle={() => toggleFaq(index)}
              />
            ))}
          </div>
        </div>
      </section>

      {/* Section 9: Final CTA */}
      <section className="landing-section landing-final-cta">
        <div className="landing-container">
          <h2 className="landing-section-headline">{t('landing.finalCta.headline')}</h2>
          <p className="landing-trust">{t('landing.finalCta.trust')}</p>
          <div className="landing-final-actions">
            <a href="/app" className="landing-btn landing-btn--primary">
              {t('landing.hero.ctaPrimary')}
            </a>
            <a href="/download" className="landing-btn landing-btn--secondary">
              {t('landing.hero.ctaSecondary')}
            </a>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="landing-footer">
        <div className="landing-container">
          <div className="landing-footer-content">
            <span className="landing-footer-brand">{t('landing.footer.copyright')}</span>
            <div className="landing-footer-links">
              <a
                href="https://github.com/vAWK3/mutaba3a"
                target="_blank"
                rel="noopener noreferrer"
              >
                {t('landing.footer.github')}
              </a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
