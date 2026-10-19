/**
 * MUT-324 (ADR-102): the terms of service texts, one frozen file per version
 * and language (`terms/<YYYY-MM-DD>.<en|ar>.json`). A released file is never
 * edited: a new text is a new version, and the server's CURRENT_TERMS names
 * it (`scripts/__tests__/legal-terms.test.ts` keeps the two in step).
 * Loaded on demand, so the landing bundle carries none of them.
 */
export interface TermsText {
  version: string;
  title: string;
  updated: string;
  intro: string;
  sections: Array<{ title: string; body: string[] }>;
}

export type TermsLanguage = 'en' | 'ar';

const FILES = import.meta.glob<{ default: TermsText }>('./terms/*.json');
const FILE_OF = (version: string, language: TermsLanguage) => `./terms/${version}.${language}.json`;

/** Every released version, newest first. */
export const TERMS_VERSIONS: readonly string[] = [...new Set(Object.keys(FILES).map((path) => /(\d{4}-\d{2}-\d{2})\./.exec(path)?.[1] ?? ''))]
  .filter(Boolean)
  .sort()
  .reverse();

export const LATEST_TERMS_VERSION: string = TERMS_VERSIONS[0] ?? '';

/** The text of `version` in `language`; null for a version that doesn't exist. */
export async function loadTerms(version: string, language: TermsLanguage): Promise<TermsText | null> {
  const load = FILES[FILE_OF(version, language)];
  return load ? (await load()).default : null;
}

/** `/terms` → the latest version; `/terms/<version>` → that version (which may not exist); anything else → null. */
export function termsVersionOf(path: string): string | null {
  if (path === '/terms') return LATEST_TERMS_VERSION;
  const match = /^\/terms\/([^/]+)$/.exec(path);
  return match ? match[1]! : null;
}
