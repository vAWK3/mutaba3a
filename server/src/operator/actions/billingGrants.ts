import { randomUUID } from 'node:crypto';
import { isPilotCohort, pilotExpiryOf } from '../../billing/pilot.js';
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
  /** MUT-752 (ADR-296): makes it a pilot grant: a person's, not ACCOUNTANT, ending on `expiresAt` or in 60 days. */
  cohort?: string | undefined;
  /** MUT-752: the accountant who referred the tester; only with `cohort`. */
  referredByUserId?: string | undefined;
  /** MUT-777 (ADR-333): the tester's yes to watched sessions, given when they joined; only with `cohort`. */
  watchConsent?: boolean | undefined;
}

/** MUT-752: the pilot fields checked, and the expiry a pilot gets (60 days unless given). 422 before anything is looked up. */
function pilotFieldsOf(input: CreateGrantInput, expiresAt: Date | null, at: Date): { cohort: string | null; referredByUserId: string | null; expiresAt: Date | null } {
  const { cohort, referredByUserId } = input;
  if (cohort === undefined) {
    if (referredByUserId !== undefined) throw new ApiError('VALIDATION_FAILED', 'A referring accountant is named only on a pilot grant (give cohort)', { field: 'referredByUserId', reason: 'REFERRAL_NEEDS_PILOT' });
    if (input.watchConsent === true) throw new ApiError('VALIDATION_FAILED', 'A yes to watched sessions is recorded only on a pilot grant (give cohort)', { field: 'watchConsent', reason: 'CONSENT_NEEDS_PILOT' });
    return { cohort: null, referredByUserId: null, expiresAt };
  }
  if (!isPilotCohort(cohort)) throw new ApiError('VALIDATION_FAILED', 'cohort is a lowercase slug: a-z, 0-9, dot, dash or underscore, at most 64', { field: 'cohort' });
  if (input.tier === 'ACCOUNTANT') throw new ApiError('VALIDATION_FAILED', 'A pilot grant is a profile plan, never the Accountant plan', { field: 'tier', reason: 'PILOT_NOT_ACCOUNTANT' });
  if (input.target.organizationId) throw new ApiError('VALIDATION_FAILED', 'A pilot grant names a person, never a profile', { field: 'organizationId', reason: 'PILOT_PERSON_ONLY' });
  if (referredByUserId !== undefined && referredByUserId === input.target.userId) throw new ApiError('VALIDATION_FAILED', 'A tester cannot be their own referring accountant', { field: 'referredByUserId' });
  return { cohort, referredByUserId: referredByUserId ?? null, expiresAt: pilotExpiryOf(expiresAt, at) };
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
    const pilot = pilotFieldsOf(input, assertFutureExpiry(input.expiresAt, ctx.at), ctx.at);
    const { expiresAt } = pilot;
    // MUT-565 (ADR-251, P9): the Accountant plan is a person's (client books); a profile can't hold it (DB CHECK too).
    if (input.tier === 'ACCOUNTANT' && input.target.organizationId) throw new ApiError('VALIDATION_FAILED', 'An Accountant plan grant names a person, never a profile', { field: 'organizationId', reason: 'ACCOUNTANT_PERSON_ONLY' });
    if (input.target.organizationId && !(await store.organizations.getById(input.target.organizationId))) throw new ApiError('NOT_FOUND', 'Organization not found');
    if (pilot.referredByUserId && !(await store.users.getById(pilot.referredByUserId))) throw new ApiError('NOT_FOUND', 'Referring accountant not found');
    const id = randomUUID();
    const metadata: JsonObject = {
      ...input.target,
      tier: input.tier,
      reason: input.reason,
      expiresAt: expiresAt?.toISOString() ?? null,
      ...(pilot.cohort !== null ? { cohort: pilot.cohort, referredByUserId: pilot.referredByUserId } : {}),
      ...(pilot.cohort !== null && input.watchConsent === true ? { watchConsent: true } : {}),
    };
    const audit = await auditOn(input.target, ctx, 'billing.grant_created', id, metadata);
    try {
      const grant = await store.billing.createGrant({ id, ...input.target, tier: input.tier, reason: input.reason, expiresAt, cohort: pilot.cohort, referredByUserId: pilot.referredByUserId, grantedBy: byLabelOf(ctx.actor, TOKEN_GRANTED_BY), at: ctx.at, audit });
      // MUT-777 (ADR-333): the tester's yes, given when they joined, recorded on the person (the grant's audit row says so).
      if (pilot.cohort !== null && input.watchConsent === true && input.target.userId) await store.billing.markPilotWatchConsent(input.target.userId, ctx.at);
      return grant;
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
    const metadata: JsonObject = { userId: existing.userId, organizationId: existing.organizationId, tier: existing.tier, reason: existing.reason, ...(existing.cohort !== null ? { cohort: existing.cohort } : {}) };
    const audit = await auditOn(existing, ctx, 'billing.grant_revoked', grantId, metadata);
    const result = await store.billing.revokeGrant(grantId, ctx.at, audit);
    if (!result) throw grantNotFound();
    return result;
  }

  return { create, revoke };
}
