import { presetKeyForName } from '../../../../server/src/expenses/presets.js';
import { MemoryLedgerStore } from '../../../../server/src/repositories/memory.js';
import { localBlobKey } from '../../session/localBackendContract.js';
import { backedUpKeys, MemoryAttachmentStorage } from '../attachments.js';
import type { StoredFile } from '../blobStore.js';
import { createLocalApp } from '../createLocalApp.js';
import { mintLocalSession } from '../mintLocalSession.js';
import { LOCAL_FORMAT_VERSION, type StoredSnapshot } from '../migrations/index.js';
import { bigintToDecimal } from './money';
import { dependenciesOf, sourceKey, type CarryOp, type CarryOverPlan, type CarryOverReport, type ReportLine, type NotCarriedCode, type ChangeCode } from './mapFreeAppBackup';

/**
 * Sends a carry-over plan through a throwaway local app (MUT-291 §3.1 E2):
 * the server's own routes over a fresh MemoryLedgerStore, with nothing
 * persisted, so every rule checks every record and a failure anywhere
 * leaves this device untouched. The result is one snapshot plus its receipt
 * files, for `applyRestore` to write in a single step.
 *
 *  - A 4xx is that record's answer: it is listed (`refused`, with the API's
 *    reason) and whatever needed it follows (`parent-not-carried`). A link the
 *    record can do without (a category, a project) is dropped instead.
 *  - A 5xx is a bug, never the person's data: the carry-over stops and
 *    nothing is offered (CarryOverAborted).
 *  - The local rate limit is off (R1); the page is given back to the browser
 *    every `yieldEvery` ops, with progress (R5).
 */

export class CarryOverAborted extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(`carry-over stopped: ${status} ${code}`);
    this.name = 'CarryOverAborted';
  }
}

export interface ReplayOptions {
  now: () => Date;
  /** The new profiles' timezone (the browser's). */
  timezone: string;
  locale: 'ar' | 'en';
  onProgress?: (done: number, total: number) => void;
  yieldToBrowser?: () => Promise<void>;
  /** Milliseconds, for the time slices (`performance.now` unless a test sets it). */
  clock?: () => number;
}

export interface ReplayResult {
  snapshot: Omit<StoredSnapshot, 'stateVersion'>;
  files: Array<{ key: string } & StoredFile>;
  report: CarryOverReport;
  /** Every backup row that arrived, as `table:id` (the totals check sums exactly these). */
  carried: ReadonlySet<string>;
  /** Plan profile ref → the profile id it got. */
  profileIds: ReadonlyMap<string, string>;
  /** The throwaway app and its session, for the totals check's summary cross-check. */
  request: (method: string, path: string, profileId?: string) => Promise<Response>;
}

/** The longest the replay holds the page before it gives it back (R5): a time slice, since one op can cost a lot more on a phone. */
export const REPLAY_SLICE_MS = 40;

/** Links a record can lose and still arrive (it is then counted as changed). */
const OPTIONAL_LINKS: Partial<Record<CarryOp['op'], ReadonlyArray<'category' | 'project' | 'customer'>>> = {
  expense: ['category', 'project', 'customer'],
  owed: ['project'],
  received: ['customer', 'project'],
};

/** A message to itself, not a timer: a background tab clamps timers to a second or more, and messages it doesn't. */
export function yieldToBrowser(): Promise<void> {
  return new Promise<void>((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      resolve();
    };
    channel.port2.postMessage(null);
  });
}

