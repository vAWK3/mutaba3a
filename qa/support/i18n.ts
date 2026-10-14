import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The app's Arabic copy, for specs that run in Arabic and must find controls
 * by their translated names. Read from the app's own translation file, so a
 * copy change never needs a spec change.
 */
const translations = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/lib/i18n/translations');

export const ar = JSON.parse(fs.readFileSync(path.join(translations, 'ar.json'), 'utf8'));
/** The English dictionary, for specs that assert copy in both languages (MUT-172). */
export const en = JSON.parse(fs.readFileSync(path.join(translations, 'en.json'), 'utf8'));
