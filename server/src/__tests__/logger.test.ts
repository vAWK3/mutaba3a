import { describe, expect, it } from 'vitest';
import { createLogger } from '../logger.js';

/**
 * TD-039 / MUT-38: redaction is the only place credential hygiene is enforced
 * for logs. pino's `*.x` wildcard matches one level, so the paths are spelled
 * out to the depths our objects reach; this pins every one of them.
 */
const SECRET_KEYS = [
  'authorization',
  'cookie',
  'set-cookie',
  'password',
  'token',
  'secret',
  'apiKey',
  'key',
  'x-admin-token',
  'sessionToken',
  'stripe-signature',
  'x-job-token',
  // MUT-434 (D16)
  'code_verifier',
  'access_token',
  'refresh_token',
  'client_secret',
  'authorization_code',
];

function capture() {
  const lines: string[] = [];
  const logger = createLogger('trace', { write: (line: string) => void lines.push(line) });
  return { logger, lines };
}

function nest(depth: number, leaf: Record<string, unknown>): Record<string, unknown> {
  let value: Record<string, unknown> = leaf;
  for (let i = 0; i < depth; i++) value = { [`level${depth - i}`]: value };
  return value;
}

describe('createLogger redaction', () => {
  it.each(SECRET_KEYS.flatMap((key) => [0, 1, 2, 3].map((depth) => [key, depth] as const)))('redacts %s at depth %i', (key, depth) => {
    const { logger, lines } = capture();
    const marker = `SENSITIVE-${key}-${depth}`;
    logger.info(nest(depth, { [key]: marker, harmless: 'visible' }), 'event');
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain(marker);
    expect(lines[0]).toContain('[redacted]');
    expect(lines[0]).toContain('visible');
  });

  it('keeps a plain `code` and `state` readable (MUT-434 D16: billing logs Stripe error codes)', () => {
    const { logger, lines } = capture();
    logger.warn({ code: 'rate_limit', state: 'READ_ONLY' }, 'billing catalog unavailable');
    expect(lines[0]).toContain('"code":"rate_limit"');
    expect(lines[0]).toContain('"state":"READ_ONLY"');
  });

  it('redacts request cookies and response Set-Cookie headers', () => {
    const { logger, lines } = capture();
    logger.info(
      {
        req: { headers: { cookie: '__Host-mut_session=TOKEN-IN-REQUEST', 'user-agent': 'ua' } },
        res: { headers: { 'set-cookie': '__Host-mut_session=TOKEN-IN-RESPONSE; HttpOnly' } },
      },
      'request',
    );
    expect(lines[0]).not.toContain('TOKEN-IN-REQUEST');
    expect(lines[0]).not.toContain('TOKEN-IN-RESPONSE');
    expect(lines[0]).toContain('"user-agent":"ua"');
  });
});
