import { useFormContext, Controller } from 'react-hook-form';
import { cn } from '../../../../lib/utils';
import type { EngagementSnapshot, DisputePath } from '../../types';

interface StandardTermsStepProps {
  className?: string;
}

const STANDARD_TERMS = [
  {
    name: 'confidentiality' as const,
    label: 'Confidentiality',
    description: 'Both parties agree to keep confidential information private.',
  },
  {
    name: 'ipOwnership' as const,
    label: 'IP Ownership',
    description: 'Intellectual property rights and their transfer are clearly defined.',
  },
  {
    name: 'warrantyDisclaimer' as const,
    label: 'Warranty Disclaimer',
    description: 'Work is provided "as is" without implied warranties.',
  },
  {
    name: 'limitationOfLiability' as const,
    label: 'Limitation of Liability',
    description: 'Liability is limited to the amount paid under this agreement.',
  },
  {
    name: 'nonSolicitation' as const,
    label: 'Non-Solicitation',
    description: 'Neither party will solicit the other\'s employees or contractors.',
  },
];

const DISPUTE_PATHS: { value: DisputePath; label: string; description: string }[] = [
  {
    value: 'negotiation',
    label: 'Good Faith Negotiation',
    description: 'Parties will first attempt to resolve disputes through direct discussion.',
  },
  {
    value: 'mediation',
    label: 'Mediation',
    description: 'Unresolved disputes go to a neutral mediator before any legal action.',
  },
  {
    value: 'arbitration',
    label: 'Binding Arbitration',
    description: 'Disputes are resolved by a binding arbitration process.',
  },
];

export function StandardTermsStep({ className }: StandardTermsStepProps) {
  const { register, control, watch } = useFormContext<EngagementSnapshot>();

  return (
    <div className={cn('wizard-step-content', className)}>
      <div className="step-header">
        <h2 className="step-title">Standard Terms</h2>
        <p className="step-description">
          Select which standard legal clauses to include in the agreement.
        </p>
      </div>

      {/* Standard Terms Toggles */}
      <div className="form-section">
        <h3 className="section-title">Legal Clauses</h3>
        <p className="section-hint">
          These are common protective clauses. Enable the ones relevant to your engagement.
        </p>

        <div className="terms-list">
          {STANDARD_TERMS.map((term) => (
            <label key={term.name} className="term-toggle">
              <div className="term-info">
                <span className="term-label">{term.label}</span>
                <span className="term-desc">{term.description}</span>
              </div>
              <input
                type="checkbox"
                className="toggle"
                {...register(term.name)}
              />
            </label>
          ))}
        </div>
      </div>

      {/* Dispute Resolution */}
      <div className="form-section">
        <h3 className="section-title">Dispute Resolution</h3>
        <p className="section-hint">
          How should disputes be resolved if they arise?
        </p>

        <div className="dispute-options">
          {DISPUTE_PATHS.map((path) => (
            <Controller
              key={path.value}
              name="disputePath"
              control={control}
              render={({ field }) => (
                <label className={cn('dispute-option', field.value === path.value && 'active')}>
                  <input
                    type="radio"
                    value={path.value}
                    checked={field.value === path.value}
                    onChange={(e) => field.onChange(e.target.value)}
                  />
                  <div>
                    <span className="dispute-label">{path.label}</span>
                    <span className="dispute-desc">{path.description}</span>
                  </div>
                </label>
              )}
            />
          ))}
        </div>
      </div>

      {/* Governing Law */}
      <div className="form-section">
        <h3 className="section-title">Governing Law</h3>
        <p className="section-hint">
          Which jurisdiction's laws govern this agreement?
        </p>
        <div className="form-group">
          <input
            type="text"
            className="input"
            placeholder="e.g., State of Delaware, USA"
            {...register('governingLaw')}
          />
          <p className="form-hint">
            Optional. If not specified, the laws of your location typically apply.
          </p>
        </div>
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
          margin: 0 0 16px;
        }

        .terms-list {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .term-toggle {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          padding: 16px;
          background: var(--bg);
          border: 1px solid var(--border);
          border-radius: 8px;
          cursor: pointer;
          transition: background 0.15s ease;
        }

        .term-toggle:hover {
          background: var(--bg-hover);
        }

        .term-info {
          flex: 1;
        }

        .term-label {
          display: block;
          font-weight: 500;
          font-size: 14px;
        }

        .term-desc {
          display: block;
          font-size: 12px;
          color: var(--text-muted);
          margin-top: 4px;
        }

        .toggle {
          width: 44px;
          height: 24px;
          appearance: none;
          background: var(--border);
          border-radius: 12px;
          position: relative;
          cursor: pointer;
          transition: background 0.2s ease;
        }

        .toggle::before {
          content: '';
          position: absolute;
          top: 2px;
          left: 2px;
          width: 20px;
          height: 20px;
          background: white;
          border-radius: 50%;
          transition: transform 0.2s ease;
        }

        .toggle:checked {
          background: var(--primary);
        }

        .toggle:checked::before {
          transform: translateX(20px);
        }

        .dispute-options {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .dispute-option {
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

        .dispute-option:hover {
          border-color: var(--primary);
        }

        .dispute-option.active {
          border-color: var(--primary);
          background: rgba(var(--primary-rgb), 0.05);
        }

        .dispute-option input {
          margin-top: 2px;
        }

        .dispute-label {
          display: block;
          font-weight: 500;
          font-size: 14px;
        }

        .dispute-desc {
          display: block;
          font-size: 12px;
          color: var(--text-muted);
          margin-top: 4px;
        }
      `}</style>
    </div>
  );
}
