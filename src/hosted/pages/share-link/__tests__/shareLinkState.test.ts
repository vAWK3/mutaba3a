import { afterEach, describe, expect, it } from 'vitest';
import { ApiError, type ShareLinkUnlock } from '../../../api/client';
import { INITIAL_SHARE_LINK_STATE, forgetsViewer, shareLinkReducer, type ShareLinkState } from '../shareLinkState';
import { forgetViewerToken, linkDigest, readViewerToken, resetViewerTokensForTests, saveViewerToken } from '../viewerTokens';

const refused = (reason: string, extra: Record<string, unknown> = {}) => new ApiError(403, 'SHARE_LINK_REFUSED', reason, { reason, ...extra });
const gone = new ApiError(404, 'NOT_FOUND', 'gone', { reason: 'SHARE_LINK_UNAVAILABLE' });
const unlock = { viewerToken: 'v', profileName: 'Studio', ownerName: 'Rana Haddad' } as ShareLinkUnlock;
const pin: ShareLinkState = { kind: 'pin', again: false, problem: null };

describe('shareLinkReducer', () => {
  it('check: the PIN step, or the link ends the page', () => {
    expect(shareLinkReducer(INITIAL_SHARE_LINK_STATE, { type: 'checked' })).toEqual(pin);
    expect(shareLinkReducer(INITIAL_SHARE_LINK_STATE, { type: 'checkFailed', error: gone })).toEqual({ kind: 'gone' });
    expect(shareLinkReducer(INITIAL_SHARE_LINK_STATE, { type: 'checkFailed', error: refused('LOCKED') })).toEqual({ kind: 'locked' });
    expect(shareLinkReducer(INITIAL_SHARE_LINK_STATE, { type: 'checkFailed', error: new ApiError(422, 'VALIDATION_FAILED', 'x') })).toEqual({ kind: 'gone' });
    expect(shareLinkReducer(INITIAL_SHARE_LINK_STATE, { type: 'checkFailed', error: new ApiError(0, 'NETWORK', 'x') })).toEqual({ kind: 'unreachable' });
    expect(shareLinkReducer({ kind: 'unreachable' }, { type: 'retry' })).toEqual(INITIAL_SHARE_LINK_STATE);
  });

  it('unlock: open with the names, or why not', () => {
    expect(shareLinkReducer(pin, { type: 'unlocked', unlock })).toEqual({ kind: 'open', unlock });
    expect(shareLinkReducer(pin, { type: 'unlockFailed', error: refused('PIN_WRONG', { attemptsLeft: 2 }) })).toEqual({ kind: 'pin', again: false, problem: { kind: 'wrong', attemptsLeft: 2 } });
    expect(shareLinkReducer(pin, { type: 'unlockFailed', error: refused('LOCKED') })).toEqual({ kind: 'locked' });
    expect(shareLinkReducer(pin, { type: 'unlockFailed', error: refused('VIEWER_LIMIT') })).toEqual({ kind: 'limit' });
    expect(shareLinkReducer(pin, { type: 'unlockFailed', error: gone })).toEqual({ kind: 'gone' });
    expect(shareLinkReducer(pin, { type: 'unlockFailed', error: new ApiError(429, 'RATE_LIMITED', 'x', null, null, 90) })).toMatchObject({ problem: { kind: 'rateLimited', minutes: 2 } });
    expect(shareLinkReducer(pin, { type: 'unlockFailed', error: new ApiError(409, 'CONFLICT', 'x', { reason: 'SHARE_LINK_STALE_VIEWER' }) })).toMatchObject({ problem: { kind: 'retry' } });
  });

  it('a wrong PIN after the 8 hours keeps "again"', () => {
    const again: ShareLinkState = { kind: 'pin', again: true, problem: null };
    expect(shareLinkReducer(again, { type: 'unlockFailed', error: refused('PIN_WRONG', { attemptsLeft: 4 }) })).toMatchObject({ again: true });
  });

  it('while open: 401 asks the PIN again, 404 ends it, an outage keeps the view', () => {
    const open: ShareLinkState = { kind: 'open', unlock };
    expect(shareLinkReducer(open, { type: 'viewFailed', error: new ApiError(401, 'UNAUTHENTICATED', 'x', { reason: 'SHARE_VIEW_EXPIRED' }) })).toEqual({ kind: 'pin', again: true, problem: null });
    expect(shareLinkReducer(open, { type: 'viewFailed', error: gone })).toEqual({ kind: 'gone' });
    expect(shareLinkReducer(open, { type: 'viewFailed', error: new ApiError(0, 'NETWORK', 'x') })).toBe(open);
  });

  it('only a gone link forgets its viewer token', () => {
    expect(forgetsViewer({ kind: 'gone' })).toBe(true);
    expect(forgetsViewer({ kind: 'locked' })).toBe(false);
  });
});

describe('viewer tokens', () => {
  afterEach(() => {
    localStorage.clear();
    resetViewerTokensForTests();
  });

  it('are stored under the link token’s SHA-256, never the link token', async () => {
    const digest = await linkDigest('link-token-abc');
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    saveViewerToken(digest, 'viewer-1');
    expect(readViewerToken(digest)).toBe('viewer-1');
    expect(JSON.stringify({ ...localStorage })).not.toContain('link-token-abc');
  });

  it('survive a reload (storage) and go when the link is gone', async () => {
    const digest = await linkDigest('t');
    saveViewerToken(digest, 'viewer-2');
    resetViewerTokensForTests();
    expect(readViewerToken(digest)).toBe('viewer-2');
    forgetViewerToken(digest);
    expect(readViewerToken(digest)).toBeNull();
  });
});
