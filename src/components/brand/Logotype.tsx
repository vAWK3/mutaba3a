import type { Language } from '../../lib/i18n/types';
import './Logotype.css';

/** The product's English name: always MTB3A, in capitals, in every language's page (MUT-400). */
const NAME_EN = 'MTB3A';
/** The product's Arabic name: always متابعة, written as live text (MUT-400). */
const NAME_AR = 'متابعة';

interface NameProps {
  className?: string;
}

/**
 * The MTB3A logotype (MUT-401's outlined Thmanyah Serif Display): one image,
 * painted by Logotype.css as a mask in the text colour, so it follows the theme,
 * links and forced colours. `lang` lets a screen reader on an Arabic page read
 * it with the English voice (design D13).
 */
export function Logotype({ className = '' }: NameProps) {
  return <span className={`logotype ${className}`.trim()} role="img" aria-label={NAME_EN} lang="en" />;
}

/** The brand name as a language writes it: the logotype in English, live متابعة in Arabic (MUT-402 D1). */
export function BrandName({ language, className = '' }: NameProps & { language: Language }) {
  if (language === 'en') return <Logotype className={className} />;
  return (
    <span className={`brand-name-ar ${className}`.trim()} lang="ar">
      {NAME_AR}
    </span>
  );
}
