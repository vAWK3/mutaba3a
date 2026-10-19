// Static platform configuration for download page
// Version info is fetched dynamically from GitHub Releases API
// Download URLs use Netlify redirects to stable paths

export interface PlatformInfo {
  minVersion: string;
}

export const PLATFORM_CONFIG: Record<'mac' | 'windows', PlatformInfo> = {
  mac: {
    minVersion: 'macOS 12+',
  },
  windows: {
    minVersion: 'Windows 10+',
  },
};

// Stable download URLs (redirected by Netlify to GitHub Releases latest)
export const DOWNLOAD_URLS = {
  mac: '/download/mac',
  windowsMsi: '/download/windows',
  windowsExe: '/download/windows-exe',
  releaseNotes: '/download/release-notes',
  allReleases: 'https://github.com/vAWK3/mutaba3a/releases',
} as const;

/**
 * Where the landing page sends visitors who want to use the app in the browser:
 * straight onto the Clients list of a sample business (MUT-78, ADR-042). A
 * browser that already holds the person's own data just opens on it.
 */
export const WEB_APP_URL = '/app/clients?sample=1';

/**
 * The hosted offer page and its request form (MUT-186). One constant so the
 * landing page's paid callout (MUT-172) and the free app's "Go hosted" card
 * (MUT-187) can link here once they are built.
 */
export const HOSTED_OFFER_URL = '/hosted';

/** The built page copy with /hosted's own link preview; netlify.toml serves it at HOSTED_OFFER_URL. */
export const HOSTED_OFFER_FILE = 'hosted-offer.html';

export interface MobileAppLink {
  /** Whether the app can be installed today. /hosted reads only this. */
  available: boolean;
  /** Store listing, for people who already have an account (MUT-173, welcome emails). */
  url: string | null;
}

/**
 * The phone apps. Both sign in with a hosted account only, so a page aimed at
 * people without one (/hosted) shows availability and never links a store:
 * installing first would end at a sign-in screen they cannot pass (MUT-186, 9A).
 */
export const MOBILE_APP_LINKS: Record<'ios' | 'android', MobileAppLink> = {
  ios: { available: true, url: 'https://apps.apple.com/us/app/متابعة-مالية/id6821813829' },
  android: { available: true, url: 'https://play.google.com/store/apps/details?id=com.barmajiyat.mutaba3a' },
};

/**
 * The store listing a page may link, or null: only an available app with a real
 * https URL (MUT-173). A placeholder string, or a URL on an app that is not yet
 * available, never becomes a link, so / can't contradict /hosted or ship a dead one.
 */
export function storeLinkUrl(link: MobileAppLink, campaign?: StoreCampaign): string | null {
  if (!link.available || !link.url) return null;
  let url: URL;
  try {
    url = new URL(link.url);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  if (!campaign) return link.url;
  if (url.hostname === 'apps.apple.com') {
    url.searchParams.set('ct', campaign);
    if (APP_STORE_PROVIDER_TOKEN) url.searchParams.set('pt', APP_STORE_PROVIDER_TOKEN);
  } else if (url.hostname === 'play.google.com') {
    url.searchParams.set('referrer', `utm_source=mutaba3a&utm_medium=web&utm_campaign=${campaign}`);
  } else {
    return link.url;
  }
  return url.toString();
}

/** Where a store link was clicked, so the store consoles can attribute the install (MUT-154). */
export type StoreCampaign = 'mutaba3a-landing' | 'mutaba3a-portal';

/**
 * App Store Connect's provider token (Analytics › Campaigns), which Apple
 * needs beside `ct` to report a campaign. Not known yet: set it here when
 * Basel copies it from App Store Connect (MUT-154, A6).
 */
export const APP_STORE_PROVIDER_TOKEN: string | null = null;
