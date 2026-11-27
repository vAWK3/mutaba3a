/**
 * MUT-768 (accountant channel): the countries the Add customer drawer offers. The country sets the new account's
 * currency and time zone (the create route takes those two, not a country; the billing country is asked again at Take
 * card, B13). Palestine first: it is the accountant's usual market.
 */
export interface DeskCountry {
  code: 'PS' | 'IL' | 'JO';
  currency: 'ILS' | 'JOD';
  timezone: string;
}

export const DESK_COUNTRIES: readonly DeskCountry[] = [
  { code: 'PS', currency: 'ILS', timezone: 'Asia/Jerusalem' },
  { code: 'IL', currency: 'ILS', timezone: 'Asia/Jerusalem' },
  { code: 'JO', currency: 'JOD', timezone: 'Asia/Amman' },
];

export const DEFAULT_DESK_COUNTRY: DeskCountry['code'] = 'PS';

export const deskCountryOf = (code: string): DeskCountry => DESK_COUNTRIES.find((country) => country.code === code) ?? DESK_COUNTRIES[0]!;
