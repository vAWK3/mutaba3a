import type { Logger } from '../logger.js';
import type { UserLocale } from '../repositories/ports.js';
import type { Mailer } from './ports.js';

/**
 * MUT-359 (A5, D8): "your password was set / changed", after every `user.password_set` (setup-link redeem) and
 * `user.password_changed` (POST /v1/me/password). Called after the change committed; it never throws, so a mail
 * problem can't turn a successful password change into an error. Outcomes other than `sent` are already logged by
 * the mailer where they matter (failed, capped); the rest are expected (no mailer, suppressed) and go to debug.
 */
export async function sendPasswordNotice(
  mailer: Mailer,
  logger: Logger,
  person: { id: string; email: string; locale: UserLocale },
  notice: { first: boolean; signInLink: string; requestId: string },
): Promise<void> {
  try {
    const result = await mailer.send({
      to: person.email,
      template: 'password-changed',
      locale: person.locale,
      vars: { first: notice.first, signInLink: notice.signInLink },
      // One notice per change: the change's own request. (An instant would collide under a frozen test clock, and two
      // changes inside one millisecond are still two changes.)
      idempotencyKey: `password-notice:${person.id}:${notice.requestId}`,
    });
    if (result.status !== 'sent') logger.debug({ userId: person.id, outcome: result.status }, 'password notice not sent');
  } catch (err) {
    logger.error({ err, userId: person.id }, 'password notice failed');
  }
}
