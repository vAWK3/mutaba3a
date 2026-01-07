import { useState, useCallback, useMemo } from 'react';
import { TopBar } from '../../components/layout';
import { Card } from '../../components/ui/Card';
import { Toast } from '../../components/ui/Toast';
import { copyToClipboard } from '../../lib/utils';
import { DOWNLOAD_CONFIG } from '../../content/download-config';
import { useLatestRelease } from '../../hooks/useLatestRelease';
import './DownloadPage.css';

type OS = 'mac' | 'windows' | 'unknown';

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

function truncateChecksum(checksum: string): string {
  if (!checksum || checksum.length <= 20) return checksum || '—';
  return `${checksum.slice(0, 8)}...${checksum.slice(-8)}`;
}

interface PlatformCardProps {
  platform: 'mac' | 'windows';
  isRecommended: boolean;
  onCopyChecksum: (checksum: string) => void;
  version: string | null;
  hasBuild: boolean;
  isLoading: boolean;
}

function PlatformCard({ platform, isRecommended, onCopyChecksum, version, hasBuild, isLoading }: PlatformCardProps) {
  const isMac = platform === 'mac';
  const macConfig = DOWNLOAD_CONFIG.mac;
  const winConfig = DOWNLOAD_CONFIG.windows;

  const config = isMac ? macConfig : winConfig;
  const isAvailable = hasBuild && !!version;

  const title = isMac ? 'macOS' : 'Windows';
  const downloadUrl = version
    ? (isMac ? macConfig.getDownloadUrl(version) : winConfig.getMsiUrl(version))
    : '';
  const buttonText = isMac ? 'Download DMG' : 'Download MSI';

  const installSteps = isMac
    ? [
        'Download the DMG',
        'Drag "متابعة" to Applications',
        'Open and approve if prompted',
      ]
    : [
        'Download the MSI installer',
        'Run the installer',
        'Follow the installation wizard',
      ];

  return (
    <Card
      variant="bordered"
      padding="lg"
      className={`download-platform-card ${isRecommended ? 'download-platform-card--recommended' : ''}`}
    >
      {isRecommended && (
        <div className="download-recommended-badge">Recommended for you</div>
      )}

      <div className="download-platform-header">
        <h2 className="download-platform-title">{title}</h2>
      </div>

      <div className="download-cta-wrapper">
        {isLoading ? (
          <span className="download-cta download-cta--loading">
            Loading...
          </span>
        ) : isAvailable ? (
          <a
            href={downloadUrl}
            className={`download-cta ${isRecommended ? 'download-cta--primary' : 'download-cta--secondary'}`}
            rel="noopener"
            data-cta={`download-${platform}`}
            data-version={version}
          >
            {buttonText}
          </a>
        ) : (
          <span className="download-cta download-cta--disabled">
            Coming Soon
          </span>
        )}
      </div>

      <div className="download-meta">
        <div className="download-meta-item">
          <span className="download-meta-label">Version</span>
          <span className="download-meta-value">{isLoading ? '...' : version ? `v${version}` : '—'}</span>
        </div>
        {isAvailable && config.fileSize && (
          <div className="download-meta-item">
            <span className="download-meta-label">Size</span>
            <span className="download-meta-value">{config.fileSize}</span>
          </div>
        )}
        <div className="download-meta-item">
          <span className="download-meta-label">Requires</span>
          <span className="download-meta-value">{config.minVersion}</span>
        </div>
      </div>

      {isAvailable && config.sha256 && (
        <div className="download-checksum">
          <span className="download-checksum-label">SHA-256</span>
          <div className="download-checksum-row">
            <code className="download-checksum-value">
              {truncateChecksum(config.sha256)}
            </code>
            <button
              type="button"
              className="download-checksum-copy"
              onClick={() => onCopyChecksum(config.sha256)}
              aria-label="Copy full checksum"
            >
              Copy
            </button>
          </div>
        </div>
      )}

      {isAvailable && (
        <div className="download-install">
          <h3 className="download-install-title">How to install</h3>
          <ol className="download-install-steps">
            {installSteps.map((step, i) => (
              <li key={i}>{step}</li>
            ))}
          </ol>
        </div>
      )}

      {!isMac && isAvailable && version && (
        <div className="download-alt">
          <a
            href={winConfig.getExeUrl(version)}
            className="download-alt-link"
            rel="noopener"
          >
            Alternative: Download EXE installer
          </a>
        </div>
      )}
    </Card>
  );
}

export function DownloadPage() {
  const [toastVisible, setToastVisible] = useState(false);
  const detectedOS = useMemo(() => detectOS(), []);
  const { release, isLoading, error } = useLatestRelease();

  const handleCopyChecksum = useCallback(async (checksum: string) => {
    const success = await copyToClipboard(checksum);
    if (success) {
      setToastVisible(true);
    }
  }, []);

  const handleToastClose = useCallback(() => {
    setToastVisible(false);
  }, []);

  const platformOrder: Array<'mac' | 'windows'> =
    detectedOS === 'windows' ? ['windows', 'mac'] : ['mac', 'windows'];

  // If API failed, use fallback version and check static config for build availability
  const version = release?.version ?? (error ? DOWNLOAD_CONFIG.fallbackVersion : null);
  const hasMacBuild = release?.hasMacBuild ?? (error ? !!DOWNLOAD_CONFIG.mac.sha256 : false);
  const hasWindowsBuild = release?.hasWindowsBuild ?? (error ? !!DOWNLOAD_CONFIG.windows.sha256 : false);

  return (
    <>
      <TopBar title="Download" />
      <div className="page-content download-page">
        <div className="download-container">
          <div className="download-cards">
            {platformOrder.map((platform) => (
              <PlatformCard
                key={platform}
                platform={platform}
                isRecommended={detectedOS === platform}
                onCopyChecksum={handleCopyChecksum}
                version={version}
                hasBuild={platform === 'mac' ? hasMacBuild : hasWindowsBuild}
                isLoading={isLoading}
              />
            ))}
          </div>

          <div className="download-footer">
            <a
              href={version ? DOWNLOAD_CONFIG.getReleaseNotesUrl(version) : DOWNLOAD_CONFIG.allReleasesUrl}
              className="download-link"
              rel="noopener noreferrer"
              target="_blank"
            >
              Release notes
            </a>
            <a
              href={DOWNLOAD_CONFIG.allReleasesUrl}
              className="download-link"
              rel="noopener noreferrer"
              target="_blank"
            >
              All versions
            </a>
          </div>
        </div>
      </div>

      <Toast
        message="Checksum copied"
        isVisible={toastVisible}
        onClose={handleToastClose}
      />
    </>
  );
}
