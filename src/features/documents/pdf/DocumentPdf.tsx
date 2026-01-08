import React from 'react';
import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer';
import type {
  Document as DocumentEntity,
  BusinessProfile,
  Client,
  DocumentLanguage,
} from '../../../types';
import { getTexts, getDocumentTypeLabel } from './texts';
import { getTemplateStyles, getFontFamily, getTextAlign, type TemplateId } from './styles';

// Import fonts (side effect - registers fonts)
import './fonts';

// Format amount from minor units to display string
function formatAmount(amountMinor: number, currency: 'USD' | 'ILS'): string {
  const amount = amountMinor / 100;
  const symbol = currency === 'USD' ? '$' : '₪';

  const formatted = amount.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  return `${symbol}${formatted}`;
}

// Format date string
function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

interface DocumentPdfProps {
  document: DocumentEntity;
  businessProfile: BusinessProfile;
  client?: Client;
  templateId?: TemplateId;
  isOriginal?: boolean;
}

export function DocumentPdf({
  document,
  businessProfile,
  client,
  templateId = 'template1',
  isOriginal = true,
}: DocumentPdfProps) {
  const language = document.language;
  const t = getTexts(language);
  const styles = getTemplateStyles(templateId);
  const fontFamily = getFontFamily(language);
  const textAlign = getTextAlign(language);
  const isRtl = language === 'ar';

  // Dynamic styles based on language
  const dynamicStyles = StyleSheet.create({
    page: {
      fontFamily,
    },
    text: {
      fontFamily,
      textAlign,
    },
    headerRow: {
      flexDirection: isRtl ? 'row-reverse' : 'row',
    },
    tableHeader: {
      flexDirection: isRtl ? 'row-reverse' : 'row',
    },
    tableRow: {
      flexDirection: isRtl ? 'row-reverse' : 'row',
    },
  });

  // Get business name based on language
  const businessName = language === 'ar'
    ? businessProfile.name
    : (businessProfile.nameEn || businessProfile.name);

  const businessAddress = language === 'ar'
    ? businessProfile.address1
    : (businessProfile.address1En || businessProfile.address1);

  const businessCity = language === 'ar'
    ? businessProfile.city
    : (businessProfile.cityEn || businessProfile.city);

  return (
    <Document>
      <Page size="A4" style={[styles.page, dynamicStyles.page]}>
        {/* Accent bar for template2 */}
        {templateId === 'template2' && (
          <View
            style={[
              (styles as typeof import('./styles').template2Styles).accentBar,
              { backgroundColor: businessProfile.primaryColor || '#3b82f6' },
            ]}
          />
        )}

        {/* Header */}
        <View style={[styles.headerRow, dynamicStyles.headerRow]}>
          {/* Business Info */}
          <View style={styles.businessInfo}>
            <Text style={[dynamicStyles.text, { fontWeight: 700, fontSize: 16, marginBottom: 4 }]}>
              {businessName}
            </Text>
            {businessAddress && (
              <Text style={[dynamicStyles.text, { fontSize: 10, color: '#666666' }]}>
                {businessAddress}
              </Text>
            )}
            {businessCity && (
              <Text style={[dynamicStyles.text, { fontSize: 10, color: '#666666' }]}>
                {businessCity}
              </Text>
            )}
            {businessProfile.email && (
              <Text style={[dynamicStyles.text, { fontSize: 10, color: '#666666' }]}>
                {businessProfile.email}
              </Text>
            )}
            {businessProfile.phone && (
              <Text style={[dynamicStyles.text, { fontSize: 10, color: '#666666' }]}>
                {businessProfile.phone}
              </Text>
            )}
            {businessProfile.taxId && (
              <Text style={[dynamicStyles.text, { fontSize: 10, color: '#666666' }]}>
                Tax ID: {businessProfile.taxId}
              </Text>
            )}
          </View>

          {/* Document Info */}
          <View style={styles.documentInfo}>
            <Text style={[dynamicStyles.text, { fontWeight: 700, fontSize: 18, marginBottom: 8 }]}>
              {getDocumentTypeLabel(document.type, language)} #{document.number}
            </Text>
            <Text style={[dynamicStyles.text, { fontSize: 11 }]}>
              {t.issued}: {formatDate(document.issueDate)}
            </Text>
            {document.dueDate && (
              <Text style={[dynamicStyles.text, { fontSize: 11 }]}>
                {t.due}: {formatDate(document.dueDate)}
              </Text>
            )}
          </View>
        </View>

        {/* Subject & Brief */}
        {(document.subject || document.brief) && (
          <View style={{ marginBottom: 15 }}>
            {document.subject && (
              <Text style={[dynamicStyles.text, { fontWeight: 600, marginBottom: 4 }]}>
                {document.subject}
              </Text>
            )}
            {document.brief && (
              <Text style={[dynamicStyles.text, { fontSize: 11, color: '#666666' }]}>
                {document.brief}
              </Text>
            )}
          </View>
        )}

        {/* Client Section */}
        {client && (
          <View
            style={[
              styles.clientSection,
              templateId === 'template2' && {
                borderLeftColor: businessProfile.primaryColor || '#3b82f6',
              },
            ]}
          >
            <Text style={[dynamicStyles.text, { fontSize: 10, color: '#666666', marginBottom: 4 }]}>
              {t.bill_to}:
            </Text>
            <Text style={[dynamicStyles.text, { fontWeight: 600 }]}>{client.name}</Text>
            {client.email && (
              <Text style={[dynamicStyles.text, { fontSize: 11 }]}>{client.email}</Text>
            )}
            {client.phone && (
              <Text style={[dynamicStyles.text, { fontSize: 11 }]}>{client.phone}</Text>
            )}
          </View>
        )}

        {/* Original/Copy Label */}
        <View style={styles.documentLabel}>
          <Text>{isOriginal ? t.original.toUpperCase() : t.copy.toUpperCase()}</Text>
        </View>

        {/* Items Table */}
        <View style={styles.itemsTable}>
          {/* Table Header */}
          <View style={[styles.tableHeader, dynamicStyles.tableHeader]}>
            <Text style={[dynamicStyles.text, { width: '45%', fontWeight: 600 }]}>{t.item}</Text>
            <Text style={[dynamicStyles.text, { width: '15%', textAlign: 'center', fontWeight: 600 }]}>
              {t.quantity}
            </Text>
            <Text style={[dynamicStyles.text, { width: '20%', textAlign: 'right', fontWeight: 600 }]}>
              {t.rate}
            </Text>
            <Text style={[dynamicStyles.text, { width: '20%', textAlign: 'right', fontWeight: 600 }]}>
              {t.price}
            </Text>
          </View>

          {/* Table Rows */}
          {document.items.map((item, index) => {
            const itemTotal = item.quantity * item.rateMinor;
            return (
              <View key={index} style={[styles.tableRow, dynamicStyles.tableRow]}>
                <Text style={[dynamicStyles.text, { width: '45%' }]}>{item.name}</Text>
                <Text style={[dynamicStyles.text, { width: '15%', textAlign: 'center' }]}>
                  {item.quantity}
                </Text>
                <Text style={[dynamicStyles.text, { width: '20%', textAlign: 'right' }]}>
                  {formatAmount(item.rateMinor, document.currency)}
                </Text>
                <Text style={[dynamicStyles.text, { width: '20%', textAlign: 'right' }]}>
                  {formatAmount(itemTotal, document.currency)}
                </Text>
              </View>
            );
          })}
        </View>

        {/* Summary Section */}
        <View style={styles.summarySection}>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>{t.subtotal}:</Text>
            <Text style={styles.summaryValue}>
              {formatAmount(document.subtotalMinor, document.currency)}
            </Text>
          </View>

          {document.discountMinor > 0 && (
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>{t.discount}:</Text>
              <Text style={[styles.summaryValue, { color: '#22c55e' }]}>
                -{formatAmount(document.discountMinor, document.currency)}
              </Text>
            </View>
          )}

          {document.taxMinor > 0 && (
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>
                {t.tax} ({Math.round(document.taxRate * 100)}%):
              </Text>
              <Text style={styles.summaryValue}>
                {formatAmount(document.taxMinor, document.currency)}
              </Text>
            </View>
          )}

          <View style={styles.totalRow}>
            <Text style={[styles.summaryLabel, { fontWeight: 700 }]}>{t.total}:</Text>
            <Text style={[styles.summaryValue, { fontSize: 16 }]}>
              {formatAmount(document.totalMinor, document.currency)}
            </Text>
          </View>
        </View>

        {/* Notes */}
        {document.notes && (
          <View style={styles.notes}>
            <Text style={[dynamicStyles.text, { fontWeight: 600, marginBottom: 4 }]}>
              {t.notes}:
            </Text>
            <Text style={dynamicStyles.text}>{document.notes}</Text>
          </View>
        )}

        {/* Footer */}
        <View style={styles.footer}>
          <Text style={{ textAlign: 'center' }}>{t.digitally_certified}</Text>
        </View>
      </Page>
    </Document>
  );
}

export default DocumentPdf;
