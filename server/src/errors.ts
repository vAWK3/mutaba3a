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
  UNAUTHENTICATED: 401,
  INVALID_API_KEY: 401,
  API_KEY_REVOKED: 401,
  API_KEY_EXPIRED: 401,
  API_KEY_ENVIRONMENT_MISMATCH: 401,
  ADMIN_UNAUTHORIZED: 401,
  INSUFFICIENT_SCOPE: 403,
  NOT_FOUND: 404,
  ORGANIZATION_MISMATCH: 409,
  CONFLICT: 409,
  OPERATION_IN_PROGRESS: 409,
  VALIDATION_FAILED: 422,
  IDEMPOTENCY_KEY_REUSED: 422,
  IDEMPOTENCY_KEY_REQUIRED: 422,
  RATE_LIMITED: 429,
  INTERNAL: 500,
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
