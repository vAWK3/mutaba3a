import { cn } from '../../../lib/utils';
import { useWizardStore, TOTAL_STEPS } from '../hooks/useWizardStore';

interface WizardNavigationProps {
  onSaveDraft: () => void;
  onFinalize?: () => void;
  isSaving?: boolean;
  isValid?: boolean;
  className?: string;
}

export function WizardNavigation({
  onSaveDraft,
  onFinalize,
  isSaving = false,
  isValid = true,
  className,
}: WizardNavigationProps) {
  const { currentStep, nextStep, prevStep, lastSavedAt, isDirty } = useWizardStore();

  const isFirstStep = currentStep === 0;
  const isLastStep = currentStep === TOTAL_STEPS - 1;

  const formatLastSaved = () => {
    if (!lastSavedAt) return null;
    const date = new Date(lastSavedAt);
    return `Last saved: ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  };

  return (
    <div className={cn('wizard-navigation', className)}>
      <div className="wizard-nav-left">
        {/* Previous button */}
        <button
          type="button"
          className="btn btn-ghost"
          onClick={prevStep}
          disabled={isFirstStep || isSaving}
        >
          ← Previous
        </button>

        {/* Autosave indicator */}
        <div className="wizard-nav-status">
          {isSaving ? (
            <span className="text-muted">Saving...</span>
          ) : lastSavedAt ? (
            <span className="text-muted">{formatLastSaved()}</span>
          ) : isDirty ? (
            <span className="text-muted">Unsaved changes</span>
          ) : null}
        </div>
      </div>

      <div className="wizard-nav-right">
        {/* Save Draft button */}
        <button
          type="button"
          className="btn btn-secondary"
          onClick={onSaveDraft}
          disabled={isSaving}
        >
          {isSaving ? 'Saving...' : 'Save Draft'}
        </button>

        {/* Next / Finalize button */}
        {isLastStep ? (
          <button
            type="button"
            className="btn btn-primary"
            onClick={onFinalize}
            disabled={isSaving || !isValid}
          >
            Finalize & Export
          </button>
        ) : (
          <button
            type="button"
            className="btn btn-primary"
            onClick={nextStep}
            disabled={isSaving}
          >
            Next →
          </button>
        )}
      </div>

      <style>{`
        .wizard-navigation {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 16px 0;
          border-top: 1px solid var(--border);
          margin-top: 24px;
          gap: 16px;
        }

        .wizard-nav-left {
          display: flex;
          align-items: center;
          gap: 16px;
        }

        .wizard-nav-right {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .wizard-nav-status {
          font-size: 12px;
        }

        @media (max-width: 600px) {
          .wizard-navigation {
            flex-wrap: wrap;
          }

          .wizard-nav-left {
            order: 2;
            width: 100%;
            justify-content: space-between;
            margin-top: 12px;
          }

          .wizard-nav-right {
            order: 1;
            width: 100%;
            justify-content: flex-end;
          }
        }
      `}</style>
    </div>
  );
}
