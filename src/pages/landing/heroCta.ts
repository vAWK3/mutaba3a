import type { DeviceKind } from '../../lib/platform';

/** The one filled button the hero shows. */
export type HeroCta = 'mac' | 'windows' | 'web';

/** The one text link under it. */
export type HeroAlternative = 'web' | 'desktop';

/**
 * One clear next step per visitor (brief L4): a Mac gets the Mac download, a
 * Windows PC the Windows download when the release has one, and everything
 * else — phones, tablets, Linux, ChromeOS, unknown — the web app.
 */
export function chooseHeroCta(device: DeviceKind, windowsAvailable: boolean): HeroCta {
  if (device === 'mac') return 'mac';
  if (device === 'windows' && windowsAvailable) return 'windows';
  return 'web';
}

/** A download's alternative is the browser; the web app's is the desktop apps. */
export function secondaryHeroLink(cta: HeroCta): HeroAlternative {
  return cta === 'web' ? 'desktop' : 'web';
}
