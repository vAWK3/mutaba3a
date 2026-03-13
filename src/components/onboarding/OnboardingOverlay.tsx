import { useEffect } from 'react';
import { OnboardingStepIndicator } from './OnboardingStepIndicator';
import { useOnboardingStore } from '../../lib/onboardingStore';
import { useDrawerStore } from '../../lib/stores';
import { useT } from '../../lib/i18n';
import { UsersIcon, FolderIcon, PlusIcon, CheckIcon } from '../icons';
import './OnboardingOverlay.css';

interface OnboardingOverlayProps {
  onComplete: () => void;
}

export function OnboardingOverlay({ onComplete }: OnboardingOverlayProps) {
  const t = useT();
  const {
    currentStep,
    completedSteps,
    createdClientId,
    createdProjectId,
    skipOnboarding,
    isOnboardingComplete,
  } = useOnboardingStore();

  const { openClientDrawer, openProjectDrawer, openTransactionDrawer } = useDrawerStore();

  // Handle completion
  useEffect(() => {
    if (isOnboardingComplete()) {
      onComplete();
    }
  }, [completedSteps, isOnboardingComplete, onComplete]);

  const handleStepAction = () => {
    switch (currentStep) {
      case 'client':
        openClientDrawer({
          mode: 'create',
          // Callback handled by drawer success
        });
        break;
      case 'project':
        openProjectDrawer({
          mode: 'create',
          defaultClientId: createdClientId,
        });
        break;
      case 'income':
        openTransactionDrawer({
          mode: 'create',
          defaultKind: 'income',
          defaultClientId: createdClientId,
          defaultProjectId: createdProjectId,
        });
        break;
      case 'complete':
        onComplete();
        break;
    }
  };

  const handleSkip = () => {
    skipOnboarding();
  };

  const getStepContent = (): {
    title: string;
    description: string;
    icon: React.ReactNode;
    buttonText: string;
  } => {
    switch (currentStep) {
      case 'client':
        return {
          title: t('onboarding.step1.title'),
          description: t('onboarding.step1.description'),
          icon: <UsersIcon size={24} />,
          buttonText: t('overview.welcome.addClient'),
        };
      case 'project':
        return {
          title: t('onboarding.step2.title'),
          description: t('onboarding.step2.description'),
          icon: <FolderIcon size={24} />,
          buttonText: t('overview.welcome.addProject'),
        };
      case 'income':
        return {
          title: t('onboarding.step3.title'),
          description: t('onboarding.step3.description'),
          icon: <PlusIcon size={24} />,
          buttonText: t('overview.welcome.addIncome'),
        };
      case 'complete':
        return {
          title: t('onboarding.title'),
          description: t('onboarding.subtitle'),
          icon: <CheckIcon size={24} />,
          buttonText: t('onboarding.complete'),
        };
    }
  };

  const content = getStepContent();

  return (
    <div className="onboarding-overlay">
      <div className="onboarding-card">
        <h2 className="onboarding-title">{t('onboarding.title')}</h2>
        <p className="onboarding-subtitle">{t('onboarding.subtitle')}</p>

        <OnboardingStepIndicator
          currentStep={currentStep}
          completedSteps={completedSteps}
        />

        <div className="onboarding-step-content">
          <div className="onboarding-step-icon">{content.icon}</div>
          <h3 className="onboarding-step-title">{content.title}</h3>
          <p className="onboarding-step-description">{content.description}</p>
        </div>

        <div className="onboarding-actions">
          <button className="btn btn-primary" onClick={handleStepAction}>
            {content.buttonText}
          </button>
          {currentStep !== 'complete' && (
            <button className="btn btn-ghost" onClick={handleSkip}>
              {t('onboarding.skip')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// Export a hook to track drawer success for advancing onboarding
// eslint-disable-next-line react-refresh/only-export-components -- Hook is tightly coupled with overlay component
export function useOnboardingDrawerSuccess() {
  const { currentStep, completeStep } = useOnboardingStore();

  const onClientCreated = (clientId: string) => {
    if (currentStep === 'client') {
      completeStep('client', clientId);
    }
  };

  const onProjectCreated = (projectId: string) => {
    if (currentStep === 'project') {
      completeStep('project', projectId);
    }
  };

  const onIncomeCreated = () => {
    if (currentStep === 'income') {
      completeStep('income');
    }
  };

  return { onClientCreated, onProjectCreated, onIncomeCreated };
}
