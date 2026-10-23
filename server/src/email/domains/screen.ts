import { domainToASCII } from 'node:url';
import type { Logger } from '../../logger.js';
import { classifyDomainFacts, isTransient, type DomainFacts, type DomainRefusal, type EmailDomainClass } from './classify.js';
import { isDomainName, isListedDomain, loadDomainList } from './lists.js';

/**
 * MUT-367 (ADR-159 §7a, ADR-177): the screen `POST /v1/signups` runs on every address, account or not.
 *
 *   1. disposable list (the domain or a parent)  → refused  `disposable`
 *   2. free-webmail list                         → WEBMAIL  [webmail]               (review)
 *   3. relay list (D23)                          → BUSINESS_UNVERIFIED [relay]      (review)
 *   4. the checker's facts (DNS + RDAP, 2 s)     → refused `no-mail`, BUSINESS (instant), or BUSINESS_UNVERIFIED
 *
 * A checker that throws is BUSINESS_UNVERIFIED [check-error] (D20): the screen never blocks a signup on its own
 * failure. Logs carry the domain's class, never the address.
 */
export interface DomainChecker {
  check(domain: string): Promise<DomainFacts>;
}

export type DomainScreenResult =
  | { kind: 'refused'; reason: DomainRefusal }
  | { kind: 'classified'; domain: string; domainClass: EmailDomainClass; reasons: string[] };

export interface DomainScreen {
  screen(email: string): Promise<DomainScreenResult>;
}

export interface DomainScreenOptions {
  checker: DomainChecker;
  now: () => Date;
  logger: Logger;
}

export function createDomainScreen(options: DomainScreenOptions): DomainScreen {
  const { checker, now, logger } = options;
  return {
    async screen(email) {
      const domain = domainOf(email);
      if (isListedDomain(domain, loadDomainList('disposable'))) return { kind: 'refused', reason: 'disposable' };
      if (isListedDomain(domain, loadDomainList('free-webmail'))) return { kind: 'classified', domain, domainClass: 'WEBMAIL', reasons: ['webmail'] };
      if (isListedDomain(domain, loadDomainList('relay'))) return { kind: 'classified', domain, domainClass: 'BUSINESS_UNVERIFIED', reasons: ['relay'] };
      if (!isDomainName(domain)) return { kind: 'classified', domain, domainClass: 'BUSINESS_UNVERIFIED', reasons: ['invalid-domain'] };
      let facts: DomainFacts;
      try {
        facts = await checker.check(domain);
      } catch (err) {
        logger.warn({ err }, 'signup domain check failed; the signup waits for review');
        return { kind: 'classified', domain, domainClass: 'BUSINESS_UNVERIFIED', reasons: ['check-error'] };
      }
      const result = classifyDomainFacts(facts, now());
      return result.kind === 'refused' ? result : { kind: 'classified', domain, domainClass: result.domainClass, reasons: result.reasons };
    },
  };
}

/** The address's domain, punycode for an IDN, so lists, DNS and RDAP all see one spelling. */
export function domainOf(email: string): string {
  const raw = email.slice(email.lastIndexOf('@') + 1).toLowerCase().replace(/\.$/, '');
  return domainToASCII(raw) || raw;
}

/** D5: definite facts are kept 24 h, transient ones 10 min; at most `maxEntries` domains (oldest dropped first). */
export const DOMAIN_CACHE_POLICY = { definiteMs: 24 * 3_600_000, transientMs: 10 * 60_000, maxEntries: 10_000 } as const;

export class CachedDomainChecker implements DomainChecker {
  private readonly entries = new Map<string, { facts: DomainFacts; expiresAt: number }>();
  private readonly now: () => Date;
  private readonly maxEntries: number;

  constructor(
    private readonly inner: DomainChecker,
    options: { now: () => Date; maxEntries?: number },
  ) {
    this.now = options.now;
    this.maxEntries = options.maxEntries ?? DOMAIN_CACHE_POLICY.maxEntries;
  }

  get size(): number {
    return this.entries.size;
  }

  async check(domain: string): Promise<DomainFacts> {
    const at = this.now().getTime();
    const hit = this.entries.get(domain);
    if (hit && hit.expiresAt > at) return hit.facts;
    const facts = await this.inner.check(domain);
    this.entries.delete(domain);
    this.entries.set(domain, { facts, expiresAt: at + (isTransient(facts) ? DOMAIN_CACHE_POLICY.transientMs : DOMAIN_CACHE_POLICY.definiteMs) });
    while (this.entries.size > this.maxEntries) this.entries.delete(this.entries.keys().next().value!);
    return facts;
  }
}
