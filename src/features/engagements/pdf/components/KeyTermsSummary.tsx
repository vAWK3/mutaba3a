import { View, Text, StyleSheet } from '@react-pdf/renderer';
import type { EngagementSnapshot, EngagementLanguage, EngagementType, EngagementCategory } from '../../types';
import type { Client } from '../../../../types';
import { SIZES, COLORS, BORDERS, SPACING } from '../styles/tokens';
import { getFontFamily, getSansFontFamily, getTextAlign } from '../styles';
import { buildKeyTermsRows } from '../utils/buildKeyTermsRows';

// Key Terms specific texts
interface KeyTermsTexts {
  title: string;
  precedence: string;
  acknowledge: string;
}

const keyTermsTextsEn: KeyTermsTexts = {
  title: 'Key Terms Summary',
  precedence: 'This Key Terms Summary forms part of this engagement letter. If there is any conflict between this Key Terms Summary and other sections, this Key Terms Summary will control.',
  acknowledge: 'Client acknowledges these Key Terms by signing this letter.',
};

const keyTermsTextsAr: KeyTermsTexts = {
  title: 'ملخص الشروط الأساسية',
  precedence: 'يشكّل ملخص الشروط الأساسية جزءًا من خطاب التعاقد هذا. وفي حال وجود أي تعارض بين ملخص الشروط الأساسية وأي قسم آخر، يُعتد بملخص الشروط الأساسية.',
  acknowledge: 'يُقر العميل بالشروط الأساسية أعلاه بتوقيع هذا الخطاب.',
};

function getKeyTermsTexts(language: EngagementLanguage): KeyTermsTexts {
  return language === 'ar' ? keyTermsTextsAr : keyTermsTextsEn;
}

const styles = StyleSheet.create({
  container: {
    marginBottom: SPACING.sectionLarge,
  },
  title: {
    fontSize: SIZES.sectionTitle,
    fontWeight: 700,
    marginBottom: SPACING.paragraph,
    color: COLORS.text,
  },
  precedenceClause: {
    fontSize: SIZES.scheduleBody,
    lineHeight: 1.5,
    marginBottom: SPACING.section,
    color: COLORS.text,
  },
  table: {
    marginBottom: SPACING.section,
  },
  tableRow: {
    flexDirection: 'row',
    borderBottomWidth: BORDERS.thin,
    borderBottomColor: COLORS.border,
  },
  tableRowRtl: {
    flexDirection: 'row-reverse',
  },
  tableRowFirst: {
    borderTopWidth: BORDERS.thin,
    borderTopColor: COLORS.border,
  },
  labelCell: {
    width: '35%',
    paddingVertical: SPACING.tableCellPadding,
    paddingHorizontal: 8,
    borderRightWidth: BORDERS.thin,
    borderRightColor: COLORS.border,
  },
  labelCellRtl: {
    borderRightWidth: 0,
    borderLeftWidth: BORDERS.thin,
    borderLeftColor: COLORS.border,
  },
  valueCell: {
    width: '65%',
    paddingVertical: SPACING.tableCellPadding,
    paddingHorizontal: 8,
  },
  labelText: {
    fontSize: SIZES.scheduleBody,
    color: COLORS.textMuted,
  },
  valueText: {
    fontSize: SIZES.scheduleBody,
    color: COLORS.text,
  },
  valueTextEmphasize: {
    fontWeight: 600,
  },
  acknowledgeLine: {
    fontSize: SIZES.scheduleSmall,
    color: COLORS.textMuted,
    fontStyle: 'italic',
    marginTop: SPACING.paragraph,
  },
});

export interface KeyTermsSummaryProps {
  snapshot: EngagementSnapshot;
  client?: Client;
  language: EngagementLanguage;
  type: EngagementType;
  category: EngagementCategory;
  showAcknowledge?: boolean;
}

export function KeyTermsSummary({
  snapshot,
  client,
  language,
  type,
  category,
  showAcknowledge = false,
}: KeyTermsSummaryProps) {
  const t = getKeyTermsTexts(language);
  const fontFamily = getFontFamily(language);
  const sansFontFamily = getSansFontFamily(language);
  const textAlign = getTextAlign(language);
  const isRtl = language === 'ar';

  const rows = buildKeyTermsRows({
    snapshot,
    client,
    language,
    type,
    category,
  });

  return (
    <View style={styles.container}>
      {/* Section Title */}
      <Text style={[styles.title, { fontFamily, textAlign }]}>
        {t.title}
      </Text>

      {/* Precedence Clause */}
      <Text style={[styles.precedenceClause, { fontFamily, textAlign }]}>
        {t.precedence}
      </Text>

      {/* Terms Table */}
      <View style={styles.table}>
        {rows.map((row, index) => (
          <View
            key={row.label}
            style={[
              styles.tableRow,
              index === 0 && styles.tableRowFirst,
              isRtl && styles.tableRowRtl,
            ]}
          >
            <View
              style={[
                styles.labelCell,
                isRtl && styles.labelCellRtl,
              ]}
            >
              <Text style={[styles.labelText, { fontFamily: sansFontFamily, textAlign }]}>
                {row.label}
              </Text>
            </View>
            <View style={styles.valueCell}>
              <Text
                style={[
                  styles.valueText,
                  row.emphasize && styles.valueTextEmphasize,
                  { fontFamily, textAlign },
                ]}
              >
                {row.value}
              </Text>
            </View>
          </View>
        ))}
      </View>

      {/* Acknowledgment Line */}
      {showAcknowledge && (
        <Text style={[styles.acknowledgeLine, { fontFamily, textAlign }]}>
          {t.acknowledge}
        </Text>
      )}
    </View>
  );
}

export default KeyTermsSummary;
