import { randomBytes } from 'node:crypto';
import { hash as argon2Hash, verify as argon2Verify } from '@node-rs/argon2';

/**
 * Human principals on the hosted service (ADR-037, MUT-37). Users are issued by
 * an operator only — there is no signup, invite or self-service reset — so the
 * only secrets this module creates are operator-delivered one-time passwords.
 */

/** Emails are compared after trimming, NFKC folding and lower-casing, so `Ｐartner@Firm.ps ` and `partner@firm.ps` are one account. */
export function normalizeEmail(raw: string): string {
  return raw.normalize('NFKC').trim().toLowerCase();
}

/** 18 random bytes → exactly 24 base64url characters (144 bits). Shown once to the operator, never stored. */
const ONE_TIME_PASSWORD_BYTES = 18;

export function generateOneTimePassword(): string {
  return randomBytes(ONE_TIME_PASSWORD_BYTES).toString('base64url');
}

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  /** False for a wrong password and for a stored value that is not a valid hash. */
  verify(storedHash: string, password: string): Promise<boolean>;
}

export interface Argon2Params {
  memoryKiB: number;
  timeCost: number;
  parallelism: number;
}

/**
 * OWASP Password Storage Cheat Sheet, argon2id profile 1 (m = 19 MiB, t = 2,
 * p = 1). `config.ts` refuses anything weaker at boot; the factory itself does
 * not, so tests may construct a hasher directly.
 */
export const ARGON2_MINIMUMS: Argon2Params = { memoryKiB: 19_456, timeCost: 2, parallelism: 1 };

export function createArgon2Hasher(params: Argon2Params): PasswordHasher {
  // @node-rs/argon2 defaults to argon2id, version 0x13.
  const options = { memoryCost: params.memoryKiB, timeCost: params.timeCost, parallelism: params.parallelism };
  return {
    hash: (password) => argon2Hash(password, options),
    verify: async (storedHash, password) => {
      try {
        return await argon2Verify(storedHash, password);
      } catch {
        return false;
      }
    },
  };
}
