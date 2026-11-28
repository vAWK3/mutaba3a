import { useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import { CONNECTED_APPS_KEY } from '../../data/oauthQueries';
import { useT } from '../../../lib/i18n/core';
import { useTp } from '../../../lib/i18n/plural';
import type { HostedProfile, Schemas } from '../../api/client';
import { RowButton, RowGroup, RowNavLink } from '../../components/YouRows';
import { MonthlySummarySwitchRow } from '../../components/MonthlySummarySwitchRow';
import { billingRowOf, type BillingRow } from '../../data/trialPrompt';
import { useMe } from '../../session/me';
import { useHasFeature, useIsOperator } from '../../session/features';
import { useIsLocalMode } from '../../session/mode';
import { useSignOut } from '../../session/useSignOut';
import { useSelfServiceDoors } from '../../session/selfServiceDoors';
import { useAccountDrawers } from '../../shell/AccountDrawers';
import { passkeySupport } from '../../passkeys/webauthn';

/**
 * You › Account (MUT-425; was the account menu, hosted-portal.md §7.1): Billing with the trial or the open profile's
 * lapse state (eng D6), Your data, Change password, Passkeys (MUT-115), and Sign out set apart; MUT-333's Close my account last, on its own.
 * Signed out on this device (MUT-286) there
 * is no account: Sign in and Your data instead, nothing that needs one.
 */
export function YouAccount({ profile }: { profile: HostedProfile | null }) {
  const t = useT();
  const openSignup = useSelfServiceDoors().openSignup;
  const local = useIsLocalMode();
  const drawers = useAccountDrawers();
  const navigate = useNavigate();
  const agentAccess = useHasFeature('agent_access');
  const operator = useIsOperator();
  // MUT-596: the row shows only where the server has Malafat access on (the list answers 404 elsewhere).
  const me = useMe();
  const connectedApps = useQuery({ queryKey: CONNECTED_APPS_KEY, queryFn: ({ signal }) => api.listConnectedApps(signal), enabled: !local, retry: false });

  if (local) {
    return (
      <RowGroup>
        <RowButton tone="action" label={t('hosted.local.signIn')} onClick={() => void navigate({ to: '/sign-in' })} />
        <RowButton label={t('hosted.local.yourData')} sub={t('hosted.local.data.download')} onClick={drawers.openYourData} />
        {/* MUT-513: the welcome again, with Continue on this device */}
        <RowButton label={t('hosted.welcome.whatIs')} onClick={() => void navigate({ to: '/welcome' })} />
      </RowGroup>
    );
  }
  return (
    <>
      <RowGroup>
        <RowButton label={t('hosted.billing.title')} sub={<BillingSub profile={profile} />} onClick={() => drawers.openBilling()} />
        {/* MUT-325: the account's own Download my records */}
        <RowButton label={t('hosted.yourData.title')} sub={t('hosted.local.data.download')} onClick={drawers.openYourData} />
        <RowButton label={t('hosted.auth.changePassword')} onClick={drawers.open} />
        {/* MUT-115 (DR2): directly after Change password, where passkeys work on this host */}
        {passkeySupport() && <RowButton label={t('hosted.account.passkeys.title')} sub={t('hosted.account.passkeys.rowSub')} onClick={drawers.openPasskeys} />}
        {/* MUT-710: after the other ways in (wireframe "Turn on"); an API older than 1.135.0 sends no twoFactor */}
        {me.user.twoFactor && <RowButton label={t('hosted.twoFactor.title')} sub={twoFactorRowSub(me.user.twoFactor, t)} onClick={drawers.openTwoFactor} />}
        {/* MUT-434: only for a person the operator gave agent_access */}
        {agentAccess && <RowButton label={t('hosted.connect.title')} sub={t('hosted.connect.rowSub')} onClick={drawers.openConnectClaude} />}
        {connectedApps.data && <RowButton label={t('hosted.connectedApps.title')} onClick={drawers.openConnectedApps} />}
      </RowGroup>
      {/* MUT-535: the monthly summary mail, in a group of its own (shown once the server answers) */}
      <MonthlySummarySwitchRow />
      {/* MUT-460 (6A): the operator console's way in, for operators only */}
      {operator && (
        <RowGroup>
          {/* MUT-737: with open sign-up the console opens on Accounts (no review queue). */}
          <RowNavLink label={t('hosted.operator.title')} to={openSignup ? '/operator/accounts' : '/operator/signups'} />
        </RowGroup>
      )}
      <SignOutGroup />
      {/* MUT-333: set apart, last: it can't be undone after 30 days */}
      <RowGroup>
        <RowButton tone="danger" label={t('hosted.closeAccount.menu')} sub={t('hosted.closeAccount.rowSub')} onClick={drawers.openCloseAccount} />
      </RowGroup>
    </>
  );
}

type TwoFactorState = Schemas['TwoFactorState'];

/** "Off" reads as what it is for; on, how the code comes. */
function twoFactorRowSub(state: TwoFactorState, t: ReturnType<typeof useT>): string {
  if (!state.enabled) return t('hosted.twoFactor.rowOff');
  return t(state.method === 'email' ? 'hosted.twoFactor.rowOnEmail' : 'hosted.twoFactor.rowOnApp');
}

function BillingSub({ profile }: { profile: HostedProfile | null }) {
  const row = billingRowOf(useMe(), profile, new Date());
  const text = useBillingRowText(row);
  return text ? <>{text}</> : null;
}

function useBillingRowText(row: BillingRow | null): string | null {
  const t = useT();
  const tp = useTp();
  if (!row) return null;
  switch (row.kind) {
    case 'trial':
      return tp('hosted.billing.headline.trialDaysLeft', row.daysLeft);
    case 'grace':
      return t('hosted.billing.chip.grace');
    case 'read-only':
      return t('hosted.billing.gate.readOnlyTitle');
    case 'locked':
      return t('hosted.billing.chip.locked');
    case 'paused':
      return t('hosted.billing.chip.paused');
  }
}

function SignOutGroup() {
  const t = useT();
  const { signOut, signingOut } = useSignOut();
  return (
    <RowGroup>
      <RowButton tone="danger" label={t('hosted.auth.signOut')} disabled={signingOut} onClick={() => void signOut()} />
    </RowGroup>
  );
}
