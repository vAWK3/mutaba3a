/* eslint-disable react-refresh/only-export-components */
import { useNavigate, useSearch } from '@tanstack/react-router';
import { omitShellOverlay, parseProfileDrawer, type ProfileDrawerSearch } from '../data/filters';
import { ChangePasswordDrawer } from '../components/ChangePasswordDrawer';

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
    close: () => go({}, true),
  };
}

export function AccountDrawers() {
  const drawers = useAccountDrawers();
  if (drawers.state.changePassword) return <ChangePasswordDrawer onClose={drawers.close} />;
  return null;
}
