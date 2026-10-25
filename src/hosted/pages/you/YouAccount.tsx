import { useNavigate } from '@tanstack/react-router';
import { useT } from '../../../lib/i18n/core';
import { useTp } from '../../../lib/i18n/plural';
import type { HostedProfile } from '../../api/client';
import { RowButton, RowGroup } from '../../components/YouRows';
import { billingRowOf, type BillingRow } from '../../data/trialPrompt';
import { useMe } from '../../session/me';
import { useHasFeature } from '../../session/features';
import { useIsLocalMode } from '../../session/mode';
import { useSignOut } from '../../session/useSignOut';
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
  const local = useIsLocalMode();
  const drawers = useAccountDrawers();
  const navigate = useNavigate();
  const agentAccess = useHasFeature('agent_access');

  if (local) {
    return (
      <RowGroup>
        <RowButton tone="action" label={t('hosted.local.signIn')} onClick={() => void navigate({ to: '/sign-in' })} />
        <RowButton label={t('hosted.local.yourData')} sub={t('hosted.local.data.download')} onClick={drawers.openYourData} />
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
        {/* MUT-434: only for a person the operator gave agent_access */}
        {agentAccess && <RowButton label={t('hosted.connect.title')} sub={t('hosted.connect.rowSub')} onClick={drawers.openConnectClaude} />}
      </RowGroup>
      <SignOutGroup />
      {/* MUT-333: set apart, last: it can't be undone after 30 days */}
      <RowGroup>
        <RowButton tone="danger" label={t('hosted.closeAccount.menu')} sub={t('hosted.closeAccount.rowSub')} onClick={drawers.openCloseAccount} />
      </RowGroup>
    </>
  );
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
