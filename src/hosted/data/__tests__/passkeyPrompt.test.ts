import { describe, expect, it } from 'vitest';
import type { Me } from '../../api/client';
import { optimisticPasskeyPrompt, passkeySuggestionShows } from '../passkeyPrompt';

/**
 * MUT-370: whether Home shows the "Add a passkey" card. The server decides `due` (D3); the portal adds its own device
 * check, local mode, a closing account and the first-run order: MUT-418's trial step comes first (D4).
 */

const NOW = new Date('2026-11-01T09:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;
const inDays = (days: number) => new Date(NOW.getTime() + days * DAY).toISOString();
const DUE = { due: true, notNowCount: 0, hiddenUntil: null };
const ANSWERED_TRIAL = { welcomedAt: inDays(-1), welcomeAnswer: 'skipped', bannerSnoozedUntil: null } as const;
const OPEN_TRIAL = { welcomedAt: null, welcomeAnswer: null, bannerSnoozedUntil: null } as const;

function me({ prompt = DUE, trialPrompt = ANSWERED_TRIAL, closing = false }: { prompt?: Me['user']['passkeyPrompt']; trialPrompt?: Me['user']['trialPrompt']; closing?: boolean } = {}): Me {
  return {
    user: {
      id: 'u',
      email: 'rana@studio.example',
      displayName: 'Rana',
      locale: 'en',
      malafatSuggestions: { off: false, dismissed: [] },
      trialPrompt,
      passkeyPrompt: prompt,
      status: 'ACTIVE',
      closure: closing ? { requestedAt: inDays(-1), deleteAfter: inDays(29) } : null,
    },
    profiles: [{ id: 'mine', isPersonalDefault: true, billing: { state: 'ACTIVE', source: 'TRIAL', tier: 'FREELANCER', until: inDays(14) } }],
  } as unknown as Me;
}

const shows = (person: Me, { supported = true, local = false } = {}) => passkeySuggestionShows(person, { supported, local, now: NOW });

describe('passkeySuggestionShows', () => {
  it('shows when the server says due, on a device that can make a passkey', () => {
    expect(shows(me())).toBe(true);
  });

  it('never on a device or host that cannot make one, nor in local mode', () => {
    expect(shows(me(), { supported: false })).toBe(false);
    expect(shows(me(), { local: true })).toBe(false);
  });

  it('never when the server says not due, or offers no passkeys (null), or says nothing (an older server)', () => {
    expect(shows(me({ prompt: { due: false, notNowCount: 3, hiddenUntil: null } }))).toBe(false);
    expect(shows(me({ prompt: null }))).toBe(false);
    const older = me();
    delete (older.user as Partial<Me['user']>).passkeyPrompt;
    expect(shows(older)).toBe(false);
  });

  it('never while the account is closing', () => {
    expect(shows(me({ closing: true }))).toBe(false);
  });

  it('waits while MUT-418’s first-run trial step is unanswered: the trial step comes first (D4)', () => {
    expect(shows(me({ trialPrompt: OPEN_TRIAL }))).toBe(false);
  });

  it('honors a hide the portal has just written, before the server answers', () => {
    expect(shows(me({ prompt: { due: true, notNowCount: 1, hiddenUntil: inDays(30) } }))).toBe(false);
  });
});

describe('optimisticPasskeyPrompt', () => {
  it('Not now hides it for 30 days and spends an offer at once', () => {
    expect(optimisticPasskeyPrompt(DUE, NOW)).toEqual({ due: false, notNowCount: 1, hiddenUntil: inDays(30) });
  });

  it('never counts past three, and leaves a missing prompt missing', () => {
    expect(optimisticPasskeyPrompt({ due: true, notNowCount: 3, hiddenUntil: null }, NOW).notNowCount).toBe(3);
    expect(optimisticPasskeyPrompt(null, NOW)).toBeNull();
  });
});
