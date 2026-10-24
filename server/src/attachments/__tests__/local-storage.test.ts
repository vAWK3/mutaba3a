import { mkdtempSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LocalAttachmentStorage, LocalStorageError } from '../local-storage.js';

/** MUT-396: the dev-only local-disk storage behind ATTACHMENTS_DRIVER=local. */
const ORIGIN = 'http://localhost:8787';
const NOW = new Date('2026-10-22T21:30:00Z');
const SECRET = 'local-attachments-test-secret-0123456789';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mut396-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const storage = () => new LocalAttachmentStorage({ dir, secret: SECRET, origin: () => ORIGIN });
const tokenOf = (url: string) => new URL(url).pathname.split('/').pop()!;
const body = (bytes: Uint8Array) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
const bytesOf = async (stream: ReadableStream<Uint8Array> | null) => new Uint8Array(await new Response(stream).arrayBuffer());
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4, 5]);
const KEY = 'org/o1/expense-receipts/r1';

async function signPut(s: LocalAttachmentStorage, sizeBytes = PNG.length, key = KEY, mimeType = 'image/png') {
  const signed = await s.signUpload(key, { mimeType, sizeBytes, ttlSeconds: 900, now: NOW });
  return { signed, token: tokenOf(signed.url) };
}

describe('LocalAttachmentStorage', () => {
  it('round-trips: sign, accept the upload, head, read the same bytes', async () => {
    const s = storage();
    const { signed, token } = await signPut(s);
    expect(signed.url.startsWith(`${ORIGIN}/dev/attachments/`)).toBe(true);
    expect(signed.headers).toEqual({ 'Content-Type': 'image/png', 'x-goog-content-length-range': `0,${PNG.length}` });
    await s.acceptUpload(token, { contentType: 'image/png', contentLength: PNG.length, body: body(PNG) }, NOW);
    expect(await s.head(KEY)).toEqual({ sizeBytes: PNG.length, contentType: null });
    expect(await bytesOf(await s.read(KEY))).toEqual(PNG);
  });

  it('signs downloads that open the stored bytes with the filename and type', async () => {
    const s = storage();
    const { token } = await signPut(s);
    await s.acceptUpload(token, { contentType: 'image/png', contentLength: PNG.length, body: body(PNG) }, NOW);
    const download = await s.signDownload(KEY, { filename: 'فاتورة.png', mimeType: 'image/png', ttlSeconds: 900, now: NOW });
    const opened = await s.openDownload(tokenOf(download.url), NOW);
    expect(opened.mimeType).toBe('image/png');
    expect(opened.contentDisposition).toContain("filename*=UTF-8''");
    expect(await bytesOf(opened.body)).toEqual(PNG);
  });

  it('judges expiry on the injected clock', async () => {
    const s = storage();
    const { token } = await signPut(s);
    const justBefore = new Date(NOW.getTime() + 900_000 - 1_000);
    const after = new Date(NOW.getTime() + 900_000 + 1);
    await expect(s.acceptUpload(token, { contentType: 'image/png', contentLength: PNG.length, body: body(PNG) }, after)).rejects.toMatchObject({ status: 403 });
    await expect(s.acceptUpload(token, { contentType: 'image/png', contentLength: PNG.length, body: body(PNG) }, justBefore)).resolves.toBeUndefined();
  });

  it('refuses a tampered payload or signature', async () => {
    const s = storage();
    const { token } = await signPut(s);
    const [payload, sig] = token.split('.');
    const forgedPayload = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload!, 'base64url').toString()), n: 10_000_000 })).toString('base64url');
    const flipped = sig!.slice(0, -1) + (sig!.endsWith('A') ? 'B' : 'A');
    for (const bad of [`${forgedPayload}.${sig}`, `${payload}.${flipped}`, 'not-a-token', `${payload}`]) {
      await expect(s.acceptUpload(bad, { contentType: 'image/png', contentLength: PNG.length, body: body(PNG) }, NOW)).rejects.toMatchObject({ status: 403 });
    }
  });

  it('a token signed with another secret is refused', async () => {
    const other = new LocalAttachmentStorage({ dir, secret: 'another-secret-another-secret-0123456789', origin: () => ORIGIN });
    const { token } = await signPut(other);
    await expect(storage().acceptUpload(token, { contentType: 'image/png', contentLength: PNG.length, body: body(PNG) }, NOW)).rejects.toMatchObject({ status: 403 });
  });

  it('a download token cannot upload and an upload token cannot download', async () => {
    const s = storage();
    const { token } = await signPut(s);
    const download = await s.signDownload(KEY, { filename: 'a.png', mimeType: 'image/png', ttlSeconds: 900, now: NOW });
    await expect(s.acceptUpload(tokenOf(download.url), { contentType: 'image/png', contentLength: PNG.length, body: body(PNG) }, NOW)).rejects.toMatchObject({ status: 403 });
    await expect(s.openDownload(token, NOW)).rejects.toMatchObject({ status: 403 });
  });

  it('refuses a Content-Type other than the signed one', async () => {
    const s = storage();
    const { token } = await signPut(s);
    await expect(s.acceptUpload(token, { contentType: 'image/jpeg', contentLength: PNG.length, body: body(PNG) }, NOW)).rejects.toMatchObject({ status: 403 });
  });

  it('refuses a declared Content-Length over the signed size before writing', async () => {
    const s = storage();
    const { token } = await signPut(s, 4);
    await expect(s.acceptUpload(token, { contentType: 'image/png', contentLength: PNG.length, body: body(PNG) }, NOW)).rejects.toMatchObject({ status: 413 });
    expect(await s.head(KEY)).toBeNull();
  });

  it('stops a body that streams past the signed size and leaves no file behind', async () => {
    const s = storage();
    const { token } = await signPut(s, 4);
    await expect(s.acceptUpload(token, { contentType: 'image/png', contentLength: null, body: body(PNG) }, NOW)).rejects.toMatchObject({ status: 413 });
    expect(await s.head(KEY)).toBeNull();
    expect(readdirSync(join(dir, '.tmp'))).toEqual([]);
  });

  it('an aborted upload leaves no file behind', async () => {
    const s = storage();
    const { token } = await signPut(s);
    const failing = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(PNG.slice(0, 3));
        controller.error(new Error('client went away'));
      },
    });
    await expect(s.acceptUpload(token, { contentType: 'image/png', contentLength: PNG.length, body: failing }, NOW)).rejects.toThrow();
    expect(await s.head(KEY)).toBeNull();
    expect(readdirSync(join(dir, '.tmp'))).toEqual([]);
  });

  it('two concurrent uploads to one key leave one complete file', async () => {
    const s = storage();
    const { token } = await signPut(s);
    await Promise.all([1, 2].map(() => s.acceptUpload(token, { contentType: 'image/png', contentLength: PNG.length, body: body(PNG) }, NOW)));
    expect(await bytesOf(await s.read(KEY))).toEqual(PNG);
    expect(readdirSync(join(dir, '.tmp'))).toEqual([]);
  });

  it('refuses keys that escape the folder', async () => {
    const s = storage();
    for (const key of ['../outside', '/etc/passwd', 'org/../../x', 'org/./x', '', 'org//x']) {
      await expect(s.head(key)).rejects.toBeInstanceOf(LocalStorageError);
    }
    expect(existsSync(join(dir, '..', 'outside'))).toBe(false);
  });

  it('remove is idempotent and head then reports nothing', async () => {
    const s = storage();
    await expect(s.remove(KEY)).resolves.toBeUndefined();
    const { token } = await signPut(s);
    await s.acceptUpload(token, { contentType: 'image/png', contentLength: PNG.length, body: body(PNG) }, NOW);
    await s.remove(KEY);
    expect(await s.head(KEY)).toBeNull();
    expect(await s.read(KEY)).toBeNull();
  });

  it('a download of a missing object is a 404', async () => {
    const s = storage();
    const download = await s.signDownload('org/o1/expense-receipts/missing', { filename: 'a.png', mimeType: 'image/png', ttlSeconds: 900, now: NOW });
    await expect(s.openDownload(tokenOf(download.url), NOW)).rejects.toMatchObject({ status: 404 });
  });
});
