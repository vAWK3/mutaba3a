import { randomUUID } from 'node:crypto';
import type { Logger } from '../../logger.js';
import type { MailTransport, OutgoingMail } from '../ports.js';

/**
 * MUT-359: local development. Writes the rendered mail, its link included, to the log instead of sending it.
 * Config refuses it in production (D14): a setup link in Cloud Logging is a credential anyone with log access holds.
 */
export function createLogTransport(logger: Logger): MailTransport {
  return {
    kind: 'log',
    async deliver(mail: OutgoingMail) {
      const id = `log_${randomUUID()}`;
      logger.info({ mail: { id, to: mail.to, template: mail.template, locale: mail.locale, subject: mail.subject, text: mail.text } }, 'mail (log transport, not sent)');
      return { id };
    },
  };
}
