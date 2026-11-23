import { createHmac } from 'node:crypto';

/**
 * MUT-710 (ADR-274 D12): the authentication log the SHAAM security appendix (§19) asks for. Every event is one
 * structured stdout line with `event: 'auth_event'`; the Terraform sink (infrastructure/terraform/auth_log.tf) copies
 * exactly those lines into a Cloud Logging bucket kept 365 days. The audit table stays the per-profile record; this is
 * the complete one: it also covers people with no profile and addresses with no account.
 *
 * Never a code, a token, a password or an address: an unknown address is `emailKey`, a keyed digest.
 */
export const AUTH_EVENT_KINDS = [
  'sign_in.succeeded',
  'sign_in.failed',
  'sign_in.locked_out',
  'two_factor.challenged',
  'two_factor.verified',
  'two_factor.failed',
  'two_factor.locked_out',
  'two_factor.code_sent',
  'two_factor.enabled',
  'two_factor.disabled',
  'two_factor.recovery_code_used',
  'two_factor.recovery_codes_regenerated',
  'two_factor.reset_by_operator',
  'password.changed',
  'password.reset',
  'tax_authority.connected',
  'tax_authority.connect_failed',
  'tax_authority.disconnected',
  'tax_authority.token_refreshed',
  'tax_authority.token_refresh_failed',
] as const;

export type AuthEventKind = (typeof AUTH_EVENT_KINDS)[number];

export interface AuthLogEntry {
  kind: AuthEventKind;
  /** null when the address has no account (then `emailKey`) or for a system event. */
  userId: string | null;
  emailKey?: string;
  organizationId?: string;
  /** The first step (password, passkey, email-code, malafat) or the second (totp, email, recovery_code). */
  method?: string;
  sessionKind?: 'cookie' | 'device';
  /** A short reason: wrong, expired, locked, too_many_tries, invalid_grant… */
  outcome?: string;
  ip?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

/** The slice of the pino logger this needs, so tests can capture lines. */
export interface AuthLogSink {
  info(fields: object, message: string): void;
}

const USER_AGENT_MAX = 200;

export function authLog(sink: AuthLogSink, entry: AuthLogEntry): void {
  const fields: Record<string, unknown> = { event: 'auth_event', kind: entry.kind, userId: entry.userId };
  for (const name of ['emailKey', 'organizationId', 'method', 'sessionKind', 'outcome', 'ip', 'requestId'] as const) {
    const value = entry[name];
    if (value !== undefined && value !== null) fields[name] = value;
  }
  if (entry.userAgent) fields.userAgent = entry.userAgent.slice(0, USER_AGENT_MAX);
  sink.info(fields, 'auth_event');
}

/** A stable, keyed 64-bit digest of the normalised address: enough to group failures, useless to read. */
export function authEmailKey(pepper: string, email: string): string {
  return createHmac('sha256', pepper).update(`auth-log:${email.trim().toLowerCase()}`).digest('hex').slice(0, 16);
}
