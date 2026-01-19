import { useState, useCallback } from 'react';
import { pdf } from '@react-pdf/renderer';
import { useIssueDocument } from '../../../hooks/useQueries';
import { useToast } from '../../../lib/toastStore';
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

        // Step 3: Download the PDF
        const downloadFileName = fileName || `${doc.number}.pdf`;
        downloadBlob(blob, downloadFileName);

        // Step 4: Show success toast
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
    [issueDocumentMutation, generatePdfBlob, downloadBlob, showToast, options]
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
        // Generate and download PDF without issuing
        const blob = await generatePdfBlob({
          document: doc,
          businessProfile,
          client,
          templateId,
          isOriginal,
        });

        const downloadFileName = fileName || `${doc.number}.pdf`;
        downloadBlob(blob, downloadFileName);

        showToast('Document downloaded');
      } catch (error) {
        console.error('Failed to download document:', error);
        showToast('Failed to download document. Please try again.');
      } finally {
        setIsProcessing(false);
      }
    },
    [generatePdfBlob, downloadBlob, showToast]
  );

  return {
    issueAndDownload,
    downloadOnly,
    isProcessing,
    isIssuing: issueDocumentMutation.isPending,
  };
}
