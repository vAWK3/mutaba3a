import { useState, useCallback } from 'react';
import { TopBar } from '../../components/layout';
import { Card } from '../../components/ui/Card';
import { Toast } from '../../components/ui/Toast';
import { copyToClipboard } from '../../lib/utils';
import { DOWNLOAD_CONFIG } from '../../content/download-config';
import './DownloadPage.css';

function truncateChecksum(checksum: string): string {
  if (checksum.length <= 20) return checksum;
  return `${checksum.slice(0, 8)}...${checksum.slice(-8)}`;
}

export function DownloadPage() {
  const [toastVisible, setToastVisible] = useState(false);

  const handleCopyChecksum = useCallback(async () => {
    const success = await copyToClipboard(DOWNLOAD_CONFIG.sha256);
    if (success) {
      setToastVisible(true);
    }
  }, []);

  const handleToastClose = useCallback(() => {
    setToastVisible(false);
  }, []);

  return (
    <>
      <TopBar title="Download" />
      <div className="page-content download-page">
        <Card variant="bordered" padding="lg" className="download-card">
          {/* Header */}
          <div className="download-header">
            <h2 className="download-title">Download for macOS</h2>
          </div>

          {/* Primary CTA */}
          <div className="download-cta-wrapper">
            <a
              href={DOWNLOAD_CONFIG.dmgLatestUrl}
              className="download-cta"
              rel="noopener"
              data-cta="download-mac"
              data-version={DOWNLOAD_CONFIG.version}
            >
              Download Mac App
            </a>
          </div>

          {/* Metadata */}
          <div className="download-meta">
            <div className="download-meta-item">
              <span className="download-meta-label">Version</span>
              <span className="download-meta-value">v{DOWNLOAD_CONFIG.version}</span>
            </div>
            <div className="download-meta-item">
              <span className="download-meta-label">Size</span>
              <span className="download-meta-value">{DOWNLOAD_CONFIG.fileSize}</span>
            </div>
            <div className="download-meta-item">
              <span className="download-meta-label">Requires</span>
              <span className="download-meta-value">{DOWNLOAD_CONFIG.minMacos}</span>
            </div>
          </div>

          {/* Checksum */}
          <div className="download-checksum">
            <span className="download-checksum-label">SHA-256</span>
            <div className="download-checksum-row">
              <code className="download-checksum-value">
                {truncateChecksum(DOWNLOAD_CONFIG.sha256)}
              </code>
              <button
                type="button"
                className="download-checksum-copy"
                onClick={handleCopyChecksum}
                aria-label="Copy full checksum"
              >
                Copy
              </button>
            </div>
          </div>

          {/* Install Steps */}
          <div className="download-install">
            <h3 className="download-install-title">How to install</h3>
            <ol className="download-install-steps">
              <li>Download the DMG</li>
              <li>Drag "متابعة" to Applications</li>
              <li>Open and approve if prompted</li>
            </ol>
          </div>

          {/* Links */}
          <div className="download-links">
            <a
              href={DOWNLOAD_CONFIG.releaseNotesUrl}
              className="download-link"
              rel="noopener noreferrer"
              target="_blank"
            >
              Release notes
            </a>
            {DOWNLOAD_CONFIG.dmgVersionUrl && (
              <a
                href={DOWNLOAD_CONFIG.dmgVersionUrl}
                className="download-link"
                rel="noopener"
              >
                Other versions
              </a>
            )}
          </div>
        </Card>
      </div>

      <Toast
        message="Checksum copied"
        isVisible={toastVisible}
        onClose={handleToastClose}
      />
    </>
  );
}
