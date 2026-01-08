// PDF Generation Module for Documents/Invoices
// Requires @react-pdf/renderer package

export { DocumentPdf } from './DocumentPdf';
export { getTexts, getDocumentTypeLabel, type DocumentTexts } from './texts';
export {
  getTemplateStyles,
  getFontFamily,
  getTextDirection,
  getTextAlign,
  template1Styles,
  template2Styles,
  template3Styles,
  type TemplateId,
} from './styles';

// Re-export PDF components from react-pdf for convenience
export { PDFViewer, PDFDownloadLink, BlobProvider } from '@react-pdf/renderer';
