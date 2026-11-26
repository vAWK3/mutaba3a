import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

/**
 * MUT-571 (ADR-264): the Tax Authority's tokens, sealed before they reach the database (AES-256-GCM, a fresh 12-byte
 * nonce each time). The key is TAX_AUTHORITY_TOKEN_KEY, or, outside production and staging, one derived from the
 * session pepper. A sealed value is `v1.<nonce>.<ciphertext+tag>` in base64url; anything else opens to null.
 */
export class TokenBox {
  private readonly key: Buffer;

  constructor(secret: string, context = 'mutaba3a/tax-authority-tokens/v1') {
    this.key = Buffer.from(hkdfSync('sha256', Buffer.from(secret, 'utf8'), Buffer.alloc(0), context, 32));
  }

  seal(plain: string): string {
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, nonce);
    const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final(), cipher.getAuthTag()]);
    return `v1.${nonce.toString('base64url')}.${body.toString('base64url')}`;
  }

  open(sealed: string): string | null {
    const [version, nonce, body] = sealed.split('.');
    if (version !== 'v1' || !nonce || !body) return null;
    try {
      const raw = Buffer.from(body, 'base64url');
      const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(nonce, 'base64url'));
      decipher.setAuthTag(raw.subarray(raw.length - 16));
      return Buffer.concat([decipher.update(raw.subarray(0, raw.length - 16)), decipher.final()]).toString('utf8');
    } catch {
      return null;
    }
  }
}
