import { readFileSync } from 'node:fs';

/**
 * MUT-367 (ADR-159 §7a, ADR-178): the vendored domain lists the signup screen reads. Plain text beside this module,
 * one lower-case domain per line, `# key: value` header lines (source, commit, fetched, licence) and comments.
 * `npm run build` copies them into dist next to the compiled module.
 *
 *   disposable.txt     refused (400 EMAIL_NOT_ACCEPTED, reason disposable); refreshed by `email-domains:update`
 *   free-webmail.txt   waits for the operator's review (reason webmail)
 *   relay.txt          forwarding and alias services: waits for review (reason relay, D23)
 */
export const DOMAIN_LIST_NAMES = ['disposable', 'free-webmail', 'relay'] as const;
export type DomainListName = (typeof DOMAIN_LIST_NAMES)[number];

/** A lower-case ASCII host name of two or more labels (an IDN arrives as punycode). */
const DOMAIN = /^(?=.{3,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9-]{2,63}$/;
const HEADER = /^#\s*([a-z]+):\s*(.+?)\s*$/;

export interface ParsedDomainList {
  header: Record<string, string>;
  domains: string[];
}

/** Throws on any line that isn't a comment, blank, or one valid lower-case domain: a bad refresh must not ship. */
export function parseDomainList(text: string): ParsedDomainList {
  const header: Record<string, string> = {};
  const domains: string[] = [];
  text.split('\n').forEach((raw, index) => {
    const line = raw.trim();
    if (line === '') return;
    if (line.startsWith('#')) {
      const match = HEADER.exec(line);
      if (match) header[match[1]!] ??= match[2]!;
      return;
    }
    if (line !== line.toLowerCase()) throw new Error(`line ${index + 1}: "${line}" must be lower-case`);
    if (!DOMAIN.test(line)) throw new Error(`line ${index + 1}: "${line}" is not a domain`);
    domains.push(line);
  });
  return { header, domains };
}

export function isDomainName(value: string): boolean {
  return DOMAIN.test(value);
}

const loaded = new Map<DomainListName, ReadonlySet<string>>();

/** Read once per process. */
export function loadDomainList(name: DomainListName): ReadonlySet<string> {
  let set = loaded.get(name);
  if (!set) {
    set = new Set(parseDomainList(readFileSync(new URL(`./${name}.txt`, import.meta.url), 'utf8')).domains);
    loaded.set(name, set);
  }
  return set;
}

/** The domain itself or any parent of it (on a label boundary) is listed: `eu.mailinator.com` is mailinator's. */
export function isListedDomain(domain: string, list: ReadonlySet<string>): boolean {
  for (let at = domain; at.includes('.'); at = at.slice(at.indexOf('.') + 1)) {
    if (list.has(at)) return true;
  }
  return false;
}
