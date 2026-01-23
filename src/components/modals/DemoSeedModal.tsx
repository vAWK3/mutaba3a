/**
 * Demo Seed Modal
 *
 * Confirmation modal for activating demo mode and seeding demo data.
 * Requires typing "SEED" to confirm, following the DeleteAllDataModal pattern.
 */

import { useState, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useT } from '../../lib/i18n';
import { useDemoStore, seedDemoData, DEMO_CONFIRM_WORD } from '../../demo';
import type { DemoDataStats } from '../../demo';
import './DemoSeedModal.css';

interface DemoSeedModalProps {
  onClose: () => void;
}

type SeedStatus = 'idle' | 'seeding' | 'success' | 'error';

export function DemoSeedModal({ onClose }: DemoSeedModalProps) {
  const t = useT();
  const queryClient = useQueryClient();
  const modalRef = useRef<HTMLDivElement>(null);

  const [confirmText, setConfirmText] = useState('');
  const [seedStatus, setSeedStatus] = useState<SeedStatus>('idle');
  const [seedError, setSeedError] = useState<string | null>(null);
  const [stats, setStats] = useState<DemoDataStats | null>(null);

  const { activateDemo } = useDemoStore();

  // Handle ESC key
  useEffect(() => {
    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape' && seedStatus !== 'seeding') {
        onClose();
      }
    }
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [onClose, seedStatus]);

  // Focus trap
  useEffect(() => {
    const modal = modalRef.current;
    if (modal) {
      modal.focus();
    }
  }, []);

  const handleSeed = async () => {
    if (confirmText.toUpperCase() !== DEMO_CONFIRM_WORD) {
      return;
    }

    setSeedStatus('seeding');
    setSeedError(null);

    try {
      const result = await seedDemoData();
      setStats(result);
      setSeedStatus('success');

      // Activate demo mode in store
      activateDemo();

      // Invalidate all queries to refresh UI
      queryClient.invalidateQueries();
    } catch (error) {
      setSeedStatus('error');
      setSeedError(error instanceof Error ? error.message : 'Unknown error');
      console.error('Failed to seed demo data:', error);
    }
  };

  const handleClose = () => {
    if (seedStatus === 'success') {
      // Refresh the page to ensure clean state
      window.location.reload();
    } else {
      onClose();
    }
  };

  const canSeed = confirmText.toUpperCase() === DEMO_CONFIRM_WORD && seedStatus === 'idle';

  return (
    <>
      <div className="demo-seed-modal-overlay" onClick={seedStatus !== 'seeding' ? handleClose : undefined} />
      <div
        className="demo-seed-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="demo-modal-title"
        ref={modalRef}
        tabIndex={-1}
      >
        <div className="modal-header">
          <h2 id="demo-modal-title" className="modal-title">
            {t('demo.modal.title')}
          </h2>
          {seedStatus !== 'seeding' && (
            <button className="modal-close" onClick={handleClose} aria-label="Close">
              <XIcon />
            </button>
          )}
        </div>

        <div className="modal-body">
          {seedStatus === 'idle' && (
            <>
              {/* Info message */}
              <div className="demo-info">
                <InfoIcon />
                <div>
                  <p className="demo-info-title">{t('demo.modal.infoTitle')}</p>
                  <p className="demo-info-desc">{t('demo.modal.infoDesc')}</p>
                </div>
              </div>

              {/* What will be created */}
              <div className="demo-preview">
                <h3>{t('demo.modal.willCreate')}</h3>
                <ul>
                  <li>{t('demo.modal.item.profile')}</li>
                  <li>{t('demo.modal.item.clients')}</li>
                  <li>{t('demo.modal.item.projects')}</li>
                  <li>{t('demo.modal.item.transactions')}</li>
                  <li>{t('demo.modal.item.documents')}</li>
                  <li>{t('demo.modal.item.retainers')}</li>
                  <li>{t('demo.modal.item.expenses')}</li>
                </ul>
              </div>

              {/* Confirmation input */}
              <div className="demo-confirm">
                <label htmlFor="confirm-input">
                  {t('demo.modal.confirmLabel', { word: DEMO_CONFIRM_WORD })}
                </label>
                <input
                  id="confirm-input"
                  type="text"
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  placeholder={DEMO_CONFIRM_WORD}
                  className="input"
                  autoComplete="off"
                />
              </div>
            </>
          )}

          {seedStatus === 'seeding' && (
            <div className="demo-seeding">
              <div className="demo-spinner" />
              <p>{t('demo.modal.seeding')}</p>
            </div>
          )}

          {seedStatus === 'success' && stats && (
            <div className="demo-success">
              <CheckCircleIcon />
              <h3>{t('demo.modal.successTitle')}</h3>
              <p>{t('demo.modal.successDesc')}</p>
              <div className="demo-stats">
                <div className="demo-stat">
                  <span className="demo-stat-value">{stats.clients}</span>
                  <span className="demo-stat-label">{t('demo.stats.clients')}</span>
                </div>
                <div className="demo-stat">
                  <span className="demo-stat-value">{stats.projects}</span>
                  <span className="demo-stat-label">{t('demo.stats.projects')}</span>
                </div>
                <div className="demo-stat">
                  <span className="demo-stat-value">{stats.transactions}</span>
                  <span className="demo-stat-label">{t('demo.stats.transactions')}</span>
                </div>
                <div className="demo-stat">
                  <span className="demo-stat-value">{stats.documents}</span>
                  <span className="demo-stat-label">{t('demo.stats.documents')}</span>
                </div>
              </div>
            </div>
          )}

          {seedStatus === 'error' && (
            <div className="demo-error">
              <ErrorIcon />
              <h3>{t('demo.modal.errorTitle')}</h3>
              <p>{seedError || t('demo.modal.errorDesc')}</p>
            </div>
          )}
        </div>

        <div className="modal-footer">
          {seedStatus === 'idle' && (
            <>
              <button className="btn btn-secondary" onClick={handleClose}>
                {t('common.cancel')}
              </button>
              <button
                className="btn btn-primary"
                onClick={handleSeed}
                disabled={!canSeed}
              >
                {t('demo.modal.seedButton')}
              </button>
            </>
          )}

          {seedStatus === 'success' && (
            <button className="btn btn-primary" onClick={handleClose}>
              {t('demo.modal.doneButton')}
            </button>
          )}

          {seedStatus === 'error' && (
            <>
              <button className="btn btn-secondary" onClick={handleClose}>
                {t('common.cancel')}
              </button>
              <button className="btn btn-primary" onClick={() => setSeedStatus('idle')}>
                {t('demo.modal.tryAgain')}
              </button>
            </>
          )}
        </div>
      </div>
    </>
  );
}

function XIcon() {
  return (
    <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
    </svg>
  );
}

function InfoIcon() {
  return (
    <svg width="24" height="24" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}

function CheckCircleIcon() {
  return (
    <svg width="48" height="48" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}

function ErrorIcon() {
  return (
    <svg width="48" height="48" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}
