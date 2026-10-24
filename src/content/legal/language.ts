import { linkedLanguageOf } from '../../lib/i18n/linkLanguage';
import type { Language } from '../../lib/i18n/types';

/** The languages the legal texts are written in (MUT-324). */
export type LegalLanguage = Language;

/**
 * The `?lang` a link to /terms or /privacy names (MUT-324 review fix 1, MUT-356): the
 * portal's or the phone's language, which wins for the text only and is never stored.
 * Null when absent or not a language the texts are written in. One reader for every
 * link language (MUT-369): `linkedLanguageOf`.
 */
export const legalLanguageOf: (search: string) => LegalLanguage | null = linkedLanguageOf;
