import { useLanguage, useT } from '../../lib/i18n/core';
import type { Language } from '../../lib/i18n/types';

/** The product name as a wordmark (heading face in English, the Arabic face in Arabic). */
export function Wordmark({ className = '' }: { className?: string }) {
  return <span className={`hp-wordmark ${className}`}>{useT()('hosted.brand')}</span>;
}

const LANGUAGES: { value: Language; label: string }[] = [
  { value: 'en', label: 'EN' },
  { value: 'ar', label: 'عربي' },
];

/** EN | عربي. An explicit choice, so it persists in this browser (auth-states E4). */
export function LanguageSwitch() {
  const { language, setLanguage, t } = useLanguage();
  return (
    <div className="hp-lang" role="group" aria-label={t('hosted.shell.language')}>
      {LANGUAGES.map((option) => (
        <button
          key={option.value}
          type="button"
          lang={option.value}
          aria-pressed={language === option.value}
          className={language === option.value ? 'hp-lang-on' : undefined}
          onClick={() => setLanguage(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
