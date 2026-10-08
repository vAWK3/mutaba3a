import { describe, expect, it } from 'vitest';
import { SlidingWindowRateLimiter } from '../rate-limit.js';

describe('SlidingWindowRateLimiter', () => {
  it('allows up to the limit within a minute, then refuses with a retry hint', async () => {
    const rl = new SlidingWindowRateLimiter(3);
    const t0 = new Date('2026-10-08T10:00:00Z');
    expect((await rl.check('k', t0)).allowed).toBe(true);
    expect((await rl.check('k', t0)).allowed).toBe(true);
    const third = await rl.check('k', t0);
    expect(third.allowed).toBe(true);
    expect(third.remaining).toBe(0);
    const fourth = await rl.check('k', new Date(t0.getTime() + 10_000));
    expect(fourth.allowed).toBe(false);
    expect(fourth.retryAfterSeconds).toBe(50);
  });

  it('slides: requests older than 60s stop counting', async () => {
    const rl = new SlidingWindowRateLimiter(1);
    const t0 = new Date('2026-10-08T10:00:00Z');
    await rl.check('k', t0);
    expect((await rl.check('k', new Date(t0.getTime() + 59_000))).allowed).toBe(false);
    expect((await rl.check('k', new Date(t0.getTime() + 60_001))).allowed).toBe(true);
  });

  it('keeps keys independent and prunes idle ones', async () => {
    const rl = new SlidingWindowRateLimiter(1);
    const t0 = new Date('2026-10-08T10:00:00Z');
    await rl.check('a', t0);
    expect((await rl.check('b', t0)).allowed).toBe(true);
    rl.prune(new Date(t0.getTime() + 120_000));
    expect((await rl.check('a', new Date(t0.getTime() + 120_000))).allowed).toBe(true);
  });
});
