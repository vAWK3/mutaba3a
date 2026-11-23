import pino from 'pino';
import { TwoFactorFlow } from '../../auth/two-factor-flow.js';
import { TwoFactorKeys } from '../../auth/two-factor.js';
import { createMailer } from '../../email/mailer.js';
import { NOOP_TRANSPORT } from '../../email/transports/noop.js';
import { SlidingWindowRateLimiter } from '../../rate-limit.js';
import { MemoryLedgerStore } from '../../repositories/memory.js';

/** MUT-710: a second-step flow for unit tests that call the sign-in core directly; mails go nowhere. */
export function testTwoFactorFlow(pepper = 'p'.repeat(32)): TwoFactorFlow {
  const logger = pino({ level: 'silent' });
  const mailer = createMailer({ transport: NOOP_TRANSPORT, store: new MemoryLedgerStore(), logger, now: () => new Date(), fromAddress: 'no-reply@example.invalid', replyTo: null, limits: { daily: 1, securityReserve: 0, perRecipient: 1 } });
  return new TwoFactorFlow({ keys: new TwoFactorKeys(`pepper:${pepper}`), pepper, mailer, logger, mailLimiter: new SlidingWindowRateLimiter(10, 3_600_000), settings: { trustedProxyHops: 1 } });
}
