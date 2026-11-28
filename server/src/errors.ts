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
  /** MUT-367: a signup address this service won't mail: `details.reason` is disposable or no-mail. Depends only on the input. */
  EMAIL_NOT_ACCEPTED: 400,
  UNAUTHENTICATED: 401,
  INVALID_API_KEY: 401,
  API_KEY_REVOKED: 401,
  API_KEY_EXPIRED: 401,
  API_KEY_ENVIRONMENT_MISMATCH: 401,
  ADMIN_UNAUTHORIZED: 401,
  /** MUT-359 (D12): a Resend webhook whose Svix signature doesn't verify against the endpoint's secret (or is too old). */
  INVALID_WEBHOOK_SIGNATURE: 401,
  /** MUT-360 D2: /jobs/* without the Scheduler's X-Job-Token. */
  JOB_UNAUTHORIZED: 401,
  INVALID_CREDENTIALS: 401,
  /** MUT-618 (ADR-256 D6): the emailed code is wrong; `details.triesLeft`. The same for every address. */
  SIGN_IN_CODE_WRONG: 401,
  /** MUT-618: no live code for the address: expired, used, replaced by a newer one, killed, or never sent. */
  SIGN_IN_CODE_EXPIRED: 401,
  /** MUT-618: that was the code's last allowed wrong try; it no longer works. */
  SIGN_IN_CODE_TOO_MANY_TRIES: 401,
  SESSION_EXPIRED: 401,
  INSUFFICIENT_SCOPE: 403,
  PRINCIPAL_NOT_ACCEPTED: 403,
  READ_ONLY_PROFILE: 403,
  CROSS_SITE_REQUEST: 403,
  /** MUT-366: the Turnstile check on signup or recovery was missing, failed, or Cloudflare couldn't be asked (fails closed). */
  CHECK_FAILED: 403,
  /** MUT-367: the right password for a self-service account the operator hasn't approved yet; no session is issued. */
  ACCOUNT_UNDER_REVIEW: 403,
  /** MUT-237: the typed current password is wrong, or the account is locked. Not 401 — the session is still valid; a
   * 401 here would trip the portal's generic "session expired" handler and sign the person out mid-form. */
  CURRENT_PASSWORD_WRONG: 403,
  /**
   * MUT-333 (ADR-188): the account is closing. During the 30 days' grace a session reaches only GET /v1/me,
   * DELETE /v1/me/closure (keep the account) and sign-out. `details`: { deleteAfter }. Never for an API key.
   */
  ACCOUNT_CLOSING: 403,
  /** MUT-333 (R18): a profile the person created has other members and no co-owner; closing would delete their work. */
  ACCOUNT_CLOSE_BLOCKED: 409,
  /**
   * MUT-115 (D4): adding a passkey needs a sign-in at most 10 minutes old, or the current password in the request.
   * Not 401, for the same reason as CURRENT_PASSWORD_WRONG: the session is still valid.
   */
  RECENT_SIGN_IN_REQUIRED: 403,
  /**
   * MUT-459 (ADR-212): an operator's passkey step-up didn't verify (another person's passkey, a sign-in or used or expired
   * challenge, a bad signature). Not 401: the session is still valid.
   */
  PASSKEY_NOT_ACCEPTED: 403,
  /**
   * MUT-710 (ADR-274 D1): the first step verified and the person has two-step sign-in on; no session exists yet.
   * `details`: { challengeToken, method totp|email, expiresAt, emailHint? }. Also a setup link's redeem without the
   * second step (D11). 403, not 401, so an old client shows the message instead of "signed out".
   */
  TWO_FACTOR_REQUIRED: 403,
  /** MUT-710 (D3): the second-step code (or recovery code) is wrong; `details.triesLeft` on this challenge. */
  TWO_FACTOR_CODE_WRONG: 403,
  /** MUT-710: the challenge is unknown, expired, already used, or for another purpose; start again. */
  TWO_FACTOR_CHALLENGE_EXPIRED: 403,
  /** MUT-710 (D3): the challenge's fifth wrong code; it no longer works. */
  TWO_FACTOR_TOO_MANY_TRIES: 403,
  /**
   * MUT-710 (D10): issuing needs two-step sign-in on and this session to have passed it. `details.enrolled`: true when
   * it is on but this session predates it (sign in again), false when it needs turning on.
   */
  TWO_FACTOR_SETUP_REQUIRED: 403,
  /** MUT-710 (D6): with the email method an emailed sign-in code is one factor twice: sign in with the password. */
  TWO_FACTOR_USE_PASSWORD: 403,
  /** MUT-710 (D6, review 8): linking a Malafat identity to an account with two-step sign-in on waits for a follow-up. */
  TWO_FACTOR_LINK_UNAVAILABLE: 403,
  /** MUT-710 (D8): two-step sign-in can't be turned off while the person owns a profile that issues documents. */
  TWO_FACTOR_REQUIRED_FOR_ISSUING: 409,
  /** MUT-115 (D12): the person already holds the most passkeys allowed (10); remove one to add another. */
  PASSKEY_LIMIT: 409,
  /**
   * MUT-361 (ADR-181): a session asked a READ_ONLY or LOCKED profile (or a person whose profiles all are) for something
   * its plan no longer allows. `details`: { profileId (null for a person-level refusal), state READ_ONLY|LOCKED,
   * source, until (a trial's lock date, else null) }. Never for an API key.
   */
  SUBSCRIPTION_LAPSED: 402,
  /**
   * MUT-565 (ADR-251): the accountant needs the Accountant plan. On accept (the 4th client book without the plan):
   * `details` { freeLimit, active, inviteExpiresAt }; nothing was written and the invite stays open until it expires.
   * On a client past the free ones while the plan isn't paid (selectProfile): `details` { profileId, freeLimit }.
   * Not 409 ACCOUNTANT_LIMIT-style: that reason is the owner's 5-accountants-per-profile limit.
   */
  ACCOUNTANT_PLAN_REQUIRED: 402,
  /** MUT-764 (accountant channel): creating a customer's account needs the operator's approval, which this person doesn't have (or was withdrawn). */
  ACCOUNTANT_NOT_APPROVED: 403,
  /** MUT-765: a provisioned account's claim code is wrong; `details.triesLeft`. The fifth wrong try locks it (CLAIM_CODE_LOCKED). */
  CLAIM_CODE_WRONG: 403,
  /** MUT-765: the claim code took five wrong tries and no longer works; the accountant issues a new one. */
  CLAIM_CODE_LOCKED: 403,
  /** MUT-765 (ACCT-10): a setup action on a customer who has already claimed their account; only the read grant remains. */
  CUSTOMER_CLAIMED: 403,
  // MUT-782 (ADR-341): the period is past this step (a confirmed period no longer moves).
  VAT_PERIOD_STATE: 409,
  /**
   * MUT-559 (ADR-245, D4): an accountant invite accepted by someone else: neither the invited address nor a colleague
   * on the same business domain (webmail, disposable and relay domains never match). `details.maskedEmail` names the
   * invited address, mostly hidden, so the person can sign in with it.
   */
  INVITE_EMAIL_MISMATCH: 403,
  /**
   * MUT-560 (ADR-247): a share link refused to its visitor, who has no account: `details.reason` LOCKED (too many wrong
   * PINs; the owner makes a new link), PIN_WRONG (with `details.attemptsLeft`) or VIEWER_LIMIT (3 devices have opened it).
   * Every link that can't be used at all answers 404 NOT_FOUND, reason SHARE_LINK_UNAVAILABLE, the same for every cause.
   */
  SHARE_LINK_REFUSED: 403,
  /** MUT-434 (AC6): the person doesn't hold the per-user feature this needs (MUT-433, e.g. `agent_access`); `details.feature`. */
  FEATURE_NOT_ENABLED: 403,
  NOT_FOUND: 404,
  ORGANIZATION_MISMATCH: 409,
  CONFLICT: 409,
  /**
   * MUT-736/731 (ADR-282): the payer's plan doesn't include this (`details.limit`: taxAuthority; MUT-731 adds the
   * monthly meters and counts). `details.nextPlan` names the plan that does; `details.canUpgrade` says whether it can be
   * bought on this server now. 409, not 402: 402 is the lapse gate's "plan ended". Nothing was done, so the idempotency
   * key is released and the same request succeeds after an upgrade.
   */
  PLAN_LIMIT: 409,
  OPERATION_IN_PROGRESS: 409,
  /** MUT-737 (ADR-289): with OPEN_SIGNUP on there is no review: approve and decline are retired (the list stays as history). */
  SIGNUP_REVIEW_RETIRED: 409,
  /** MUT-733 (ADR-293): the account's once-ever over-cap gift was already taken (a later refusal is a hard cap). */
  GIFT_USED: 409,
  /** MUT-733: the gift can't be taken now: PAID_HARD_CAPS off, not a Solo or Business payer, or the meter isn't at its cap. */
  GIFT_NOT_AVAILABLE: 409,
  /** MUT-360: a Stripe reconcile is already running on this instance; the next one runs when it ends. */
  RECONCILE_RUNNING: 409,
  /** MUT-419 (R11): a real trial-mail run in production whose links would point at a loopback origin; `details.origin`. */
  LINK_ORIGIN_LOOPBACK: 409,
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
  /** MUT-360 review: a reconcile that could not list Stripe at all (bad or under-scoped key, Stripe down); details carry the summary. */
  RECONCILE_FAILED: 502,
  /** MUT-362: Stripe didn't answer a Checkout, Customer Portal or customer call in time; trying again shortly may work. */
  STRIPE_UNAVAILABLE: 502,
  /** MUT-642: the public company/nonprofit registry (data.gov.il) didn't answer in time; the person types the details. */
  REGISTRY_UNAVAILABLE: 502,
  /** MUT-571/572: the Tax Authority's Open API did not answer, or failed; nothing was issued. */
  TAX_AUTHORITY_UNAVAILABLE: 502,
  ATTACHMENTS_NOT_CONFIGURED: 503,
  /** MUT-360: no Stripe keys on this server, so neither the webhook nor reconcile can run. */
  BILLING_NOT_CONFIGURED: 503,
  /** MUT-359: the Resend webhook has no signing secret on this server. */
  MAILER_NOT_CONFIGURED: 503,
  /** MUT-360 D2: no job token on this server; /jobs/* refuses everything rather than compare an empty one. */
  JOBS_NOT_CONFIGURED: 503,
  /** MUT-434: no PORTAL_ORIGIN (the issuer) or no OAUTH_DERIVE_KEY, so the OAuth endpoints and /mcp are off. */
  OAUTH_NOT_CONFIGURED: 503,
  /** MUT-228: no reference rates to serve (provider down or unusable, and nothing servable cached on this instance; or not configured). */
  FX_RATES_UNAVAILABLE: 503,
  /** MUT-641 (ADR-265): this server has no document signer (production until the certificate is in place); nothing was sent. */
  SIGNING_NOT_CONFIGURED: 503,
  /** MUT-641: the signing key or the time-stamp authority failed; nothing was sent, a retry with the same key may work. */
  SIGNING_UNAVAILABLE: 503,
  /** MUT-293: the calling phone build is below the configured floor for its platform; details carry { platform, minimumBuild }. */
  APP_UPDATE_REQUIRED: 426,
  /** MUT-551 (release gate RF-2): MAINTENANCE_MODE is on; every phone request (X-App-Platform) answers this until it's off. */
  MAINTENANCE: 503,
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

/** MUT-565 (ADR-251): one wording for both places the Accountant plan is needed (accept and selectProfile). */
export function accountantPlanRequired(details: { profileId: string; freeLimit: number } | { freeLimit: number; active: number; inviteExpiresAt: string }): ApiError {
  return new ApiError('ACCOUNTANT_PLAN_REQUIRED', `You read ${details.freeLimit} client books for free; the Accountant plan opens more`, details);
}
