import { useLanguage } from '../../lib/i18n/core';
import type { Language } from '../../lib/i18n/types';
import { Wordmark as BrandWordmark } from '../../components/brand/Wordmark';
import { BrandName } from '../../components/brand/Logotype';

/** Sign-in, setup, terms-update and the boot screens: the Arabic name stays at today's 20px (design D3). */
const PAGE_MARK_SIZE = 40;

/**
 * The portal's lockup: the shared Brand v2 Wordmark with the portal's styles (MUT-104), naming the
 * product as the active language writes it, MTB3A or متابعة (MUT-402). The sidebar passes its own size.
 */
export function Wordmark({ className = '', markSize = PAGE_MARK_SIZE }: { className?: string; markSize?: number }) {
  const { language } = useLanguage();
  return (
    <BrandWordmark
      name={<BrandName language={language} />}
      markSize={markSize}
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
