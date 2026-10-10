import { useEffect } from 'react';
import { OnboardingStepIndicator } from './OnboardingStepIndicator';
import { useOnboardingStore } from '../../lib/onboardingStore';
import { useDrawerStore } from '../../lib/stores';
import { useT } from '../../lib/i18n';
import { useFeatureEnabled, useFeaturesLoaded } from '../../lib/features/useFeatures';
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

  // While the Projects area is off (the default), onboarding is client → income:
  // the project step completes itself so a new user is never asked to create
  // something the app then hides (MUT-16). The flags read `false` while the
  // settings row is still loading, so wait for the read before acting on it:
  // a projects-on user mid-onboarding must not have the step skipped on mount.
  const projectsEnabled = useFeatureEnabled('projects');
  const flagsLoaded = useFeaturesLoaded();
  const { completeStep } = useOnboardingStore();
  useEffect(() => {
    if (flagsLoaded && !projectsEnabled && currentStep === 'project') {
      completeStep('project');
    }
  }, [flagsLoaded, projectsEnabled, currentStep, completeStep]);

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
          // A project created before the area was switched off must not be
          // attached through a field the user can no longer see
          defaultProjectId: projectsEnabled ? createdProjectId : undefined,
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
