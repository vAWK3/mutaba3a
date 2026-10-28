import { describe, expect, it } from 'vitest';
import pino from 'pino';
import { createApp } from '../app.js';
import { MemoryAttachmentStorage } from '../attachments/storage.js';
import type { ErrorReporter } from '../observability/reporter.js';
import { SlidingWindowRateLimiter } from '../rate-limit.js';
import { HttpOcrClient, OcrReadError, type OcrClient, type OcrReadInput, type OcrResult } from '../receipts/ocr-client.js';
import { InlineDispatcher, type ReadDispatcher } from '../receipts/reading/dispatcher.js';
import { googleOidcVerifier } from '../receipts/reading/oidc.js';
import { MAX_READ_ATTEMPTS, READ_GIVE_UP_MS, READ_LEASE_MS } from '../receipts/reading/reader.js';
import { receipt, REG_VALID_COMPANY } from '../receipts/extract/__tests__/fixtures.js';
import { MemoryLedgerStore } from '../repositories/memory.js';
import type { ReceiptSuggestion } from '../repositories/ports.js';
import { provisionUser } from './helpers/provision.js';

/** MUT-441: the server reads receipts — the complete trigger, the OIDC-only read job, its sweep, and the grant backlog. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const read = (res: Response): Promise<Loose> => res.json() as Promise<Loose>;
let seq = 0;

const ADMIN_TOKEN = 'test-admin-token-with-at-least-32-characters';
const JOB_TOKEN = 'job-token-with-at-least-32-characters-long';
const admin = { 'x-admin-token': ADMIN_TOKEN };
const COOKIE = '__Host-mut_session';
const SAME_ORIGIN = { origin: 'http://localhost' };
const JOB_PATH = '/jobs/v1/receipts/read';
const AUDIENCE = 'https://api.example.test';
const READ_SA = 'receipt-reads@proj.iam.gserviceaccount.com';
const SWEEP_SA = 'receipt-sweep@proj.iam.gserviceaccount.com';

/** A stand-in for Google's verifier: the token is `aud|email|verified`; a wrong audience throws, as verifyIdToken does. */
const fakeGoogle = {
  verifyIdToken: async ({ idToken, audience }: { idToken: string; audience: string }) => {
    const [aud, email, verified] = idToken.split('|');
    if (aud !== audience) throw new Error('Wrong recipient');
    return { getPayload: () => ({ aud, email, email_verified: verified === 'yes' }) };
  },
};
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
const asQueue = bearer(`${AUDIENCE}|${READ_SA}|yes`);
const asScheduler = bearer(`${AUDIENCE}|${SWEEP_SA}|yes`);

/** The words a receipt says; no log line or report may carry any of them (AC5). */
const SECRET_WORDS = ['ZZTOPSECRETVENDOR', 'שופרסל'];
const SUPERMARKET = receipt([`${SECRET_WORDS[0]} שופרסל בע"מ`, `ח.פ ${REG_VALID_COMPANY}`, 'תאריך: 28/10/2026 14:32', 'לחם 8.90', 'חלב 6.50', 'סה"כ ₪15.40', 'מזומן 20.00', 'עודף 4.60']);

class FakeOcr implements OcrClient {
  readonly calls: Array<{ contentType: string; hint: string }> = [];
  next: () => Promise<OcrResult> = async () => ({ engine: 'test', lines: SUPERMARKET, pages: 1 });
  async read(input: OcrReadInput): Promise<OcrResult> {
    this.calls.push({ contentType: input.contentType, hint: input.hint });
    return this.next();
  }
}

class RecordingDispatcher implements ReadDispatcher {
  readonly asked: string[] = [];
  fail = false;
  async enqueue(receiptId: string, attempt: number): Promise<void> {
    if (this.fail) throw new Error('Cloud Tasks unavailable');
    this.asked.push(`${receiptId}-${attempt}`);
  }
}

