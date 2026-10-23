import type { RdapFacts } from './classify.js';

/**
 * MUT-367 (D4): when a domain was registered, from its registry's RDAP server. The server is found through IANA's
 * bootstrap file (RFC 9224), never a third-party redirector, and redirects are not followed: the only hosts this
 * ever asks are the registries IANA names. Only the domain name is sent, never the address.
 */
export const IANA_RDAP_BOOTSTRAP_URL = 'https://data.iana.org/rdap/dns.json';
const BOOTSTRAP_TTL_MS = 24 * 3_600_000;
const BOOTSTRAP_RETRY_MS = 10 * 60_000;

export interface RdapClient {
  /** The facts for `domain`; `signal` aborts at the screen's budget (→ timeout). Never throws. */
  lookup(domain: string, signal: AbortSignal): Promise<RdapFacts>;
}

export interface RdapClientOptions {
  fetch: typeof fetch;
  now: () => Date;
}

interface Bootstrap {
  /** TLD → the registry's base URL (https, ending in /). */
  bases: Map<string, string>;
  expiresAt: number;
}

export function createRdapClient(options: RdapClientOptions): RdapClient {
  const { fetch: fetchFn, now } = options;
  let bootstrap: Bootstrap | null = null;
  let pending: Promise<Bootstrap | null> | null = null;

  async function loadBootstrap(signal: AbortSignal): Promise<Bootstrap | null> {
    const at = now().getTime();
    if (bootstrap && bootstrap.expiresAt > at) return bootstrap;
    pending ??= (async () => {
      try {
        const res = await fetchFn(IANA_RDAP_BOOTSTRAP_URL, { signal, redirect: 'error', headers: { accept: 'application/json' } });
        if (!res.ok) throw new Error(`bootstrap ${res.status}`);
        bootstrap = { bases: parseBootstrap(await res.json()), expiresAt: at + BOOTSTRAP_TTL_MS };
      } catch {
        // Keep a stale copy if there is one; otherwise try again in a few minutes, not on every signup.
        bootstrap = bootstrap ? { ...bootstrap, expiresAt: at + BOOTSTRAP_RETRY_MS } : null;
      } finally {
        pending = null;
      }
      return bootstrap;
    })();
    return pending;
  }

  return {
    async lookup(domain, signal) {
      try {
        const loaded = await loadBootstrap(signal);
        if (signal.aborted) return { status: 'timeout' };
        if (!loaded) return { status: 'error' };
        const base = loaded.bases.get(domain.slice(domain.lastIndexOf('.') + 1));
        if (!base) return { status: 'unsupported-tld' };
        const res = await fetchFn(`${base}domain/${encodeURIComponent(domain)}`, { signal, redirect: 'error', headers: { accept: 'application/rdap+json' } });
        if (res.status === 404) return { status: 'not-found' };
        if (!res.ok) return { status: 'error' };
        return { status: 'found', registeredAt: registrationDateOf(await res.json()) };
      } catch {
        return signal.aborted ? { status: 'timeout' } : { status: 'error' };
      }
    },
  };
}

function parseBootstrap(json: unknown): Map<string, string> {
  const bases = new Map<string, string>();
  const services = (json as { services?: unknown }).services;
  if (!Array.isArray(services)) throw new Error('bootstrap has no services');
  for (const service of services) {
    if (!Array.isArray(service) || !Array.isArray(service[0]) || !Array.isArray(service[1])) continue;
    const base = (service[1] as unknown[]).find((u): u is string => typeof u === 'string' && u.startsWith('https://'));
    if (!base) continue;
    for (const tld of service[0] as unknown[]) if (typeof tld === 'string') bases.set(tld.toLowerCase(), base.endsWith('/') ? base : `${base}/`);
  }
  return bases;
}

function registrationDateOf(json: unknown): Date | null {
  const events = (json as { events?: unknown }).events;
  if (!Array.isArray(events)) return null;
  for (const event of events as Array<{ eventAction?: unknown; eventDate?: unknown }>) {
    if (event?.eventAction === 'registration' && typeof event.eventDate === 'string') {
      const date = new Date(event.eventDate);
      return Number.isNaN(date.getTime()) ? null : date;
    }
  }
  return null;
}
