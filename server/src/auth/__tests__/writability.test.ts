import { describe, expect, it } from 'vitest';
import { mayWriteFor, PROFILE_DEPENDENT_DOMAINS, sessionAccessFor, sessionScopesFor, type Domain } from '../writability.js';

/**
 * MUT-65: the per-profile writability mechanism layered on top of the static
 * matrix (hosted-portal.md §5a amendment, ADR-037 decision 7). A personal
 * profile (profileWriter === null) gains write on exactly three rows —
 * customers, projects, payments; every other row, and every Malafat-fed
 * profile, is unchanged from MUT-39/42.
 */
describe('sessionAccessFor', () => {
  it('grants read-write on a personal profile and read on a Malafat-fed one, for the three profile-dependent rows', () => {
    for (const domain of ['customers', 'projects', 'payments'] as const) {
      expect(sessionAccessFor(domain, null)).toBe('read-write');
      expect(sessionAccessFor(domain, 'MALAFAT')).toBe('read');
    }
  });

  it('is unchanged by profile for every other row', () => {
    for (const domain of ['agreements', 'attachments', 'integration', 'audit', 'summaries', 'identity'] as const) {
      expect(sessionAccessFor(domain, null)).toBe(sessionAccessFor(domain, 'MALAFAT'));
    }
    expect(sessionAccessFor('agreements', null)).toBe('read');
  });

  it('is a regression guard: expenses stays profile-independent (already session read-write before this ticket)', () => {
    expect(sessionAccessFor('expenses', null)).toBe('read-write');
    expect(sessionAccessFor('expenses', 'MALAFAT')).toBe('read-write');
  });
});

describe('PROFILE_DEPENDENT_DOMAINS', () => {
  it('is exactly customers, projects, payments — nothing else silently became profile-dependent', () => {
    expect([...PROFILE_DEPENDENT_DOMAINS].sort()).toEqual(['customers', 'payments', 'projects']);
  });
});

describe('sessionScopesFor', () => {
  it('on a personal profile: includes customers/projects/payments write, and expenses write (unchanged)', () => {
    const scopes = sessionScopesFor(null);
    expect(scopes).toEqual(expect.arrayContaining(['customers:write', 'projects:write', 'payments:write', 'expenses:write']));
  });

  it('on a Malafat-fed profile: excludes customers/projects/payments write, but still includes expenses:write and the three domains’ :read scopes', () => {
    const scopes = sessionScopesFor('MALAFAT');
    expect(scopes).not.toEqual(expect.arrayContaining(['customers:write']));
    expect(scopes).not.toEqual(expect.arrayContaining(['projects:write']));
    expect(scopes).not.toEqual(expect.arrayContaining(['payments:write']));
    expect(scopes).toEqual(expect.arrayContaining(['expenses:write', 'customers:read', 'projects:read', 'payments:read']));
  });
});

describe('mayWriteFor', () => {
  it('a session may write payments/customers/projects on a personal profile, not on a Malafat-fed one', () => {
    for (const domain of ['payments', 'customers', 'projects'] as const) {
      expect(mayWriteFor('session', domain, null)).toBe(true);
      expect(mayWriteFor('session', domain, 'MALAFAT')).toBe(false);
    }
  });

  it('an API key’s write access is untouched on every profile, for every domain (ADR-037 decision 7 is unchanged there)', () => {
    const domains: Domain[] = ['integration', 'customers', 'projects', 'agreements', 'payments', 'attachments', 'summaries', 'audit', 'expenses', 'identity'];
    for (const domain of domains) {
      expect(mayWriteFor('apiKey', domain, null)).toBe(mayWriteFor('apiKey', domain, 'MALAFAT'));
    }
    expect(mayWriteFor('apiKey', 'payments', null)).toBe(true);
    expect(mayWriteFor('apiKey', 'payments', 'MALAFAT')).toBe(true);
  });

  it('a profile-independent domain (agreements) is never writable by a session, on any profile — the three named rows are the only ones that changed', () => {
    expect(mayWriteFor('session', 'agreements', null)).toBe(false);
    expect(mayWriteFor('session', 'agreements', 'MALAFAT')).toBe(false);
  });
});
