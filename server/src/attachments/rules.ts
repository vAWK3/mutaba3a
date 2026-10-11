/**
 * Attachment rules (M6 brief §2, §4): what may be uploaded and how it is named
 * in storage. Pure.
 */
export const ATTACHMENT_KINDS = ['INVOICE', 'RECEIPT', 'OTHER'] as const;
export type AttachmentKind = (typeof ATTACHMENT_KINDS)[number];

export const ATTACHMENT_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png'] as const;
export type AttachmentMimeType = (typeof ATTACHMENT_MIME_TYPES)[number];

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const ATTACHMENT_STATUSES = ['PENDING_UPLOAD', 'READY'] as const;
export type AttachmentStatus = (typeof ATTACHMENT_STATUSES)[number];

export type AttachmentTarget = { customerId: string } | { projectId: string } | { paymentId: string };

export type AttachmentRuleReason = 'MIME_TYPE_UNSUPPORTED' | 'FILE_TOO_LARGE' | 'ATTACHMENT_TARGET_REQUIRED' | 'ATTACHMENT_TARGET_AMBIGUOUS' | 'FILENAME_INVALID';

export type FileRuleReason = 'MIME_TYPE_UNSUPPORTED' | 'FILE_TOO_LARGE' | 'FILENAME_INVALID';

/** The file itself: type, size and a filename that can't name a path. Shared by attachments and expense receipts (MUT-42). */
export function checkFile(input: { mimeType: string; sizeBytes: number; filename: string }): { ok: true } | { ok: false; reason: FileRuleReason } {
  if (!(ATTACHMENT_MIME_TYPES as readonly string[]).includes(input.mimeType)) return { ok: false, reason: 'MIME_TYPE_UNSUPPORTED' };
  if (!Number.isInteger(input.sizeBytes) || input.sizeBytes <= 0 || input.sizeBytes > MAX_ATTACHMENT_BYTES) return { ok: false, reason: 'FILE_TOO_LARGE' };
  if (input.filename.trim() === '' || input.filename.length > 200 || /[\\/]/.test(input.filename) || Array.from(input.filename).some((ch) => ch.charCodeAt(0) < 0x20)) return { ok: false, reason: 'FILENAME_INVALID' };
  return { ok: true };
}

export function checkUpload(input: { mimeType: string; sizeBytes: number; filename: string; customerId?: string | undefined; projectId?: string | undefined; paymentId?: string | undefined }): { ok: true; target: AttachmentTarget } | { ok: false; reason: AttachmentRuleReason } {
  const file = checkFile(input);
  if (!file.ok) return file;
  const targets = [input.customerId ? { customerId: input.customerId } : null, input.projectId ? { projectId: input.projectId } : null, input.paymentId ? { paymentId: input.paymentId } : null].filter((t): t is AttachmentTarget => t !== null);
  if (targets.length === 0) return { ok: false, reason: 'ATTACHMENT_TARGET_REQUIRED' };
  if (targets.length > 1) return { ok: false, reason: 'ATTACHMENT_TARGET_AMBIGUOUS' };
  return { ok: true, target: targets[0]! };
}

/** Object key: organization and attachment ids only — never the filename, never user input. */
export function storageKey(organizationId: string, attachmentId: string): string {
  return `org/${organizationId}/${attachmentId}`;
}

/** An expense receipt's object key (MUT-42): same bucket, its own prefix, ids only. */
export function receiptStorageKey(organizationId: string, receiptId: string): string {
  return `org/${organizationId}/expense-receipts/${receiptId}`;
}

/** `Content-Disposition` for downloads: ASCII fallback + RFC 5987 UTF-8 filename. */
export function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
