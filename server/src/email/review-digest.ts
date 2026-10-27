import type { Logger } from '../logger.js';
import type { LedgerStore } from '../repositories/ports.js';
import type { Mailer, SendResult } from './ports.js';

/**
 * MUT-367 (ADR-159 §7a, D13, D27): the operator's "signups are waiting" mail, to OPERATOR_ALERT_EMAIL.
 *
 * `announce()` runs after each PENDING_REVIEW redeem and from an hourly sweep a few minutes past each UTC hour. It
 * mails only when some open review hasn't been counted by a digest yet, says how many are open in all, and keys the
 * send on the UTC hour, so at most one digest goes out an hour. A review is stamped `notifiedAt` only once a digest
 * that counted it was actually sent: a failed, capped or same-hour send leaves it for the next sweep. A quiet queue
 * sends nothing.
 */
export const REVIEW_COMMAND = 'npm --prefix server run signups:review';
/** MUT-460: the portal page the digest links to, under PORTAL_ORIGIN. */
export const REVIEW_PAGE_PATH = '/operator/signups';
/** The sweep runs this long after each UTC hour, so a review is announced within about an hour (D27). */
export const DIGEST_SWEEP_OFFSET_MS = 5 * 60_000;
const HOUR_MS = 3_600_000;

export interface ReviewDigest {
  /** Never throws; the outcome is for tests and logs. `idle` = nothing new to announce, or no operator address. */
  announce(): Promise<SendResult['status'] | 'idle'>;
}

export interface ReviewDigestOptions {
  /** The unguarded store: server bookkeeping, like the mailer's send log. */
  store: Pick<LedgerStore, 'signupReviews'>;
  mailer: Mailer;
  logger: Logger;
  now: () => Date;
  /** OPERATOR_ALERT_EMAIL; null = no digest (boot warns). */
  to: string | null;
  /** MUT-460: the portal's operator signups page; null (no PORTAL_ORIGIN) = the mail names only the command. */
  reviewLink?: string | null;
}

export function createReviewDigest(options: ReviewDigestOptions): ReviewDigest {
  const { store, mailer, logger, now, to } = options;
  const reviewLink = options.reviewLink ?? null;
  let running: Promise<SendResult['status'] | 'idle'> | null = null;

  async function run(): Promise<SendResult['status'] | 'idle'> {
    if (!to) return 'idle';
    const facts = await store.signupReviews.digestFacts();
    if (facts.unannounced.length === 0) return 'idle';
    const at = now();
    const hour = at.toISOString().slice(0, 13);
    const result = await mailer.send({ to, template: 'review-digest', locale: 'en', vars: { pending: facts.pending, command: REVIEW_COMMAND, reviewLink }, idempotencyKey: `review-digest:${hour}` });
    if (result.status === 'sent') await store.signupReviews.markNotified(facts.unannounced, at);
    else if (result.status !== 'duplicate') logger.warn({ outcome: result.status, pending: facts.pending }, 'signup review digest not sent; the next sweep tries again');
    return result.status;
  }

  return {
    announce() {
      // One at a time: a redeem and the sweep landing together must not both count the same reviews.
      running ??= run()
        .catch((err: unknown) => {
          logger.error({ err }, 'signup review digest failed');
          return 'idle' as const;
        })
        .finally(() => {
          running = null;
        });
      return running;
    },
  };
}

/** Milliseconds from `now` to the next sweep: `DIGEST_SWEEP_OFFSET_MS` past the next UTC hour (or this one's, if still ahead). */
export function msUntilNextSweep(now: Date): number {
  const sinceHour = now.getTime() % HOUR_MS;
  return sinceHour < DIGEST_SWEEP_OFFSET_MS ? DIGEST_SWEEP_OFFSET_MS - sinceHour : HOUR_MS - sinceHour + DIGEST_SWEEP_OFFSET_MS;
}
