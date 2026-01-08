// Download config - fetched from remote JSON, this is the fallback
// Updated by deploy.sh / deploy.ps1 during releases

export interface DownloadConfigMac {
  fileSize: string;
  minVersion: string;
  sha256: string;
  downloadUrl: string;
}

export interface DownloadConfigWindows {
  fileSize: string;
  minVersion: string;
  sha256: string;
  exeSha256: string;
  msiUrl: string;
  exeUrl: string;
}

export interface DownloadConfig {
  githubOwner: string;
  githubRepo: string;
  allReleasesUrl: string;
  fallbackVersion: string;
  releaseNotesUrl: string;
  mac: DownloadConfigMac;
  windows: DownloadConfigWindows;
}

// Fallback config used when remote fetch fails
export const FALLBACK_DOWNLOAD_CONFIG: DownloadConfig = {
  githubOwner: 'vAWK3',
  githubRepo: 'mutaba3a',
  allReleasesUrl: 'https://github.com/vAWK3/mutaba3a/releases',
  fallbackVersion: '0.0.10',
  releaseNotesUrl: 'https://github.com/vAWK3/mutaba3a/releases/tag/v0.0.10',
  mac: {
    fileSize: '~7.15 MB',
    minVersion: 'macOS 12+',
    sha256: '52b13df20cc8a91aa4430073551190c5dc3088f7bdca990ee6132520a827166c',
    downloadUrl: 'https://github.com/vAWK3/mutaba3a/releases/download/v0.0.10/mutaba3a-v0.0.10-macos-universal.dmg',
  },
  windows: {
    fileSize: '',
    minVersion: 'Windows 10+',
    sha256: '',
    exeSha256: '',
    msiUrl: 'https://github.com/vAWK3/mutaba3a/releases/download/v0.0.10/mutaba3a-v0.0.10-windows-x64.msi',
    exeUrl: 'https://github.com/vAWK3/mutaba3a/releases/download/v0.0.10/mutaba3a-v0.0.10-windows-x64-setup.exe',
  },
};
