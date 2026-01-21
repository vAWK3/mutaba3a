import { cn } from '../../../lib/utils';
import { useWizardStore, STEP_LABELS, TOTAL_STEPS } from '../hooks/useWizardStore';
import type { ClarityRisk, WizardStep } from '../types';
import { getRisksForStep } from '../hooks/useClarityCheck';

interface WizardProgressProps {
  risks?: ClarityRisk[];
  className?: string;
}

export function WizardProgress({ risks = [], className }: WizardProgressProps) {
  const { currentStep, setStep, visitedSteps, canNavigateToStep } = useWizardStore();

  return (
    <div className={cn('wizard-progress', className)}>
      <div className="wizard-progress-track">
        {Array.from({ length: TOTAL_STEPS }, (_, index) => {
          const step = index as WizardStep;
          const isActive = currentStep === step;
          const isCompleted = visitedSteps.has(step) && currentStep > step;
          const isAccessible = canNavigateToStep(step) || visitedSteps.has(step);
          const stepRisks = getRisksForStep(risks, step);
          const hasHighRisk = stepRisks.some((r) => r.severity === 'high');
          const hasMediumRisk = stepRisks.some((r) => r.severity === 'medium');

          return (
            <div key={step} className="wizard-step-container">
              {/* Connector line */}
              {index > 0 && (
                <div
                  className={cn(
                    'wizard-connector',
                    (isCompleted || isActive) && 'wizard-connector-active'
                  )}
                />
              )}

              {/* Step indicator */}
              <button
                type="button"
                className={cn(
                  'wizard-step',
                  isActive && 'wizard-step-active',
                  isCompleted && 'wizard-step-completed',
                  !isAccessible && 'wizard-step-disabled',
                  hasHighRisk && 'wizard-step-risk-high',
                  hasMediumRisk && !hasHighRisk && 'wizard-step-risk-medium'
                )}
                onClick={() => isAccessible && setStep(step)}
                disabled={!isAccessible}
                title={STEP_LABELS[step]}
              >
                {isCompleted ? (
                  <svg
                    className="wizard-step-check"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    width="14"
                    height="14"
                  >
                    <path
                      fillRule="evenodd"
                      d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                      clipRule="evenodd"
                    />
                  </svg>
                ) : (
                  <span className="wizard-step-number">{index + 1}</span>
                )}
                {/* Risk indicator dot */}
                {stepRisks.length > 0 && (
                  <span
                    className={cn(
                      'wizard-step-risk-dot',
                      hasHighRisk && 'risk-high',
                      hasMediumRisk && !hasHighRisk && 'risk-medium'
                    )}
                  />
                )}
              </button>

              {/* Step label (only show on larger screens) */}
              <span
                className={cn(
                  'wizard-step-label',
                  isActive && 'wizard-step-label-active'
                )}
              >
                {STEP_LABELS[step]}
              </span>
            </div>
          );
        })}
      </div>

      {/* Progress bar (mobile) */}
      <div className="wizard-progress-bar-mobile">
        <div
          className="wizard-progress-bar-fill"
          style={{ width: `${((currentStep + 1) / TOTAL_STEPS) * 100}%` }}
        />
        <span className="wizard-progress-text">
          Step {currentStep + 1} of {TOTAL_STEPS}: {STEP_LABELS[currentStep]}
        </span>
      </div>

      <style>{`
        .wizard-progress {
          padding: 16px 0;
          margin-bottom: 24px;
        }

        .wizard-progress-track {
          display: none;
          align-items: flex-start;
          justify-content: space-between;
          position: relative;
        }

        @media (min-width: 900px) {
          .wizard-progress-track {
            display: flex;
          }
          .wizard-progress-bar-mobile {
            display: none;
          }
        }

        .wizard-step-container {
          display: flex;
          flex-direction: column;
          align-items: center;
          flex: 1;
          position: relative;
        }

        .wizard-connector {
          position: absolute;
          top: 16px;
          left: -50%;
          right: 50%;
          height: 2px;
          background: var(--border);
          z-index: 0;
        }

        .wizard-connector-active {
          background: var(--primary);
        }

        .wizard-step {
          width: 32px;
          height: 32px;
          border-radius: 50%;
          border: 2px solid var(--border);
          background: var(--bg);
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: all 0.2s ease;
          position: relative;
          z-index: 1;
        }

        .wizard-step:hover:not(:disabled) {
          border-color: var(--primary);
        }

        .wizard-step-active {
          border-color: var(--primary);
          background: var(--primary);
          color: white;
        }

        .wizard-step-completed {
          border-color: var(--primary);
          background: var(--primary);
          color: white;
        }

        .wizard-step-disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .wizard-step-risk-high {
          border-color: var(--danger);
        }

        .wizard-step-risk-medium {
          border-color: var(--warning);
        }

        .wizard-step-number {
          font-size: 12px;
          font-weight: 600;
        }

        .wizard-step-check {
          color: white;
        }

        .wizard-step-risk-dot {
          position: absolute;
          top: -2px;
          right: -2px;
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: var(--warning);
          border: 1px solid var(--bg);
        }

        .wizard-step-risk-dot.risk-high {
          background: var(--danger);
        }

        .wizard-step-risk-dot.risk-medium {
          background: var(--warning);
        }

        .wizard-step-label {
          margin-top: 8px;
          font-size: 11px;
          color: var(--text-muted);
          text-align: center;
          max-width: 70px;
          line-height: 1.2;
        }

        .wizard-step-label-active {
          color: var(--text);
          font-weight: 500;
        }

        .wizard-progress-bar-mobile {
          position: relative;
          height: 4px;
          background: var(--border);
          border-radius: 2px;
          overflow: hidden;
        }

        .wizard-progress-bar-fill {
          height: 100%;
          background: var(--primary);
          transition: width 0.3s ease;
        }

        .wizard-progress-text {
          display: block;
          margin-top: 8px;
          font-size: 13px;
          color: var(--text-muted);
          text-align: center;
        }
      `}</style>
    </div>
  );
}
