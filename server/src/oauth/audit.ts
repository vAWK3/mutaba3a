import type { LedgerStore } from '../repositories/ports.js';
import type { AuditFor } from './service.js';

/** MUT-434 audit actions, hidden from API keys on /v1/audit (SESSION_ONLY_ACTIONS). */
export const AGENT_CONNECTED = 'user.agent_connected';
export const AGENT_DISCONNECTED = 'user.agent_disconnected';

/**
 * Agent connects and disconnects are person-level events, written on every profile the person belongs to, as MUT-433
 * writes `user.feature_*` (its review D4). A person with no memberships gets no rows; the caller logs instead.
 */
export function agentAuditFor(store: Pick<LedgerStore, 'memberships'>): AuditFor {
  return async ({ userId, action, metadata, actor, requestId }) => {
    const memberships = await store.memberships.listByUser(userId);
    return memberships.map((m) => ({
      organizationId: m.organizationId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      action,
      entityType: 'user',
      entityId: userId,
      metadata,
      requestId,
    }));
  };
}
