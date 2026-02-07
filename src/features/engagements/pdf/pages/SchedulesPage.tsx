/* eslint-disable react-hooks/static-components */
import { Page, View, Text, StyleSheet } from '@react-pdf/renderer';
import type { EngagementSnapshot, EngagementLanguage, EngagementType, EngagementCategory } from '../../types';
import type { Client, BusinessProfile } from '../../../../types';
import { PAGE, SIZES, COLORS, SPACING, BORDERS } from '../styles/tokens';
import { getFontFamily, getSansFontFamily, getTextAlign } from '../styles';
import { getTexts } from '../texts';
import { processClausesForPdf, type ClauseSection } from '../clauses';
import { EngagementHeader } from '../components/EngagementHeader';
import { EngagementFooter } from '../components/EngagementFooter';
import { KeyTermsSummary } from '../components/KeyTermsSummary';

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
function formatDate(dateString: string, language: EngagementLanguage): string {
  const date = new Date(dateString);
  const locale = language === 'ar' ? 'ar-EG' : 'en-GB';
  return date.toLocaleDateString(locale, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
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
  scheduleSection: {
    marginBottom: SPACING.sectionLarge,
  },
  scheduleTitle: {
    fontSize: SIZES.scheduleTitle,
    fontWeight: 700,
    marginBottom: SPACING.section,
    paddingBottom: SPACING.paragraph,
    borderBottomWidth: BORDERS.regular,
    borderBottomColor: COLORS.text,
    color: COLORS.text,
  },
  subSection: {
    marginBottom: SPACING.section,
  },
  subSectionTitle: {
    fontSize: SIZES.scheduleBody,
    fontWeight: 600,
    marginBottom: SPACING.paragraph,
    color: COLORS.text,
  },
  paragraph: {
    fontSize: SIZES.scheduleBody,
    lineHeight: 1.5,
    marginBottom: SPACING.paragraph,
    color: COLORS.text,
  },
  list: {
    marginBottom: SPACING.paragraph,
  },
  listItem: {
    flexDirection: 'row',
    marginBottom: SPACING.listItem,
  },
  listItemRtl: {
    flexDirection: 'row-reverse',
  },
  listNumber: {
    width: 20,
    fontSize: SIZES.scheduleBody,
    color: COLORS.text,
  },
  listBullet: {
    width: 16,
    fontSize: SIZES.scheduleBody,
    color: COLORS.text,
  },
  listContent: {
    flex: 1,
    fontSize: SIZES.scheduleBody,
    color: COLORS.text,
  },
  infoRow: {
    flexDirection: 'row',
    marginBottom: SPACING.listItem,
  },
  infoRowRtl: {
    flexDirection: 'row-reverse',
  },
  infoLabel: {
    width: 140,
    fontSize: SIZES.scheduleBody,
    color: COLORS.textMuted,
  },
  infoValue: {
    flex: 1,
    fontSize: SIZES.scheduleBody,
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
  tableCell: {
    paddingVertical: SPACING.tableCellPadding,
    paddingHorizontal: 8,
    fontSize: SIZES.scheduleBody,
    color: COLORS.text,
  },
  tableCellLabel: {
    flex: 2,
    borderRightWidth: BORDERS.thin,
    borderRightColor: COLORS.border,
  },
  tableCellLabelRtl: {
    borderRightWidth: 0,
    borderLeftWidth: BORDERS.thin,
    borderLeftColor: COLORS.border,
  },
  tableCellValue: {
    flex: 1,
    textAlign: 'right',
  },
  // Legal clauses styles
  legalClausesHeader: {
    marginTop: SPACING.section,
    marginBottom: SPACING.section,
    paddingBottom: SPACING.paragraph,
    borderBottomWidth: BORDERS.thick,
    borderBottomColor: COLORS.text,
  },
  legalClausesTitle: {
    fontSize: SIZES.sectionTitle,
    fontWeight: 700,
    color: COLORS.text,
  },
  legalSection: {
    marginTop: SPACING.section,
    marginBottom: SPACING.paragraph,
  },
  legalSectionTitle: {
    fontSize: SIZES.clauseTitle,
    fontWeight: 600,
    marginBottom: SPACING.paragraph,
    color: COLORS.text,
  },
  legalSubsection: {
    marginBottom: SPACING.paragraph,
  },
  legalSubsectionTitle: {
    fontSize: SIZES.clauseBody,
    fontWeight: 600,
    color: COLORS.text,
    marginBottom: 3,
  },
  legalSubsectionContent: {
    fontSize: SIZES.clauseBody,
    lineHeight: 1.5,
    textAlign: 'justify',
    color: COLORS.text,
  },
});

export interface SchedulesPageProps {
  snapshot: EngagementSnapshot;
  client?: Client;
  language: EngagementLanguage;
  type: EngagementType;
  category: EngagementCategory;
  profile?: BusinessProfile;
}

export function SchedulesPage({
  snapshot,
  client,
  language,
  type,
  category,
  profile,
}: SchedulesPageProps) {
  const t = getTexts(language);
  const fontFamily = getFontFamily(language);
  const sansFontFamily = getSansFontFamily(language);
  const textAlign = getTextAlign(language);
  const isRtl = language === 'ar';
  const isTask = type === 'task';

  // Process legal clauses based on toggles
  const legalClauses = processClausesForPdf(language, snapshot);
  const hasLegalClauses = legalClauses.length > 0;

  // Helper for info rows
  const InfoRow = ({ label, value }: { label: string; value: string }) => (
    <View style={isRtl ? [styles.infoRow, styles.infoRowRtl] : styles.infoRow}>
      <Text style={[styles.infoLabel, { fontFamily: sansFontFamily, textAlign }]}>{label}</Text>
      <Text style={[styles.infoValue, { fontFamily, textAlign }]}>{value}</Text>
    </View>
  );

  return (
    <Page
      size="A4"
      style={[styles.page, !profile ? styles.pageNoHeader : {}]}
    >
      {/* Header */}
      {profile && (
        <EngagementHeader profile={profile} language={language} variant="inner" />
      )}

      {/* Footer */}
      <EngagementFooter language={language} />

      {/* Key Terms Summary - At the top of schedules page */}
      <KeyTermsSummary
        snapshot={snapshot}
        client={client}
        language={language}
        type={type}
        category={category}
        showAcknowledge
      />

      {/* Schedule A: Scope of Services */}
      <View style={styles.scheduleSection}>
        <Text style={[styles.scheduleTitle, { fontFamily, textAlign }]}>
          {t.scheduleA}
        </Text>

        {/* Deliverables */}
        {snapshot.deliverables && snapshot.deliverables.length > 0 && (
          <View style={styles.subSection}>
            <Text style={[styles.subSectionTitle, { fontFamily, textAlign }]}>
              {t.deliverables}
            </Text>
            <View style={styles.list}>
              {snapshot.deliverables.map((item, index) => (
                <View
                  key={item.id || index}
                  style={isRtl ? [styles.listItem, styles.listItemRtl] : styles.listItem}
                >
                  <Text style={[styles.listNumber, { fontFamily }]}>{index + 1}.</Text>
                  <Text style={[styles.listContent, { fontFamily, textAlign }]}>
                    {item.description}
                    {item.quantity ? ` (${item.quantity})` : ''}
                    {item.format ? ` – ${item.format}` : ''}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Dependencies */}
        {snapshot.dependencies && snapshot.dependencies.length > 0 && (
          <View style={styles.subSection}>
            <Text style={[styles.subSectionTitle, { fontFamily, textAlign }]}>
              {t.dependencies}
            </Text>
            <View style={styles.list}>
              {snapshot.dependencies.map((item, index) => (
                <View
                  key={index}
                  style={isRtl ? [styles.listItem, styles.listItemRtl] : styles.listItem}
                >
                  <Text style={[styles.listBullet, { fontFamily }]}>•</Text>
                  <Text style={[styles.listContent, { fontFamily, textAlign }]}>{item}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Exclusions */}
        {snapshot.exclusions && snapshot.exclusions.length > 0 && (
          <View style={styles.subSection}>
            <Text style={[styles.subSectionTitle, { fontFamily, textAlign }]}>
              {t.exclusions}
            </Text>
            <View style={styles.list}>
              {snapshot.exclusions.map((item, index) => (
                <View
                  key={index}
                  style={isRtl ? [styles.listItem, styles.listItemRtl] : styles.listItem}
                >
                  <Text style={[styles.listBullet, { fontFamily }]}>•</Text>
                  <Text style={[styles.listContent, { fontFamily, textAlign }]}>{item}</Text>
                </View>
              ))}
            </View>
          </View>
        )}
      </View>

      {/* Schedule B: Timeline & Reviews */}
      <View style={styles.scheduleSection}>
        <Text style={[styles.scheduleTitle, { fontFamily, textAlign }]}>
          {t.scheduleB}
        </Text>

        {/* Timeline */}
        <View style={styles.subSection}>
          <Text style={[styles.subSectionTitle, { fontFamily, textAlign }]}>
            {t.projectTimeline}
          </Text>
          {snapshot.startDate && (
            <InfoRow label={t.startDate} value={formatDate(snapshot.startDate, language)} />
          )}
          {snapshot.endDate && (
            <InfoRow label={t.endDate} value={formatDate(snapshot.endDate, language)} />
          )}
          <InfoRow
            label={t.reviewWindow}
            value={`${snapshot.reviewWindowDays} ${t.days}`}
          />
        </View>

        {/* Milestones */}
        {snapshot.milestones && snapshot.milestones.length > 0 && (
          <View style={styles.subSection}>
            <Text style={[styles.subSectionTitle, { fontFamily, textAlign }]}>
              {t.milestones}
            </Text>
            <View style={styles.table}>
              {snapshot.milestones.map((milestone, index) => (
                <View
                  key={milestone.id || index}
                  style={[
                    styles.tableRow,
                    index === 0 ? styles.tableRowFirst : {},
                    isRtl ? styles.tableRowRtl : {},
                  ]}
                >
                  <Text
                    style={[
                      styles.tableCell,
                      styles.tableCellLabel,
                      isRtl ? styles.tableCellLabelRtl : {},
                      { fontFamily, textAlign },
                    ]}
                  >
                    {milestone.title}
                  </Text>
                  <Text style={[styles.tableCell, styles.tableCellValue, { fontFamily }]}>
                    {milestone.targetDate ? formatDate(milestone.targetDate, language) : '-'}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Reviews */}
        <View style={styles.subSection}>
          <Text style={[styles.subSectionTitle, { fontFamily, textAlign }]}>
            {t.reviewProcess}
          </Text>
          <InfoRow
            label={t.revisionRounds}
            value={`${snapshot.revisionRounds} ${t.rounds}`}
          />
          {snapshot.bugFixDays && (
            <InfoRow
              label={t.bugFixPeriod}
              value={`${snapshot.bugFixDays} ${t.days}`}
            />
          )}
        </View>
      </View>

      {/* Schedule C: Fees & Billing */}
      <View style={styles.scheduleSection}>
        <Text style={[styles.scheduleTitle, { fontFamily, textAlign }]}>
          {t.scheduleC}
        </Text>

        {isTask ? (
          // Task payment
          <>
            {snapshot.totalAmountMinor && (
              <InfoRow
                label={t.totalAmount}
                value={formatAmount(snapshot.totalAmountMinor, snapshot.currency)}
              />
            )}
            {snapshot.depositPercent && (
              <InfoRow label={t.deposit} value={`${snapshot.depositPercent}%`} />
            )}

            {/* Payment Schedule */}
            {snapshot.scheduleItems && snapshot.scheduleItems.length > 0 && (
              <View style={styles.subSection}>
                <Text style={[styles.subSectionTitle, { fontFamily, textAlign }]}>
                  {t.paymentSchedule}
                </Text>
                <View style={styles.table}>
                  {snapshot.scheduleItems.map((item, index) => (
                    <View
                      key={item.id || index}
                      style={[
                        styles.tableRow,
                        index === 0 ? styles.tableRowFirst : {},
                        isRtl ? styles.tableRowRtl : {},
                      ]}
                    >
                      <Text
                        style={[
                          styles.tableCell,
                          styles.tableCellLabel,
                          isRtl ? styles.tableCellLabelRtl : {},
                          { fontFamily, textAlign },
                        ]}
                      >
                        {item.label || getTriggerLabel(item.trigger, t)}
                      </Text>
                      <Text style={[styles.tableCell, styles.tableCellValue, { fontFamily }]}>
                        {formatAmount(item.amountMinor, item.currency)}
                      </Text>
                    </View>
                  ))}
                </View>
              </View>
            )}

            <Text style={[styles.paragraph, { fontFamily, textAlign }]}>
              {t.paymentTermsTask}
            </Text>
          </>
        ) : (
          // Retainer payment
          <>
            {snapshot.retainerAmountMinor && (
              <InfoRow
                label={t.retainerAmount}
                value={formatAmount(snapshot.retainerAmountMinor, snapshot.currency)}
              />
            )}
            {snapshot.billingDay && (
              <InfoRow label={t.billingDay} value={String(snapshot.billingDay)} />
            )}
            {snapshot.outOfScopeRateMinor && (
              <InfoRow
                label={t.outOfScopeRate}
                value={formatAmount(snapshot.outOfScopeRateMinor, snapshot.currency)}
              />
            )}

            <Text style={[styles.paragraph, { fontFamily, textAlign }]}>
              {t.paymentTermsRetainer}
            </Text>
          </>
        )}

        {/* Late fee */}
        {snapshot.lateFeeEnabled && (
          <Text style={[styles.paragraph, { fontFamily, textAlign }]}>
            {t.latePaymentClause}
          </Text>
        )}
      </View>

      {/* Schedule D: Relationship */}
      <View style={styles.scheduleSection}>
        <Text style={[styles.scheduleTitle, { fontFamily, textAlign }]}>
          {t.scheduleD}
        </Text>

        <View style={styles.subSection}>
          <Text style={[styles.subSectionTitle, { fontFamily, textAlign }]}>
            {t.termAndTermination}
          </Text>
          <InfoRow
            label={t.termType}
            value={snapshot.termType === 'month-to-month' ? t.monthToMonth : t.fixed}
          />
          <InfoRow
            label={t.terminationNotice}
            value={`${snapshot.terminationNoticeDays} ${t.days}`}
          />
          {snapshot.cancellationCoveragePercent && (
            <InfoRow
              label={t.cancellationCoverage}
              value={`${snapshot.cancellationCoveragePercent}%`}
            />
          )}
        </View>

        <View style={styles.subSection}>
          <Text style={[styles.subSectionTitle, { fontFamily, textAlign }]}>
            {t.ownershipRights}
          </Text>
          <InfoRow
            label={t.ownershipTransfer}
            value={snapshot.ownershipTransferRule?.replace(/_/g, ' ') || '-'}
          />
        </View>
      </View>

      {/* Schedule E: Legal Terms (if clauses enabled) */}
      {hasLegalClauses && (
        <View style={styles.scheduleSection}>
          <Text style={[styles.scheduleTitle, { fontFamily, textAlign }]}>
            {t.scheduleE}
          </Text>

          {legalClauses.map((section: ClauseSection) => (
            <View key={section.id} style={styles.legalSection}>
              <Text style={[styles.legalSectionTitle, { fontFamily, textAlign }]}>
                {section.title}
              </Text>
              {section.subsections.map((subsection) => (
                <View key={subsection.id} style={styles.legalSubsection}>
                  {subsection.title && (
                    <Text style={[styles.legalSubsectionTitle, { fontFamily, textAlign }]}>
                      {subsection.title}
                    </Text>
                  )}
                  <Text style={[styles.legalSubsectionContent, { fontFamily, textAlign }]}>
                    {subsection.content}
                  </Text>
                </View>
              ))}
            </View>
          ))}
        </View>
      )}
    </Page>
  );
}

export default SchedulesPage;
