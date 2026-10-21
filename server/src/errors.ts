import type { ContentfulStatusCode } from 'hono/utils/http-status';

/**
 * The API error contract (plan §11 "consistent error envelopes, stable
 * machine-readable error codes").
 *
 * Every non-2xx response the service produces has the shape
 *   { error: { code, message, details?, requestId } }
 * and `code` is one of ERROR_CODES. Malafat maps these codes to its own
 * user-facing taxonomy (invalid / revoked / missing scope / mismatch /
 * unavailable / rate limited / unexpected) — see the UX brief D13 — so adding
 * a code here is a contract change and must appear in openapi.yaml.
 */
export const ERROR_CODES = {
  /** MUT-360: a Stripe webhook whose Stripe-Signature doesn't verify against this endpoint's secret (or is too old). */
  INVALID_SIGNATURE: 400,
  UNAUTHENTICATED: 401,
  INVALID_API_KEY: 401,
  API_KEY_REVOKED: 401,
  API_KEY_EXPIRED: 401,
  API_KEY_ENVIRONMENT_MISMATCH: 401,
  ADMIN_UNAUTHORIZED: 401,
  /** MUT-360 D2: /jobs/* without the Scheduler's X-Job-Token. */
  JOB_UNAUTHORIZED: 401,
  INVALID_CREDENTIALS: 401,
  SESSION_EXPIRED: 401,
  INSUFFICIENT_SCOPE: 403,
  PRINCIPAL_NOT_ACCEPTED: 403,
  READ_ONLY_PROFILE: 403,
  CROSS_SITE_REQUEST: 403,
  /** MUT-237: the typed current password is wrong, or the account is locked. Not 401 — the session is still valid; a
   * 401 here would trip the portal's generic "session expired" handler and sign the person out mid-form. */
  CURRENT_PASSWORD_WRONG: 403,
  NOT_FOUND: 404,
  ORGANIZATION_MISMATCH: 409,
  CONFLICT: 409,
  OPERATION_IN_PROGRESS: 409,
  /** MUT-360: a Stripe reconcile is already running on this instance; the next one runs when it ends. */
  RECONCILE_RUNNING: 409,
  /** MUT-324: the terms version the client accepted (or none) is not the current one; `details.current` names it. */
  TERMS_VERSION_STALE: 409,
  /** MUT-235: a setup link that can no longer set a password; `details.state` is expired | used | superseded | invalid. */
  SETUP_LINK_UNUSABLE: 410,
  VALIDATION_FAILED: 422,
  IDEMPOTENCY_KEY_REUSED: 422,
  IDEMPOTENCY_KEY_REQUIRED: 422,
  /** MUT-360: a Stripe webhook body over 256 KB. */
  PAYLOAD_TOO_LARGE: 413,
  RATE_LIMITED: 429,
  INTERNAL: 500,
  ATTACHMENTS_NOT_CONFIGURED: 503,
  /** MUT-360: no Stripe keys on this server, so neither the webhook nor reconcile can run. */
  BILLING_NOT_CONFIGURED: 503,
  /** MUT-360 D2: no job token on this server; /jobs/* refuses everything rather than compare an empty one. */
  JOBS_NOT_CONFIGURED: 503,
  /** MUT-228: no reference rates to serve (provider down or unusable, and nothing servable cached on this instance; or not configured). */
  FX_RATES_UNAVAILABLE: 503,
  /** MUT-293: the calling phone build is below the configured floor for its platform; details carry { platform, minimumBuild }. */
  APP_UPDATE_REQUIRED: 426,
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

export interface ErrorEnvelope {
  error: {
    code: ErrorCode;
    message: string;
    details?: unknown;
    requestId: string;
  };
}

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: ContentfulStatusCode;
  readonly details: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = ERROR_CODES[code] as ContentfulStatusCode;
    this.details = details;
  }

  toEnvelope(requestId: string): ErrorEnvelope {
    const error: ErrorEnvelope['error'] = { code: this.code, message: this.message, requestId };
    if (this.details !== undefined) error.details = this.details;
    return { error };
  }
}

/**
 * MUT-120 / MUT-182: a profile a person owns — their built-in personal one or
 * one they created — belongs to that person and to no external system, so it
 * is never bound, issued an API key, granted to or provisioned into anyone
 * else, or revoked from its owner. MUT-373 (ADR-163): the one exception is an
 * operator grant with role OWNER, which adds a co-owner to an owned Business
 * profile (memberships.grantOwner); every other grant still refuses here. Every one of those doors refuses through
 * this one helper. An existing CONFLICT with a reason, not a new code (a new
 * code is a contract change Malafat maps): PERSONAL_PROFILE on the built-in
 * profile, as MUT-120 published it, and OWNED_PROFILE on any other.
 */
export function ownedProfileConflict(organization: { personalOwnerUserId: string | null }, message: string): ApiError {
  return new ApiError('CONFLICT', message, { reason: organization.personalOwnerUserId ? 'PERSONAL_PROFILE' : 'OWNED_PROFILE' });
}
