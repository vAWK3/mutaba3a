/**
 * PDF Download Choice Modal
 *
 * When a document already has an exported PDF on disk (Tauri desktop),
 * this modal gives the user a choice:
 * - Edit Document: Go back to edit the document (changes will create a new version)
 * - Download Existing: Download the current PDF as-is (no new version)
 */

import { useEffect, useRef } from 'react';
import { useT } from '../../lib/i18n';
import './PdfDownloadChoiceModal.css';

interface PdfDownloadChoiceModalProps {
  documentNumber: string;
  pdfVersion: number;
  onEdit: () => void;
  onDownloadExisting: () => void;
  onClose: () => void;
}

export function PdfDownloadChoiceModal({
  documentNumber,
  pdfVersion,
  onEdit,
  onDownloadExisting,
  onClose,
}: PdfDownloadChoiceModalProps) {
  const t = useT();
  const modalRef = useRef<HTMLDivElement>(null);

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

  const handleEdit = () => {
    onEdit();
    onClose();
  };

  const handleDownload = () => {
    onDownloadExisting();
    onClose();
  };

  return (
    <>
      <div className="modal-overlay" onClick={onClose} />
      <div
        className="modal pdf-choice-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        ref={modalRef}
        tabIndex={-1}
      >
        <div className="modal-header">
          <h2 id="modal-title" className="modal-title">
            {t('documents.pdfChoice.title')}
          </h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            <XIcon />
          </button>
        </div>

        <div className="modal-body">
          <p className="pdf-choice-description">
            {t('documents.pdfChoice.description', { number: documentNumber, version: pdfVersion })}
          </p>

          <div className="pdf-choice-options">
            <button
              className="pdf-choice-option"
              onClick={handleEdit}
            >
              <div className="pdf-choice-option-icon">
                <EditIcon />
              </div>
              <div className="pdf-choice-option-content">
                <span className="pdf-choice-option-title">
                  {t('documents.pdfChoice.edit.title')}
                </span>
                <span className="pdf-choice-option-desc">
                  {t('documents.pdfChoice.edit.description')}
                </span>
              </div>
            </button>

            <button
              className="pdf-choice-option pdf-choice-option--primary"
              onClick={handleDownload}
            >
              <div className="pdf-choice-option-icon">
                <DownloadIcon />
              </div>
              <div className="pdf-choice-option-content">
                <span className="pdf-choice-option-title">
                  {t('documents.pdfChoice.download.title')}
                </span>
                <span className="pdf-choice-option-desc">
                  {t('documents.pdfChoice.download.description')}
                </span>
              </div>
            </button>
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>
            {t('common.cancel')}
          </button>
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

function EditIcon() {
  return (
    <svg width="24" height="24" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
      />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg width="24" height="24" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
      />
    </svg>
  );
}
