/**
 * MUT-367 (ADR-159 §7a, ADR-177): what the facts about a domain mean for a signup. Pure: the facts come from a
 * `DomainChecker` (DNS and RDAP in production, a fixture in tests and QA).
 */

/** Stored on the SIGNUP token and the review row (Prisma `EmailDomainClass`). */
export type EmailDomainClass = 'BUSINESS' | 'BUSINESS_UNVERIFIED' | 'WEBMAIL';

export type DomainRefusal = 'disposable' | 'no-mail';

/** What a lookup found. `unknown` = the resolver failed or ran out of time (D24): never a reason to refuse. */
export type DnsPresence = 'present' | 'none' | 'unknown';

export type RdapFacts =
  | { status: 'found'; registeredAt: Date | null }
  | { status: 'not-found' | 'unsupported-tld' | 'error' | 'timeout' };

export interface DomainFacts {
  /** `null`: the domain publishes a null MX (RFC 7505), "this domain takes no mail". */
  mx: DnsPresence | 'null';
  /** A or AAAA on the domain itself (also the implicit MX, RFC 5321 §5.1). */
  apex: DnsPresence;
  www: DnsPresence;
  rdap: RdapFacts;
  /** The check's total budget ran out before every lookup answered. */
  timedOut: boolean;
}

export type FactsClassification =
  | { kind: 'refused'; reason: DomainRefusal }
  | { kind: 'classified'; domainClass: Exclude<EmailDomainClass, 'WEBMAIL'>; reasons: string[] };

/** ADR-159 §7a: a domain registered more recently than this waits for review. */
export const MIN_DOMAIN_AGE_DAYS = 90;
const DAY_MS = 86_400_000;

export function classifyDomainFacts(facts: DomainFacts, now: Date): FactsClassification {
  if (facts.mx === 'null' || (facts.mx === 'none' && facts.apex === 'none')) return { kind: 'refused', reason: 'no-mail' };
  const reasons = new Set<string>();
  if (facts.mx === 'none') reasons.add('no-mx');
  if (facts.apex === 'none' && facts.www === 'none') reasons.add('no-web');
  if (facts.mx === 'unknown' || (facts.apex !== 'present' && facts.www !== 'present' && (facts.apex === 'unknown' || facts.www === 'unknown'))) {
    reasons.add(facts.timedOut ? 'timeout' : 'dns-unavailable');
  }
  const rdap = rdapReason(facts.rdap, now);
  if (rdap) reasons.add(rdap);
  if (facts.timedOut && reasons.size === 0) reasons.add('timeout');
  return reasons.size === 0 ? { kind: 'classified', domainClass: 'BUSINESS', reasons: [] } : { kind: 'classified', domainClass: 'BUSINESS_UNVERIFIED', reasons: [...reasons] };
}

function rdapReason(rdap: RdapFacts, now: Date): string | null {
  switch (rdap.status) {
    case 'found': {
      if (!rdap.registeredAt) return 'rdap-no-date';
      const days = Math.floor((now.getTime() - rdap.registeredAt.getTime()) / DAY_MS);
      return days >= MIN_DOMAIN_AGE_DAYS ? null : `rdap-age-${Math.max(0, days)}d`;
    }
    case 'timeout':
      return 'timeout';
    default:
      return `rdap-${rdap.status}`;
  }
}

/** Whether facts may be kept for a day (D5): anything a retry could change is transient. */
export function isTransient(facts: DomainFacts): boolean {
  return facts.timedOut || facts.mx === 'unknown' || facts.apex === 'unknown' || facts.www === 'unknown' || facts.rdap.status === 'error' || facts.rdap.status === 'timeout';
}
