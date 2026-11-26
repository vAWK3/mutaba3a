import { normalizeEmail } from '../../../auth/users.js';
import type { Mailer, SendResult } from '../../../email/ports.js';
import type { Logger } from '../../../logger.js';
import { taxAuthorityPlanOf } from '../../../issuing/tax-authority-plan.js';
import type { LedgerStore, TaxAuthorityConnectionRecord, UserLocale } from '../../../repositories/ports.js';

/**
 * MUT-571 AC3: the Tax Authority's consent lasts 90 days, and only the business owner can give it again. Once a day
 * (Cloud Scheduler, `POST /jobs/v1/issuing/tax-authority-reminders`) each connection whose consent ends soon or just
 * ended is looked at, and the profile's owner is mailed in their language:
 *
 *   soon   from REMIND_DAYS_BEFORE days before the end until it   "ends within N days", Connect again
 *   ended  for ENDED_WINDOW_DAYS days after the end                "has ended", Connect again
 *
 * Each stage is sent once per consent through the send log (`tax-authority-reconnect:<profile>:<end>:<stage>`): a
 * retry, a second run the same day or the next day's run finds the key and sends nothing new, and a fresh consent has
 * a new end, so a new key. The windows (10 days, then 7) stay inside the send log's 30 days, so no key is pruned while
 * its stage could still come round: never more than two mails per consent. The portal's setup page says the same from
 * the status's `until` (RECONNECT_NOTICE_DAYS), with or without the mail.
 * MUT-736: a connection kept on a plan without it (Starter, `suspended`) is skipped (`plan`): there is nothing to renew
 * until the person is on a paid plan again.
 */
export const REMIND_DAYS_BEFORE = 10;
export const ENDED_WINDOW_DAYS = 7;
const DAY_MS = 86_400_000;

export type ReconnectStage = 'soon' | 'ended';
export type ReconnectSkip = 'other-environment' | 'no-refresh' | 'profile-gone' | 'plan' | 'owner-gone' | 'owner-inactive' | 'suppressed';

/** The stage due now for one consent's end, or null outside both windows. Pure. */
export function reconnectStageOf(until: Date, now: Date): { stage: 'soon'; daysLeft: number } | { stage: 'ended' } | null {
  const left = until.getTime() - now.getTime();
  if (left > REMIND_DAYS_BEFORE * DAY_MS) return null;
  if (left > 0) return { stage: 'soon', daysLeft: Math.max(1, Math.ceil(left / DAY_MS)) };
  if (-left < ENDED_WINDOW_DAYS * DAY_MS) return { stage: 'ended' };
  return null;
}

/** The send log's key: one per profile, consent end and stage. */
export const reconnectKey = (connection: Pick<TaxAuthorityConnectionRecord, 'organizationId'>, until: Date, stage: ReconnectStage) => `tax-authority-reconnect:${connection.organizationId}:${until.toISOString()}:${stage}`;

export interface ReconnectReminderRow {
  organizationId: string;
  stage: ReconnectStage | null;
  action: 'send' | 'skip';
  skip: ReconnectSkip | null;
  /** The mailer's answer, or `failed` when a read or the mailer threw; null on a skip or a dry run. */
  outcome: SendResult['status'] | null;
}

export interface ReconnectReminderSummary {
  dryRun: boolean;
  checked: number;
  due: number;
  sent: number;
  duplicate: number;
  notSent: number;
  skipped: number;
}

export interface ReconnectReminderOptions {
  /** The unguarded store: a job, not a principal's request. */
  store: Pick<LedgerStore, 'issuing' | 'organizations' | 'users' | 'email' | 'billing' | 'memberships' | 'integrations'>;
  mailer: Mailer;
  logger: Logger;
  now: Date;
  /** The Tax Authority environment this server talks to: a connection made against the other one is not this server's to remind. */
  environment: string;
  /** The portal's origin, no trailing slash; the mail links to `{origin}/p/{profile}/you/invoicing`. */
  portalOrigin: string;
  dryRun: boolean;
}

