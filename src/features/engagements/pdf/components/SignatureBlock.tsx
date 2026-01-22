import { View, Text, StyleSheet } from '@react-pdf/renderer';
import type { EngagementLanguage } from '../../types';
import { SIZES, COLORS, SPACING } from '../styles/tokens';
import { getFontFamily, getSansFontFamily, getTextAlign } from '../styles';
import { getTexts } from '../texts';

const styles = StyleSheet.create({
  signatureSection: {
    marginTop: SPACING.sectionLarge,
    flexDirection: 'row',
    gap: 40,
  },
  signatureSectionRtl: {
    flexDirection: 'row-reverse',
  },
  signatureBox: {
    flex: 1,
  },
  signatureLine: {
    borderBottomWidth: 1,
    borderBottomColor: COLORS.text,
    marginBottom: 8,
    height: 50,
  },
  signatureLabel: {
    fontSize: SIZES.scheduleSmall,
    color: COLORS.textMuted,
    marginBottom: 4,
  },
  signatureName: {
    fontSize: SIZES.scheduleBody,
    fontWeight: 600,
    color: COLORS.text,
    marginBottom: 16,
  },
  dateSection: {
    marginTop: SPACING.section,
  },
  dateLabel: {
    fontSize: SIZES.scheduleSmall,
    color: COLORS.textMuted,
    marginBottom: 4,
  },
  dateLine: {
    borderBottomWidth: 1,
    borderBottomColor: COLORS.text,
    width: 150,
    height: 20,
  },
});

export interface SignatureBlockProps {
  language: EngagementLanguage;
  providerName: string;
  clientName: string;
}

export function SignatureBlock({
  language,
  providerName,
  clientName,
}: SignatureBlockProps) {
  const t = getTexts(language);
  const fontFamily = getFontFamily(language);
  const sansFontFamily = getSansFontFamily(language);
  const textAlign = getTextAlign(language);
  const isRtl = language === 'ar';

  return (
    <View wrap={false}>
      <View
        style={
          isRtl
            ? [styles.signatureSection, styles.signatureSectionRtl]
            : styles.signatureSection
        }
      >
        {/* Provider Signature */}
        <View style={styles.signatureBox}>
          <Text style={[styles.signatureLabel, { fontFamily: sansFontFamily, textAlign }]}>
            {t.provider}
          </Text>
          <Text style={[styles.signatureName, { fontFamily, textAlign }]}>
            {providerName}
          </Text>
          <View style={styles.signatureLine} />
          <Text style={[styles.signatureLabel, { fontFamily: sansFontFamily, textAlign }]}>
            {t.signatures}
          </Text>
        </View>

        {/* Client Signature */}
        <View style={styles.signatureBox}>
          <Text style={[styles.signatureLabel, { fontFamily: sansFontFamily, textAlign }]}>
            {t.client}
          </Text>
          <Text style={[styles.signatureName, { fontFamily, textAlign }]}>
            {clientName}
          </Text>
          <View style={styles.signatureLine} />
          <Text style={[styles.signatureLabel, { fontFamily: sansFontFamily, textAlign }]}>
            {t.signatures}
          </Text>
        </View>
      </View>

      {/* Date Section */}
      <View style={styles.dateSection}>
        <Text style={[styles.dateLabel, { fontFamily: sansFontFamily, textAlign }]}>
          {t.startDate}
        </Text>
        <View style={styles.dateLine} />
      </View>
    </View>
  );
}

export default SignatureBlock;
