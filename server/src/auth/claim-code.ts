import { generateSignInCode } from './sign-in-code.js';
import { sessionDigest } from './sessions.js';

/**
 * MUT-764 (accountant channel, epic MUT-762, eng T4): the claim code. The accountant tells it to the customer in the
 * room; the customer types it on the setup page with the mailed link. Same shape as the sign-in code (six digits,
 * `generateSignInCode`) but a digest of its own: a claim code's digest is worthless as a sign-in code and the other
 * way round. Verification, the five-try lockout and reissue are MUT-765.
 */
export const generateClaimCode = generateSignInCode;

/** An HMAC under the server's pepper, bound to the customer's address (so a leaked row can't be reversed by trying all 10^6 codes). */
export function claimCodeDigest(pepper: string, email: string, code: string): string {
  return sessionDigest(pepper, `claim-code:${email}:${code}`);
}
