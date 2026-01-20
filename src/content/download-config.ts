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
