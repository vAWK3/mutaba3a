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

/**
 * TD-027 (MUT-15): the step indicator shows the steps the user will actually
 * walk, so a fresh install (projects off) sees two numbered steps and no
 * ticked "Project" step it never took.
 */
describe('OnboardingOverlay step indicator (TD-027, MUT-15)', () => {
  const circles = (container: HTMLElement) => Array.from(container.querySelectorAll('.step-circle'));

  beforeEach(() => {
    resetStore();
    featureFlags.projects = false;
    flagsLoaded = true;
  });

  afterEach(() => {
    resetStore();
  });

  it('shows two steps numbered 1 and 2, none ticked, at the start while projects is off', () => {
    const { container } = render(<OnboardingOverlay onComplete={vi.fn()} />);

    expect(circles(container).map((circle) => circle.textContent)).toEqual(['1', '2']);
    expect(container.querySelectorAll('.step-circle.completed')).toHaveLength(0);
    expect(circles(container)[0]).toHaveClass('current');
  });

  it('ticks step 1 and makes step 2 current once the client step is done while projects is off', async () => {
    const { container } = render(<OnboardingOverlay onComplete={vi.fn()} />);
    useOnboardingStore.getState().completeStep('client', 'client-1');

    await waitFor(() => expect(useOnboardingStore.getState().currentStep).toBe('income'));
    const [first, second] = circles(container);
    expect(circles(container)).toHaveLength(2);
    expect(first).toHaveClass('completed');
    expect(second).toHaveClass('current');
    expect(second).toHaveTextContent('2');
  });

  it('shows the three steps while projects is on', () => {
    featureFlags.projects = true;
    const { container } = render(<OnboardingOverlay onComplete={vi.fn()} />);

    expect(circles(container).map((circle) => circle.textContent)).toEqual(['1', '2', '3']);
  });
});
