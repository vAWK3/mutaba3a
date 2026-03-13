import { cn } from '../../lib/utils';
import type { OnboardingStep } from '../../lib/onboardingStore';
import './OnboardingStepIndicator.css';

interface OnboardingStepIndicatorProps {
  currentStep: OnboardingStep;
  completedSteps: OnboardingStep[];
}

const STEPS: { step: OnboardingStep; number: number }[] = [
  { step: 'client', number: 1 },
  { step: 'project', number: 2 },
  { step: 'income', number: 3 },
];

export function OnboardingStepIndicator({
  currentStep,
  completedSteps,
}: OnboardingStepIndicatorProps) {
  return (
    <div className="onboarding-step-indicator">
      {STEPS.map(({ step, number }, index) => {
        const isComplete = completedSteps.includes(step);
        const isCurrent = currentStep === step;
        const isLast = index === STEPS.length - 1;

        return (
          <div key={step} className="step-item">
            <div
              className={cn(
                'step-circle',
                isComplete && 'completed',
                isCurrent && !isComplete && 'current'
              )}
            >
              {isComplete ? <CheckIcon /> : number}
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
