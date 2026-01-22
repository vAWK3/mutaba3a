import { View, Text, Image, StyleSheet } from '@react-pdf/renderer';
import type { EngagementLanguage } from '../../types';
import type { BusinessProfile } from '../../../../types';
import { PAGE, SIZES, COLORS, BORDERS } from '../styles/tokens';
import { getFontFamily, getSansFontFamily, getTextAlign } from '../styles';

// Helper to detect if text contains Arabic characters
function containsArabic(text: string): boolean {
  const arabicPattern = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
  return arabicPattern.test(text);
}

// Get the appropriate font family for a text string (handles mixed language)
function getFontForText(text: string, defaultFont: string, language: EngagementLanguage): string {
  if (containsArabic(text)) {
    return language === 'ar' ? 'Amiri' : 'IBMPlexSansArabic';
  }
  return defaultFont;
}

const styles = StyleSheet.create({
  header: {
    position: 'absolute',
    top: 20,
    left: PAGE.paddingLeft,
    right: PAGE.paddingRight,
    paddingBottom: 12,
    borderBottomWidth: BORDERS.thin,
    borderBottomColor: COLORS.border,
  },
  headerContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  headerContentRtl: {
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
    width: 48,
    height: 48,
    objectFit: 'contain',
  },
  businessInfo: {
    flexDirection: 'column',
    justifyContent: 'center',
  },
  businessName: {
    fontSize: SIZES.headerBusiness,
    fontWeight: 700,
    marginBottom: 2,
    color: COLORS.text,
  },
  businessDetail: {
    fontSize: SIZES.headerDetail,
    color: COLORS.textMuted,
    marginTop: 1,
  },
  contactInfo: {
    flexDirection: 'column',
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  contactInfoRtl: {
    alignItems: 'flex-start',
  },
  contactText: {
    fontSize: SIZES.headerDetail,
    color: COLORS.textMuted,
    marginTop: 1,
  },
});

export interface EngagementHeaderProps {
  profile: BusinessProfile;
  language: EngagementLanguage;
  variant?: 'cover' | 'inner';
}

export function EngagementHeader({
  profile,
  language,
  variant = 'cover',
}: EngagementHeaderProps) {
  const fontFamily = getFontFamily(language);
  const sansFontFamily = getSansFontFamily(language);
  const textAlign = getTextAlign(language);
  const isRtl = language === 'ar';

  // Get localized business info from profile
  const businessName = language === 'ar'
    ? profile.name
    : (profile.nameEn || profile.name);

  const businessAddress = language === 'ar'
    ? profile.address1
    : (profile.address1En || profile.address1);

  const businessCity = language === 'ar'
    ? profile.city
    : (profile.cityEn || profile.city);

  const hasLogo = Boolean(profile?.logoDataUrl);

  // Compute fonts for mixed-language content
  const businessNameFont = getFontForText(businessName, fontFamily, language);

  // Inner variant shows compact header (no address)
  const showAddress = variant === 'cover';

  return (
    <View style={styles.header} fixed>
      <View
        style={
          isRtl
            ? [styles.headerContent, styles.headerContentRtl]
            : styles.headerContent
        }
      >
        {/* Logo + Business Name Section */}
        <View
          style={
            isRtl
              ? [styles.logoSection, styles.logoSectionRtl]
              : styles.logoSection
          }
        >
          {hasLogo && (
            <Image src={profile.logoDataUrl!} style={styles.logo} />
          )}
          <View style={styles.businessInfo}>
            <Text
              style={[
                styles.businessName,
                { fontFamily: businessNameFont, textAlign },
              ]}
            >
              {businessName}
            </Text>
            {showAddress && businessAddress && (
              <Text
                style={[
                  styles.businessDetail,
                  {
                    fontFamily: getFontForText(businessAddress, sansFontFamily, language),
                    textAlign,
                  },
                ]}
              >
                {businessAddress}
              </Text>
            )}
            {showAddress && businessCity && (
              <Text
                style={[
                  styles.businessDetail,
                  {
                    fontFamily: getFontForText(businessCity, sansFontFamily, language),
                    textAlign,
                  },
                ]}
              >
                {businessCity}
              </Text>
            )}
          </View>
        </View>

        {/* Contact Info Section */}
        <View
          style={
            isRtl
              ? [styles.contactInfo, styles.contactInfoRtl]
              : styles.contactInfo
          }
        >
          {profile.email && (
            <Text style={[styles.contactText, { fontFamily: sansFontFamily }]}>
              {profile.email}
            </Text>
          )}
          {profile.phone && (
            <Text style={[styles.contactText, { fontFamily: sansFontFamily }]}>
              {profile.phone}
            </Text>
          )}
          {profile.website && (
            <Text style={[styles.contactText, { fontFamily: sansFontFamily }]}>
              {profile.website}
            </Text>
          )}
        </View>
      </View>
    </View>
  );
}

export default EngagementHeader;
