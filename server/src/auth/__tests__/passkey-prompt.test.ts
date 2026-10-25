import { describe, expect, it } from 'vitest';
import { PASSKEY_PROMPT_HIDE_DAYS, PASSKEY_PROMPT_MAX_OFFERS, applyPasskeyNotNow, passkeyPromptView, resolvePasskeyPrompt } from '../passkey-prompt.js';

/**
 * MUT-370 (D1–D3, D11): the "Add a passkey" suggestion's state, on the person's user row. Pure: the store locks the
 * row and writes what this returns; /v1/me shows the view.
 */

const AT = new Date('2026-11-01T09:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;
const later = (days: number) => new Date(AT.getTime() + days * DAY_MS);
const EMPTY = { notNowCount: 0, hiddenUntil: null };

describe('the rules', () => {
  it('offers three times and hides for 30 days (ticket)', () => {
    expect(PASSKEY_PROMPT_MAX_OFFERS).toBe(3);
    expect(PASSKEY_PROMPT_HIDE_DAYS).toBe(30);
  });
});

describe('resolvePasskeyPrompt', () => {
  it('nothing stored, or anything malformed, is a fresh prompt', () => {
    for (const stored of [null, undefined, 'x', 3, [], { notNowCount: 'two', hiddenUntil: 'not a date' }, { notNowCount: -1 }, { notNowCount: 1.5 }]) {
      expect(resolvePasskeyPrompt(stored), JSON.stringify(stored)).toEqual(EMPTY);
    }
  });

  it('keeps well-formed fields, and caps the count at the maximum', () => {
    expect(resolvePasskeyPrompt({ notNowCount: 2, hiddenUntil: AT.toISOString() })).toEqual({ notNowCount: 2, hiddenUntil: AT.toISOString() });
    expect(resolvePasskeyPrompt({ notNowCount: 9, hiddenUntil: null })).toEqual({ notNowCount: 3, hiddenUntil: null });
  });
});

describe('applyPasskeyNotNow (D2)', () => {
  it('the first Not now counts one offer and hides the card for 30 days', () => {
    expect(applyPasskeyNotNow(null, AT, 0)).toEqual({ notNowCount: 1, hiddenUntil: later(30).toISOString() });
  });

  it('a Not now while the card is already hidden changes nothing: two devices answering one offer count once', () => {
    const first = applyPasskeyNotNow(null, AT, 0);
    expect(applyPasskeyNotNow(first, later(1), 0)).toEqual(first);
  });

  it('once the hide lapses, the next Not now counts the next offer', () => {
    const first = applyPasskeyNotNow(null, AT, 0);
    expect(applyPasskeyNotNow(first, later(31), 0)).toEqual({ notNowCount: 2, hiddenUntil: later(61).toISOString() });
  });

  it('spends nothing once the person holds a passkey (a stale card in another tab)', () => {
    expect(applyPasskeyNotNow(null, AT, 1)).toEqual(EMPTY);
  });

  it('never counts past the third offer', () => {
    expect(applyPasskeyNotNow({ notNowCount: 3, hiddenUntil: null }, AT, 0)).toEqual({ notNowCount: 3, hiddenUntil: null });
  });
});

describe('passkeyPromptView (D3)', () => {
  it('due for a person with no passkey who never answered', () => {
    expect(passkeyPromptView(null, 0, AT)).toEqual({ due: true, notNowCount: 0, hiddenUntil: null });
  });

  it('never due once a passkey exists', () => {
    expect(passkeyPromptView(null, 1, AT).due).toBe(false);
  });

  it('not due while hidden; due again once the 30 days pass', () => {
    const hidden = applyPasskeyNotNow(null, AT, 0);
    expect(passkeyPromptView(hidden, 0, later(29))).toEqual({ due: false, notNowCount: 1, hiddenUntil: later(30).toISOString() });
    expect(passkeyPromptView(hidden, 0, later(30)).due).toBe(true);
  });

  it('never due after the third Not now, however long ago', () => {
    let stored = applyPasskeyNotNow(null, AT, 0);
    stored = applyPasskeyNotNow(stored, later(31), 0);
    stored = applyPasskeyNotNow(stored, later(62), 0);
    expect(stored.notNowCount).toBe(3);
    expect(passkeyPromptView(stored, 0, later(500)).due).toBe(false);
  });

  it('never due to a closing account', () => {
    expect(passkeyPromptView(null, 0, AT, true).due).toBe(false);
  });

  it('removing every passkey brings it back while offers remain (D11)', () => {
    expect(passkeyPromptView({ notNowCount: 1, hiddenUntil: null }, 0, AT).due).toBe(true);
  });
});
