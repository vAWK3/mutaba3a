import { View, Text, Image, StyleSheet } from '@react-pdf/renderer';
import type { BusinessProfile, DocumentLanguage } from '../../../types';
import { getFontFamily, getTextAlign } from './styles';

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 20,
    paddingBottom: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  headerRtl: {
    flexDirection: 'row-reverse',
  },
  logoSection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  logoSectionRtl: {
    flexDirection: 'row-reverse',
  },
  logo: {
    width: 50,
    height: 50,
    objectFit: 'contain',
  },
  businessInfo: {
    flexDirection: 'column',
  },
  businessName: {
    fontSize: 16,
    fontWeight: 700,
    marginBottom: 2,
  },
  businessDetail: {
    fontSize: 9,
    color: '#666666',
    marginTop: 1,
  },
  contactInfo: {
    flexDirection: 'column',
    alignItems: 'flex-end',
  },
  contactInfoRtl: {
    alignItems: 'flex-start',
  },
  contactText: {
    fontSize: 9,
    color: '#666666',
    marginTop: 1,
  },
});

interface PdfHeaderProps {
  businessProfile: BusinessProfile;
  language: DocumentLanguage;
}

export function PdfHeader({ businessProfile, language }: PdfHeaderProps) {
  const isRtl = language === 'ar';
  const fontFamily = getFontFamily(language);
  const textAlign = getTextAlign(language);

  // Get localized business info
  const businessName = language === 'ar'
    ? businessProfile.name
    : (businessProfile.nameEn || businessProfile.name);

  const businessAddress = language === 'ar'
    ? businessProfile.address1
    : (businessProfile.address1En || businessProfile.address1);

  const businessCity = language === 'ar'
    ? businessProfile.city
    : (businessProfile.cityEn || businessProfile.city);

  const hasLogo = Boolean(businessProfile.logoDataUrl);

  return (
    <View style={isRtl ? [styles.header, styles.headerRtl] : styles.header}>
      {/* Logo + Business Name Section */}
      <View style={isRtl ? [styles.logoSection, styles.logoSectionRtl] : styles.logoSection}>
        {hasLogo && (
          <Image src={businessProfile.logoDataUrl!} style={styles.logo} />
        )}
        <View style={styles.businessInfo}>
          <Text style={[styles.businessName, { fontFamily, textAlign }]}>
            {businessName}
          </Text>
          {businessAddress && (
            <Text style={[styles.businessDetail, { fontFamily, textAlign }]}>
              {businessAddress}
            </Text>
          )}
          {businessCity && (
            <Text style={[styles.businessDetail, { fontFamily, textAlign }]}>
              {businessCity}
            </Text>
          )}
        </View>
      </View>

      {/* Contact Info Section */}
      <View style={isRtl ? [styles.contactInfo, styles.contactInfoRtl] : styles.contactInfo}>
        {businessProfile.email && (
          <Text style={[styles.contactText, { fontFamily }]}>
            {businessProfile.email}
          </Text>
        )}
        {businessProfile.phone && (
          <Text style={[styles.contactText, { fontFamily }]}>
            {businessProfile.phone}
          </Text>
        )}
        {businessProfile.website && (
          <Text style={[styles.contactText, { fontFamily }]}>
            {businessProfile.website}
          </Text>
        )}
        {businessProfile.taxId && (
          <Text style={[styles.contactText, { fontFamily }]}>
            {businessProfile.taxId}
          </Text>
        )}
      </View>
    </View>
  );
}
