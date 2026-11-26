import { getLocale } from '../../lib/i18n/core';
import type { Language } from '../../lib/i18n/types';

/**
 * MUT-362: the billing-address countries for Settings › Billing's Subscribe step. Codes are ISO 3166-1 alpha-2, what
 * Stripe and the server read; names come from `Intl.DisplayNames` in the reader's language, except Palestine (design
 * review DR13), which the browser calls "Palestinian Territories" / "الأراضي الفلسطينية". The region comes first
 * (DR11); there is no default, so nobody is put on the wrong currency or tax rules by a guess.
 */

const FIRST = ['IL', 'PS', 'JO', 'AE', 'SA', 'QA', 'KW', 'BH', 'OM'] as const;

const NAME_OVERRIDES: Readonly<Record<string, Partial<Record<Language, string>>>> = {
  PS: { ar: 'فلسطين', en: 'Palestine' },
};

export const BILLING_COUNTRY_CODES: readonly string[] = (
  'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ ' +
  'CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR ' +
  'GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO ' +
  'JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR ' +
  'MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO ' +
  'RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV ' +
  'TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW'
).split(' ');

export interface CountryOption {
  code: string;
  name: string;
}

export function countryName(code: string, language: Language): string {
  return NAME_OVERRIDES[code]?.[language] ?? new Intl.DisplayNames([getLocale(language)], { type: 'region' }).of(code) ?? code;
}

export function countryOptions(language: Language): CountryOption[] {
  const first = FIRST.map((code) => ({ code, name: countryName(code, language) }));
  const firstCodes = new Set<string>(FIRST);
  const collator = new Intl.Collator(getLocale(language));
  const rest = BILLING_COUNTRY_CODES.filter((code) => !firstCodes.has(code))
    .map((code) => ({ code, name: countryName(code, language) }))
    .sort((a, b) => collator.compare(a.name, b.name));
  return [...first, ...rest];
}

/**
 * MUT-702 Part B (Basel, 2026-11-26): the billing address's country is typed, not picked from a list. What the person
 * types is matched against every country's Arabic and English names (and its two-letter code); only a match counts,
 * because the country sets the currency and the VAT.
 */
const LANGUAGES: readonly Language[] = ['ar', 'en'];

/** Case, accents, Arabic short vowels and hamza forms, and a leading «ال», ignored. */
export function foldCountryText(text: string): string {
  const folded = text
    .normalize('NFKD')
    .replace(/[̀-ًͯ-ٰٟ]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .toLowerCase()
    .replace(/[^\p{L}\p{N} ]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return folded.startsWith('ال') ? folded.slice(2) : folded;
}

let folded: Array<{ code: string; names: string[] }> | null = null;

function foldedNames(): Array<{ code: string; names: string[] }> {
  folded ??= BILLING_COUNTRY_CODES.map((code) => ({ code, names: [code.toLowerCase(), ...LANGUAGES.map((language) => foldCountryText(countryName(code, language)))] }));
  return folded;
}

/** The country the text names exactly (in Arabic, English, or its code); null otherwise. */
export function matchCountry(text: string): string | null {
  const typed = foldCountryText(text);
  if (typed === '') return null;
  return foldedNames().find((c) => c.names.includes(typed))?.code ?? null;
}

/** Countries whose name (or a word of it) starts with the text, the region first, named in the reader's language. */
export function countrySuggestions(text: string, language: Language, limit = 6): CountryOption[] {
  const typed = foldCountryText(text);
  if (typed === '') return [];
  const hits = new Set(foldedNames().filter((c) => c.names.some((name) => name.startsWith(typed) || name.split(' ').some((word) => word.startsWith(typed)))).map((c) => c.code));
  return countryOptions(language)
    .filter((o) => hits.has(o.code))
    .slice(0, limit);
}
