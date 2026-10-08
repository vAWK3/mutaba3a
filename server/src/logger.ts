import pino, { type Logger } from 'pino';

/**
 * Structured JSON logs to stdout (12-factor). Cloud Logging ingests them as-is.
 *
 * `redact` is the only place credential hygiene is enforced for logs, so it is
 * deliberately broad: any `authorization` header, anything named `apiKey`,
 * `secret`, `token` or `key` at any depth, and the admin token header.
 */
export function createLogger(level: string): Logger {
  return pino({
    level,
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers["x-admin-token"]',
        '*.authorization',
        '*.apiKey',
        '*.secret',
        '*.token',
        '*.key',
        'apiKey',
        'secret',
        'token',
        'key',
      ],
      censor: '[redacted]',
    },
    base: { service: 'mutaba3a-api' },
  });
}

export type { Logger };
