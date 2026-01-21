import { useCallback } from 'react';
import { useT, useLanguage } from '../../../lib/i18n';

export function LandingHeader() {
  const t = useT();
  const { language, setLanguage } = useLanguage();

  const toggleLanguage = useCallback(() => {
    setLanguage(language === 'en' ? 'ar' : 'en');
  }, [language, setLanguage]);

  return (
    <header className="landing-header">
      <button
        className="landing-lang-toggle"
        onClick={toggleLanguage}
        aria-label="Toggle language"
      >
        <span className={language === 'en' ? 'active' : ''}>
          {t('landing.langToggle.en')}
        </span>
        <span className="landing-lang-divider">|</span>
        <span className={language === 'ar' ? 'active' : ''}>
          {t('landing.langToggle.ar')}
        </span>
      </button>
    </header>
  );
}