function capture() {
  const lines: string[] = [];
  const logger = pino({ level: 'debug' }, { write: (line: string) => void lines.push(line) });
  const reports: unknown[] = [];
  const reporter: ErrorReporter = {
    enabled: true,
    captureException: (err, tags) => void reports.push({ err: err instanceof Error ? { name: err.name, message: err.message, stack: err.stack, cause: (err as { cause?: unknown }).cause } : err, tags }),
    captureMessage: (level, message, tags) => void reports.push({ level, message, tags }),
    flush: async () => true,
  };
  return { lines, logger, reports, reporter };
}

interface Options {
  reading?: boolean;
  dispatcher?: 'inline' | 'recording';
  verifier?: boolean;
  ocr?: OcrClient;
}

function harness(opts: Options = {}) {
  const store = new MemoryLedgerStore();
  const storage = new MemoryAttachmentStorage();
  const clock = { now: new Date('2026-10-28T09:00:00Z') };
  const ocr = opts.ocr ?? new FakeOcr();
  const dispatcher = opts.dispatcher === 'recording' ? new RecordingDispatcher() : new InlineDispatcher();
  const logs = capture();
  const app = createApp({
    store,
    logger: logs.logger,
    reporter: logs.reporter,
    rateLimiter: new SlidingWindowRateLimiter(1_000_000),
    adminToken: ADMIN_TOKEN,
    keyEnvironment: 'test',
    version: '0.1.0-test',
    now: () => clock.now,
    attachments: storage,
    attachmentUrlTtlSeconds: 600,
    receiptUploadLimiter: new SlidingWindowRateLimiter(1_000),
    receiptsLibrary: true,
    jobToken: JOB_TOKEN,
    receiptReading: opts.reading === false ? null : { ocr, dispatcher },
    receiptReadVerifier: opts.verifier === false ? null : googleOidcVerifier({ audience: AUDIENCE, allowedEmails: [READ_SA, SWEEP_SA], client: fakeGoogle }),
    sessions: { pepper: 'session-pepper-with-at-least-32-chars!!', idleMinutes: 120, absoluteHours: 12, secureCookie: true, trustedProxyHops: 1 },
  });
  return { app, store, storage, clock, ocr, dispatcher, logs };
}
type Harness = ReturnType<typeof harness>;

