// Download config with URL templates - version fetched dynamically from GitHub
// Static fields (fileSize, sha256, fallbackVersion) are updated by deploy.sh / deploy.ps1

export interface DownloadConfig {
  githubOwner: string;
  githubRepo: string;
  allReleasesUrl: string;
  fallbackVersion: string;
  releaseNotesUrl?: string;
  getReleaseNotesUrl?: (version: string) => string;
  mac: {
    fileSize: string;
    minVersion: string;
    sha256: string;
    downloadUrl: string;
    getDownloadUrl?: (version: string) => string;
  };
  windows: {
    fileSize: string;
    minVersion: string;
    sha256: string;
    exeSha256?: string;
    msiUrl: string;
    exeUrl: string;
    getMsiUrl?: (version: string) => string;
    getExeUrl?: (version: string) => string;
  };
}

export const DOWNLOAD_CONFIG = {
  githubOwner: 'vAWK3',
  githubRepo: 'mutaba3a',
  allReleasesUrl: 'https://github.com/vAWK3/mutaba3a/releases',
  // Fallback version used when GitHub API fails (rate-limited, offline, etc.)
  fallbackVersion: '0.0.11',

  getReleaseNotesUrl: (version: string) =>
    `https://github.com/vAWK3/mutaba3a/releases/tag/v${version}`,

  mac: {
    fileSize: '~9.73 MB',
    minVersion: 'macOS 12+',
    sha256: '52d4f58f44a79096fc9c5f8af5d45b550e7b5a8d9e61ae447af8bfe8694ffe22',
    getDownloadUrl: (version: string) =>
      `https://github.com/vAWK3/mutaba3a/releases/download/v${version}/mutaba3a-v${version}-macos-universal.dmg`,
  },

  windows: {
    fileSize: '',
    minVersion: 'Windows 10+',
    sha256: '',
    exeSha256: '',
    getMsiUrl: (version: string) =>
      `https://github.com/vAWK3/mutaba3a/releases/download/v${version}/mutaba3a-v${version}-windows-x64.msi`,
    getExeUrl: (version: string) =>
      `https://github.com/vAWK3/mutaba3a/releases/download/v${version}/mutaba3a-v${version}-windows-x64-setup.exe`,
  },
};

// Pre-resolved config with static URLs for the fallback version
const FALLBACK_VERSION = DOWNLOAD_CONFIG.fallbackVersion;
export const FALLBACK_DOWNLOAD_CONFIG: DownloadConfig = {
  githubOwner: DOWNLOAD_CONFIG.githubOwner,
  githubRepo: DOWNLOAD_CONFIG.githubRepo,
  allReleasesUrl: DOWNLOAD_CONFIG.allReleasesUrl,
  fallbackVersion: FALLBACK_VERSION,
  releaseNotesUrl: DOWNLOAD_CONFIG.getReleaseNotesUrl(FALLBACK_VERSION),
  mac: {
    fileSize: DOWNLOAD_CONFIG.mac.fileSize,
    minVersion: DOWNLOAD_CONFIG.mac.minVersion,
    sha256: DOWNLOAD_CONFIG.mac.sha256,
    downloadUrl: DOWNLOAD_CONFIG.mac.getDownloadUrl(FALLBACK_VERSION),
  },
  windows: {
    fileSize: DOWNLOAD_CONFIG.windows.fileSize,
    minVersion: DOWNLOAD_CONFIG.windows.minVersion,
    sha256: DOWNLOAD_CONFIG.windows.sha256,
    exeSha256: DOWNLOAD_CONFIG.windows.exeSha256,
    msiUrl: DOWNLOAD_CONFIG.windows.getMsiUrl(FALLBACK_VERSION),
    exeUrl: DOWNLOAD_CONFIG.windows.getExeUrl(FALLBACK_VERSION),
  },
};
