import { useLanguage, useT } from '../../lib/i18n/core';
import type { Language } from '../../lib/i18n/types';
import { BrandMark } from '../../components/brand/BrandMark';

/** The mark's size in the lockup, about the cap height of the 2xl name beside it. */
const WORDMARK_MARK_SIZE = 28;

/** The Brand v2 mark beside the product name (heading face in English, the Arabic face in Arabic; MUT-104). */
export function Wordmark({ className = '' }: { className?: string }) {
  return (
    <span className={`hp-wordmark ${className}`}>
      <BrandMark size={WORDMARK_MARK_SIZE} className="hp-wordmark-mark" />
      {useT()('hosted.brand')}
    </span>
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
