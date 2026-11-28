import type { Logger } from '../logger.js';
import type { LedgerStore, UserLocale } from '../repositories/ports.js';
import { renderPush } from './messages.js';
import type { PushOutcome, PushRequest, PushSender } from './ports.js';

/**
 * MUT-780 (ADR-352): the one way a feature pushes a person. It reads the person's devices whose session is live,
 * words the push in their locale, sends to each, drops the tokens the platform says are gone, and never throws: a push
 * is a nudge, never part of the job that asked for it. MUT-782's reminders call `notifyUser` with their own kind.
 */
export interface PushSummary {
  sent: number;
  failed: number;
  removed: number;
}

export interface PushService {
  /** True when a sender is configured; features may skip building a push when it is not. */
  readonly enabled: boolean;
  notifyUser(userId: string, request: PushRequest, now: Date): Promise<PushSummary>;
}

const NONE: PushSummary = { sent: 0, failed: 0, removed: 0 };

export const DISABLED_PUSH: PushService = { enabled: false, notifyUser: async () => ({ ...NONE }) };

export function createPushService(deps: { store: LedgerStore; sender: PushSender; logger: Pick<Logger, 'warn'> }): PushService {
  const { store, sender, logger } = deps;
  return {
    enabled: true,
    async notifyUser(userId, request, now) {
      const summary: PushSummary = { ...NONE };
      try {
        const [user, devices] = await Promise.all([store.users.getById(userId), store.pushDevices.listLive(userId, now)]);
        if (!user || user.status !== 'ACTIVE' || devices.length === 0) return summary;
        const { title, body } = renderPush(request.kind, request.vars, user.locale as UserLocale);
        const data = { ...request.data, kind: request.kind };
        const gone: string[] = [];
        for (const device of devices) {
          let outcome: PushOutcome;
          try {
            outcome = await sender.send({ platform: device.platform, token: device.token, title, body, data });
          } catch (err) {
            logger.warn({ err, event: 'push_send_threw' }, 'push not sent');
            outcome = 'failed';
          }
          if (outcome === 'sent') summary.sent += 1;
          else if (outcome === 'invalid_token') gone.push(device.id);
          else summary.failed += 1;
        }
        if (gone.length > 0) summary.removed = await store.pushDevices.removeByIds(gone);
      } catch (err) {
        logger.warn({ err, event: 'push_failed' }, 'push not sent');
        summary.failed += 1;
      }
      return summary;
    },
  };
}
