/** The languages the legal texts are written in (MUT-324). */
export type LegalLanguage = 'en' | 'ar';

const LEGAL_LANGUAGES: readonly LegalLanguage[] = ['en', 'ar'];

/**
 * The `?lang` a link to /terms or /privacy names (MUT-324 review fix 1, MUT-356): the
 * portal's or the phone's language, which wins for the text only and is never stored.
 * Null when absent or not a language the texts are written in.
 */
export function legalLanguageOf(search: string): LegalLanguage | null {
  const lang = new URLSearchParams(search).get('lang');
  return LEGAL_LANGUAGES.find((l) => l === lang) ?? null;
}
