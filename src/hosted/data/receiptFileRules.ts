/**
 * What a receipt file may be (MUT-260 D9, A5), checked before any request: the server's own rules
 * (server/src/attachments/rules.ts checkFile), shared by the expense drawer's ReceiptUploader and the Receipts tab.
 */
export const RECEIPT_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png'] as const;
export type ReceiptMimeType = (typeof RECEIPT_MIME_TYPES)[number];
export const MAX_RECEIPT_BYTES = 10 * 1024 * 1024;
export const MAX_RECEIPT_FILENAME = 200;

export type ReceiptFileProblem = 'invalidType' | 'tooLarge' | 'badName';

const CONTROL_CHAR = 0x20;

export function isReceiptMimeType(type: string): type is ReceiptMimeType {
  return (RECEIPT_MIME_TYPES as readonly string[]).includes(type);
}

/** The first thing wrong with a file, or null: type, then size (empty counts), then a name the server would refuse. */
export function checkReceiptFile(file: { type: string; size: number; name: string }): ReceiptFileProblem | null {
  if (!isReceiptMimeType(file.type)) return 'invalidType';
  if (file.size <= 0 || file.size > MAX_RECEIPT_BYTES) return 'tooLarge';
  const name = file.name;
  if (name.trim() === '' || name.length > MAX_RECEIPT_FILENAME || /[\\/]/.test(name) || Array.from(name).some((ch) => ch.charCodeAt(0) < CONTROL_CHAR)) return 'badName';
  return null;
}
