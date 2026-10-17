import { useT } from '../../lib/i18n/core';
import { choosePortalUsage, usePortalUsage } from '../analytics/portalAnalytics';

/**
 * "Share anonymous usage" in the account menu (MUT-155, B3): the portal has
 * no Settings page, so the switch lives here, with the same label as the
 * prompt's button. Absent when the build has no key: nothing could be sent.
 */
export function UsageMenuItem() {
  const t = useT();
  const choice = usePortalUsage((state) => state.choice);
  if (choice === 'unavailable') return null;
  const on = choice === 'on';
  return (
    <button
      type="button"
      role="menuitemcheckbox"
      aria-checked={on}
      className="hp-menu-item press"
      onClick={() => void choosePortalUsage(on ? 'off' : 'on', 'settings')}
    >
      {t('hosted.usage.toggle')}
    </button>
  );
}
