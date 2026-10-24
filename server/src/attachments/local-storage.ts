import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { contentDisposition } from './rules.js';
import type { AttachmentStorage, SignedUrl, StoredObject } from './storage.js';

/**
 * MUT-396: attachment bytes on local disk, for the dev server and local QA only (ATTACHMENTS_DRIVER=local; config
 * refuses it in production and staging). It stands in for GCS end to end: signed URLs point back at this server
 * (`/dev/attachments/:token`, routes/dev-attachments.ts) and carry an HMAC token that does what a V4 signature does
 * — key, action, expiry, and for uploads the content type and the size cap.
 *
 * URLs are built from the incoming request's origin, so whoever asked (the phone on localhost:8787, the portal
 * through vite's /dev proxy) gets a same-origin URL that PORTAL_CSP's `connect-src 'self'` allows. Expiry is judged
 * on the caller's clock (the app's injected `now`), never Date.now(), exactly as signing is.
 *
 * No metadata sidecar: `head` reports `contentType: null` (verifyUploadedObject then skips the type check) because
 * the type was already enforced when the bytes came in, and a download answers with the type its token names.
 */
export class LocalStorageError extends Error {
  constructor(
    readonly status: 403 | 404 | 413,
    message: string,
  ) {
    super(message);
    this.name = 'LocalStorageError';
  }
}

interface PutClaims {
  a: 'put';
  k: string;
  e: number;
  m: string;
  n: number;
}
interface GetClaims {
  a: 'get';
  k: string;
  e: number;
  m: string;
  f: string;
}
type Claims = PutClaims | GetClaims;

export interface LocalAttachmentStorageOptions {
  /** Where the bytes live. Uploads are staged in `<dir>/.tmp` so the final rename never crosses filesystems. */
  dir: string;
  secret: string;
  /** The origin signed URLs point at: the incoming request's (index.ts reads it from Hono's context storage). */
  origin: () => string;
}

export const LOCAL_ATTACHMENTS_PATH = '/dev/attachments';
const TMP = '.tmp';

export class LocalAttachmentStorage implements AttachmentStorage {
  private readonly dir: string;

  constructor(private readonly options: LocalAttachmentStorageOptions) {
    this.dir = resolve(options.dir);
  }

  async signUpload(key: string, input: { mimeType: string; sizeBytes: number; ttlSeconds: number; now: Date }) {
    this.pathOf(key);
    const expiresAt = new Date(input.now.getTime() + input.ttlSeconds * 1000);
    const url = this.url({ a: 'put', k: key, e: expiresAt.getTime(), m: input.mimeType, n: input.sizeBytes });
    return { url, expiresAt, headers: { 'Content-Type': input.mimeType, 'x-goog-content-length-range': `0,${input.sizeBytes}` } };
  }

  async signDownload(key: string, input: { filename: string; mimeType: string; ttlSeconds: number; now: Date }): Promise<SignedUrl> {
    this.pathOf(key);
    const expiresAt = new Date(input.now.getTime() + input.ttlSeconds * 1000);
    return { url: this.url({ a: 'get', k: key, e: expiresAt.getTime(), m: input.mimeType, f: input.filename }), expiresAt };
  }

  async head(key: string): Promise<StoredObject | null> {
    const info = await stat(this.pathOf(key)).catch(() => null);
    return info?.isFile() ? { sizeBytes: info.size, contentType: null } : null;
  }

  async remove(key: string): Promise<void> {
    await rm(this.pathOf(key), { force: true });
  }

  async read(key: string): Promise<ReadableStream<Uint8Array> | null> {
    const path = this.pathOf(key);
    if (!(await this.head(key))) return null;
    return Readable.toWeb(createReadStream(path)) as ReadableStream<Uint8Array>;
  }

  /** PUT /dev/attachments/:token. Mirrors a GCS V4 signed PUT: wrong token 403, wrong type 403, over the cap 413. */
  async acceptUpload(token: string, request: { contentType: string | null; contentLength: number | null; body: ReadableStream<Uint8Array> | null }, now: Date): Promise<void> {
    const claims = this.verify(token, 'put', now);
    if (request.contentType !== claims.m) throw new LocalStorageError(403, `Content-Type must be ${claims.m}`);
    if (request.contentLength !== null && request.contentLength > claims.n) throw new LocalStorageError(413, `The body is larger than the ${claims.n} bytes signed for`);
    const target = this.pathOf(claims.k);
    const tmpDir = join(this.dir, TMP);
    await mkdir(tmpDir, { recursive: true });
    const tmp = join(tmpDir, randomUUID());
    let seen = 0;
    const cap = new Transform({
      transform(chunk: Buffer, _encoding, done) {
        seen += chunk.length;
        if (seen > claims.n) done(new LocalStorageError(413, `The body is larger than the ${claims.n} bytes signed for`));
        else done(null, chunk);
      },
    });
    try {
      const source = request.body ? Readable.fromWeb(request.body as import('node:stream/web').ReadableStream) : Readable.from([]);
      await pipeline(source, cap, createWriteStream(tmp));
      await mkdir(dirname(target), { recursive: true });
      await rename(tmp, target);
    } catch (error) {
      await rm(tmp, { force: true });
      throw error;
    }
  }

  /** GET /dev/attachments/:token: the stored bytes, the token's type and the download filename. */
  async openDownload(token: string, now: Date): Promise<{ body: ReadableStream<Uint8Array>; mimeType: string; contentDisposition: string; sizeBytes: number }> {
    const claims = this.verify(token, 'get', now);
    const object = await this.head(claims.k);
    const body = object ? await this.read(claims.k) : null;
    if (!object || !body) throw new LocalStorageError(404, 'No such object');
    return { body, mimeType: claims.m, contentDisposition: contentDisposition(claims.f), sizeBytes: object.sizeBytes };
  }

  private url(claims: Claims): string {
    const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
    return `${this.options.origin()}${LOCAL_ATTACHMENTS_PATH}/${payload}.${this.sign(payload)}`;
  }

  private sign(payload: string): string {
    return createHmac('sha256', this.options.secret).update(payload).digest('base64url');
  }

  private verify<A extends Claims['a']>(token: string, action: A, now: Date): Extract<Claims, { a: A }> {
    const [payload, signature, extra] = token.split('.');
    const refuse = (why: string): never => {
      throw new LocalStorageError(403, why);
    };
    if (!payload || !signature || extra !== undefined) refuse('Malformed signed URL');
    const expected = Buffer.from(this.sign(payload!));
    const given = Buffer.from(signature!);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) refuse('Signature does not match');
    let claims: Claims;
    try {
      claims = JSON.parse(Buffer.from(payload!, 'base64url').toString('utf8')) as Claims;
    } catch {
      return refuse('Malformed signed URL');
    }
    if (claims.a !== action) refuse(`This URL is not for ${action === 'put' ? 'uploading' : 'downloading'}`);
    if (typeof claims.e !== 'number' || now.getTime() > claims.e) refuse('The signed URL has expired');
    return claims as Extract<Claims, { a: A }>;
  }

  /** The file for a storage key; a key that is empty, absolute or would leave the folder is refused. */
  private pathOf(key: string): string {
    const segments = key.split('/');
    if (!key || isAbsolute(key) || segments.some((s) => s === '' || s === '.' || s === '..' || s === TMP)) {
      throw new LocalStorageError(403, 'Invalid storage key');
    }
    const path = resolve(this.dir, ...segments);
    const rel = relative(this.dir, path);
    if (rel.startsWith('..') || isAbsolute(rel) || rel.split(sep)[0] === TMP) throw new LocalStorageError(403, 'Invalid storage key');
    return path;
  }
}
