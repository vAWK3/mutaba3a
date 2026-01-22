import { View, Text, StyleSheet } from '@react-pdf/renderer';
import type { EngagementLanguage } from '../../types';
import { PAGE, SIZES, COLORS, BORDERS } from '../styles/tokens';
import { getSansFontFamily, getTextAlign } from '../styles';
import { getTexts } from '../texts';

const styles = StyleSheet.create({
  footer: {
    position: 'absolute',
    bottom: 20,
    left: PAGE.paddingLeft,
    right: PAGE.paddingRight,
    paddingTop: 8,
    borderTopWidth: BORDERS.thin,
    borderTopColor: COLORS.border,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  footerRtl: {
    flexDirection: 'row-reverse',
  },
  documentLabel: {
    fontSize: SIZES.pageNumber,
    color: COLORS.textMuted,
  },
  pageNumber: {
    fontSize: SIZES.pageNumber,
    color: COLORS.textMuted,
  },
});

export interface EngagementFooterProps {
  language: EngagementLanguage;
  documentLabel?: string;
}

export function EngagementFooter({
  language,
  documentLabel,
}: EngagementFooterProps) {
  const t = getTexts(language);
  const fontFamily = getSansFontFamily(language);
  const textAlign = getTextAlign(language);
  const isRtl = language === 'ar';

  const label = documentLabel || t.engagementAgreement;

  return (
    <View
      style={isRtl ? [styles.footer, styles.footerRtl] : styles.footer}
      fixed
    >
      <Text style={[styles.documentLabel, { fontFamily, textAlign }]}>
        {label}
      </Text>
      <Text
        style={[styles.pageNumber, { fontFamily }]}
        render={({ pageNumber, totalPages }) =>
          `${pageNumber}/${totalPages}`
        }
      />
    </View>
  );
}

export default EngagementFooter;
