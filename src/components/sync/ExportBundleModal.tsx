/**
 * Export Bundle Modal
 *
 * Modal for exporting a sync bundle with passphrase encryption.
 */

import { useState } from 'react';
import { useSyncStore } from '../../sync/stores/syncStore';
import { createBundle, downloadBundle } from '../../sync/transport/bundle-encoder';
import { validatePassphrase, generatePassphrase } from '../../sync/transport/crypto';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import './ExportBundleModal.css';

export function ExportBundleModal() {
  const isOpen = useSyncStore((s) => s.isExportModalOpen);
  const closeModal = useSyncStore((s) => s.closeExportModal);

  const [passphrase, setPassphrase] = useState('');
  const [confirmPassphrase, setConfirmPassphrase] = useState('');
  const [showPassphrase, setShowPassphrase] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ filename: string; opCount: number } | null>(null);

  if (!isOpen) return null;

  const validation = validatePassphrase(passphrase);
  const passwordsMatch = passphrase === confirmPassphrase;
  const canExport = validation.valid && passwordsMatch && passphrase.length > 0;

  const handleGeneratePassphrase = () => {
    const generated = generatePassphrase(4);
    setPassphrase(generated);
    setConfirmPassphrase(generated);
    setShowPassphrase(true);
  };

  const handleExport = async () => {
    if (!canExport) return;

    setIsExporting(true);
    setError(null);

    try {
      const result = await createBundle({ passphrase });
      downloadBundle(result.data, result.filename);

      setSuccess({
        filename: result.filename,
        opCount: result.opCount,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setIsExporting(false);
    }
  };

  const handleClose = () => {
    setPassphrase('');
    setConfirmPassphrase('');
    setShowPassphrase(false);
    setError(null);
    setSuccess(null);
    closeModal();
  };

  return (
    <div className="modal-overlay" onClick={handleClose}>
      <div className="export-modal" onClick={(e) => e.stopPropagation()}>
        <div className="export-modal__header">
          <h2 className="export-modal__title">Export Sync Bundle</h2>
          <button className="export-modal__close" onClick={handleClose}>
            ✕
          </button>
        </div>

        {success ? (
          <div className="export-modal__body">
            <div className="export-success">
              <span className="export-success__icon">✓</span>
              <h3 className="export-success__title">Export Complete</h3>
              <p className="export-success__message">
                Exported {success.opCount} changes to:
                <br />
                <code>{success.filename}</code>
              </p>
              <p className="export-success__hint">
                Share this file with your other device and import it there.
                <br />
                Keep your passphrase safe - you'll need it to import.
              </p>
            </div>
          </div>
        ) : (
          <div className="export-modal__body">
            <p className="export-modal__description">
              Create an encrypted file containing your recent changes. You'll need the passphrase
              to import this bundle on another device.
            </p>

            {error && <div className="export-modal__error">{error}</div>}

            <div className="export-modal__field">
              <label className="export-modal__label">Passphrase</label>
              <div className="export-modal__input-row">
                <Input
                  type={showPassphrase ? 'text' : 'password'}
                  value={passphrase}
                  onChange={(e) => setPassphrase(e.target.value)}
                  placeholder="Enter a strong passphrase"
                />
                <button
                  type="button"
                  className="export-modal__toggle-visibility"
                  onClick={() => setShowPassphrase(!showPassphrase)}
                >
                  {showPassphrase ? '🙈' : '👁'}
                </button>
              </div>
              {passphrase && !validation.valid && (
                <ul className="export-modal__feedback">
                  {validation.feedback.map((f, i) => (
                    <li key={i}>{f}</li>
                  ))}
                </ul>
              )}
              {passphrase && (
                <div className={`export-modal__strength export-modal__strength--${validation.strength}`}>
                  Strength: {validation.strength}
                </div>
              )}
            </div>

            <div className="export-modal__field">
              <label className="export-modal__label">Confirm Passphrase</label>
              <Input
                type={showPassphrase ? 'text' : 'password'}
                value={confirmPassphrase}
                onChange={(e) => setConfirmPassphrase(e.target.value)}
                placeholder="Confirm your passphrase"
              />
              {confirmPassphrase && !passwordsMatch && (
                <div className="export-modal__error-inline">Passphrases don't match</div>
              )}
            </div>

            <button
              type="button"
              className="export-modal__generate"
              onClick={handleGeneratePassphrase}
            >
              Generate secure passphrase
            </button>
          </div>
        )}

        <div className="export-modal__footer">
          {success ? (
            <Button onClick={handleClose}>Done</Button>
          ) : (
            <>
              <Button variant="ghost" onClick={handleClose}>
                Cancel
              </Button>
              <Button onClick={handleExport} disabled={!canExport || isExporting}>
                {isExporting ? 'Exporting...' : 'Export Bundle'}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
