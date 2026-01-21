import { pdf } from '@react-pdf/renderer';
import { createElement } from 'react';
import { EngagementPdf } from './EngagementPdf';
import type { EngagementSnapshot, EngagementLanguage, EngagementType, EngagementCategory } from '../types';
import type { Client, BusinessProfile } from '../../../types';

interface DownloadPdfOptions {
  snapshot: EngagementSnapshot;
  client?: Client;
  language: EngagementLanguage;
  type: EngagementType;
  category: EngagementCategory;
  profile?: BusinessProfile;
  filename?: string;
}

export interface DownloadPdfResult {
  success: boolean;
  error?: string;
}

/**
 * Generate and download an engagement PDF
 */
export async function downloadEngagementPdf(options: DownloadPdfOptions): Promise<DownloadPdfResult> {
  const { snapshot, client, language, type, category, profile, filename } = options;

  try {
    // Create the PDF document element
    const pdfElement = createElement(EngagementPdf, {
      snapshot,
      client,
      language,
      type,
      category,
      profile,
    });

    // Generate PDF blob
    const blob = await pdf(pdfElement).toBlob();

    // Generate filename
    const clientName = client?.name || snapshot.clientName || 'draft';
    const sanitizedClientName = clientName.replace(/[^a-zA-Z0-9-_]/g, '-');
    const date = new Date().toISOString().slice(0, 10);
    const defaultFilename = `engagement-${sanitizedClientName}-${date}.pdf`;

    // Create download link and trigger download
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename || defaultFilename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error generating PDF';
    console.error('Failed to generate engagement PDF:', error);
    return { success: false, error: errorMessage };
  }
}
