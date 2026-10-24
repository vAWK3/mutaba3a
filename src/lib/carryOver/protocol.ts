/**
 * The carry-over hand-off (MUT-291 §3.2, ADR-185): an old page opens
 * the new portal's /carry-over/receive in a popup and posts this browser's records
 * to it. Shared by both senders (the free app, src/pages/carryOver; the run.app
 * portal, src/hosted/pages/carry-over) and the receiver, so it lives in src/lib
 * and imports nothing: no storage, no portal code.
 *
 * Origins are baked in at build time and never read from the URL; the URL's
 * `from` only says which baked origin to expect. Every message is checked for
 * its origin, its window and its kind. Nothing here writes a record: the
 * receiver validates the payload and asks the person before it does.
 */

export type CarryOverSource = 'web' | 'portal';
export type CarryOverKind = 'free-app-backup' | 'records-file';

/** Which payload each old page may send: the free app its own backup, the old portal its records file. */
export const KIND_FOR_SOURCE: Record<CarryOverSource, CarryOverKind> = { web: 'free-app-backup', portal: 'records-file' };

export const RECEIVE_PATH = '/carry-over/receive';
/** The old page waits this long for the new address to say it is listening. */
export const SENDER_READY_TIMEOUT_MS = 10_000;
/** The new address waits this long after saying so for the records to arrive (R8). */
export const RECEIVER_PAYLOAD_TIMEOUT_MS = 20_000;
/** How often each side checks whether the other window was closed. */
const CLOSED_POLL_MS = 500;
/** Well above a free-app backup with receipts; a bigger message is refused before it is read. */
export const CARRY_OVER_MAX_BYTES = 200 * 1024 * 1024;

const TYPE = { ready: 'mtb3a.carry-over.ready', payload: 'mtb3a.carry-over.payload', done: 'mtb3a.carry-over.done', declined: 'mtb3a.carry-over.declined', failed: 'mtb3a.carry-over.failed' } as const;
const VERSION = 1;

/** What the new address reports once the records are saved: counts per kind and totals per currency, as decimal strings. */
export interface CarryOverResult {
  counts: Record<string, number>;
  totals: Record<string, Record<string, string>>;
}

/** The parts of a window this protocol touches (a popup from `window.open`, or `window.opener`). */
export interface CarryOverWindow {
  postMessage(message: unknown, targetOrigin: string): void;
  readonly closed: boolean;
  focus(): void;
}

/** `window.addEventListener('message', handler)`, returning its removal. */
export type ListenForMessages = (handler: (event: MessageEvent) => void) => () => void;

export const listenOnWindow: ListenForMessages = (handler) => {
  window.addEventListener('message', handler);
  return () => window.removeEventListener('message', handler);
};

export function receiveUrl(portalOrigin: string, source: CarryOverSource): string {
  return `${portalOrigin}${RECEIVE_PATH}?from=${source}`;
}

function isSource(value: unknown): value is CarryOverSource {
  return value === 'web' || value === 'portal';
}

function messageOf(data: unknown, type: string): Record<string, unknown> | null {
  if (data === null || typeof data !== 'object') return null;
  const record = data as Record<string, unknown>;
  return record.type === type && record.v === VERSION ? record : null;
}

// ── The old page ──────────────────────────────────────────────────────────────

export type SendOutcome =
  | ({ status: 'done' } & CarryOverResult)
  | { status: 'declined' }
  /** `failed`: the new address got the records but couldn't check or save them; nothing was carried. */
  | { status: 'fallback'; reason: 'blocked' | 'no-ready' | 'closed' | 'read-failed' | 'failed' };

export interface SendOptions {
  portalOrigin: string;
  source: CarryOverSource;
  /** This browser's records as one file. Started only after the popup is open. */
  read: () => Promise<Blob>;
  open?: (url: string, target: string) => CarryOverWindow | null;
  listen?: ListenForMessages;
}

/**
 * Call it from the click itself. It opens the new address before it waits on
 * anything (R2: Safari and Firefox drop the click's permission across an
 * `await`, and block the popup), reads the records while the popup loads, and
 * sends them once both are ready. It resolves when the new address reports
 * done, declined or failed, or with the reason to fall back to the file.
 */
