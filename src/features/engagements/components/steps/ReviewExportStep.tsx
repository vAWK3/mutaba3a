/* eslint-disable react-hooks/static-components */
import { useFormContext } from 'react-hook-form';
import { cn } from '../../../../lib/utils';
import { useWizardStore, STEP_LABELS } from '../../hooks/useWizardStore';
import { ClarityCheckPanel } from '../ClarityCheckPanel';
import type { EngagementSnapshot, ClarityRisk, WizardStep } from '../../types';
import { hasHighSeverityRisks, getRiskCounts } from '../../hooks/useClarityCheck';

interface ReviewExportStepProps {
  risks: ClarityRisk[];
  onFinalize: () => void;
  isProcessing?: boolean;
  className?: string;
}

export function ReviewExportStep({
  risks,
  onFinalize,
  isProcessing = false,
  className,
}: ReviewExportStepProps) {
  const { watch } = useFormContext<EngagementSnapshot>();
  const { setStep, engagementType, engagementCategory, primaryLanguage } = useWizardStore();
  const snapshot = watch();

  const hasHighRisks = hasHighSeverityRisks(risks);
  const riskCounts = getRiskCounts(risks);

  const formatCurrency = (minorAmount?: number, currency?: string) => {
    if (minorAmount === undefined || minorAmount === 0) return '—';
    const amount = minorAmount / 100;
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency || 'USD',
    }).format(amount);
  };

  const SectionLink = ({
    stepIndex,
    label,
    children,
  }: {
    stepIndex: number;
    label?: string;
    children: React.ReactNode;
  }) => (
    <button
      type="button"
      className="section-link"
      onClick={() => setStep(stepIndex as WizardStep)}
    >
      <div className="section-link-header">
        <span className="section-link-step">Step {stepIndex + 1}</span>
        <span className="section-link-label">{label || STEP_LABELS[stepIndex]}</span>
        <span className="section-link-edit">Edit</span>
      </div>
      <div className="section-link-content">{children}</div>
    </button>
  );

  return (
    <div className={cn('wizard-step-content review-step', className)}>
      <div className="step-header">
        <h2 className="step-title">Review & Finalize</h2>
        <p className="step-description">
          Review your engagement agreement before exporting.
        </p>
      </div>

      {/* Clarity Check Panel */}
      <div className="review-section">
        <ClarityCheckPanel risks={risks} />
      </div>

      {/* Summary Cards */}
      <div className="review-cards">
        <SectionLink stepIndex={0} label="Client & Type">
          <div className="review-item">
            <span className="review-label">Client</span>
            <span className="review-value">{snapshot.clientName || '—'}</span>
          </div>
          {snapshot.projectName && (
            <div className="review-item">
              <span className="review-label">Project</span>
              <span className="review-value">{snapshot.projectName}</span>
            </div>
          )}
          <div className="review-item">
            <span className="review-label">Type</span>
            <span className="review-value">
              {engagementType === 'task' ? 'Task-Based' : 'Retainer'} • {engagementCategory}
            </span>
          </div>
          <div className="review-item">
            <span className="review-label">Language</span>
            <span className="review-value">{primaryLanguage === 'ar' ? 'Arabic' : 'English'}</span>
          </div>
        </SectionLink>

        <SectionLink stepIndex={1} label="Summary">
          <div className="review-item">
            <span className="review-label">Title</span>
            <span className="review-value">{snapshot.title || '—'}</span>
          </div>
          {snapshot.summary && (
            <div className="review-item">
              <span className="review-value review-text">{snapshot.summary}</span>
            </div>
          )}
        </SectionLink>

        <SectionLink stepIndex={2} label="Scope">
          <div className="review-item">
            <span className="review-label">Deliverables</span>
            <span className="review-value">{snapshot.deliverables?.length || 0} items</span>
          </div>
          <div className="review-item">
            <span className="review-label">Exclusions</span>
            <span className="review-value">{snapshot.exclusions?.length || 0} items</span>
          </div>
          <div className="review-item">
            <span className="review-label">Dependencies</span>
            <span className="review-value">{snapshot.dependencies?.length || 0} items</span>
          </div>
        </SectionLink>

        <SectionLink stepIndex={3} label="Timeline">
          <div className="review-item">
            <span className="review-label">Start</span>
            <span className="review-value">
              {snapshot.startDate
                ? new Date(snapshot.startDate).toLocaleDateString()
                : '—'}
            </span>
          </div>
          <div className="review-item">
            <span className="review-label">End</span>
            <span className="review-value">
              {snapshot.endDate
                ? new Date(snapshot.endDate).toLocaleDateString()
                : '—'}
            </span>
          </div>
          <div className="review-item">
            <span className="review-label">Milestones</span>
            <span className="review-value">{snapshot.milestones?.length || 0}</span>
          </div>
          <div className="review-item">
            <span className="review-label">Review Window</span>
            <span className="review-value">{snapshot.reviewWindowDays || 0} days</span>
          </div>
        </SectionLink>

        <SectionLink stepIndex={5} label="Payment">
          {engagementType === 'task' ? (
            <>
              <div className="review-item">
                <span className="review-label">Total</span>
                <span className="review-value">
                  {formatCurrency(snapshot.totalAmountMinor, snapshot.currency)}
                </span>
              </div>
              <div className="review-item">
                <span className="review-label">Deposit</span>
                <span className="review-value">{snapshot.depositPercent || 0}%</span>
              </div>
              <div className="review-item">
                <span className="review-label">Payments</span>
                <span className="review-value">{snapshot.scheduleItems?.length || 0} scheduled</span>
              </div>
            </>
          ) : (
            <>
              <div className="review-item">
                <span className="review-label">Monthly</span>
                <span className="review-value">
                  {formatCurrency(snapshot.retainerAmountMinor, snapshot.currency)}
                </span>
              </div>
              <div className="review-item">
                <span className="review-label">Billing Day</span>
                <span className="review-value">{snapshot.billingDay || 1}</span>
              </div>
            </>
          )}
          <div className="review-item">
            <span className="review-label">Late Fee</span>
            <span className="review-value">
              {snapshot.lateFeeEnabled ? 'Enabled' : 'Disabled'}
            </span>
          </div>
        </SectionLink>

        <SectionLink stepIndex={6} label="Relationship">
          <div className="review-item">
            <span className="review-label">Term</span>
            <span className="review-value">
              {snapshot.termType === 'month-to-month' ? 'Month-to-Month' : 'Fixed'}
            </span>
          </div>
          <div className="review-item">
            <span className="review-label">Notice Period</span>
            <span className="review-value">{snapshot.terminationNoticeDays || 0} days</span>
          </div>
          <div className="review-item">
            <span className="review-label">Ownership</span>
            <span className="review-value">
              {snapshot.ownershipTransferRule?.replace(/_/g, ' ') || '—'}
            </span>
          </div>
        </SectionLink>

        <SectionLink stepIndex={7} label="Terms">
          <div className="review-terms-badges">
            {snapshot.confidentiality && <span className="term-badge">Confidentiality</span>}
            {snapshot.ipOwnership && <span className="term-badge">IP Ownership</span>}
            {snapshot.warrantyDisclaimer && <span className="term-badge">Warranty</span>}
            {snapshot.limitationOfLiability && <span className="term-badge">Liability Limit</span>}
            {snapshot.nonSolicitation && <span className="term-badge">Non-Solicitation</span>}
          </div>
          <div className="review-item">
            <span className="review-label">Disputes</span>
            <span className="review-value">{snapshot.disputePath || '—'}</span>
          </div>
        </SectionLink>
      </div>

      {/* Finalize Action */}
      <div className="finalize-section">
        {hasHighRisks && (
          <div className="warning-banner">
            <svg viewBox="0 0 20 20" fill="currentColor" width="20" height="20">
              <path
                fillRule="evenodd"
                d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                clipRule="evenodd"
              />
            </svg>
            <span>
              You have {riskCounts.high} high-severity {riskCounts.high === 1 ? 'issue' : 'issues'}
              that should be addressed before finalizing.
            </span>
          </div>
        )}

        <button
          type="button"
          className="btn btn-primary btn-lg finalize-btn"
          onClick={onFinalize}
          disabled={isProcessing}
        >
          {isProcessing ? 'Processing...' : 'Finalize & Export PDF'}
        </button>

        <p className="finalize-hint">
          Finalizing will create a locked version of this engagement that cannot be edited.
        </p>
      </div>

      <style>{`
        .review-step {
          max-width: 800px;
        }

        .step-header {
          margin-bottom: 24px;
        }

        .step-title {
          font-size: 20px;
          font-weight: 600;
          margin: 0 0 8px;
        }

        .step-description {
          color: var(--text-muted);
          margin: 0;
          font-size: 14px;
        }

        .review-section {
          margin-bottom: 24px;
        }

        .review-cards {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
          gap: 12px;
          margin-bottom: 32px;
        }

        .section-link {
          display: block;
          width: 100%;
          padding: 16px;
          background: var(--bg);
          border: 1px solid var(--border);
          border-radius: 8px;
          text-align: left;
          cursor: pointer;
          transition: all 0.15s ease;
        }

        .section-link:hover {
          border-color: var(--primary);
          background: var(--bg-hover);
        }

        .section-link-header {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 12px;
        }

        .section-link-step {
          font-size: 11px;
          color: var(--text-muted);
          padding: 2px 6px;
          background: var(--bg-elevated);
          border-radius: 4px;
        }

        .section-link-label {
          font-weight: 500;
          font-size: 14px;
          flex: 1;
        }

        .section-link-edit {
          font-size: 12px;
          color: var(--primary);
          opacity: 0;
          transition: opacity 0.15s ease;
        }

        .section-link:hover .section-link-edit {
          opacity: 1;
        }

        .section-link-content {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .review-item {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 12px;
          font-size: 13px;
        }

        .review-label {
          color: var(--text-muted);
          flex-shrink: 0;
        }

        .review-value {
          text-align: right;
          word-break: break-word;
        }

        .review-text {
          text-align: left;
          color: var(--text-muted);
          font-size: 12px;
          line-height: 1.4;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }

        .review-terms-badges {
          display: flex;
          flex-wrap: wrap;
          gap: 4px;
          margin-bottom: 8px;
        }

        .term-badge {
          font-size: 10px;
          padding: 2px 6px;
          background: var(--bg-elevated);
          border-radius: 4px;
          color: var(--text-muted);
        }

        .finalize-section {
          text-align: center;
          padding: 24px;
          background: var(--bg-elevated);
          border-radius: 12px;
          border: 1px solid var(--border);
        }

        .warning-banner {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          padding: 12px 16px;
          background: rgba(245, 158, 11, 0.1);
          border: 1px solid var(--warning);
          border-radius: 8px;
          margin-bottom: 16px;
          font-size: 13px;
          color: var(--warning);
        }

        .finalize-btn {
          min-width: 200px;
        }

        .finalize-hint {
          margin: 12px 0 0;
          font-size: 12px;
          color: var(--text-muted);
        }
      `}</style>
    </div>
  );
}
