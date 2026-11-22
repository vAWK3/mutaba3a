/** MUT-646: the setup's five steps, in order; details and numbering are the two issuing waits for (S1-a). */
export type SetupStep = 'details' | 'logo' | 'defaults' | 'numbering' | 'taxAuthority';
export const SETUP_STEPS: readonly SetupStep[] = ['details', 'logo', 'defaults', 'numbering', 'taxAuthority'];
export const REQUIRED_STEPS: ReadonlySet<SetupStep> = new Set(['details', 'numbering']);

/** The API's ink values (black or blue on white paper, MUT-640): wire values that happen to name colours. */
export const INKS = ['BLACK', 'BLUE'] as const;
export type Ink = (typeof INKS)[number];
export const DEFAULT_INK: Ink = INKS[0];

/** What the letterhead shows: the saved details with the open step's typing over them. */
export interface PaperModel {
  legalName: string;
  vatId: string;
  dealerType: 'LICENSED' | 'EXEMPT' | 'COMPANY' | 'NONPROFIT';
  address: string;
  city: string;
  phone: string;
  email: string;
  style: 'PROFESSIONAL' | 'MODERN' | 'MINIMAL';
  ink: Ink;
  language: 'he' | 'ar' | 'en';
  bankDetails: string;
  footerNote: string;
  logoUrl: string | null;
  nextNumber: number;
}

/** A typed whole number (a document number, a count of days), or null when it is anything else. */
export function wholeNumber(raw: string): number | null {
  const digits = raw.trim();
  // Not an amount: a count, already checked to be at most 9 digits.
  // eslint-disable-next-line no-restricted-syntax
  return /^\d{1,9}$/.test(digits) ? Number.parseInt(digits, 10) : null;
}

/** MUT-571 AC3: the consent lasts 90 days; from this many days before its end the step asks to connect again (the mail's day). */
export const RECONNECT_NOTICE_DAYS = 10;

/** The connection ends within RECONNECT_NOTICE_DAYS of `now` (and hasn't yet: an ended one reads `expired`). */
export function endsSoon(until: string | null | undefined, now: Date = new Date()): boolean {
  if (!until) return false;
  const left = new Date(until).getTime() - now.getTime();
  return left > 0 && left <= RECONNECT_NOTICE_DAYS * 86_400_000;
}
