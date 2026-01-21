import { useFormContext, Controller } from 'react-hook-form';
import { cn } from '../../../../lib/utils';
import { useWizardStore } from '../../hooks/useWizardStore';
import type { EngagementSnapshot, TermType } from '../../types';

interface RelationshipStepProps {
  className?: string;
}

const TERM_TYPES: { value: TermType; label: string; description: string }[] = [
  {
    value: 'fixed',
    label: 'Fixed Term',
    description: 'Agreement ends on a specific date or upon project completion',
  },
  {
    value: 'month-to-month',
    label: 'Month-to-Month',
    description: 'Agreement continues until either party terminates',
  },
];

const OWNERSHIP_RULES = [
  { value: 'upon_full_payment', label: 'Upon full payment' },
  { value: 'upon_milestone_payment', label: 'Upon milestone payment' },
  { value: 'upon_final_delivery', label: 'Upon final delivery' },
  { value: 'immediately', label: 'Immediately upon creation' },
  { value: 'licensed', label: 'Work remains licensed, not transferred' },
];

export function RelationshipStep({ className }: RelationshipStepProps) {
  const { control, watch } = useFormContext<EngagementSnapshot>();
  const { engagementType } = useWizardStore();

  const termType = watch('termType') || 'fixed';
  const isRetainer = engagementType === 'retainer';

  return (
    <div className={cn('wizard-step-content', className)}>
      <div className="step-header">
        <h2 className="step-title">Relationship Terms</h2>
        <p className="step-description">
          Define how the engagement can be ended and how ownership transfers.
        </p>
      </div>

      {/* Term Type */}
      <div className="form-section">
        <h3 className="section-title">Agreement Term</h3>
        <div className="term-options">
          {TERM_TYPES.map((term) => (
            <Controller
              key={term.value}
              name="termType"
              control={control}
              render={({ field }) => (
                <label className={cn('term-option', field.value === term.value && 'active')}>
                  <input
                    type="radio"
                    value={term.value}
                    checked={field.value === term.value}
                    onChange={(e) => field.onChange(e.target.value)}
                  />
                  <div>
                    <span className="term-label">{term.label}</span>
                    <span className="term-desc">{term.description}</span>
                  </div>
                </label>
              )}
            />
          ))}
        </div>
      </div>

      {/* Termination Notice */}
      <div className="form-section">
        <h3 className="section-title">Termination Notice</h3>
        <p className="section-hint">
          How much notice is required to end the agreement?
        </p>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Notice Period (Days)</label>
            <Controller
              name="terminationNoticeDays"
              control={control}
              render={({ field }) => (
                <input
                  type="number"
                  min="0"
                  max="90"
                  className="input"
                  style={{ width: 100 }}
                  value={field.value || 0}
                  onChange={(e) => field.onChange(parseInt(e.target.value) || 0)}
                />
              )}
            />
          </div>
        </div>
        <p className="form-hint">
          {termType === 'month-to-month'
            ? 'Either party must give this much notice to end the agreement.'
            : 'Client must give this much notice to cancel before completion.'}
        </p>
      </div>

      {/* Cancellation Coverage (for fixed term) */}
      {termType === 'fixed' && !isRetainer && (
        <div className="form-section">
          <h3 className="section-title">Early Cancellation</h3>
          <p className="section-hint">
            What percentage of the remaining amount is owed if the client cancels early?
          </p>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Cancellation Coverage</label>
              <div className="input-with-suffix">
                <Controller
                  name="cancellationCoveragePercent"
                  control={control}
                  render={({ field }) => (
                    <input
                      type="number"
                      min="0"
                      max="100"
                      className="input"
                      style={{ width: 100 }}
                      value={field.value || 0}
                      onChange={(e) => field.onChange(parseInt(e.target.value) || 0)}
                    />
                  )}
                />
                <span className="input-suffix">%</span>
              </div>
            </div>
          </div>
          <p className="form-hint">
            Common values: 25-50% of remaining amount.
          </p>
        </div>
      )}

      {/* Ownership Transfer */}
      <div className="form-section">
        <h3 className="section-title">Ownership Transfer</h3>
        <p className="section-hint">
          When does ownership of the work transfer to the client?
        </p>
        <div className="form-group">
          <Controller
            name="ownershipTransferRule"
            control={control}
            render={({ field }) => (
              <select
                className="select"
                value={field.value || 'upon_full_payment'}
                onChange={(e) => field.onChange(e.target.value)}
              >
                {OWNERSHIP_RULES.map((rule) => (
                  <option key={rule.value} value={rule.value}>
                    {rule.label}
                  </option>
                ))}
              </select>
            )}
          />
        </div>
        <p className="form-hint">
          "Upon full payment" is recommended to protect your work until you're paid.
        </p>
      </div>

      <style>{`
        .wizard-step-content {
          max-width: 700px;
        }

        .step-header {
          margin-bottom: 32px;
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

        .form-section {
          margin-bottom: 32px;
        }

        .section-title {
          font-size: 14px;
          font-weight: 600;
          margin: 0 0 8px;
        }

        .section-hint {
          color: var(--text-muted);
          font-size: 13px;
          margin: 0 0 12px;
        }

        .form-row {
          display: flex;
          gap: 16px;
          flex-wrap: wrap;
        }

        .term-options {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .term-option {
          display: flex;
          align-items: flex-start;
          gap: 12px;
          padding: 16px;
          background: var(--bg);
          border: 2px solid var(--border);
          border-radius: 8px;
          cursor: pointer;
          transition: all 0.15s ease;
        }

        .term-option:hover {
          border-color: var(--primary);
        }

        .term-option.active {
          border-color: var(--primary);
          background: rgba(var(--primary-rgb), 0.05);
        }

        .term-option input {
          margin-top: 2px;
        }

        .term-label {
          display: block;
          font-weight: 500;
          font-size: 15px;
        }

        .term-desc {
          display: block;
          font-size: 13px;
          color: var(--text-muted);
          margin-top: 4px;
        }

        .input-with-suffix {
          display: flex;
          align-items: center;
        }

        .input-suffix {
          padding: 8px 12px;
          background: var(--bg-elevated);
          border: 1px solid var(--border);
          border-left: none;
          border-radius: 0 6px 6px 0;
          color: var(--text-muted);
        }

        .input-with-suffix .input {
          border-radius: 6px 0 0 6px;
        }
      `}</style>
    </div>
  );
}
