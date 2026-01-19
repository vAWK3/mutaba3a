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
  githubOwner: "vAWK3",
  githubRepo: "mutaba3a",
  allReleasesUrl: "https://github.com/vAWK3/mutaba3a/releases",
  // Fallback version used when GitHub API fails (rate-limited, offline, etc.)
  fallbackVersion: "0.0.16",

  getReleaseNotesUrl: (version: string) =>
    `https://github.com/vAWK3/mutaba3a/releases/tag/v${version}`,

  mac: {
    fileSize: "~9.79 MB",
    minVersion: "macOS 12+",
    sha256: "6efac32dc88eca7d7451f110836b4ccd2b49ab59b5355735a54c6b2722462894",
    getDownloadUrl: (version: string) =>
      `https://github.com/vAWK3/mutaba3a/releases/download/v${version}/mutaba3a-v${version}-macos-universal.dmg`,
  },

  windows: {
    fileSize: "~9.79 MB",
    minVersion: "Windows 10+",
    sha256: "327f59f44a4e6a2ba6baee2644001cdc2188ad73b5b9e188d9cf4f6c84b3d443",
    exeSha256: "",
    getMsiUrl: (version: string) =>
      `https://github.com/vAWK3/mutaba3a/releases/download/v${version}/mutaba3a-v${version}-windows-x64.msi`,
    getExeUrl: (version: string) =>
      `https://github.com/vAWK3/mutaba3a/releases/download/v${version}/mutaba3a-v${version}-windows-x64-setup.exe`,
  },
};

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
