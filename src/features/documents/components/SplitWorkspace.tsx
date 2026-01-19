import { useRef, useEffect, useState, type ReactNode } from 'react';
import { PDFViewer } from '@react-pdf/renderer';
import { DocumentPdf } from '../pdf';
import type { Document, BusinessProfile, Client } from '../../../types';
import type { TemplateId } from '../pdf/styles';
import './SplitWorkspace.css';

export interface SplitWorkspaceProps {
  // Form content to render in left panel
  children: ReactNode;

  // Document data for PDF preview
  document: Document;
  businessProfile: BusinessProfile;
  client?: Client;
  templateId: TemplateId;
  isOriginal?: boolean;

  // Action handlers
  onSave?: () => void;
  onIssue?: () => void;

  // State
  isSaving?: boolean;
  isIssuing?: boolean;
  canIssue?: boolean;
  isDraft?: boolean;
}

export function SplitWorkspace({
  children,
  document,
  businessProfile,
  client,
  templateId,
  isOriginal = true,
  onSave,
  onIssue,
  isSaving = false,
  isIssuing = false,
  canIssue = false,
  isDraft = true,
}: SplitWorkspaceProps) {
  const leftPanelRef = useRef<HTMLDivElement>(null);
  const [showOriginalToggle, setShowOriginalToggle] = useState(isOriginal);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      const modifier = isMac ? e.metaKey : e.ctrlKey;

      // Cmd/Ctrl + S: Save draft
      if (modifier && e.key === 's') {
        e.preventDefault();
        if (onSave && !isSaving) {
          onSave();
        }
      }

      // Cmd/Ctrl + Enter: Issue document
      if (modifier && e.key === 'Enter') {
        e.preventDefault();
        if (onIssue && canIssue && !isIssuing) {
          onIssue();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onSave, onIssue, isSaving, isIssuing, canIssue]);

  return (
    <div className="split-workspace">
      {/* Top Action Bar */}
      <div className="split-workspace-actions">
        <div className="split-workspace-actions-left">
          <span className="split-workspace-mode-label">Pro Editor</span>
        </div>
        <div className="split-workspace-actions-right">
          {isDraft && (
            <button
              type="submit"
              form="document-form"
              className="btn btn-secondary"
              disabled={isSaving}
            >
              {isSaving ? 'Saving...' : 'Save Draft'}
              <kbd className="kbd">⌘S</kbd>
            </button>
          )}
          {canIssue && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={onIssue}
              disabled={isIssuing}
            >
              {isIssuing ? 'Issuing...' : 'Issue & Download'}
              <kbd className="kbd">⌘↵</kbd>
            </button>
          )}
        </div>
      </div>

      {/* Split Panels */}
      <div className="split-workspace-panels">
        {/* Left Panel - Form */}
        <div className="split-workspace-left" ref={leftPanelRef}>
          <div className="split-workspace-form">
            {children}
          </div>
        </div>

        {/* Divider */}
        <div className="split-workspace-divider" />

        {/* Right Panel - PDF Preview */}
        <div className="split-workspace-right">
          <div className="split-workspace-preview-header">
            <span className="split-workspace-preview-title">Preview</span>
            <label className="toggle-label">
              <input
                type="checkbox"
                checked={showOriginalToggle}
                onChange={(e) => setShowOriginalToggle(e.target.checked)}
              />
              <span>{showOriginalToggle ? 'Original' : 'Copy'}</span>
            </label>
          </div>
          <div className="split-workspace-preview">
            <PDFViewer width="100%" height="100%" showToolbar={false}>
              <DocumentPdf
                document={document}
                businessProfile={businessProfile}
                client={client}
                templateId={templateId}
                isOriginal={showOriginalToggle}
              />
            </PDFViewer>
          </div>
        </div>
      </div>
    </div>
  );
}
