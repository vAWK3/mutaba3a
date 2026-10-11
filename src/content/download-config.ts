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

/** Where the landing page sends visitors who want to use the app in the browser. */
export const WEB_APP_URL = '/app';
