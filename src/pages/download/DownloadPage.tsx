import { useState, useCallback, useMemo } from 'react';
import { TopBar } from '../../components/layout';
import { Card } from '../../components/ui/Card';
import { Toast } from '../../components/ui/Toast';
import { copyToClipboard } from '../../lib/utils';
import { useDownloadConfig } from '../../hooks/useDownloadConfig';
import type { DownloadConfig } from '../../content/download-config';
import { useT } from '../../lib/i18n';
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
  config: DownloadConfig;
  hasBuild: boolean;
  isLoading: boolean;
  t: (key: string) => string;
}

function PlatformCard({ platform, isRecommended, onCopyChecksum, config, hasBuild, isLoading, t }: PlatformCardProps) {
  const isMac = platform === 'mac';
  const macConfig = config.mac;
  const winConfig = config.windows;

  const platformConfig = isMac ? macConfig : winConfig;
  const version = config.fallbackVersion;
  const isAvailable = hasBuild && !!version;

  const title = t(isMac ? 'download.mac.title' : 'download.windows.title');
  const downloadUrl = isMac ? macConfig.downloadUrl : winConfig.msiUrl;
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
            data-version={version}
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
          <span className="download-meta-value">{isLoading ? '...' : version ? `v${version}` : '—'}</span>
        </div>
        {isAvailable && platformConfig.fileSize && (
          <div className="download-meta-item">
            <span className="download-meta-label">{t('download.size')}</span>
            <span className="download-meta-value">{platformConfig.fileSize}</span>
          </div>
        )}
        <div className="download-meta-item">
          <span className="download-meta-label">{t('download.requires')}</span>
          <span className="download-meta-value">{platformConfig.minVersion}</span>
        </div>
      </div>

      {isAvailable && platformConfig.sha256 && (
        <div className="download-checksum">
          <span className="download-checksum-label">{t('download.sha256')}</span>
          <div className="download-checksum-row">
            <code className="download-checksum-value">
              {truncateChecksum(platformConfig.sha256)}
            </code>
            <button
              type="button"
              className="download-checksum-copy"
              onClick={() => onCopyChecksum(platformConfig.sha256)}
              aria-label={t('download.copy')}
            >
              {t('download.copy')}
            </button>
          </div>
        </div>
      )}

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
            href={winConfig.exeUrl}
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
  const { config, isLoading } = useDownloadConfig();
  const t = useT();

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

  // Check build availability based on sha256 presence
  const hasMacBuild = !!config.mac.sha256;
  const hasWindowsBuild = !!config.windows.sha256;

  return (
    <>
      <TopBar title={t('download.title')} />
      <div className="page-content download-page">
        <div className="download-container">
          <div className="download-cards">
            {platformOrder.map((platform) => (
              <PlatformCard
                key={platform}
                platform={platform}
                isRecommended={detectedOS === platform}
                onCopyChecksum={handleCopyChecksum}
                config={config}
                hasBuild={platform === 'mac' ? hasMacBuild : hasWindowsBuild}
                isLoading={isLoading}
                t={t}
              />
            ))}
          </div>

          <div className="download-footer">
            <a
              href={config.releaseNotesUrl || config.allReleasesUrl}
              className="download-link"
              rel="noopener noreferrer"
              target="_blank"
            >
              {t('download.releaseNotes')}
            </a>
            <a
              href={config.allReleasesUrl}
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