const json = (body: unknown, headers: Record<string, string> = {}, method = 'POST') => ({ method, headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
const idem = () => ({ 'idempotency-key': `key-${++seq}-${Math.random().toString(36).slice(2, 8)}` });
const keyOf = (url: string) => new URL(url).pathname.replace(/^\/+/, '').replace(/^upload\//, '');
const FILE = { filename: 'receipt.jpg', mimeType: 'image/jpeg', sizeBytes: 2048 };
const grant = (h: Harness, userId: string) => h.app.request(`/admin/v1/users/${userId}/features/receipt_reading`, { method: 'PUT', headers: admin });

async function setup(opts: Options & { granted?: boolean } = {}) {
  const h = harness(opts);
  const org = await read(await h.app.request('/admin/v1/organizations', json({ name: `Firm ${++seq}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }, admin)));
  const email = `reader${++seq}@firm.ps`;
  const created = await provisionUser(h.app, { email, displayName: 'Nour Haddad', organizationId: org.id, locale: 'en' });
  if (opts.granted !== false) expect((await grant(h, created.user.id)).status).toBe(200);
  const res = await h.app.request('/v1/sessions', json({ email, password: created.password }, SAME_ORIGIN));
  const token = new RegExp(`${COOKIE}=([^;]*)`).exec(res.headers.get('set-cookie') ?? '')?.[1] ?? '';
  const as = { cookie: `${COOKIE}=${token}`, 'x-mutaba3a-profile': org.id, ...SAME_ORIGIN };
  return { h, orgId: org.id as string, userId: created.user.id as string, as };
}

/** Start and put a library receipt; complete it unless told not to. */
async function upload(h: Harness, as: Record<string, string>, body: object = FILE, complete = true): Promise<Loose> {
  const started = await read(await h.app.request('/v1/receipts/uploads', json(body, { ...as, ...idem() })));
  h.storage.put(keyOf(started.upload.url), { sizeBytes: FILE.sizeBytes, contentType: FILE.mimeType }, new Uint8Array([1, 2, 3]));
  if (!complete) return started.receipt;
  const done = await h.app.request(`/v1/receipts/${started.receipt.id}/complete`, { method: 'POST', headers: as });
  expect(done.status).toBe(200);
  return read(done);
}

const stored = async (h: Harness, orgId: string, id: string) => (await h.store.expenseReceipts.getById(orgId, id))!;
const job = (h: Harness, body: unknown, headers: Record<string, string> = asQueue) =>
  h.app.request(JOB_PATH, body === undefined ? { method: 'POST', headers } : json(body, headers));
const idle = (h: Harness) => (h.dispatcher instanceof InlineDispatcher ? h.dispatcher.idle() : Promise.resolve());

describe('complete asks the server to read (D3, F5, R10 #5)', () => {
  it('flag on, granted uploader, no suggestion: PENDING in the complete, then read in this process (inline)', async () => {
    const { h, orgId, as } = await setup();
    const done = await upload(h, as, { ...FILE, capture: 'scanned' });
    expect(done.reading).toBe('pending');
    const pending = await stored(h, orgId, done.id);
    expect(pending).toMatchObject({ readStatus: 'PENDING', readRequestedAt: h.clock.now });
    await idle(h);
    const after = await stored(h, orgId, done.id);
    expect(after).toMatchObject({ readStatus: 'DONE', readAttempts: 1, readLeaseUntil: null, version: pending.version + 1 });
    expect(after.suggested).toMatchObject({ readerVersion: 'server-ocr-test-1', totalMinor: { value: '1540', source: 'ocr' }, date: { value: '2026-10-28' }, currency: { value: 'ILS' } });
    expect((h.ocr as FakeOcr).calls).toEqual([{ contentType: 'image/jpeg', hint: 'scanned' }]);
    expect((await read(await h.app.request(`/v1/receipts/${done.id}`, { headers: as }))).reading).toBe('done');
  });

  it('flag off: NONE, nothing queued', async () => {
    const { h, orgId, as } = await setup({ reading: false });
    const done = await upload(h, as);
    expect(done.reading).toBeNull();
    expect((await stored(h, orgId, done.id)).readStatus ?? 'NONE').toBe('NONE');
  });

  it('no grant: NONE, nothing queued (the grant backlog picks it up later)', async () => {
    const { h, orgId, as } = await setup({ granted: false, dispatcher: 'recording' });
    const done = await upload(h, as);
    expect((await stored(h, orgId, done.id)).readStatus ?? 'NONE').toBe('NONE');
    expect((h.dispatcher as RecordingDispatcher).asked).toEqual([]);
  });

  it('F5: an uploader who is gone is SKIPPED, never read', async () => {
    const { h, orgId, as } = await setup({ dispatcher: 'recording' });
    const started = await upload(h, as, FILE, false);
    const raw = (h.store as unknown as { expReceipts: Map<string, { uploadedByUserId: string | null }> }).expReceipts.get(started.id)!;
    raw.uploadedByUserId = null;
    await h.app.request(`/v1/receipts/${started.id}/complete`, { method: 'POST', headers: as });
    expect((await stored(h, orgId, started.id)).readStatus).toBe('SKIPPED');
    expect((h.dispatcher as RecordingDispatcher).asked).toEqual([]);
  });

  it('a suggestion that already has every field is SKIPPED', async () => {
    const { h, orgId, as } = await setup({ dispatcher: 'recording' });
    const f = (value: string) => ({ value, source: 'ocr', confidence: 0.9 });
    const full = { readerVersion: 'phone-1', date: f('2026-10-28'), totalMinor: f('100'), currency: f('ILS'), vatMinor: f('15'), vatRateBasisPoints: { value: 1800, source: 'ocr', confidence: 0.9 }, vendorName: f('Cafe'), registrationNo: f(REG_VALID_COMPANY), phone: f('03-1234567'), email: f('a@b.co') };
    const done = await upload(h, as, { ...FILE, suggested: full });
    expect((await stored(h, orgId, done.id)).readStatus).toBe('SKIPPED');
  });

  it('a failed enqueue still answers 200 with the receipt PENDING, and the sweep asks again', async () => {
    const { h, orgId, as } = await setup({ dispatcher: 'recording' });
    const dispatcher = h.dispatcher as RecordingDispatcher;
    dispatcher.fail = true;
    const done = await upload(h, as);
    expect(done.reading).toBe('pending');
    expect(h.logs.lines.some((l) => l.includes('read_enqueue_failed'))).toBe(true);
    dispatcher.fail = false;
    const swept = await job(h, undefined, asScheduler);
    expect(swept.status).toBe(200);
    expect(await read(swept)).toEqual({ status: 'swept', enqueued: 1, failed: 0, enqueueErrors: 0 });
    expect(dispatcher.asked).toEqual([`${done.id}-0`]);
    expect((await job(h, { receiptId: done.id })).status).toBe(200);
    expect((await stored(h, orgId, done.id)).readStatus).toBe('DONE');
  });

  it('a retried complete re-asks for a receipt still waiting, and never for one already read', async () => {
    const { h, orgId, as } = await setup({ dispatcher: 'recording' });
    const dispatcher = h.dispatcher as RecordingDispatcher;
    const done = await upload(h, as);
    expect((await h.app.request(`/v1/receipts/${done.id}/complete`, { method: 'POST', headers: as })).status).toBe(200);
    expect(dispatcher.asked).toEqual([`${done.id}-0`, `${done.id}-0`]);
    await job(h, { receiptId: done.id });
    expect((await stored(h, orgId, done.id)).readStatus).toBe('DONE');
    await h.app.request(`/v1/receipts/${done.id}/complete`, { method: 'POST', headers: as });
    expect(dispatcher.asked).toHaveLength(2);
  });
});

describe('POST /jobs/v1/receipts/read: Google OIDC only (R8)', () => {
  it('refuses a missing token, a wrong audience, an unverified or unknown email, and the shared job token', async () => {
    const { h, as } = await setup({ dispatcher: 'recording' });
    const done = await upload(h, as);
    for (const headers of [{}, bearer(`https://other.test|${READ_SA}|yes`), bearer(`${AUDIENCE}|${READ_SA}|no`), bearer(`${AUDIENCE}|someone@evil.test|yes`), { 'x-job-token': JOB_TOKEN }]) {
      const res = await job(h, { receiptId: done.id }, headers);
      expect(res.status).toBe(401);
      expect((await read(res)).error.code).toBe('JOB_UNAUTHORIZED');
    }
    // The shared token still opens the other jobs.
    expect((await h.app.request('/jobs/v1/oauth/cleanup', { method: 'POST', headers: { 'x-job-token': JOB_TOKEN } })).status).not.toBe(401);
  });

  it('answers 503 JOBS_NOT_CONFIGURED with no verifier, and 200 off with the flag off', async () => {
    const unconfigured = await setup({ verifier: false });
    expect((await job(unconfigured.h, undefined)).status).toBe(503);
    const off = await setup({ reading: false });
    const res = await job(off.h, undefined);
    expect(res.status).toBe(200);
    expect(await read(res)).toEqual({ status: 'off' });
  });

  it('refuses a body that is not {receiptId}', async () => {
    const { h } = await setup({ dispatcher: 'recording' });
    expect((await job(h, { receiptId: 'nope' })).status).toBe(422);
  });
});

describe('the read (claim, lease, end states)', () => {
  it('R10 #10: a retry during a live lease is a 200 no-op; an unknown receipt is none', async () => {
    const { h, as } = await setup({ dispatcher: 'recording' });
    const done = await upload(h, as);
    const claimed = await h.store.expenseReceipts.claimRead(done.id, h.clock.now, READ_LEASE_MS);
    expect(claimed.kind).toBe('claimed');
    const busy = await job(h, { receiptId: done.id });
    expect(busy.status).toBe(200);
    expect(await read(busy)).toEqual({ status: 'busy' });
    expect((h.ocr as FakeOcr).calls).toHaveLength(0);
    expect(await read(await job(h, { receiptId: '00000000-0000-4000-8000-000000000000' }))).toEqual({ status: 'none' });
  });

  it('a deleted receipt is SKIPPED and given nothing', async () => {
    const { h, orgId, as } = await setup({ dispatcher: 'recording' });
    const done = await upload(h, as);
    expect((await h.app.request(`/v1/receipts/${done.id}`, { method: 'DELETE', headers: as })).status).toBe(204);
    expect(await read(await job(h, { receiptId: done.id }))).toEqual({ status: 'skipped' });
    const raw = (h.store as unknown as { expReceipts: Map<string, Loose> }).expReceipts.get(done.id);
    expect(raw).toMatchObject({ readStatus: 'SKIPPED', suggested: null });
    expect((h.ocr as FakeOcr).calls).toHaveLength(0);
    void orgId;
  });

  it('F8: approved while the read was pending, the late read writes nothing', async () => {
    const { h, orgId, as } = await setup({ dispatcher: 'recording' });
    const done = await upload(h, as);
    const approve = await h.app.request(`/v1/receipts/${done.id}/approve`, json({ occurredOn: '2026-10-28', amount: '15.40', currency: 'ILS', vendor: 'Shop' }, { ...as, ...idem() }));
    expect(approve.status).toBe(201);
    const filed = await stored(h, orgId, done.id);
    expect(await read(await job(h, { receiptId: done.id }))).toEqual({ status: 'skipped' });
    const after = await stored(h, orgId, done.id);
    expect(after).toMatchObject({ readStatus: 'SKIPPED', suggested: filed.suggested, version: filed.version });
  });

  it('F8: filed during the OCR call, the read lands on a FILED receipt and writes nothing', async () => {
    const { h, orgId, as } = await setup({ dispatcher: 'recording' });
    const done = await upload(h, as);
    const ocr = h.ocr as FakeOcr;
    ocr.next = async () => {
      await h.app.request(`/v1/receipts/${done.id}/approve`, json({ occurredOn: '2026-10-28', amount: '15.40', currency: 'ILS', vendor: 'Shop' }, { ...as, ...idem() }));
      return { engine: 'test', lines: SUPERMARKET, pages: 1 };
    };
    expect(await read(await job(h, { receiptId: done.id }))).toEqual({ status: 'skipped' });
    expect((await stored(h, orgId, done.id)).suggested).toBeNull();
  });

  it('a person editing during the read: the read merges again onto their suggestion, theirs kept (AC3)', async () => {
    const { h, orgId, as } = await setup({ dispatcher: 'recording' });
    const done = await upload(h, as);
    const ocr = h.ocr as FakeOcr;
    const theirs: ReceiptSuggestion = { readerVersion: 'phone-1', totalMinor: { value: '9999', source: 'ocr', confidence: 0.9 } };
    ocr.next = async () => {
      const r = await stored(h, orgId, done.id);
      await h.store.expenseReceipts.setSuggested(orgId, done.id, r.version, theirs);
      return { engine: 'test', lines: SUPERMARKET, pages: 1 };
    };
    expect(await read(await job(h, { receiptId: done.id }))).toEqual({ status: 'done' });
    const after = await stored(h, orgId, done.id);
    expect(after.suggested?.totalMinor?.value).toBe('9999');
    expect(after.suggested?.date?.value).toBe('2026-10-28');
  });

  it('MUT-254: a registration no. that names a saved vendor fills the vendor name from it', async () => {
    const { h, orgId, as } = await setup({ dispatcher: 'recording' });
    await h.store.vendors.resolve({ organizationId: orgId, name: 'Shufersal Ltd', registrationNo: REG_VALID_COMPANY }, h.clock.now);
    const done = await upload(h, as);
    await job(h, { receiptId: done.id });
    expect((await stored(h, orgId, done.id)).suggested?.vendorName).toEqual({ value: 'Shufersal Ltd', source: 'vendor', confidence: 1 });
  });

  it('OCR unreadable: FAILED with its reason, 200, no retry', async () => {
    const { h, orgId, as } = await setup({ dispatcher: 'recording' });
    const done = await upload(h, as);
    (h.ocr as FakeOcr).next = async () => {
      throw new OcrReadError('unreadable');
    };
    const res = await job(h, { receiptId: done.id });
    expect(res.status).toBe(200);
    expect(await read(res)).toEqual({ status: 'failed' });
    expect(await stored(h, orgId, done.id)).toMatchObject({ readStatus: 'FAILED', readFailReason: 'unreadable', readLeaseUntil: null });
    expect((await read(await h.app.request(`/v1/receipts/${done.id}`, { headers: as }))).reading).toBe('failed');
    expect(await read(await job(h, { receiptId: done.id }))).toEqual({ status: 'none' });
  });

  it('OCR timeout: 503 so Cloud Tasks retries, attempts counted, lease given back; a fourth claim gives up', async () => {
    const { h, orgId, as } = await setup({ dispatcher: 'recording' });
    const done = await upload(h, as);
    (h.ocr as FakeOcr).next = async () => {
      throw new OcrReadError('timeout');
    };
    for (let attempt = 1; attempt <= MAX_READ_ATTEMPTS; attempt += 1) {
      const res = await job(h, { receiptId: done.id });
      expect(res.status).toBe(503);
      expect(await read(res)).toEqual({ status: 'retry' });
      expect(await stored(h, orgId, done.id)).toMatchObject({ readStatus: 'PENDING', readAttempts: attempt, readLeaseUntil: null });
    }
    expect(await read(await job(h, { receiptId: done.id }))).toEqual({ status: 'failed' });
    expect(await stored(h, orgId, done.id)).toMatchObject({ readStatus: 'FAILED', readFailReason: 'exhausted' });
    expect((h.ocr as FakeOcr).calls).toHaveLength(MAX_READ_ATTEMPTS);
  });

  it('the sweep gives up on 3 attempts or 30 minutes, and asks again for the rest by attempt-named task', async () => {
    const { h, orgId, as } = await setup({ dispatcher: 'recording' });
    const tried = await upload(h, as);
    const old = await upload(h, as);
    const fresh = await upload(h, as);
    const raw = (h.store as unknown as { expReceipts: Map<string, Loose> }).expReceipts;
    raw.get(tried.id).readAttempts = MAX_READ_ATTEMPTS;
    raw.get(old.id).readRequestedAt = new Date(h.clock.now.getTime() - READ_GIVE_UP_MS - 1);
    raw.get(fresh.id).readAttempts = 1;
    const dispatcher = h.dispatcher as RecordingDispatcher;
    dispatcher.asked.length = 0;
    expect(await read(await job(h, undefined, asScheduler))).toEqual({ status: 'swept', enqueued: 1, failed: 2, enqueueErrors: 0 });
    expect(dispatcher.asked).toEqual([`${fresh.id}-1`]);
    for (const id of [tried.id, old.id]) expect(await stored(h, orgId, id)).toMatchObject({ readStatus: 'FAILED', readFailReason: 'exhausted' });
    // A receipt under a live lease is left to its reader.
    await h.store.expenseReceipts.claimRead(fresh.id, h.clock.now, READ_LEASE_MS);
    expect(await read(await job(h, undefined, asScheduler))).toMatchObject({ enqueued: 0, failed: 0 });
  });

  it('a read that found nothing new on an incomplete suggestion is DONE, unchanged', async () => {
    const { h, orgId, as } = await setup({ dispatcher: 'recording' });
    const done = await upload(h, as);
    (h.ocr as FakeOcr).next = async () => ({ engine: 'test', lines: [], pages: 1 });
    expect(await read(await job(h, { receiptId: done.id }))).toEqual({ status: 'done' });
    expect(await stored(h, orgId, done.id)).toMatchObject({ readStatus: 'DONE', suggested: null, version: done.version });
  });
});

describe('AC5 / R10 #3: no receipt text reaches a log line or Sentry', () => {
  const sidecar = (body: string, status = 200) => new HttpOcrClient({ baseUrl: 'http://localhost:8790', fetch: async () => new Response(body, { status, headers: { 'content-type': 'application/json' } }) });
  const leak = `{"engine":"x","lines":[{"text":"${SECRET_WORDS[0]} ${SECRET_WORDS[1]}","conf":2,"box":[0,0,1,1]}],"pages":1}`;

  for (const [name, body] of [
    ['malformed (a field out of range)', leak],
    ['truncated', leak.slice(0, 60)],
    ['not JSON at all', `<html>${SECRET_WORDS[0]}</html>`],
  ] as const) {
    it(`a ${name} sidecar body: retry, and nothing it said is logged or reported`, async () => {
      const { h, orgId, as } = await setup({ dispatcher: 'recording', ocr: sidecar(body) });
      const done = await upload(h, as);
      const res = await job(h, { receiptId: done.id });
      expect(res.status).toBe(503);
      expect(await stored(h, orgId, done.id)).toMatchObject({ readStatus: 'PENDING', readAttempts: 1 });
      const seen = JSON.stringify([h.logs.lines, h.logs.reports]);
      for (const word of SECRET_WORDS) expect(seen).not.toContain(word);
      expect(h.logs.lines.some((l) => l.includes('"code":"malformed"'))).toBe(true);
    });
  }

  it('a successful read logs counts only', async () => {
    const { h, as } = await setup({ dispatcher: 'recording' });
    const done = await upload(h, as);
    await job(h, { receiptId: done.id });
    const seen = JSON.stringify([h.logs.lines, h.logs.reports]);
    for (const word of [...SECRET_WORDS, '15.40', REG_VALID_COMPANY]) expect(seen).not.toContain(word);
    expect(h.logs.lines.some((l) => l.includes('"status":"done"') && l.includes('"lines":8'))).toBe(true);
  });
});

describe('R5: granting receipt_reading queues the person\'s unread To-review receipts once', () => {
  it('marks them PENDING and asks for each; granting again changes nothing', async () => {
    const { h, orgId, userId, as } = await setup({ granted: false, dispatcher: 'recording' });
    const waiting = await upload(h, as);
    const second = await upload(h, as);
    const filed = await upload(h, as);
    await h.app.request(`/v1/receipts/${filed.id}/approve`, json({ occurredOn: '2026-10-28', amount: '1.00', currency: 'ILS', vendor: 'X' }, { ...as, ...idem() }));
    const dispatcher = h.dispatcher as RecordingDispatcher;
    expect((await grant(h, userId)).status).toBe(200);
    expect([...dispatcher.asked].sort()).toEqual([`${waiting.id}-0`, `${second.id}-0`].sort());
    for (const id of [waiting.id, second.id]) expect((await stored(h, orgId, id)).readStatus).toBe('PENDING');
    expect((await stored(h, orgId, filed.id)).readStatus ?? 'NONE').toBe('NONE');
    expect((await grant(h, userId)).status).toBe(200);
    expect(dispatcher.asked).toHaveLength(2);
  });

  it('with the flag off, a grant queues nothing', async () => {
    const { h, orgId, userId, as } = await setup({ granted: false, reading: false });
    const waiting = await upload(h, as);
    expect((await grant(h, userId)).status).toBe(200);
    expect((await stored(h, orgId, waiting.id)).readStatus ?? 'NONE').toBe('NONE');
  });
});
