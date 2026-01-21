import { StyleSheet } from '@react-pdf/renderer';
import type { EngagementLanguage } from '../types';

// Base styles for engagement PDF
export const engagementStyles = StyleSheet.create({
  page: {
    padding: '20mm',
    fontSize: 11,
    lineHeight: 1.5,
    backgroundColor: '#ffffff',
  },
  header: {
    marginBottom: 20,
  },
  title: {
    fontSize: 22,
    fontWeight: 700,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 12,
    color: '#666666',
    marginBottom: 4,
  },
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: 600,
    marginBottom: 10,
    paddingBottom: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  sectionContent: {
    paddingLeft: 0,
  },
  paragraph: {
    marginBottom: 8,
    fontSize: 11,
    lineHeight: 1.6,
  },
  list: {
    marginBottom: 8,
  },
  listItem: {
    flexDirection: 'row',
    marginBottom: 4,
  },
  listBullet: {
    width: 15,
    fontSize: 11,
  },
  listContent: {
    flex: 1,
    fontSize: 11,
  },
  table: {
    marginBottom: 12,
  },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: '#f5f5f5',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  tableRow: {
    flexDirection: 'row',
    borderBottomWidth: 0.5,
    borderBottomColor: '#e0e0e0',
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  tableCell: {
    fontSize: 10,
  },
  tableCellHeader: {
    fontSize: 10,
    fontWeight: 600,
  },
  infoRow: {
    flexDirection: 'row',
    marginBottom: 4,
  },
  infoLabel: {
    width: 120,
    fontSize: 10,
    color: '#666666',
  },
  infoValue: {
    flex: 1,
    fontSize: 10,
    fontWeight: 500,
  },
  partiesSection: {
    flexDirection: 'row',
    marginBottom: 20,
    gap: 20,
  },
  partyBox: {
    flex: 1,
    padding: 12,
    backgroundColor: '#f9f9f9',
    borderRadius: 4,
  },
  partyTitle: {
    fontSize: 10,
    color: '#666666',
    marginBottom: 4,
  },
  partyName: {
    fontSize: 12,
    fontWeight: 600,
    marginBottom: 4,
  },
  badge: {
    display: 'flex',
    paddingHorizontal: 6,
    paddingVertical: 2,
    backgroundColor: '#e0e0e0',
    borderRadius: 4,
    fontSize: 9,
    marginRight: 4,
  },
  badgesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    marginBottom: 8,
  },
  footer: {
    marginTop: 'auto',
    paddingTop: 20,
    borderTopWidth: 1,
    borderTopColor: '#e0e0e0',
    fontSize: 9,
    color: '#666666',
  },
  signatureSection: {
    flexDirection: 'row',
    marginTop: 40,
    gap: 40,
  },
  signatureBox: {
    flex: 1,
  },
  signatureLine: {
    borderBottomWidth: 1,
    borderBottomColor: '#000000',
    marginBottom: 8,
    height: 40,
  },
  signatureLabel: {
    fontSize: 10,
    color: '#666666',
  },
  amount: {
    fontSize: 14,
    fontWeight: 600,
  },
  amountMuted: {
    fontSize: 11,
    color: '#666666',
  },
  // Legal clauses styles
  legalClausesHeader: {
    marginTop: 20,
    marginBottom: 12,
    paddingBottom: 6,
    borderBottomWidth: 2,
    borderBottomColor: '#333333',
  },
  legalClausesTitle: {
    fontSize: 14,
    fontWeight: 700,
  },
  legalSection: {
    marginTop: 14,
    marginBottom: 10,
  },
  legalSectionTitle: {
    fontSize: 11,
    fontWeight: 600,
    marginBottom: 8,
    color: '#111111',
  },
  legalSubsection: {
    marginBottom: 10,
    marginLeft: 0,
  },
  legalSubsectionTitle: {
    fontSize: 10,
    fontWeight: 600,
    color: '#333333',
    marginBottom: 3,
  },
  legalSubsectionContent: {
    fontSize: 9,
    lineHeight: 1.5,
    textAlign: 'justify',
    color: '#333333',
  },
});

export function getFontFamily(language: EngagementLanguage): string {
  return language === 'ar' ? 'IBMPlexSansArabic' : 'IBMPlexSans';
}

export function getTextDirection(language: EngagementLanguage): 'rtl' | 'ltr' {
  return language === 'ar' ? 'rtl' : 'ltr';
}

export function getTextAlign(language: EngagementLanguage): 'right' | 'left' {
  return language === 'ar' ? 'right' : 'left';
}
