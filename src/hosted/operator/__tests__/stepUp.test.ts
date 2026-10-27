import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/client';
import { isStepUpFresh, runOperatorAction, stepUpWithPasskey } from '../stepUp';

/**
 * MUT-460 (design 1A, 10A): an operator write runs straight away while the session's passkey step-up is fresh, and
 * after one passkey prompt when it isn't. A 403 on a direct write never starts the prompt by itself.
 */
const mocks = vi.hoisted(() => ({ options: vi.fn(), stepUp: vi.fn(), assert: vi.fn() }));
vi.mock('../../api/client', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../api/client')>();
  return { ...real, api: { ...real.api, operatorStepUpOptions: mocks.options, operatorStepUp: mocks.stepUp } };
});
vi.mock('../../passkeys/webauthn', () => ({ assertPasskey: mocks.assert }));

const CHALLENGE = { challengeId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', publicKey: { challenge: 'abc' } };
const UNTIL = '2026-10-27T12:10:00.000Z';
const recent = () => new ApiError(403, 'RECENT_SIGN_IN_REQUIRED', 'step up', { method: 'passkey' });

beforeEach(() => {
  mocks.options.mockReset().mockResolvedValue(CHALLENGE);
  mocks.assert.mockReset().mockResolvedValue({ kind: 'ok', response: { id: 'cred' } });
  mocks.stepUp.mockReset().mockResolvedValue({ stepUpUntil: UNTIL });
});
afterEach(() => vi.clearAllMocks());

describe('isStepUpFresh', () => {
  const now = new Date('2026-10-27T12:00:00.000Z');
  it('is fresh with more than half a minute left', () => expect(isStepUpFresh(UNTIL, now)).toBe(true));
  it('is stale when it lapses within half a minute, has lapsed, or never happened', () => {
    expect(isStepUpFresh('2026-10-27T12:00:20.000Z', now)).toBe(false);
    expect(isStepUpFresh('2026-10-27T11:59:00.000Z', now)).toBe(false);
    expect(isStepUpFresh(null, now)).toBe(false);
    expect(isStepUpFresh('not a date', now)).toBe(false);
  });
});

describe('stepUpWithPasskey', () => {
  it('asks for options, runs the passkey sheet, and sends the assertion', async () => {
    expect(await stepUpWithPasskey()).toEqual({ kind: 'ok', until: UNTIL });
    expect(mocks.stepUp).toHaveBeenCalledWith({ challengeId: CHALLENGE.challengeId, response: { id: 'cred' } });
  });

  it('a cancelled sheet sends nothing', async () => {
    mocks.assert.mockResolvedValue({ kind: 'cancelled' });
    expect(await stepUpWithPasskey()).toEqual({ kind: 'cancelled' });
    expect(mocks.stepUp).not.toHaveBeenCalled();
  });

  it('a platform failure or a refused passkey is "refused"', async () => {
    mocks.assert.mockResolvedValueOnce({ kind: 'failed' });
    expect(await stepUpWithPasskey()).toEqual({ kind: 'refused' });
    mocks.stepUp.mockRejectedValueOnce(new ApiError(403, 'PASSKEY_NOT_ACCEPTED', 'no'));
    expect(await stepUpWithPasskey()).toEqual({ kind: 'refused' });
  });

  it('an operator with no passkey left is "noPasskey"; anything else is "failed"', async () => {
    mocks.options.mockRejectedValueOnce(new ApiError(409, 'CONFLICT', 'no passkey', { reason: 'OPERATOR_NEEDS_PASSKEY' }));
    expect(await stepUpWithPasskey()).toEqual({ kind: 'noPasskey' });
    mocks.options.mockRejectedValueOnce(new ApiError(0, 'NETWORK', 'offline'));
    expect(await stepUpWithPasskey()).toEqual({ kind: 'failed' });
  });
});

describe('runOperatorAction', () => {
  it('fresh: runs the action with no passkey prompt', async () => {
    const action = vi.fn().mockResolvedValue('done');
    expect(await runOperatorAction(action, { withPasskey: false })).toEqual({ kind: 'done', value: 'done' });
    expect(mocks.options).not.toHaveBeenCalled();
  });

  it('stale: steps up first, reports the new window, then runs the action', async () => {
    const action = vi.fn().mockResolvedValue('done');
    const onSteppedUp = vi.fn();
    expect(await runOperatorAction(action, { withPasskey: true, onSteppedUp })).toEqual({ kind: 'done', value: 'done' });
    expect(onSteppedUp).toHaveBeenCalledWith(UNTIL);
    expect(mocks.stepUp.mock.invocationCallOrder[0]).toBeLessThan(action.mock.invocationCallOrder[0]!);
  });

  it('a failed step-up never runs the action', async () => {
    mocks.assert.mockResolvedValue({ kind: 'cancelled' });
    const action = vi.fn();
    expect(await runOperatorAction(action, { withPasskey: true })).toEqual({ kind: 'stepUpFailed', reason: 'cancelled' });
    expect(action).not.toHaveBeenCalled();
  });

  it('a 403 on a direct action asks for the passkey, without starting the prompt', async () => {
    expect(await runOperatorAction(() => Promise.reject(recent()), { withPasskey: false })).toEqual({ kind: 'needsPasskey' });
    expect(mocks.options).not.toHaveBeenCalled();
  });

  it('a second 403 right after a step-up is "refused"', async () => {
    expect(await runOperatorAction(() => Promise.reject(recent()), { withPasskey: true })).toEqual({ kind: 'stepUpFailed', reason: 'refused' });
  });

  it('any other refusal is the caller’s to map', async () => {
    const conflict = new ApiError(409, 'CONFLICT', 'decided', { reason: 'ALREADY_DECIDED' });
    expect(await runOperatorAction(() => Promise.reject(conflict), { withPasskey: false })).toEqual({ kind: 'error', error: conflict });
  });
});
