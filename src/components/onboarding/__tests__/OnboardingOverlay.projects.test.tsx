/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useDrawerStore } from '../../../lib/stores';
import { useOnboardingStore } from '../../../lib/onboardingStore';
import { OnboardingOverlay } from '../OnboardingOverlay';

/**
 * MUT-16 D4: while the Projects area is off (the default), onboarding is
 * client → income. The overlay completes the project step itself, with no
 * entity, so a new user is never asked to create something the app then hides.
 */
const featureFlags: Record<string, boolean> = { projects: false };
let flagsLoaded = true;
vi.mock('../../../lib/features/useFeatures', () => ({
  useFeatureEnabled: (key: string) => featureFlags[key] ?? false,
  useFeaturesLoaded: () => flagsLoaded,
}));

vi.mock('../../../lib/i18n', () => ({
  useT: () => (key: string) => key,
}));

function resetStore() {
  useOnboardingStore.getState().resetOnboarding();
  window.localStorage.removeItem('onboarding-storage');
}

function moveStoreToProjectStep() {
  useOnboardingStore.getState().completeStep('client', 'client-1');
  expect(useOnboardingStore.getState().currentStep).toBe('project');
}

describe('OnboardingOverlay — Projects area switch (MUT-16)', () => {
  beforeEach(() => {
    resetStore();
    featureFlags.projects = false;
    flagsLoaded = true;
  });

  afterEach(() => {
    resetStore();
  });

  it('completes the project step without an entity while projects is off', async () => {
    moveStoreToProjectStep();
    render(<OnboardingOverlay onComplete={vi.fn()} />);

    await waitFor(() => expect(useOnboardingStore.getState().currentStep).toBe('income'));
    const state = useOnboardingStore.getState();
    expect(state.completedSteps).toEqual(['client', 'project']);
    expect(state.createdProjectId).toBeUndefined();
    expect(state.createdClientId).toBe('client-1');
  });

  it('skips the project step as soon as the client step completes while projects is off', async () => {
    render(<OnboardingOverlay onComplete={vi.fn()} />);
    expect(useOnboardingStore.getState().currentStep).toBe('client');

    useOnboardingStore.getState().completeStep('client', 'client-1');

    await waitFor(() => expect(useOnboardingStore.getState().currentStep).toBe('income'));
  });

  it('leaves the project step in place while projects is on', async () => {
    featureFlags.projects = true;
    moveStoreToProjectStep();
    render(<OnboardingOverlay onComplete={vi.fn()} />);

    // Nothing should move: give effects a tick, then confirm the step is unchanged
    await new Promise((resolve) => setTimeout(resolve, 20));
    const state = useOnboardingStore.getState();
    expect(state.currentStep).toBe('project');
    expect(state.completedSteps).toEqual(['client']);
  });

  it('does nothing while the settings row is still loading (flags read off before they are known)', async () => {
    flagsLoaded = false;
    moveStoreToProjectStep();
    render(<OnboardingOverlay onComplete={vi.fn()} />);

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(useOnboardingStore.getState().currentStep).toBe('project');
    expect(useOnboardingStore.getState().completedSteps).toEqual(['client']);
  });

  it('does not attach a project created before the area was switched off to the income step', async () => {
    useOnboardingStore.getState().completeStep('client', 'client-1');
    useOnboardingStore.getState().completeStep('project', 'project-1');
    expect(useOnboardingStore.getState().currentStep).toBe('income');
    render(<OnboardingOverlay onComplete={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'overview.welcome.addIncome' }));

    const drawer = useDrawerStore.getState().incomeDrawer;
    expect(drawer.isOpen).toBe(true);
    expect(drawer.defaultClientId).toBe('client-1');
    expect(drawer.defaultProjectId).toBeUndefined();
    useDrawerStore.getState().closeIncomeDrawer();
  });

  it('does not call onComplete just because the project step was skipped', async () => {
    const onComplete = vi.fn();
    moveStoreToProjectStep();
    render(<OnboardingOverlay onComplete={onComplete} />);

    await waitFor(() => expect(useOnboardingStore.getState().currentStep).toBe('income'));
    expect(onComplete).not.toHaveBeenCalled();
  });
});
