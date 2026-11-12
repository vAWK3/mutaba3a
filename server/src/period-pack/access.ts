import { delegatedFirm } from '../auth/delegation.js';
import { assertClientReadable, resolveProfileAccess } from '../auth/middleware.js';
import { isLive } from '../oauth/service.js';
import type { AccountantPlanConfig } from '../billing/accountant-plan.js';
import { ApiError } from '../errors.js';
import type { LedgerStore, Organization } from '../repositories/ports.js';
import { shareLinkAccess } from '../share-links/access.js';
import type { TicketClaims } from './ticket.js';

/**
 * MUT-314 (ADR-248, D5, D6): a ticket proves who minted it and for what, not that they may still read. At stream time
 * each kind's access is checked again, the same way its mint checked it:
 * - member and accountant: the session that minted the ticket still works (not signed out, revoked or expired), or
 *   (MUT-593) the delegated grant that minted it is live and its tenant's firm is still the ticket's profile;
 *   resolveProfileAccess (the rule selectProfile applies to every request: for an accountant an ACTIVE grant on a
 *   profile whose owner isn't closing, MUT-575), of the same kind, for a person still ACTIVE and not closing their
 *   account (a closing account reaches no profile, MUT-333);
 * - link: shareLinkAccess on the viewer token the body carries (MUT-560's one door), whose viewer, profile and frozen
 *   range must be the ticket's.
 * Anything else is the uniform 404: a forged, expired, revoked or someone else's ticket all look the same.
 */
export function downloadUnavailable(): ApiError {
  return new ApiError('NOT_FOUND', 'This download is no longer available; start it again', { reason: 'DOWNLOAD_UNAVAILABLE' });
}

export interface RecheckContext {
  /** The base store: the access lookups and the link's stamps are bookkeeping, as authenticate() reads sessions. */
  store: LedgerStore;
  pepper: string;
  accountantAccess: boolean;
  /** MUT-565 (ACCOUNTANT_PLAN): the client-books cap; absent or off = no cap. */
  accountantPlan?: AccountantPlanConfig;
  viewerToken: string | null;
  now: Date;
}

export async function recheckAccess(claims: TicketClaims, ctx: RecheckContext): Promise<{ organization: Organization; shareLinkId: string | null }> {
  if (claims.kind === 'link') {
    if (!ctx.viewerToken) throw downloadUnavailable();
    const access = await shareLinkAccess(ctx.store, ctx.pepper, ctx.viewerToken, ctx.now).catch(() => null);
    if (!access || access.viewer.id !== claims.sub || access.organization.id !== claims.org) throw downloadUnavailable();
    if (access.range.from !== claims.from || access.range.to !== claims.to) throw downloadUnavailable();
    return { organization: access.organization, shareLinkId: access.link.id };
  }
  // Review (MUT-314): bound to the session (MUT-593: or delegated grant) that minted it: ended since, the ticket dies too.
  if (!(await minterStillLive(claims, ctx))) throw downloadUnavailable();
  const user = await ctx.store.users.getById(claims.sub);
  if (!user || user.status !== 'ACTIVE' || user.closure) throw downloadUnavailable();
  const access = await resolveProfileAccess(ctx.store, claims.sub, claims.org, { accountantAccess: ctx.accountantAccess });
  if (!access || access.access !== claims.kind) throw downloadUnavailable();
  // MUT-565 (ADR-251): a ticket minted before a lapse for a client past the readable ones dies here, as the uniform 404.
  if (access.access === 'accountant') {
    try {
      await assertClientReadable(ctx.store, ctx.accountantPlan, access.grant, claims.sub, ctx.now);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'ACCOUNTANT_PLAN_REQUIRED') throw downloadUnavailable();
      throw err;
    }
  }
  return { organization: access.organization, shareLinkId: null };
}

async function minterStillLive(claims: TicketClaims, ctx: RecheckContext): Promise<boolean> {
  if (claims.gid) {
    const grant = await ctx.store.oauth.findGrant(claims.gid);
    if (!grant?.tenantId || grant.userId !== claims.sub || !isLive(grant, ctx.now)) return false;
    return (await delegatedFirm(ctx.store, grant.tenantId))?.organizationId === claims.org;
  }
  const session = claims.sid ? await ctx.store.sessions.getById(claims.sid) : null;
  return Boolean(session && session.userId === claims.sub && !session.revokedAt && session.idleExpiresAt > ctx.now && session.absoluteExpiresAt > ctx.now);
}
