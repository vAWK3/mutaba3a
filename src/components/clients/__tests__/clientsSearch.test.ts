/**
 * MUT-84: the Clients list's search and sort are one model in the URL, so
 * they survive opening one client after another beside the list, Back and a
 * reload. With no parameters the list is as before: owed now, descending.
 */
import { describe, it, expect } from 'vitest';
import { parseClientsSearch, mergeClientsSearch, resolveClientsSearch } from '../clientsSearch';

describe('parseClientsSearch', () => {
  it('reads nothing from an empty URL', () => {
    expect(parseClientsSearch({})).toEqual({});
  });

  it('keeps a search, a sort column and a direction', () => {
    expect(parseClientsSearch({ q: 'acme', sort: 'lastPayment', dir: 'asc' })).toEqual({
      q: 'acme',
      sort: 'lastPayment',
      dir: 'asc',
    });
  });

  it('accepts every sort column', () => {
    for (const sort of ['name', 'owed', 'overdue', 'lastPayment', 'activity']) {
      expect(parseClientsSearch({ sort }).sort).toBe(sort);
    }
  });

  it('drops values it does not know, so a hand-edited link never breaks the list', () => {
    expect(parseClientsSearch({ sort: 'balance', dir: 'up', other: 'x' })).toEqual({});
  });

  it('reads a numeric search back as text', () => {
    expect(parseClientsSearch({ q: 2026 })).toEqual({ q: '2026' });
  });

  it('drops an empty search', () => {
    expect(parseClientsSearch({ q: '' })).toEqual({});
  });
});

describe('mergeClientsSearch', () => {
  it('applies a change and keeps the other fields', () => {
    expect(mergeClientsSearch({ q: 'acme' }, { sort: 'name', dir: 'asc' })).toEqual({ q: 'acme', sort: 'name', dir: 'asc' });
  });

  it('removes a cleared search', () => {
    expect(mergeClientsSearch({ q: 'acme', sort: 'name' }, { q: '' })).toEqual({ sort: 'name' });
  });

  it('writes only what differs from the defaults (owed now, descending)', () => {
    expect(mergeClientsSearch({ sort: 'name', dir: 'asc' }, { sort: 'owed', dir: 'desc' })).toEqual({});
    expect(mergeClientsSearch({}, { sort: 'owed', dir: 'asc' })).toEqual({ dir: 'asc' });
    expect(mergeClientsSearch({}, { sort: 'name', dir: 'desc' })).toEqual({ sort: 'name' });
  });
});

describe('resolveClientsSearch', () => {
  it('fills in the defaults: owed now, descending, no search', () => {
    expect(resolveClientsSearch({})).toEqual({ q: '', sort: 'owed', dir: 'desc' });
  });

  it('keeps what the URL says', () => {
    expect(resolveClientsSearch({ q: 'acme', sort: 'name', dir: 'asc' })).toEqual({ q: 'acme', sort: 'name', dir: 'asc' });
  });
});