export async function runReconnectReminders(options: ReconnectReminderOptions): Promise<{ summary: ReconnectReminderSummary; rows: ReconnectReminderRow[] }> {
  const { store, now, dryRun } = options;
  const connections = await store.issuing.taxConnectionsEndingBetween(new Date(now.getTime() - ENDED_WINDOW_DAYS * DAY_MS), new Date(now.getTime() + REMIND_DAYS_BEFORE * DAY_MS + 1));
  const rows: ReconnectReminderRow[] = [];
  for (const connection of connections) {
    const until = connection.refreshExpiresAt;
    const due = until ? reconnectStageOf(until, now) : null;
    if (!until || !due) continue;
    const row: ReconnectReminderRow = { organizationId: connection.organizationId, stage: due.stage, action: 'skip', skip: null, outcome: null };
    try {
      const target = await recipientOf(options, connection);
      if ('skip' in target) row.skip = target.skip;
      else {
        row.action = 'send';
        if (!dryRun) {
          const vars = { stage: due.stage, daysLeft: due.stage === 'soon' ? due.daysLeft : 0, profileName: target.profileName, link: `${options.portalOrigin}/p/${connection.organizationId}/you/invoicing` };
          row.outcome = (await options.mailer.send({ to: target.email, locale: target.locale, template: 'tax-authority-reconnect', vars, idempotencyKey: reconnectKey(connection, until, due.stage) })).status;
        }
      }
    } catch (err) {
      // One profile's failure costs only its mail; the next day's run tries again (its key was never claimed).
      options.logger.error({ err, organizationId: connection.organizationId }, 'Tax Authority reconnect reminder failed for one profile; the next run tries again');
      row.action = 'send';
      row.skip = null;
      row.outcome = 'failed';
    }
    rows.push(row);
  }
  const summary = summarize(rows, dryRun);
  options.logger.info({ taxAuthorityReminders: summary }, dryRun ? 'Tax Authority reconnect reminders dry run' : 'Tax Authority reconnect reminders run');
  return { summary, rows };
}

/** The profile's owner (the person who connected, on a profile with no owner of record), or why no one is mailed. */
async function recipientOf(
  options: ReconnectReminderOptions,
  connection: TaxAuthorityConnectionRecord,
): Promise<{ email: string; locale: UserLocale; profileName: string } | { skip: ReconnectSkip }> {
  if (connection.environment !== options.environment) return { skip: 'other-environment' };
  // A consent with no refresh token can't be extended anyway; it reads as ended once its access token lapses.
  if (connection.refreshTokenSealed === null) return { skip: 'no-refresh' };
  const profile = await options.store.organizations.getById(connection.organizationId);
  if (!profile) return { skip: 'profile-gone' };
  if (!(await taxAuthorityPlanOf(options.store, profile, options.now)).allowed) return { skip: 'plan' };
  const owner = await options.store.users.getById(profile.ownerUserId ?? connection.connectedByUserId);
  if (!owner) return { skip: 'owner-gone' };
  if (owner.status !== 'ACTIVE') return { skip: 'owner-inactive' };
  if (await options.store.email.isSuppressed(normalizeEmail(owner.email))) return { skip: 'suppressed' };
  return { email: owner.email, locale: owner.locale, profileName: profile.name };
}

function summarize(rows: readonly ReconnectReminderRow[], dryRun: boolean): ReconnectReminderSummary {
  const count = (pick: (r: ReconnectReminderRow) => boolean) => rows.filter(pick).length;
  return {
    dryRun,
    checked: rows.length,
    due: count((r) => r.action === 'send' && r.outcome !== 'failed'),
    sent: count((r) => r.outcome === 'sent'),
    duplicate: count((r) => r.outcome === 'duplicate'),
    notSent: count((r) => r.outcome !== null && r.outcome !== 'sent' && r.outcome !== 'duplicate'),
    skipped: count((r) => r.action === 'skip'),
  };
}
