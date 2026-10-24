import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CARRY_OVER_MAX_BYTES,
  RECEIVER_PAYLOAD_TIMEOUT_MS,
  SENDER_READY_TIMEOUT_MS,
  awaitCarryOverPayload,
  receiveUrl,
  startCarryOverSend,
  type CarryOverWindow,
} from '../protocol';

/**
 * MUT-291 §3.2: the cross-origin hand-off between an old page (the free app,
 * or the old portal address) and the new address's /carry-over/receive. Both ends are
 * exercised against fake windows: the browser's own `message` events are
 * modelled by `deliver`, so every check (origin, source, kind, size) and both
 * timeouts are proven without a second origin.
 */

const PORTAL = 'https://app.example';
const OLD_WEB = 'https://old-web.example';
const OLD_PORTAL = 'https://old-portal.example';
const SOURCES = { web: OLD_WEB, portal: OLD_PORTAL };

interface FakeWindow extends CarryOverWindow {
  posted: Array<{ data: unknown; targetOrigin: string }>;
  closed: boolean;
}

function fakeWindow(): FakeWindow {
  const posted: FakeWindow['posted'] = [];
  return { posted, closed: false, postMessage: (data, targetOrigin) => posted.push({ data, targetOrigin }), focus: () => undefined };
}

/** One page's `message` listener, as `window.addEventListener('message', …)` would hold it. */
function messageBus() {
  const handlers = new Set<(event: MessageEvent) => void>();
  return {
    listen: (handler: (event: MessageEvent) => void) => {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    deliver: (data: unknown, origin: string, source: unknown) => {
      const event = { data, origin, source } as MessageEvent;
      handlers.forEach((handler) => handler(event));
    },
    size: () => handlers.size,
  };
}

const ready = { type: 'mtb3a.carry-over.ready', v: 1 };
const done = { type: 'mtb3a.carry-over.done', v: 1, counts: { clients: 2 }, totals: { USD: { paid: '10.00' } } };

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('receiveUrl', () => {
  it('names the source in the query and never anything else', () => {
    expect(receiveUrl(PORTAL, 'web')).toBe('https://app.example/carry-over/receive?from=web');
  });
});

describe('startCarryOverSend (the old page)', () => {
  it('opens the new address before it waits on anything (R2: Safari and Firefox block a popup after an await)', () => {
    const order: string[] = [];
    const popup = fakeWindow();
    const bus = messageBus();
    void startCarryOverSend({
      portalOrigin: PORTAL,
      source: 'web',
      read: async () => {
        order.push('read');
        return new Blob(['{}']);
      },
      open: (url) => {
        order.push(`open ${url}`);
        return popup;
      },
      listen: bus.listen,
    });
    // Synchronously, before the returned promise has been awaited once.
    expect(order).toEqual(['open https://app.example/carry-over/receive?from=web', 'read']);
  });

  it('sends the payload to the new address only, once it is ready and the read is done, then resolves on done', async () => {
    const popup = fakeWindow();
    const bus = messageBus();
    const blob = new Blob(['{"version":24}']);
    const outcome = startCarryOverSend({ portalOrigin: PORTAL, source: 'web', read: async () => blob, open: () => popup, listen: bus.listen });

    bus.deliver(ready, PORTAL, popup);
    await vi.waitFor(() => expect(popup.posted).toHaveLength(1));
    expect(popup.posted[0]).toEqual({ targetOrigin: PORTAL, data: { type: 'mtb3a.carry-over.payload', v: 1, kind: 'free-app-backup', payload: blob } });

    bus.deliver(done, PORTAL, popup);
    await expect(outcome).resolves.toEqual({ status: 'done', counts: { clients: 2 }, totals: { USD: { paid: '10.00' } } });
    expect(bus.size()).toBe(0);
  });

  it('the portal sends a records file, never a free-app backup', async () => {
    const popup = fakeWindow();
    const bus = messageBus();
    void startCarryOverSend({ portalOrigin: PORTAL, source: 'portal', read: async () => new Blob(['zip']), open: () => popup, listen: bus.listen });
    bus.deliver(ready, PORTAL, popup);
    await vi.waitFor(() => expect(popup.posted).toHaveLength(1));
    expect((popup.posted[0]!.data as { kind: string }).kind).toBe('records-file');
  });

  it.each([
    ['a different origin', 'https://evil.example', 'popup'],
    ['a different window on the right origin', PORTAL, 'other'],
  ])('ignores ready from %s', async (_label, origin, which) => {
    const popup = fakeWindow();
    const bus = messageBus();
    void startCarryOverSend({ portalOrigin: PORTAL, source: 'web', read: async () => new Blob(['{}']), open: () => popup, listen: bus.listen });
    bus.deliver(ready, origin, which === 'popup' ? popup : fakeWindow());
    await vi.advanceTimersByTimeAsync(0);
    expect(popup.posted).toEqual([]);
  });

  it('falls back when the popup is blocked', async () => {
    const bus = messageBus();
    const outcome = await startCarryOverSend({ portalOrigin: PORTAL, source: 'web', read: async () => new Blob(['{}']), open: () => null, listen: bus.listen });
    expect(outcome).toEqual({ status: 'fallback', reason: 'blocked' });
  });

  it('falls back when no ready arrives in time', async () => {
    const popup = fakeWindow();
    const bus = messageBus();
    const outcome = startCarryOverSend({ portalOrigin: PORTAL, source: 'web', read: async () => new Blob(['{}']), open: () => popup, listen: bus.listen });
    await vi.advanceTimersByTimeAsync(SENDER_READY_TIMEOUT_MS);
    await expect(outcome).resolves.toEqual({ status: 'fallback', reason: 'no-ready' });
    expect(bus.size()).toBe(0);
  });

  it('waits as long as the person reads the summary once ready has arrived', async () => {
    const popup = fakeWindow();
    const bus = messageBus();
    let settled = false;
    const outcome = startCarryOverSend({ portalOrigin: PORTAL, source: 'web', read: async () => new Blob(['{}']), open: () => popup, listen: bus.listen });
    void outcome.then(() => (settled = true));
    bus.deliver(ready, PORTAL, popup);
    await vi.advanceTimersByTimeAsync(SENDER_READY_TIMEOUT_MS * 10);
    expect(settled).toBe(false);
  });

  it('falls back when the popup is closed before done', async () => {
    const popup = fakeWindow();
    const bus = messageBus();
    const outcome = startCarryOverSend({ portalOrigin: PORTAL, source: 'web', read: async () => new Blob(['{}']), open: () => popup, listen: bus.listen });
    bus.deliver(ready, PORTAL, popup);
    popup.closed = true;
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(outcome).resolves.toEqual({ status: 'fallback', reason: 'closed' });
  });

  it('falls back when the records cannot be read', async () => {
    const popup = fakeWindow();
    const bus = messageBus();
    const outcome = startCarryOverSend({ portalOrigin: PORTAL, source: 'web', read: async () => Promise.reject(new Error('quota')), open: () => popup, listen: bus.listen });
    await expect(outcome).resolves.toEqual({ status: 'fallback', reason: 'read-failed' });
  });

  it('resolves declined when the person cancels on the new address', async () => {
    const popup = fakeWindow();
    const bus = messageBus();
    const outcome = startCarryOverSend({ portalOrigin: PORTAL, source: 'web', read: async () => new Blob(['{}']), open: () => popup, listen: bus.listen });
    bus.deliver(ready, PORTAL, popup);
    bus.deliver({ type: 'mtb3a.carry-over.declined', v: 1 }, PORTAL, popup);
    await expect(outcome).resolves.toEqual({ status: 'declined' });
  });

  it('falls back at once when the new address could not check or save the records', async () => {
    const popup = fakeWindow();
    const bus = messageBus();
    const outcome = startCarryOverSend({ portalOrigin: PORTAL, source: 'web', read: async () => new Blob(['{}']), open: () => popup, listen: bus.listen });
    bus.deliver(ready, PORTAL, popup);
    bus.deliver({ type: 'mtb3a.carry-over.failed', v: 1 }, PORTAL, popup);
    await expect(outcome).resolves.toEqual({ status: 'fallback', reason: 'failed' });
  });

  it('falls back as soon as the popup closes, even before ready', async () => {
    const popup = fakeWindow();
    const bus = messageBus();
    const outcome = startCarryOverSend({ portalOrigin: PORTAL, source: 'web', read: async () => new Blob(['{}']), open: () => popup, listen: bus.listen });
    popup.closed = true;
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(outcome).resolves.toEqual({ status: 'fallback', reason: 'closed' });
    expect(bus.size()).toBe(0);
  });

  it.each([
    ['done', done],
    ['declined', { type: 'mtb3a.carry-over.declined', v: 1 }],
    ['failed', { type: 'mtb3a.carry-over.failed', v: 1 }],
  ])('ignores %s before ready: it can only answer records this page sent', async (_label, message) => {
    const popup = fakeWindow();
    const bus = messageBus();
    let settled = false;
    void startCarryOverSend({ portalOrigin: PORTAL, source: 'web', read: async () => new Blob(['{}']), open: () => popup, listen: bus.listen }).then(() => (settled = true));
    bus.deliver(message, PORTAL, popup);
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    expect(popup.posted).toEqual([]);
  });

  it('sends the records once, even when the new page says ready twice (it was reloaded)', async () => {
    const popup = fakeWindow();
    const bus = messageBus();
    void startCarryOverSend({ portalOrigin: PORTAL, source: 'web', read: async () => new Blob(['{}']), open: () => popup, listen: bus.listen });
    bus.deliver(ready, PORTAL, popup);
    bus.deliver(ready, PORTAL, popup);
    await vi.advanceTimersByTimeAsync(0);
    expect(popup.posted).toHaveLength(1);
  });

  it('after ready, an answer from another origin or window is ignored', async () => {
    const popup = fakeWindow();
    const bus = messageBus();
    let settled = false;
    void startCarryOverSend({ portalOrigin: PORTAL, source: 'web', read: async () => new Blob(['{}']), open: () => popup, listen: bus.listen }).then(() => (settled = true));
    bus.deliver(ready, PORTAL, popup);
    bus.deliver(done, 'https://evil.example', popup);
    bus.deliver(done, PORTAL, fakeWindow());
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
  });

  it('falls back when the records can\'t be read after ready arrived, and sends nothing', async () => {
    const popup = fakeWindow();
    const bus = messageBus();
    let fail: (error: Error) => void = () => undefined;
    const reading = new Promise<Blob>((_resolve, reject) => (fail = reject));
    const outcome = startCarryOverSend({ portalOrigin: PORTAL, source: 'web', read: () => reading, open: () => popup, listen: bus.listen });
    bus.deliver(ready, PORTAL, popup);
    fail(new Error('quota'));
    await expect(outcome).resolves.toEqual({ status: 'fallback', reason: 'read-failed' });
    expect(popup.posted).toEqual([]);
  });
});

describe('awaitCarryOverPayload (the new address)', () => {
  it('says ready to the opener on its baked origin, then hands over a payload whose kind matches its source', async () => {
    const opener = fakeWindow();
    const bus = messageBus();
    const outcome = awaitCarryOverPayload({ sources: SOURCES, from: 'web', opener, listen: bus.listen });
    expect(opener.posted).toEqual([{ data: ready, targetOrigin: OLD_WEB }]);

    const blob = new Blob(['{}']);
    bus.deliver({ type: 'mtb3a.carry-over.payload', v: 1, kind: 'free-app-backup', payload: blob }, OLD_WEB, opener);
    const result = await outcome;
    expect(result.status).toBe('payload');
    if (result.status !== 'payload') return;
    expect(result.kind).toBe('free-app-backup');
    expect(result.payload).toBe(blob);

    result.reply.done({ counts: { clients: 1 }, totals: {} });
    expect(opener.posted[1]).toEqual({ targetOrigin: OLD_WEB, data: { type: 'mtb3a.carry-over.done', v: 1, counts: { clients: 1 }, totals: {} } });
    result.reply.declined();
    expect(opener.posted[2]).toEqual({ targetOrigin: OLD_WEB, data: { type: 'mtb3a.carry-over.declined', v: 1 } });
    result.reply.failed();
    expect(opener.posted[3]).toEqual({ targetOrigin: OLD_WEB, data: { type: 'mtb3a.carry-over.failed', v: 1 } });
  });

  it.each([
    ['the wrong origin', { origin: OLD_PORTAL, source: 'opener', kind: 'free-app-backup' }],
    ['another window', { origin: OLD_WEB, source: 'other', kind: 'free-app-backup' }],
    ['a kind the source may not send', { origin: OLD_WEB, source: 'opener', kind: 'records-file' }],
  ])('ignores a payload from %s', async (_label, msg) => {
    const opener = fakeWindow();
    const bus = messageBus();
    let settled = false;
    void awaitCarryOverPayload({ sources: SOURCES, from: 'web', opener, listen: bus.listen }).then(() => (settled = true));
    bus.deliver({ type: 'mtb3a.carry-over.payload', v: 1, kind: msg.kind, payload: new Blob(['{}']) }, msg.origin, msg.source === 'opener' ? opener : fakeWindow());
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
  });

  it('refuses a payload over the size cap', async () => {
    const opener = fakeWindow();
    const bus = messageBus();
    const outcome = awaitCarryOverPayload({ sources: SOURCES, from: 'web', opener, listen: bus.listen });
    const huge = { size: CARRY_OVER_MAX_BYTES + 1 } as Blob;
    bus.deliver({ type: 'mtb3a.carry-over.payload', v: 1, kind: 'free-app-backup', payload: huge }, OLD_WEB, opener);
    await expect(outcome).resolves.toEqual({ status: 'file-only', reason: 'too-large' });
    // The old page hears at once, instead of waiting until the person closes this one.
    expect(opener.posted.at(-1)).toEqual({ targetOrigin: OLD_WEB, data: { type: 'mtb3a.carry-over.failed', v: 1 } });
  });

  describe('from the old portal address', () => {
    it('says ready on the old portal\'s origin and takes only its records file', async () => {
      const opener = fakeWindow();
      const bus = messageBus();
      const outcome = awaitCarryOverPayload({ sources: SOURCES, from: 'portal', opener, listen: bus.listen });
      expect(opener.posted).toEqual([{ data: ready, targetOrigin: OLD_PORTAL }]);
      bus.deliver({ type: 'mtb3a.carry-over.payload', v: 1, kind: 'free-app-backup', payload: new Blob(['{}']) }, OLD_PORTAL, opener);
      bus.deliver({ type: 'mtb3a.carry-over.payload', v: 1, kind: 'records-file', payload: new Blob(['{}']) }, OLD_WEB, opener);
      bus.deliver({ type: 'mtb3a.carry-over.payload', v: 1, kind: 'records-file', payload: new Blob(['{}']) }, OLD_PORTAL, fakeWindow());
      let settled = false;
      void outcome.then(() => (settled = true));
      await vi.advanceTimersByTimeAsync(0);
      expect(settled).toBe(false);
      const blob = new Blob(['zip']);
      bus.deliver({ type: 'mtb3a.carry-over.payload', v: 1, kind: 'records-file', payload: blob }, OLD_PORTAL, opener);
      await expect(outcome).resolves.toMatchObject({ status: 'payload', source: 'portal', kind: 'records-file', payload: blob });
    });

    it('refuses one over the size cap, and tells the old page', async () => {
      const opener = fakeWindow();
      const bus = messageBus();
      const outcome = awaitCarryOverPayload({ sources: SOURCES, from: 'portal', opener, listen: bus.listen });
      bus.deliver({ type: 'mtb3a.carry-over.payload', v: 1, kind: 'records-file', payload: { size: CARRY_OVER_MAX_BYTES + 1 } as Blob }, OLD_PORTAL, opener);
      await expect(outcome).resolves.toEqual({ status: 'file-only', reason: 'too-large' });
      expect(opener.posted.at(-1)).toEqual({ targetOrigin: OLD_PORTAL, data: { type: 'mtb3a.carry-over.failed', v: 1 } });
    });

    it('times out, and notices the old page closing, the same way', async () => {
      const bus = messageBus();
      const slow = awaitCarryOverPayload({ sources: SOURCES, from: 'portal', opener: fakeWindow(), listen: bus.listen });
      await vi.advanceTimersByTimeAsync(RECEIVER_PAYLOAD_TIMEOUT_MS);
      await expect(slow).resolves.toEqual({ status: 'file-only', reason: 'timeout' });
      const opener = fakeWindow();
      const closing = awaitCarryOverPayload({ sources: SOURCES, from: 'portal', opener, listen: messageBus().listen });
      opener.closed = true;
      await vi.advanceTimersByTimeAsync(1_000);
      await expect(closing).resolves.toEqual({ status: 'file-only', reason: 'opener-closed' });
    });
  });

  it.each([
    ['no opener', { from: 'web', opener: null, sources: SOURCES }, 'no-opener'],
    ['an unknown source', { from: 'desktop', opener: 'opener', sources: SOURCES }, 'unknown-source'],
    ['no from at all', { from: null, opener: 'opener', sources: SOURCES }, 'unknown-source'],
    ['a build with no sources (stage legacy or proxy)', { from: 'web', opener: 'opener', sources: {} }, 'unknown-source'],
  ])('goes straight to the file picker with %s', async (_label, input, reason) => {
    const opener = fakeWindow();
    const bus = messageBus();
    const outcome = await awaitCarryOverPayload({ sources: input.sources, from: input.from, opener: input.opener === 'opener' ? opener : null, listen: bus.listen });
    expect(outcome).toEqual({ status: 'file-only', reason });
    expect(opener.posted).toEqual([]);
  });

  it('switches to the file picker when no payload comes 20 s after ready (R8)', async () => {
    const opener = fakeWindow();
    const bus = messageBus();
    const outcome = awaitCarryOverPayload({ sources: SOURCES, from: 'web', opener, listen: bus.listen });
    await vi.advanceTimersByTimeAsync(RECEIVER_PAYLOAD_TIMEOUT_MS);
    await expect(outcome).resolves.toEqual({ status: 'file-only', reason: 'timeout' });
    expect(bus.size()).toBe(0);
  });

  it('switches to the file picker as soon as the old page closes (R8)', async () => {
    const opener = fakeWindow();
    const bus = messageBus();
    const outcome = awaitCarryOverPayload({ sources: SOURCES, from: 'web', opener, listen: bus.listen });
    opener.closed = true;
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(outcome).resolves.toEqual({ status: 'file-only', reason: 'opener-closed' });
  });
});
