import { Page, View, Text, StyleSheet } from '@react-pdf/renderer';
import type { EngagementSnapshot, EngagementLanguage, EngagementType, EngagementCategory } from '../../types';
import type { Client, BusinessProfile } from '../../../../types';
import { PAGE, SIZES, COLORS, SPACING } from '../styles/tokens';
import { getFontFamily, getSansFontFamily, getTextAlign } from '../styles';
import { getTexts, getEngagementTypeLabel, getCategoryLabel } from '../texts';
import { EngagementHeader } from '../components/EngagementHeader';
import { EngagementFooter } from '../components/EngagementFooter';
import { SignatureBlock } from '../components/SignatureBlock';

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

// Format date for letter
function formatLetterDate(dateString: string | undefined, language: EngagementLanguage): string {
  const date = dateString ? new Date(dateString) : new Date();
  const locale = language === 'ar' ? 'ar-EG' : 'en-GB';
  return date.toLocaleDateString(locale, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

const styles = StyleSheet.create({
  page: {
    paddingTop: PAGE.contentStartWithHeader,
    paddingBottom: PAGE.paddingBottom + 20,
    paddingLeft: PAGE.paddingLeft,
    paddingRight: PAGE.paddingRight,
    backgroundColor: COLORS.background,
  },
  pageNoHeader: {
    paddingTop: PAGE.contentStartNoHeader,
  },
  letterDate: {
    fontSize: SIZES.letterBody,
    marginBottom: SPACING.section,
    color: COLORS.text,
  },
  recipientBlock: {
    marginBottom: SPACING.section,
  },
  recipientName: {
    fontSize: SIZES.letterBody,
    fontWeight: 600,
    color: COLORS.text,
    marginBottom: 2,
  },
  recipientDetail: {
    fontSize: SIZES.letterSmall,
    color: COLORS.textMuted,
    marginTop: 2,
  },
  subjectLine: {
    fontSize: SIZES.letterBody,
    fontWeight: 600,
    marginBottom: SPACING.section,
    color: COLORS.text,
  },
  paragraph: {
    fontSize: SIZES.letterBody,
    lineHeight: 1.6,
    marginBottom: SPACING.paragraph,
    color: COLORS.text,
  },
  scopeList: {
    marginBottom: SPACING.section,
  },
  scopeListItem: {
    flexDirection: 'row',
    marginBottom: SPACING.listItem,
  },
  scopeListItemRtl: {
    flexDirection: 'row-reverse',
  },
  scopeBullet: {
    width: 16,
    fontSize: SIZES.letterBody,
    color: COLORS.text,
  },
  scopeContent: {
    flex: 1,
    fontSize: SIZES.letterBody,
    color: COLORS.text,
  },
  signOffSection: {
    marginTop: SPACING.sectionLarge,
    marginBottom: SPACING.section,
  },
  signOff: {
    fontSize: SIZES.letterBody,
    marginBottom: SPACING.paragraph,
    color: COLORS.text,
  },
});

export interface CoverLetterPageProps {
  snapshot: EngagementSnapshot;
  client?: Client;
  language: EngagementLanguage;
  type: EngagementType;
  category: EngagementCategory;
  profile?: BusinessProfile;
}

export function CoverLetterPage({
  snapshot,
  client,
  language,
  type,
  category,
  profile,
}: CoverLetterPageProps) {
  const t = getTexts(language);
  const fontFamily = getFontFamily(language);
  const sansFontFamily = getSansFontFamily(language);
  const textAlign = getTextAlign(language);
  const isRtl = language === 'ar';
  const isTask = type === 'task';

  // Get localized business name from profile
  const businessName = profile
    ? (language === 'ar' ? profile.name : (profile.nameEn || profile.name))
    : t.provider;

  const clientName = client?.name || snapshot.clientName || t.client;
  const clientNameFont = getFontForText(clientName, fontFamily, language);

  // Build brief scope overview for letter body (max 3 items)
  const deliverables = snapshot.deliverables || [];
  const scopeOverview = deliverables.slice(0, 3).map(d => d.description);
  const hasMoreDeliverables = deliverables.length > 3;

  return (
    <Page
      size="A4"
      style={[styles.page, !profile ? styles.pageNoHeader : {}]}
    >
      {/* Header */}
      {profile && (
        <EngagementHeader profile={profile} language={language} variant="cover" />
      )}

      {/* Footer */}
      <EngagementFooter language={language} />

      {/* Letter Date */}
      <Text style={[styles.letterDate, { fontFamily, textAlign }]}>
        {formatLetterDate(snapshot.startDate, language)}
      </Text>

      {/* Recipient Block */}
      <View style={styles.recipientBlock}>
        <Text style={[styles.recipientName, { fontFamily: clientNameFont, textAlign }]}>
          {clientName}
        </Text>
        {client?.email && (
          <Text style={[styles.recipientDetail, { fontFamily: sansFontFamily, textAlign }]}>
            {t.byEmail} {client.email}
          </Text>
        )}
      </View>

      {/* Subject Line */}
      <Text style={[styles.subjectLine, { fontFamily, textAlign }]}>
        {t.letterRe} {getEngagementTypeLabel(type, language)} – {getCategoryLabel(category, language)}
      </Text>

      {/* Opening Paragraph */}
      <Text style={[styles.paragraph, { fontFamily, textAlign }]}>
        {isTask ? t.letterOpening : t.letterOpeningRetainer}
      </Text>

      {/* Scope Overview (if deliverables exist) */}
      {scopeOverview.length > 0 && (
        <>
          <Text style={[styles.paragraph, { fontFamily, textAlign }]}>
            {snapshot.title || (isTask ? t.deliverables : t.includedServices)}:
          </Text>
          <View style={styles.scopeList}>
            {scopeOverview.map((item, index) => (
              <View
                key={index}
                style={isRtl ? [styles.scopeListItem, styles.scopeListItemRtl] : styles.scopeListItem}
              >
                <Text style={[styles.scopeBullet, { fontFamily }]}>•</Text>
                <Text style={[styles.scopeContent, { fontFamily, textAlign }]}>
                  {item}
                </Text>
              </View>
            ))}
            {hasMoreDeliverables && (
              <View
                style={isRtl ? [styles.scopeListItem, styles.scopeListItemRtl] : styles.scopeListItem}
              >
                <Text style={[styles.scopeBullet, { fontFamily }]}>•</Text>
                <Text style={[styles.scopeContent, { fontFamily, textAlign, fontStyle: 'italic' }]}>
                  {t.letterSeeSchedules}
                </Text>
              </View>
            )}
          </View>
        </>
      )}

      {/* Closing Paragraph */}
      <Text style={[styles.paragraph, { fontFamily, textAlign }]}>
        {t.letterClosing}
      </Text>

      {/* See Schedules Reference */}
      <Text style={[styles.paragraph, { fontFamily, textAlign }]}>
        {t.letterSeeSchedules}
      </Text>

      {/* Sign Off */}
      <View style={styles.signOffSection}>
        <Text style={[styles.signOff, { fontFamily, textAlign }]}>
          {t.letterSignOff}
        </Text>
        <Text style={[styles.recipientName, { fontFamily: getFontForText(businessName, fontFamily, language), textAlign }]}>
          {businessName}
        </Text>
      </View>

      {/* Signature Blocks */}
      <SignatureBlock
        language={language}
        providerName={businessName}
        clientName={clientName}
      />
    </Page>
  );
}

export default CoverLetterPage;
