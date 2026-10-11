import pino, { type DestinationStream, type Logger } from 'pino';

/**
 * Structured JSON logs to stdout (12-factor). Cloud Logging ingests them as-is.
 *
 * `redact` is the only place credential hygiene is enforced for logs. pino's
 * `*.x` wildcard matches exactly one level, so every sensitive key is spelled
 * out at depths 0–3 (deeper than any object this service logs); the request
 * cookie and response Set-Cookie headers are named explicitly. TD-039: pinned
 * by `__tests__/logger.test.ts`.
 */
const SENSITIVE_KEYS = ['authorization', 'cookie', 'set-cookie', 'password', 'token', 'secret', 'apiKey', 'key', 'x-admin-token', 'sessionToken'];
const MAX_DEPTH = 3;

function segment(key: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(key) ? `.${key}` : `["${key}"]`;
}

export function redactPaths(): string[] {
  const paths: string[] = [];
  for (const key of SENSITIVE_KEYS) {
    for (let depth = 0; depth <= MAX_DEPTH; depth++) {
      const prefix = Array.from({ length: depth }, () => '*').join('.');
      const seg = segment(key);
      paths.push(prefix ? `${prefix}${seg}` : seg.startsWith('.') ? seg.slice(1) : seg);
    }
  }
  return paths;
}

export function createLogger(level: string, destination?: DestinationStream): Logger {
  const options = {
    level,
    redact: { paths: redactPaths(), censor: '[redacted]' },
    base: { service: 'mutaba3a-api' },
  };
  return destination ? pino(options, destination) : pino(options);
}

export type { Logger };
