import { View, Text, StyleSheet } from '@react-pdf/renderer';
import type { BusinessProfile, DocumentLanguage, DocumentType } from '../../../types';
import { getTexts } from './texts';
import { getFontFamily, getTextAlign } from './styles';

const styles = StyleSheet.create({
  footer: {
    position: 'absolute',
    bottom: 30,
    left: 40,
    right: 40,
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
    paddingTop: 12,
  },
  footerContent: {
    flexDirection: 'column',
    gap: 8,
  },
  bankDetailsSection: {
    marginBottom: 8,
  },
  bankDetailsTitle: {
    fontSize: 9,
    fontWeight: 600,
    marginBottom: 4,
    color: '#374151',
  },
  bankDetailsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
  },
  bankDetailItem: {
    flexDirection: 'row',
    marginRight: 16,
  },
  bankDetailLabel: {
    fontSize: 8,
    color: '#666666',
    marginRight: 4,
  },
  bankDetailValue: {
    fontSize: 8,
    color: '#374151',
  },
  paymentNotes: {
    fontSize: 8,
    color: '#666666',
    marginTop: 4,
    fontStyle: 'italic',
  },
  contactRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    flexWrap: 'wrap',
    gap: 16,
  },
  contactItem: {
    fontSize: 8,
    color: '#666666',
  },
  pageNumber: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    fontSize: 8,
    color: '#9ca3af',
  },
});

// Document types that should show bank details in footer
const SHOW_BANK_DETAILS_TYPES: DocumentType[] = [
  'invoice',
  'proforma_invoice',
  'invoice_receipt',
];

interface PdfFooterProps {
  businessProfile: BusinessProfile;
  language: DocumentLanguage;
  documentType: DocumentType;
  showBankDetails?: boolean;
}

export function PdfFooter({
  businessProfile,
  language,
  documentType,
  showBankDetails: showBankDetailsOverride,
}: PdfFooterProps) {
  const t = getTexts(language);
  const fontFamily = getFontFamily(language);
  const textAlign = getTextAlign(language);
  const isRtl = language === 'ar';

  // Determine if bank details should be shown
  const shouldShowBankDetails = showBankDetailsOverride !== undefined
    ? showBankDetailsOverride
    : SHOW_BANK_DETAILS_TYPES.includes(documentType);

  // Check if profile has any bank details
  const hasBankDetails = businessProfile.bankName ||
    businessProfile.bankBranch ||
    businessProfile.bankAccountNumber ||
    businessProfile.bankIban;

  // Get localized address
  const businessAddress = language === 'ar'
    ? businessProfile.address1
    : (businessProfile.address1En || businessProfile.address1);

  const businessCity = language === 'ar'
    ? businessProfile.city
    : (businessProfile.cityEn || businessProfile.city);

  const fullAddress = [businessAddress, businessCity].filter(Boolean).join(', ');

  return (
    <View style={styles.footer}>
      <View style={styles.footerContent}>
        {/* Bank Details Section */}
        {shouldShowBankDetails && hasBankDetails && (
          <View style={styles.bankDetailsSection}>
            <Text style={[styles.bankDetailsTitle, { fontFamily, textAlign }]}>
              {t.bank_details}
            </Text>
            <View style={[styles.bankDetailsGrid, { flexDirection: isRtl ? 'row-reverse' : 'row' }]}>
              {businessProfile.bankName && (
                <View style={[styles.bankDetailItem, { flexDirection: isRtl ? 'row-reverse' : 'row' }]}>
                  <Text style={[styles.bankDetailLabel, { fontFamily }]}>{t.bank_name}:</Text>
                  <Text style={[styles.bankDetailValue, { fontFamily }]}>{businessProfile.bankName}</Text>
                </View>
              )}
              {businessProfile.bankBranch && (
                <View style={[styles.bankDetailItem, { flexDirection: isRtl ? 'row-reverse' : 'row' }]}>
                  <Text style={[styles.bankDetailLabel, { fontFamily }]}>{t.branch}:</Text>
                  <Text style={[styles.bankDetailValue, { fontFamily }]}>{businessProfile.bankBranch}</Text>
                </View>
              )}
              {businessProfile.bankAccountNumber && (
                <View style={[styles.bankDetailItem, { flexDirection: isRtl ? 'row-reverse' : 'row' }]}>
                  <Text style={[styles.bankDetailLabel, { fontFamily }]}>{t.account}:</Text>
                  <Text style={[styles.bankDetailValue, { fontFamily }]}>{businessProfile.bankAccountNumber}</Text>
                </View>
              )}
              {businessProfile.bankIban && (
                <View style={[styles.bankDetailItem, { flexDirection: isRtl ? 'row-reverse' : 'row' }]}>
                  <Text style={[styles.bankDetailLabel, { fontFamily }]}>{t.iban}:</Text>
                  <Text style={[styles.bankDetailValue, { fontFamily }]}>{businessProfile.bankIban}</Text>
                </View>
              )}
            </View>
            {businessProfile.paymentNotes && (
              <Text style={[styles.paymentNotes, { fontFamily, textAlign }]}>
                {businessProfile.paymentNotes}
              </Text>
            )}
          </View>
        )}

        {/* Contact Info Row */}
        <View style={[styles.contactRow, { flexDirection: isRtl ? 'row-reverse' : 'row' }]}>
          {businessProfile.email && (
            <Text style={[styles.contactItem, { fontFamily }]}>{businessProfile.email}</Text>
          )}
          {businessProfile.phone && (
            <Text style={[styles.contactItem, { fontFamily }]}>{businessProfile.phone}</Text>
          )}
          {fullAddress && (
            <Text style={[styles.contactItem, { fontFamily }]}>{fullAddress}</Text>
          )}
        </View>
      </View>

      {/* Page Number */}
      <Text
        style={styles.pageNumber}
        render={({ pageNumber, totalPages }) =>
          t.page_of.replace('{0}', String(pageNumber)).replace('{1}', String(totalPages))
        }
        fixed
      />
    </View>
  );
}
