import { describe, expect, it, vi } from 'vitest';
import { pullStream } from '../pull-stream.js';

/**
 * MUT-501 via MUT-314 (D9): one cancel-safe pulled stream. A cancel stops pulling quietly (no error log, no enqueue
 * after it, the source told to stop); a real failure before any cancel is still logged once and errors the stream.
 */
const bytes = (s: string) => new TextEncoder().encode(s);

function source(chunks: string[], failAt = -1) {
  let i = 0;
  const returned = vi.fn(async () => ({ done: true as const, value: undefined }));
  return {
    returned,
    iterator: {
      async next(): Promise<IteratorResult<Uint8Array>> {
        if (i === failAt) throw new Error('storage went away');
        if (i >= chunks.length) return { done: true, value: undefined };
        return { done: false, value: bytes(chunks[i++]!) };
      },
      return: returned,
    } satisfies AsyncIterator<Uint8Array>,
  };
}

describe('pullStream (MUT-501)', () => {
  it('passes every chunk through and closes', async () => {
    const onError = vi.fn();
    const text = await new Response(pullStream(source(['a', 'b', 'c']).iterator, { onError })).text();
    expect(text).toBe('abc');
    expect(onError).not.toHaveBeenCalled();
  });

  it('a failure before any cancel is logged once and errors the stream', async () => {
    const onError = vi.fn();
    await expect(new Response(pullStream(source(['a', 'b'], 1).iterator, { onError })).text()).rejects.toThrow('storage went away');
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('a cancel is quiet: the source is told to stop, nothing is enqueued after, no error is logged', async () => {
    const onError = vi.fn();
    const onCancel = vi.fn();
    const src = source(['a', 'b', 'c']);
    const reader = pullStream(src.iterator, { onError, onCancel }).getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toBe('a');
    await reader.cancel('client went away');
    expect(src.returned).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  });

  it('a pull in flight when the cancel lands never enqueues, and its failure is swallowed', async () => {
    const onError = vi.fn();
    let fail!: (e: Error) => void;
    const pending = new Promise<IteratorResult<Uint8Array>>((_, reject) => (fail = reject));
    let calls = 0;
    const iterator: AsyncIterator<Uint8Array> = {
      next: () => (calls++ === 0 ? Promise.resolve({ done: false, value: bytes('a') }) : pending),
      return: async () => ({ done: true, value: undefined }),
    };
    const stream = pullStream(iterator, { onError });
    const reader = stream.getReader();
    await reader.read();
    const read = reader.read();
    await new Promise((r) => setTimeout(r, 5));
    await reader.cancel();
    fail(new Error('Invalid state: Controller is already closed'));
    expect((await read).done).toBe(true);
    await new Promise((r) => setTimeout(r, 5));
    expect(onError).not.toHaveBeenCalled();
  });

  it('a source that throws while stopping is swallowed too', async () => {
    const onError = vi.fn();
    const iterator: AsyncIterator<Uint8Array> = { next: async () => ({ done: false, value: bytes('a') }), return: async () => Promise.reject(new Error('already closed')) };
    const reader = pullStream(iterator, { onError }).getReader();
    await reader.read();
    await reader.cancel();
    expect(onError).not.toHaveBeenCalled();
  });

  it('onSettled runs once whichever way the stream ends', async () => {
    for (const run of [
      async (s: ReadableStream) => new Response(s).text(),
      async (s: ReadableStream) => s.getReader().cancel(),
    ]) {
      const onSettled = vi.fn();
      await run(pullStream(source(['a']).iterator, { onError: vi.fn(), onSettled }));
      expect(onSettled).toHaveBeenCalledTimes(1);
    }
    const onSettled = vi.fn();
    await new Response(pullStream(source(['a'], 0).iterator, { onError: vi.fn(), onSettled })).text().catch(() => undefined);
    expect(onSettled).toHaveBeenCalledTimes(1);
  });
});
