import { viewTouch } from '../access/view-touch.js';
import { sessionDigest } from '../auth/sessions.js';
import { profileOwnerOf } from '../personal-profile.js';
import type { LedgerStore, Organization, ShareLinkRecord, ShareLinkViewerRecord } from '../repositories/ports.js';
import { isLiveLink, shareLinkUnavailable, shareViewExpired } from './links.js';
import type { ShareLinkRange } from './period.js';

/**
 * MUT-560 (ADR-247): the one door to a share link's data. Every view route calls it, and so will MUT-314's download:
 * a viewer token in, the viewer, its link, the profile and the frozen money-date range out, or the one refusal.
 *
 * `store` is the base store (beneath any guard): the lookups and the hourly stamps are the link's own bookkeeping, as
 * authenticate() reads sessions. The caller reads the profile's records through the guarded store, under
 * shareLinkStoreGuard, bounded by `range` (period.ts feedBoundsOf / isInRange). Nothing here is cached.
 */
export interface ShareLinkAccess {
  link: ShareLinkRecord;
  viewer: ShareLinkViewerRecord;
  organization: Organization;
  range: ShareLinkRange;
}

type AccessStore = Pick<LedgerStore, 'shareLinks' | 'organizations' | 'users'>;

/**
 * Throws the uniform 404 (SHARE_LINK_UNAVAILABLE) when the viewer token is unknown, or its link is revoked, expired or
 * locked (a lock also ends viewers already in, A6), or the profile is gone, or the profile owner's account is closing
 * (MUT-333). Throws 401 SHARE_VIEW_EXPIRED only for a known viewer of a usable link whose 8 hours have passed.
 */
export async function shareLinkAccess(store: AccessStore, pepper: string, viewerToken: string, now: Date): Promise<ShareLinkAccess> {
  const found = await store.shareLinks.findViewerByDigest(sessionDigest(pepper, viewerToken));
  if (!found) throw shareLinkUnavailable();
  const { link, viewer } = found;
  if (link.lockedAt !== null) throw shareLinkUnavailable();
  const organization = await openLinkProfile(store, link, now);
  if (viewer.accessExpiresAt <= now) throw shareViewExpired();
  await touchViews(store, link, viewer, now);
  return { link, viewer, organization, range: { from: link.periodFrom, to: link.periodTo } };
}

/**
 * The profile behind a link that is live (unrevoked, unexpired) and whose owner isn't closing their account; else the
 * uniform 404. A locked link is the caller's to judge: check and unlock answer LOCKED, the view routes 404.
 */
export async function openLinkProfile(store: Pick<LedgerStore, 'organizations' | 'users'>, link: ShareLinkRecord, now: Date): Promise<Organization> {
  if (!isLiveLink(link, now)) throw shareLinkUnavailable();
  const organization = await store.organizations.getById(link.organizationId);
  if (!organization) throw shareLinkUnavailable();
  const ownerId = profileOwnerOf(organization);
  const owner = ownerId ? await store.users.getById(ownerId) : null;
  if (owner?.closure) throw shareLinkUnavailable();
  return organization;
}

/** `lastViewedAt` and `lastOpenedAt` at most once an hour each (the accountant grant's throttle). */
async function touchViews(store: AccessStore, link: ShareLinkRecord, viewer: ShareLinkViewerRecord, now: Date): Promise<void> {
  if (viewTouch(viewer.lastViewedAt, now).touch) await store.shareLinks.touchViewer({ viewerId: viewer.id, at: now });
  if (viewTouch(link.lastOpenedAt, now).touch) await store.shareLinks.touchOpened({ linkId: link.id, at: now });
}
