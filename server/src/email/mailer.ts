import { createHash } from 'node:crypto';
import { normalizeEmail } from '../auth/users.js';
import type { Logger } from '../logger.js';
import type { ClaimDeliveryResult, LedgerStore } from '../repositories/ports.js';
import {
  isPlainAddress,
  isUnownedDomain,
  MailTransportError,
  RECIPIENT_CAP_EXEMPT,
  RECOVERY_TEMPLATES,
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
 *   5. claim the send in the send log, one claim at a time: the same key → `duplicate`; the global cap (less a
 *      reserve that only recovery mail may use) or the recipient's cap → `capped`;
 *   6. deliver, then record SENT, FAILED, or UNCERTAIN for a timeout (a FAILED or UNCERTAIN key may be sent again).
 *
 * The send log being unreachable is `failed` (`unavailable`), never a throw.
 *
 * Logs never carry an address or a link: the template, the language and the outcome only.
 */
export const MAIL_CAP_REACHED = 'mail cap reached; nothing sent';
export const MAIL_PROVIDER_FAILED = 'mail provider failed';
export const MAIL_PROVIDER_RATE_LIMITED = 'mail provider rate-limited';
export const MAIL_LOG_UNAVAILABLE = 'mail send log unavailable';
const DAY_MS = 24 * 3_600_000;
/** A PENDING claim older than this was a crashed send; its key may be claimed again. */
const STALE_CLAIM_MS = 10 * 60_000;

export interface MailLimits {
  /** Sends in any rolling 24 h, every template counted. */
  daily: number;
  /** How much of `daily` only recovery mail may use (D18). */
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
  /** MUT-468: PORTAL_ORIGIN, where the mail art is served (`MAIL_ART_PATH`). Unset = mails without pictures. */
  artOrigin?: string;
  /** MUT-468: WEBSITE_ORIGIN, for the footer's Privacy link. Unset = no Privacy link. */
  websiteOrigin?: string;
}

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

export function createMailer(options: MailerOptions): Mailer {
  const { transport, store, logger, now, limits } = options;
  let warnedDisabled = false;
  // One claim at a time (eng review): a claim is a count then an insert, so concurrent sends would all read the same
  // count and overshoot the caps by the request concurrency. Production runs one instance (TD-017), where this chain
  // serializes every claim; a second instance would need a database lock instead.
  let claimChain: Promise<unknown> = Promise.resolve();
  const serialized = <R>(work: () => Promise<R>): Promise<R> => {
    const next = claimChain.then(work, work);
    claimChain = next.catch(() => undefined);
    return next;
  };

  return {
    kind: transport.kind,
    async send<T extends MailTemplateId>(input: SendInput<T>): Promise<SendResult> {
      const { template, locale } = input;
      const to = normalizeEmail(input.to);
      if (!isPlainAddress(to)) return refused('INVALID_ADDRESS');
      if (isUnownedDomain(to)) return refused('UNOWNED_DOMAIN');
      const rendered = renderMail(template, locale, input.vars, { to, artOrigin: options.artOrigin, websiteOrigin: options.websiteOrigin });

      if (transport.kind === 'noop') {
        if (!warnedDisabled) logger.warn({ template }, 'MAILER is not configured; no mail is sent');
        warnedDisabled = true;
        return { status: 'disabled' };
      }

      const recovery = RECOVERY_TEMPLATES.has(template);
      const total = recovery ? limits.daily : Math.max(0, limits.daily - limits.securityReserve);
      const keyDigest = sha256(input.idempotencyKey);
      let claim: ClaimDeliveryResult;
      try {
        if (await store.email.isSuppressed(to)) {
          logger.info({ template, locale }, 'mail not sent: the address is suppressed');
          return { status: 'suppressed' };
        }
        claim = await serialized(() => {
          const at = now();
          return store.email.claimDelivery({
            keyDigest,
            recipientDigest: sha256(to),
            template,
            locale,
            at,
            since: new Date(at.getTime() - DAY_MS),
            staleBefore: new Date(at.getTime() - STALE_CLAIM_MS),
            limit: { total, perRecipient: RECIPIENT_CAP_EXEMPT.has(template) ? null : limits.perRecipient },
          });
        });
      } catch (err) {
        // The send log is the database: an outage there is an outcome, not a caller bug. Nothing was sent.
        logger.error({ err, template, locale }, MAIL_LOG_UNAVAILABLE);
        return { status: 'failed', reason: 'unavailable' };
      }
      if (claim.status === 'duplicate') return claim;
      if (claim.status === 'capped') {
        // The limit this mail met: recovery mail may use the reserve, everything else stops short of it.
        const fields = { scope: claim.scope, cap: claim.scope === 'global' ? total : limits.perRecipient, daily: limits.daily, reserve: limits.securityReserve, template, recovery };
        if (claim.scope === 'global') logger.error(fields, MAIL_CAP_REACHED);
        else logger.warn(fields, MAIL_CAP_REACHED);
        return claim;
      }

      let delivered: { id: string };
      try {
        delivered = await transport.deliver({ ...rendered, to, from: `${BRAND_NAME.en} <${options.fromAddress}>`, replyTo: options.replyTo, template, locale, idempotencyKey: keyDigest });
      } catch (err) {
        const failure = err instanceof MailTransportError ? err : new MailTransportError('unavailable', err instanceof Error ? err.message : String(err));
        // A timeout or a dropped connection may still have been accepted: it keeps counting toward the caps.
        const uncertain = failure.reason === 'timeout' || failure.reason === 'network';
        await finish(claim.id, { error: `${failure.reason}: ${failure.message}`, uncertain, at: now() });
        logger.error({ template, locale, reason: failure.reason, status: failure.status }, failure.reason === 'rate_limited' ? MAIL_PROVIDER_RATE_LIMITED : MAIL_PROVIDER_FAILED);
        return { status: 'failed', reason: failure.reason };
      }
      await finish(claim.id, { providerId: delivered.id, at: now() });
      logger.info({ template, locale, providerId: delivered.id, transport: transport.kind }, 'mail sent');
      return { status: 'sent', id: delivered.id };

      function refused(reason: 'INVALID_ADDRESS' | 'UNOWNED_DOMAIN'): SendResult {
        logger.warn({ template, reason }, 'mail refused');
        return { status: 'refused', reason };
      }
    },
  };

  /** Recording the outcome is bookkeeping: a failure here is logged, never reported as the provider's or thrown. */
  async function finish(id: string, outcome: Parameters<LedgerStore['email']['finishDelivery']>[1]): Promise<void> {
    try {
      await store.email.finishDelivery(id, outcome);
    } catch (err) {
      logger.error({ err, outcome: 'providerId' in outcome ? 'sent' : 'failed' }, MAIL_LOG_UNAVAILABLE);
    }
  }
}
