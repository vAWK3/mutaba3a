import { cn } from '../../lib/utils';
import type { OnboardingStep } from '../../lib/onboardingStore';
import './OnboardingStepIndicator.css';

interface OnboardingStepIndicatorProps {
  /** The steps this user walks, in order; numbered from 1 (TD-027) */
  steps: readonly OnboardingStep[];
  currentStep: OnboardingStep;
  completedSteps: OnboardingStep[];
}

export function OnboardingStepIndicator({
  steps,
  currentStep,
  completedSteps,
}: OnboardingStepIndicatorProps) {
  return (
    <div className="onboarding-step-indicator">
      {steps.map((step, index) => {
        const isComplete = completedSteps.includes(step);
        const isCurrent = currentStep === step;
        const isLast = index === steps.length - 1;

        return (
          <div key={step} className="step-item">
            <div
              className={cn(
                'step-circle',
                isComplete && 'completed',
                isCurrent && !isComplete && 'current'
              )}
            >
              {isComplete ? <CheckIcon /> : index + 1}
            </div>
            {!isLast && (
              <div className={cn('step-line', isComplete && 'completed')} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function CheckIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={3}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  );
}
