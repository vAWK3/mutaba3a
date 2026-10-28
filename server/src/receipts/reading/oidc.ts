import { OAuth2Client } from 'google-auth-library';

/**
 * MUT-441 (R8): who may call the read job. Cloud Tasks (the read) and Cloud Scheduler (the sweep) each present a
 * Google-signed OIDC token for their own service account; the route takes nothing else, not the shared X-Job-Token
 * (which would open /jobs/v1/accounts/purge to anyone who could read a task's headers).
 */
export interface ReadJobVerifier {
  /** True only for a valid bearer token from one of the allowed callers. Never throws. */
  verify(authorization: string | undefined): Promise<boolean>;
}

/** The one call made on Google's OAuth2Client, so tests can stand in for it. */
export interface IdTokenVerifierClient {
  verifyIdToken(options: { idToken: string; audience: string }): Promise<{ getPayload(): { email?: string | undefined; email_verified?: boolean | undefined } | undefined }>;
}

export interface GoogleOidcVerifierOptions {
  /** READ_OIDC_AUDIENCE: the API's own URL, as the task and the Scheduler job mint it. */
  audience: string;
  /** READ_INVOKER_SA and SWEEP_INVOKER_SA. */
  allowedEmails: readonly string[];
  client?: IdTokenVerifierClient;
}

export function googleOidcVerifier(options: GoogleOidcVerifierOptions): ReadJobVerifier {
  const client: IdTokenVerifierClient = options.client ?? new OAuth2Client();
  const allowed = new Set(options.allowedEmails.map((e) => e.toLowerCase()));
  return {
    async verify(authorization) {
      const match = /^Bearer\s+(\S+)$/i.exec(authorization ?? '');
      if (!match) return false;
      try {
        const ticket = await client.verifyIdToken({ idToken: match[1]!, audience: options.audience });
        const payload = ticket.getPayload();
        return Boolean(payload?.email_verified && payload.email && allowed.has(payload.email.toLowerCase()));
      } catch {
        return false;
      }
    },
  };
}
