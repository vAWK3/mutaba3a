import type { Logger } from '../logger.js';

/**
 * MUT-366 (ADR-159 §7, D7): Cloudflare Turnstile, verified by the server itself and failing closed. The portal's
 * widget (MUT-368) renders with the form's action, `signup` or `recover`, and sends its token with the request.
 *
 * Cloudflare publishes test secrets that always pass, always fail, or report a spent token. They are answered here
 * without a network call, so development, CI and QA never reach Cloudflare. Production refuses them (config.ts).
 */
export const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export const TURNSTILE_TEST_SECRETS = {
  pass: '1x0000000000000000000000000000000AA',
  fail: '2x0000000000000000000000000000000AA',
  spent: '3x0000000000000000000000000000000AA',
} as const;

/** A token is at most 2048 characters (Cloudflare's documented limit). */
export const TURNSTILE_TOKEN_MAX_LENGTH = 2048;

export type TurnstileAction = 'signup' | 'recover';

export interface TurnstileContext {
  /** The client address the front door reported; null when unknown. */
  ip: string | null;
  action: TurnstileAction;
  /** Lets Cloudflare recognise a retried verification of the same token as the same one. */
  idempotencyKey: string;
}

export interface TurnstileVerifier {
  readonly mode: 'test' | 'live';
  /** True only when Cloudflare (or a test secret) says the token passed for this action. Never throws. */
  verify(token: string, context: TurnstileContext): Promise<boolean>;
}

const TEST_SECRETS: ReadonlySet<string> = new Set(Object.values(TURNSTILE_TEST_SECRETS));

export function isTurnstileTestSecret(secret: string): boolean {
  return TEST_SECRETS.has(secret);
}

/** No secret on this server (production with mail off): every check fails closed, and Cloudflare is never asked. */
export const UNCONFIGURED_TURNSTILE: TurnstileVerifier = { mode: 'live', verify: async () => false };

/** Five seconds, then the check fails closed. */
export const SITEVERIFY_TIMEOUT_MS = 5000;

export function createTurnstileVerifier(options: { secret: string; fetch?: typeof fetch; timeoutMs?: number; logger?: Logger }): TurnstileVerifier {
  const { secret } = options;
  if (isTurnstileTestSecret(secret)) {
    const passes = secret === TURNSTILE_TEST_SECRETS.pass;
    return { mode: 'test', verify: async (token) => passes && token.length > 0 };
  }
  const doFetch = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? SITEVERIFY_TIMEOUT_MS;
  return {
    mode: 'live',
    async verify(token, context) {
      if (token.length === 0) return false;
      try {
        const res = await doFetch(SITEVERIFY_URL, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ secret, response: token, ...(context.ip ? { remoteip: context.ip } : {}), idempotency_key: context.idempotencyKey }),
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (res.status !== 200) {
          options.logger?.warn({ status: res.status }, 'turnstile siteverify refused the request');
          return false;
        }
        const body = (await res.json()) as { success?: unknown; action?: unknown; 'error-codes'?: unknown };
        // A token minted for the other form, or by a widget that named no action, is not this form's check.
        return body.success === true && body.action === context.action;
      } catch (err) {
        options.logger?.warn({ err }, 'turnstile siteverify failed');
        return false;
      }
    },
  };
}
