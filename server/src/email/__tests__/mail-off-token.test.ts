import { describe, expect, it } from 'vitest';
import { mailOffToken, verifyMailOffToken } from '../mail-off-token.js';

const PEPPER = 'session-pepper-with-at-least-32-chars!!';
const USER = '0b7d4f2e-6a1c-4c8e-9f3a-2d5b7e9c1a40';

describe('MUT-535 (D8): the monthly summary opt-out token', () => {
  it('round-trips to the person it was made for', () => {
    const token = mailOffToken(PEPPER, USER);
    expect(verifyMailOffToken(PEPPER, token)).toBe(USER);
  });

  it('is stable, so every month’s mail carries a link that still works', () => {
    expect(mailOffToken(PEPPER, USER)).toBe(mailOffToken(PEPPER, USER));
  });

  it('is URL-safe, with no padding', () => {
    expect(mailOffToken(PEPPER, USER)).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  });

  it('refuses a token signed for another person', () => {
    const other = mailOffToken(PEPPER, '1c8e2d5b-7e9c-4a40-8b7d-4f2e6a1c4c8e');
    const [, sig] = other.split('.');
    const [id] = mailOffToken(PEPPER, USER).split('.');
    expect(verifyMailOffToken(PEPPER, `${id}.${sig}`)).toBeNull();
  });

  it('refuses a token made with another pepper (after a rotation)', () => {
    expect(verifyMailOffToken('another-pepper-with-at-least-32-chars!!', mailOffToken(PEPPER, USER))).toBeNull();
  });

  it('refuses garbage without throwing', () => {
    for (const bad of ['', '.', 'abc', 'abc.def', `${USER}.`, 'a.b.c', '%%%.%%%']) expect(verifyMailOffToken(PEPPER, bad)).toBeNull();
  });

  it('is not the session digest of the same id (its own key, its own purpose)', () => {
    const [, sig] = mailOffToken(PEPPER, USER).split('.');
    expect(sig).not.toBe(USER);
    expect(sig!.length).toBe(43);
  });
});
