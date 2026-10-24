import { Resolver } from 'node:dns/promises';
import type { DnsPresence, DomainFacts, RdapFacts } from './classify.js';
import type { RdapClient } from './rdap.js';
import type { DomainChecker } from './screen.js';

/**
 * MUT-367 (ADR-159 §7a): the production checker (EMAIL_DOMAIN_CHECKER=dns). DNS and RDAP only: the server never
 * fetches the domain's website (SSRF). Every lookup runs at once under one budget (2 s); whatever hasn't answered
 * by then is `unknown` (RDAP: `timeout`), and the resolver's outstanding queries are cancelled.
 *
 * D24: only ENOTFOUND and ENODATA mean "no such record". SERVFAIL, REFUSED, a timeout or a dead resolver are
 * `unknown`, which never refuses anyone and is cached for minutes, not a day.
 */
export const DOMAIN_CHECK_BUDGET_MS = 2000;

/** The slice of node:dns/promises' Resolver this uses; one per check, so `cancel` stops only this check's queries. */
export interface DnsResolverLike {
  resolveMx(name: string): Promise<{ exchange: string; priority: number }[]>;
  resolve4(name: string): Promise<string[]>;
  resolve6(name: string): Promise<string[]>;
  cancel(): void;
}

export interface DnsDomainCheckerOptions {
  /** A fresh resolver per check. Defaults to the system's, one try each, timing out with the budget. */
  resolver?: () => DnsResolverLike;
  rdap: RdapClient;
  budgetMs?: number;
}

const ABSENT = new Set(['ENOTFOUND', 'ENODATA']);
const TIMED_OUT = Symbol('timed out');

export function createDnsDomainChecker(options: DnsDomainCheckerOptions): DomainChecker {
  const budgetMs = options.budgetMs ?? DOMAIN_CHECK_BUDGET_MS;
  const newResolver = options.resolver ?? (() => new Resolver({ timeout: budgetMs, tries: 1 }));

  return {
    async check(domain) {
      const resolver = newResolver();
      const abort = new AbortController();
      let timer: NodeJS.Timeout | undefined;
      const deadline = new Promise<typeof TIMED_OUT>((resolve) => {
        timer = setTimeout(() => resolve(TIMED_OUT), budgetMs);
      });
      const within = <T>(work: Promise<T>) => Promise.race([work, deadline]);

      const [mx, apex4, apex6, www4, www6, rdap] = await Promise.all([
        within(lookup(() => resolver.resolveMx(domain))),
        within(lookup(() => resolver.resolve4(domain))),
        within(lookup(() => resolver.resolve6(domain))),
        within(lookup(() => resolver.resolve4(`www.${domain}`))),
        within(lookup(() => resolver.resolve6(`www.${domain}`))),
        within(options.rdap.lookup(domain, abort.signal)),
      ]);
      clearTimeout(timer);
      const results = [mx, apex4, apex6, www4, www6, rdap];
      const timedOut = results.some((r) => r === TIMED_OUT);
      if (timedOut) {
        abort.abort();
        resolver.cancel();
      }
      return {
        mx: mxPresence(mx),
        apex: either(presence(apex4), presence(apex6)),
        www: either(presence(www4), presence(www6)),
        rdap: rdap === TIMED_OUT ? { status: 'timeout' } : (rdap as RdapFacts),
        timedOut,
      };
    },
  };
}

type Lookup<T> = { ok: true; records: T[] } | { ok: false; absent: boolean };

async function lookup<T>(run: () => Promise<T[]>): Promise<Lookup<T>> {
  try {
    return { ok: true, records: await run() };
  } catch (err) {
    return { ok: false, absent: ABSENT.has((err as { code?: string }).code ?? '') };
  }
}

function presence(result: Lookup<unknown> | typeof TIMED_OUT): DnsPresence {
  if (result === TIMED_OUT) return 'unknown';
  if (result.ok) return result.records.length > 0 ? 'present' : 'none';
  return result.absent ? 'none' : 'unknown';
}

/** RFC 7505: a single MX whose exchange is the root ("." — Node reports "") says the domain takes no mail. */
function mxPresence(result: Lookup<{ exchange: string }> | typeof TIMED_OUT): DomainFacts['mx'] {
  if (result !== TIMED_OUT && result.ok && result.records.length > 0 && result.records.every((r) => r.exchange === '' || r.exchange === '.')) return 'null';
  return presence(result);
}

/** A or AAAA: present if either is, none only if both are definitely absent. */
function either(a: DnsPresence, b: DnsPresence): DnsPresence {
  if (a === 'present' || b === 'present') return 'present';
  return a === 'none' && b === 'none' ? 'none' : 'unknown';
}