export async function replayCarryOver(plan: CarryOverPlan, options: ReplayOptions): Promise<ReplayResult> {
  const { now, timezone, locale, onProgress, yieldToBrowser: giveBack = yieldToBrowser, clock = () => performance.now() } = options;
  const store = new MemoryLedgerStore();
  const attachments = new MemoryAttachmentStorage();
  const { token } = await mintLocalSession(store, now, locale);
  const app = createLocalApp({ store, now, attachments, fxRates: null, rateLimitPerMinute: Infinity });

  const ids = new Map<string, string>();
  const carried = new Set<string>();
  const refused = new Map<string, number>();
  let parentMissing = 0;
  let linksDropped = 0;
  const categoriesByProfile = new Map<string, Map<string, string>>();

  const send = async (method: string, path: string, profileId: string | undefined, body?: unknown, idempotencyKey?: string): Promise<Response> => {
    const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
    if (profileId) headers['X-Mutaba3a-Profile'] = profileId;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
    // In-page only: never fetched over the network; the one loopback origin the portal bundle may name (bundle-origins.json).
    return app.fetch(new Request(`http://localhost${path}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }));
  };

  /**
   * The created row's id (`idOf` reads it where the route's answer isn't the row itself); a 4xx is recorded and
   * answers null; a 5xx, or a 2xx without an id, stops everything.
   */
  const created = async (response: Response, idOf: (body: Record<string, unknown>) => unknown = (body) => body.id): Promise<{ id: string; body: Record<string, unknown> } | null> => {
    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    const outcome = outcomeOf(response.status, body);
    if (outcome.kind === 'refused') {
      refused.set(outcome.reason, (refused.get(outcome.reason) ?? 0) + 1);
      return null;
    }
    const id = idOf(body);
    if (typeof id !== 'string' || id === '') throw new CarryOverAborted(response.status, 'no-id');
    return { id, body };
  };

  let unreadableReceipts = 0;
  let sliceStart = clock();
  for (const [index, op] of plan.ops.entries()) {
    if (clock() - sliceStart >= REPLAY_SLICE_MS) {
      onProgress?.(index, plan.ops.length);
      await giveBack();
      sliceStart = clock();
    }
    const resolved = resolveLinks(op, ids);
    if (!resolved) {
      parentMissing++;
      continue;
    }
    if (resolved.dropped) linksDropped++;
    const ref = (name: string) => ids.get(name)!;
    const profileId = op.profile ? ref(op.profile) : undefined;
    const key = idempotencyKeyOf(op.ref);
    let result: { id: string } | null = null;

    switch (op.op) {
      case 'profile':
        result = await created(await send('POST', '/v1/profiles', undefined, { name: op.name, type: 'BUSINESS', defaultCurrency: op.defaultCurrency, timezone }, key));
        break;
      case 'category': {
        const existing = await categoriesOf(profileId!);
        // MUT-464: by name, then by preset entry — a backup's "إيجار المكتب" is the profile's seeded "Office Rent".
        const presetKey = presetKeyForName(op.name);
        const found = existing.get(op.name.toLocaleLowerCase()) ?? (presetKey ? existing.get(presetEntry(presetKey)) : undefined);
        if (found) result = { id: found };
        else {
          result = await created(await send('POST', '/v1/expense-categories', profileId, { name: op.name, ...(op.color ? { color: op.color } : {}) }, key));
          if (result) {
            existing.set(op.name.toLocaleLowerCase(), result.id);
            if (presetKey) existing.set(presetEntry(presetKey), result.id);
          }
        }
        break;
      }
      case 'customer':
        result = await created(await send('POST', '/v1/customers', profileId, compact({ name: op.name, email: op.email, phone: op.phone, notes: op.notes }), key));
        break;
      case 'project':
        result = await created(await send('POST', '/v1/projects', profileId, { customerId: ref(op.customer), name: op.name, currency: op.currency }, key));
        break;
      case 'owed':
        result = await created(await send('POST', '/v1/income', profileId, compact({ kind: 'owed', amount: amount(op.amountMinor, op.currency), currency: op.currency, occurredOn: op.occurredOn, customerId: ref(op.customer), projectId: resolved.links.project, title: op.title, dueDate: op.dueDate }), key));
        break;
      case 'received':
        result = await created(await send('POST', '/v1/income', profileId, compact({ kind: 'received', amount: amount(op.amountMinor, op.currency), currency: op.currency, occurredOn: op.occurredOn, customerId: resolved.links.customer, projectId: resolved.links.project, notes: op.notes }), key));
        break;
      case 'settle':
        result = await created(await send('POST', `/v1/receivables/${ref(op.owed)}/settle`, profileId, { amount: amount(op.amountMinor, op.currency), paidAt: op.paidAt }, key), (body) => (body.payment as { id?: unknown } | undefined)?.id);
        break;
      case 'expense':
        result = await created(await send('POST', '/v1/expenses', profileId, compact({ occurredOn: op.occurredOn, amount: amount(op.amountMinor, op.currency), currency: op.currency, title: op.title, vendor: op.vendor, categoryId: resolved.links.category, customerId: resolved.links.customer, projectId: resolved.links.project, notes: op.notes }), key));
        break;
      case 'receipt':
        result = await uploadReceipt(op, ref(op.expense), profileId!);
        break;
      case 'conversion':
        result = await created(await send('POST', '/v1/conversions', profileId, compact({ occurredOn: op.occurredOn, amount: amount(op.amountMinor, op.currency), currency: op.currency, toAmount: amount(op.toAmountMinor, op.toCurrency), toCurrency: op.toCurrency, notes: op.notes }), key));
        break;
    }
    if (result) {
      ids.set(op.ref, result.id);
      carried.add(sourceKey(op.source));
    }
  }
  onProgress?.(plan.ops.length, plan.ops.length);

  const { maps } = store.snapshot();
  const profileIds = new Map(plan.ops.filter((op) => op.op === 'profile' && ids.has(op.ref)).map((op) => [op.ref, ids.get(op.ref)!]));
  return {
    snapshot: { formatVersion: LOCAL_FORMAT_VERSION, savedAt: now(), maps },
    files: attachments.filesFor(backedUpKeys(maps)),
    report: withReplayLines(plan.report, refused, parentMissing, linksDropped, unreadableReceipts),
    carried,
    profileIds,
    request: (method, path, profileId) => send(method, path, profileId),
  };

  async function categoriesOf(profileId: string): Promise<Map<string, string>> {
    let byName = categoriesByProfile.get(profileId);
    if (!byName) {
      const response = await send('GET', '/v1/expense-categories', profileId);
      if (response.status >= 500) throw new CarryOverAborted(response.status, 'expense-categories');
      const body = (await response.json().catch(() => ({ items: [] }))) as { items?: Array<{ id: string; name: string; presetKey?: string | null }> };
      byName = new Map((body.items ?? []).flatMap((c) => [[c.name.toLocaleLowerCase(), c.id] as const, ...(c.presetKey ? [[presetEntry(c.presetKey), c.id] as const] : [])]));
      categoriesByProfile.set(profileId, byName);
    }
    return byName;
  }

  /**
   * The routes' own three steps: sign an upload, put the bytes where the URL says, complete. A file that won't decode
   * is listed, not fatal; its size is the decoded bytes', so the complete step checks the real file. A receipt the
   * rules refuse at complete is deleted again, so no half-uploaded row is saved.
   */
  async function uploadReceipt(op: Extract<CarryOp, { op: 'receipt' }>, expenseId: string, profileId: string): Promise<{ id: string } | null> {
    let bytes: ArrayBuffer;
    try {
      bytes = base64Bytes(op.data);
    } catch {
      unreadableReceipts++;
      return null;
    }
    // Held once, as bytes: the backup's text copy isn't needed after this (the totals never read it).
    op.data = '';
    const started = await created(await send('POST', `/v1/expenses/${expenseId}/receipts`, profileId, { filename: op.fileName, mimeType: op.mimeType, sizeBytes: bytes.byteLength }), (body) => (body.receipt as { id?: unknown } | undefined)?.id);
    if (!started) return null;
    const upload = started.body.upload as { url: string } | undefined;
    if (!upload) throw new CarryOverAborted(500, 'receipt-upload-shape');
    attachments.put(localBlobKey(upload.url), { type: op.mimeType, bytes });
    const path = `/v1/expenses/${expenseId}/receipts/${started.id}`;
    const completed = await created(await send('POST', `${path}/complete`, profileId, {}), () => started.id);
    if (completed) return { id: started.id };
    const removed = await send('DELETE', path, profileId);
    if (removed.status >= 500) throw new CarryOverAborted(removed.status, 'receipt-delete');
    return null;
  }
}

/** The op's required links all arrived (else null); its optional ones are kept when they did and dropped when not. */
/** A category map entry for a preset key; the prefix can't collide with a lower-cased name, which never holds one. */
function presetEntry(presetKey: string): string {
  return `\u0000preset:${presetKey}`;
}

function resolveLinks(op: CarryOp, ids: ReadonlyMap<string, string>): { links: Partial<Record<'category' | 'project' | 'customer', string>>; dropped: boolean } | null {
  const optional = OPTIONAL_LINKS[op.op] ?? [];
  const links: Partial<Record<'category' | 'project' | 'customer', string>> = {};
  let dropped = false;
  for (const name of optional) {
    const target = (op as unknown as Partial<Record<string, string>>)[name];
    if (!target) continue;
    const id = ids.get(target);
    if (id) links[name] = id;
    else dropped = true;
  }
  const optionalRefs = new Set(optional.map((name) => (op as unknown as Partial<Record<string, string>>)[name]).filter(Boolean));
  const required = dependenciesOf(op).filter((dep) => !optionalRefs.has(dep));
  return required.every((dep) => ids.has(dep)) ? { links, dropped } : null;
}

/** A route's answer: created; refused, with the API's reason (the record's own answer); or a 5xx, which stops the carry-over. */
export function outcomeOf(status: number, body: Record<string, unknown>): { kind: 'created' } | { kind: 'refused'; reason: string } {
  if (status >= 500) throw new CarryOverAborted(status, errorCode(body));
  if (status >= 400) return { kind: 'refused', reason: errorReason(body) };
  return { kind: 'created' };
}

function withReplayLines(report: CarryOverReport, refused: ReadonlyMap<string, number>, parentMissing: number, linksDropped: number, unreadableReceipts: number): CarryOverReport {
  const notCarried: Array<ReportLine<NotCarriedCode>> = [...report.notCarried, ...[...refused].map(([reason, count]) => ({ code: 'refused' as const, count, reason }))];
  if (parentMissing > 0) notCarried.push({ code: 'parent-not-carried', count: parentMissing });
  if (unreadableReceipts > 0) notCarried.push({ code: 'receipt-file-unreadable', count: unreadableReceipts });
  const changed: Array<ReportLine<ChangeCode>> = [...report.changed];
  if (linksDropped > 0) changed.push({ code: 'link-dropped', count: linksDropped });
  return { ...report, changed, notCarried };
}

function amount(minor: number, currency: string): string {
  return bigintToDecimal(BigInt(minor), currency);
}

/** Keys of 8 to 128 characters of `[A-Za-z0-9_\-:.]` (server/src/idempotency.ts); the prefix alone is long enough. */
export function idempotencyKeyOf(ref: string): string {
  return `mtb3a-carry:${ref}`.replace(/[^A-Za-z0-9_\-:.]/g, '_').slice(0, 128);
}

function compact<T extends Record<string, unknown>>(body: T): Partial<T> {
  return Object.fromEntries(Object.entries(body).filter(([, value]) => value !== undefined)) as Partial<T>;
}

function errorCode(body: Record<string, unknown>): string {
  const error = body.error as { code?: unknown } | undefined;
  return typeof error?.code === 'string' ? error.code : 'UNKNOWN';
}

function errorReason(body: Record<string, unknown>): string {
  const error = body.error as { code?: unknown; details?: { reason?: unknown } } | undefined;
  return typeof error?.details?.reason === 'string' ? error.details.reason : errorCode(body);
}

function base64Bytes(data: string): ArrayBuffer {
  const binary = atob(data.includes(',') ? data.slice(data.indexOf(',') + 1) : data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}
