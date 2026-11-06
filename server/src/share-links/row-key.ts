import { createCipheriv, createDecipheriv, createHmac } from 'node:crypto';

/**
 * MUT-560 review (ADR-246): the key a visitor sees for an entry instead of its id. One AES block over the entry's
 * 16-byte UUID, keyed per link from the session pepper: stable for a link, different on every other link, never
 * UUID-shaped, and reversible only by the server (the receipts route turns it back into the expense it names).
 */
const KEY_RE = /^[A-Za-z0-9_-]{22}$/;

function cipherKey(pepper: string, linkId: string): Buffer {
  return createHmac('sha256', pepper).update(`share-row:${linkId}`).digest().subarray(0, 16);
}

export function shareRowKey(pepper: string, linkId: string, id: string): string {
  const cipher = createCipheriv('aes-128-ecb', cipherKey(pepper, linkId), null).setAutoPadding(false);
  return Buffer.concat([cipher.update(Buffer.from(id.replace(/-/g, ''), 'hex')), cipher.final()]).toString('base64url');
}

/** The entry id a key names on this link, or null for anything that isn't one of its keys' shape. */
export function shareRowId(pepper: string, linkId: string, key: string): string | null {
  if (!KEY_RE.test(key)) return null;
  const block = Buffer.from(key, 'base64url');
  if (block.length !== 16) return null;
  const decipher = createDecipheriv('aes-128-ecb', cipherKey(pepper, linkId), null).setAutoPadding(false);
  const hex = Buffer.concat([decipher.update(block), decipher.final()]).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
