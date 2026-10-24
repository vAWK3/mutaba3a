import { describe, expect, it } from 'vitest';
import { hash, verify } from '../platform/argon2';

/** The portal build's argon2 stand-in (MUT-368): password hashing never runs in the page, so using it is a bug. */
describe('argon2 browser stub', () => {
  it('refuses to hash or verify, saying hashing happens on the server', async () => {
    await expect(hash()).rejects.toThrow(/server only/);
    await expect(verify()).rejects.toThrow(/server only/);
  });
});
