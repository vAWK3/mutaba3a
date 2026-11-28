import { GuideIcon } from '../../components/icons/generated';
import { useT } from '../../lib/i18n/core';
import { useAccountDrawers } from '../shell/AccountDrawers';

/**
 * MUT-674: the button a feature's own screen carries to open its guide. It opens the guide's drawer over the page
 * (`?guide=<id>`); closing the drawer returns to the page as it was. `label` is the screen's own words for the guide
 * ("How to connect"); without one it reads "Guide".
 */
export function GuideButton({ guide, label }: { guide: string; label?: string }) {
  const t = useT();
  const { openGuide } = useAccountDrawers();
  return (
    <button type="button" className="hp-link-button hp-guide-button press" onClick={() => openGuide(guide)}>
      <GuideIcon size={16} />
      <span>{label ?? t('hosted.guide.open')}</span>
    </button>
  );
}
