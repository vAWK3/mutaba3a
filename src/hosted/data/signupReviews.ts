import type { SignupReview, SignupReviewDecision } from '../api/client';

/**
 * MUT-460 (design 13A, 18A): what a waiting signup's row says about it. Pure, so every rule is a unit test.
 *
 * The codes are the signup screen's (server/src/email/domains/screen.ts and classify.ts). Risky ones (no mail server, no
 * website, a relay, an invalid or young domain) are warnings; the rest are facts. A code this build doesn't know is shown
 * as the raw code, never dropped.
 */
export type ReviewChip =
  | { kind: 'known'; key: string; tone: 'warning' | 'neutral' }
  | { kind: 'age'; days: number; tone: 'warning' }
  | { kind: 'raw'; code: string };

const REASONS: Readonly<Record<string, { key: string; tone: 'warning' | 'neutral' }>> = {
  webmail: { key: 'webmail', tone: 'neutral' },
  relay: { key: 'relay', tone: 'warning' },
  'invalid-domain': { key: 'invalidDomain', tone: 'warning' },
  'check-error': { key: 'checkError', tone: 'neutral' },
  'no-mx': { key: 'noMx', tone: 'warning' },
  'no-web': { key: 'noWeb', tone: 'warning' },
  timeout: { key: 'timeout', tone: 'neutral' },
  'dns-unavailable': { key: 'dnsUnavailable', tone: 'neutral' },
  'rdap-no-date': { key: 'rdapNoDate', tone: 'neutral' },
  'rdap-not-found': { key: 'rdapNotFound', tone: 'neutral' },
  'rdap-unsupported-tld': { key: 'rdapUnsupportedTld', tone: 'neutral' },
  'rdap-error': { key: 'rdapError', tone: 'neutral' },
};
const DOMAIN_AGE = /^rdap-age-(\d+)d$/;
const CLASSES: Readonly<Record<SignupReview['classification'], { key: string; tone: 'warning' | 'neutral' }>> = {
  BUSINESS: { key: 'business', tone: 'neutral' },
  BUSINESS_UNVERIFIED: { key: 'unverified', tone: 'warning' },
  WEBMAIL: { key: 'webmail', tone: 'neutral' },
};

export function reviewChips(review: Pick<SignupReview, 'classification' | 'reasons'>): ReviewChip[] {
  if (review.reasons.length === 0) return [{ kind: 'known', ...CLASSES[review.classification] }];
  return review.reasons.map((code): ReviewChip => {
    const known = REASONS[code];
    if (known) return { kind: 'known', ...known };
    const age = DOMAIN_AGE.exec(code);
    // A day count, never an amount: the money rule's ban on parsing numbers doesn't apply.
    // eslint-disable-next-line no-restricted-syntax
    return age ? { kind: 'age', days: Number(age[1]), tone: 'warning' } : { kind: 'raw', code };
  });
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export interface Waiting {
  count: number;
  unit: 'minute' | 'hour' | 'day';
  /** 18A: a day or more earns the "waiting 1 day+" chip. */
  overADay: boolean;
}

/** How long a signup has waited, in the largest whole unit; never under a minute (a clock behind the server's). */
export function waitingOf(createdAt: string, now: Date): Waiting {
  const waited = Math.max(0, now.getTime() - Date.parse(createdAt));
  if (waited >= DAY_MS) return { count: Math.floor(waited / DAY_MS), unit: 'day', overADay: true };
  if (waited >= HOUR_MS) return { count: Math.floor(waited / HOUR_MS), unit: 'hour', overADay: false };
  return { count: Math.max(1, Math.floor(waited / MINUTE_MS)), unit: 'minute', overADay: false };
}

/** 9A: whether the person's mail went out (a duplicate is the same mail, already sent). */
export function mailWentOut(mail: SignupReviewDecision['mail']): boolean {
  return mail === 'sent' || mail === 'duplicate';
}
