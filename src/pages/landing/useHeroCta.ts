import { useMemo, type ComponentType } from 'react';
import { useLatestRelease } from '../../hooks/useLatestRelease';
import { DOWNLOAD_URLS, WEB_APP_URL } from '../../content/download-config';
import { currentDevice } from '../../lib/platform';
import { chooseHeroCta, secondaryHeroLink, type HeroAlternative, type HeroCta } from './heroCta';
import { AppleIcon, BrowserIcon, WindowsIcon } from './components/PlatformIcons';

export interface HeroCtaConfig {
  href: string;
  Icon: ComponentType<{ size?: number }>;
  /** Translation keys: the hero's full label and hint, and the header bar's short label. */
  label: string;
  hint: string;
  shortLabel: string;
  alternative: HeroAlternative;
}

const CTA: Record<HeroCta, Omit<HeroCtaConfig, 'alternative'>> = {
  mac: {
    href: DOWNLOAD_URLS.mac,
    Icon: AppleIcon,
    label: 'landing.hero.ctaMac',
    hint: 'landing.hero.ctaMacHint',
    shortLabel: 'landing.header.cta.mac',
  },
  windows: {
    href: DOWNLOAD_URLS.windowsMsi,
    Icon: WindowsIcon,
    label: 'landing.hero.ctaWindows',
    hint: 'landing.hero.ctaWindowsHint',
    shortLabel: 'landing.header.cta.windows',
  },
  web: {
    href: WEB_APP_URL,
    Icon: BrowserIcon,
    label: 'landing.hero.ctaWeb',
    hint: 'landing.hero.ctaWebHint',
    shortLabel: 'landing.header.cta.web',
  },
};

/**
 * The one device-matched button (brief L4), shared by the hero and the header
 * bar (MUT-77) so the two always go to the same place. Both read the release
 * through useLatestRelease, which shares one GitHub call between them.
 */
export function useHeroCta(): HeroCtaConfig {
  const { release } = useLatestRelease();
  const device = useMemo(() => currentDevice(), []);
  const kind = chooseHeroCta(device, release?.hasWindowsBuild !== false);
  return { ...CTA[kind], alternative: secondaryHeroLink(kind) };
}
