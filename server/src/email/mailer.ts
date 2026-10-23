import { createHash } from 'node:crypto';
import { normalizeEmail } from '../auth/users.js';
import type { Logger } from '../logger.js';
import type { LedgerStore } from '../repositories/ports.js';
import {
  isPlainAddress,
  isUnownedDomain,
  MailTransportError,
  SECURITY_TEMPLATES,
  type Mailer,
  type MailTemplateId,
  type MailTransport,
  type SendInput,
  type SendResult,
} from './ports.js';
import { BRAND_NAME, renderMail } from './templates/index.js';

/**
 * MUT-359 (ADR-159 §5): the one way the server sends mail. For each send, in this order:
 *
 *   1. one plain address on a domain we may mail (D7), else `refused`;
 *   2. render (a bad link throws: a caller bug, before anything is recorded);
 *   3. no mailer configured → `disabled` (warns once);
 *   4. a suppressed address (hard bounce, complaint) → `suppressed`, spending no cap;
 *   5. claim the send in the send log: the same key → `duplicate`; the global cap (less a reserve that only
 *      security mail may use) or the recipient's cap → `capped`;
 *   6. deliver, then record SENT or FAILED (a FAILED key may be sent again).
 *
 * Logs never carry an address or a link: the template, the language and the outcome only.
 */
export const MAIL_CAP_REACHED = 'mail cap reached; nothing sent';
export const MAIL_PROVIDER_FAILED = 'mail provider failed';
export const MAIL_PROVIDER_RATE_LIMITED = 'mail provider rate-limited';
const DAY_MS = 24 * 3_600_000;
/** A PENDING claim older than this was a crashed send; its key may be claimed again. */
const STALE_CLAIM_MS = 10 * 60_000;

export interface MailLimits {
  /** Sends in any rolling 24 h, every template counted. */
  daily: number;
  /** How much of `daily` only security mail may use (D18). */
  securityReserve: number;
  /** Sends to one address in any rolling 24 h (D17). */
  perRecipient: number;
}

export interface MailerOptions {
  transport: MailTransport;
  /** The unguarded store: the mailer is server bookkeeping, not a principal's request. */
  store: Pick<LedgerStore, 'email'>;
  logger: Logger;
  now: () => Date;
  /** no-reply@<apex> (MAIL_FROM_ADDRESS); the display name is the product's. */
  fromAddress: string;
  replyTo: string | null;
  limits: MailLimits;
}

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

export function createMailer(options: MailerOptions): Mailer {
  const { transport, store, logger, now, limits } = options;
  let warnedDisabled = false;

  return {
    kind: transport.kind,
    async send<T extends MailTemplateId>(input: SendInput<T>): Promise<SendResult> {
      const { template, locale } = input;
      const to = normalizeEmail(input.to);
      if (!isPlainAddress(to)) return refused('INVALID_ADDRESS');
      if (isUnownedDomain(to)) return refused('UNOWNED_DOMAIN');
      const rendered = renderMail(template, locale, input.vars);

      if (transport.kind === 'noop') {
        if (!warnedDisabled) logger.warn({ template }, 'MAILER is not configured; no mail is sent');
        warnedDisabled = true;
        return { status: 'disabled' };
      }
      if (await store.email.isSuppressed(to)) {
        logger.info({ template, locale }, 'mail not sent: the address is suppressed');
        return { status: 'suppressed' };
      }

      const at = now();
      const security = SECURITY_TEMPLATES.has(template);
      const keyDigest = sha256(input.idempotencyKey);
      const claim = await store.email.claimDelivery({
        keyDigest,
        recipientDigest: sha256(to),
        template,
        locale,
        at,
        since: new Date(at.getTime() - DAY_MS),
        staleBefore: new Date(at.getTime() - STALE_CLAIM_MS),
        limit: { total: security ? limits.daily : Math.max(0, limits.daily - limits.securityReserve), perRecipient: limits.perRecipient },
      });
      if (claim.status === 'duplicate') return claim;
      if (claim.status === 'capped') {
        const fields = { scope: claim.scope, cap: claim.scope === 'global' ? limits.daily : limits.perRecipient, template, security };
        if (claim.scope === 'global') logger.error(fields, MAIL_CAP_REACHED);
        else logger.warn(fields, MAIL_CAP_REACHED);
        return claim;
      }

      try {
        const { id } = await transport.deliver({ ...rendered, to, from: `${BRAND_NAME.en} <${options.fromAddress}>`, replyTo: options.replyTo, template, locale, idempotencyKey: keyDigest });
        await store.email.finishDelivery(claim.id, { providerId: id, at: now() });
        logger.info({ template, locale, providerId: id, transport: transport.kind }, 'mail sent');
        return { status: 'sent', id };
      } catch (err) {
        const failure = err instanceof MailTransportError ? err : new MailTransportError('unavailable', err instanceof Error ? err.message : String(err));
        await store.email.finishDelivery(claim.id, { error: `${failure.reason}: ${failure.message}`, at: now() });
        logger.error({ template, locale, reason: failure.reason, status: failure.status }, failure.reason === 'rate_limited' ? MAIL_PROVIDER_RATE_LIMITED : MAIL_PROVIDER_FAILED);
        return { status: 'failed', reason: failure.reason };
      }

      function refused(reason: 'INVALID_ADDRESS' | 'UNOWNED_DOMAIN'): SendResult {
        logger.warn({ template, reason }, 'mail refused');
        return { status: 'refused', reason };
      }
    },
  };
}
