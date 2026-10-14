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
 * The hosted offer page and its request form (MUT-186). The landing page's
 * paid callout (MUT-172) and the free app's "Go hosted" card (MUT-187) link
 * here too, so the address lives in one place.
 */
export const HOSTED_OFFER_URL = '/hosted';

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
  ios: { available: true, url: null },
  android: { available: false, url: null },
};
