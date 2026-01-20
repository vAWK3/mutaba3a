import { useState, useCallback, useMemo } from 'react';
import { TopBar } from '../../components/layout';
import { Card } from '../../components/ui/Card';
import { Toast } from '../../components/ui/Toast';
import { useLatestRelease } from '../../hooks/useLatestRelease';
import { PLATFORM_CONFIG } from '../../content/download-config';
import { useT } from '../../lib/i18n';
import './DownloadPage.css';

type OS = 'mac' | 'windows' | 'unknown';

// Stable download URLs (redirected by Netlify to GitHub Releases latest)
const DOWNLOAD_URLS = {
  mac: '/download/mac',
  windowsMsi: '/download/windows',
  windowsExe: '/download/windows-exe',
  releaseNotes: '/download/release-notes',
  allReleases: 'https://github.com/vAWK3/mutaba3a/releases',
} as const;

function detectOS(): OS {
  const ua = navigator.userAgent.toLowerCase();
  const platform = (navigator.platform?.toLowerCase() || '');

  if (platform.includes('mac') || ua.includes('macintosh')) {
    return 'mac';
  }
  if (platform.includes('win') || ua.includes('windows')) {
    return 'windows';
  }
  return 'unknown';
}

interface PlatformCardProps {
  platform: 'mac' | 'windows';
  isRecommended: boolean;
  version: string | null;
  hasBuild: boolean;
  isLoading: boolean;
  t: (key: string) => string;
}

function PlatformCard({ platform, isRecommended, version, hasBuild, isLoading, t }: PlatformCardProps) {
  const isMac = platform === 'mac';
  const platformConfig = PLATFORM_CONFIG[platform];

  const title = t(isMac ? 'download.mac.title' : 'download.windows.title');
  const downloadUrl = isMac ? DOWNLOAD_URLS.mac : DOWNLOAD_URLS.windowsMsi;
  const buttonText = t(isMac ? 'download.mac.downloadDmg' : 'download.windows.downloadMsi');

  const installSteps = isMac
    ? [
        t('download.mac.step1'),
        t('download.mac.step2'),
        t('download.mac.step3'),
      ]
    : [
        t('download.windows.step1'),
        t('download.windows.step2'),
        t('download.windows.step3'),
      ];

  // Show as available if we have build info from GitHub, or fallback if loading failed
  const isAvailable = hasBuild || (!isLoading && version === null);

  return (
    <Card
      variant="bordered"
      padding="lg"
      className={`download-platform-card ${isRecommended ? 'download-platform-card--recommended' : ''}`}
    >
      {isRecommended && (
        <div className="download-recommended-badge">{t('download.recommendedForYou')}</div>
      )}

      <div className="download-platform-header">
        <h2 className="download-platform-title">{title}</h2>
      </div>

      <div className="download-cta-wrapper">
        {isLoading ? (
          <span className="download-cta download-cta--loading">
            {t('download.loading')}
          </span>
        ) : isAvailable ? (
          <a
            href={downloadUrl}
            className={`download-cta ${isRecommended ? 'download-cta--primary' : 'download-cta--secondary'}`}
            rel="noopener"
            data-cta={`download-${platform}`}
            data-version={version || 'latest'}
          >
            {buttonText}
          </a>
        ) : (
          <span className="download-cta download-cta--disabled">
            {t('download.comingSoon')}
          </span>
        )}
      </div>

      <div className="download-meta">
        <div className="download-meta-item">
          <span className="download-meta-label">{t('download.version')}</span>
          <span className="download-meta-value">
            {isLoading ? '...' : version ? `v${version}` : '\u2014'}
          </span>
        </div>
        <div className="download-meta-item">
          <span className="download-meta-label">{t('download.requires')}</span>
          <span className="download-meta-value">{platformConfig.minVersion}</span>
        </div>
      </div>

      {isAvailable && (
        <div className="download-install">
          <h3 className="download-install-title">{t('download.howToInstall')}</h3>
          <ol className="download-install-steps">
            {installSteps.map((step, i) => (
              <li key={i}>{step}</li>
            ))}
          </ol>
        </div>
      )}

      {!isMac && isAvailable && (
        <div className="download-alt">
          <a
            href={DOWNLOAD_URLS.windowsExe}
            className="download-alt-link"
            rel="noopener"
          >
            {t('download.windows.altExe')}
          </a>
        </div>
      )}
    </Card>
  );
}

export function DownloadPage() {
  const [toastVisible, setToastVisible] = useState(false);
  const detectedOS = useMemo(() => detectOS(), []);
  const { release, isLoading } = useLatestRelease();
  const t = useT();

  const handleToastClose = useCallback(() => {
    setToastVisible(false);
  }, []);

  const platformOrder: Array<'mac' | 'windows'> =
    detectedOS === 'windows' ? ['windows', 'mac'] : ['mac', 'windows'];

  // Determine build availability from GitHub API response
  const hasMacBuild = release?.hasMacBuild ?? false;
  const hasWindowsBuild = release?.hasWindowsBuild ?? false;

  // Use release notes URL from GitHub API, or fallback to Netlify redirect
  const releaseNotesUrl = release?.releaseNotesUrl || DOWNLOAD_URLS.releaseNotes;

  return (
    <>
      <TopBar title={t('download.title')} hideAddMenu />
      <div className="page-content download-page">
        <div className="download-container">
          <div className="download-cards">
            {platformOrder.map((platform) => (
              <PlatformCard
                key={platform}
                platform={platform}
                isRecommended={detectedOS === platform}
                version={release?.version || null}
                hasBuild={platform === 'mac' ? hasMacBuild : hasWindowsBuild}
                isLoading={isLoading}
                t={t}
              />
            ))}
          </div>

          <div className="download-footer">
            <a
              href={releaseNotesUrl}
              className="download-link"
              rel="noopener noreferrer"
              target="_blank"
            >
              {t('download.releaseNotes')}
            </a>
            <a
              href={DOWNLOAD_URLS.allReleases}
              className="download-link"
              rel="noopener noreferrer"
              target="_blank"
            >
              {t('download.allVersions')}
            </a>
          </div>
        </div>
      </div>

      <Toast
        message={t('download.checksumCopied')}
        isVisible={toastVisible}
        onClose={handleToastClose}
      />
    </>
  );
}
