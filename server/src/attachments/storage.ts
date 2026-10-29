import { Readable } from 'node:stream';
import { Storage } from '@google-cloud/storage';
import { contentDisposition, type DownloadDisposition } from './rules.js';

/**
 * Where attachment bytes live (M6 brief §4). The API never streams files: it
 * hands out short-lived signed URLs for upload and download and checks the
 * object after the upload. Two implementations: GCS (production, V4 signed
 * URLs through the service account's IAM signBlob — no key file) and memory
 * (tests, where "uploading" is a method call).
 */
export interface SignedUrl {
  url: string;
  expiresAt: Date;
}

/** MUT-260 (A12): what signDownload takes. `disposition` absent means attachment, as before. */
export interface SignDownloadInput {
  filename: string;
  mimeType: string;
  ttlSeconds: number;
  now: Date;
  disposition?: DownloadDisposition;
}

export interface StoredObject {
  sizeBytes: number;
  contentType: string | null;
}

export interface AttachmentStorage {
  signUpload(key: string, input: { mimeType: string; sizeBytes: number; ttlSeconds: number; now: Date }): Promise<SignedUrl & { headers: Record<string, string> }>;
  signDownload(key: string, input: SignDownloadInput): Promise<SignedUrl>;
  head(key: string): Promise<StoredObject | null>;
  remove(key: string): Promise<void>;
  /**
   * MUT-325: the object's bytes as a stream, null when it isn't there. The one place the API passes bytes on:
   * "Download my records" pipes each file into the person's records file (brief §3: the bucket has no CORS, so the
   * portal can't fetch a signed URL itself). Streamed, never buffered.
   */
  read(key: string): Promise<ReadableStream<Uint8Array> | null>;
  /**
   * MUT-333 (R1): deletes every object under `<prefix>/` (a deleted profile's `org/<id>`, profileStoragePrefix). Safe
   * to repeat: nothing there is not an error.
   */
  removePrefix(prefix: string): Promise<void>;
  /**
   * MUT-503: copies an object to a new key inside the bucket, never through this process (GCS rewrites it in place,
   * under the bucket's default CMEK key, ADR-164). Overwrites `to`; throws when `from` is not there.
   */
  copy(from: string, to: string): Promise<void>;
}

export class GcsAttachmentStorage implements AttachmentStorage {
  private readonly storage: Storage;

  constructor(
    private readonly bucket: string,
    storage: Storage = new Storage(),
  ) {
    this.storage = storage;
  }

  async signUpload(key: string, input: { mimeType: string; sizeBytes: number; ttlSeconds: number; now: Date }) {
    const expiresAt = new Date(input.now.getTime() + input.ttlSeconds * 1000);
    const [url] = await this.storage
      .bucket(this.bucket)
      .file(key)
      .getSignedUrl({ version: 'v4', action: 'write', expires: expiresAt, contentType: input.mimeType, extensionHeaders: { 'x-goog-content-length-range': `0,${input.sizeBytes}` } });
    return { url, expiresAt, headers: { 'Content-Type': input.mimeType, 'x-goog-content-length-range': `0,${input.sizeBytes}` } };
  }

  async signDownload(key: string, input: SignDownloadInput) {
    const expiresAt = new Date(input.now.getTime() + input.ttlSeconds * 1000);
    const [url] = await this.storage
      .bucket(this.bucket)
      .file(key)
      .getSignedUrl({ version: 'v4', action: 'read', expires: expiresAt, responseDisposition: contentDisposition(input.filename, input.disposition), responseType: input.mimeType });
    return { url, expiresAt };
  }

  async head(key: string): Promise<StoredObject | null> {
    const file = this.storage.bucket(this.bucket).file(key);
    const [exists] = await file.exists();
    if (!exists) return null;
    const [metadata] = await file.getMetadata();
    return { sizeBytes: Number(metadata.size ?? 0), contentType: metadata.contentType ?? null };
  }

  async remove(key: string): Promise<void> {
    await this.storage.bucket(this.bucket).file(key).delete({ ignoreNotFound: true });
  }

  async removePrefix(prefix: string): Promise<void> {
    await this.storage.bucket(this.bucket).deleteFiles({ prefix: `${prefix}/`, force: true });
  }

  async copy(from: string, to: string): Promise<void> {
    const bucket = this.storage.bucket(this.bucket);
    await bucket.file(from).copy(bucket.file(to));
  }

  async read(key: string): Promise<ReadableStream<Uint8Array> | null> {
    const file = this.storage.bucket(this.bucket).file(key);
    const [exists] = await file.exists();
    if (!exists) return null;
    return Readable.toWeb(file.createReadStream()) as ReadableStream<Uint8Array>;
  }
}

/** Test double: objects appear when a test calls `put`; URLs are deterministic strings. */
export class MemoryAttachmentStorage implements AttachmentStorage {
  readonly objects = new Map<string, StoredObject>();
  readonly removed: string[] = [];
  /** MUT-325: the bytes behind an object, for the tests that read them back. An object put without bytes reads as empty. */
  readonly contents = new Map<string, Uint8Array>();

  put(key: string, object: StoredObject, bytes?: Uint8Array): void {
    this.objects.set(key, object);
    if (bytes) this.contents.set(key, bytes);
  }

  async signUpload(key: string, input: { mimeType: string; sizeBytes: number; ttlSeconds: number; now: Date }) {
    const expiresAt = new Date(input.now.getTime() + input.ttlSeconds * 1000);
    return { url: `memory://upload/${key}?expires=${expiresAt.getTime()}`, expiresAt, headers: { 'Content-Type': input.mimeType, 'x-goog-content-length-range': `0,${input.sizeBytes}` } };
  }

  async signDownload(key: string, input: SignDownloadInput) {
    const expiresAt = new Date(input.now.getTime() + input.ttlSeconds * 1000);
    return { url: `memory://download/${key}?expires=${expiresAt.getTime()}&name=${encodeURIComponent(input.filename)}${input.disposition === 'inline' ? '&disposition=inline' : ''}`, expiresAt };
  }

  async head(key: string): Promise<StoredObject | null> {
    return this.objects.get(key) ?? null;
  }

  async remove(key: string): Promise<void> {
    this.objects.delete(key);
    this.contents.delete(key);
    this.removed.push(key);
  }

  async removePrefix(prefix: string): Promise<void> {
    for (const key of [...this.objects.keys()]) if (key.startsWith(`${prefix}/`)) await this.remove(key);
  }

  async copy(from: string, to: string): Promise<void> {
    const object = this.objects.get(from);
    if (!object) throw new Error(`No object at ${from}`);
    this.objects.set(to, { ...object });
    const bytes = this.contents.get(from);
    if (bytes) this.contents.set(to, bytes.slice());
  }

  async read(key: string): Promise<ReadableStream<Uint8Array> | null> {
    if (!this.objects.has(key)) return null;
    const bytes = this.contents.get(key) ?? new Uint8Array();
    return new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    });
  }
}
