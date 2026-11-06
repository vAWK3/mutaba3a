import { useState } from 'react';
import { Link, Navigate, useNavigate } from '@tanstack/react-router';
import { Button } from '../../../components/ui/Button';
import { useLanguage } from '../../../lib/i18n/core';
import type { AccountantGrant, HostedProfile } from '../../api/client';
import { trackPortal } from '../../analytics/portalAnalytics';
import { AccessScopeList } from '../../components/AccessScopeList';
import { Scene } from '../../components/Scene';
import { useToast } from '../../components/Toast';
import { useAccountants, useInviteAccountant } from '../../data/sharingQueries';
import { useMe, useWritableFor } from '../../session/me';
import { useIsLocalMode } from '../../session/mode';
import { youPath } from '../../shell/youRoutes';
import { AccountantsColumn } from './AccountantsColumn';
import { InviteAccountantDrawer } from './InviteAccountantDrawer';
import { inviteErrorOf, sharingOpen, type SharingSearch } from './sharingRules';

/**
 * MUT-561 (layout B, Basel 13236): one profile's Sharing page, `/p/$profileId/you/sharing`. Two columns, Accountants
 * and Links with a PIN (one column at 375 px); Invite opens the side drawer by its URL key (`?invite=true`, Basel
 * 13244). Only an owner of the profile, signed in, on a server with accountant access gets it (D8); anyone else goes
 * back to You › Profiles. Nothing shared yet: the empty page (B5).
 *
 * Slice A: the Links column (MUT-560's share links) isn't built yet, so the page runs as a server with SHARE_LINKS off
 * does: Accountants alone, full width, and the empty page offers Invite only.
 */

/** TODO(blocked-by MUT-560): the Links column decides this from GET …/share-links (a 404 is off). */
const LINKS_ON = false;

export function SharingPage({ profile, search }: { profile: HostedProfile; search: SharingSearch }) {
  const me = useMe();
  const local = useIsLocalMode();
  if (!sharingOpen(me, profile, local)) return <Navigate to={youPath(profile.id, 'profiles')} replace />;
  return <SharingBody profile={profile} inviteOpen={search.invite === true} />;
}

function SharingBody({ profile, inviteOpen }: { profile: HostedProfile; inviteOpen: boolean }) {
  const { t, language } = useLanguage();
  const navigate = useNavigate();
  const showToast = useToast();
  const writable = useWritableFor(profile);
  const accountants = useAccountants(profile.id);
  const reinvite = useInviteAccountant(profile.id);
  const [flashId, setFlashId] = useState<string | null>(null);
  const [reinviting, setReinviting] = useState<string | null>(null);

  const setInvite = (open: boolean) =>
    void navigate({ to: '.', search: (prev: Record<string, unknown>) => ({ ...prev, invite: open ? true : undefined }), replace: !open } as never);

  const invited = (grant: AccountantGrant) => {
    setFlashId(grant.id);
    setInvite(false);
    showToast(t('hosted.sharing.invite.sent', { email: grant.email }), { tone: 'info' });
  };

  /** Invite again (no confirm, D7): the same address, a fresh invite; the server replaces the expired one. */
  const inviteAgain = async (grant: AccountantGrant) => {
    if (reinviting) return;
    setReinviting(grant.id);
    try {
      const fresh = await reinvite.mutateAsync({ email: grant.email, locale: language });
      void trackPortal('accountant_invited', {});
      setFlashId(fresh.id);
      showToast(t('hosted.sharing.invite.sent', { email: fresh.email }), { tone: 'info' });
    } catch (error) {
      const mapped = inviteErrorOf(error, grant.email);
      const line = mapped.banner ?? { key: mapped.field ?? 'hosted.sharing.invite.errors.unreachable' };
      showToast(t(line.key, line.vars));
    } finally {
      setReinviting(null);
    }
  };

  const empty = !LINKS_ON && accountants.data !== undefined && !accountants.isError && accountants.data.items.length === 0;

  return (
    <div className="hp-sharing">
      <Link className="hp-link hp-sharing-back" to={youPath(profile.id, 'profiles')}>
        <span className="hp-sharing-back-arrow" aria-hidden="true">
          ‹
        </span>{' '}
        {t('hosted.sharing.back')}
      </Link>
      <h1 className="hp-sharing-title">
        {t('hosted.sharing.title', { profile: profile.name })}
      </h1>
      <p className="hp-sharing-note">{t('hosted.sharing.scopeNote')}</p>

      {empty ? (
        <SharingEmpty onInvite={() => setInvite(true)} />
      ) : (
        <div className={`hp-sharing-columns${LINKS_ON ? '' : ' hp-sharing-columns--one'}`}>
          <AccountantsColumn
            profile={profile}
            query={accountants}
            flashId={flashId}
            writable={writable}
            reinviting={reinviting}
            onInvite={() => setInvite(true)}
            onInviteAgain={(grant) => void inviteAgain(grant)}
          />
          {/* TODO(blocked-by MUT-560): <LinksColumn />, hidden on its own 404 (SHARE_LINKS off). */}
        </div>
      )}

      {/* MUT-314 (Basel 13244): the owner's own "Download a period" row goes here, at the bottom of the page. */}

      {inviteOpen && <InviteAccountantDrawer profile={profile} onClose={() => setInvite(false)} onInvited={invited} />}
    </div>
  );
}

/**
 * B5: nothing shared yet. The scene, the four promises and the ways to share (Invite only while links are off). Under
 * the lapse gate Invite still opens its drawer, which says why it is read-only (MUT-361).
 */
function SharingEmpty({ onInvite }: { onInvite: () => void }) {
  const { t } = useLanguage();
  return (
    <section className="hp-sharing-empty" aria-labelledby="hp-sharing-empty-title">
      <Scene name="accountant-empty" size={160} motion="drop-in" />
      <h2 id="hp-sharing-empty-title">{t('hosted.sharing.empty.title')}</h2>
      <AccessScopeList />
      <div className="hp-empty-actions">
        <Button onClick={onInvite}>
          {t('hosted.sharing.accountants.invite')}
        </Button>
      </div>
    </section>
  );
}
