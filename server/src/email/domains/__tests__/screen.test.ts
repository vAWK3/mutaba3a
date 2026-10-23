import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { classifyDomainFacts, type DomainFacts } from '../classify.js';
import { FIXTURE_DOMAINS, createFixtureDomainChecker } from '../fixture-checker.js';
import { CachedDomainChecker, createDomainScreen, type DomainChecker } from '../screen.js';

const NOW = new Date('2026-10-23T09:00:00Z');
const DAY = 86_400_000;
const logger = pino({ level: 'silent' });

const healthy = (overrides: Partial<DomainFacts> = {}): DomainFacts => ({
  mx: 'present',
  apex: 'present',
  www: 'present',
  rdap: { status: 'found', registeredAt: new Date(NOW.getTime() - 400 * DAY) },
  timedOut: false,
  ...overrides,
});

describe('classifyDomainFacts (MUT-367 §3.1)', () => {
  it('business needs an MX, a resolving apex or www, and an RDAP registration at least 90 days old', () => {
    expect(classifyDomainFacts(healthy(), NOW)).toEqual({ kind: 'classified', domainClass: 'BUSINESS', reasons: [] });
    expect(classifyDomainFacts(healthy({ apex: 'none' }), NOW)).toMatchObject({ domainClass: 'BUSINESS' });
    expect(classifyDomainFacts(healthy({ rdap: { status: 'found', registeredAt: new Date(NOW.getTime() - 90 * DAY) } }), NOW)).toMatchObject({ domainClass: 'BUSINESS' });
  });

  it('a young domain names its age', () => {
    const young = healthy({ rdap: { status: 'found', registeredAt: new Date(NOW.getTime() - 12 * DAY - 3_600_000) } });
    expect(classifyDomainFacts(young, NOW)).toEqual({ kind: 'classified', domainClass: 'BUSINESS_UNVERIFIED', reasons: ['rdap-age-12d'] });
  });

  it('refuses no-mail only on a definite answer: a null MX, or no MX and no address', () => {
    expect(classifyDomainFacts(healthy({ mx: 'null' }), NOW)).toEqual({ kind: 'refused', reason: 'no-mail' });
    expect(classifyDomainFacts(healthy({ mx: 'none', apex: 'none' }), NOW)).toEqual({ kind: 'refused', reason: 'no-mail' });
    // An A record is the implicit MX (RFC 5321 §5.1): mail can arrive, so it is not refused, only unverified.
    expect(classifyDomainFacts(healthy({ mx: 'none' }), NOW)).toEqual({ kind: 'classified', domainClass: 'BUSINESS_UNVERIFIED', reasons: ['no-mx'] });
    // D24: a resolver failure never refuses anyone.
    expect(classifyDomainFacts(healthy({ mx: 'unknown', apex: 'unknown', www: 'unknown' }), NOW)).toMatchObject({ domainClass: 'BUSINESS_UNVERIFIED', reasons: ['dns-unavailable'] });
  });

  it('names every failed check, once each', () => {
    const facts = healthy({ www: 'none', apex: 'none', mx: 'present', rdap: { status: 'unsupported-tld' } });
    expect(classifyDomainFacts(facts, NOW)).toEqual({ kind: 'classified', domainClass: 'BUSINESS_UNVERIFIED', reasons: ['no-web', 'rdap-unsupported-tld'] });
    expect(classifyDomainFacts(healthy({ rdap: { status: 'timeout' }, timedOut: true }), NOW)).toMatchObject({ reasons: ['timeout'] });
    expect(classifyDomainFacts(healthy({ rdap: { status: 'found', registeredAt: null } }), NOW)).toMatchObject({ reasons: ['rdap-no-date'] });
    expect(classifyDomainFacts(healthy({ rdap: { status: 'not-found' } }), NOW)).toMatchObject({ reasons: ['rdap-not-found'] });
    expect(classifyDomainFacts(healthy({ rdap: { status: 'error' } }), NOW)).toMatchObject({ reasons: ['rdap-error'] });
  });
});

describe('createDomainScreen (MUT-367)', () => {
  const screen = (checker: DomainChecker = createFixtureDomainChecker(() => NOW)) => createDomainScreen({ checker, now: () => NOW, logger });

  it('A1: the fixture domains and the lists give the ticket’s outcomes', async () => {
    const s = screen();
    expect(await s.screen('x@mailinator.com')).toEqual({ kind: 'refused', reason: 'disposable' });
    expect(await s.screen('x@eu.mailinator.com')).toEqual({ kind: 'refused', reason: 'disposable' });
    expect(await s.screen('x@nomail.example')).toEqual({ kind: 'refused', reason: 'no-mail' });
    expect(await s.screen('x@business.example')).toEqual({ kind: 'classified', domain: 'business.example', domainClass: 'BUSINESS', reasons: [] });
    expect(await s.screen('x@gmail.com')).toEqual({ kind: 'classified', domain: 'gmail.com', domainClass: 'WEBMAIL', reasons: ['webmail'] });
    expect(await s.screen('x@young.example')).toEqual({ kind: 'classified', domain: 'young.example', domainClass: 'BUSINESS_UNVERIFIED', reasons: ['rdap-age-12d'] });
    expect(await s.screen('x@duck.com')).toEqual({ kind: 'classified', domain: 'duck.com', domainClass: 'BUSINESS_UNVERIFIED', reasons: ['relay'] });
    expect(await s.screen('x@unverified.example')).toMatchObject({ domainClass: 'BUSINESS_UNVERIFIED', reasons: ['timeout'] });
    expect(await s.screen('x@unlisted.example')).toMatchObject({ domainClass: 'BUSINESS_UNVERIFIED', reasons: ['rdap-not-found'] });
  });

  it('never asks the checker about a listed domain', async () => {
    const asked: string[] = [];
    const s = screen({ check: async (domain) => (asked.push(domain), FIXTURE_DOMAINS['business.example']!(NOW)) });
    await s.screen('x@gmail.com');
    await s.screen('x@yopmail.com');
    await s.screen('x@duck.com');
    expect(asked).toEqual([]);
  });

  it('D20: a checker that throws sends the address to review, never refuses it', async () => {
    const s = screen({ check: async () => { throw new Error('boom'); } });
    expect(await s.screen('x@firm.example')).toEqual({ kind: 'classified', domain: 'firm.example', domainClass: 'BUSINESS_UNVERIFIED', reasons: ['check-error'] });
  });
});

describe('CachedDomainChecker (D5)', () => {
  it('keeps definite facts 24 h and transient ones 10 min, and bounds its size', async () => {
    let clock = NOW.getTime();
    let calls = 0;
    let next: DomainFacts = healthy();
    const inner: DomainChecker = { check: async () => (calls++, next) };
    const cached = new CachedDomainChecker(inner, { now: () => new Date(clock), maxEntries: 2 });

    await cached.check('a.example');
    await cached.check('a.example');
    expect(calls).toBe(1);
    clock += 23 * 3_600_000;
    await cached.check('a.example');
    expect(calls).toBe(1);
    clock += 2 * 3_600_000;
    await cached.check('a.example');
    expect(calls).toBe(2);

    next = healthy({ mx: 'unknown' });
    await cached.check('b.example');
    clock += 11 * 60_000;
    await cached.check('b.example');
    expect(calls).toBe(4);

    await cached.check('c.example');
    await cached.check('d.example');
    expect(cached.size).toBeLessThanOrEqual(2);
  });
});
