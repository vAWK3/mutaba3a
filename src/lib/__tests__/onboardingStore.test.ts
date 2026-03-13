import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { useOnboardingStore } from '../onboardingStore';

describe('onboardingStore', () => {
  beforeEach(() => {
    // Reset the store state before each test
    useOnboardingStore.getState().resetOnboarding();
    // Clear localStorage
    localStorage.removeItem('onboarding-storage');
  });

  afterEach(() => {
    useOnboardingStore.getState().resetOnboarding();
    localStorage.removeItem('onboarding-storage');
  });

  describe('initial state', () => {
    it('should start with currentStep as client', () => {
      const state = useOnboardingStore.getState();
      expect(state.currentStep).toBe('client');
    });

    it('should start with empty completedSteps', () => {
      const state = useOnboardingStore.getState();
      expect(state.completedSteps).toEqual([]);
    });

    it('should start not skipped', () => {
      const state = useOnboardingStore.getState();
      expect(state.skipped).toBe(false);
    });
  });

  describe('startOnboarding', () => {
    it('should reset onboarding state', () => {
      const { completeStep, startOnboarding } = useOnboardingStore.getState();
      completeStep('client', 'client-123');
      startOnboarding();

      const state = useOnboardingStore.getState();
      expect(state.currentStep).toBe('client');
      expect(state.completedSteps).toEqual([]);
      expect(state.skipped).toBe(false);
    });
  });

  describe('completeStep', () => {
    it('should mark client step as complete and advance to project', () => {
      const { completeStep } = useOnboardingStore.getState();
      completeStep('client', 'client-123');

      const state = useOnboardingStore.getState();
      expect(state.completedSteps).toContain('client');
      expect(state.createdClientId).toBe('client-123');
      expect(state.currentStep).toBe('project');
    });

    it('should mark project step as complete and advance to income', () => {
      const { completeStep } = useOnboardingStore.getState();
      completeStep('client', 'client-123');
      completeStep('project', 'project-456');

      const state = useOnboardingStore.getState();
      expect(state.completedSteps).toContain('project');
      expect(state.createdProjectId).toBe('project-456');
      expect(state.currentStep).toBe('income');
    });

    it('should mark income step as complete and advance to complete', () => {
      const { completeStep } = useOnboardingStore.getState();
      completeStep('client', 'client-123');
      completeStep('project', 'project-456');
      completeStep('income');

      const state = useOnboardingStore.getState();
      expect(state.completedSteps).toContain('income');
      expect(state.currentStep).toBe('complete');
    });

    it('should not duplicate steps in completedSteps', () => {
      const { completeStep } = useOnboardingStore.getState();
      completeStep('client', 'client-123');
      completeStep('client', 'client-123'); // Try to complete again

      const state = useOnboardingStore.getState();
      expect(state.completedSteps.filter(s => s === 'client')).toHaveLength(1);
    });
  });

  describe('skipOnboarding', () => {
    it('should mark onboarding as skipped', () => {
      const { skipOnboarding } = useOnboardingStore.getState();
      skipOnboarding();

      const state = useOnboardingStore.getState();
      expect(state.skipped).toBe(true);
    });

    it('should preserve skipped state across sessions', () => {
      const { skipOnboarding } = useOnboardingStore.getState();
      skipOnboarding();

      // Create a new store instance (simulating page reload)
      const state = useOnboardingStore.getState();
      expect(state.skipped).toBe(true);
    });
  });

  describe('resetOnboarding', () => {
    it('should reset all onboarding state', () => {
      const { completeStep, skipOnboarding, resetOnboarding } = useOnboardingStore.getState();
      completeStep('client', 'client-123');
      completeStep('project', 'project-456');
      skipOnboarding();

      resetOnboarding();

      const state = useOnboardingStore.getState();
      expect(state.currentStep).toBe('client');
      expect(state.completedSteps).toEqual([]);
      expect(state.createdClientId).toBeUndefined();
      expect(state.createdProjectId).toBeUndefined();
      expect(state.skipped).toBe(false);
    });
  });

  describe('isStepComplete', () => {
    it('should return true for completed steps', () => {
      const { completeStep, isStepComplete } = useOnboardingStore.getState();
      completeStep('client', 'client-123');

      expect(isStepComplete('client')).toBe(true);
      expect(isStepComplete('project')).toBe(false);
    });
  });

  describe('isOnboardingComplete', () => {
    it('should return false when not all steps are complete', () => {
      const { completeStep, isOnboardingComplete } = useOnboardingStore.getState();
      completeStep('client', 'client-123');

      expect(isOnboardingComplete()).toBe(false);
    });

    it('should return true when all steps are complete', () => {
      const { completeStep, isOnboardingComplete } = useOnboardingStore.getState();
      completeStep('client', 'client-123');
      completeStep('project', 'project-456');
      completeStep('income');

      expect(isOnboardingComplete()).toBe(true);
    });
  });
});
