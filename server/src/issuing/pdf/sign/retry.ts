/**
 * MUT-641 (review): signing calls two network services (Cloud KMS, a time-stamp authority). A transient failure gets one
 * more try after a short pause; a setup problem (SigningSetupError: an expired certificate, a key that isn't the
 * certificate's) fails at once, since trying again can't fix it.
 */
export class SigningSetupError extends Error {
  constructor(
    message: string,
    /** Machine-readable, for the 503's details.reason. */
    readonly reason: 'CERTIFICATE_NOT_VALID' | 'KEY_MISMATCH' | 'CHAIN_INVALID' | 'KEY_ALGORITHM' | 'SIGNATURE_TOO_LARGE' | 'KEY_UNAVAILABLE',
  ) {
    super(message);
    this.name = 'SigningSetupError';
  }
}

export const RETRY_PAUSE_MS = 400;

export async function withOneRetry<T>(attempt: () => Promise<T>, pause: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms))): Promise<T> {
  try {
    return await attempt();
  } catch (error) {
    if (error instanceof SigningSetupError) throw error;
    await pause(RETRY_PAUSE_MS);
    return attempt();
  }
}
