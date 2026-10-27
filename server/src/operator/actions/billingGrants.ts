import { randomUUID } from 'node:crypto';
import { ApiError } from '../../errors.js';
import { ownedProfilesOf } from '../../personal-profile.js';
import { ForeignKeyViolation } from '../../repositories/memory.js';
import type { AuditEventInput, EntitlementGrantRecord, JsonObject, LedgerStore } from '../../repositories/ports.js';
import { auditActorIdOf, byLabelOf, type ActionContext } from '../actor.js';

/**
 * MUT-358 (ADR-160) and MUT-462 (ADR-212 D1, D9): the operator's billing grants — cover a person's own profiles or one
 * profile, then revoke. Shared by /admin/v1/billing/grants (the admin token, `users.ts billing:grant`) and
 * /v1/operator/accounts/{userId}/billing-grants (a signed-in operator), so both do the same thing; only the audit
 * row's actorId and `grantedBy` differ (actor.ts). Every change is audited on each profile it reaches, in the write's
 * own transaction.
 */
export interface BillingGrantActionOptions {
  store: LedgerStore;
}

/** The token's `grantedBy`, as MUT-358 always wrote it. */
const TOKEN_GRANTED_BY = 'admin';

export type GrantTarget = { userId: string; organizationId: null } | { userId: null; organizationId: string };

export interface CreateGrantInput {
  target: GrantTarget;
  tier: EntitlementGrantRecord['tier'];
  reason: string;
  expiresAt?: string | undefined;
}

/** An expiry must lie ahead; checked before anything is looked up, as the admin route always did (422 before 404). */
export function assertFutureExpiry(expiresAt: string | undefined, at: Date): Date | null {
  const date = expiresAt ? new Date(expiresAt) : null;
  if (date && date <= at) throw new ApiError('VALIDATION_FAILED', 'expiresAt must be in the future', { field: 'expiresAt' });
  return date;
}

export function grantNotFound(): ApiError {
  return new ApiError('NOT_FOUND', 'Grant not found');
}

export function billingGrantActions({ store }: BillingGrantActionOptions) {
  /** One audit row per profile the grant reaches: the person's own profiles, or the one profile. */
  async function auditOn(target: { userId: string | null; organizationId: string | null }, ctx: ActionContext, action: string, grantId: string, metadata: JsonObject): Promise<AuditEventInput[]> {
    const organizationIds = target.organizationId ? [target.organizationId] : (await ownedProfilesOf(store, target.userId!)).map((o) => o.id);
    return organizationIds.map((organizationId) => ({
      organizationId,
      actorType: 'ADMIN',
      actorId: auditActorIdOf(ctx.actor),
      action,
      entityType: 'entitlement_grant',
      entityId: grantId,
      metadata,
      requestId: ctx.requestId,
    }));
  }

  async function create(input: CreateGrantInput, ctx: ActionContext): Promise<EntitlementGrantRecord> {
    const expiresAt = assertFutureExpiry(input.expiresAt, ctx.at);
    if (input.target.organizationId && !(await store.organizations.getById(input.target.organizationId))) throw new ApiError('NOT_FOUND', 'Organization not found');
    const id = randomUUID();
    const metadata: JsonObject = { ...input.target, tier: input.tier, reason: input.reason, expiresAt: expiresAt?.toISOString() ?? null };
    const audit = await auditOn(input.target, ctx, 'billing.grant_created', id, metadata);
    try {
      return await store.billing.createGrant({ id, ...input.target, tier: input.tier, reason: input.reason, expiresAt, grantedBy: byLabelOf(ctx.actor, TOKEN_GRANTED_BY), at: ctx.at, audit });
    } catch (err) {
      if (err instanceof ForeignKeyViolation) throw new ApiError('NOT_FOUND', 'User or organization not found');
      throw err;
    }
  }

  /**
   * Revoking keeps the grant, with revokedAt set; a second revoke changes nothing. `owner`, when given, is the person
   * the grant must cover (the console revokes from an account's page): another person's grant is NOT_FOUND.
   */
  async function revoke(grantId: string, ctx: ActionContext, owner?: { userId: string }) {
    const existing = await store.billing.getGrant(grantId);
    if (!existing || (owner && existing.userId !== owner.userId)) throw grantNotFound();
    const metadata: JsonObject = { userId: existing.userId, organizationId: existing.organizationId, tier: existing.tier, reason: existing.reason };
    const audit = await auditOn(existing, ctx, 'billing.grant_revoked', grantId, metadata);
    const result = await store.billing.revokeGrant(grantId, ctx.at, audit);
    if (!result) throw grantNotFound();
    return result;
  }

  return { create, revoke };
}
