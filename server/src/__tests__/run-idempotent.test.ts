import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../errors.js';
import { runIdempotent, type ClaimOps } from '../idempotency.js';
import { MemoryLedgerStore } from '../repositories/memory.js';

/**
 * MUT-436 (review R4/OV4): the framework-free idempotency state machine both the Hono middlewares and the MCP write
 * tools run. The routes' own suites still prove the HTTP side; this pins the contract at its own boundary.
 */
const NOW = new Date('2026-10-26T09:00:00Z');
const USER = '0f5c2a1e-7b3d-4c9a-9e1f-2a3b4c5d6e7f';

function opsFor(store: MemoryLedgerStore): ClaimOps {
  return {
    claim: (args) => store.userIdempotency.claim({ userId: USER, ...args }),
    complete: (args) => store.userIdempotency.complete({ userId: USER, ...args }),
    fail: (args) => store.userIdempotency.fail({ userId: USER, ...args }),
  };
}

const input = (fingerprints: readonly [string, ...string[]] = ['fp-1']) => ({ key: 'key-abcdefgh', operation: 'test.op', fingerprints, now: NOW });

describe('runIdempotent', () => {
  it('runs a new key once and replays its outcome on the same key and fingerprint', async () => {
    const ops = opsFor(new MemoryLedgerStore());
    const run = vi.fn(async () => ({ status: 201, body: { id: 'x' } }));
    expect(await runIdempotent(ops, input(), run)).toEqual({ status: 201, body: { id: 'x' }, replayed: false });
    expect(await runIdempotent(ops, input(), run)).toEqual({ status: 201, body: { id: 'x' }, replayed: true });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('refuses the same key with a different request', async () => {
    const ops = opsFor(new MemoryLedgerStore());
    await runIdempotent(ops, input(['fp-1']), async () => ({ status: 200, body: {} }));
    await expect(runIdempotent(ops, input(['fp-2']), async () => ({ status: 200, body: {} }))).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
  });

  it('replays a key stored under a later fingerprint (the pre-MUT-199 byte one)', async () => {
    const ops = opsFor(new MemoryLedgerStore());
    await runIdempotent(ops, input(['legacy']), async () => ({ status: 200, body: { v: 1 } }));
    const run = vi.fn(async () => ({ status: 200, body: { v: 2 } }));
    expect(await runIdempotent(ops, input(['canonical', 'legacy']), run)).toEqual({ status: 200, body: { v: 1 }, replayed: true });
    expect(run).not.toHaveBeenCalled();
  });

  it('answers OPERATION_IN_PROGRESS while another attempt holds the key', async () => {
    const ops = opsFor(new MemoryLedgerStore());
    let release!: () => void;
    const first = runIdempotent(ops, input(), () => new Promise((resolve) => (release = () => resolve({ status: 200, body: {} }))));
    await expect(runIdempotent(ops, input(), async () => ({ status: 200, body: {} }))).rejects.toMatchObject({ code: 'OPERATION_IN_PROGRESS' });
    release();
    await first;
  });

  it('stores a 4xx outcome and replays it (OV4), but releases the key on a 5xx or a 429', async () => {
    const ops = opsFor(new MemoryLedgerStore());
    await runIdempotent(ops, input(), async () => ({ status: 422, body: { error: 'nope' } }));
    expect(await runIdempotent(ops, input(), async () => ({ status: 201, body: {} }))).toEqual({ status: 422, body: { error: 'nope' }, replayed: true });

    for (const status of [503, 429]) {
      const fresh = opsFor(new MemoryLedgerStore());
      await runIdempotent(fresh, input(), async () => ({ status, body: null }));
      expect(await runIdempotent(fresh, input(), async () => ({ status: 201, body: { ok: true } }))).toEqual({ status: 201, body: { ok: true }, replayed: false });
    }
  });

  it('releases the key and rethrows when the attempt throws', async () => {
    const ops = opsFor(new MemoryLedgerStore());
    await expect(runIdempotent(ops, input(), async () => { throw new ApiError('NOT_FOUND', 'gone'); })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await runIdempotent(ops, input(), async () => ({ status: 200, body: { second: true } }))).toEqual({ status: 200, body: { second: true }, replayed: false });
  });
});
