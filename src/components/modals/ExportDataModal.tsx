import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useBusinessProfiles } from '../../hooks/useQueries';
import { getRepositories } from '../../db';
import { useT } from '../../lib/i18n';
import { exportDataToCSV, downloadTextFile } from '../../utils/csv';
import type { BusinessProfile } from '../../types';
import './DeleteAllDataModal.css';

interface ExportDataModalProps {
  onClose: () => void;
}

type ExportStatus = 'idle' | 'exporting' | 'done' | 'error';
type ExportFormat = 'json' | 'csv';

export function ExportDataModal({ onClose }: ExportDataModalProps) {
  const t = useT();
  const modalRef = useRef<HTMLDivElement>(null);
  const { data: profiles = [] } = useBusinessProfiles();

  const [chosenProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [exportFormat, setExportFormat] = useState<ExportFormat>('csv');
  const [exportStatus, setExportStatus] = useState<ExportStatus>('idle');
  const [exportError, setExportError] = useState<string>('');

  // Handle ESC key
  useEffect(() => {
    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onClose();
      }
    }
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  // Focus trap
  useEffect(() => {
    const modal = modalRef.current;
    if (modal) {
      modal.focus();
    }
  }, []);

  // With a single profile it is the selection until the user picks one
  // (derived at render rather than set from an effect).
  const selectedProfileId = chosenProfileId ?? (profiles.length === 1 ? profiles[0].id : null);

  const handleExport = async () => {
    if (!selectedProfileId) return;

    setExportStatus('exporting');
    setExportError('');
    try {
      const { profile, documents, documentSequences, clients, projects, transactions, fxRates } =
        await getRepositories().base.dataset.exportProfile(selectedProfileId);

      const profileName = profile.nameEn || profile.name || 'profile';
      const safeName = profileName.replace(/[^a-zA-Z0-9]/g, '-');
      const dateStr = new Date().toISOString().split('T')[0];

      if (exportFormat === 'csv') {
        // Export as CSV using the import template format
        const csvContent = exportDataToCSV({
          clients,
          projects,
          transactions,
        });
        downloadTextFile(`mutaba3a-${safeName}-${dateStr}.csv`, csvContent);
      } else {
        // Export as JSON (legacy format)
        const exportData = {
          version: 2,
          exportedAt: new Date().toISOString(),
          profileId: selectedProfileId,
          profile,
          documentSequences,
          documents,
          transactions,
          clients,
          projects,
          fxRates,
        };

        const json = JSON.stringify(exportData, null, 2);
        downloadTextFile(
          `mutaba3a-${safeName}-${dateStr}.json`,
          json,
          'application/json;charset=utf-8'
        );
      }

      setExportStatus('done');
    } catch (error) {
      setExportStatus('error');
      setExportError(error instanceof Error ? error.message : 'Unknown export error');
      console.error('Export failed:', error);
    }
  };

  const selectedProfile = profiles.find((p) => p.id === selectedProfileId);

  return createPortal(
    <>
      <div className="modal-overlay" onClick={onClose} />
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        ref={modalRef}
        tabIndex={-1}
      >
        <div className="modal-header">
          <h2 id="modal-title" className="modal-title">
            {t('settings.yourData.exportBusiness')}
          </h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            <XIcon />
          </button>
        </div>

        <div className="modal-body">
          {exportStatus === 'done' ? (
            <div className="export-success">
              <CheckCircleIcon />
              <h3>{t('settings.data.exportComplete')}</h3>
              <p>{t('settings.data.exportCompleteDesc')}</p>
              <button className="btn btn-primary" onClick={onClose}>
                {t('common.close')}
              </button>
            </div>
          ) : (
            <>
              <div style={{ marginBottom: 24 }}>
                <label className="settings-label" style={{ marginBottom: 8, display: 'block' }}>
                  {t('settings.data.exportFormat')}
                </label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    className={`btn btn-sm ${exportFormat === 'csv' ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={() => setExportFormat('csv')}
                  >
                    {t('settings.data.exportFormatCSV')}
                  </button>
                  <button
                    className={`btn btn-sm ${exportFormat === 'json' ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={() => setExportFormat('json')}
                  >
                    {t('settings.data.exportFormatJSON')}
                  </button>
                </div>
                <p className="text-muted text-sm" style={{ marginTop: 8 }}>
                  {exportFormat === 'csv'
                    ? t('settings.data.exportFormatCSVDesc')
                    : t('settings.data.exportFormatJSONDesc')}
                </p>
              </div>

              <p className="text-muted" style={{ marginBottom: 16 }}>
                {t('settings.data.selectProfileDesc')}
              </p>

              {profiles.length === 0 ? (
                <div className="text-muted text-center" style={{ padding: '24px 0' }}>
                  {t('settings.data.noProfilesFound')}
                </div>
              ) : (
                <div className="profile-select-list">
                  {profiles.map((profile) => (
                    <ProfileSelectItem
                      key={profile.id}
                      profile={profile}
                      selected={selectedProfileId === profile.id}
                      onSelect={() => setSelectedProfileId(profile.id)}
                    />
                  ))}
                </div>
              )}

              {exportStatus === 'error' && (
                <div className="status-error" style={{ marginTop: 12 }}>
                  {t('settings.data.exportFailedRetry')}
                  {exportError ? ` (${exportError})` : ''}
                </div>
              )}
            </>
          )}
        </div>

        {exportStatus !== 'done' && (
          <div className="modal-footer">
            <button className="btn btn-secondary" onClick={onClose}>
              {t('common.cancel')}
            </button>
            <button
              className="btn btn-primary"
              onClick={handleExport}
              disabled={!selectedProfileId || exportStatus === 'exporting'}
            >
              {exportStatus === 'exporting' ? 'Exporting...' : `Export ${selectedProfile?.name || 'Profile'}`}
            </button>
          </div>
        )}
      </div>
    </>,
    document.body
  );
}

interface ProfileSelectItemProps {
  profile: BusinessProfile;
  selected: boolean;
  onSelect: () => void;
}

function ProfileSelectItem({ profile, selected, onSelect }: ProfileSelectItemProps) {
  return (
    <button
      className={`profile-select-item ${selected ? 'profile-select-item--selected' : ''}`}
      onClick={onSelect}
      type="button"
    >
      <div className="profile-select-item__radio">
        <div className={`profile-select-item__radio-dot ${selected ? 'profile-select-item__radio-dot--selected' : ''}`} />
      </div>
      <div className="profile-select-item__info">
        {profile.logoDataUrl && (
          <img
            src={profile.logoDataUrl}
            alt=""
            className="profile-select-item__logo"
          />
        )}
        <div className="profile-select-item__details">
          <div className="profile-select-item__name">
            {profile.name}
            {profile.nameEn && <span className="text-muted"> ({profile.nameEn})</span>}
          </div>
          <div className="profile-select-item__meta text-muted text-sm">
            {profile.email}
            {profile.isDefault && (
              <span className="badge badge-primary" style={{ marginInlineStart: 8 }}>
                Default
              </span>
            )}
          </div>
        </div>
      </div>
    </button>
  );
}

function XIcon() {
  return (
    <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
    </svg>
  );
}

function CheckCircleIcon() {
  return (
    <svg width="48" height="48" fill="none" viewBox="0 0 24 24" stroke="var(--success)" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
    </svg>
  );
}
