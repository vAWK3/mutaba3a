import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The app's Arabic copy, for specs that run in Arabic and must find controls
 * by their translated names. Read from the app's own translation files, so a
 * copy change never needs a spec change.
 */
const translations = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/lib/i18n/translations');

/** A language's per-feature files joined into one dictionary, as the app's barrel does (MUT-24). */
function dictionary(language: 'en' | 'ar') {
  const dir = path.join(translations, language);
  const files = fs.readdirSync(dir).filter((file) => file.endsWith('.json'));
  return Object.assign({}, ...files.map((file) => JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'))));
}

export const ar = dictionary('ar');
/** The English dictionary, for specs that assert copy in both languages (MUT-172). */
export const en = dictionary('en');

/**
 * A language as a person chose it, the way the EN/AR switch or Settings leaves it (MUT-202). Without the
 * second key the marketing site ignores a stored language and opens in Arabic.
 */
export const LANGUAGE_KEYS = { language: 'mutaba3a-language', chosen: 'mutaba3a-language-chosen' } as const;

export function chooseLanguageScript([keys, language]: [typeof LANGUAGE_KEYS, 'en' | 'ar']): void {
  localStorage.setItem(keys.language, language);
  localStorage.setItem(keys.chosen, '1');
}

