import { Document, Page, Text, View, Image, StyleSheet } from '@react-pdf/renderer';
import type { EngagementSnapshot, EngagementLanguage, EngagementType, EngagementCategory } from '../types';
import type { Client, BusinessProfile } from '../../../types';
import { getTexts, getEngagementTypeLabel, getCategoryLabel } from './texts';
import { engagementStyles, getFontFamily, getTextAlign } from './styles';
import { processClausesForPdf, type ClauseSection } from './clauses';

// Import fonts (side effect - registers fonts)
import '../../documents/pdf/fonts';

// Helper to detect if text contains Arabic characters
function containsArabic(text: string): boolean {
  const arabicPattern = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
  return arabicPattern.test(text);
}

// Get the appropriate font family for a text string (handles mixed language)
function getFontForText(text: string, defaultFont: string): string {
  if (containsArabic(text)) {
    return 'IBMPlexSansArabic';
  }
  return defaultFont;
}

// Styles for the branded header (fixed on every page)
const brandedHeaderStyles = StyleSheet.create({
  brandedHeader: {
    position: 'absolute',
    top: 20,
    left: 20,
    right: 20,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingBottom: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  brandedHeaderRtl: {
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

// Format amount from minor units to display string
function formatAmount(amountMinor: number, currency: string): string {
  const amount = amountMinor / 100;
  const symbols: Record<string, string> = { USD: '$', ILS: '₪', EUR: '€' };
  const symbol = symbols[currency] || '';

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

interface EngagementPdfProps {
  snapshot: EngagementSnapshot;
  client?: Client;
  language: EngagementLanguage;
  type: EngagementType;
  category: EngagementCategory;
  profile?: BusinessProfile;
}

export function EngagementPdf({
  snapshot,
  client,
  language,
  type,
  category,
  profile,
}: EngagementPdfProps) {
  const t = getTexts(language);
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
    row: {
      flexDirection: isRtl ? 'row-reverse' : 'row',
    },
  });

  const isTask = type === 'task';

  // Process legal clauses based on toggles
  const legalClauses = processClausesForPdf(language, snapshot);

  // Get localized business info from profile
  const businessName = profile
    ? (language === 'ar' ? profile.name : (profile.nameEn || profile.name))
    : t.provider;

  const businessAddress = profile
    ? (language === 'ar' ? profile.address1 : (profile.address1En || profile.address1))
    : undefined;

  const businessCity = profile
    ? (language === 'ar' ? profile.city : (profile.cityEn || profile.city))
    : undefined;

  const hasLogo = Boolean(profile?.logoDataUrl);

  // Compute fonts for mixed-language content
  const businessNameFont = getFontForText(businessName, fontFamily);
  const clientNameFont = getFontForText(client?.name || snapshot.clientName || '', fontFamily);

  return (
    <Document>
      <Page size="A4" style={[engagementStyles.page, dynamicStyles.page, profile ? { paddingTop: 90 } : {}]}>
        {/* Branded Header - Fixed on every page */}
        {profile && (
          <View
            style={isRtl ? [brandedHeaderStyles.brandedHeader, brandedHeaderStyles.brandedHeaderRtl] : brandedHeaderStyles.brandedHeader}
            fixed
          >
            {/* Logo + Business Name Section */}
            <View style={isRtl ? [brandedHeaderStyles.logoSection, brandedHeaderStyles.logoSectionRtl] : brandedHeaderStyles.logoSection}>
              {hasLogo && (
                <Image src={profile.logoDataUrl!} style={brandedHeaderStyles.logo} />
              )}
              <View style={brandedHeaderStyles.businessInfo}>
                <Text style={[brandedHeaderStyles.businessName, { fontFamily: businessNameFont, textAlign }]}>
                  {businessName}
                </Text>
                {businessAddress && (
                  <Text style={[brandedHeaderStyles.businessDetail, { fontFamily: getFontForText(businessAddress, fontFamily), textAlign }]}>
                    {businessAddress}
                  </Text>
                )}
                {businessCity && (
                  <Text style={[brandedHeaderStyles.businessDetail, { fontFamily: getFontForText(businessCity, fontFamily), textAlign }]}>
                    {businessCity}
                  </Text>
                )}
              </View>
            </View>

            {/* Contact Info Section */}
            <View style={isRtl ? [brandedHeaderStyles.contactInfo, brandedHeaderStyles.contactInfoRtl] : brandedHeaderStyles.contactInfo}>
              {profile.email && (
                <Text style={[brandedHeaderStyles.contactText, { fontFamily }]}>
                  {profile.email}
                </Text>
              )}
              {profile.phone && (
                <Text style={[brandedHeaderStyles.contactText, { fontFamily }]}>
                  {profile.phone}
                </Text>
              )}
              {profile.website && (
                <Text style={[brandedHeaderStyles.contactText, { fontFamily }]}>
                  {profile.website}
                </Text>
              )}
            </View>
          </View>
        )}

        {/* Document Title */}
        <View style={engagementStyles.header}>
          <Text style={[engagementStyles.title, dynamicStyles.text]}>
            {getEngagementTypeLabel(type, language)}
          </Text>
          <Text style={[engagementStyles.subtitle, dynamicStyles.text]}>
            {getCategoryLabel(category, language)}
          </Text>
        </View>

        {/* Parties */}
        <View style={[engagementStyles.partiesSection, dynamicStyles.row]}>
          <View style={engagementStyles.partyBox}>
            <Text style={[engagementStyles.partyTitle, dynamicStyles.text]}>{t.provider}</Text>
            <Text style={[engagementStyles.partyName, { fontFamily: businessNameFont, textAlign }]}>{businessName}</Text>
          </View>
          <View style={engagementStyles.partyBox}>
            <Text style={[engagementStyles.partyTitle, dynamicStyles.text]}>{t.client}</Text>
            <Text style={[engagementStyles.partyName, { fontFamily: clientNameFont, textAlign }]}>
              {client?.name || snapshot.clientName || '-'}
            </Text>
            {client?.email && (
              <Text style={[{ fontSize: 10 }, dynamicStyles.text]}>{client.email}</Text>
            )}
          </View>
        </View>

        {/* Summary */}
        {(snapshot.title || snapshot.summary) && (
          <View style={engagementStyles.section}>
            <Text style={[engagementStyles.sectionTitle, dynamicStyles.text]}>{t.summary}</Text>
            <View style={engagementStyles.sectionContent}>
              {snapshot.title && (
                <Text style={[engagementStyles.paragraph, dynamicStyles.text, { fontWeight: 600 }]}>
                  {snapshot.title}
                </Text>
              )}
              {snapshot.summary && (
                <Text style={[engagementStyles.paragraph, dynamicStyles.text]}>
                  {snapshot.summary}
                </Text>
              )}
            </View>
          </View>
        )}

        {/* Scope - Deliverables */}
        {snapshot.deliverables && snapshot.deliverables.length > 0 && (
          <View style={engagementStyles.section}>
            <Text style={[engagementStyles.sectionTitle, dynamicStyles.text]}>{t.deliverables}</Text>
            <View style={engagementStyles.list}>
              {snapshot.deliverables.map((item, index) => (
                <View key={item.id || index} style={engagementStyles.listItem}>
                  <Text style={engagementStyles.listBullet}>•</Text>
                  <Text style={[engagementStyles.listContent, dynamicStyles.text]}>
                    {item.description}
                    {item.quantity ? ` (${item.quantity})` : ''}
                    {item.format ? ` - ${item.format}` : ''}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Exclusions */}
        {snapshot.exclusions && snapshot.exclusions.length > 0 && (
          <View style={engagementStyles.section}>
            <Text style={[engagementStyles.sectionTitle, dynamicStyles.text]}>{t.exclusions}</Text>
            <View style={engagementStyles.list}>
              {snapshot.exclusions.map((item, index) => (
                <View key={index} style={engagementStyles.listItem}>
                  <Text style={engagementStyles.listBullet}>•</Text>
                  <Text style={[engagementStyles.listContent, dynamicStyles.text]}>{item}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Dependencies */}
        {snapshot.dependencies && snapshot.dependencies.length > 0 && (
          <View style={engagementStyles.section}>
            <Text style={[engagementStyles.sectionTitle, dynamicStyles.text]}>{t.dependencies}</Text>
            <View style={engagementStyles.list}>
              {snapshot.dependencies.map((item, index) => (
                <View key={index} style={engagementStyles.listItem}>
                  <Text style={engagementStyles.listBullet}>•</Text>
                  <Text style={[engagementStyles.listContent, dynamicStyles.text]}>{item}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Timeline */}
        <View style={engagementStyles.section}>
          <Text style={[engagementStyles.sectionTitle, dynamicStyles.text]}>{t.timeline}</Text>
          <View style={engagementStyles.sectionContent}>
            {snapshot.startDate && (
              <View style={engagementStyles.infoRow}>
                <Text style={[engagementStyles.infoLabel, dynamicStyles.text]}>{t.startDate}:</Text>
                <Text style={[engagementStyles.infoValue, dynamicStyles.text]}>
                  {formatDate(snapshot.startDate)}
                </Text>
              </View>
            )}
            {snapshot.endDate && (
              <View style={engagementStyles.infoRow}>
                <Text style={[engagementStyles.infoLabel, dynamicStyles.text]}>{t.endDate}:</Text>
                <Text style={[engagementStyles.infoValue, dynamicStyles.text]}>
                  {formatDate(snapshot.endDate)}
                </Text>
              </View>
            )}
            <View style={engagementStyles.infoRow}>
              <Text style={[engagementStyles.infoLabel, dynamicStyles.text]}>{t.reviewWindow}:</Text>
              <Text style={[engagementStyles.infoValue, dynamicStyles.text]}>
                {snapshot.reviewWindowDays} {t.days}
              </Text>
            </View>
          </View>
        </View>

        {/* Milestones */}
        {snapshot.milestones && snapshot.milestones.length > 0 && (
          <View style={engagementStyles.section}>
            <Text style={[engagementStyles.sectionTitle, dynamicStyles.text]}>{t.milestones}</Text>
            <View style={engagementStyles.table}>
              {snapshot.milestones.map((milestone, index) => (
                <View key={milestone.id || index} style={engagementStyles.tableRow}>
                  <Text style={[engagementStyles.tableCell, dynamicStyles.text, { flex: 2 }]}>
                    {milestone.title}
                  </Text>
                  <Text style={[engagementStyles.tableCell, dynamicStyles.text, { flex: 1 }]}>
                    {milestone.targetDate ? formatDate(milestone.targetDate) : '-'}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Reviews */}
        <View style={engagementStyles.section}>
          <Text style={[engagementStyles.sectionTitle, dynamicStyles.text]}>{t.reviews}</Text>
          <View style={engagementStyles.sectionContent}>
            <View style={engagementStyles.infoRow}>
              <Text style={[engagementStyles.infoLabel, dynamicStyles.text]}>{t.revisionRounds}:</Text>
              <Text style={[engagementStyles.infoValue, dynamicStyles.text]}>
                {snapshot.revisionRounds} {t.rounds}
              </Text>
            </View>
            {snapshot.bugFixDays && (
              <View style={engagementStyles.infoRow}>
                <Text style={[engagementStyles.infoLabel, dynamicStyles.text]}>{t.bugFixPeriod}:</Text>
                <Text style={[engagementStyles.infoValue, dynamicStyles.text]}>
                  {snapshot.bugFixDays} {t.days}
                </Text>
              </View>
            )}
          </View>
        </View>

        {/* Payment */}
        <View style={engagementStyles.section}>
          <Text style={[engagementStyles.sectionTitle, dynamicStyles.text]}>{t.payment}</Text>
          <View style={engagementStyles.sectionContent}>
            {isTask && snapshot.totalAmountMinor ? (
              <>
                <View style={engagementStyles.infoRow}>
                  <Text style={[engagementStyles.infoLabel, dynamicStyles.text]}>{t.totalAmount}:</Text>
                  <Text style={[engagementStyles.amount, dynamicStyles.text]}>
                    {formatAmount(snapshot.totalAmountMinor, snapshot.currency)}
                  </Text>
                </View>
                {snapshot.depositPercent ? (
                  <View style={engagementStyles.infoRow}>
                    <Text style={[engagementStyles.infoLabel, dynamicStyles.text]}>{t.deposit}:</Text>
                    <Text style={[engagementStyles.infoValue, dynamicStyles.text]}>
                      {snapshot.depositPercent}{t.percent}
                    </Text>
                  </View>
                ) : null}
              </>
            ) : (
              <>
                {snapshot.retainerAmountMinor ? (
                  <View style={engagementStyles.infoRow}>
                    <Text style={[engagementStyles.infoLabel, dynamicStyles.text]}>{t.retainerAmount}:</Text>
                    <Text style={[engagementStyles.amount, dynamicStyles.text]}>
                      {formatAmount(snapshot.retainerAmountMinor, snapshot.currency)}
                    </Text>
                  </View>
                ) : null}
                {snapshot.billingDay && (
                  <View style={engagementStyles.infoRow}>
                    <Text style={[engagementStyles.infoLabel, dynamicStyles.text]}>{t.billingDay}:</Text>
                    <Text style={[engagementStyles.infoValue, dynamicStyles.text]}>
                      {snapshot.billingDay}
                    </Text>
                  </View>
                )}
              </>
            )}
            <View style={engagementStyles.infoRow}>
              <Text style={[engagementStyles.infoLabel, dynamicStyles.text]}>{t.lateFee}:</Text>
              <Text style={[engagementStyles.infoValue, dynamicStyles.text]}>
                {snapshot.lateFeeEnabled ? t.enabled : t.disabled}
              </Text>
            </View>
          </View>
        </View>

        {/* Payment Schedule (Task) */}
        {isTask && snapshot.scheduleItems && snapshot.scheduleItems.length > 0 && (
          <View style={engagementStyles.section}>
            <Text style={[engagementStyles.sectionTitle, dynamicStyles.text]}>{t.paymentSchedule}</Text>
            <View style={engagementStyles.table}>
              {snapshot.scheduleItems.map((item, index) => (
                <View key={item.id || index} style={engagementStyles.tableRow}>
                  <Text style={[engagementStyles.tableCell, dynamicStyles.text, { flex: 2 }]}>
                    {item.label || getTriggerLabel(item.trigger, t)}
                  </Text>
                  <Text style={[engagementStyles.tableCell, dynamicStyles.text, { flex: 1, textAlign: 'right' }]}>
                    {formatAmount(item.amountMinor, item.currency)}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Relationship Terms */}
        <View style={engagementStyles.section}>
          <Text style={[engagementStyles.sectionTitle, dynamicStyles.text]}>{t.relationship}</Text>
          <View style={engagementStyles.sectionContent}>
            <View style={engagementStyles.infoRow}>
              <Text style={[engagementStyles.infoLabel, dynamicStyles.text]}>{t.termType}:</Text>
              <Text style={[engagementStyles.infoValue, dynamicStyles.text]}>
                {snapshot.termType === 'month-to-month' ? t.monthToMonth : t.fixed}
              </Text>
            </View>
            <View style={engagementStyles.infoRow}>
              <Text style={[engagementStyles.infoLabel, dynamicStyles.text]}>{t.terminationNotice}:</Text>
              <Text style={[engagementStyles.infoValue, dynamicStyles.text]}>
                {snapshot.terminationNoticeDays} {t.days}
              </Text>
            </View>
            {snapshot.cancellationCoveragePercent ? (
              <View style={engagementStyles.infoRow}>
                <Text style={[engagementStyles.infoLabel, dynamicStyles.text]}>{t.cancellationCoverage}:</Text>
                <Text style={[engagementStyles.infoValue, dynamicStyles.text]}>
                  {snapshot.cancellationCoveragePercent}{t.percent}
                </Text>
              </View>
            ) : null}
            <View style={engagementStyles.infoRow}>
              <Text style={[engagementStyles.infoLabel, dynamicStyles.text]}>{t.ownershipTransfer}:</Text>
              <Text style={[engagementStyles.infoValue, dynamicStyles.text]}>
                {snapshot.ownershipTransferRule?.replace(/_/g, ' ') || '-'}
              </Text>
            </View>
          </View>
        </View>

        {/* Standard Terms */}
        {/* <View style={engagementStyles.section}>
          <Text style={[engagementStyles.sectionTitle, dynamicStyles.text]}>{t.terms}</Text>
          <View style={engagementStyles.badgesRow}>
            {snapshot.confidentiality && (
              <View style={engagementStyles.badge}>
                <Text style={dynamicStyles.text}>{t.confidentiality}</Text>
              </View>
            )}
            {snapshot.ipOwnership && (
              <View style={engagementStyles.badge}>
                <Text style={dynamicStyles.text}>{t.ipOwnership}</Text>
              </View>
            )}
            {snapshot.warrantyDisclaimer && (
              <View style={engagementStyles.badge}>
                <Text style={dynamicStyles.text}>{t.warranty}</Text>
              </View>
            )}
            {snapshot.limitationOfLiability && (
              <View style={engagementStyles.badge}>
                <Text style={dynamicStyles.text}>{t.liabilityLimit}</Text>
              </View>
            )}
            {snapshot.nonSolicitation && (
              <View style={engagementStyles.badge}>
                <Text style={dynamicStyles.text}>{t.nonSolicitation}</Text>
              </View>
            )}
          </View>
          <View style={engagementStyles.sectionContent}>
            <View style={engagementStyles.infoRow}>
              <Text style={[engagementStyles.infoLabel, dynamicStyles.text]}>{t.disputeResolution}:</Text>
              <Text style={[engagementStyles.infoValue, dynamicStyles.text]}>
                {getDisputePathLabel(snapshot.disputePath, t)}
              </Text>
            </View>
            {snapshot.governingLaw && (
              <View style={engagementStyles.infoRow}>
                <Text style={[engagementStyles.infoLabel, dynamicStyles.text]}>{t.governingLaw}:</Text>
                <Text style={[engagementStyles.infoValue, dynamicStyles.text]}>
                  {snapshot.governingLaw}
                </Text>
              </View>
            )}
          </View>
        </View> */}

        {/* Legal Clauses Sections */}
        {legalClauses.length > 0 && (
          <View wrap={false}>
            <View style={engagementStyles.legalClausesHeader}>
              <Text style={[engagementStyles.legalClausesTitle, dynamicStyles.text]}>
                {t.legalTerms}
              </Text>
            </View>
          </View>
        )}
        {legalClauses.map((section: ClauseSection) => (
          <View key={section.id} style={engagementStyles.legalSection}>
            <Text style={[engagementStyles.legalSectionTitle, dynamicStyles.text]}>
              {section.title}
            </Text>
            {section.subsections.map((subsection) => (
              <View key={subsection.id} style={engagementStyles.legalSubsection}>
                {subsection.title && (
                  <Text style={[engagementStyles.legalSubsectionTitle, dynamicStyles.text]}>
                    {subsection.title}
                  </Text>
                )}
                <Text style={[engagementStyles.legalSubsectionContent, dynamicStyles.text]}>
                  {subsection.content}
                </Text>
              </View>
            ))}
          </View>
        ))}

        {/* Signatures */}
        <View style={[engagementStyles.signatureSection, dynamicStyles.row]}>
          <View style={engagementStyles.signatureBox}>
            <View style={engagementStyles.signatureLine} />
            <Text style={[engagementStyles.signatureLabel, dynamicStyles.text]}>{t.provider}</Text>
          </View>
          <View style={engagementStyles.signatureBox}>
            <View style={engagementStyles.signatureLine} />
            <Text style={[engagementStyles.signatureLabel, dynamicStyles.text]}>{t.client}</Text>
          </View>
        </View>

        {/* Footer */}
        <View style={engagementStyles.footer}>
          <Text style={dynamicStyles.text}>{t.generatedBy}</Text>
        </View>
      </Page>
    </Document>
  );
}

function getTriggerLabel(trigger: string, t: ReturnType<typeof getTexts>): string {
  const labels: Record<string, string> = {
    on_signing: t.onSigning,
    on_milestone: t.onMilestone,
    on_completion: t.onCompletion,
    monthly: t.monthly,
  };
  return labels[trigger] || trigger;
}

// function getDisputePathLabel(path: string | undefined, t: ReturnType<typeof getTexts>): string {
//   const labels: Record<string, string> = {
//     negotiation: t.negotiation,
//     mediation: t.mediation,
//     arbitration: t.arbitration,
//   };
//   return path ? labels[path] || path : '-';
// }

export default EngagementPdf;
