import { ApiError } from '../../errors.js';
import type { LedgerStore } from '../../repositories/ports.js';
import { auditActorIdOf, type ActionContext } from '../actor.js';

/**
 * MUT-593 (ADR-254 D10): the operator's per-firm switch for Malafat acting as each person. Only a profile Malafat
 * feeds (a CONNECTED integration) has one. Off ends every delegated grant for the firm's tenant in the same
 * transaction, so switching it on again revives nothing; each person reconnects from Malafat.
 */
export function malafatDelegationActions({ store }: { store: LedgerStore }) {
  async function set(organizationId: string, enabled: boolean, ctx: ActionContext) {
    const integration = await store.integrations.findByOrganizationAndProvider(organizationId, 'MALAFAT');
    if (!integration || integration.status !== 'CONNECTED') {
      if (!(await store.organizations.getById(organizationId))) throw new ApiError('NOT_FOUND', 'No such organization');
      throw new ApiError('CONFLICT', 'Only a profile Malafat feeds can let Malafat act for its members', { reason: 'NOT_MALAFAT_FED' });
    }
    const actorId = auditActorIdOf(ctx.actor);
    const result = await store.integrations.setDelegation({
      id: integration.id,
      enabled,
      by: actorId,
      at: ctx.at,
      audit: [
        {
          organizationId,
          actorType: 'ADMIN',
          actorId,
          action: enabled ? 'organization.malafat_delegation_enabled' : 'organization.malafat_delegation_disabled',
          entityType: 'organization',
          entityId: organizationId,
          metadata: { tenantId: integration.externalTenantId },
          requestId: ctx.requestId,
        },
      ],
    });
    if (!result) throw new ApiError('NOT_FOUND', 'No such organization');
    return {
      organizationId,
      tenantId: result.integration.externalTenantId,
      delegationEnabledAt: result.integration.delegationEnabledAt?.toISOString() ?? null,
      grantsRevoked: result.grantsRevoked,
    };
  }

  return { set };
}
