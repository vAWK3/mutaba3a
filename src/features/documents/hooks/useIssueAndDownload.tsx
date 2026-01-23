import { useState, useCallback } from 'react';
import { pdf } from '@react-pdf/renderer';
import { useQueryClient } from '@tanstack/react-query';
import { useIssueDocument } from '../../../hooks/useQueries';
import { useToast } from '../../../lib/toastStore';
import { documentRepo } from '../../../db';
import { savePdfToDisk, isPdfArchivalAvailable } from '../../../services/pdfArchival';
import { DocumentPdf } from '../pdf';
import type { Document, BusinessProfile, Client } from '../../../types';
import type { TemplateId } from '../pdf/styles';

interface UseIssueAndDownloadOptions {
  onSuccess?: () => void;
  onError?: (error: Error) => void;
}

interface IssueAndDownloadParams {
  document: Document;
  businessProfile: BusinessProfile;
  client?: Client;
  templateId?: TemplateId;
  isOriginal?: boolean;
  fileName?: string;
}

export function useIssueAndDownload(options: UseIssueAndDownloadOptions = {}) {
  const [isProcessing, setIsProcessing] = useState(false);
  const issueDocumentMutation = useIssueDocument();
  const { showToast } = useToast();
  const queryClient = useQueryClient();

  const downloadBlob = useCallback((blob: Blob, fileName: string) => {
    const url = URL.createObjectURL(blob);
    const a = window.document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.style.display = 'none';
    window.document.body.appendChild(a);
    a.click();
    window.document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, []);

  const generatePdfBlob = useCallback(
    async ({
      document: doc,
      businessProfile,
      client,
      templateId = 'template1',
      isOriginal = true,
    }: Omit<IssueAndDownloadParams, 'fileName'>): Promise<Blob> => {
      const pdfDocument = (
        <DocumentPdf
          document={doc}
          businessProfile={businessProfile}
          client={client}
          templateId={templateId}
          isOriginal={isOriginal}
        />
      );
      const blob = await pdf(pdfDocument).toBlob();
      return blob;
    },
    []
  );

  const issueAndDownload = useCallback(
    async ({
      document: doc,
      businessProfile,
      client,
      templateId = 'template1',
      isOriginal = true,
      fileName,
    }: IssueAndDownloadParams) => {
      setIsProcessing(true);

      try {
        // Step 1: Issue the document (mark as issued in DB)
        await issueDocumentMutation.mutateAsync(doc.id);

        // Step 2: Generate PDF blob
        const blob = await generatePdfBlob({
          document: { ...doc, status: 'issued' },
          businessProfile,
          client,
          templateId,
          isOriginal,
        });

        // Step 3: Save to disk if in Tauri (PDF archival)
        // Calculate the next version number (current + 1, starting from 1)
        const nextVersion = (doc.pdfVersion || 0) + 1;
        let pdfSavedPath: string | undefined;
        if (isPdfArchivalAvailable()) {
          try {
            pdfSavedPath = await savePdfToDisk(
              blob,
              businessProfile.name,
              doc.issueDate,
              doc.number,
              nextVersion
            );
            if (pdfSavedPath) {
              console.log('PDF archived to:', pdfSavedPath);
            }
          } catch (archiveError) {
            // Log warning but continue - archival is nice-to-have
            console.warn('Failed to archive PDF to disk:', archiveError);
            showToast('PDF saved but archival failed');
          }
        }

        // Step 4: Download the PDF
        const downloadFileName = fileName || `${doc.number}.pdf`;
        downloadBlob(blob, downloadFileName);

        // Step 5: Lock the document after successful export
        try {
          await documentRepo.lockAfterExport(doc.id, pdfSavedPath);
          // Invalidate document queries to reflect locked state
          queryClient.invalidateQueries({ queryKey: ['document', doc.id] });
          queryClient.invalidateQueries({ queryKey: ['documents'] });
        } catch (lockError) {
          // Log but don't fail - the export succeeded
          console.warn('Failed to lock document after export:', lockError);
        }

        // Step 6: Show success toast
        showToast('Document issued and downloaded');

        options.onSuccess?.();
      } catch (error) {
        console.error('Failed to issue and download document:', error);
        showToast('Failed to issue document. Please try again.');
        options.onError?.(error instanceof Error ? error : new Error('Unknown error'));
      } finally {
        setIsProcessing(false);
      }
    },
    [issueDocumentMutation, generatePdfBlob, downloadBlob, showToast, options, queryClient]
  );

  const downloadOnly = useCallback(
    async ({
      document: doc,
      businessProfile,
      client,
      templateId = 'template1',
      isOriginal = true,
      fileName,
    }: IssueAndDownloadParams) => {
      setIsProcessing(true);

      try {
        // Generate PDF blob
        const blob = await generatePdfBlob({
          document: doc,
          businessProfile,
          client,
          templateId,
          isOriginal,
        });

        // Save to disk if in Tauri (PDF archival)
        // Calculate the next version number (current + 1, starting from 1)
        const nextVersion = (doc.pdfVersion || 0) + 1;
        let pdfSavedPath: string | undefined;
        if (isPdfArchivalAvailable()) {
          try {
            pdfSavedPath = await savePdfToDisk(
              blob,
              businessProfile.name,
              doc.issueDate,
              doc.number,
              nextVersion
            );
            if (pdfSavedPath) {
              console.log('PDF archived to:', pdfSavedPath);
            }
          } catch (archiveError) {
            console.warn('Failed to archive PDF to disk:', archiveError);
          }
        }

        // Download the PDF
        const downloadFileName = fileName || `${doc.number}.pdf`;
        downloadBlob(blob, downloadFileName);

        // Lock the document after successful export (tracks export count even if already locked)
        try {
          await documentRepo.lockAfterExport(doc.id, pdfSavedPath);
          // Invalidate document queries to reflect updated state
          queryClient.invalidateQueries({ queryKey: ['document', doc.id] });
          queryClient.invalidateQueries({ queryKey: ['documents'] });
        } catch (lockError) {
          console.warn('Failed to update document after export:', lockError);
        }

        showToast('Document downloaded');
      } catch (error) {
        console.error('Failed to download document:', error);
        showToast('Failed to download document. Please try again.');
      } finally {
        setIsProcessing(false);
      }
    },
    [generatePdfBlob, downloadBlob, showToast, queryClient]
  );

  return {
    issueAndDownload,
    downloadOnly,
    isProcessing,
    isIssuing: issueDocumentMutation.isPending,
  };
}
