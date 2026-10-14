import { useLanguage, useT } from '../../lib/i18n/core';
import type { Language } from '../../lib/i18n/types';
import { Wordmark as BrandWordmark } from '../../components/brand/Wordmark';

/** The portal's lockup: the shared Brand v2 Wordmark with the portal's name and styles (MUT-104). */
export function Wordmark({ className = '' }: { className?: string }) {
  return (
    <BrandWordmark
      name={useT()('hosted.brand')}
      className={`hp-wordmark ${className}`.trim()}
      markClassName="hp-wordmark-mark"
    />
  );
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
          className={language === option.value ? 'press hp-lang-on' : 'press'}
          onClick={() => setLanguage(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