export function startCarryOverSend(options: SendOptions): Promise<SendOutcome> {
  const { portalOrigin, source, read, open = defaultOpen, listen = listenOnWindow } = options;
  const popup = open(receiveUrl(portalOrigin, source), 'mtb3a-carry-over');
  if (!popup) return Promise.resolve({ status: 'fallback', reason: 'blocked' });
  const reading = read();

  return new Promise<SendOutcome>((resolve) => {
    let isReady = false;
    let settled = false;
    const finish = (outcome: SendOutcome) => {
      if (settled) return;
      settled = true;
      stopListening();
      clearTimeout(readyTimer);
      clearInterval(closedPoll);
      resolve(outcome);
    };

    const stopListening = listen((event) => {
      if (event.origin !== portalOrigin || event.source !== popup) return;
      if (messageOf(event.data, TYPE.ready) && !isReady) {
        isReady = true;
        clearTimeout(readyTimer);
        reading.then(
          (payload) => popup.postMessage({ type: TYPE.payload, v: VERSION, kind: KIND_FOR_SOURCE[source], payload }, portalOrigin),
          () => finish({ status: 'fallback', reason: 'read-failed' }),
        );
        return;
      }
      // Only an answer to the records this page sent: never before ready.
      if (!isReady) return;
      const done = messageOf(event.data, TYPE.done);
      if (done) finish({ status: 'done', counts: (done.counts ?? {}) as CarryOverResult['counts'], totals: (done.totals ?? {}) as CarryOverResult['totals'] });
      else if (messageOf(event.data, TYPE.declined)) finish({ status: 'declined' });
      else if (messageOf(event.data, TYPE.failed)) finish({ status: 'fallback', reason: 'failed' });
    });

    reading.catch(() => finish({ status: 'fallback', reason: 'read-failed' }));
    const readyTimer = setTimeout(() => finish({ status: 'fallback', reason: 'no-ready' }), SENDER_READY_TIMEOUT_MS);
    const closedPoll = setInterval(() => {
      if (popup.closed) finish({ status: 'fallback', reason: 'closed' });
    }, CLOSED_POLL_MS);
  });
}

function defaultOpen(url: string, target: string): CarryOverWindow | null {
  // Never `noopener`: the new address answers through window.opener.
  return window.open(url, target);
}

// ── The new address ───────────────────────────────────────────────────────────

export interface CarryOverReply {
  done(result: CarryOverResult): void;
  declined(): void;
  /** The records arrived but couldn't be checked or saved: the old page offers its file at once. */
  failed(): void;
}

export type ReceiveOutcome =
  | { status: 'payload'; source: CarryOverSource; kind: CarryOverKind; payload: Blob; reply: CarryOverReply }
  | { status: 'file-only'; reason: 'no-opener' | 'unknown-source' | 'timeout' | 'opener-closed' | 'too-large' };

export interface ReceiveOptions {
  /** The old origins this build accepts (`__CARRY_OVER__.sources`); empty before stage live. */
  sources: Partial<Record<CarryOverSource, string>>;
  /** The URL's `from`, untrusted: it only picks one of `sources`. */
  from: string | null;
  opener: CarryOverWindow | null;
  listen?: ListenForMessages;
}

/**
 * Says ready to the old page, on its baked origin only, and waits for its
 * records. Anything else, or nothing within RECEIVER_PAYLOAD_TIMEOUT_MS, or
 * the old page closing first (R8), means the person chooses the file instead.
 */
export function awaitCarryOverPayload(options: ReceiveOptions): Promise<ReceiveOutcome> {
  const { sources, from, opener, listen = listenOnWindow } = options;
  const source = isSource(from) ? from : null;
  const origin = source ? sources[source] : undefined;
  if (!source || !origin) return Promise.resolve({ status: 'file-only', reason: 'unknown-source' });
  if (!opener) return Promise.resolve({ status: 'file-only', reason: 'no-opener' });

  const reply: CarryOverReply = {
    done: (result) => opener.postMessage({ type: TYPE.done, v: VERSION, ...result }, origin),
    declined: () => opener.postMessage({ type: TYPE.declined, v: VERSION }, origin),
    failed: () => opener.postMessage({ type: TYPE.failed, v: VERSION }, origin),
  };

  return new Promise<ReceiveOutcome>((resolve) => {
    let settled = false;
    const finish = (outcome: ReceiveOutcome) => {
      if (settled) return;
      settled = true;
      stopListening();
      clearTimeout(payloadTimer);
      clearInterval(closedPoll);
      resolve(outcome);
    };

    const stopListening = listen((event) => {
      if (event.origin !== origin || event.source !== opener) return;
      const message = messageOf(event.data, TYPE.payload);
      if (!message || message.kind !== KIND_FOR_SOURCE[source]) return;
      const payload = message.payload as Blob | undefined;
      if (!payload || typeof payload.size !== 'number') return;
      if (payload.size > CARRY_OVER_MAX_BYTES) {
        reply.failed();
        finish({ status: 'file-only', reason: 'too-large' });
      }
      else finish({ status: 'payload', source, kind: KIND_FOR_SOURCE[source], payload, reply });
    });

    opener.postMessage({ type: TYPE.ready, v: VERSION }, origin);
    const payloadTimer = setTimeout(() => finish({ status: 'file-only', reason: 'timeout' }), RECEIVER_PAYLOAD_TIMEOUT_MS);
    const closedPoll = setInterval(() => {
      if (opener.closed) finish({ status: 'file-only', reason: 'opener-closed' });
    }, CLOSED_POLL_MS);
  });
}
