/**
 * @vitest-environment jsdom
 *
 * MUT-84 (ADR-050): the split view's keyboard rules, as pure functions.
 * Arrow keys follow the screen: in Arabic the profile sits on the left, so ←
 * moves into it and → comes back. The walk visits clients only; the muted
 * rows ("No client", "Archived clients") are not clients and are skipped.
 */
import { describe, it, expect, afterEach } from 'vitest';
import {
  listKeyAction,
  profileKeyAction,
  adjacentClientId,
  firstClientId,
  keyBelongsToControl,
  hasModifier,
  splitLayout,
  clientProfileRemountDeps,
} from '../clientsSplitView';
import type { ClientIndexItem, ClientIndexRow, OwedBucketRow } from '../clientIndexRows';

const client = (id: string): ClientIndexItem => ({
  type: 'client',
  row: { id, name: id, owed: [], isSettled: true, overdue: [], owedRank: [0] } as ClientIndexRow,
});
const bucket = (kind: OwedBucketRow['kind']): ClientIndexItem => ({
  type: 'bucket',
  row: { kind, owed: [], overdue: [], count: 1 },
});

describe('listKeyAction', () => {
  it('walks with ↑ and ↓ in either direction', () => {
    for (const direction of ['ltr', 'rtl'] as const) {
      expect(listKeyAction('ArrowUp', direction)).toBe('previous');
      expect(listKeyAction('ArrowDown', direction)).toBe('next');
    }
  });

  it('moves into the profile with Enter, and with the arrow that points at it', () => {
    expect(listKeyAction('Enter', 'ltr')).toBe('toProfile');
    expect(listKeyAction('Enter', 'rtl')).toBe('toProfile');
    expect(listKeyAction('ArrowRight', 'ltr')).toBe('toProfile');
    expect(listKeyAction('ArrowLeft', 'rtl')).toBe('toProfile');
  });

  it('leaves every other key alone, including the arrow pointing away from the profile', () => {
    expect(listKeyAction('ArrowLeft', 'ltr')).toBeUndefined();
    expect(listKeyAction('ArrowRight', 'rtl')).toBeUndefined();
    expect(listKeyAction('Escape', 'ltr')).toBeUndefined();
    expect(listKeyAction('Home', 'ltr')).toBeUndefined();
    expect(listKeyAction('a', 'ltr')).toBeUndefined();
  });
});

describe('profileKeyAction', () => {
  it('returns to the list with Escape, and with the arrow that points at the list', () => {
    expect(profileKeyAction('Escape', 'ltr')).toBe('toList');
    expect(profileKeyAction('Escape', 'rtl')).toBe('toList');
    expect(profileKeyAction('ArrowLeft', 'ltr')).toBe('toList');
    expect(profileKeyAction('ArrowRight', 'rtl')).toBe('toList');
  });

  it('leaves the other arrows and keys alone', () => {
    expect(profileKeyAction('ArrowRight', 'ltr')).toBeUndefined();
    expect(profileKeyAction('ArrowLeft', 'rtl')).toBeUndefined();
    expect(profileKeyAction('ArrowDown', 'ltr')).toBeUndefined();
    expect(profileKeyAction('Enter', 'ltr')).toBeUndefined();
  });
});

describe('adjacentClientId', () => {
  const items = [client('gamma'), client('acme'), client('beta'), bucket('noClient'), bucket('archivedClients')];

  it('finds the next and previous client in display order', () => {
    expect(adjacentClientId(items, 'acme', 1)).toBe('beta');
    expect(adjacentClientId(items, 'acme', -1)).toBe('gamma');
  });

  it('skips the muted rows: the last client has no next', () => {
    expect(adjacentClientId(items, 'beta', 1)).toBeUndefined();
  });

  it('stops at the first client', () => {
    expect(adjacentClientId(items, 'gamma', -1)).toBeUndefined();
  });

  it('has nothing for a client that is not listed', () => {
    expect(adjacentClientId(items, 'zed', 1)).toBeUndefined();
  });

  it('names the first client, and none for a list of muted rows only', () => {
    expect(firstClientId(items)).toBe('gamma');
    expect(firstClientId([bucket('noClient')])).toBeUndefined();
  });
});

describe('keyBelongsToControl', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  const place = (html: string) => {
    document.body.innerHTML = html;
    return document.querySelector('[data-target]') as HTMLElement;
  };

  it('is true for fields that take typing or arrows', () => {
    expect(keyBelongsToControl(place('<input data-target />'))).toBe(true);
    expect(keyBelongsToControl(place('<textarea data-target></textarea>'))).toBe(true);
    expect(keyBelongsToControl(place('<select data-target><option>a</option></select>'))).toBe(true);
    expect(keyBelongsToControl(place('<div contenteditable="true" data-target></div>'))).toBe(true);
  });

  it('is true inside a menu, listbox, dialog, tab list, radio group or combobox', () => {
    for (const role of ['menu', 'listbox', 'dialog', 'tablist', 'radiogroup', 'combobox']) {
      expect(keyBelongsToControl(place(`<div role="${role}"><button data-target>x</button></div>`)), role).toBe(true);
    }
  });

  it('is true on a button whose popup is open', () => {
    expect(keyBelongsToControl(place('<button aria-expanded="true" data-target>⋯</button>'))).toBe(true);
  });

  it('is false for a plain link, a closed menu button, the pane itself, or nothing', () => {
    expect(keyBelongsToControl(place('<a href="#" data-target>Acme</a>'))).toBe(false);
    expect(keyBelongsToControl(place('<button aria-expanded="false" data-target>⋯</button>'))).toBe(false);
    expect(keyBelongsToControl(place('<section tabindex="-1" data-target></section>'))).toBe(false);
    expect(keyBelongsToControl(null)).toBe(false);
  });
});

describe('hasModifier', () => {
  it('is true with Alt, Ctrl, Meta or Shift held (Alt+← is the browser\'s Back)', () => {
    const none = { altKey: false, ctrlKey: false, metaKey: false, shiftKey: false };
    expect(hasModifier(none)).toBe(false);
    expect(hasModifier({ ...none, altKey: true })).toBe(true);
    expect(hasModifier({ ...none, ctrlKey: true })).toBe(true);
    expect(hasModifier({ ...none, metaKey: true })).toBe(true);
    expect(hasModifier({ ...none, shiftKey: true })).toBe(true);
  });
});

describe('splitLayout', () => {
  it('shows the list alone when no client is open, at any width', () => {
    expect(splitLayout(false, true)).toBe('list');
    expect(splitLayout(false, false)).toBe('list');
  });

  it('opens a client beside the list on a wide window, and alone on a narrow one', () => {
    expect(splitLayout(true, true)).toBe('split');
    expect(splitLayout(true, false)).toBe('profile');
  });
});

describe('clientProfileRemountDeps', () => {
  it('is the client id, so a new client gets a fresh profile and nothing else remounts it', () => {
    expect(clientProfileRemountDeps({ params: { clientId: 'acme' } })).toBe('acme');
  });
});
