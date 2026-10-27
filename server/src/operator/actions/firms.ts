import { ApiError } from '../../errors.js';
import { decodeCursor, encodeCursor, parseLimit } from '../../pagination.js';
import { profileOwnerOf } from '../../personal-profile.js';
import type { LedgerStore, Organization, SetFirmInput, SetFirmResult } from '../../repositories/ports.js';
import { auditActorIdOf, type ActionContext } from '../actor.js';

/**
 * MUT-300 and MUT-462 (ADR-212 D1, D9, E5): firm requests and the firm switch, as the operator acts on them. Shared
 * by /admin/v1 (the admin token: GET firm-requests, PATCH organizations/{id}, DELETE …/firm-request) and
 * /v1/operator/firm-requests (a signed-in operator). The store audits each write inside its own transaction; the
 * actor goes in with it, so the row carries the operator's id (the token's stays null).
 */
export interface FirmActionOptions {
  store: LedgerStore;
}

/** No pending request on this profile: a reason the console tells apart from a lost profile (design 3A). */
export function firmRequestNotFound(): ApiError {
  return new ApiError('NOT_FOUND', 'No pending firm request for this organization', { reason: 'FIRM_REQUEST_NOT_FOUND' });
}

/** The organization a firm-switch write left, or the refusal as the operator should read it. */
export function firmUpdated(result: SetFirmResult): Organization {
  switch (result.kind) {
    case 'updated':
      return result.organization;
    case 'not_found':
      throw new ApiError('NOT_FOUND', 'Organization not found');
    case 'personal_profile':
      throw new ApiError('CONFLICT', 'A built-in personal profile never gets firm features', { reason: 'PERSONAL_PROFILE' });
    case 'not_business':
      throw new ApiError('CONFLICT', 'Firm features are for Business profiles; this one is typed Personal', { reason: 'NOT_BUSINESS' });
    case 'owners_required':
      throw new ApiError('VALIDATION_FAILED', 'Name at least one owner (ownerUserIds) when enabling firm features on an operator firm', { field: 'ownerUserIds' });
    case 'not_a_member':
      throw new ApiError('CONFLICT', 'Every owner must already be a member of the organization', { reason: 'NOT_A_MEMBER', userIds: result.userIds });
  }
}

const pending = (organization: Organization | null): organization is Organization => organization !== null && organization.firmRequestedAt !== null && organization.firmEnabledAt === null;

export function firmActions({ store }: FirmActionOptions) {
  const auditOf = (ctx: ActionContext) => ({ actorId: auditActorIdOf(ctx.actor), requestId: ctx.requestId });

  /** One pending request as the operator lists it. */
  async function requestOf(o: Organization) {
    return {
      organizationId: o.id,
      name: o.name,
      requestedAt: o.firmRequestedAt!.toISOString(),
      requestedByUserId: o.firmRequestedByUserId!,
      requestedByEmail: (await store.users.getById(o.firmRequestedByUserId!))?.email ?? null,
      owned: profileOwnerOf(o) !== null,
    };
  }

  /** Pending requests, oldest first. */
  async function list(query: { limit?: number | undefined; cursor?: string | undefined }) {
    const page = await store.organizations.listFirmRequests({ limit: parseLimit(query.limit), cursor: query.cursor ? decodeCursor(query.cursor) : null });
    return { data: await Promise.all(page.items.map(requestOf)), nextCursor: page.nextCursor ? encodeCursor(page.nextCursor) : null };
  }

  async function mustBePending(organizationId: string): Promise<Organization> {
    const organization = await store.organizations.getById(organizationId);
    if (!pending(organization)) throw firmRequestNotFound();
    return organization;
  }

  /**
   * O7: one pending request with the people the operator may name as owners. Organizations have a handful of members;
   * one read each.
   */
  async function detail(organizationId: string) {
    const organization = await mustBePending(organizationId);
    const memberships = await store.memberships.listByOrganization(organization.id);
    const members = (
      await Promise.all(
        memberships.map(async (m) => {
          const user = await store.users.getById(m.userId);
          return user ? { userId: user.id, email: user.email, displayName: user.displayName, role: m.role, status: user.status } : null;
        }),
      )
    ).filter((m) => m !== null);
    return { request: await requestOf(organization), members };
  }

  /** The firm switch, on or off, as /admin/v1/organizations/{id} has it. The same state again changes nothing. */
  async function setFirm(organizationId: string, input: SetFirmInput, ctx: ActionContext): Promise<Organization> {
    return firmUpdated(await store.organizations.setFirm(organizationId, input, ctx.at, auditOf(ctx)));
  }

  /** The console's Enable: only while the request is still pending (a request declined meanwhile is gone). */
  async function enableRequest(organizationId: string, ownerUserIds: string[], ctx: ActionContext): Promise<Organization> {
    await mustBePending(organizationId);
    return setFirm(organizationId, { enabled: true, ownerUserIds }, ctx);
  }

  /** Clears the request (MUT-300 D6); the owner sees the offer again and may ask again. */
  async function decline(organizationId: string, ctx: ActionContext): Promise<Organization> {
    const result = await store.organizations.declineFirmRequest(organizationId, ctx.at, auditOf(ctx));
    if (result.kind === 'not_found') throw firmRequestNotFound();
    return result.organization;
  }

  return { list, detail, setFirm, enableRequest, decline };
}
