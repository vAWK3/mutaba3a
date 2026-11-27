import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ApiError } from '../../../api/client';
import { me, ORG_A, ORG_B, profile } from '../../../__tests__/harness';
import { claimCodeFailure, claimContextKey, claimNext, isClaimRefusal, paysAlready } from '../claimStep';

/** MUT-769: the pure half of the accountant's-customer `/setup`, and motion-handover-claimed's spec values in CSS. */

const css = readFileSync(join(process.cwd(), 'src/hosted/hosted.css'), 'utf8');

describe('claimContextKey', () => {
  it('names both, either, or neither', () => {
    expect(claimContextKey({ accountantName: 'Hadi', businessName: 'Café Nour' })).toEqual({ key: 'hosted.accountantChannel.claim.context', vars: { accountant: 'Hadi', business: 'Café Nour' } });
    expect(claimContextKey({ accountantName: ' ', businessName: 'Café Nour' }).key).toBe('hosted.accountantChannel.claim.contextNoAccountant');
    expect(claimContextKey({ accountantName: 'Hadi', businessName: null }).key).toBe('hosted.accountantChannel.claim.contextNoBusiness');
    expect(claimContextKey({ accountantName: null, businessName: null })).toEqual({ key: 'hosted.accountantChannel.claim.contextNone', vars: {} });
  });
});

describe('claimCodeFailure', () => {
  it('reads wrong (tries left), locked, no code, a limit and anything else', () => {
    expect(claimCodeFailure(new ApiError(403, 'CLAIM_CODE_WRONG' as never, 'x', { triesLeft: 2 }))).toEqual({ kind: 'wrong', triesLeft: 2 });
    expect(claimCodeFailure(new ApiError(403, 'CLAIM_CODE_LOCKED' as never, 'x'))).toEqual({ kind: 'locked' });
    expect(claimCodeFailure(new ApiError(409, 'CONFLICT' as never, 'x', { reason: 'NO_CLAIM_CODE' }))).toEqual({ kind: 'noCode' });
    expect(claimCodeFailure(new ApiError(429, 'RATE_LIMITED' as never, 'x', null, null, 120))).toEqual({ kind: 'rateLimited', minutes: 2 });
    expect(claimCodeFailure(new Error('offline'))).toEqual({ kind: 'unreachable' });
    expect(isClaimRefusal(new ApiError(403, 'CLAIM_CODE_LOCKED' as never, 'x'))).toBe(true);
    expect(isClaimRefusal(new ApiError(410, 'SETUP_LINK_UNUSABLE' as never, 'x'))).toBe(false);
  });
});

describe('claimNext (DR-7: the card when due, then the app)', () => {
  const people = me([profile({ id: ORG_B, owned: true, isPersonalDefault: true }), profile({ id: ORG_A, owned: true, isPersonalDefault: false })]);
  const sub = (status: string) => ({ configured: true, subscription: { status } as never });

  it('opens Billing › Subscribe on the business profile until a covering subscription exists', () => {
    expect(claimNext(people, { configured: true, subscription: null })).toEqual({ to: `/p/${ORG_A}`, search: { billing: true, step: 'subscribe' } });
    expect(claimNext(people, sub('canceled'))).toEqual({ to: `/p/${ORG_A}`, search: { billing: true, step: 'subscribe' } });
    for (const status of ['active', 'trialing', 'past_due']) expect(claimNext(people, sub(status))).toEqual({ to: `/p/${ORG_A}` });
  });

  it('never blocks the app on billing it cannot read or that is not set up', () => {
    expect(paysAlready(null)).toBe(true);
    expect(paysAlready({ configured: false, subscription: null })).toBe(true);
    expect(claimNext(me([]), null)).toEqual({ to: '/' });
  });
});

describe('motion-handover-claimed (spec values in hosted.css)', () => {
  it('fades the offer trail (0, 200 ms) and the label (400 ms, 200 ms), linear', () => {
    expect(css).toMatch(/\[data-part="offer-tick"\] \{ animation: hp-fade-out-once 200ms linear both; \}/);
    expect(css).toMatch(/\[data-part="label"\] \{ animation: hp-fade-out-once 200ms linear 400ms both; \}/);
  });

  it('carries the key from (116, 34) to (106, 114) in 700 ms on the spring, tilting −16° mid-way', () => {
    expect(css).toContain('animation: hp-handover-key-y 700ms var(--ease-spring) both, hp-handover-key-x 700ms linear both, hp-handover-key-tilt 700ms var(--ease-spring) both;');
    expect(css).toMatch(/@keyframes hp-handover-key-y \{ from \{ translate: 0 -80px; \}/);
    expect(css).toMatch(/@keyframes hp-handover-key-x \{ from \{ transform: translateX\(10px\); \}/);
    expect(css).toMatch(/50% \{ rotate: -16deg; \}/);
  });

  it('turns the tab peach at 640 ms (280 ms spring), pops it 1 → 1.08 (160 ms overshoot) → 1 (240 ms spring), sparkles at 900 ms for 420 ms', () => {
    expect(css).toContain('hp-handover-peach 280ms var(--ease-spring) 640ms both');
    expect(css).toMatch(/0% \{ scale: 1; animation-timing-function: var\(--ease-overshoot\); \}\s*40% \{ scale: 1\.08; animation-timing-function: var\(--ease-spring\); \}/);
    expect(css).toContain('animation: hp-handover-tab-pop 400ms 640ms both');
    expect(css).toContain('animation: hp-handover-sparkles 420ms var(--ease-spring) 900ms both;');
  });

  it('shows only the claimed scene under reduced motion, with a 150 ms fade', () => {
    const reduced = css.slice(css.indexOf('/* The still (motion-handover-claimed-still.svg'));
    expect(reduced).toMatch(/^[^@]*\.hp-handover-claimed-welcome \{ display: none; \}/);
    expect(reduced).toMatch(/^[^@]*\.hp-handover-claimed-art \{ animation: hp-fade-in-still 150ms linear both; \}/);
  });
});
