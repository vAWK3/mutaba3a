// Download config with URL templates - version fetched dynamically from GitHub
// Static fields (fileSize, sha256, fallbackVersion) are updated by deploy.sh / deploy.ps1
export const DOWNLOAD_CONFIG = {
  githubOwner: 'vAWK3',
  githubRepo: 'mutaba3a',
  allReleasesUrl: 'https://github.com/vAWK3/mutaba3a/releases',
  // Fallback version used when GitHub API fails (rate-limited, offline, etc.)
  fallbackVersion: '0.0.15',

  getReleaseNotesUrl: (version: string) =>
    `https://github.com/vAWK3/mutaba3a/releases/tag/v${version}`,

  mac: {
    fileSize: '~9.79 MB',
    minVersion: 'macOS 12+',
    sha256: '77f9ab76e1e20de422d561c61661b4293288fb7977026cc9c2a84b21f380c7df',
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
