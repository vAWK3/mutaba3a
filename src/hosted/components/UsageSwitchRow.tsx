import { useT } from '../../lib/i18n/core';
import { choosePortalUsage, usePortalUsage } from '../analytics/portalAnalytics';
import { RowSwitch } from './YouRows';

/**
 * "Share anonymous usage" on You › App (MUT-155, B3; MUT-425): the portal has no Settings page, so the switch lives
 * there, with the same label as the prompt's button. Absent when the build has no key: nothing could be sent.
 */
export function UsageSwitchRow() {
  const t = useT();
  const choice = usePortalUsage((state) => state.choice);
  if (choice === 'unavailable') return null;
  const on = choice === 'on';
  return <RowSwitch label={t('hosted.usage.toggle')} on={on} onToggle={() => void choosePortalUsage(on ? 'off' : 'on', 'settings')} />;
}
