import type { MailTransport } from '../ports.js';

/** MUT-359: no mailer configured. The mailer answers `disabled` before it would ever deliver through this. */
export const NOOP_TRANSPORT: MailTransport = {
  kind: 'noop',
  async deliver() {
    throw new Error('the noop mail transport never delivers');
  },
};
