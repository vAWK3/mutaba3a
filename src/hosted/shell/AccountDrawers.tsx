/* eslint-disable react-refresh/only-export-components */
import { useNavigate, useSearch } from '@tanstack/react-router';
import { omitShellOverlay, parseProfileDrawer, type ProfileDrawerSearch } from '../data/filters';
import { BillingDrawer } from '../components/BillingDrawer';
import { ChangePasswordDrawer } from '../components/ChangePasswordDrawer';
import { CloseAccountDrawer } from '../components/CloseAccountDrawer';
import { PasskeysDrawer } from '../components/PasskeysDrawer';
import { passkeySupport } from '../passkeys/webauthn';
import { HostedYourDataDrawer } from '../components/HostedYourDataDrawer';
import { YourDataDrawer } from '../components/YourDataDrawer';
import { useIsLocalMode } from '../session/mode';

/**
 * The shell's account-menu drawers (MUT-237), on every page, beside `ProfileDrawers`.
 * Its own controller because "change your password" is an account concern, not a
 * profile one — `ProfileDrawers` stays scoped to what its name promises. The URL
 * key itself lives in the shared `ProfileDrawerSearch` (data/filters.ts), the
 * shell's one overlay-key registry every page's filter replace already knows to
 * carry forward (ADR-008, same URL-mirroring rule as the profile drawers).
 */

type Raw = Record<string, unknown>;

export function useAccountDrawers() {
  const navigate = useNavigate();
  const state = parseProfileDrawer(useSearch({ strict: false }) as Raw);
  const go = (next: ProfileDrawerSearch, replace: boolean) =>
    void navigate({ to: '.', search: (prev: Raw) => ({ ...omitShellOverlay(prev), ...next }), replace } as never);
  return {
    state,
    open: () => go({ changePassword: true }, false),
    openYourData: () => go({ yourData: true }, false),
    /** MUT-362: Settings › Billing; the Subscribe step is its own history entry, so Back returns to the status view (DR2). */
    openBilling: (step?: 'subscribe' | 'welcome', replace = false) => go(step ? { billing: true, step } : { billing: true }, replace),
    /** The step's own Back replaces its entry: browser Back afterwards never reopens the step (review). */
    leaveBillingStep: () => go({ billing: true }, true),
    /** MUT-333: Close my account. */
    openCloseAccount: () => go({ closeAccount: true }, false),
    /** MUT-115: Passkeys (`?passkeys=true`). */
    openPasskeys: () => go({ passkeys: true }, false),
    /** MUT-415: the review after a password change, in Change password's place (Back doesn't reopen the form). */
    reviewPasskeys: () => go({ passkeys: true, review: 'password' }, true),
    close: () => go({}, true),
  };
}

/** Each drawer only in the mode it belongs to: a password is an account's; Your data is this device's signed out (MUT-286) and the account's signed in (MUT-325); billing is the account's (MUT-362). */
export function AccountDrawers() {
  const drawers = useAccountDrawers();
  const local = useIsLocalMode();
  if (drawers.state.changePassword && !local) return <ChangePasswordDrawer onClose={drawers.close} onReviewPasskeys={drawers.reviewPasskeys} />;
  if (drawers.state.yourData) return local ? <YourDataDrawer onClose={drawers.close} /> : <HostedYourDataDrawer onClose={drawers.close} />;
  // MUT-333: an account's, never this device's; Download my records opens Your data in its place.
  if (drawers.state.closeAccount && !local) return <CloseAccountDrawer onClose={drawers.close} onDownload={drawers.openYourData} />;
  // MUT-115: an account's, and only where passkeys work on this host (never the legacy run.app portal).
  if (drawers.state.passkeys && !local && passkeySupport()) return <PasskeysDrawer review={drawers.state.review} onClose={drawers.close} />;
  if (drawers.state.billing && !local) {
    return <BillingDrawer step={drawers.state.step} checkout={drawers.state.checkout} portalReturned={drawers.state.portal === 'returned'} onStep={(step, replace) => (step ? drawers.openBilling(step, replace) : drawers.leaveBillingStep())} onClose={drawers.close} />;
  }
  return null;
}
