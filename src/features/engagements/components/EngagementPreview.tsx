import { cn } from '../../../lib/utils';
import type { EngagementSnapshot, EngagementLanguage } from '../types';
import type { Client, Project } from '../../../types';

interface EngagementPreviewProps {
  snapshot: Partial<EngagementSnapshot>;
  client?: Client;
  project?: Project;
  language: EngagementLanguage;
  className?: string;
}

/**
 * Live preview component for engagement document
 * For MVP, this shows a text-based preview.
 * The full PDF rendering will be added in Phase 4.
 */
export function EngagementPreview({
  snapshot,
  client,
  project,
  language,
  className,
}: EngagementPreviewProps) {
  const isRtl = language === 'ar';

  const formatCurrency = (minorAmount?: number, currency?: string) => {
    if (minorAmount === undefined) return '—';
    const amount = minorAmount / 100;
    return new Intl.NumberFormat(language === 'ar' ? 'ar-SA' : 'en-US', {
      style: 'currency',
      currency: currency || 'USD',
    }).format(amount);
  };

  return (
    <div className={cn('engagement-preview', isRtl && 'rtl', className)}>
      <div className="preview-document">
        {/* Header */}
        <div className="preview-header">
          <h1 className="preview-title">
            {snapshot.title || (language === 'ar' ? 'اتفاقية عمل' : 'Engagement Agreement')}
          </h1>
          {client && (
            <p className="preview-client">
              {language === 'ar' ? 'العميل: ' : 'Client: '}
              {client.name}
            </p>
          )}
          {project && (
            <p className="preview-project">
              {language === 'ar' ? 'المشروع: ' : 'Project: '}
              {project.name}
            </p>
          )}
        </div>

        {/* Summary Section */}
        {snapshot.summary && (
          <div className="preview-section">
            <h2>{language === 'ar' ? 'نظرة عامة' : 'Overview'}</h2>
            <p>{snapshot.summary}</p>
            {snapshot.clientGoal && (
              <p className="preview-goal">
                <strong>{language === 'ar' ? 'الهدف: ' : 'Goal: '}</strong>
                {snapshot.clientGoal}
              </p>
            )}
          </div>
        )}

        {/* Deliverables Section */}
        {snapshot.deliverables && snapshot.deliverables.length > 0 && (
          <div className="preview-section">
            <h2>{language === 'ar' ? 'التسليمات' : 'Deliverables'}</h2>
            <ul>
              {snapshot.deliverables.map((d, i) => (
                <li key={d.id || i}>
                  {d.description}
                  {d.quantity && <span className="preview-qty"> (×{d.quantity})</span>}
                  {d.format && <span className="preview-format"> [{d.format}]</span>}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Exclusions */}
        {snapshot.exclusions && snapshot.exclusions.length > 0 && (
          <div className="preview-section">
            <h2>{language === 'ar' ? 'الاستثناءات' : 'Exclusions'}</h2>
            <ul className="preview-exclusions">
              {snapshot.exclusions.map((ex, i) => (
                <li key={i}>{ex}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Timeline Section */}
        {(snapshot.startDate || snapshot.milestones?.length) && (
          <div className="preview-section">
            <h2>{language === 'ar' ? 'الجدول الزمني' : 'Timeline'}</h2>
            {snapshot.startDate && (
              <p>
                <strong>{language === 'ar' ? 'تاريخ البدء: ' : 'Start Date: '}</strong>
                {new Date(snapshot.startDate).toLocaleDateString(language === 'ar' ? 'ar-SA' : 'en-US')}
              </p>
            )}
            {snapshot.endDate && (
              <p>
                <strong>{language === 'ar' ? 'تاريخ الانتهاء: ' : 'End Date: '}</strong>
                {new Date(snapshot.endDate).toLocaleDateString(language === 'ar' ? 'ar-SA' : 'en-US')}
              </p>
            )}
            {snapshot.milestones && snapshot.milestones.length > 0 && (
              <div className="preview-milestones">
                <h3>{language === 'ar' ? 'المراحل' : 'Milestones'}</h3>
                <ul>
                  {snapshot.milestones.map((m, i) => (
                    <li key={m.id || i}>
                      {m.title}
                      {m.targetDate && (
                        <span className="preview-date">
                          {' '}— {new Date(m.targetDate).toLocaleDateString(language === 'ar' ? 'ar-SA' : 'en-US')}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* Payment Section */}
        <div className="preview-section">
          <h2>{language === 'ar' ? 'الدفع' : 'Payment'}</h2>
          {snapshot.totalAmountMinor !== undefined && (
            <p className="preview-total">
              <strong>{language === 'ar' ? 'الإجمالي: ' : 'Total: '}</strong>
              {formatCurrency(snapshot.totalAmountMinor, snapshot.currency)}
            </p>
          )}
          {snapshot.depositPercent !== undefined && snapshot.depositPercent > 0 && (
            <p>
              <strong>{language === 'ar' ? 'الدفعة المقدمة: ' : 'Deposit: '}</strong>
              {snapshot.depositPercent}%
            </p>
          )}
          {snapshot.scheduleItems && snapshot.scheduleItems.length > 0 && (
            <div className="preview-schedule">
              <h3>{language === 'ar' ? 'جدول الدفع' : 'Payment Schedule'}</h3>
              <ul>
                {snapshot.scheduleItems.map((item, i) => (
                  <li key={item.id || i}>
                    {item.label}: {formatCurrency(item.amountMinor, item.currency)}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Terms Section */}
        <div className="preview-section">
          <h2>{language === 'ar' ? 'الشروط' : 'Terms'}</h2>
          <div className="preview-terms-grid">
            {snapshot.confidentiality && (
              <span className="preview-term-badge">
                {language === 'ar' ? 'سرية' : 'Confidentiality'}
              </span>
            )}
            {snapshot.ipOwnership && (
              <span className="preview-term-badge">
                {language === 'ar' ? 'ملكية فكرية' : 'IP Ownership'}
              </span>
            )}
            {snapshot.warrantyDisclaimer && (
              <span className="preview-term-badge">
                {language === 'ar' ? 'إخلاء ضمان' : 'Warranty Disclaimer'}
              </span>
            )}
            {snapshot.limitationOfLiability && (
              <span className="preview-term-badge">
                {language === 'ar' ? 'حد المسؤولية' : 'Liability Limit'}
              </span>
            )}
            {snapshot.nonSolicitation && (
              <span className="preview-term-badge">
                {language === 'ar' ? 'عدم الاستقطاب' : 'Non-Solicitation'}
              </span>
            )}
          </div>
          {snapshot.terminationNoticeDays !== undefined && snapshot.terminationNoticeDays > 0 && (
            <p>
              <strong>{language === 'ar' ? 'فترة الإشعار: ' : 'Notice Period: '}</strong>
              {snapshot.terminationNoticeDays} {language === 'ar' ? 'يوم' : 'days'}
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="preview-footer">
          <p className="preview-disclaimer">
            {language === 'ar'
              ? 'هذا مستند معاينة. المستند النهائي سيتضمن جميع التفاصيل القانونية.'
              : 'This is a preview document. The final document will include all legal details.'}
          </p>
        </div>
      </div>

      <style>{`
        .engagement-preview {
          background: white;
          height: 100%;
          overflow-y: auto;
          font-family: Georgia, serif;
        }

        .engagement-preview.rtl {
          direction: rtl;
          text-align: right;
        }

        .preview-document {
          max-width: 600px;
          margin: 0 auto;
          padding: 40px;
        }

        .preview-header {
          border-bottom: 2px solid #1a1a1a;
          padding-bottom: 20px;
          margin-bottom: 30px;
        }

        .preview-title {
          font-size: 24px;
          font-weight: 600;
          margin: 0 0 12px;
          color: #1a1a1a;
        }

        .preview-client,
        .preview-project {
          margin: 4px 0;
          color: #666;
          font-size: 14px;
        }

        .preview-section {
          margin-bottom: 24px;
        }

        .preview-section h2 {
          font-size: 16px;
          font-weight: 600;
          margin: 0 0 12px;
          color: #1a1a1a;
          border-bottom: 1px solid #e5e5e5;
          padding-bottom: 8px;
        }

        .preview-section h3 {
          font-size: 14px;
          font-weight: 500;
          margin: 12px 0 8px;
          color: #333;
        }

        .preview-section p {
          margin: 8px 0;
          font-size: 14px;
          line-height: 1.6;
          color: #333;
        }

        .preview-section ul {
          margin: 8px 0;
          padding-left: 20px;
        }

        .rtl .preview-section ul {
          padding-left: 0;
          padding-right: 20px;
        }

        .preview-section li {
          margin: 6px 0;
          font-size: 14px;
          line-height: 1.5;
        }

        .preview-qty,
        .preview-format {
          color: #666;
          font-size: 12px;
        }

        .preview-date {
          color: #666;
          font-size: 13px;
        }

        .preview-exclusions li {
          color: #666;
        }

        .preview-total {
          font-size: 18px;
          margin: 12px 0;
        }

        .preview-terms-grid {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          margin-bottom: 12px;
        }

        .preview-term-badge {
          display: inline-block;
          padding: 4px 12px;
          background: #f3f4f6;
          border-radius: 4px;
          font-size: 12px;
          color: #374151;
        }

        .preview-footer {
          margin-top: 40px;
          padding-top: 20px;
          border-top: 1px solid #e5e5e5;
        }

        .preview-disclaimer {
          font-size: 11px;
          color: #999;
          font-style: italic;
          text-align: center;
        }
      `}</style>
    </div>
  );
}
