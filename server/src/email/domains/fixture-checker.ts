import type { DomainFacts } from './classify.js';
import type { DomainChecker } from './screen.js';

/**
 * MUT-367 (D3): the checker tests, QA and development use (EMAIL_DOMAIN_CHECKER=fixture; production refuses it).
 * A fixed table of reserved `.example` domains (RFC 2606), so no real DNS or RDAP is ever asked. Webmail, relay and
 * disposable addresses come from the real lists in every mode (gmail.com, duck.com, mailinator.com …).
 *
 *   business.example, studio.example   BUSINESS (instant)
 *   young.example                      BUSINESS_UNVERIFIED [rdap-age-12d]
 *   unverified.example                 BUSINESS_UNVERIFIED [timeout]
 *   nomail.example                     refused no-mail
 *   anything else                      BUSINESS_UNVERIFIED [rdap-not-found]
 */
const DAY_MS = 86_400_000;
const established = (now: Date): DomainFacts => ({ mx: 'present', apex: 'present', www: 'present', rdap: { status: 'found', registeredAt: new Date(now.getTime() - 3 * 365 * DAY_MS) }, timedOut: false });

export const FIXTURE_DOMAINS: Readonly<Record<string, (now: Date) => DomainFacts>> = {
  'business.example': established,
  'studio.example': established,
  'young.example': (now) => ({ ...established(now), rdap: { status: 'found', registeredAt: new Date(now.getTime() - 12 * DAY_MS) } }),
  'unverified.example': () => ({ mx: 'unknown', apex: 'unknown', www: 'unknown', rdap: { status: 'timeout' }, timedOut: true }),
  'nomail.example': () => ({ mx: 'none', apex: 'none', www: 'none', rdap: { status: 'not-found' }, timedOut: false }),
};

const unlisted = (): DomainFacts => ({ mx: 'present', apex: 'present', www: 'present', rdap: { status: 'not-found' }, timedOut: false });

export function createFixtureDomainChecker(now: () => Date): DomainChecker {
  return { check: async (domain) => (FIXTURE_DOMAINS[domain] ?? unlisted)(now()) };
}
