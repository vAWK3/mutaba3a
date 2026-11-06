import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, Navigate, useNavigate } from '@tanstack/react-router';
import { Button } from '../../../components/ui/Button';
import { useLanguage } from '../../../lib/i18n/core';
import type { AccountantGrant, HostedProfile } from '../../api/client';
import { trackPortal } from '../../analytics/portalAnalytics';
import { AccessScopeList } from '../../components/AccessScopeList';
import { Skeleton } from '../../components/QueryView';
import { Scene } from '../../components/Scene';
import { useToast } from '../../components/Toast';
import { omitShellOverlay } from '../../data/filters';
import { accountantsKey, refetchAfterRefusal, useAccountants, useInviteAccountant, useShareLinks } from '../../data/sharingQueries';
import { useMe, useWritableFor } from '../../session/me';
import { useIsLocalMode } from '../../session/mode';
import { youPath } from '../../shell/youRoutes';
import { AccountantsColumn } from './AccountantsColumn';
import { InviteAccountantDrawer } from './InviteAccountantDrawer';
import { LinksColumn } from './LinksColumn';
import { NewShareLinkDrawer } from './NewShareLinkDrawer';
import { SHARING_DRAWER_KEYS, inviteErrorOf, isolate, sharingOpen, type SharingSearch } from './sharingRules';

/**
 * MUT-561 (layout B, Basel 13236): one profile's Sharing page, `/p/$profileId/you/sharing`. Two columns, Accountants
 * and Links with a PIN (one column at 760 px and below). Invite and New link open side drawers by their URL keys
 * (`?invite=true`, `?newLink=true`; Basel 13244). Only an owner of the profile, signed in, on a server with
 * accountant access gets it (D8); anyone else goes back to You › Profiles. Nothing shared yet: the empty page (B5).
 * A server with SHARE_LINKS off answers the links list 404: the Links column hides and Accountants takes the page.
 */

export function SharingPage({ profile, search }: { profile: HostedProfile; search: SharingSearch }) {
  const me = useMe();
  const local = useIsLocalMode();
  if (!sharingOpen(me, profile, local)) return <Navigate to={youPath(profile.id, 'profiles')} replace />;
  return <SharingBody profile={profile} search={search} />;
}

type Raw = Record<string, unknown>;

function SharingBody({ profile, search }: { profile: HostedProfile; search: SharingSearch }) {
  const { t, language } = useLanguage();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const showToast = useToast();
  const writable = useWritableFor(profile);
  const accountants = useAccountants(profile.id);
  const links = useShareLinks(profile.id);
  const reinvite = useInviteAccountant(profile.id);
  const [flashId, setFlashId] = useState<string | null>(null);
  const [reinviting, setReinviting] = useState<string | null>(null);

  /** Opening pushes (Back closes); closing replaces (Back never reopens). The shell's own keys stay as they are (review g). */
  const setDrawer = (next: SharingSearch) =>
    void navigate({
      to: '.',
      search: (prev: Raw) => {
        const rest: Raw = { ...prev };
        for (const key of SHARING_DRAWER_KEYS) delete rest[key];
        return { ...rest, ...omitShellOverlay(next) };
      },
      replace: Object.keys(next).length === 0,
    } as never);

  const invited = (grant: AccountantGrant) => {
    setFlashId(grant.id);
    setDrawer({});
    showToast(t('hosted.sharing.invite.sent', { email: isolate(grant.email) }), { tone: 'info' });
  };

  /** Invite again (no confirm, D7): the same address, a fresh invite; refusals refetch as the drawer's do (review b). */
  const inviteAgain = async (grant: AccountantGrant) => {
    if (reinviting) return;
    setReinviting(grant.id);
    try {
      const fresh = await reinvite.mutateAsync({ email: grant.email, locale: language });
      void trackPortal('accountant_invited', {});
      setFlashId(fresh.id);
      showToast(t('hosted.sharing.invite.sent', { email: isolate(fresh.email) }), { tone: 'info' });
    } catch (error) {
      const mapped = inviteErrorOf(error, grant.email, accountants.data?.limit);
      if (mapped.refetch) refetchAfterRefusal(queryClient, accountantsKey(profile.id));
      const line = mapped.banner ?? { key: mapped.field ?? 'hosted.sharing.invite.errors.unreachable' };
      showToast(t(line.key, line.vars));
    } finally {
      setReinviting(null);
    }
  };

  const linksOff = links.data?.off === true;
  const linksEmpty = linksOff || (links.data?.off === false && links.data.items.length === 0);
  const empty = accountants.data !== undefined && !accountants.isError && accountants.data.items.length === 0 && !links.isError && linksEmpty;
  const linkLimit = links.data?.off === false ? links.data.limit : undefined;
  // No accountants yet and the links still loading: wait, rather than show the columns and swap to the empty page
  const deciding = accountants.data?.items.length === 0 && links.data === undefined && !links.isError;

  return (
    <div className="hp-sharing">
      <Link className="hp-link hp-sharing-back" to={youPath(profile.id, 'profiles')}>
        <span className="hp-sharing-back-arrow" aria-hidden="true">
          ‹
        </span>{' '}
        {t('hosted.sharing.back')}
      </Link>
      <h1 className="hp-sharing-title">{t('hosted.sharing.title', { profile: isolate(profile.name) })}</h1>
      <p className="hp-sharing-note">{t('hosted.sharing.scopeNote')}</p>

      {deciding ? (
        <Skeleton />
      ) : empty ? (
        <SharingEmpty linksOn={!linksOff} onInvite={() => setDrawer({ invite: true })} onNewLink={() => setDrawer({ newLink: true })} />
      ) : (
        <div className={`hp-sharing-columns${linksOff ? ' hp-sharing-columns--one' : ''}`}>
          <AccountantsColumn
            profile={profile}
            query={accountants}
            flashId={flashId}
            writable={writable}
            reinviting={reinviting}
            onInvite={() => setDrawer({ invite: true })}
            onInviteAgain={(grant) => void inviteAgain(grant)}
          />
          {!linksOff && <LinksColumn profile={profile} query={links} onCreate={() => setDrawer({ newLink: true })} />}
        </div>
      )}

      {/* MUT-314 (Basel 13244): the owner's own "Download a period" row goes here, at the bottom of the page. */}

      {search.invite && <InviteAccountantDrawer profile={profile} listLimit={accountants.data?.limit} onClose={() => setDrawer({})} onInvited={invited} />}
      {search.newLink && !search.invite && !linksOff && <NewShareLinkDrawer profile={profile} listLimit={linkLimit} onClose={() => setDrawer({})} />}
    </div>
  );
}

/**
 * B5: nothing shared yet. The scene, the four promises and the ways to share: Invite, and Create a link while share
 * links are on. Under the lapse gate each still opens its drawer, which says why it is read-only (MUT-361).
 */
function SharingEmpty({ linksOn, onInvite, onNewLink }: { linksOn: boolean; onInvite: () => void; onNewLink: () => void }) {
  const { t } = useLanguage();
  return (
    <section className="hp-sharing-empty" aria-labelledby="hp-sharing-empty-title">
      <Scene name="accountant-empty" size={160} motion="drop-in" />
      <h2 id="hp-sharing-empty-title">{t('hosted.sharing.empty.title')}</h2>
      <AccessScopeList />
      <div className="hp-empty-actions">
        <Button onClick={onInvite}>{t('hosted.sharing.accountants.invite')}</Button>
        {linksOn && (
          <Button variant="secondary" onClick={onNewLink}>
            {t('hosted.sharing.empty.createLink')}
          </Button>
        )}
      </div>
    </section>
  );
}
