import { StyleSheet } from '@react-pdf/renderer';
import type { DocumentLanguage } from '../../../types';

export type TemplateId = 'template1' | 'template2' | 'template3';

// Base styles shared across templates
const baseStyles = {
  page: {
    padding: '20mm',
    fontSize: 12,
    lineHeight: 1.5,
    display: 'flex' as const,
    flexDirection: 'column' as const,
    justifyContent: 'space-between' as const,
  },
  header: {
    marginBottom: 12,
    fontWeight: 700 as const,
  },
  tableHeader: {
    flexDirection: 'row' as const,
    borderBottom: '1px solid #000000',
    paddingBottom: 8,
    marginBottom: 4,
  },
  tableRow: {
    flexDirection: 'row' as const,
    paddingVertical: 4,
    borderBottom: '0.5px solid #e0e0e0',
  },
  tableCell: {
    padding: 4,
  },
  text: {
    fontWeight: 'normal' as const,
    fontSize: 12,
  },
  textBold: {
    fontWeight: 600 as const,
    fontSize: 12,
  },
  notes: {
    fontSize: 11,
    marginTop: 20,
    padding: 10,
    backgroundColor: '#f5f5f5',
    borderRadius: 4,
  },
  footer: {
    marginTop: 'auto' as const,
    paddingTop: 20,
    borderTop: '1px solid #e0e0e0',
    fontSize: 10,
    color: '#666666',
  },
};

// Template 1: Clean, professional (default)
export const template1Styles = StyleSheet.create({
  ...baseStyles,
  page: {
    ...baseStyles.page,
    backgroundColor: '#ffffff',
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  businessInfo: {
    maxWidth: '50%',
  },
  documentInfo: {
    textAlign: 'right',
  },
  clientSection: {
    marginTop: 20,
    marginBottom: 20,
    padding: 12,
    backgroundColor: '#f9f9f9',
    borderRadius: 4,
  },
  itemsTable: {
    marginTop: 20,
  },
  summarySection: {
    marginTop: 30,
    alignItems: 'flex-end',
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingVertical: 4,
    minWidth: 200,
  },
  summaryLabel: {
    width: 100,
    textAlign: 'right',
    paddingRight: 10,
  },
  summaryValue: {
    width: 100,
    textAlign: 'right',
    fontWeight: 600,
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingVertical: 8,
    minWidth: 200,
    borderTop: '1px solid #000000',
    marginTop: 4,
  },
  documentLabel: {
    textAlign: 'center',
    fontSize: 10,
    color: '#666666',
    marginTop: 10,
  },
});

// Template 2: Modern with accent color
export const template2Styles = StyleSheet.create({
  ...baseStyles,
  page: {
    ...baseStyles.page,
    backgroundColor: '#ffffff',
  },
  accentBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 8,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 20,
    marginTop: 10,
  },
  businessInfo: {
    maxWidth: '50%',
  },
  documentInfo: {
    textAlign: 'right',
  },
  clientSection: {
    marginTop: 20,
    marginBottom: 20,
    padding: 12,
    borderLeft: '3px solid',
  },
  itemsTable: {
    marginTop: 20,
  },
  summarySection: {
    marginTop: 30,
    alignItems: 'flex-end',
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingVertical: 4,
    minWidth: 200,
  },
  summaryLabel: {
    width: 100,
    textAlign: 'right',
    paddingRight: 10,
  },
  summaryValue: {
    width: 100,
    textAlign: 'right',
    fontWeight: 600,
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingVertical: 8,
    minWidth: 200,
    marginTop: 4,
  },
  documentLabel: {
    textAlign: 'center',
    fontSize: 10,
    color: '#666666',
    marginTop: 10,
  },
});

// Template 3: Minimal, large text
export const template3Styles = StyleSheet.create({
  ...baseStyles,
  page: {
    ...baseStyles.page,
    fontSize: 14,
    backgroundColor: '#ffffff',
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 30,
  },
  businessInfo: {
    maxWidth: '50%',
  },
  documentInfo: {
    textAlign: 'right',
  },
  clientSection: {
    marginTop: 30,
    marginBottom: 30,
  },
  itemsTable: {
    marginTop: 30,
  },
  summarySection: {
    marginTop: 40,
    alignItems: 'flex-end',
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingVertical: 6,
    minWidth: 250,
  },
  summaryLabel: {
    width: 120,
    textAlign: 'right',
    paddingRight: 15,
    fontSize: 14,
  },
  summaryValue: {
    width: 120,
    textAlign: 'right',
    fontWeight: 600,
    fontSize: 14,
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingVertical: 10,
    minWidth: 250,
    borderTop: '2px solid #000000',
    marginTop: 6,
  },
  documentLabel: {
    textAlign: 'center',
    fontSize: 12,
    color: '#666666',
    marginTop: 15,
  },
  text: {
    ...baseStyles.text,
    fontSize: 14,
  },
  notes: {
    ...baseStyles.notes,
    fontSize: 13,
  },
});

export function getTemplateStyles(templateId: TemplateId) {
  switch (templateId) {
    case 'template1':
      return template1Styles;
    case 'template2':
      return template2Styles;
    case 'template3':
      return template3Styles;
    default:
      return template1Styles;
  }
}

export function getFontFamily(language: DocumentLanguage): string {
  return language === 'ar' ? 'IBMPlexSansArabic' : 'IBMPlexSans';
}

export function getTextDirection(language: DocumentLanguage): 'rtl' | 'ltr' {
  return language === 'ar' ? 'rtl' : 'ltr';
}

export function getTextAlign(language: DocumentLanguage): 'right' | 'left' {
  return language === 'ar' ? 'right' : 'left';
}
