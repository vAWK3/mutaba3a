import { Storage } from '@google-cloud/storage';
import { contentDisposition } from './rules.js';

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

export interface StoredObject {
  sizeBytes: number;
  contentType: string | null;
}

export interface AttachmentStorage {
  signUpload(key: string, input: { mimeType: string; sizeBytes: number; ttlSeconds: number; now: Date }): Promise<SignedUrl & { headers: Record<string, string> }>;
  signDownload(key: string, input: { filename: string; mimeType: string; ttlSeconds: number; now: Date }): Promise<SignedUrl>;
  head(key: string): Promise<StoredObject | null>;
  remove(key: string): Promise<void>;
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

  async signDownload(key: string, input: { filename: string; mimeType: string; ttlSeconds: number; now: Date }) {
    const expiresAt = new Date(input.now.getTime() + input.ttlSeconds * 1000);
    const [url] = await this.storage
      .bucket(this.bucket)
      .file(key)
      .getSignedUrl({ version: 'v4', action: 'read', expires: expiresAt, responseDisposition: contentDisposition(input.filename), responseType: input.mimeType });
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
}

/** Test double: objects appear when a test calls `put`; URLs are deterministic strings. */
export class MemoryAttachmentStorage implements AttachmentStorage {
  readonly objects = new Map<string, StoredObject>();
  readonly removed: string[] = [];

  put(key: string, object: StoredObject): void {
    this.objects.set(key, object);
  }

  async signUpload(key: string, input: { mimeType: string; sizeBytes: number; ttlSeconds: number; now: Date }) {
    const expiresAt = new Date(input.now.getTime() + input.ttlSeconds * 1000);
    return { url: `memory://upload/${key}?expires=${expiresAt.getTime()}`, expiresAt, headers: { 'Content-Type': input.mimeType, 'x-goog-content-length-range': `0,${input.sizeBytes}` } };
  }

  async signDownload(key: string, input: { filename: string; mimeType: string; ttlSeconds: number; now: Date }) {
    const expiresAt = new Date(input.now.getTime() + input.ttlSeconds * 1000);
    return { url: `memory://download/${key}?expires=${expiresAt.getTime()}&name=${encodeURIComponent(input.filename)}`, expiresAt };
  }

  async head(key: string): Promise<StoredObject | null> {
    return this.objects.get(key) ?? null;
  }

  async remove(key: string): Promise<void> {
    this.objects.delete(key);
    this.removed.push(key);
  }
}
