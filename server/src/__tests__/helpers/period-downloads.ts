import ExcelJS from 'exceljs';
import { unzipSync } from 'fflate';
import pino from 'pino';
import type { AppDependencies } from '../../app.js';
import { MemoryAttachmentStorage } from '../../attachments/storage.js';
import { json, idem, read, SAME_ORIGIN, type AccountantHarness, type Loose, type Person } from './accountants.js';
import { shareLinkHarness } from './share-links.js';

/**
 * MUT-314 (ADR-248): the share-link harness (memory store, clock at T0 = 2026-11-06 09:00 UTC, accountant access and
 * share links on) with period downloads on, a memory bucket and a logger the tests can watch.
 */
export function downloadHarness(overrides: Partial<AppDependencies> = {}) {
  const storage = new MemoryAttachmentStorage();
  const logger = pino({ level: 'silent' });
  const h = shareLinkHarness({ periodDownloads: true, attachments: storage, logger, ...overrides });
  return { ...h, storage, logger };
}
export type DownloadHarness = ReturnType<typeof downloadHarness>;

export interface MintQuery {
  type?: 'report' | 'receipts';
  from?: string;
  to?: string;
  lang?: string;
  asOf?: string;
}

export const mintRequest = (h: AccountantHarness, p: Person, profileId: string, q: MintQuery = {}) => {
  const query = new URLSearchParams({ type: q.type ?? 'report', from: q.from ?? '2026-10', to: q.to ?? '2026-10', ...(q.lang ? { lang: q.lang } : {}), ...(q.asOf ? { asOf: q.asOf } : {}) });
  return h.app.request(`/v1/period-downloads/ticket?${query}`, { headers: p.on(profileId) });
};

export async function mintOk(h: AccountantHarness, p: Person, profileId: string, q: MintQuery = {}): Promise<Loose> {
  const res = await mintRequest(h, p, profileId, q);
  if (res.status !== 200) throw new Error(`mint failed: ${res.status} ${await res.text()}`);
  return read(res);
}

export const streamRequest = (h: AccountantHarness, body: Record<string, string>, form = false) =>
  form
    ? h.app.request('/v1/period-downloads/stream', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body).toString() })
    : h.app.request('/v1/period-downloads/stream', json(body));

/** Mint, then stream; the stream's response. */
export async function download(h: AccountantHarness, p: Person, profileId: string, q: MintQuery = {}): Promise<Response> {
  const { ticket } = await mintOk(h, p, profileId, q);
  return streamRequest(h, { ticket });
}

export const linkMint = (h: AccountantHarness, body: Record<string, unknown>) => h.app.request('/v1/share-links/download-ticket', json(body, SAME_ORIGIN));

export async function workbookOf(res: Response): Promise<ExcelJS.Workbook> {
  if (res.status !== 200) throw new Error(`stream failed: ${res.status} ${await res.text()}`);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load((await res.arrayBuffer()) as ArrayBuffer);
  return wb;
}

/** A sheet's rows as plain values, header first (exceljs pads index 0). */
export function rowsOf(ws: ExcelJS.Worksheet): unknown[][] {
  const out: unknown[][] = [];
  ws.eachRow({ includeEmpty: false }, (row) => out.push((row.values as unknown[]).slice(1)));
  return out;
}

export async function zipOf(res: Response): Promise<Record<string, Uint8Array>> {
  if (res.status !== 200) throw new Error(`stream failed: ${res.status} ${await res.text()}`);
  return unzipSync(new Uint8Array(await res.arrayBuffer()));
}

/** index.csv's lines, split on commas (the tests' values hold none), without the BOM. */
export function indexOf(files: Record<string, Uint8Array>): string[][] {
  const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(files['index.csv']!);
  return text.slice(1).split('\r\n').filter(Boolean).map((line) => line.split(','));
}

export async function expenseOn(h: AccountantHarness, p: Person, profileId: string, body: Record<string, unknown>): Promise<Loose> {
  const res = await h.app.request('/v1/expenses', json({ amount: '12.00', currency: 'ILS', occurredOn: '2026-10-05', ...body }, { ...p.on(profileId), ...idem() }));
  if (res.status !== 201) throw new Error(`expense failed: ${res.status} ${await res.text()}`);
  return read(res);
}

export async function receivedOn(h: AccountantHarness, p: Person, profileId: string, occurredOn: string, amount = '100.00', currency = 'ILS'): Promise<Loose> {
  const res = await h.app.request('/v1/income', json({ kind: 'received', amount, currency, occurredOn }, { ...p.on(profileId), ...idem() }));
  if (res.status !== 201) throw new Error(`income failed: ${res.status} ${await res.text()}`);
  return read(res);
}

/** A READY receipt on the expense, through the real upload routes, its bytes in the memory bucket. */
export async function receiptOn(h: DownloadHarness, p: Person, profileId: string, expenseId: string, bytes: Uint8Array, mimeType = 'image/png'): Promise<{ id: string; storageKey: string }> {
  const started = await read(await h.app.request(`/v1/expenses/${expenseId}/receipts`, json({ filename: 'phone-upload.name', mimeType, sizeBytes: bytes.byteLength }, p.on(profileId))));
  const storageKey = new URL(started.upload.url).pathname.replace(/^\/+/, '').replace(/^upload\//, '');
  h.storage.put(storageKey, { sizeBytes: bytes.byteLength, contentType: mimeType }, bytes);
  const done = await h.app.request(`/v1/expenses/${expenseId}/receipts/${started.receipt.id}/complete`, { method: 'POST', headers: p.on(profileId) });
  if (done.status !== 200) throw new Error(`complete failed: ${done.status} ${await done.text()}`);
  return { id: started.receipt.id as string, storageKey };
}
