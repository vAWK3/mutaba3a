import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DOMAIN_LIST_NAMES, isListedDomain, loadDomainList, parseDomainList, type DomainListName } from '../lists.js';

/** MUT-367 (A5): the vendored lists parse, hold no duplicates, are sorted, and never overlap. */
const fileOf = (name: DomainListName) => readFileSync(new URL(`../${name}.txt`, import.meta.url), 'utf8');

describe('vendored domain lists (MUT-367)', () => {
  it.each(DOMAIN_LIST_NAMES)('%s parses, is sorted, has no duplicates, and names its source', (name) => {
    const parsed = parseDomainList(fileOf(name));
    expect(parsed.domains.length).toBeGreaterThan(10);
    expect(new Set(parsed.domains).size).toBe(parsed.domains.length);
    expect([...parsed.domains].sort()).toEqual(parsed.domains);
    for (const key of ['source', 'commit', 'fetched', 'licence']) expect(parsed.header[key], `${name} header ${key}`).toBeTruthy();
  });

  it('no domain is on two lists (a webmail domain is never refused as disposable)', () => {
    const seen = new Map<string, DomainListName>();
    for (const name of DOMAIN_LIST_NAMES) {
      for (const domain of loadDomainList(name)) {
        expect(seen.get(domain), `${domain} is on ${seen.get(domain)} and ${name}`).toBeUndefined();
        seen.set(domain, name);
      }
    }
  });

  it('pins the providers the decisions name', () => {
    expect(loadDomainList('free-webmail').has('gmail.com')).toBe(true);
    expect(loadDomainList('free-webmail').has('outlook.com')).toBe(true);
    expect(loadDomainList('disposable').has('mailinator.com')).toBe(true);
    expect(loadDomainList('relay').has('privaterelay.appleid.com')).toBe(true);
  });

  it('refuses a malformed line rather than skipping it', () => {
    expect(() => parseDomainList('# source: x\nexample.com\nnot a domain\n')).toThrow(/line 3/);
    expect(() => parseDomainList('Example.com\n')).toThrow(/lower-case/);
  });

  it('a listed domain covers its subdomains, and only on a label boundary', () => {
    const list = new Set(['mailinator.com']);
    expect(isListedDomain('mailinator.com', list)).toBe(true);
    expect(isListedDomain('eu.mailinator.com', list)).toBe(true);
    expect(isListedDomain('notmailinator.com', list)).toBe(false);
    expect(isListedDomain('com', list)).toBe(false);
  });
});
