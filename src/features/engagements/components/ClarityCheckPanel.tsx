import { useState } from 'react';
import { cn } from '../../../lib/utils';
import { useWizardStore, STEP_LABELS } from '../hooks/useWizardStore';
import type { ClarityRisk, WizardStep } from '../types';
import { getRiskCounts, CLARITY_CHECK_MESSAGES } from '../hooks/useClarityCheck';

interface ClarityCheckPanelProps {
  risks: ClarityRisk[];
  className?: string;
}

export function ClarityCheckPanel({ risks, className }: ClarityCheckPanelProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const { setStep } = useWizardStore();
  const counts = getRiskCounts(risks);

  const handleRiskClick = (risk: ClarityRisk) => {
    setStep(risk.stepIndex as WizardStep);
    // Optionally scroll to or focus the field
  };

  const getSeverityColor = (severity: 'high' | 'medium' | 'low') => {
    switch (severity) {
      case 'high':
        return 'var(--danger)';
      case 'medium':
        return 'var(--warning)';
      case 'low':
        return 'var(--text-muted)';
    }
  };

  const getSeverityLabel = (severity: 'high' | 'medium' | 'low') => {
    switch (severity) {
      case 'high':
        return 'High';
      case 'medium':
        return 'Medium';
      case 'low':
        return 'Low';
    }
  };

  const getMessage = (messageKey: string): string => {
    const messages = CLARITY_CHECK_MESSAGES[messageKey];
    return messages?.en || messageKey;
  };

  if (risks.length === 0) {
    return (
      <div className={cn('clarity-check-panel clarity-check-success', className)}>
        <div className="clarity-check-header">
          <svg
            viewBox="0 0 20 20"
            fill="currentColor"
            width="20"
            height="20"
            className="clarity-check-icon-success"
          >
            <path
              fillRule="evenodd"
              d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
              clipRule="evenodd"
            />
          </svg>
          <span>Clarity Check</span>
        </div>
        <p className="clarity-check-success-message">
          Looking good! No issues found.
        </p>
        <style>{panelStyles}</style>
      </div>
    );
  }

  return (
    <div className={cn('clarity-check-panel', className)}>
      <button
        type="button"
        className="clarity-check-header"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="clarity-check-header-left">
          <svg
            viewBox="0 0 20 20"
            fill="currentColor"
            width="20"
            height="20"
            className="clarity-check-icon-warning"
          >
            <path
              fillRule="evenodd"
              d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
              clipRule="evenodd"
            />
          </svg>
          <span>Clarity Check</span>
          <span className="clarity-check-count">
            {counts.total} {counts.total === 1 ? 'issue' : 'issues'}
          </span>
        </div>
        <svg
          viewBox="0 0 20 20"
          fill="currentColor"
          width="16"
          height="16"
          className={cn('clarity-check-chevron', isExpanded && 'expanded')}
        >
          <path
            fillRule="evenodd"
            d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
            clipRule="evenodd"
          />
        </svg>
      </button>

      {isExpanded && (
        <>
          {/* Summary badges */}
          <div className="clarity-check-summary">
            {counts.high > 0 && (
              <span className="clarity-badge clarity-badge-high">
                {counts.high} high
              </span>
            )}
            {counts.medium > 0 && (
              <span className="clarity-badge clarity-badge-medium">
                {counts.medium} medium
              </span>
            )}
            {counts.low > 0 && (
              <span className="clarity-badge clarity-badge-low">
                {counts.low} low
              </span>
            )}
          </div>

          {/* Risk list */}
          <div className="clarity-check-list">
            {risks.map((risk) => (
              <button
                key={risk.id}
                type="button"
                className="clarity-check-item"
                onClick={() => handleRiskClick(risk)}
              >
                <div
                  className="clarity-check-dot"
                  style={{ background: getSeverityColor(risk.severity) }}
                />
                <div className="clarity-check-item-content">
                  <div className="clarity-check-item-header">
                    <span className="clarity-check-item-step">
                      Step {risk.stepIndex + 1}: {STEP_LABELS[risk.stepIndex]}
                    </span>
                    <span
                      className="clarity-check-item-severity"
                      style={{ color: getSeverityColor(risk.severity) }}
                    >
                      {getSeverityLabel(risk.severity)}
                    </span>
                  </div>
                  <p className="clarity-check-item-message">
                    {getMessage(risk.messageKey)}
                  </p>
                </div>
              </button>
            ))}
          </div>
        </>
      )}

      <style>{panelStyles}</style>
    </div>
  );
}

const panelStyles = `
  .clarity-check-panel {
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: 8px;
    overflow: hidden;
  }

  .clarity-check-success {
    border-color: var(--success-border, var(--border));
  }

  .clarity-check-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
    background: transparent;
    border: none;
    width: 100%;
    cursor: pointer;
    text-align: left;
  }

  .clarity-check-header-left {
    display: flex;
    align-items: center;
    gap: 8px;
    font-weight: 500;
    font-size: 14px;
  }

  .clarity-check-icon-warning {
    color: var(--warning);
  }

  .clarity-check-icon-success {
    color: var(--success, #10b981);
  }

  .clarity-check-count {
    font-weight: normal;
    color: var(--text-muted);
    font-size: 13px;
  }

  .clarity-check-chevron {
    color: var(--text-muted);
    transition: transform 0.2s ease;
  }

  .clarity-check-chevron.expanded {
    transform: rotate(180deg);
  }

  .clarity-check-summary {
    display: flex;
    gap: 8px;
    padding: 0 16px 12px;
    flex-wrap: wrap;
  }

  .clarity-badge {
    font-size: 11px;
    padding: 2px 8px;
    border-radius: 4px;
    font-weight: 500;
  }

  .clarity-badge-high {
    background: rgba(239, 68, 68, 0.1);
    color: var(--danger);
  }

  .clarity-badge-medium {
    background: rgba(245, 158, 11, 0.1);
    color: var(--warning);
  }

  .clarity-badge-low {
    background: rgba(107, 114, 128, 0.1);
    color: var(--text-muted);
  }

  .clarity-check-list {
    border-top: 1px solid var(--border);
  }

  .clarity-check-item {
    display: flex;
    gap: 12px;
    padding: 12px 16px;
    border: none;
    background: transparent;
    width: 100%;
    text-align: left;
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .clarity-check-item:hover {
    background: var(--bg-hover);
  }

  .clarity-check-item + .clarity-check-item {
    border-top: 1px solid var(--border);
  }

  .clarity-check-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
    margin-top: 6px;
  }

  .clarity-check-item-content {
    flex: 1;
    min-width: 0;
  }

  .clarity-check-item-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 4px;
  }

  .clarity-check-item-step {
    font-size: 11px;
    color: var(--text-muted);
  }

  .clarity-check-item-severity {
    font-size: 11px;
    font-weight: 500;
  }

  .clarity-check-item-message {
    font-size: 13px;
    color: var(--text);
    margin: 0;
    line-height: 1.4;
  }

  .clarity-check-success-message {
    padding: 0 16px 16px;
    margin: 0;
    font-size: 13px;
    color: var(--success, #10b981);
  }
`;
