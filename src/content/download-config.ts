// Download config with URL templates - version fetched dynamically from GitHub
// Static fields (fileSize, sha256, fallbackVersion) are updated by deploy.sh / deploy.ps1
export const DOWNLOAD_CONFIG = {
  githubOwner: 'vAWK3',
  githubRepo: 'mutaba3a',
  allReleasesUrl: 'https://github.com/vAWK3/mutaba3a/releases',
  // Fallback version used when GitHub API fails (rate-limited, offline, etc.)
  fallbackVersion: '0.0.9',

  getReleaseNotesUrl: (version: string) =>
    `https://github.com/vAWK3/mutaba3a/releases/tag/v${version}`,

  mac: {
    fileSize: '~7.16 MB',
    minVersion: 'macOS 12+',
    sha256: '23e4107e7af7669c3d8b1672d531fc1f24ccece018589e01e2bc9c162a69ecde',
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
