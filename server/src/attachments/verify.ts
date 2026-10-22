import { validationError } from '../agreements/compose.js';
import type { AttachmentStorage } from './storage.js';

/**
 * Before a signed-URL upload turns READY (M6 brief §4): the object must exist and match what was declared.
 * 422 UPLOAD_INCOMPLETE when nothing was uploaded yet; 422 UPLOAD_MISMATCH when its size or type differ.
 * Shared by an expense's receipts (MUT-42) and the receipts library (MUT-255).
 */
export async function verifyUploadedObject(storage: AttachmentStorage, declared: { storageKey: string; sizeBytes: number; mimeType: string }): Promise<void> {
  const object = await storage.head(declared.storageKey);
  if (!object) throw validationError('UPLOAD_INCOMPLETE', 'No object has been uploaded for this receipt yet');
  if (object.sizeBytes !== declared.sizeBytes || (object.contentType && object.contentType !== declared.mimeType)) {
    throw validationError('UPLOAD_MISMATCH', 'The uploaded object does not match the declared size or type', { declared: { sizeBytes: declared.sizeBytes, mimeType: declared.mimeType }, uploaded: object });
  }
}
