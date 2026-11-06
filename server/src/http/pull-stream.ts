/**
 * MUT-501 via MUT-314 (D9): a pulled byte stream over an async source, safe to cancel. The next chunk is read only when
 * the reader wants more. Shared by the records export and the period receipts zip.
 *
 * - A cancel (the client went away) sets a flag first: no chunk is enqueued after it, the source is told to stop
 *   (`return()`), and whatever the source throws from then on is swallowed. `onCancel` lets the caller log it quietly.
 * - A real failure before any cancel is reported once through `onError` and errors the stream, so the response is cut
 *   off rather than ended as if whole (the request was logged 200 already; the client refuses the truncated file).
 * - `onSettled` runs once, however the stream ends (closed, errored or cancelled): the caller frees its slot there.
 */
export interface PullStreamHooks {
  onError(error: unknown): void;
  onCancel?(reason: unknown): void;
  onSettled?(): void;
}

export function pullStream(source: AsyncIterator<Uint8Array>, hooks: PullStreamHooks): ReadableStream<Uint8Array> {
  let cancelled = false;
  let settled = false;
  const settle = () => {
    if (settled) return;
    settled = true;
    hooks.onSettled?.();
  };
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (cancelled) return;
      try {
        const next = await source.next();
        if (cancelled) return;
        if (next.done) {
          controller.close();
          settle();
        } else {
          controller.enqueue(next.value);
        }
      } catch (error) {
        if (cancelled) return;
        hooks.onError(error);
        controller.error(error);
        settle();
      }
    },
    async cancel(reason) {
      cancelled = true;
      try {
        await source.return?.(undefined);
      } catch {
        // The source was already closing; a cancel is never an error.
      }
      hooks.onCancel?.(reason);
      settle();
    },
  });
}
