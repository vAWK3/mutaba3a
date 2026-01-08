/**
 * Pairing Modal
 *
 * Modal for pairing mobile devices with the desktop app.
 * Shows QR code and 6-digit code for pairing.
 */

import { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { useSyncStore } from '../../sync/stores/syncStore';
import {
  usePairingSession,
  formatPairingCode,
  useCountdown,
  formatCountdown,
} from '../../hooks/usePairingSession';
import { Button } from '../ui/Button';
import './PairingModal.css';

export function PairingModal() {
  const isOpen = useSyncStore((s) => s.isPairingModalOpen);
  const closeModal = useSyncStore((s) => s.closePairingModal);
  const serverRunning = useSyncStore((s) => s.serverRunning);

  const {
    session,
    status,
    isLoading,
    error,
    isExpired,
    isVerified,
    isFailed,
    startSession,
    cancelSession,
    regenerateSession,
  } = usePairingSession();

  const remainingSeconds = useCountdown(session?.expiresAt);
  const [copied, setCopied] = useState<'code' | 'host' | null>(null);

  // Start session when modal opens
  useEffect(() => {
    if (isOpen && !session && !isLoading && serverRunning) {
      startSession();
    }
  }, [isOpen, session, isLoading, serverRunning, startSession]);

  // Reset copied state after delay
  useEffect(() => {
    if (copied) {
      const timer = setTimeout(() => setCopied(null), 2000);
      return () => clearTimeout(timer);
    }
  }, [copied]);

  const handleClose = () => {
    cancelSession();
    closeModal();
  };

  const handleCopyCode = async () => {
    if (!session?.code) return;
    try {
      await navigator.clipboard.writeText(session.code);
      setCopied('code');
    } catch (err) {
      console.error('Failed to copy code:', err);
    }
  };

  const handleCopyHost = async () => {
    if (!session) return;
    const host = session.hostCandidates[0];
    const address = `${host}:${session.port}`;
    try {
      await navigator.clipboard.writeText(address);
      setCopied('host');
    } catch (err) {
      console.error('Failed to copy address:', err);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={handleClose}>
      <div className="pairing-modal" onClick={(e) => e.stopPropagation()}>
        <div className="pairing-modal__header">
          <h2 className="pairing-modal__title">Pair Mobile Device</h2>
          <button className="pairing-modal__close" onClick={handleClose}>
            ✕
          </button>
        </div>

        <div className="pairing-modal__body">
          {!serverRunning ? (
            <div className="pairing-modal__error">
              <p>The sync server is not running.</p>
              <p>Please start the Wi-Fi server in Settings before pairing.</p>
            </div>
          ) : isLoading ? (
            <div className="pairing-modal__loading">
              <div className="pairing-modal__spinner" />
              <p>Starting pairing session...</p>
            </div>
          ) : error ? (
            <div className="pairing-modal__error">
              <p>{error}</p>
              <Button onClick={startSession} variant="secondary">
                Try Again
              </Button>
            </div>
          ) : isVerified ? (
            <div className="pairing-success">
              <span className="pairing-success__icon">✓</span>
              <h3 className="pairing-success__title">Device Paired!</h3>
              <p className="pairing-success__message">
                Your mobile device has been successfully paired.
              </p>
            </div>
          ) : isFailed ? (
            <div className="pairing-modal__error">
              <p>Too many failed attempts. Please try again.</p>
              <Button onClick={regenerateSession} variant="secondary">
                Start New Session
              </Button>
            </div>
          ) : session ? (
            <>
              {/* QR Code */}
              <div className="pairing-modal__qr-section">
                <div className="pairing-modal__qr-container">
                  <QRCodeSVG
                    value={session.qrPayload}
                    size={180}
                    level="M"
                    includeMargin
                    className={isExpired ? 'pairing-modal__qr--expired' : ''}
                  />
                  {isExpired && (
                    <div className="pairing-modal__qr-overlay">
                      <span>Expired</span>
                    </div>
                  )}
                </div>
                <p className="pairing-modal__qr-hint">
                  Scan with your phone's camera
                </p>
              </div>

              {/* Divider */}
              <div className="pairing-modal__divider">
                <span>or enter code manually</span>
              </div>

              {/* 6-digit Code */}
              <div className="pairing-modal__code-section">
                <button
                  className="pairing-modal__code"
                  onClick={handleCopyCode}
                  disabled={isExpired}
                  title="Click to copy"
                >
                  <span className={isExpired ? 'pairing-modal__code--expired' : ''}>
                    {formatPairingCode(session.code)}
                  </span>
                </button>
                {copied === 'code' && (
                  <span className="pairing-modal__copied">Copied!</span>
                )}
              </div>

              {/* Countdown */}
              <div className="pairing-modal__countdown">
                {isExpired ? (
                  <span className="pairing-modal__countdown--expired">
                    Session expired
                  </span>
                ) : (
                  <span>Expires in {formatCountdown(remainingSeconds)}</span>
                )}
                {status?.attemptsRemaining !== undefined &&
                  status.attemptsRemaining < 5 && (
                    <span className="pairing-modal__attempts">
                      {status.attemptsRemaining} attempts remaining
                    </span>
                  )}
              </div>

              {/* Progress bar */}
              {!isExpired && (
                <div className="pairing-modal__progress">
                  <div
                    className="pairing-modal__progress-bar"
                    style={{ width: `${(remainingSeconds / 120) * 100}%` }}
                  />
                </div>
              )}

              {/* Connection Info */}
              <div className="pairing-modal__connection-info">
                <div className="pairing-modal__host">
                  <span className="pairing-modal__host-label">Server address:</span>
                  <code className="pairing-modal__host-value">
                    {session.hostCandidates[0]}:{session.port}
                  </code>
                  <button
                    className="pairing-modal__copy-btn"
                    onClick={handleCopyHost}
                    title="Copy address"
                  >
                    {copied === 'host' ? '✓' : '⎘'}
                  </button>
                </div>
                {session.hostCandidates.length > 1 && (
                  <details className="pairing-modal__alt-hosts">
                    <summary>Alternative addresses ({session.hostCandidates.length - 1})</summary>
                    <ul>
                      {session.hostCandidates.slice(1).map((host, i) => (
                        <li key={i}>
                          {host}:{session.port}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            </>
          ) : null}
        </div>

        <div className="pairing-modal__footer">
          <Button onClick={handleClose} variant="secondary">
            {isVerified ? 'Done' : 'Cancel'}
          </Button>
          {session && !isVerified && (
            <Button onClick={regenerateSession} variant="ghost">
              Regenerate
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
