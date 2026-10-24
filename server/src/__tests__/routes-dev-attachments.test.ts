import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import pino from 'pino';
import { createApp } from '../app.js';
import { LocalAttachmentStorage, requestOrigin } from '../attachments/local-storage.js';
import { SlidingWindowRateLimiter } from '../rate-limit.js';
import { MemoryLedgerStore } from '../repositories/memory.js';
import { provisionUser } from './helpers/provision.js';

/** MUT-396: receipts stored on local disk, end to end through the real routes (start → PUT → complete → download). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const read = (res: Response): Promise<Loose> => res.json() as Promise<Loose>;
let seq = 0;
const ADMIN_TOKEN = 'test-admin-token-with-at-least-32-characters';
const admin = { 'x-admin-token': ADMIN_TOKEN };
const COOKIE = '__Host-mut_session';
const SAME_ORIGIN = { origin: 'http://localhost' };
const json = (body: unknown, headers: Record<string, string> = {}) => ({ method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
let ik = 0;
const idem = () => ({ 'idempotency-key': `key-${++ik}-${Math.random().toString(36).slice(2, 8)}` });
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7, 7, 7]);

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

async function setup(opts: { local?: boolean; portal?: boolean } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'mut396-routes-'));
  dirs.push(dir);
  const storage = new LocalAttachmentStorage({ dir, secret: 'local-attachments-test-secret-0123456789', origin: requestOrigin });
  // Two days in the past, like every route test: tokens must be judged on this clock, not Date.now().
  const clock = { now: new Date('2026-10-22T21:30:00Z') };
  const app = createApp({
    store: new MemoryLedgerStore(),
    logger: pino({ level: 'silent' }),
    rateLimiter: new SlidingWindowRateLimiter(1_000_000),
    adminToken: ADMIN_TOKEN,
    keyEnvironment: 'test',
    version: '0.1.0-test',
    now: () => clock.now,
    attachments: storage,
    localAttachments: opts.local === false ? null : storage,
    attachmentUrlTtlSeconds: 900,
    receiptsLibrary: true,
    sessions: { pepper: 'session-pepper-with-at-least-32-chars!!', idleMinutes: 120, absoluteHours: 12, secureCookie: true, trustedProxyHops: 1 },
    ...(opts.portal ? { portal: { distDir: dir } } : {}),
  });
  const org = await read(await app.request('/admin/v1/organizations', json({ name: `Firm ${++seq}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }, admin)));
  const email = `qa${++seq}@firm.ps`;
  const created = await provisionUser(app, { email, displayName: 'QA', organizationId: org.id, locale: 'en' });
  const res = await app.request('/v1/sessions', json({ email, password: created.password }, SAME_ORIGIN));
  const token = new RegExp(`${COOKIE}=([^;]*)`).exec(res.headers.get('set-cookie') ?? '')?.[1] ?? '';
  const as = { cookie: `${COOKIE}=${token}`, 'x-mutaba3a-profile': org.id, ...SAME_ORIGIN };
  return { app, as, clock };
}

/** The phone's upload: PUT the bytes to the signed URL with the headers the start response returned. */
const put = (app: Loose, upload: { url: string; headers: Record<string, string> }, bytes = PNG) =>
  app.request(new URL(upload.url).pathname, { method: 'PUT', headers: { ...upload.headers, 'content-length': String(bytes.length) }, body: bytes });

describe('local receipt storage end to end (MUT-396 AC1)', () => {
  it('an expense receipt: start, PUT, complete, and the download returns the same bytes', async () => {
    const { app, as } = await setup();
    const expense = await read(await app.request('/v1/expenses', json({ occurredOn: '2026-10-22', amount: '15.00', currency: 'ILS', vendor: 'Cafe' }, { ...as, ...idem() })));
    const started = await read(await app.request(`/v1/expenses/${expense.id}/receipts`, json({ filename: 'cafe.png', mimeType: 'image/png', sizeBytes: PNG.length }, as)));
    expect(new URL(started.upload.url).origin).toBe('http://localhost');
    expect((await put(app, started.upload)).status).toBe(200);
    expect((await app.request(`/v1/expenses/${expense.id}/receipts/${started.receipt.id}/complete`, { method: 'POST', headers: as })).status).toBe(200);

    const download = await read(await app.request(`/v1/expenses/${expense.id}/receipts/${started.receipt.id}/download`, { headers: as }));
    const file = await app.request(new URL(download.url).pathname);
    expect(file.status).toBe(200);
    expect(file.headers.get('content-type')).toBe('image/png');
    expect(file.headers.get('content-disposition')).toContain('cafe.png');
    expect(file.headers.get('content-security-policy')).toBe('sandbox');
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(PNG);
  });

  it('a library receipt: upload with no expense, complete, download the same bytes', async () => {
    const { app, as } = await setup();
    const started = await read(await app.request('/v1/receipts/uploads', json({ filename: 'r.png', mimeType: 'image/png', sizeBytes: PNG.length }, { ...as, ...idem() })));
    expect((await put(app, started.upload)).status).toBe(200);
    expect((await app.request(`/v1/receipts/${started.receipt.id}/complete`, { method: 'POST', headers: as })).status).toBe(200);
    const download = await read(await app.request(`/v1/receipts/${started.receipt.id}/download`, { headers: as }));
    expect(new Uint8Array(await (await app.request(new URL(download.url).pathname)).arrayBuffer())).toEqual(PNG);
  });

  it('complete refuses until the bytes are there, and a PUT of the wrong size never lands', async () => {
    const { app, as } = await setup();
    const started = await read(await app.request('/v1/receipts/uploads', json({ filename: 'r.png', mimeType: 'image/png', sizeBytes: PNG.length }, { ...as, ...idem() })));
    expect((await app.request(`/v1/receipts/${started.receipt.id}/complete`, { method: 'POST', headers: as })).status).toBe(422);
    const bigger = new Uint8Array(PNG.length + 5);
    expect((await put(app, started.upload, bigger)).status).toBe(413);
    expect((await app.request(`/v1/receipts/${started.receipt.id}/complete`, { method: 'POST', headers: as })).status).toBe(422);
  });

  it('a signed URL expires on the app clock', async () => {
    const { app, as, clock } = await setup();
    const started = await read(await app.request('/v1/receipts/uploads', json({ filename: 'r.png', mimeType: 'image/png', sizeBytes: PNG.length }, { ...as, ...idem() })));
    clock.now = new Date(clock.now.getTime() + 901_000);
    const res = await put(app, started.upload);
    expect(res.status).toBe(403);
    expect(await res.text()).toContain('expired');
  });

  it('GET /dev/attachments answers for the QA env check', async () => {
    const { app } = await setup();
    expect(await read(await app.request('/dev/attachments'))).toEqual({ driver: 'local' });
  });

  it('is not mounted without the local driver', async () => {
    const { app } = await setup({ local: false });
    expect((await app.request('/dev/attachments')).status).toBe(404);
  });

  it('is never swallowed by the portal fallback', async () => {
    const { app } = await setup({ portal: true });
    const res = await app.request('/dev/attachments/not-a-token');
    expect(res.status).toBe(403);
    expect(await res.text()).toContain('Malformed');
  });
});
