import { useState, useEffect, useRef } from 'react';
import { useBusinessProfiles } from '../../hooks/useQueries';
import { db } from '../../db';
import { useT } from '../../lib/i18n';
import type { BusinessProfile } from '../../types';
import './DeleteAllDataModal.css';

interface ExportDataModalProps {
  onClose: () => void;
}

type ExportStatus = 'idle' | 'exporting' | 'done' | 'error';

export function ExportDataModal({ onClose }: ExportDataModalProps) {
  const t = useT();
  const modalRef = useRef<HTMLDivElement>(null);
  const { data: profiles = [] } = useBusinessProfiles();

  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [exportStatus, setExportStatus] = useState<ExportStatus>('idle');

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

  // Auto-select first profile if only one exists
  useEffect(() => {
    if (profiles.length === 1 && !selectedProfileId) {
      setSelectedProfileId(profiles[0].id);
    }
  }, [profiles, selectedProfileId]);

  const handleExport = async () => {
    if (!selectedProfileId) return;

    setExportStatus('exporting');
    try {
      // Get the selected profile
      const profile = await db.businessProfiles.get(selectedProfileId);
      if (!profile) throw new Error('Profile not found');

      // Get documents for this profile
      const documents = await db.documents
        .filter((d) => d.businessProfileId === selectedProfileId && !d.deletedAt)
        .toArray();

      // Get document sequences for this profile
      const documentSequences = await db.documentSequences
        .filter((s) => s.businessProfileId === selectedProfileId)
        .toArray();

      // Get unique client IDs from documents
      const clientIds = new Set<string>();
      const transactionIds = new Set<string>();

      documents.forEach((doc) => {
        if (doc.clientId) clientIds.add(doc.clientId);
        if (doc.linkedTransactionIds) {
          doc.linkedTransactionIds.forEach((id) => transactionIds.add(id));
        }
      });

      // Get clients
      const clients = await db.clients
        .filter((c) => clientIds.has(c.id) && !c.archivedAt)
        .toArray();

      // Get projects for these clients
      const projects = await db.projects
        .filter((p) => !!p.clientId && clientIds.has(p.clientId!) && !p.archivedAt)
        .toArray();

      // Get transactions linked to documents
      const transactions = await db.transactions
        .filter((t) => transactionIds.has(t.id) && !t.deletedAt)
        .toArray();

      // Get FX rates (shared, include all)
      const fxRates = await db.fxRates.toArray();

      // Build export data
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

      // Download as JSON
      const json = JSON.stringify(exportData, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const profileName = profile.nameEn || profile.name || 'profile';
      const safeName = profileName.replace(/[^a-zA-Z0-9]/g, '-');
      a.download = `mutaba3a-${safeName}-${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);

      setExportStatus('done');
    } catch (error) {
      setExportStatus('error');
      console.error('Export failed:', error);
    }
  };

  const selectedProfile = profiles.find((p) => p.id === selectedProfileId);

  return (
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
            {t('settings.data.export')}
          </h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            <XIcon />
          </button>
        </div>

        <div className="modal-body">
          {exportStatus === 'done' ? (
            <div className="export-success">
              <CheckCircleIcon />
              <h3>Export Complete</h3>
              <p>Your data has been exported successfully.</p>
              <button className="btn btn-primary" onClick={onClose}>
                Close
              </button>
            </div>
          ) : (
            <>
              <p className="text-muted" style={{ marginBottom: 16 }}>
                Select a business profile to export. All documents, clients, projects, and transactions associated with this profile will be included.
              </p>

              {profiles.length === 0 ? (
                <div className="text-muted text-center" style={{ padding: '24px 0' }}>
                  No business profiles found. Create a profile first.
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
                  Export failed. Please try again.
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
    </>
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
    <svg width="48" height="48" fill="none" viewBox="0 0 24 24" stroke="var(--color-success)" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
    </svg>
  );
}
