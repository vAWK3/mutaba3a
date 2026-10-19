/* eslint-disable react-refresh/only-export-components */
import { useNavigate, useSearch } from '@tanstack/react-router';
import { omitShellOverlay, parseProfileDrawer, type ProfileDrawerSearch } from '../data/filters';
import { ChangePasswordDrawer } from '../components/ChangePasswordDrawer';
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
    close: () => go({}, true),
  };
}

/** Each drawer only in the mode it belongs to: a password is an account's, Your data is this device's (MUT-286). */
export function AccountDrawers() {
  const drawers = useAccountDrawers();
  const local = useIsLocalMode();
  if (drawers.state.changePassword && !local) return <ChangePasswordDrawer onClose={drawers.close} />;
  if (drawers.state.yourData && local) return <YourDataDrawer onClose={drawers.close} />;
  return null;
}
